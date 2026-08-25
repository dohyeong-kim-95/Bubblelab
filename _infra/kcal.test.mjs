// life/kcal — 하루 섭취와 탄단지. 목표 계산과 세는 규칙, 그리고 음식표의 형식을 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  EXERCISES, GRAM_MAX, KCAL_MAX, MEALS, addEntries, addEntry, addWorkout, autoGoal, bmr, burn,
  burned, byMeal, kstHour, mealNow,
  dayReport, editEntry, editWorkout, emptyProfile, emptyState, entriesOn, exerciseLabel,
  findExercise, frequentFoods, kcalFromMacros, kstDate, macrosFor, normalizeProfile, parseState, removeEntry,
  removeWorkout, scaleFood, searchFoods, setGoal, setProfile, tdee, totals, useAutoGoal,
  validateEntry, validateWorkout, workoutsOn,
} = await import("../life/kcal/store.js");
const { FOODS } = await import("../life/kcal/foods.js");
const { makeFood, render } = await import("./kcal-food.mjs");

const TODAY = "2026-08-24";
const at = (on, hour = 8) => new Date(`${on}T${String(hour).padStart(2, "0")}:00:00Z`);
const eat = (state, on, fields, hour = 8) => addEntry(state, { on, ...fields }, at(on, hour));

test("오늘은 KST 자정 기준이다", () => {
  assert.equal(kstDate(new Date("2026-08-23T14:59:59Z")), "2026-08-23");
  assert.equal(kstDate(new Date("2026-08-23T15:00:00Z")), "2026-08-24");
});

/* ── 목표 ───────────────────────────────────────────────────────── */

test("기초대사량은 Mifflin-St Jeor 로 센다", () => {
  // 남 30세 170cm 70kg: 10*70 + 6.25*170 - 5*30 + 5 = 1617.5 → 1618
  assert.equal(bmr({ sex: "male", age: 30, height: 170, weight: 70 }), 1618);
  // 여 30세 160cm 55kg: 550 + 1000 - 150 - 161 = 1239
  assert.equal(bmr({ sex: "female", age: 30, height: 160, weight: 55 }), 1239);
  assert.equal(tdee({ sex: "male", age: 30, height: 170, weight: 70, activity: "light" }), 2225);
});

test("감량이라도 기초대사량 아래로는 내려가지 않는다", () => {
  const small = { sex: "female", age: 45, height: 155, weight: 50, activity: "sedentary", aim: "lose" };
  const goal = autoGoal(small);
  assert.equal(goal.kcal >= bmr(small), true, "그 아래는 목표가 아니라 굶는 것이다");
});

test("탄단지는 목표 열량을 비율로 나눈 그램이다", () => {
  const macros = macrosFor(2000, "normal");           // 50/20/30
  assert.deepEqual(macros, { carb: 250, protein: 100, fat: 67 });
  assert.deepEqual(macrosFor(2000, "keto"), { carb: 50, protein: 125, fat: 144 });
  // 되짚으면 대략 원래 열량이다(반올림 오차만).
  assert.equal(Math.abs(kcalFromMacros(macros) - 2000) <= 5, true);
});

test("몸 정보를 고치면 목표가 따라오지만, 직접 적은 목표는 지켜진다", () => {
  let state = emptyState(at(TODAY));
  state = setProfile(state, { ...emptyProfile(), weight: 90, aim: "lose" });
  assert.equal(state.goal.source, "auto");
  assert.equal(state.goal.kcal, autoGoal(state.profile).kcal);

  state = setGoal(state, { kcal: 1800, carb: 150, protein: 140, fat: 60, source: "manual" });
  state = setProfile(state, { ...state.profile, weight: 95 });
  assert.equal(state.goal.kcal, 1800, "몸 정보가 내가 적은 숫자를 덮어쓰지 않는다");
  assert.equal(useAutoGoal(state).goal.source, "auto");
});

test("몸 정보는 사람이 넣을 수 있는 범위로 다듬는다", () => {
  const wild = normalizeProfile({ sex: "x", age: 5, height: 999, weight: -3, activity: "없음", split: "없음" });
  assert.deepEqual(wild, { sex: "male", age: 10, height: 230, weight: 30, activity: "sedentary", aim: "keep", split: "normal" });
});

/* ── 먹은 것 ───────────────────────────────────────────────────── */

