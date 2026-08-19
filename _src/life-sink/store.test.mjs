import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP, createStore, fileNameFor, kstDate, prune, validateBackup } from "./store.mjs";
import { nextBackoff, pullOnce } from "./life-sink.mjs";

const backup = (extra = {}) => JSON.stringify({
  app: "life", format: 1, exportedAt: "2026-08-19T00:00:00Z",
  local: { bl_life_v1: "{}" }, databases: [], ...extra,
});
const fixture = () => mkdtempSync(join(tmpdir(), "life-sink-"));

test("파일 이름은 KST 날짜다", () => {
  assert.equal(kstDate(new Date("2026-08-18T14:59:59Z")), "2026-08-18");
  assert.equal(fileNameFor(new Date("2026-08-18T15:00:00Z")), "life-backup-2026-08-19.json");
});

test("백업이 아니면 쓰지 않는다 — 게이트가 로그인 HTML 을 줄 수도 있다", () => {
  assert.throws(() => validateBackup("<!doctype html>"), /JSON/);
  assert.throws(() => validateBackup(JSON.stringify({ app: "other" })), /LIFE 백업/);
  assert.throws(() => validateBackup(JSON.stringify({ app: "life", local: {}, databases: [] })), /빈 백업/);
  assert.equal(validateBackup(backup()).app, "life");
});

test("받은 것을 그날 파일로 남기고 상태를 적는다", () => {
  const dir = fixture();
  try {
    const store = createStore({ dir, now: () => new Date("2026-08-19T01:00:00Z") });
    assert.equal(store.etag, null);
    const { path } = store.save(backup(), '"abc"');
    assert.equal(path, join(dir, "life-backup-2026-08-19.json"));
    assert.equal(JSON.parse(readFileSync(path, "utf8")).app, "life");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    // 다시 열면 etag 를 기억한다 — 안 바뀌었으면 받지 않는다.
    assert.equal(createStore({ dir }).etag, '"abc"');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("오래된 것부터 정리하고 최근 것만 남긴다", () => {
  const dir = fixture();
  try {
    for (let day = 1; day <= KEEP + 5; day += 1) {
      writeFileSync(join(dir, `life-backup-2026-01-${String(day).padStart(2, "0")}.json`), "{}");
    }
    writeFileSync(join(dir, "state.json"), "{}");
    const dropped = prune(dir);
    assert.equal(dropped.length, 5);
    assert.equal(dropped[0], "life-backup-2026-01-01.json");
    const left = readdirSync(dir).filter((name) => name.startsWith("life-backup-"));
    assert.equal(left.length, KEEP);
    assert.ok(readdirSync(dir).includes("state.json"), "상태 파일은 건드리지 않는다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("안 바뀌었으면 아무것도 쓰지 않는다", async () => {
  const dir = fixture();
  try {
    const store = createStore({ dir });
    const api = { fetchBackup: async (etag) => { assert.equal(etag, null); return { unchanged: true }; } };
    assert.deepEqual(await pullOnce({ api, store }), { unchanged: true });
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith("life-backup-")), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("서버에 아직 백업이 없으면 조용히 넘어간다", async () => {
  const dir = fixture();
  try {
    const api = { fetchBackup: async () => ({ missing: true }) };
    assert.deepEqual(await pullOnce({ api, store: createStore({ dir }) }), { missing: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("재시도 간격은 두 배씩, 여섯 시간에서 멈춘다", () => {
  assert.equal(nextBackoff(60_000), 120_000);
  assert.equal(nextBackoff(4 * 60 * 60 * 1000), 6 * 60 * 60 * 1000);
  assert.equal(nextBackoff(6 * 60 * 60 * 1000), 6 * 60 * 60 * 1000);
});
