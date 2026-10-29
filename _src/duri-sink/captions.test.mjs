import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCaptioner, cleanCaption, readCaptions } from "./captions.mjs";
import { createArchive } from "./archive.mjs";

const at = (y, mo, d, h) => new Date(y, mo - 1, d, h).getTime();

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "duri-captions-"));
  const month = join(dir, "timeline", "2026", "2026-09");
  mkdirSync(join(month, "photos"), { recursive: true });
  for (const f of ["a_1.jpg", "b_2.jpg", "c_3.mp4"]) writeFileSync(join(month, "photos", f), "x");
  writeFileSync(join(month, "metadata.json"), JSON.stringify({ month: "2026-09", logs: [
    { seq: 1, type: "photo", at: at(2026, 9, 12, 15), name: "도경", photo: { file: "a_1.jpg" } },
    { seq: 2, type: "photo", at: at(2026, 9, 20, 15), name: "민지", photo: { file: "b_2.jpg", mime: "image/jpeg" } },
    { seq: 3, type: "photo", at: at(2026, 9, 21, 15), name: "민지", photo: { file: "c_3.mp4", mime: "video/mp4" } },
  ] }));
  return dir;
}

test("사진 설명: 최근 사진부터 한 장씩, 동영상은 건너뛰고, 다 달면 false", async () => {
  const dir = fixture();
  try {
    const archive = createArchive(dir);
    const seen = [];
    const c = createCaptioner({ dir, list: () => archive.photoFiles(), now: () => 5,
      see: async (m) => { seen.push(m[0].content[0].image_url.url.slice(0, 23)); return { desc: "바닷가 모래사장", tags: ["바다", "바다", "해변"] }; } });
    assert.equal(c.left(), 2);
    assert.equal(await c.step(), true);
    assert.deepEqual(readCaptions(dir), { "b_2.jpg": { desc: "바닷가 모래사장", tags: ["바다", "해변"], at: 5 } });
    assert.equal(await c.step(), true);
    assert.equal(await c.step(), false);
    assert.deepEqual(seen, ["data:image/jpeg;base64,", "data:image/jpeg;base64,"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("사진 설명: 실패는 세 번까지만 다시 해 본다", async () => {
  const dir = fixture();
  try {
    const archive = createArchive(dir);
    const c = createCaptioner({ dir, list: () => archive.photoFiles(), see: async () => { throw new Error("타임아웃"); } });
    let n = 0;
    while (await c.step()) n++;
    assert.equal(n, 6);
    assert.equal(readCaptions(dir)["a_1.jpg"].fails, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("사진 설명: 모델 답을 다듬는다 — 빈 설명은 실패, 낱말은 8개까지", () => {
  assert.equal(cleanCaption({ desc: " ", tags: ["a"] }), null);
  assert.equal(cleanCaption(null), null);
  assert.deepEqual(cleanCaption({ desc: "케이크\n 두 조각", tags: "x" }), { desc: "케이크 두 조각", tags: [] });
  assert.equal(cleanCaption({ desc: "d", tags: Array.from({ length: 12 }, (_, i) => `t${i}`) }).tags.length, 8);
});

test("백업 검색: 달아 둔 사진 설명으로 사진·날을 찾는다(나중에 달려도 다시 읽는다)", () => {
  const dir = fixture();
  try {
    const archive = createArchive(dir);
    const q = { terms: ["바다"], from: "2026-01-01", to: "2026-12-31" };
    assert.deepEqual(archive.photos(q), []);
    writeFileSync(join(dir, "captions.json"), JSON.stringify({ "a_1.jpg": { desc: "모래사장과 파도", tags: ["바다", "해변"] }, "b_2.jpg": { fails: 1 } }));
    assert.deepEqual(archive.photos(q).map((p) => p.seq), [1]);
    assert.deepEqual(archive.hitDates({ terms: ["파도"], from: "2026-01-01", to: "2026-12-31" }), ["2026-09-12"]);
    assert.deepEqual(archive.photos({ ...q, terms: ["해변"] })[0].desc, "모래사장과 파도");
    assert.match(archive.search({ terms: ["파도"], from: "2026-01-01", to: "2026-12-31" })[0], /🖼️ 사진 \[모래사장과 파도\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("한 글자 낱말은 따로 떨어진 말일 때만 맞는다 — '회' 가 회식·교회·회색에 걸리지 않게", async () => {
  const { hasWord, wordVariants } = await import("./archive.mjs");
  const v = wordVariants("회");
  for (const t of ["회를 먹었다", "얼음 위에 담긴 회와 소스", "회,회 접시"]) assert.equal(hasWord(t, v), true, t);
  for (const t of ["난제회식", "교회50주년", "회색 고양이", "나 회사 가기 싫어"]) assert.equal(hasWord(t, v), false, t);
  assert.equal(hasWord("제주도 여행", wordVariants("제주")), true);
});

test("사진 설명: 모델 서버가 자는 중이면 실패로 세지 않고 깨면 다시 본다", async () => {
  const dir = fixture();
  try {
    const archive = createArchive(dir);
    let asleep = true;
    const c = createCaptioner({ dir, list: () => archive.photoFiles(),
      see: async () => { if (asleep) throw Object.assign(new Error("꺼짐"), { asleep: true }); return { desc: "바다" }; } });
    for (let i = 0; i < 5; i++) assert.equal(await c.step(), false);
    assert.deepEqual(readCaptions(dir), {});
    assert.equal(c.left(), 2);
    asleep = false;
    assert.equal(await c.step(), true);
    assert.equal(readCaptions(dir)["b_2.jpg"].desc, "바다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
