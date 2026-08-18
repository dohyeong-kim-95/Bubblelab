// 팔굽혀펴기 100개까지의 훈련 계획. 화면과 테스트가 같이 쓰는 순수 함수만 둔다 —
// 저장은 localStorage(app.js)이고 서버로 나가는 것은 없다.
//
// 구조는 널리 쓰이는 6주 프로그램(hundredpushups.com)에서 가져왔다: 한 회차는
// 5세트, 세트 사이 60초 휴식, 마지막 세트는 "최대한". 다만 수치를 표로 박아 두지
// 않고 현재 최대량에서 만들어 낸다 — 그래야 언제 다시 재어도 그 값에 맞는 계획이
// 나온다(표는 세 칸뿐이라 6개·37개 같은 값에는 줄 것이 없다).

export const GOAL = 100;
export const REST_SECONDS = 60;
export const MAX_INPUT = 300;
export const SESSIONS_PER_WEEK = 3;
// 한 회차에 12% 넘게 올리지 않는다. 더 밀어붙이면 계획이 아니라 희망이 된다.
const GROWTH = 1.12;
// 마지막 "최대한" 세트를 기준으로 한 앞 네 세트의 비율. 원본 표의 1칸(최대 5개
// 미만) 1일차 2·3·2·2·3+ 와 같은 모양이 나온다.
const SHAPE = [0.7, 0.9, 0.6, 0.6];

/* 목표가 커질수록 앞 세트를 줄인다. 비율을 고정하면 마지막 회차가 "70·90·60·60 을
 * 하고 나서 100개"가 되는데, 그건 계획이 아니라 못 할 숙제다. 마지막 한 번을 위해
 * 힘을 남겨 둬야 한다. */
const taper = (target) => Math.max(0.2, 1 - target / (GOAL * 1.1));

const reps = (target, ratio) => Math.max(1, Math.round(target * ratio * taper(target)));

/** 첫 회차의 목표. 자기 최대치로 시작하지 않는다 — 원본도 그렇게 한다. */
export function firstTarget(max) {
  return Math.max(1, Math.round(max * 0.6));
}

export function sessionCount(max) {
  const start = firstTarget(max);
  if (start >= GOAL) return 1;
  return Math.ceil(Math.log(GOAL / start) / Math.log(GROWTH)) + 1;
}

/** 회차 하나. sets 의 마지막은 "최대한"이라 target 이상이면 된다. */
export function sessionAt(max, index) {
  const start = firstTarget(max);
  const total = sessionCount(max);
  const target = total <= 1
    ? GOAL
    : Math.round(start * (GOAL / start) ** (index / (total - 1)));
  return {
    day: index + 1,
    week: Math.floor(index / SESSIONS_PER_WEEK) + 1,
    target,
    sets: [...SHAPE.map((ratio) => reps(target, ratio)), target],
  };
}

export function makePlan(max) {
  const safe = normalizeMax(max);
  return Array.from({ length: sessionCount(safe) }, (_, index) => sessionAt(safe, index));
}

export function normalizeMax(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) throw new Error("한 개 이상으로 적어주세요");
  if (number > MAX_INPUT) throw new Error(`${MAX_INPUT}개까지만 적을 수 있어요`);
  return number;
}

export const totalReps = (session) => session.sets.reduce((sum, count) => sum + count, 0);

export function emptyState(max = 5, now = new Date()) {
  return { v: 1, max: normalizeMax(max), startedAt: now.toISOString(), done: [], log: [] };
}

export function parseState(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || value.v !== 1) return null;
  let max;
  try { max = normalizeMax(value.max); } catch { return null; }
  const total = sessionCount(max);
  return {
    v: 1,
    max,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : new Date().toISOString(),
    // 계획보다 큰 회차 번호는 버린다(재검사로 계획이 짧아졌을 때).
    done: [...new Set((Array.isArray(value.done) ? value.done : [])
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= total))].sort((a, b) => a - b),
    log: (Array.isArray(value.log) ? value.log : []).filter((entry) =>
      entry && typeof entry.at === "string" && Number.isInteger(entry.reps) && entry.reps >= 0),
  };
}

export const isDone = (state, day) => state.done.includes(day);

/** 다음에 할 회차. 다 끝냈으면 null. */
export function nextDay(state) {
  const total = sessionCount(state.max);
  for (let day = 1; day <= total; day += 1) if (!state.done.includes(day)) return day;
  return null;
}

export function completeSession(state, day, reps, now = new Date()) {
  const total = sessionCount(state.max);
  if (!Number.isInteger(day) || day < 1 || day > total) throw new Error("그런 회차가 없습니다");
  return {
    ...state,
    done: [...new Set([...state.done, day])].sort((a, b) => a - b),
    log: [...state.log, { at: now.toISOString(), day, reps: Math.max(0, Math.floor(reps) || 0) }],
  };
}

/* 재검사. 새로 잰 최대량으로 계획을 다시 만든다 — 사다리가 새로 놓이므로 진행은
 * 처음부터다. 다만 지금까지 한 기록(log)은 남긴다. */
export function retest(state, max, now = new Date()) {
  const safe = normalizeMax(max);
  return {
    ...state,
    max: safe,
    startedAt: now.toISOString(),
    done: [],
    log: [...state.log, { at: now.toISOString(), test: true, reps: safe }],
  };
}

export const bestRecord = (state) => state.log.reduce((best, entry) => Math.max(best, entry.reps ?? 0), 0);
