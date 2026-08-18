// 읽은 책 기록. 화면과 테스트가 같이 쓰는 순수 함수만 둔다 —
// 저장은 IndexedDB(app.js)이고 서버로 나가는 것은 없다.

export const TITLE_MAX = 120;
export const AUTHOR_MAX = 60;
export const NOTE_MAX = 140;   // "짧은 한두 줄"이 이 화면의 규칙이다
export const COVER_MAX_BYTES = 400 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

export function makeBook(fields = {}, now = new Date()) {
  return {
    id: crypto.randomUUID(),
    title: "",
    author: "",
    note: "",
    cover: null,
    readOn: kstDate(now),
    createdAt: now.toISOString(),
    ...fields,
  };
}

/** 저장 직전에 다듬는다. 화면이 넘긴 값을 그대로 믿지 않는다. */
export function normalizeBook(book) {
  return {
    ...book,
    title: clean(book?.title, TITLE_MAX),
    author: clean(book?.author, AUTHOR_MAX),
    note: clean(book?.note, NOTE_MAX),
    cover: typeof book?.cover === "string" && book.cover.startsWith("data:image/") ? book.cover : null,
    readOn: DATE.test(book?.readOn ?? "") ? book.readOn : kstDate(),
  };
}

export function validateBook(book) {
  const errors = [];
  if (!book || typeof book !== "object") return ["책이 객체가 아닙니다"];
  if (!clean(book.title, TITLE_MAX)) errors.push("제목을 적어주세요");
  if (!clean(book.note, NOTE_MAX)) errors.push("한두 줄이라도 남겨주세요 — 그게 읽었다는 증거입니다");
  if (clean(book.note, NOTE_MAX).length > NOTE_MAX) errors.push(`독후감은 ${NOTE_MAX}자까지예요`);
  if (!DATE.test(book.readOn ?? "")) errors.push("읽은 날짜가 올바르지 않습니다");
  if (book.cover != null && !String(book.cover).startsWith("data:image/")) errors.push("표지 이미지가 올바르지 않습니다");
  if (book.cover && book.cover.length > COVER_MAX_BYTES) errors.push("표지가 너무 큽니다");
  return errors;
}

/** 최근 읽은 순. 같은 날이면 나중에 적은 것이 위로. */
export function sortBooks(books) {
  return [...books].sort((a, b) =>
    String(b.readOn).localeCompare(String(a.readOn)) ||
    String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 연도별로 묶는다 — "올해 몇 권"이 이 기록의 쓸모다. */
export function groupByYear(books) {
  const years = new Map();
  for (const book of sortBooks(books)) {
    const year = String(book.readOn).slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(book);
  }
  return [...years.entries()].map(([year, items]) => ({ year, books: items }));
}
