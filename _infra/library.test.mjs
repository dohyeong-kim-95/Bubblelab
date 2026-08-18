import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  COVER_MAX_BYTES, NOTE_MAX, TITLE_MAX, groupByYear, kstDate, makeBook, normalizeBook,
  sortBooks, validateBook,
} = await import("../life/library/store.js");

const AT = new Date("2026-08-19T02:00:00.000Z");
const book = (fields) => normalizeBook(makeBook({ title: "제목", note: "좋았다", ...fields }, AT));

test("읽은 날은 KST 자정 기준이다", () => {
  assert.equal(kstDate(new Date("2026-08-18T14:59:59Z")), "2026-08-18");
  assert.equal(kstDate(new Date("2026-08-18T15:00:00Z")), "2026-08-19");
});

test("제목과 한두 줄이 있어야 기록이 된다 — 그게 읽었다는 증거다", () => {
  assert.deepEqual(validateBook(book({})), []);
  assert.match(validateBook(book({ title: "   " })).join(" "), /제목/);
  assert.match(validateBook(book({ note: "" })).join(" "), /한두 줄/);
  assert.match(validateBook({ ...book({}), readOn: "2026-8-1" }).join(" "), /날짜/);
});

test("긴 입력은 잘라 담는다", () => {
  const long = normalizeBook(makeBook({
    title: "가".repeat(TITLE_MAX + 50), note: "나".repeat(NOTE_MAX + 50), author: "다".repeat(200),
  }, AT));
  assert.equal(long.title.length, TITLE_MAX);
  assert.equal(long.note.length, NOTE_MAX);
  assert.deepEqual(validateBook(long), []);
});

test("표지는 data: 이미지만 받는다", () => {
  assert.equal(normalizeBook(makeBook({ cover: "https://example.com/x.png" }, AT)).cover, null,
    "외부 주소는 버린다 — CSP 가 막을 뿐 아니라 기록이 남의 서버에 매달리게 된다");
  assert.equal(normalizeBook(makeBook({ cover: "javascript:alert(1)" }, AT)).cover, null);
  const ok = book({ cover: "data:image/jpeg;base64,AAAA" });
  assert.equal(ok.cover, "data:image/jpeg;base64,AAAA");
  assert.deepEqual(validateBook(ok), []);
  assert.match(validateBook({ ...ok, cover: `data:image/jpeg;base64,${"A".repeat(COVER_MAX_BYTES)}` }).join(" "), /너무 큽니다/);
});

test("표지 없이도 기록할 수 있다", () => {
  assert.deepEqual(validateBook(book({ cover: null })), []);
});

test("최근 읽은 순으로, 같은 날이면 나중에 적은 것이 위로", () => {
  const older = { ...book({ title: "옛것" }), readOn: "2026-07-01", createdAt: "2026-07-01T00:00:00Z" };
  const sameDayFirst = { ...book({ title: "먼저" }), readOn: "2026-08-19", createdAt: "2026-08-19T01:00:00Z" };
  const sameDayLater = { ...book({ title: "나중" }), readOn: "2026-08-19", createdAt: "2026-08-19T09:00:00Z" };
  assert.deepEqual(sortBooks([older, sameDayFirst, sameDayLater]).map((b) => b.title),
    ["나중", "먼저", "옛것"]);
});

test("연도별로 묶어 몇 권인지 보여 준다", () => {
  const groups = groupByYear([
    { ...book({ title: "가" }), readOn: "2026-08-19" },
    { ...book({ title: "나" }), readOn: "2026-01-02" },
    { ...book({ title: "다" }), readOn: "2025-12-31" },
  ]);
  assert.deepEqual(groups.map((g) => [g.year, g.books.length]), [["2026", 2], ["2025", 1]]);
});
