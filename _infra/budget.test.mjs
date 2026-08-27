// life/budget — 카드 한 장의 소비. 주기 긋기와 페이스 계산만 본다(화면은 e2e).
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  CATEGORIES, DEFAULT_LIMIT, addEntries, addEntry, byCategory, categoryFor, categoryLabel,
  cycleLabel, cycleOf, editEntry, emptyState, entriesIn, exportText, groupByDay, inCycle, kstDate,
  markSynced, needsSync, nextCycle, pace, parseState, previousCycle, removeEntries, removeEntry,
  ruleKey, setAuto, setCategory, setLimit, setStartDay, shortWon, toggleSkip, totalOf,
  validateEntry, won,
} = await import("../life/budget/store.js");
const { MERCHANTS } = await import("../life/budget/merchants.js");

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

test("담아는 두되 합계에서 뺀다 — 지우면 다음 백업에서 또 담긴다", () => {
  let state = spend(spend(emptyState(), "2026-08-10", 12000, "국밥"), "2026-08-11", 500000, "카드값 출금");
  const [, bill] = state.entries;
  assert.equal(totalOf(entriesIn(state, cycleOf("2026-08-15"))), 512000);

  state = toggleSkip(state, bill.id);
  assert.equal(state.entries[1].skip, true);
  assert.equal(totalOf(entriesIn(state, cycleOf("2026-08-15"))), 12000, "뺀 것은 세지 않는다");
  assert.equal(entriesIn(state, cycleOf("2026-08-15")).length, 2, "목록에는 남는다");
  assert.equal(pace(state, cycleOf("2026-08-15"), "2026-08-15").spent, 12000);
  assert.equal(groupByDay(entriesIn(state, cycleOf("2026-08-15")))[0].total, 0, "그날 합계에서도 빠진다");

  state = toggleSkip(state, bill.id);
  assert.equal(state.entries[1].skip, undefined, "되돌리면 표식이 사라진다");
  assert.equal(totalOf(entriesIn(state, cycleOf("2026-08-15"))), 512000);
  assert.throws(() => toggleSkip(state, "없는id"), /없습니다/);
});

