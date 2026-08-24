// 하루에 먹은 것과 탄단지. 화면과 _infra/kcal.test.mjs 가 같이 쓰는 순수 함수만 둔다 —
// 저장은 localStorage(app.js)이고 서버로 나가는 것은 없다.
//
// 이 화면이 답하려는 것은 "오늘 더 먹어도 되나"다. 그래서 합계보다 **남은 것**이
// 먼저 나오고, 탄단지는 그램이 아니라 목표 대비 얼마나 찼는지로 보여 준다.

export const NAME_MAX = 40;
export const KCAL_MAX = 10_000;      // 한 끼에 이보다 많을 리 없다 — 오타를 거른다
export const GRAM_MAX = 2_000;
export const MEALS = ["아침", "점심", "저녁", "간식"];
export const DEFAULT_MEAL = "간식";

const KST = "Asia/Seoul";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/* 열량 환산. 탄단지에서 칼로리를 되짚을 때 쓴다(Atwater 계수). */
export const KCAL_PER_GRAM = { carb: 4, protein: 4, fat: 9 };

export function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

export const isDate = (value) => DATE.test(value ?? "");
const dayNumber = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
export const shiftDate = (date, days) => new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

/* ── 몸 정보와 목표 ─────────────────────────────────────────────────
 * 기초대사량은 Mifflin-St Jeor 다(1990). 지금 가장 널리 쓰이고, 옛 Harris-Benedict
 * 보다 현대 체형에서 오차가 작다. 어차피 추정이라 화면에서 직접 덮어쓸 수 있다. */

export const ACTIVITY = [
  { id: "sedentary", label: "거의 안 움직임", factor: 1.2, hint: "종일 앉아 있음" },
  { id: "light", label: "가볍게", factor: 1.375, hint: "주 1–3회 운동" },
  { id: "moderate", label: "보통", factor: 1.55, hint: "주 3–5회 운동" },
  { id: "active", label: "많이", factor: 1.725, hint: "주 6–7회 운동" },
  { id: "athlete", label: "아주 많이", factor: 1.9, hint: "몸 쓰는 일 · 하루 두 번" },
];

export const AIMS = [
  { id: "lose", label: "감량", ratio: 0.8 },
  { id: "keep", label: "유지", ratio: 1 },
  { id: "gain", label: "증량", ratio: 1.1 },
];

/** 탄단지 비율(열량 기준). 인아웃처럼 식단 유형을 고르면 그램이 따라온다. */
export const SPLITS = [
  { id: "normal", label: "일반", carb: 0.5, protein: 0.2, fat: 0.3 },
  { id: "workout", label: "운동", carb: 0.4, protein: 0.3, fat: 0.3 },
  { id: "highProtein", label: "고단백", carb: 0.35, protein: 0.35, fat: 0.3 },
  { id: "keto", label: "저탄고지", carb: 0.1, protein: 0.25, fat: 0.65 },
];

export const findActivity = (id) => ACTIVITY.find((one) => one.id === id) ?? ACTIVITY[0];
export const findAim = (id) => AIMS.find((one) => one.id === id) ?? AIMS[1];
export const findSplit = (id) => SPLITS.find((one) => one.id === id) ?? SPLITS[0];

export function emptyProfile() {
  return { sex: "male", age: 30, height: 170, weight: 70, activity: "light", aim: "keep", split: "normal" };
}

export function normalizeProfile(profile = {}) {
  const base = emptyProfile();
  const number = (value, fallback, min, max) => {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
  };
  return {
    sex: profile.sex === "female" ? "female" : "male",
    age: number(profile.age, base.age, 10, 100),
    height: number(profile.height, base.height, 120, 230),
    weight: number(profile.weight, base.weight, 30, 250),
    activity: findActivity(profile.activity).id,
    aim: findAim(profile.aim).id,
    split: findSplit(profile.split).id,
  };
}

