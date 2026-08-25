import {
  ACTIVITY, AIMS, EXERCISES, MEALS, SPLITS, addEntries, addEntry, addWorkout, autoGoal, bmr, burn,
  dayReport, editEntry, editWorkout, emptyState, exerciseLabel, findExercise, kstDate, macrosFor,
  mealNow,
  parseState, removeEntry, removeWorkout, scaleFood, searchFoods, setGoal, setProfile, shiftDate,
  tdee,
} from "./store.js";
import { FOODS } from "./foods.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "bl_kcal_v1";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

let state = load();
let day = kstDate();
let editing = null;      // 고치는 중인 기록의 id. 새로 담는 중이면 null
let draftMeal = null;    // 어느 끼니에 담는 중인가
let draftBrand = "";     // 고른 제품의 회사(입력칸은 없고 따라만 간다)
let picked = new Map();  // 고르는 화면에서 눌러 둔 것들 — 한 번에 담는다
/* 지금 끼니만 펴 둔다. 네 칸을 다 펴 두면 적을 자리를 매번 찾아 내려가야 한다. */
let openMeals = new Set([mealNow()]);
let editingWorkout = null;
let draftExercise = null;   // 고른 강도. 시간이 바뀌면 여기서 다시 계산한다
let manualBurn = false;     // 칼로리를 직접 고쳤으면 다시 계산하지 않는다

function load() {
  try { return parseState(localStorage.getItem(STORAGE_KEY)) ?? emptyState(); }
  catch { return emptyState(); }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* 저장 공간이 없으면 화면만 유지한다 */ }
}

