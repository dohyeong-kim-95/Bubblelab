import test from "node:test";
import assert from "node:assert/strict";

const { hasAnything, kstMonth, kstYear, summarize, yearsIn } =
  await import("../life/review/store.js");

const todo = (at) => ({ id: at, text: "일", at });
const book = (readOn, title = "책") => ({ title, readOn });
const workout = (at, reps) => ({ at, day: 1, reps });

test("달 경계는 KST 자정이다", () => {
  assert.equal(kstMonth("2026-07-31T14:59:59Z"), "2026-07");
  assert.equal(kstMonth("2026-07-31T15:00:00Z"), "2026-08");
  assert.equal(kstYear("2025-12-31T15:00:00Z"), "2026");
  assert.equal(kstMonth("이상한 값"), null);
});

test("기록이 있는 해만 고를 수 있다", () => {
  assert.deepEqual(yearsIn({
    todoLog: [todo("2026-03-02T01:00:00Z")],
    books: [book("2024-11-02")],
    pushupLog: [workout("2025-06-01T01:00:00Z", 10)],
  }), ["2026", "2025", "2024"]);
  assert.deepEqual(yearsIn({}), []);
});

test("한 해를 도구별로 센다", () => {
  const summary = summarize({
    todoLog: [
      todo("2026-01-05T01:00:00Z"), todo("2026-01-20T01:00:00Z"),
      todo("2026-08-19T01:00:00Z"), todo("2025-08-19T01:00:00Z"),
    ],
    books: [book("2026-02-01", "가"), book("2025-02-01", "나")],
    pushupLog: [workout("2026-03-01T01:00:00Z", 12), workout("2026-03-03T01:00:00Z", 15),
      workout("2025-03-01T01:00:00Z", 9)],
  }, "2026");

  assert.equal(summary.todos.total, 3);
  assert.equal(summary.todos.months[0], 2, "1월 두 개");
  assert.equal(summary.todos.months[7], 1, "8월 하나");
  assert.equal(summary.todos.months.length, 12);
  assert.deepEqual(summary.books.items.map((item) => item.title), ["가"]);
  assert.equal(summary.pushup.sessions, 2);
  assert.equal(summary.pushup.best, 15);
  assert.equal(summary.pushup.reps, 27);
});

test("재검사는 운동한 날로 세지 않는다", () => {
  const summary = summarize({
    pushupLog: [{ at: "2026-03-01T01:00:00Z", test: true, reps: 20 }, workout("2026-03-02T01:00:00Z", 8)],
  }, "2026");
  assert.equal(summary.pushup.sessions, 1);
  assert.equal(summary.pushup.best, 8, "최대량을 잰 것은 운동 기록이 아니다");
});

test("도구가 없어도 나머지 한 해는 보인다", () => {
  // 도구는 생겼다 없어진다 — 하나가 사라졌다고 전체가 안 보이면 안 된다.
  const summary = summarize({ todoLog: [todo("2026-05-05T01:00:00Z")] }, "2026");
  assert.equal(summary.todos.total, 1);
  assert.equal(summary.books.total, 0);
  assert.equal(summary.pushup.sessions, 0);
  assert.equal(hasAnything(summary), true);
});

test("아무것도 없으면 없다고 말한다", () => {
  assert.equal(hasAnything(summarize({}, "2026")), false);
  assert.equal(hasAnything(summarize({ todoLog: [todo("2025-01-01T01:00:00Z")] }, "2026")), false);
});
