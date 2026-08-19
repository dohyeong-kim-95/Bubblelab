import test from "node:test";
import assert from "node:assert/strict";

const { FORMAT, PREFIX, fileName, isOurs, makeEnvelope, parseEnvelope, summarize } =
  await import("../life/backup/store.js");

const AT = new Date("2026-08-19T02:00:00.000Z");

test("우리 저장소는 접두사로 가린다 — 도구 목록을 두지 않는 이유다", () => {
  assert.equal(isOurs("bl_life_v1"), true);
  assert.equal(isOurs("bl_뭐든_새_도구"), true, "새 도구는 등록 없이 포함된다");
  for (const other of ["theme", "other_bl_x", "", null, 5]) assert.equal(isOurs(other), false);
});

test("봉투에는 우리 것만 담는다", () => {
  const envelope = makeEnvelope({
    local: { bl_life_v1: "{}", bl_pushup_v1: "{}", analytics: "남의 것" },
    databases: [{ name: "bl_library", stores: [] }, { name: "other_db", stores: [] }],
  }, AT);
  assert.deepEqual(Object.keys(envelope.local), ["bl_life_v1", "bl_pushup_v1"]);
  assert.deepEqual(envelope.databases.map((d) => d.name), ["bl_library"]);
  assert.equal(envelope.exportedAt, AT.toISOString());
  assert.equal(envelope.format, FORMAT);
});

test("도구를 지워도 그 도구가 남긴 기록은 백업된다", () => {
  // 코드가 사라졌다고 기록까지 잃으면 안 된다. 접두사만 맞으면 담긴다.
  const envelope = makeEnvelope({ local: { bl_사라진도구: "{\"a\":1}" }, databases: [] }, AT);
  assert.equal(envelope.local.bl_사라진도구, "{\"a\":1}");
});

test("남의 파일과 옛 형식은 거절한다", () => {
  assert.throws(() => parseEnvelope("{"), /JSON/);
  assert.throws(() => parseEnvelope(JSON.stringify({ app: "other" })), /LIFE 백업/);
  assert.throws(() => parseEnvelope(JSON.stringify({ app: "life", format: 99 })), /형식/);
});

test("가져올 때도 우리 것만 되돌린다 — 남의 키를 덮어쓰지 않는다", () => {
  const parsed = parseEnvelope(JSON.stringify({
    app: "life", format: FORMAT, exportedAt: AT.toISOString(),
    local: { bl_life_v1: "{}", 남의키: "건드리면 안 됨", bl_이상한값: { not: "string" } },
    databases: [{ name: "bl_library", stores: [] }, { name: "남의DB", stores: [] }, { name: "bl_깨진것" }],
  }));
  assert.deepEqual(Object.keys(parsed.local), ["bl_life_v1"]);
  assert.deepEqual(parsed.databases.map((d) => d.name), ["bl_library"]);
});

test("무엇이 몇 개 들어 있는지 도구 이름을 몰라도 센다", () => {
  const envelope = makeEnvelope({
    local: { bl_life_v1: "{}" },
    databases: [{ name: "bl_library", stores: [{ name: "books", rows: [1, 2, 3] }, { name: "x", rows: [] }] }],
  }, AT);
  assert.deepEqual(summarize(envelope), [
    { name: "bl_library", kind: "기록", count: 3 },
    { name: "bl_life_v1", kind: "설정·목록", count: null },
  ]);
});

test("파일 이름에 KST 날짜가 들어간다", () => {
  assert.equal(fileName(new Date("2026-08-18T15:00:00Z")), "life-backup-2026-08-19.json");
  assert.equal(fileName(new Date("2026-08-18T14:59:59Z")), "life-backup-2026-08-18.json");
});

test("접두사는 한 곳에만 있다", () => {
  assert.equal(PREFIX, "bl_");
});
