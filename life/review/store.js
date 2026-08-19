// 흩어진 기록을 한 해 단위로 모아 세는 순수 함수. 저장소를 읽는 일은 app.js 가 한다.
//
// 도구가 없어질 수 있으므로 없는 것은 조용히 건너뛴다 — 도구 하나가 사라졌다고
// 나머지 한 해가 안 보이면 안 된다.

const KST = "Asia/Seoul";
const MONTHS = 12;

/** ISO 시각을 KST 기준 "YYYY-MM" 으로. 자정 경계를 여기 한 곳에서만 다룬다. */
export function kstMonth(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric", month: "2-digit" })
    .format(date).slice(0, 7);
}

export const kstYear = (iso) => kstMonth(iso)?.slice(0, 4) ?? null;

const yearOfDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value.slice(0, 4) : null);

/** 기록이 있는 해들. 데이터가 있는 해만 고를 수 있게 한다. */
export function yearsIn({ todoLog = [], books = [], pushupLog = [] } = {}) {
  const years = new Set();
  for (const entry of todoLog) { const year = kstYear(entry?.at); if (year) years.add(year); }
  for (const book of books) { const year = yearOfDate(book?.readOn); if (year) years.add(year); }
  for (const entry of pushupLog) { const year = kstYear(entry?.at); if (year) years.add(year); }
  return [...years].sort().reverse();
}

function byMonth(entries, year, toMonth) {
  const counts = Array.from({ length: MONTHS }, () => 0);
  for (const entry of entries) {
    const month = toMonth(entry);
    if (month?.slice(0, 4) !== year) continue;
    counts[Number(month.slice(5, 7)) - 1] += 1;
  }
  return counts;
}

export function summarize(sources = {}, year) {
  const { todoLog = [], books = [], pushupLog = [] } = sources;
  const todoMonths = byMonth(todoLog, year, (entry) => kstMonth(entry?.at));
  const readBooks = books.filter((book) => yearOfDate(book?.readOn) === year);
  // 재검사(test)는 운동한 날이 아니다 — 회차를 마친 것만 센다.
  const sessions = pushupLog.filter((entry) => !entry?.test && kstYear(entry?.at) === year);

  return {
    year,
    todos: { total: todoMonths.reduce((sum, count) => sum + count, 0), months: todoMonths },
    books: { total: readBooks.length, items: readBooks },
    pushup: {
      sessions: sessions.length,
      best: sessions.reduce((best, entry) => Math.max(best, entry.reps ?? 0), 0),
      reps: sessions.reduce((sum, entry) => sum + (entry.reps ?? 0), 0),
    },
  };
}

export const hasAnything = (summary) =>
  summary.todos.total > 0 || summary.books.total > 0 || summary.pushup.sessions > 0;
