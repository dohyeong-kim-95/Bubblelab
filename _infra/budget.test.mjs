// life/budget — 카드 한 장의 소비. 주기 긋기와 페이스 계산만 본다(화면은 e2e).
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  DEFAULT_LIMIT, addEntry, cycleLabel, cycleOf, editEntry, emptyState, entriesIn, groupByDay,
  inCycle, kstDate, nextCycle, pace, parseState, previousCycle, removeEntry, setLimit,
  setStartDay, shortWon, totalOf, validateEntry, won,
} = await import("../life/budget/store.js");

// 같은 날 여러 번 적을 수 있으므로 적은 시각을 부를 때마다 1분씩 뒤로 민다.
let clock = 0;
const spend = (state, on, amount, memo = "") =>
  addEntry(state, { amount, memo, on }, new Date(Date.parse(`${on}T03:00:00Z`) + (clock += 60_000)));

test("오늘은 KST 자정 기준이다", () => {
  assert.equal(kstDate(new Date("2026-08-22T14:59:59Z")), "2026-08-22");
  assert.equal(kstDate(new Date("2026-08-22T15:00:00Z")), "2026-08-23");
});

test("시작일이 1이면 주기는 그냥 달력의 한 달이다", () => {
  const august = cycleOf("2026-08-23");
  assert.deepEqual(august, { start: "2026-08-01", end: "2026-08-31", days: 31, startDay: 1 });
  assert.equal(cycleLabel(august), "8월");
  assert.equal(cycleOf("2026-02-05").days, 28);
  assert.equal(cycleOf("2028-02-05").days, 29, "윤달은 29일이다");
});

test("카드 청구가 1일에 시작하지 않으면 주기가 달을 걸친다", () => {
  const cycle = cycleOf("2026-08-10", 15);
  assert.deepEqual(cycle, { start: "2026-07-15", end: "2026-08-14", days: 31, startDay: 15 });
  assert.equal(cycleLabel(cycle), "7/15–8/14");
  // 시작일 당일은 새 주기의 첫날이다
  assert.equal(cycleOf("2026-08-15", 15).start, "2026-08-15");
});

test("주기는 앞뒤로 이어지고 해를 넘겨도 끊기지 않는다", () => {
  const january = cycleOf("2027-01-03");
  assert.equal(previousCycle(january).start, "2026-12-01");
  assert.equal(nextCycle(previousCycle(january)).start, "2027-01-01");
  assert.equal(nextCycle(cycleOf("2026-12-20")).start, "2027-01-01");
  assert.equal(inCycle(january, "2027-01-31"), true);
  assert.equal(inCycle(january, "2027-02-01"), false);
});

test("29~31일은 없는 달이 있어 시작일로 받지 않는다", () => {
  assert.equal(cycleOf("2026-08-10", 31).startDay, 28);
  assert.equal(cycleOf("2026-08-10", 0).startDay, 1);
  assert.equal(cycleOf("2026-08-10", "이상한 값").startDay, 1);
});

test("금액이 0이면 기록이 아니고, 환불은 음수로 적는다", () => {
  const state = emptyState();
  assert.throws(() => spend(state, "2026-08-10", 0), /금액/);
  assert.throws(() => spend(state, "2026-08-10", "커피"), /금액/);
  const refunded = spend(spend(state, "2026-08-10", 30000, "옷"), "2026-08-12", -30000, "환불");
  assert.equal(totalOf(refunded.entries), 0);
  assert.deepEqual(validateEntry({ amount: 5000, on: "2026-8-1" }), ["날짜가 올바르지 않습니다"]);
});

test("메모는 다듬어 40자까지만 담는다", () => {
  const [entry] = spend(emptyState(), "2026-08-10", 4500, `  점심 ${"밥".repeat(60)} `).entries;
  assert.equal(entry.memo.length, 40);
  assert.equal(entry.memo.startsWith("점심 밥"), true);
});

test("깨진 저장본은 버리고 나머지는 살린다", () => {
  assert.equal(parseState("{"), null);
  assert.equal(parseState(JSON.stringify({ v: 2, entries: [] })), null);
  const parsed = parseState(JSON.stringify({
    v: 1, limit: 700000, startDay: 25,
    entries: [
      { id: "a", amount: 12000, memo: "국밥", on: "2026-08-10", at: "2026-08-10T03:00:00Z" },
      { id: "b", amount: 0, on: "2026-08-11", at: "2026-08-11T03:00:00Z" },
      { id: "c", amount: 3000, on: "어제", at: "x" },
      "쓰레기",
    ],
  }));
  assert.equal(parsed.limit, 700000);
  assert.equal(parsed.startDay, 25);
  assert.deepEqual(parsed.entries.map((entry) => entry.id), ["a", "c"],
    "금액 없는 것만 버린다 — 날짜가 깨진 것은 오늘로 되살린다");
  assert.equal(parsed.entries[1].on, kstDate());
  // 한도가 깨져 있어도 화면이 열려야 한다
  assert.equal(parseState(JSON.stringify({ v: 1, limit: "많이", entries: [] })).limit, DEFAULT_LIMIT);
});