test("무엇을 먹었는지와 칼로리가 있어야 기록이 된다", () => {
  const state = emptyState(at(TODAY));
  assert.throws(() => eat(state, TODAY, { name: " ", kcal: 300 }), /무엇을/);
  assert.deepEqual(validateEntry({ name: "밥", kcal: KCAL_MAX + 1, on: TODAY }), ["칼로리가 너무 큽니다"]);
  assert.deepEqual(validateEntry({ name: "밥", kcal: 0, on: TODAY }), [], "0kcal(물·커피)도 기록이다");
});

test("수량을 곱해 담는다", () => {
  const pack = { name: "렌틸닭큐브 밸런스팩", unit: "1팩", kcal: 349, carb: 37, protein: 35, fat: 7 };
  assert.deepEqual(scaleFood(pack, 2),
    { name: pack.name, unit: "1팩", amount: 2, kcal: 698, carb: 74, protein: 70, fat: 14 });
  assert.equal(scaleFood(pack, 0.5).kcal, 175);
  assert.equal(scaleFood(pack, 0).amount, 1, "0인분은 없는 것과 같아 1로 본다");
});

test("하루치는 남은 것을 먼저 센다", () => {
  let state = emptyState(at(TODAY));
  state = setGoal(state, { kcal: 2000, carb: 250, protein: 100, fat: 67, source: "manual" });
  state = eat(state, TODAY, { name: "밥 한 공기", kcal: 310, carb: 68, protein: 5.6, fat: 0.6, meal: "아침" });
  state = eat(state, TODAY, { name: "렌틸닭큐브 밸런스팩", kcal: 349, carb: 37, protein: 35, fat: 7, meal: "점심" }, 12);
  state = eat(state, "2026-08-23", { name: "어제 것", kcal: 900 });

  const report = dayReport(state, TODAY);
  assert.equal(report.eaten.kcal, 659);
  assert.equal(report.left.kcal, 1341);
  assert.equal(report.eaten.protein, 40.6);
  assert.equal(report.over, false);
  assert.equal(Math.round(report.share.kcal * 100), 33);
  assert.deepEqual(report.meals.map((meal) => meal.meal), MEALS, "먹은 것이 없는 끼니도 자리를 지킨다");
  assert.deepEqual(report.meals.find((meal) => meal.meal === "점심").items.map((one) => one.name),
    ["렌틸닭큐브 밸런스팩"]);
  assert.equal(entriesOn(state, "2026-08-23").length, 1);
});

test("목표를 넘기면 남은 것이 음수로 나온다", () => {
  let state = setGoal(emptyState(at(TODAY)), { kcal: 1500, carb: 180, protein: 90, fat: 50, source: "manual" });
  state = eat(state, TODAY, { name: "치킨 한 마리", kcal: 1800, carb: 60, protein: 120, fat: 110 });
  const report = dayReport(state, TODAY);
  assert.equal(report.over, true);
  assert.equal(report.left.kcal, -300);
});

test("고치고 지우는 것은 id 로만 한다", () => {
  const state = eat(eat(emptyState(at(TODAY)), TODAY, { name: "밥", kcal: 310 }), TODAY, { name: "커피", kcal: 5 }, 9);
  const [first] = state.entries;
  const fixed = editEntry(state, first.id, { kcal: 400, meal: "저녁" });
  assert.equal(fixed.entries[0].kcal, 400);
  assert.equal(fixed.entries[0].at, first.at, "적은 시각은 그대로 둔다");
  assert.equal(removeEntry(fixed, first.id).entries.length, 1);
  assert.throws(() => editEntry(state, "없는id", { kcal: 1 }), /없습니다/);
});

test("깨진 저장본은 버리고 나머지는 살린다", () => {
  assert.equal(parseState("{"), null);
  assert.equal(parseState(JSON.stringify({ v: 2 })), null);
  const parsed = parseState(JSON.stringify({
    v: 1,
    profile: { sex: "female", age: 28, height: 162, weight: 54, activity: "moderate", aim: "lose", split: "workout" },
    goal: { kcal: 1600, carb: 160, protein: 120, fat: 53, source: "manual" },
    entries: [
      { id: "a", name: "밥", kcal: 310, carb: 68, protein: 5.6, fat: 0.6, meal: "아침", on: TODAY, at: `${TODAY}T00:00:00Z` },
      { id: "b", name: "", kcal: 100, on: TODAY, at: `${TODAY}T01:00:00Z` },
      { id: "c", name: "물", kcal: 0, meal: "없는끼니", on: TODAY, at: `${TODAY}T02:00:00Z` },
    ],
  }));
  assert.equal(parsed.goal.kcal, 1600);
  assert.equal(parsed.profile.split, "workout");
  assert.deepEqual(parsed.entries.map((entry) => entry.id), ["a", "c"], "이름 없는 것만 버린다");
  assert.equal(parsed.entries[1].meal, "간식", "모르는 끼니는 간식으로 둔다");
});