/** 기초대사량(kcal/일). Mifflin-St Jeor. */
export function bmr(profile) {
  const { sex, weight, height, age } = normalizeProfile(profile);
  const base = 10 * weight + 6.25 * height - 5 * age;
  return Math.round(sex === "female" ? base - 161 : base + 5);
}

/** 활동량까지 더한 하루 소모(kcal/일). */
export const tdee = (profile) => Math.round(bmr(profile) * findActivity(profile?.activity).factor);

/**
 * 몸 정보로 계산한 하루 목표. 감량이라도 기초대사량 아래로는 내려가지 않는다 —
 * 그 아래는 목표가 아니라 굶는 것이다.
 */
export function autoGoal(profile) {
  const normalized = normalizeProfile(profile);
  const target = Math.max(Math.round(tdee(normalized) * findAim(normalized.aim).ratio), bmr(normalized));
  return { kcal: target, ...macrosFor(target, normalized.split), source: "auto" };
}

/** 목표 열량을 탄단지 그램으로 나눈다. */
export function macrosFor(kcal, splitId) {
  const split = findSplit(splitId);
  const total = Math.max(Math.round(Number(kcal) || 0), 0);
  return {
    carb: Math.round((total * split.carb) / KCAL_PER_GRAM.carb),
    protein: Math.round((total * split.protein) / KCAL_PER_GRAM.protein),
    fat: Math.round((total * split.fat) / KCAL_PER_GRAM.fat),
  };
}

export function normalizeGoal(goal, profile) {
  if (!goal || typeof goal !== "object" || goal.source !== "manual") return autoGoal(profile);
  const number = (value, max) => Math.min(Math.max(Math.round(Number(value) || 0), 0), max);
  return {
    kcal: number(goal.kcal, KCAL_MAX),
    carb: number(goal.carb, GRAM_MAX),
    protein: number(goal.protein, GRAM_MAX),
    fat: number(goal.fat, GRAM_MAX),
    source: "manual",
  };
}

/* ── 먹은 것 ───────────────────────────────────────────────────── */

export function makeEntry(fields = {}, now = new Date()) {
  return normalizeEntry({
    id: crypto.randomUUID(),
    name: "",
    amount: 1,
    unit: "인분",
    kcal: 0,
    carb: 0,
    protein: 0,
    fat: 0,
    meal: DEFAULT_MEAL,
    on: kstDate(now),
    at: now.toISOString(),
    ...fields,
  });
}

export function normalizeEntry(entry) {
  const gram = (value) => Math.min(Math.max(round(value, 1), 0), GRAM_MAX);
  return {
    id: typeof entry?.id === "string" && entry.id ? entry.id : crypto.randomUUID(),
    name: clean(entry?.name, NAME_MAX),
    amount: Math.min(Math.max(round(entry?.amount, 2) || 1, 0.1), 99),
    unit: clean(entry?.unit, 8) || "인분",
    kcal: Math.min(Math.max(Math.round(Number(entry?.kcal) || 0), 0), KCAL_MAX),
    carb: gram(entry?.carb),
    protein: gram(entry?.protein),
    fat: gram(entry?.fat),
    ...(clean(entry?.brand, NAME_MAX) ? { brand: clean(entry.brand, NAME_MAX) } : {}),
    meal: MEALS.includes(entry?.meal) ? entry.meal : DEFAULT_MEAL,
    on: isDate(entry?.on) ? entry.on : kstDate(),
    at: typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
  };
}

export function validateEntry(entry) {
  const errors = [];
  if (!clean(entry?.name, NAME_MAX)) errors.push("무엇을 먹었는지 적어주세요");
  const kcal = Math.round(Number(entry?.kcal));
  if (!Number.isFinite(kcal) || kcal < 0) errors.push("칼로리를 숫자로 적어주세요");
  else if (kcal > KCAL_MAX) errors.push("칼로리가 너무 큽니다");
  if (!isDate(entry?.on)) errors.push("날짜가 올바르지 않습니다");
  return errors;
}

