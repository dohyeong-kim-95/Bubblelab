import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createArchive } from "./archive.mjs";
import { createPlaces } from "./places.mjs";

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime(); // 로컬 시각

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "duri-archive-"));
  const put = (month, logs) => {
    mkdirSync(join(dir, "timeline", month.slice(0, 4), month), { recursive: true });
    writeFileSync(join(dir, "timeline", month.slice(0, 4), month, "metadata.json"), JSON.stringify({ month, logs }));
  };
  put("2026-09", [
    { seq: 1, type: "message", at: at(2026, 9, 12, 13), name: "도경", text: "성수동 카페 어니언 가자" },
    { seq: 2, type: "message", at: at(2026, 9, 12, 13, 5), name: "민지", text: "좋아 거기 빵 맛있대" },
    { seq: 3, type: "sticker", at: at(2026, 9, 12, 13, 6), name: "민지", sticker: { pack: "x", n: 1 } },
    { seq: 4, type: "photo", at: at(2026, 9, 12, 15), name: "도경", photo: { file: "a.jpg", caption: "어니언 소금빵" } },
  ]);
  put("2026-10", [
    { seq: 10, type: "message", at: at(2026, 10, 24, 20), name: "민지", text: "내일 뭐 먹을까" },
    { seq: 11, type: "message", at: at(2026, 10, 24, 20, 1), name: "도경", text: "@당 이번 주 일정" },
    { seq: 12, type: "message", at: at(2026, 10, 24, 20, 1), name: "🤖 당이", text: "📅 일정 0개", sys: true },
    { seq: 13, type: "message", at: at(2026, 10, 25, 9), name: "도경", text: "카페 말고 국밥" },
  ]);
  return dir;
}
const skip = (name, text) => name === "🤖 당이" || /^\s*@당/.test(text);