/* ── 자주 먹는 것 ──────────────────────────────────────────────── */

test("자주 먹는 것은 기록에서 뽑는다 — 즐겨찾기를 따로 두지 않는다", () => {
  let state = emptyState(at(TODAY));
  for (const on of ["2026-08-20", "2026-08-22", TODAY]) {
    state = eat(state, on, { name: "렌틸닭큐브 밸런스팩", kcal: 349, carb: 37, protein: 35, fat: 7 });
  }
  state = eat(state, "2026-06-01", { name: "옛날에 먹던 것", kcal: 500 });
  state = eat(state, TODAY, { name: "아메리카노", kcal: 5 }, 10);

  const frequent = frequentFoods(state, 5, TODAY);
  assert.equal(frequent[0].name, "렌틸닭큐브 밸런스팩");
  assert.equal(frequent[0].count, 3);
  assert.equal(frequent.at(-1).name, "옛날에 먹던 것", "오래된 것은 뒤로 밀린다");
});

test("같은 이름은 마지막에 먹은 값으로 기억한다", () => {
  let state = eat(emptyState(at(TODAY)), "2026-08-20", { name: "샐러드", kcal: 200, protein: 5 });
  state = eat(state, TODAY, { name: "샐러드", kcal: 320, protein: 22 });
  const [salad] = frequentFoods(state, 5, TODAY);
  assert.equal(salad.kcal, 320, "레시피를 고쳤으면 새 값이 맞다");
  assert.equal(salad.count, 2);
});

test("찾기는 내가 적은 것과 리포의 음식표를 함께 본다", () => {
  const state = eat(emptyState(at(TODAY)), TODAY, { name: "집 김치찌개", kcal: 240 });
  const found = searchFoods("김치", { foods: FOODS, state });
  assert.equal(found.some((food) => food.name === "집 김치찌개" && food.from === "mine"), true);
  const all = searchFoods("", { foods: FOODS, state });
  assert.equal(all.some((food) => food.from === "table"), true, "빈 검색어면 표도 함께 보여 준다");
});

test("같은 이름이 양쪽에 있으면 내 기록만 보여 준다", () => {
  const [product] = FOODS;
  const state = eat(emptyState(at(TODAY)), TODAY, { name: product.name, kcal: product.kcal + 50 });
  const found = searchFoods(product.name, { foods: FOODS, state });
  const same = found.filter((food) => food.name === product.name);
  assert.equal(same.length, 1, "표의 값과 내가 담은 값이 나란히 뜨면 어느 쪽이 내 것인지 알 수 없다");
  assert.equal(same[0].from, "mine");
  assert.equal(same[0].kcal, product.kcal + 50);
});

test("회사가 다른 동명 제품은 표에서 둘 다 남는다", () => {
  const foods = [
    { name: "프로틴바", brand: "가", unit: "1개", kcal: 200, carb: 20, protein: 15, fat: 7 },
    { name: "프로틴바", brand: "나", unit: "1개", kcal: 240, carb: 24, protein: 12, fat: 9 },
  ];
  const found = searchFoods("프로틴바", { foods, state: emptyState(at(TODAY)) });
  assert.deepEqual(found.map((food) => food.brand), ["가", "나"]);
});

/* ── 음식표 ───────────────────────────────────────────────────── */

test("음식표는 형식이 맞고 이름이 겹치지 않는다", () => {
  const names = new Set();
  for (const food of FOODS) {
    assert.equal(typeof food.name, "string", `이름이 없다: ${JSON.stringify(food)}`);
    // 같은 이름이라도 회사가 다르면 다른 제품이다 — 짝으로 본다.
    const key = `${food.name}|${food.brand ?? ""}`;
    assert.equal(names.has(key), false, `같은 것이 두 번 있다: ${key}`);
    names.add(key);
    assert.equal(typeof food.unit, "string", `${food.name}: 단위가 없다`);
    for (const key of ["kcal", "carb", "protein", "fat"]) {
      assert.equal(Number.isFinite(food[key]) && food[key] >= 0, true, `${food.name}: ${key} 가 이상하다`);
    }
    assert.equal(food.kcal <= KCAL_MAX && food.carb <= GRAM_MAX, true, `${food.name}: 값이 너무 크다`);
    // 표기 열량과 탄단지가 크게 어긋나면 옮겨 적다 틀린 것이다(식이섬유·당알코올로 20%까지는 벌어진다).
    const derived = kcalFromMacros(food);
    assert.equal(Math.abs(derived - food.kcal) <= Math.max(food.kcal * 0.25, 30), true,
      `${food.name}: 표기 ${food.kcal}kcal 인데 탄단지로는 ${derived}kcal 다`);
  }
});

