import {
  ACTIVITY, AIMS, MEALS, SPLITS, addEntry, autoGoal, bmr, dayReport, editEntry, emptyState,
  kstDate, macrosFor, parseState, removeEntry, scaleFood, searchFoods, setGoal,
  setProfile, shiftDate, tdee,
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
  $("eaten-line").textContent =
    `${kcal(report.eaten.kcal)} / ${kcal(report.goal.kcal)} kcal 먹음`
    + (report.goal.source === "manual" ? " · 직접 정한 목표" : "");

  renderMacro("carb", report, "탄수화물");
  renderMacro("protein", report, "단백질");
  renderMacro("fat", report, "지방");
  renderMeals(report);
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
    const head = node("div", "meal-head");
    head.append(
      node("span", "meal-name", meal),
      node("span", "meal-total", total.kcal ? `${kcal(total.kcal)} kcal` : ""),
    );
    const list = node("ul", "meal-items");
    list.append(...items.map((entry) => entryRow(entry)));

    const add = node("button", "meal-add", "＋ 담기");
    add.type = "button";
    add.addEventListener("click", () => openPicker(meal));
    section.append(head, list, add);
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
  $("search").value = "";
  renderResults("");
  $("picker").showModal();
}

function renderResults(query) {
  const found = searchFoods(query, { foods: FOODS, state }).slice(0, 20);
  $("picker-empty").hidden = found.length > 0;
  $("results").replaceChildren(...found.map((food) => {
    const item = node("li", "result");
    const button = node("button", "result-button");
    button.type = "button";
    const body = node("span", "item-body");
    body.append(
      node("span", "item-name", food.name),
      node("span", "item-macros",
        [food.brand, food.unit, `탄 ${gram(food.carb)} · 단 ${gram(food.protein)} · 지 ${gram(food.fat)}`]
          .filter(Boolean).join(" · ")),
    );
    button.append(body, node("span", "item-kcal", `${kcal(food.kcal)}`));
    button.addEventListener("click", () => {
      $("picker").close();
      openEditor({ ...scaleFood(food, 1), meal: draftMeal });
    });
    item.append(button);
    return item;
  }));
}

$("search").addEventListener("input", () => renderResults($("search").value));
$("picker-cancel").addEventListener("click", () => $("picker").close());
$("picker-new").addEventListener("click", () => {
  $("picker").close();
  openEditor({ name: $("search").value, meal: draftMeal, kcal: 0, carb: 0, protein: 0, fat: 0 });
});

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
$("editor-cancel").addEventListener("click", () => $("editor").close());
$("editor").addEventListener("close", () => { editing = null; });

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

$("goal-cancel").addEventListener("click", () => $("goal").close());
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
