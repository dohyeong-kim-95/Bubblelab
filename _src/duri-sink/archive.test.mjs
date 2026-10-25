import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createArchive } from "./archive.mjs";

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
    assert.deepEqual(createArchive(join(dir, "없음")).search({ terms: ["카페"], from: "2026-01-01", to: "2026-10-25" }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("백업 검색은 읽기 전용이다 — 모듈에 쓰기 API 가 없고, 검색해도 파일이 그대로다", () => {
  const src = readFileSync(new URL("archive.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /write|append|rename|unlink|rmSync|rmdir|mkdir|copyFile|truncate|chmod|createWriteStream/i);
  const dir = fixture();
  try {
    const f = join(dir, "timeline", "2026", "2026-09", "metadata.json");
    const before = readFileSync(f, "utf8");
    createArchive(dir, { skip }).search({ terms: ["카페"], from: "2026-01-01", to: "2026-10-25" });
    assert.equal(readFileSync(f, "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