test("합계에서 뺀 표식은 저장본에도 남는다", () => {
  let state = spend(emptyState(), "2026-08-10", 12000, "국밥");
  state = toggleSkip(state, state.entries[0].id);
  const parsed = parseState(JSON.stringify(state));
  assert.equal(parsed.entries[0].skip, true);
  assert.equal(totalOf(entriesIn(parsed, cycleOf("2026-08-15"))), 0);
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

/* ── 매일 최신 백업 받기 ─────────────────────────────────────────
 * 화면이 하루 한 번만 폴더를 들추고, 방금 담은 것만 되돌릴 수 있어야 한다. */
test("자동 읽기는 하루 한 번이다", () => {
  const fresh = emptyState();
  assert.equal(fresh.auto, true, "기본은 켜 둔다");
  assert.equal(needsSync(fresh, "2026-08-25"), true);

  const done = markSynced(fresh, "2026-08-25");
  assert.equal(done.lastSyncOn, "2026-08-25");
  assert.equal(needsSync(done, "2026-08-25"), false, "같은 날 두 번 들추지 않는다");
  assert.equal(needsSync(done, "2026-08-26"), true, "날이 바뀌면 다시 읽는다");
  assert.equal(needsSync(setAuto(fresh, false), "2026-08-25"), false, "꺼 두면 안 읽는다");
  assert.equal(markSynced(fresh, "엉터리").lastSyncOn, kstDate(), "이상한 날짜는 오늘로 친다");
});

test("자동 읽기 설정은 저장본을 오가도 남는다", () => {
  const saved = parseState(JSON.stringify(markSynced(setAuto(emptyState(), false), "2026-08-25")));
  assert.equal(saved.auto, false);
  assert.equal(saved.lastSyncOn, "2026-08-25");
  // 이 칸이 없던 시절의 저장본은 켜진 것으로 읽는다.
  assert.equal(parseState(JSON.stringify({ v: 1, limit: 1000000, startDay: 1, entries: [] })).auto, true);
  assert.equal(parseState(JSON.stringify({ v: 1, lastSyncOn: "어제" })).lastSyncOn, "");
});

test("한 번에 담은 것만 되돌린다", () => {
  const before = spend(emptyState(), "2026-08-10", 12000, "국밥");
  const { state, added } = addEntries(before, [
    { amount: 4500, memo: "커피", on: "2026-08-25" },
    { amount: 0, memo: "0원은 담지 않는다", on: "2026-08-25" },
    { amount: 9360, memo: "메가엠지씨커피", on: "2026-08-25" },
  ], new Date("2026-08-25T08:00:00Z"));

  assert.equal(added.length, 2, "틀린 한 건 때문에 나머지를 버리지 않는다");
  assert.equal(state.entries.length, 3);
  assert.equal(totalOf(state.entries), 25860);

  const undone = removeEntries(state, added);
  assert.equal(undone.entries.length, 1, "먼저 있던 것은 남는다");
  assert.equal(undone.entries[0].memo, "국밥");
  assert.equal(removeEntries(state, []).entries.length, 3);
});

/* ── 카테고리 ───────────────────────────────────────────────────── */
test("씨앗 표는 이름에 든 글자로 보고, 긴 쪽이 이긴다", () => {
  // 카드 문자의 가맹점명은 잘리고 붙는다 — 법인명이 그대로 오기도 한다(실기기 표본).
  assert.equal(categoryFor("메가엠지씨커피", {}, MERCHANTS), "cafe");
  assert.equal(categoryFor("(주)메가엠지씨커피 강남점", {}, MERCHANTS), "cafe");
  // "쿠팡이츠" 가 "쿠팡" 을 이겨야 배달이 생필품으로 가지 않는다.
  assert.equal(categoryFor("쿠팡이츠", {}, MERCHANTS), "food");
  assert.equal(categoryFor("쿠팡", {}, MERCHANTS), "living");
  // 어디에 썼는지 알 수 없는 것은 미분류로 둔다.
  assert.equal(categoryFor("새마을금고 도우너", {}, MERCHANTS), "");
  assert.equal(categoryFor("", {}, MERCHANTS), "");
});

test("내가 정한 규칙이 씨앗 표를 이긴다", () => {
  const rules = { [ruleKey("스타벅스")]: "etc" };
  assert.equal(categoryFor("스타벅스", rules, MERCHANTS), "etc");
  assert.equal(categoryFor("스타벅스", {}, MERCHANTS), "cafe");
  // 띄어쓰기·대소문자·괄호가 달라도 같은 열쇠다.
  // 법인 머리는 떼어 낸다 — 같은 가게가 두 규칙으로 갈리면 안 된다.
  assert.equal(ruleKey("(주) GS25 강남"), ruleKey("gs25강남"));
  assert.equal(ruleKey("㈜나인투원"), ruleKey("나인투원"));
  assert.equal(ruleKey("주식회사 카카오모빌리티"), ruleKey("카카오모빌리티"));
  assert.equal(categoryFor("이상한칸", { [ruleKey("이상한칸")]: "없는칸" }, MERCHANTS), "");
});

test("카테고리를 정하면 같은 가맹점이 모두 따라오고 규칙으로 남는다", () => {
  let state = spend(emptyState(), "2026-08-10", 9360, "메가엠지씨커피");
  state = spend(state, "2026-08-12", 4500, "메가엠지씨커피");
  state = spend(state, "2026-08-13", 12000, "백암순대");

  state = setCategory(state, state.entries[0].id, "cafe");
  assert.deepEqual(state.entries.map((one) => one.cat ?? ""), ["cafe", "cafe", ""], "같은 이름이 함께 바뀐다");
  assert.equal(state.rules[ruleKey("메가엠지씨커피")], "cafe");
  // 규칙이 남았으니 다음에 담기는 것도 그 칸으로 간다(화면이 categoryFor 로 찍어 준다).
  assert.equal(categoryFor("메가엠지씨커피", state.rules, []), "cafe");

  // 미분류로 되돌리면 규칙도 지운다 — 잘못 정한 것을 되돌릴 길이 있어야 한다.
  state = setCategory(state, state.entries[1].id, "");
  assert.deepEqual(state.entries.map((one) => one.cat ?? ""), ["", "", ""]);
  assert.equal(ruleKey("메가엠지씨커피") in state.rules, false);
  assert.throws(() => setCategory(state, "없는id", "cafe"), /없습니다/);
});

test("카테고리와 규칙은 저장본을 오가도 남는다", () => {
  let state = spend(emptyState(), "2026-08-10", 9360, "메가엠지씨커피");
  state = setCategory(state, state.entries[0].id, "cafe");
  const saved = parseState(JSON.stringify(state));
  assert.equal(saved.entries[0].cat, "cafe");
  assert.equal(saved.rules[ruleKey("메가엠지씨커피")], "cafe");
  // 이 칸이 없던 저장본, 그리고 이상한 값은 조용히 버린다.
  assert.deepEqual(parseState(JSON.stringify({ v: 1, entries: [] })).rules, {});
  assert.deepEqual(parseState(JSON.stringify({ v: 1, rules: { 가게: "없는칸" } })).rules, {});
  assert.equal(parseState(JSON.stringify({ v: 1, entries: [
    { id: "x", amount: 100, memo: "가게", on: "2026-08-10", at: "2026-08-10T00:00:00Z", cat: "없는칸" },
  ] })).entries[0].cat, undefined);
});

test("카테고리별 합계는 뺀 것을 세지 않는다", () => {
  let state = spend(emptyState(), "2026-08-10", 12000, "국밥");
  state = setCategory(state, state.entries[0].id, "food");
  state = spend(state, "2026-08-11", 9360, "커피");
  state = setCategory(state, state.entries[1].id, "cafe");
  state = spend(state, "2026-08-12", 500000, "카드대금");
  state = toggleSkip(state, state.entries[2].id);

  const rows = byCategory(entriesIn(state, cycleOf("2026-08-15")));
  assert.deepEqual(rows.map((row) => [row.label, row.total, row.count]),
    [["식비", 12000, 1], ["카페/간식", 9360, 1]], "금액 큰 칸이 먼저, 뺀 것은 없다");
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), totalOf(entriesIn(state, cycleOf("2026-08-15"))),
    "카테고리 합과 주기 합이 어긋나면 안 된다");
  assert.equal(categoryLabel("food"), "식비");
  assert.equal(categoryLabel(""), "미분류");
  assert.equal(CATEGORIES.length, 8);
});

