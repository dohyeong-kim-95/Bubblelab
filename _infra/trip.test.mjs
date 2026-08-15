// trip/ 여행 계획·예산 계산 검사. 화면은 이 모듈의 숫자를 그대로 그리므로,
// 여기서 틀리면 예산이 틀린다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CATS, CAT_KEYS, STATUS_KEYS, MAX_DAYS,
  parseDate, dayList, dday, todayKST, weekday,
  itemKRW, summarize, formatKRW, formatShort,
  newTrip, newItem, normalizeTrip, normalizeStore, sortItems,
} from "../trip/budget.js";

const trip = (patch = {}) => normalizeTrip({ ...newTrip(), ...patch });

test("분류·상태 키가 겹치지 않는다", () => {
  assert.equal(new Set(CAT_KEYS).size, CATS.length);
  assert.ok(CAT_KEYS.includes("etc"), "모르는 분류가 떨어질 자리(etc)가 있어야 한다");
  assert.deepEqual(STATUS_KEYS, ["plan", "booked", "paid"]);
});

test("날짜 파싱은 없는 날짜를 거절한다", () => {
  assert.equal(parseDate("2026-02-31"), null, "2월 31일이 3월로 이월되면 안 된다");
  assert.equal(parseDate("2026-13-01"), null);
  assert.equal(parseDate("20260901"), null);
  assert.equal(parseDate(""), null);
  assert.ok(parseDate("2026-09-01") !== null);
  assert.equal(weekday("2026-09-01"), "화");
});