function update(next) {
  state = next;
  save();
  render();
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

const gram = (value) => `${Math.round(value * 10) / 10}g`;
const kcal = (value) => `${Math.round(value).toLocaleString("ko-KR")}`;

/* ── 화면 ───────────────────────────────────────────────────────
 * "오늘 더 먹어도 되나" 가 이 화면의 질문이다. 그래서 합계가 아니라 남은 것이
 * 제일 크고, 탄단지는 그램보다 목표를 얼마나 채웠는지가 먼저 보인다. */
function render() {
  const today = kstDate();
  const report = dayReport(state, day);
  const [, month, date] = day.split("-").map(Number);
  $("day-label").textContent = day === today
    ? `오늘 ${month}/${date} (${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]})`
    : `${month}/${date} (${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
  $("next-day").disabled = day >= today;

  const over = report.left.kcal < 0;
  $("hero-label").textContent = over ? "넘긴 칼로리" : "남은 칼로리";
  $("left-kcal").textContent = kcal(Math.abs(report.left.kcal));
  $("left-kcal").classList.toggle("over", over);
  $("eaten-line").textContent = [
    `${kcal(report.eaten.kcal)} / ${kcal(report.goal.kcal)} kcal 먹음`,
    report.burned ? `${kcal(report.burned)} 태움` : "",
    report.goal.source === "manual" ? "직접 정한 목표" : "",
  ].filter(Boolean).join(" · ");

  renderMacro("carb", report, "탄수화물");
  renderMacro("protein", report, "단백질");
  renderMacro("fat", report, "지방");
  renderMeals(report);
  renderWorkouts(report);
}

/* 운동은 끼니와 같은 모양으로 붙인다 — 하루를 한 화면에서 보려면 자리가 따로 있으면 안 된다. */
function renderWorkouts(report) {
  const section = node("section", "meal");
  const head = node("div", "meal-head");
  head.append(
    node("span", "meal-name", "운동"),
    node("span", "meal-total", report.burned ? `−${kcal(report.burned)} kcal` : ""),
  );
  const list = node("ul", "meal-items");
  list.append(...report.workouts.map((workout) => {
    const item = node("li", "meal-item");
    const button = node("button", "meal-item-button");
    button.type = "button";
    const body = node("span", "item-body");
    body.append(
      node("span", "item-name", workout.name),
      node("span", "item-macros", `${workout.minutes}분`),
    );
    button.append(body, node("span", "item-kcal burn", `−${kcal(workout.kcal)}`));
    button.addEventListener("click", () => openExercise(workout));
    item.append(button);
    return item;
  }));

  const add = node("button", "meal-add", "＋ 담기");
  add.type = "button";
  add.addEventListener("click", () => openExercise());
  section.append(head, list, add);
  $("workouts").replaceChildren(section);
}

function renderMacro(key, report, label) {
  const box = $(`macro-${key}`);
  const share = Math.min(Math.max(report.share[key], 0), 1);
  box.querySelector("dt").textContent = label;
  box.querySelector(".macro-grams").textContent = gram(report.eaten[key]);
  box.querySelector(".macro-goal").textContent = ` / ${gram(report.goal[key])}`;
  box.querySelector(".track-fill").style.width = `${share * 100}%`;
  box.classList.toggle("over", report.eaten[key] > report.goal[key]);
}

function renderMeals(report) {
  $("meals").replaceChildren(...report.meals.map(({ meal, items, total }) => {
    const section = node("section", "meal");
    const open = openMeals.has(meal);

    /* 머리줄이 곧 여닫는 버튼이다. 접었을 때도 몇 개·몇 kcal 인지는 남겨 둔다 —
     * 접힌 칸이 빈 칸처럼 보이면 안 적은 줄 알고 두 번 담게 된다. */
    const head = node("button", `meal-head${open ? " open" : ""}`);
    head.type = "button";
    head.setAttribute("aria-expanded", String(open));
    head.append(
      node("span", "meal-caret", open ? "▾" : "▸"),
      node("span", "meal-name", meal),
      node("span", "meal-total", [
        !open && items.length ? `${items.length}개` : "",
        total.kcal ? `${kcal(total.kcal)} kcal` : "",
      ].filter(Boolean).join(" · ")),
    );
    head.addEventListener("click", () => {
      if (open) openMeals.delete(meal); else openMeals.add(meal);
      render();
    });
    section.append(head);

    if (open) {
      const list = node("ul", "meal-items");
      list.append(...items.map((entry) => entryRow(entry)));
      const add = node("button", "meal-add", "＋ 담기");
      add.type = "button";
      add.addEventListener("click", () => openPicker(meal));
      section.append(list, add);
    }
    return section;
  }));
}

function entryRow(entry) {
  const item = node("li", "meal-item");
  const button = node("button", "meal-item-button");
  button.type = "button";
  const body = node("span", "item-body");
  body.append(
    node("span", "item-name", entry.amount === 1 ? entry.name : `${entry.name} × ${entry.amount}`),
    node("span", "item-macros", `탄 ${gram(entry.carb)} · 단 ${gram(entry.protein)} · 지 ${gram(entry.fat)}`),
  );
  button.append(body, node("span", "item-kcal", `${kcal(entry.kcal)}`));
  button.addEventListener("click", () => openEditor(entry));
  item.append(button);
  return item;
}

/* ── 날짜 넘기기 ────────────────────────────────────────────────── */
$("prev-day").addEventListener("click", () => { day = shiftDate(day, -1); render(); });
$("next-day").addEventListener("click", () => {
  if (day >= kstDate()) return;
  day = shiftDate(day, 1);
  render();
});

/* ── 무엇을 먹었나 고르기 ──────────────────────────────────────── */
function openPicker(meal) {
  draftMeal = meal;
  picked = new Map();
  $("search").value = "";
  renderResults("");
  $("picker").showModal();
}

/** 같은 이름·회사면 같은 것으로 본다 — 찾기를 다시 해도 눌러 둔 것이 풀리지 않게. */
const foodKey = (food) => `${food.name}|${food.brand ?? ""}`;

function renderResults(query) {
  const found = searchFoods(query, { foods: FOODS, state }).slice(0, 20);
  $("picker-empty").hidden = found.length > 0;
  $("results").replaceChildren(...found.map((food) => {
    const item = node("li", "result");
    const on = picked.has(foodKey(food));
    const button = node("button", `result-button${on ? " picked" : ""}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(on));
    // 네모 하나가 "여러 개를 고를 수 있다" 는 말을 대신한다.
    button.append(node("span", "pick-box", on ? "✓" : ""));
    const body = node("span", "item-body");
    body.append(
      node("span", "item-name", food.name),
      node("span", "item-macros",
        [food.brand, food.unit, `탄 ${gram(food.carb)} · 단 ${gram(food.protein)} · 지 ${gram(food.fat)}`]
          .filter(Boolean).join(" · ")),
    );
    button.append(body, node("span", "item-kcal", `${kcal(food.kcal)}`));
    button.addEventListener("click", () => {
      const key = foodKey(food);
      if (picked.has(key)) picked.delete(key); else picked.set(key, food);
      renderResults($("search").value);
    });
    item.append(button);
    return item;
  }));
  showPicked();
}

