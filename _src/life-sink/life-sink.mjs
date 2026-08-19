#!/usr/bin/env node
// LIFE 백업을 집 PC 로 받아 두는 데몬. 폰이 하루 한 번 서버에 올리면 이 쪽이
// 받아서 날짜별 파일로 쌓는다. 서버에는 늘 최신 한 덩어리만 있으므로, 지난 것을
// 갖는 건 여기뿐이다.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const NORMAL_POLL_MS = 60 * 60 * 1000;   // 하루 한 번 올라오니 한 시간이면 넉넉하다
export const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const nextBackoff = (current) => Math.min(Math.max(60_000, current * 2), MAX_BACKOFF_MS);

function loadConfig() {
  let file = {};
  const path = join(HERE, "life-sink.config.json");
  if (existsSync(path)) file = JSON.parse(readFileSync(path, "utf8"));
  const config = {
    url: (process.env.LIFE_URL || file.url || "https://life.bubblelab.dev").replace(/\/+$/, ""),
    token: process.env.LIFE_TOKEN || file.token,
    dir: process.env.LIFE_DIR || file.dir || join(process.env.HOME ?? HERE, "life-sink"),
    pollMs: Number(process.env.LIFE_POLL_MS || file.pollMs || NORMAL_POLL_MS),
  };
  if (!config.token) throw new Error("missing config: token (앱의 백업 화면에서 발급받는다)");
  if (!Number.isFinite(config.pollMs) || config.pollMs < 60_000) throw new Error("pollMs must be at least 60000");
  return config;
}

export function createApi({ url, token, fetchImpl = fetch }) {
  return {
    async fetchBackup(etag) {
      const response = await fetchImpl(`${url}/_life/backup`, {
        headers: { Authorization: `Bearer ${token}`, ...(etag ? { "If-None-Match": etag } : {}) },
      });
      if (response.status === 304) return { unchanged: true };
      if (response.status === 404) return { missing: true };
      if (!response.ok) {
        const error = new Error(`GET /_life/backup: HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return { text: await response.text(), etag: response.headers.get("ETag") };
    },
  };
}

export async function pullOnce({ api, store, log = () => {} }) {
  const result = await api.fetchBackup(store.etag);
  if (result.unchanged) return { unchanged: true };
  if (result.missing) { log("서버에 아직 백업이 없다"); return { missing: true }; }
  const { path, dropped } = store.save(result.text, result.etag);
  log(`저장: ${path}${dropped.length ? ` (오래된 ${dropped.length}개 정리)` : ""}`);
  return { saved: path };
}

export async function run(config = loadConfig(), { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const log = (...parts) => console.log(new Date().toISOString(), ...parts);
  const api = createApi({ url: config.url, token: config.token, fetchImpl });
  const store = createStore({ dir: config.dir });
  let backoff = 60_000;
  log(`Life sink started; dir=${config.dir}`);
  for (;;) {
    try {
      await pullOnce({ api, store, log });
      backoff = 60_000;
      await sleep(config.pollMs);
    } catch (error) {
      log(`실패; ${Math.round(backoff / 1000)}초 뒤 재시도; ${error.message}`);
      await sleep(backoff);
      backoff = nextBackoff(backoff);
    }
  }
}

/** cron 이 한 시간에 한 번 부르는 방식. 상주하지 않아 잊고 지낼 수 있다. */
export async function once(config = loadConfig(), { fetchImpl = fetch } = {}) {
  const log = (...parts) => console.log(new Date().toISOString(), ...parts);
  const api = createApi({ url: config.url, token: config.token, fetchImpl });
  return pullOnce({ api, store: createStore({ dir: config.dir }), log });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const single = process.argv.includes("--once");
  (single ? once() : run()).catch((error) => {
    console.error("Life sink stopped:", error.message);
    process.exitCode = 1;
  });
}