test("기간은 양끝을 포함하고, 거꾸로면 하루로 본다", () => {
  assert.deepEqual(dayList("2026-09-01", "2026-09-03"),
    ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.deepEqual(dayList("2026-09-01", "2026-09-01"), ["2026-09-01"]);
  // 도착일을 고치는 중(끝 < 시작)에도 화면이 통째로 비면 안 된다
  assert.deepEqual(dayList("2026-09-05", "2026-09-01"), ["2026-09-05"]);
  assert.deepEqual(dayList("", "2026-09-01"), []);
  // 연도 오타로 날짜 카드를 몇만 장 그리지 않는다
  assert.equal(dayList("2026-09-01", "2126-09-01").length, MAX_DAYS);
});

test("월을 넘는 기간도 이어진다", () => {
  const days = dayList("2026-08-30", "2026-09-02");
  assert.deepEqual(days, ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
});

test("D-day는 오늘이 0, 지난 여행은 음수", () => {
  assert.equal(dday("2026-09-10", "2026-09-01"), 9);
  assert.equal(dday("2026-09-01", "2026-09-01"), 0);
  assert.equal(dday("2026-08-25", "2026-09-01"), -7);
  assert.equal(dday("", "2026-09-01"), null);
});

test("오늘은 KST 기준이다 — 여행지 시차로 D-day가 흔들리지 않는다", () => {
  // UTC 2026-08-31 20:00 = KST 2026-09-01 05:00
  assert.equal(todayKST(new Date("2026-08-31T20:00:00Z")), "2026-09-01");
  assert.equal(todayKST(new Date("2026-08-31T14:00:00Z")), "2026-08-31");
});

test("현지통화는 환율로 환산하고, 1인당 금액은 인원만큼 곱한다", () => {
  const t = trip({ people: 3, currency: "JPY", rate: 9.5 });
  assert.equal(itemKRW(newItem({ amount: 10000, cur: "KRW" }), t), 10000);
  assert.equal(itemKRW(newItem({ amount: 10000, cur: "LOC" }), t), 95000);
  assert.equal(itemKRW(newItem({ amount: 10000, cur: "LOC", per: true }), t), 285000);
  // 환율을 지워도 원화 항목은 살아 있어야 한다 (0으로 곱하지 않는다)
  const noRate = trip({ rate: 1 });
  assert.equal(itemKRW(newItem({ amount: 5000 }), noRate), 5000);
});

test("집계는 분류·날짜·상태를 각각 더한다", () => {
  const t = trip({
    start: "2026-09-01", end: "2026-09-02", people: 2,
    budgets: { flight: 400000, food: 100000 },
    items: [
      newItem({ date: "2026-09-01", cat: "flight", amount: 300000, status: "paid" }),
      newItem({ date: "2026-09-01", cat: "food", amount: 30000 }),
      newItem({ date: "2026-09-02", cat: "food", amount: 90000, status: "booked" }),
    ],
  });
  const s = summarize(t, "2026-08-25");
  assert.equal(s.planned, 420000);
  assert.equal(s.paid, 300000);
  assert.equal(s.booked, 90000);
  assert.equal(s.unpaid, 120000);
  assert.equal(s.perPerson, 210000);
  assert.equal(s.perDay, 210000);
  assert.equal(s.dday, 7);

  const flight = s.byCat.find((c) => c.key === "flight");
  assert.equal(flight.planned, 300000);
  assert.equal(flight.paid, 300000);
  assert.equal(flight.over, false);
  const food = s.byCat.find((c) => c.key === "food");
  assert.equal(food.planned, 120000);
  assert.equal(food.count, 2);
  assert.equal(food.over, true, "식비 12만이 예산 10만을 넘었다");

  assert.deepEqual(s.byDay.map((d) => d.planned), [330000, 90000]);
  // 예산 합(50만) - 계획(42만)
  assert.equal(s.budgetTotal, 500000);
  assert.equal(s.remain, 80000);
});

test("예산을 넘기면 remain이 음수다 (화면이 초과로 표시하는 근거)", () => {
  const s = summarize(trip({
    budgets: { food: 50000 },
    items: [newItem({ cat: "food", amount: 80000 })],
  }), "2026-09-01");
  assert.equal(s.remain, -30000);
  assert.equal(s.byCat.find((c) => c.key === "food").ratio, 1.6);
});

test("예산이 0인 분류는 비율을 내지 않는다 (0으로 나누지 않는다)", () => {
  const s = summarize(trip({ items: [newItem({ cat: "shop", amount: 10000 })] }), "2026-09-01");
  const shop = s.byCat.find((c) => c.key === "shop");
  assert.equal(shop.ratio, null);
  assert.equal(shop.over, false);
  assert.equal(s.budgetTotal, 0);
});

test("기간 밖·날짜 없는 항목도 총액에는 들어간다", () => {
  // 항공권처럼 날짜를 정하기 전에 금액만 잡아 두는 경우가 실제로 많다.
  const s = summarize(trip({
    start: "2026-09-01", end: "2026-09-02",
    items: [
      newItem({ date: "", cat: "flight", amount: 500000 }),
      newItem({ date: "2026-12-25", cat: "stay", amount: 100000 }),
      newItem({ date: "2026-09-01", cat: "food", amount: 10000 }),
    ],
  }), "2026-09-01");
  assert.equal(s.planned, 610000, "날짜 미정·기간 밖 항목이 총액에서 빠지면 예산이 거짓말이 된다");
  assert.equal(s.undated.planned, 600000);
  assert.equal(s.byDay.reduce((sum, d) => sum + d.planned, 0), 10000);
});

test("항목이 없으면 0으로 떨어지고 나누기가 깨지지 않는다", () => {
  // 기간·항목이 비어 있는 날것 그대로 넣는다 (normalizeTrip 은 빈 날짜를 오늘로
  // 채우므로, 0일짜리 여행은 그 앞단에서만 만들어질 수 있다).
  const s = summarize({ start: "", end: "", people: 1, items: [], budgets: {} }, "2026-09-01");
  assert.equal(s.planned, 0);
  assert.equal(s.perPerson, 0);
  assert.equal(s.perDay, 0);
  assert.deepEqual(s.days, []);
});

test("정렬은 시간순, 시간 없는 항목은 뒤로", () => {
  const items = [
    newItem({ title: "저녁", time: "19:00" }),
    newItem({ title: "미정" }),
    newItem({ title: "아침", time: "08:30" }),
  ];
  assert.deepEqual(sortItems(items).map((i) => i.title), ["아침", "저녁", "미정"]);
  assert.equal(items[0].title, "저녁", "원본 배열을 건드리면 안 된다");
});

test("저장본이 이상해도 화면이 믿을 수 있는 모양으로 고친다", () => {
  const t = normalizeTrip({
    title: "x".repeat(500),
    start: "2026-13-99", end: "아무거나",
    people: -3, rate: 0, currency: "jpy",
    budgets: { food: "50,000", 없는분류: 999 },
    items: [
      { title: "여권", cat: "없는분류", amount: "abc", status: "해킹", time: "99:99" },
      "문자열", null,
    ],
  });
  assert.equal(t.title.length, 60);
  assert.equal(t.people, 1, "인원은 1 미만이 될 수 없다");
  assert.equal(t.rate, 1, "환율 0은 모든 현지통화 항목을 0원으로 만든다");
  assert.equal(t.currency, "JPY");
  assert.ok(parseDate(t.start) !== null, "깨진 날짜는 오늘로 떨어진다");
  assert.equal(t.end, t.start);
  assert.equal(t.budgets.food, 50000, "쉼표가 든 숫자도 읽는다");
  assert.deepEqual(Object.keys(t.budgets), CAT_KEYS, "모르는 분류의 예산은 버린다");
  assert.equal(t.items.length, 3);
  assert.equal(t.items[0].cat, "etc");
  assert.equal(t.items[0].amount, 0);
  assert.equal(t.items[0].status, "plan");
  assert.equal(t.items[0].time, "");
  assert.ok(t.items.every((i) => i.id), "항목마다 id가 있어야 편집·삭제가 된다");
});

test("여행 여러 개를 담은 저장본을 읽는다", () => {
  const a = newTrip({ title: "오사카" });
  const b = newTrip({ title: "제주" });
  const store = normalizeStore({ trips: [a, b], activeId: b.id });
  assert.equal(store.trips.length, 2);
  assert.equal(store.activeId, b.id);
  // 없는 id를 가리키고 있으면 첫 여행으로 떨어진다 (화면이 빈 상태로 멈추지 않게)
  assert.equal(normalizeStore({ trips: [a], activeId: "없음" }).activeId, a.id);
  assert.deepEqual(normalizeStore(null), { version: 1, trips: [], activeId: "" });
  assert.deepEqual(normalizeStore("깨진값").trips, []);
});

test("금액 표기", () => {
  assert.equal(formatKRW(1234567), "1,234,567원");
  assert.equal(formatKRW(0), "0원");
  assert.equal(formatShort(1234567), "123.5만");
  assert.equal(formatShort(120000), "12만");
  assert.equal(formatShort(9000), "9,000");
  assert.equal(formatShort(-30000), "-3만");
  assert.equal(formatShort(210000000), "2.1억");
});