/* 고른 것이 몇 개이고 합이 얼마인지. 하나만 골랐으면 양을 정하러 갈 수도 있다
 * (여러 개는 1인분으로 담고, 다르면 담긴 줄을 눌러 고친다). */
function showPicked() {
  const rows = [...picked.values()];
  const sum = rows.reduce((total, food) => total + food.kcal, 0);
  /* 개수에 따라 자리를 바꾸지 않는다 — 버튼이 나타났다 사라지면 누르려던 자리가
   * 매번 달라진다. 바뀌는 것은 이 한 줄의 글과 버튼이 눌리는지 여부뿐이다. */
  $("picker-count").textContent = rows.length
    ? `${rows.length}개 고름 · ${kcal(sum)} kcal · 1인분씩 담깁니다`
    : "눌러서 고릅니다 · 여러 개를 한 번에 담을 수 있어요";
  for (const id of ["picker-save", "picker-save-top"]) $(id).disabled = rows.length === 0;
  $("picker-amount").disabled = rows.length !== 1;
}

function takePicked() {
  const drafts = [...picked.values()].map((food) => ({ ...scaleFood(food, 1), meal: draftMeal, on: day }));
  const { state: next, added } = addEntries(state, drafts);
  openMeals.add(draftMeal);        // 담은 것이 접힌 칸에 숨지 않게
  $("picker").close();
  if (added) update(next);
}

$("search").addEventListener("input", () => renderResults($("search").value));
function newFood() {
  $("picker").close();
  openMeals.add(draftMeal);
  openEditor({ name: $("search").value, meal: draftMeal, kcal: 0, carb: 0, protein: 0, fat: 0 });
}

/** 하나만 골랐을 때 양·끼니를 정하러 가는 길. 옛 흐름이 그대로 남는다. */
function pickedToEditor() {
  const [food] = [...picked.values()];
  if (!food) return;
  $("picker").close();
  openMeals.add(draftMeal);
  openEditor({ ...scaleFood(food, 1), meal: draftMeal });
}

/* 취소·담기는 위아래 두 곳에 있다 — 키보드가 올라오면 아래 것이 가려져서 키보드를
 * 내렸다가 눌러야 했다(실기기에서 걸린 불편이다). 같은 일을 하는 버튼이라 함께 묶는다. */
for (const id of ["picker-cancel", "picker-cancel-top"]) {
  $(id).addEventListener("click", () => $("picker").close());
}
$("picker-new").addEventListener("click", newFood);
$("picker-amount").addEventListener("click", pickedToEditor);
for (const id of ["picker-save", "picker-save-top"]) {
  $(id).addEventListener("click", takePicked);
}

/* ── 양과 끼니를 정해 담기 ─────────────────────────────────────── */
function openEditor(entry) {
  editing = entry.id ?? null;
  draftBrand = entry.brand ?? "";
  const per = entry.amount && entry.amount !== 1
    ? scaleFood(entry, 1 / entry.amount)      // 저장된 것은 이미 곱해진 값이라 1인분으로 되돌린다
    : entry;
  $("editor-title").textContent = editing ? "먹은 것 고치기" : "먹은 것 담기";
  $("editor-name").value = entry.name ?? "";
  $("editor-amount").value = String(entry.amount ?? 1);
  $("editor-unit").value = entry.unit ?? "인분";
  $("editor-kcal").value = String(Math.round(per.kcal ?? 0));
  $("editor-carb").value = String(per.carb ?? 0);
  $("editor-protein").value = String(per.protein ?? 0);
  $("editor-fat").value = String(per.fat ?? 0);
  $("editor-meal").replaceChildren(...MEALS.map((meal) => {
    const option = document.createElement("option");
    option.value = meal;
    option.textContent = meal;
    option.selected = meal === (entry.meal ?? draftMeal);
    return option;
  }));
  $("editor-delete").hidden = !editing;
  $("editor-error").textContent = "";
  showTotal();
  $("editor").showModal();
}