test("내보내기는 요약과 표를 함께 낸다", () => {
  let state = spend(emptyState(), "2026-08-10", 12000, "백암순대");
  state = setCategory(state, state.entries[0].id, "food");
  state = spend(state, "2026-08-12", 500000, "카드대금");
  state = toggleSkip(state, state.entries[1].id);

  const text = exportText(state, cycleOf("2026-08-15"), "2026-08-15");
  assert.match(text, /주기 2026-08-01 ~ 2026-08-31 \(31일\) · 한도 1,000,000원/);
  assert.match(text, /31일 중 15일째/);
  assert.match(text, /합계에서 뺀 것 1건 500,000원/);
  assert.match(text, /- 식비 12,000원 \(100%\) 1건/);
  // 뺀 것도 표에는 남기고 열로 표시한다 — 없으면 왜 없는지 알 수 없다.
  assert.match(text, /08-12\t500000\t카드대금\t미분류\tY/);
  assert.match(text, /08-10\t12000\t백암순대\t식비\t/);
  assert.equal(text.split("\n").filter((line) => line.startsWith("08-")).length, 2);

  // 빈 주기에서도 깨지지 않는다.
  assert.match(exportText(emptyState(), cycleOf("2026-08-15"), "2026-08-15"), /아직 적은 것이 없다/);
});

test("씨앗 표는 형식이 맞고 겹치지 않는다", () => {
  const ids = new Set(CATEGORIES.map((one) => one.id));
  const seen = new Set();
  for (const seed of MERCHANTS) {
    assert.equal(typeof seed.match === "string" && seed.match.length > 0, true, "빈 열쇠");
    assert.equal(ids.has(seed.cat), true, `${seed.match}: 없는 카테고리 ${seed.cat}`);
    const key = ruleKey(seed.match);
    assert.equal(seen.has(key), false, `같은 것이 두 번 있다: ${seed.match}`);
    seen.add(key);
  }
});
