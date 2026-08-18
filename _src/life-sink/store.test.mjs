import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStore, deriveKey, SnapshotRequiredError, validateCurrentExport, WrongPassphraseError,
} from "./store.mjs";
import { nextBackoff, pollOnce, recoverSnapshot } from "./life-sink.mjs";

const encoder = new TextEncoder();
const salt = Buffer.from("life-test-salt-with-enough-bytes").toString("base64url");

async function encryptionKey(passphrase = "correct horse battery staple") {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(salt, "base64url"), iterations: 1 },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
}

async function frame(seq, entity, { passphrase = "correct horse battery staple", deleted = false } = {}) {
  const key = await encryptionKey(passphrase);
  const nextRev = seq;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`life:v1:${entity.id}:${nextRev}:${deleted}`);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, encoder.encode(JSON.stringify(entity)));
  return {
    seq, mutationId: crypto.randomUUID(), envelope: {
      entityId: entity.id, baseRev: nextRev - 1, nextRev, deleted, schema: 1,
      iv: Buffer.from(iv).toString("base64url"), ct: Buffer.from(ct).toString("base64url"),
    },
  };
}

const entity = (id, overrides = {}) => ({
  schemaVersion: 1, id, kind: "daily-action", title: `할 일 ${id.slice(0, 4)}`,
  date: "2026-08-17", status: "active", createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z", completedAt: null, deletedAt: null, ...overrides,
});

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "life-sink-"));
  const key = await deriveKey("correct horse battery staple", salt, 1);
  return { dir, key, store: createStore({ dir, key, warn: () => {} }) };
}

const readCurrent = (dir) => JSON.parse(readFileSync(join(dir, "views/current.json"), "utf8"));