/** 1인분 값 × 수량이 실제로 담기는 값이다 — 담기 전에 보여 준다. */
function draftFromForm() {
  return scaleFood({
    name: $("editor-name").value,
    ...(draftBrand ? { brand: draftBrand } : {}),
    unit: $("editor-unit").value,
    kcal: $("editor-kcal").value,
    carb: $("editor-carb").value,
    protein: $("editor-protein").value,
    fat: $("editor-fat").value,
  }, $("editor-amount").value);
}

function showTotal() {
  const draft = draftFromForm();
  $("unit-echo").textContent = $("editor-unit").value || "인분";
  $("editor-total").textContent = `담기는 값: ${kcal(draft.kcal)} kcal · `
    + `탄 ${gram(draft.carb)} · 단 ${gram(draft.protein)} · 지 ${gram(draft.fat)}`;
}

for (const id of ["editor-amount", "editor-kcal", "editor-carb", "editor-protein", "editor-fat", "editor-unit"]) {
  $(id).addEventListener("input", showTotal);
}

$("editor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const draft = { ...draftFromForm(), meal: $("editor-meal").value, on: day };
  try {
    update(editing ? editEntry(state, editing, draft) : addEntry(state, draft));
    $("editor").close();
  } catch (error) {
    $("editor-error").textContent = error.message;
  }
});
$("editor-delete").addEventListener("click", () => {
  if (editing) update(removeEntry(state, editing));
  $("editor").close();
});
for (const id of ["editor-cancel", "editor-cancel-top"]) {
  $(id).addEventListener("click", () => $("editor").close());
}
$("editor").addEventListener("close", () => { editing = null; });
$("picker").addEventListener("close", () => { picked = new Map(); });

/* ── 태운 것 ───────────────────────────────────────────────────── */
function openExercise(workout = null) {
  editingWorkout = workout?.id ?? null;
  // 새로 담을 때 어디에 서 있을지. 목록이 길어져도 자리가 흔들리지 않게 id 로 집는다.
  draftExercise = workout ? null : findExercise("walk-mid");
  manualBurn = Boolean(workout);
  $("exercise-title").textContent = workout ? "운동 고치기" : "운동 담기";
  $("exercise-minutes").value = String(workout?.minutes ?? 30);
  $("exercise-name").value = workout?.name ?? exerciseLabel(draftExercise);
  $("exercise-kcal").value = String(workout?.kcal ?? 0);
  $("exercise-delete").hidden = !editingWorkout;
  $("exercise-error").textContent = "";
  renderExercises();
  if (!workout) recomputeBurn();
  else showBurnHint();
  $("exercise").showModal();
}

function renderExercises() {
  $("exercise-list").replaceChildren(...EXERCISES.map((exercise) => {
    const item = node("li", "result");
    const button = node("button", `result-button${draftExercise?.id === exercise.id ? " picked" : ""}`);
    button.type = "button";
    const body = node("span", "item-body");
    body.append(
      node("span", "item-name", exerciseLabel(exercise)),
      node("span", "item-macros", exercise.hint),
    );
    button.append(body, node("span", "item-kcal",
      `${kcal(burn({ met: exercise.met, minutes: $("exercise-minutes").value, weight: state.profile.weight }))}`));
    button.addEventListener("click", () => {
      draftExercise = exercise;
      manualBurn = false;
      $("exercise-name").value = exerciseLabel(exercise);
      renderExercises();
      recomputeBurn();
    });
    item.append(button);
    return item;
  }));
}

/** 강도와 시간이 바뀌면 다시 센다. 칼로리를 직접 고쳤으면 그 값을 존중한다. */
function recomputeBurn() {
  if (!manualBurn && draftExercise) {
    $("exercise-kcal").value = String(burn({
      met: draftExercise.met, minutes: $("exercise-minutes").value, weight: state.profile.weight,
    }));
  }
  showBurnHint();
  renderExercises();
}

function showBurnHint() {
  $("exercise-hint").textContent = draftExercise
    ? `${state.profile.weight}kg 기준 · MET ${draftExercise.met}`
      + (manualBurn ? " · 칼로리를 직접 고쳤습니다" : "")
    : "몸무게와 시간으로 셉니다. 다른 운동이면 이름과 칼로리를 직접 적으세요.";
}

$("exercise-minutes").addEventListener("input", recomputeBurn);
// 칼로리를 손대면 그때부터 자동 계산을 멈춘다 — 고친 값을 되돌리면 놀란다.
$("exercise-kcal").addEventListener("input", () => { manualBurn = true; showBurnHint(); });

