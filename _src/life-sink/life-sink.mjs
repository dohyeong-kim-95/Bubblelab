#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore, deriveKey, SnapshotRequiredError, WrongPassphraseError } from "./store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const NORMAL_POLL_MS = 30_000;
export const MAX_BACKOFF_MS = 300_000;
export const nextBackoff = (current) => Math.min(Math.max(1_000, current * 2), MAX_BACKOFF_MS);

function loadConfig() {
  let file = {};
  const path = join(HERE, "life-sink.config.json");
  if (existsSync(path)) file = JSON.parse(readFileSync(path, "utf8"));
  const config = {
    url: process.env.LIFE_URL || file.url || "https://life.bubblelab.dev",
    token: process.env.LIFE_TOKEN || file.token,
    passphrase: process.env.LIFE_PASSPHRASE || file.passphrase,
    dir: process.env.LIFE_DIR || file.dir || join(HERE, "LifeStorage"),
    pollMs: Number(process.env.LIFE_POLL_MS || file.pollMs || NORMAL_POLL_MS),
  };
  for (const name of ["url", "token", "passphrase"]) if (!config[name]) throw new Error(`missing config: ${name}`);
  if (!Number.isFinite(config.pollMs) || config.pollMs < 1_000) throw new Error("pollMs must be at least 1000");
  config.url = config.url.replace(/\/+$/, "");
  return config;
}

export function createApi({ url, token, fetchImpl = fetch }) {
  async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* retain status-only error */ }
    if (!response.ok) {
      const error = new Error(payload?.error || `${method} ${path}: HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload ?? {};
  }
  return {
    bootstrap: () => request("/_life/bootstrap"),
    changes: (after) => request(`/_life/changes?after=${encodeURIComponent(after)}&limit=100`),
    snapshot: (after) => request(`/_life/snapshot?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`),
    ack: (seq) => request("/_life/sink/ack", { method: "POST", body: { seq } }),
  };
}

/* 저널이 우리 커서보다 앞서 잘렸을 때. 서버의 현재 엔터티를 페이지로 받아
 * 그대로 적용한다. 받는 도중 head 가 달라지면 중간이 섞인 상태이므로
 * 처음부터 다시 받는다. */
export async function recoverSnapshot({ api, store, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const envelopes = [];
    let after = "";
    let head = null;
    let consistent = true;
    let done = false;
    while (!done) {
      const page = await api.snapshot(after);
      if (head === null) head = page.head;
      else if (page.head !== head) { consistent = false; break; }
      envelopes.push(...(page.envelopes ?? []));
      if (page.done || !page.nextCursor) done = true;
      else { after = page.nextCursor; await sleep(200); }
    }
    if (!consistent) continue;
    const result = await store.applySnapshot(envelopes, head);
    await api.ack(head);
    return result;
  }
  throw new Error("snapshot changed on every download attempt");
}

export async function pollOnce({ api, store, log = () => {} }) {
  const page = await api.changes(store.cursor);
  if (page.snapshotRequired) {
    const restored = await recoverSnapshot({ api, store });
    log(`snapshot restored at head ${restored.head}; entities=${restored.entityCount}`);
    return { cursor: store.cursor, head: restored.head, count: 0, hasMore: store.cursor < restored.head };
  }

  const entries = page.changes ?? [];
  const startCursor = store.cursor;
  let failure = null;
  for (const entry of entries) {
    if (entry.seq <= store.cursor) continue;
    try {
      const result = await store.applyChange(entry);
      if (result.quarantined) log(`seq ${entry.seq} ciphertext quarantined; decrypted view is incomplete`);
    } catch (error) { failure = error; break; }
  }
  // 페이지를 다 적용한 뒤 한 번만 ack 한다 — 변경마다 부르면 밀린 저널을
  // 따라잡는 동안 쓰기 레이트리밋(분당 120)에 그대로 걸린다.
  if (store.cursor > startCursor) await api.ack(store.cursor);

  if (failure instanceof SnapshotRequiredError) {
    const restored = await recoverSnapshot({ api, store });
    log(`snapshot restored at head ${restored.head}; entities=${restored.entityCount}`);
    return { cursor: store.cursor, head: restored.head, count: entries.length, hasMore: false };
  }
  if (failure) throw failure;
  return { cursor: store.cursor, head: page.head ?? store.cursor, count: entries.length, hasMore: Boolean(page.hasMore) };
}

export async function run(config = loadConfig(), { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const stamp = () => new Date().toISOString();
  const log = (...parts) => console.log(stamp(), ...parts);
  const api = createApi({ url: config.url, token: config.token, fetchImpl });
  const bootstrap = await api.bootstrap();
  const salt = bootstrap.salt ?? bootstrap.kdf?.salt;
  const iterations = bootstrap.iterations ?? bootstrap.kdf?.iterations;
  const key = await deriveKey(config.passphrase, salt, iterations);
  const store = createStore({ dir: config.dir, key });
  let backoff = 1_000;
  log(`Life sink started; dir=${config.dir}; cursor=${store.cursor}`);
  for (;;) {
    try {
      const result = await pollOnce({ api, store, log });
      backoff = 1_000;
      log(`cursor=${result.cursor}; head=${result.head}; received=${result.count ?? 0}`);
      await sleep(result.hasMore ? 500 : config.pollMs);
    } catch (error) {
      if (error instanceof WrongPassphraseError) throw error;
      log(`poll failed; retry=${backoff}ms; reason=${error.message}`);
      await sleep(backoff);
      backoff = nextBackoff(backoff);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Life sink stopped:", error.message);
    process.exitCode = 1;
  });
}