test("주기 안의 것만 세고, 최근 날짜가 위로 온다", () => {
  let state = emptyState();
  state = spend(state, "2026-07-31", 50000, "지난 주기");
  state = spend(state, "2026-08-01", 12000, "국밥");
  state = spend(state, "2026-08-23", 4500, "커피");
  state = spend(state, "2026-08-23", 30000, "장보기");
  state = spend(state, "2026-09-01", 90000, "다음 주기");

  const august = entriesIn(state, cycleOf("2026-08-15"));
  assert.equal(totalOf(august), 46500);
  assert.deepEqual(august.map((entry) => entry.memo), ["장보기", "커피", "국밥"]);
  const days = groupByDay(august);
  assert.deepEqual(days.map((day) => [day.on, day.total]),
    [["2026-08-23", 34500], ["2026-08-01", 12000]]);
});

test("페이스는 한도를 주기 일수로 고르게 나눈 기준선과 견준다", () => {
  let state = emptyState();               // 한도 100만원, 8월은 31일
  state = spend(state, "2026-08-01", 200000, "월세 보탬");
  state = spend(state, "2026-08-10", 200000, "노트북");
  const now = pace(state, cycleOf("2026-08-10"), "2026-08-10");

  assert.equal(now.spent, 400000);
  assert.equal(now.remaining, 600000);
  assert.equal(now.dayIndex, 10);
  assert.equal(now.daysLeft, 22, "오늘을 포함해 남은 날이다");
  assert.equal(now.expected, 322581);
  assert.equal(now.diff, 77419);
  assert.equal(now.status, "ahead");
  assert.equal(now.perDay, 27272, "오늘부터 하루 이만큼이면 한도를 지킨다");
  assert.equal(now.projected, 1240000, "이 속도면 월말에 한도를 넘는다");
  assert.equal(now.today, 200000);
});

test("기준선 언저리는 경고하지 않는다", () => {
  const state = spend(emptyState(), "2026-08-15", 480000, "이것저것");
  const now = pace(state, cycleOf("2026-08-15"), "2026-08-15");
  assert.equal(now.expected, 483871);
  assert.equal(now.status, "on", "몇 천원 어긋났다고 경고하면 경고를 읽지 않게 된다");
});

test("덜 쓰면 남은 날에 쓸 수 있는 돈이 늘어난다", () => {
  const state = spend(emptyState(), "2026-08-01", 100000, "장보기");
  const now = pace(state, cycleOf("2026-08-20"), "2026-08-20");
  assert.equal(now.status, "under");
  assert.equal(now.diff, -545161);
  assert.equal(now.perDay, 75000, "남은 12일에 하루 7만 5천원");
});

test("한도를 넘기면 남은 돈이 음수이고 하루 가능액은 0 아래다", () => {
  const state = spend(emptyState(), "2026-08-05", 1200000, "사고");
  const now = pace(state, cycleOf("2026-08-05"), "2026-08-05");
  assert.equal(now.status, "over");
  assert.equal(now.remaining, -200000);
  assert.equal(now.perDay < 0, true);
});

test("지난 주기와 아직 오지 않은 주기도 같은 함수로 본다", () => {
  const state = spend(emptyState(), "2026-07-20", 920000, "지난달");
  const past = pace(state, cycleOf("2026-07-20"), "2026-08-23");
  assert.equal(past.finished, true);
  assert.equal(past.daysLeft, 0);
  assert.equal(past.perDay, null);
  assert.equal(past.dayIndex, past.days);
  assert.equal(past.remaining, 80000, "8만원 남기고 끝났다");

  const future = pace(state, cycleOf("2026-09-10"), "2026-08-23");
  assert.equal(future.started, false);
  assert.equal(future.dayIndex, 0);
  assert.equal(future.expected, 0);
  assert.equal(future.projected, null);
  assert.equal(future.daysLeft, 30);
});

test("한도와 시작일을 바꿔도 적어 둔 것은 그대로다 — 주기만 다시 그어진다", () => {
  let state = spend(emptyState(), "2026-08-10", 300000, "노트북");
  state = setLimit(setStartDay(state, 15), 700000);
  assert.equal(state.entries.length, 1);
  assert.equal(state.limit, 700000);
  const cycle = cycleOf("2026-08-23", state.startDay);
  assert.equal(cycle.start, "2026-08-15");
  assert.equal(totalOf(entriesIn(state, cycle)), 0, "8/10 은 이제 지난 주기에 속한다");
  assert.equal(totalOf(entriesIn(state, cycleOf("2026-08-10", state.startDay))), 300000);
  assert.throws(() => setLimit(state, -1), /한도/);
});

test("고치고 지우는 것은 id 로만 한다", () => {
  const state = spend(spend(emptyState(), "2026-08-10", 12000, "국밥"), "2026-08-11", 4500, "커피");
  const [first] = state.entries;
  const fixed = editEntry(state, first.id, { amount: 13000, memo: "국밥(곱빼기)" });
  assert.equal(fixed.entries[0].amount, 13000);
  assert.equal(fixed.entries[0].at, first.at, "적은 시각은 그대로 둔다");
  assert.equal(removeEntry(fixed, first.id).entries.length, 1);
  assert.equal(removeEntry(fixed, "없는id").entries.length, 2);
  assert.throws(() => editEntry(state, "없는id", { amount: 1 }), /없습니다/);
  assert.throws(() => editEntry(state, first.id, { amount: 0 }), /금액/);
});

test("큰 숫자는 만 단위로 줄여 읽는다", () => {
  assert.equal(won(1234567), "1,234,567원");
  assert.equal(shortWon(9800), "9,800원");
  assert.equal(shortWon(1000000), "100만원");
  assert.equal(shortWon(322581), "32.3만원");
  assert.equal(shortWon(-80000), "-8만원");
});