/** 1인분 값에 수량을 곱한다. 표에 있는 음식도, 내가 적어 둔 것도 같은 길로 담긴다. */
export function scaleFood(food, amount = 1) {
  const times = Math.min(Math.max(round(amount, 2) || 1, 0.1), 99);
  return {
    name: food?.name ?? "",
    ...(food?.brand ? { brand: food.brand } : {}),
    unit: food?.unit ?? "인분",
    amount: times,
    kcal: Math.round((Number(food?.kcal) || 0) * times),
    carb: round((Number(food?.carb) || 0) * times, 1),
    protein: round((Number(food?.protein) || 0) * times, 1),
    fat: round((Number(food?.fat) || 0) * times, 1),
  };
}

/**
 * 탄단지만 알고 칼로리를 모를 때 되짚는다(4·4·9). 표기 열량이 있으면 그걸 쓰고,
 * 없을 때만 이 값을 채운다 — 실제 식품은 식이섬유·알코올 때문에 조금 어긋난다.
 */
export const kcalFromMacros = ({ carb = 0, protein = 0, fat = 0 } = {}) =>
  Math.round(carb * KCAL_PER_GRAM.carb + protein * KCAL_PER_GRAM.protein + fat * KCAL_PER_GRAM.fat);

/* ── 상태 ─────────────────────────────────────────────────────── */

export function emptyState(now = new Date()) {
  const profile = emptyProfile();
  return { v: 1, profile, goal: autoGoal(profile), entries: [], startedOn: kstDate(now) };
}

export function parseState(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || value.v !== 1) return null;
  const profile = normalizeProfile(value.profile);
  return {
    v: 1,
    profile,
    goal: normalizeGoal(value.goal, profile),
    entries: (Array.isArray(value.entries) ? value.entries : [])
      .map(normalizeEntry)
      .filter((entry) => validateEntry(entry).length === 0),
    startedOn: isDate(value.startedOn) ? value.startedOn : kstDate(),
  };
}

export function addEntry(state, fields, now = new Date()) {
  const entry = makeEntry(fields, now);
  const errors = validateEntry(entry);
  if (errors.length) throw new Error(errors[0]);
  return { ...state, entries: [...state.entries, entry] };
}

export function editEntry(state, id, fields) {
  const found = state.entries.find((entry) => entry.id === id);
  if (!found) throw new Error("그런 기록이 없습니다");
  const next = normalizeEntry({ ...found, ...fields, id: found.id, at: found.at });
  const errors = validateEntry(next);
  if (errors.length) throw new Error(errors[0]);
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? next : entry)) };
}

export const removeEntry = (state, id) =>
  ({ ...state, entries: state.entries.filter((entry) => entry.id !== id) });

export function setProfile(state, profile) {
  const normalized = normalizeProfile(profile);
  // 목표를 직접 적어 둔 사람의 숫자를 몸 정보가 덮어쓰지 않는다.
  const goal = state.goal?.source === "manual" ? state.goal : autoGoal(normalized);
  return { ...state, profile: normalized, goal };
}

export const setGoal = (state, goal) => ({ ...state, goal: normalizeGoal(goal, state.profile) });
export const useAutoGoal = (state) => ({ ...state, goal: autoGoal(state.profile) });

/* ── 세기 ─────────────────────────────────────────────────────── */

export const entriesOn = (state, date) => state.entries
  .filter((entry) => entry.on === date)
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));

export function totals(entries) {
  return entries.reduce((sum, entry) => ({
    kcal: sum.kcal + entry.kcal,
    carb: round(sum.carb + entry.carb, 1),
    protein: round(sum.protein + entry.protein, 1),
    fat: round(sum.fat + entry.fat, 1),
  }), { kcal: 0, carb: 0, protein: 0, fat: 0 });
}