test("journal is canonical, exact-once, and precedes view/cursor", async () => {
  const fx = await fixture();
  try {
    const change = await frame(1, entity("11111111-1111-4111-8111-111111111111"));
    await fx.store.applyChange(change);
    await fx.store.applyChange(change);
    const lines = readFileSync(join(fx.dir, "archive/journal", `${new Date().toISOString().slice(0, 7)}.ndjson`), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), change);
    assert.equal(fx.store.cursor, 1);
    assert.equal(readCurrent(fx.dir).entities[0].id, change.envelope.entityId);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("gap requires a snapshot and archive failure cannot advance cursor", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(fx.store.applyChange(await frame(2, entity("22222222-2222-4222-8222-222222222222"))), SnapshotRequiredError);
    assert.equal(fx.store.cursor, 0);
    rmSync(join(fx.dir, "archive/journal"), { recursive: true });
    writeFileSync(join(fx.dir, "archive/journal"), "not a directory");
    await assert.rejects(fx.store.applyChange(await frame(1, entity("22222222-2222-4222-8222-222222222222"))));
    assert.equal(fx.store.cursor, 0);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("rolled-back cursor cannot replay over a newer current view", async () => {
  const fx = await fixture();
  try {
    await fx.store.applyChange(await frame(1, entity("23232323-2323-4232-8232-232323232323")));
    writeFileSync(join(fx.dir, "state/cursor.json"), JSON.stringify({ seq: 0 }));
    const rolledBack = createStore({ dir: fx.dir, key: fx.key, warn: () => {} });
    await assert.rejects(
      rolledBack.applyChange(await frame(1, entity("23232323-2323-4232-8232-232323232323"))),
      SnapshotRequiredError,
    );
    assert.equal(rolledBack.current.head, 1);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("decrypt failures 1-9 preserve ciphertext and advance; tenth halts", async () => {
  const fx = await fixture();
  try {
    for (let seq = 1; seq <= 9; seq += 1) {
      const change = await frame(seq, entity(`${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`), { passphrase: "wrong" });
      const result = await fx.store.applyChange(change);
      assert.equal(result.quarantined, true);
      assert.equal(result.ack, true);
      const quarantined = JSON.parse(readFileSync(join(fx.dir, "quarantine", `${String(seq).padStart(12, "0")}.json`), "utf8"));
      assert.equal(quarantined.change.envelope.ct, change.envelope.ct);
    }
    const tenth = await frame(10, entity("00000010-1111-4111-8111-111111111111"), { passphrase: "wrong" });
    await assert.rejects(fx.store.applyChange(tenth), WrongPassphraseError);
    assert.equal(fx.store.cursor, 9);
    assert.equal(readCurrent(fx.dir).incomplete, true);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("삭제된 항목은 현재 보기에서 빠지고 날짜·생성순으로 정렬된다", async () => {
  const fx = await fixture();
  try {
    const older = entity("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { date: "2026-08-16", createdAt: "2026-08-16T01:00:00.000Z" });
    const newer = entity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { date: "2026-08-17", createdAt: "2026-08-17T01:00:00.000Z" });
    const doomed = entity("cccccccc-cccc-4ccc-8ccc-cccccccccccc", { date: "2026-08-17", createdAt: "2026-08-17T02:00:00.000Z" });
    await fx.store.applyChange(await frame(1, newer));
    await fx.store.applyChange(await frame(2, doomed));
    await fx.store.applyChange(await frame(3, older));
    assert.deepEqual(readCurrent(fx.dir).entities.map((item) => item.id), [older.id, newer.id, doomed.id]);

    const removed = { ...doomed, deletedAt: "2026-08-17T03:00:00.000Z" };
    await fx.store.applyChange(await frame(4, removed, { deleted: true }));
    assert.deepEqual(readCurrent(fx.dir).entities.map((item) => item.id), [older.id, newer.id]);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("스냅샷은 암호문을 먼저 보관한 뒤 현재 보기와 커서를 세운다", async () => {
  const fx = await fixture();
  try {
    const alive = await frame(4, entity("dddddddd-dddd-4ddd-8ddd-dddddddddddd"));
    const gone = await frame(5, { ...entity("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"), deletedAt: "2026-08-17T04:00:00.000Z" }, { deleted: true });
    const result = await fx.store.applySnapshot([alive.envelope, gone.envelope], 5);
    assert.deepEqual(result, { head: 5, entityCount: 1, incomplete: false, ack: true });
    assert.equal(fx.store.cursor, 5);
    assert.deepEqual(readCurrent(fx.dir).entities.map((item) => item.id), [alive.envelope.entityId]);
    const archived = JSON.parse(readFileSync(join(fx.dir, "archive/snapshots/000000000005.json"), "utf8"));
    assert.equal(archived.envelopes.length, 2, "복호화 못 한 것까지 암호문 그대로 남는다");
    assert.equal(archived.envelopes[0].ct, alive.envelope.ct);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("스냅샷을 받는 도중 head 가 바뀌면 처음부터 다시 받는다", async () => {
  const fx = await fixture();
  try {
    const first = await frame(6, entity("ffffffff-ffff-4fff-8fff-ffffffffffff"));
    const second = await frame(7, entity("12121212-1212-4212-8212-121212121212"));
    const acked = [];
    let attempt = 0;
    const api = {
      // 1회차: 두 번째 페이지에서 head 가 6→7 로 바뀐다(그 사이 커밋이 있었다).
      snapshot: async (after) => {
        if (attempt === 0 && !after) { attempt = 1; return { head: 6, envelopes: [first.envelope], nextCursor: "cursor-1", done: false }; }
        if (attempt === 1) { attempt = 2; return { head: 7, envelopes: [second.envelope], nextCursor: null, done: true }; }
        return { head: 7, envelopes: [first.envelope, second.envelope], nextCursor: null, done: true };
      },
      ack: async (seq) => acked.push(seq),
    };
    const result = await recoverSnapshot({ api, store: fx.store, sleep: async () => {} });
    assert.equal(result.head, 7);
    assert.equal(result.entityCount, 2);
    assert.deepEqual(acked, [7]);
    assert.equal(fx.store.cursor, 7);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("empty/lower current import cannot replace newer data; generic export validates", async () => {
  const fx = await fixture();
  try {
    await fx.store.applyChange(await frame(1, entity("88888888-8888-4888-8888-888888888888")));
    const exported = readCurrent(fx.dir);
    assert.equal(validateCurrentExport(exported), exported);
    assert.throws(() => fx.store.importCurrent({ protocol: 1, head: 1, entities: [] }), /replace/);
    assert.equal(fx.store.current.entities.length, 1);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("storage permissions are private where mode bits are supported", async () => {
  const fx = await fixture();
  try {
    await fx.store.applyChange(await frame(1, entity("99999999-9999-4999-8999-999999999999")));
    assert.equal(statSync(fx.dir).mode & 0o777, 0o700);
    assert.equal(statSync(join(fx.dir, "views/current.json")).mode & 0o777, 0o600);
    chmodSync(fx.dir, 0o700);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("한 페이지를 다 적용한 뒤 ack 는 한 번만 부른다", async () => {
  const fx = await fixture();
  try {
    const changes = [];
    for (let seq = 1; seq <= 5; seq += 1) {
      changes.push(await frame(seq, entity(`${String(seq).padStart(8, "0")}-2222-4222-8222-222222222222`)));
    }
    const calls = [];
    const api = {
      changes: async (after) => { calls.push(`changes:${after}`); return { changes, cursor: 5, head: 5, hasMore: false }; },
      ack: async (seq) => { calls.push(`ack:${seq}`); },
    };
    const result = await pollOnce({ api, store: fx.store });
    // 변경마다 ack 하면 밀린 저널을 따라잡는 동안 분당 120 쓰기 한도에 걸린다.
    assert.deepEqual(calls, ["changes:0", "ack:5"]);
    assert.equal(result.cursor, 5);
    assert.equal(fx.store.current.entities.length, 5);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("잘린 저널을 만나면 스냅샷으로 복구한다", async () => {
  const fx = await fixture();
  try {
    const survivor = await frame(9, entity("34343434-3434-4434-8434-343434343434"));
    const acked = [];
    const api = {
      changes: async () => ({ snapshotRequired: true, head: 9, oldestSeq: 8 }),
      snapshot: async () => ({ head: 9, envelopes: [survivor.envelope], nextCursor: null, done: true }),
      ack: async (seq) => acked.push(seq),
    };
    const result = await pollOnce({ api, store: fx.store });
    assert.equal(result.head, 9);
    assert.equal(fx.store.cursor, 9);
    assert.deepEqual(acked, [9]);
    assert.equal(existsSync(join(fx.dir, "archive/snapshots/000000000009.json")), true);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("poll backoff doubles and caps at five minutes", () => {
  assert.equal(nextBackoff(1_000), 2_000);
  assert.equal(nextBackoff(256_000), 300_000);
  assert.equal(nextBackoff(300_000), 300_000);
});
