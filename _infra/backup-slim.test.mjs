import test from "node:test";
import assert from "node:assert/strict";

const { BLOB_MIN, makeEnvelope, slimEnvelope, withoutBlobs } =
  await import("../life/backup/store.js");

const bigCover = `data:image/jpeg;base64,${"A".repeat(BLOB_MIN)}`;

test("큰 data: 이미지는 빼고 나머지는 그대로 둔다", () => {
  assert.equal(withoutBlobs(bigCover), null);
  assert.equal(withoutBlobs("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA",
    "아이콘만 한 것은 굳이 뺄 이유가 없다");
  assert.equal(withoutBlobs("보통 글자"), "보통 글자");
  assert.deepEqual(withoutBlobs({ a: [1, { cover: bigCover, title: "책" }] }),
    { a: [1, { cover: null, title: "책" }] });
});

test("도구 이름을 몰라도 이미지가 빠진다 — 새 도구도 자동이다", () => {
  const envelope = makeEnvelope({
    local: { bl_새도구: JSON.stringify({ 사진: bigCover, 메모: "남는다" }) },
    databases: [{ name: "bl_library", stores: [{ name: "books", rows: [{ title: "책", cover: bigCover }] }] }],
  }, new Date("2026-08-19T00:00:00Z"));

  const slim = slimEnvelope(envelope);
  assert.deepEqual(JSON.parse(slim.local.bl_새도구), { 사진: null, 메모: "남는다" });
  assert.equal(slim.databases[0].stores[0].rows[0].cover, null);
  assert.equal(slim.databases[0].stores[0].rows[0].title, "책");
  // 원본은 건드리지 않는다 — 파일 내보내기에는 표지가 그대로 들어간다.
  assert.equal(JSON.parse(envelope.local.bl_새도구).사진, bigCover);
});

test("열리지 않는 값은 그대로 둔다", () => {
  const envelope = makeEnvelope({ local: { bl_x: "JSON 아님" }, databases: [] });
  assert.equal(slimEnvelope(envelope).local.bl_x, "JSON 아님");
});