/** 끼니별로 묶는다. 먹은 것이 없는 끼니도 자리를 지킨다 — 거기 눌러 담는다. */
export function byMeal(entries) {
  return MEALS.map((meal) => {
    const items = entries.filter((entry) => entry.meal === meal);
    return { meal, items, total: totals(items) };
  });
}

/** 하루치 요약. 남은 것이 먼저다. */
export function dayReport(state, date = kstDate()) {
  const entries = entriesOn(state, date);
  const eaten = totals(entries);
  const goal = state.goal;
  const share = (value, target) => (target > 0 ? value / target : 0);
  return {
    date, entries, eaten, goal,
    left: {
      kcal: goal.kcal - eaten.kcal,
      carb: round(goal.carb - eaten.carb, 1),
      protein: round(goal.protein - eaten.protein, 1),
      fat: round(goal.fat - eaten.fat, 1),
    },
    share: {
      kcal: share(eaten.kcal, goal.kcal),
      carb: share(eaten.carb, goal.carb),
      protein: share(eaten.protein, goal.protein),
      fat: share(eaten.fat, goal.fat),
    },
    meals: byMeal(entries),
    over: eaten.kcal > goal.kcal,
  };
}

/**
 * 자주 먹는 것. 따로 즐겨찾기를 만들지 않는다 — 적어 둔 기록에서 뽑으면 손이 하나
 * 줄고, 즐겨찾기와 기록이 어긋날 일도 없다. 최근에 먹은 것을 앞으로 올린다.
 */
export function frequentFoods(state, limit = 12, today = kstDate()) {
  const seen = new Map();
  for (const entry of state.entries) {
    const key = entry.name.toLowerCase();
    if (!key) continue;
    const found = seen.get(key);
    if (!found) { seen.set(key, { ...entry, count: 1, lastOn: entry.on }); continue; }
    found.count += 1;
    if (entry.on >= found.lastOn) {
      // 같은 이름이라도 마지막에 먹은 양·영양값을 쓴다(레시피를 고쳤을 수 있다).
      Object.assign(found, entry, { count: found.count, lastOn: entry.on });
    }
  }
  return [...seen.values()]
    .map((food) => ({ ...food, days: Math.max(daysBetween(food.lastOn, today), 0) }))
    // 자주 먹을수록, 최근일수록 위로. 한 달 지난 것은 사실상 밀린다.
    .sort((a, b) => (b.count - b.days / 7) - (a.count - a.days / 7)
      || String(b.lastOn).localeCompare(String(a.lastOn)))
    .slice(0, limit);
}

/**
 * 음식 찾기. 내가 적어 둔 것이 먼저, 그다음이 리포에 실린 음식표다.
 *
 * 같은 이름이 양쪽에 있으면 **내 기록만 보여 준다** — 표의 값과 내가 마지막에 담은 값이
 * 나란히 뜨면 어느 쪽이 내 것인지 알 수 없다(실제로 목록에 같은 것이 두 번 떴다).
 * 표끼리는 회사가 다르면 다른 제품이라 둘 다 남긴다.
 */
export function searchFoods(query, { foods = [], state } = {}) {
  const needle = clean(query, NAME_MAX).toLowerCase();
  const mine = state ? frequentFoods(state, 100) : [];
  const matches = (food) => !needle || `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(needle);

  const mineNames = new Set();
  const rows = [];
  for (const food of mine) {
    const key = food.name.toLowerCase();
    if (mineNames.has(key)) continue;
    mineNames.add(key);
    if (matches(food)) rows.push({ ...food, from: "mine" });
  }

  const seen = new Set();
  for (const food of foods) {
    const name = food.name.toLowerCase();
    const key = `${name}|${(food.brand ?? "").toLowerCase()}`;
    if (mineNames.has(name) || seen.has(key)) continue;
    seen.add(key);
    if (matches(food)) rows.push({ ...food, from: "table" });
  }
  return rows.slice(0, 30);
}