test("CLI 는 칼로리가 없으면 탄단지에서 되짚는다", () => {
  const food = makeFood({ name: "  삶은 계란 ", carb: 0.6, protein: 6.3, fat: 5.3 });
  assert.equal(food.name, "삶은 계란");
  assert.equal(food.unit, "1인분");
  assert.equal(food.kcal, kcalFromMacros({ carb: 0.6, protein: 6.3, fat: 5.3 }));
  assert.throws(() => makeFood({ carb: 1 }), /--name/);
  assert.throws(() => makeFood({ name: "빈 것" }), /하나는 있어야/);
  assert.throws(() => makeFood({ name: "이상", kcal: -5 }), /범위/);
  // 0kcal 은 값이 없는 것이 아니다 — 제로 음료·물·블랙커피가 그렇다.
  const zero = makeFood({ name: "갈배사이다 제로", brand: "해태", unit: "355ml", kcal: 0, carb: 0, protein: 0, fat: 0 });
  assert.deepEqual([zero.kcal, zero.carb, zero.brand], [0, 0, "해태"]);
});

test("음식표는 이름순으로 다시 적는다 — diff 가 지저분해지지 않게", () => {
  const text = render([
    { name: "하나", unit: "1개", kcal: 10, carb: 1, protein: 1, fat: 0 },
    { name: "가나", unit: "1개", kcal: 20, carb: 2, protein: 2, fat: 0 },
  ]);
  assert.equal(text.indexOf('"가나"') < text.indexOf('"하나"'), true);
  assert.match(text, /export const FOODS = \[/);
  assert.match(text, /^\/\/ life\/kcal 의 음식표/, "머리말 주석이 살아 있다");
});

/* ── 태운 것 ───────────────────────────────────────────────────── */

test("소모는 MET × 몸무게 × 시간으로 센다", () => {
  // 8 MET × 3.5 × 78kg ÷ 200 = 10.92 kcal/분 → 30분이면 328
  assert.equal(burn({ met: 8, minutes: 30, weight: 78 }), 328);
  // 같은 운동이라도 무거운 사람이 더 태운다 — 분당 고정 표를 두지 않은 이유다.
  assert.equal(burn({ met: 8, minutes: 30, weight: 55 }) < burn({ met: 8, minutes: 30, weight: 90 }), true);
  assert.equal(burn({ met: 8, minutes: 0, weight: 78 }), 0);
  assert.equal(burn({ met: 0, minutes: 30, weight: 0 }), 0, "몸무게가 없으면 셀 수 없다");
});

test("운동은 종목마다 가볍게·중간·열심히 세 강도다", () => {
  const names = [...new Set(EXERCISES.map((one) => one.name))];
  assert.deepEqual(names, ["걷기", "사이클"]);
  for (const name of names) {
    const rows = EXERCISES.filter((one) => one.name === name);
    assert.deepEqual(rows.map((one) => one.effort), ["가볍게", "중간", "열심히"], `${name} 의 강도`);
    // 강도가 셀수록 MET 이 커야 한다 — 뒤집히면 화면이 거짓말을 한다.
    const mets = rows.map((one) => one.met);
    assert.deepEqual([...mets].sort((a, b) => a - b), mets, `${name} 의 MET 차례`);
  }
  // 같은 강도라면 걷기가 사이클보다 덜 태운다.
  const met = (id) => findExercise(id).met;
  assert.equal(met("walk-mid") < met("cycle-mid"), true);
  assert.equal(exerciseLabel(findExercise("walk-mid")), "걷기 · 중간");
  assert.equal(findExercise("없는것"), null);

  // 78kg 이 걷기 중간(MET 3.5)으로 30분이면 143kcal.
  assert.equal(burn({ met: met("walk-mid"), minutes: 30, weight: 78 }), 143);
});

test("태운 만큼 더 먹을 수 있다", () => {
  let state = setGoal(emptyState(at(TODAY)), { kcal: 2000, carb: 250, protein: 100, fat: 67, source: "manual" });
  state = eat(state, TODAY, { name: "샌드위치", kcal: 411, carb: 40, protein: 16, fat: 21, meal: "점심" });
  state = addWorkout(state, { name: "사이클 · 중간", minutes: 30, kcal: 328, on: TODAY }, at(TODAY, 19));

  const report = dayReport(state, TODAY);
  assert.equal(report.burned, 328);
  assert.equal(report.left.kcal, 1917, "2000 + 328 − 411");
  assert.equal(report.over, false);
  assert.equal(report.workouts.length, 1);
  // 목표를 넘겼는지도 태운 것을 넣고 본다.
  const heavy = dayReport(addEntry(state, { name: "치킨", kcal: 2000, on: TODAY }, at(TODAY, 20)), TODAY);
  assert.equal(heavy.over, true);
  assert.equal(heavy.left.kcal, -83);
});

test("운동은 이름과 태운 칼로리가 있어야 기록이 된다", () => {
  const state = emptyState(at(TODAY));
  assert.throws(() => addWorkout(state, { name: " ", kcal: 300, on: TODAY }, at(TODAY)), /무엇을/);
  assert.throws(() => addWorkout(state, { name: "산책", kcal: 0, on: TODAY }, at(TODAY)), /시간을 적어주세요/);
  assert.deepEqual(validateWorkout({ name: "사이클", kcal: 100, on: TODAY }), []);
});

test("운동도 고치고 지우는 것은 id 로만 한다", () => {
  let state = addWorkout(emptyState(at(TODAY)), { name: "사이클 · 중간", minutes: 30, kcal: 328, on: TODAY }, at(TODAY));
  const [first] = state.workouts;
  state = editWorkout(state, first.id, { minutes: 45, kcal: 492 });
  assert.equal(state.workouts[0].kcal, 492);
  assert.equal(state.workouts[0].at, first.at, "적은 시각은 그대로 둔다");
  assert.equal(workoutsOn(state, TODAY).length, 1);
  assert.equal(removeWorkout(state, first.id).workouts.length, 0);
  assert.throws(() => editWorkout(state, "없는id", { kcal: 1 }), /없습니다/);
});

test("운동을 붙이기 전 저장본도 그대로 열린다", () => {
  // 옛 저장본에는 workouts 칸이 없다 — 없으면 빈 배열로 연다.
  const parsed = parseState(JSON.stringify({
    v: 1, profile: emptyProfile(), goal: { source: "auto" },
    entries: [{ id: "a", name: "밥", kcal: 310, on: TODAY, at: `${TODAY}T00:00:00Z` }],
  }));
  assert.deepEqual(parsed.workouts, []);
  assert.equal(dayReport(parsed, TODAY).burned, 0);
  assert.equal(burned([]), 0);
});

/* ── 여러 개를 한 번에, 그리고 지금 끼니 ────────────────────────── */
test("여러 개를 한 번에 담는다", () => {
  const { state, added } = addEntries(emptyState(), [
    { name: "햄에그 샌드위치", kcal: 324, carb: 44, protein: 12, fat: 11, meal: "점심", on: "2026-08-25" },
    { name: "", kcal: 100, meal: "점심", on: "2026-08-25" },           // 이름이 없으면 담기지 않는다
    { name: "아메리카노", kcal: 10, carb: 2, protein: 1, fat: 0, meal: "점심", on: "2026-08-25" },
  ]);
  assert.equal(added, 2, "틀린 한 건 때문에 나머지를 버리지 않는다");
  assert.equal(state.entries.length, 2);
  assert.equal(totals(entriesOn(state, "2026-08-25")).kcal, 334);
  assert.equal(addEntries(state, []).added, 0);
});

test("지금이 어느 끼니인지로 펼 칸을 정한다", () => {
  // KST 기준 시각으로 본다(브라우저 시간대가 무엇이든).
  const at = (hour) => new Date(Date.UTC(2026, 7, 25, (hour + 24 - 9) % 24, 30));
  assert.equal(kstHour(at(13)), 13);
  assert.equal(mealNow(at(7)), "아침");
  assert.equal(mealNow(at(10)), "아침");
  assert.equal(mealNow(at(11)), "점심");
  assert.equal(mealNow(at(15)), "점심");
  assert.equal(mealNow(at(16)), "저녁");
  assert.equal(mealNow(at(21)), "저녁");
  // 밤과 새벽은 어느 끼니도 아니다 — 그때는 간식이 열린다.
  assert.equal(mealNow(at(23)), "간식");
  assert.equal(mealNow(at(2)), "간식");
  assert.equal(MEALS.includes(mealNow()), true);
});