$("exercise-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const draft = {
    name: $("exercise-name").value,
    minutes: $("exercise-minutes").value,
    kcal: $("exercise-kcal").value,
    on: day,
  };
  try {
    update(editingWorkout ? editWorkout(state, editingWorkout, draft) : addWorkout(state, draft));
    $("exercise").close();
  } catch (error) {
    $("exercise-error").textContent = error.message;
  }
});
$("exercise-delete").addEventListener("click", () => {
  if (editingWorkout) update(removeWorkout(state, editingWorkout));
  $("exercise").close();
});
for (const id of ["exercise-cancel", "exercise-cancel-top"]) {
  $(id).addEventListener("click", () => $("exercise").close());
}
$("exercise").addEventListener("close", () => { editingWorkout = null; draftExercise = null; });

/* ── 몸 정보와 목표 ────────────────────────────────────────────── */
function fillOptions(select, rows, selected) {
  select.replaceChildren(...rows.map((row) => {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.hint ? `${row.label} — ${row.hint}` : row.label;
    option.selected = row.id === selected;
    return option;
  }));
}

function profileFromForm() {
  return {
    sex: $("sex").value,
    age: $("age").value,
    height: $("height").value,
    weight: $("weight").value,
    activity: $("activity").value,
    aim: $("aim").value,
    split: $("split").value,
  };
}

function showAuto() {
  const profile = profileFromForm();
  const goal = autoGoal(profile);
  $("auto-line").textContent = `기초대사량 ${kcal(bmr(profile))} · 하루 소모 ${kcal(tdee(profile))}`
    + ` → 권장 ${kcal(goal.kcal)} kcal · 탄 ${goal.carb}g · 단 ${goal.protein}g · 지 ${goal.fat}g`;
  if (!$("manual").checked) {
    $("goal-kcal").value = String(goal.kcal);
    $("goal-carb").value = String(goal.carb);
    $("goal-protein").value = String(goal.protein);
    $("goal-fat").value = String(goal.fat);
  }
}

$("goal-button").addEventListener("click", () => {
  const { profile, goal } = state;
  $("sex").value = profile.sex;
  $("age").value = String(profile.age);
  $("height").value = String(profile.height);
  $("weight").value = String(profile.weight);
  fillOptions($("activity"), ACTIVITY, profile.activity);
  fillOptions($("aim"), AIMS, profile.aim);
  fillOptions($("split"), SPLITS, profile.split);
  $("manual").checked = goal.source === "manual";
  $("manual-fields").hidden = goal.source !== "manual";
  $("goal-kcal").value = String(goal.kcal);
  $("goal-carb").value = String(goal.carb);
  $("goal-protein").value = String(goal.protein);
  $("goal-fat").value = String(goal.fat);
  $("goal-error").textContent = "";
  showAuto();
  $("goal").showModal();
});

for (const id of ["sex", "age", "height", "weight", "activity", "aim", "split"]) {
  $(id).addEventListener("input", showAuto);
}
// 식단만 바꿔도 탄단지가 바로 따라오는 것이 보여야 고르는 뜻이 있다.
$("split").addEventListener("change", showAuto);
$("manual").addEventListener("change", () => {
  $("manual-fields").hidden = !$("manual").checked;
  showAuto();
});

for (const id of ["goal-cancel", "goal-cancel-top"]) {
  $(id).addEventListener("click", () => $("goal").close());
}
$("goal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    let next = setProfile(state, profileFromForm());
    next = $("manual").checked
      ? setGoal(next, {
        kcal: $("goal-kcal").value,
        carb: $("goal-carb").value,
        protein: $("goal-protein").value,
        fat: $("goal-fat").value,
        source: "manual",
      })
      : { ...next, goal: autoGoal(next.profile) };
    update(next);
    $("goal").close();
  } catch (error) {
    $("goal-error").textContent = error.message;
  }
});

// 식단 프리셋을 고르면 직접 적기 칸에도 그 비율이 채워지도록 계산해 둔다.
$("split").addEventListener("change", () => {
  if (!$("manual").checked) return;
  const macros = macrosFor($("goal-kcal").value, $("split").value);
  $("goal-carb").value = String(macros.carb);
  $("goal-protein").value = String(macros.protein);
  $("goal-fat").value = String(macros.fat);
});

render();