test("백업 검색: 낱말이 맞는 줄과 앞뒤 한 줄을 시간순으로, 당이·명령·이모티콘은 뺀다", () => {
  const dir = fixture();
  try {
    const a = createArchive(dir, { skip });
    const hits = a.search({ terms: ["카페", "어니언"], from: "2023-01-01", to: "2026-10-25" });
    assert.deepEqual(hits, [
      "9/12 (토) 13:00 도경: 성수동 카페 어니언 가자",
      "9/12 (토) 13:05 민지: 좋아 거기 빵 맛있대",
      "9/12 (토) 15:00 도경: 🖼️ 사진 \"어니언 소금빵\"",
      "10/24 (토) 20:00 민지: 내일 뭐 먹을까",
      "10/25 (일) 09:00 도경: 카페 말고 국밥",
    ]);
    // 기간만(낱말 없음): 그 기간의 줄
    assert.deepEqual(a.search({ terms: [], from: "2026-10-24", to: "2026-10-25" }),
      ["10/24 (토) 20:00 민지: 내일 뭐 먹을까", "10/25 (일) 09:00 도경: 카페 말고 국밥"]);
    assert.deepEqual(a.search({ terms: ["없는말"], from: "2026-01-01", to: "2026-10-25" }), []);
    assert.equal(a.search({ terms: ["어니언에서"], from: "2026-01-01", to: "2026-10-25" }).length, 4); // 조사를 떼고도 찾는다(두 줄 + 앞뒤)
    assert.deepEqual(a.hitDates({ terms: ["카페"], from: "2026-01-01", to: "2026-10-25" }), ["2026-10-25", "2026-09-12"]); // 최근 먼저(같은 점수)
    assert.deepEqual(a.hitDates({ terms: ["카페", "어니언"], from: "2026-01-01", to: "2026-10-25" })[0], "2026-09-12"); // 많이 맞는 날 먼저
    assert.deepEqual(a.hitDates({ terms: [], from: "2026-01-01", to: "2026-10-25" }), []);
    assert.deepEqual(createArchive(join(dir, "없음")).search({ terms: ["카페"], from: "2026-01-01", to: "2026-10-25" }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("백업 검색은 읽기 전용이다 — 모듈(장소 포함)에 쓰기 API 가 없고, 검색해도 파일이 그대로다", () => {
  for (const f of ["archive.mjs", "places.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /write|append|rename|unlink|rmSync|rmdir|mkdir|copyFile|truncate|chmod|createWriteStream/i, f);
  }
  const dir = fixture();
  try {
    const f = join(dir, "timeline", "2026", "2026-09", "metadata.json");
    const before = readFileSync(f, "utf8");
    createArchive(dir, { skip }).search({ terms: ["카페"], from: "2026-01-01", to: "2026-10-25" });
    assert.equal(readFileSync(f, "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("장소: 사진 좌표는 앱 지도와 같은 geojson 으로 시군구(한국)·나라 이름이 된다", () => {
  const place = createPlaces();
  assert.equal(place(37.5446, 127.0557), "서울특별시 성동구"); // 성수동
  assert.equal(place(33.4996, 126.5312), "제주특별자치도 제주시");
  assert.equal(place(35.6812, 139.7671), "일본");
  assert.equal(place(0, -140), null); // 바다
  assert.equal(place(NaN, 127), null);
  assert.equal(createPlaces([join(tmpdir(), "duri-places-없음")])(37.5446, 127.0557), null); // 파일 없으면 이름 없이
});

test("장소: 사진 줄에 찍은 곳이 붙고, day() 는 그날 사진 수와 장소를 준다", () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-archive-"));
  try {
    mkdirSync(join(dir, "timeline", "2025", "2025-10"), { recursive: true });
    writeFileSync(join(dir, "timeline", "2025", "2025-10", "metadata.json"), JSON.stringify({ month: "2025-10", logs: [
      { seq: 1, type: "photo", at: at(2025, 10, 27, 12), name: "도경", photo: { file: "a.jpg" }, loc: { lat: 33.4996, lng: 126.5312 } },
      { seq: 2, type: "photo", at: at(2025, 10, 27, 13), name: "민지", photo: { file: "b.jpg" }, loc: { lat: 33.5, lng: 126.53 } },
      { seq: 3, type: "photo", at: at(2025, 10, 27, 18), name: "민지", photo: { file: "c.jpg" } },
      { seq: 4, type: "location", at: at(2025, 10, 28, 9), name: "도경", loc: { lat: 37.5446, lng: 127.0557 } },
    ] }));
    const a = createArchive(dir, { skip, place: createPlaces() });
    assert.deepEqual(a.search({ terms: ["제주"], from: "2025-10-01", to: "2025-10-31" }), [
      "10/27 (월) 12:00 도경: 🖼️ 사진 📍제주특별자치도 제주시",
      "10/27 (월) 13:00 민지: 🖼️ 사진 📍제주특별자치도 제주시",
      "10/27 (월) 18:00 민지: 🖼️ 사진",
    ]);
    assert.deepEqual(a.search({ terms: ["성동"], from: "2025-10-01", to: "2025-10-31" }).at(-1), "10/28 (화) 09:00 도경: 📍 위치 공유 — 서울특별시 성동구");
    assert.deepEqual(a.day("2025-10-27"), { photos: 3, places: ["제주특별자치도 제주시"] });
    assert.deepEqual(a.day("2025-10-26"), { photos: 0, places: [] });
    assert.deepEqual(createArchive(dir, { skip }).day("2025-10-27"), { photos: 3, places: [] }); // place 없으면 장소 없이
    // photos(): 찍은 곳·캡션으로 고른 사진의 seq(시간순), 낱말이 없으면 기간의 전부
    assert.deepEqual(a.photos({ terms: ["제주시"], from: "2025-10-01", to: "2025-10-31" }).map((p) => p.seq), [1, 2]);
    assert.deepEqual(a.photos({ terms: [], from: "2025-10-27", to: "2025-10-27" }).map((p) => [p.seq, p.where]),
      [[1, "제주특별자치도 제주시"], [2, "제주특별자치도 제주시"], [3, null]]);
    assert.deepEqual(a.photos({ terms: ["서울"], from: "2025-10-01", to: "2025-10-31" }), []); // 위치 공유는 사진이 아니다
    // photoFile(): 옛 사진을 빌려줄 원본 위치(읽지는 않는다)
    assert.deepEqual(a.photoFile(2), { path: join(dir, "timeline", "2025", "2025-10", "photos", "b.jpg"), mime: null });
    assert.equal(a.photoFile(4), null); // 위치 공유
    assert.equal(a.photoFile(999), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
