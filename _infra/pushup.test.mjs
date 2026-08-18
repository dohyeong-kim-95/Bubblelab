import test from "node:test";
import assert from "node:assert/strict";

const {
  GOAL, bestRecord, completeSession, emptyState, firstTarget, isDone, makePlan, nextDay,
  normalizeMax, parseState, retest, sessionCount, totalReps,
} = await import("../life/pushup/store.js");

test("최대 5개로 시작한 1일차는 널리 쓰이는 프로그램의 1칸과 같다", () => {
  // hundredpushups.com 1주차 column 1(최대 5개 미만): 2 · 3 · 2 · 2 · 3+
  assert.deepEqual(makePlan(5)[0].sets, [2, 3, 2, 2, 3]);
  assert.equal(firstTarget(5), 3, "자기 최대치로 시작하지 않는다");
});

test("계획은 반드시 100개로 끝난다", () => {
  for (const max of [1, 3, 5, 12, 40, 99]) {
    const plan = makePlan(max);
    assert.equal(plan.at(-1).target, GOAL, `최대 ${max}`);
    assert.ok(plan.length >= 1);
  }
});

test("이미 100개를 하면 계획은 한 회차뿐이다", () => {
  const plan = makePlan(200);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].target, GOAL);
});

test("목표는 회차마다 오르고, 한 번에 12%를 넘지 않는다", () => {
  const plan = makePlan(5);
  for (let i = 1; i < plan.length; i += 1) {
    assert.ok(plan[i].target >= plan[i - 1].target, `${i}회차에서 목표가 내려갔다`);
    assert.ok(plan[i].target <= Math.ceil(plan[i - 1].target * 1.12) + 1,
      `${i}회차 증가폭이 너무 크다: ${plan[i - 1].target} → ${plan[i].target}`);
  }
});

test("목표가 커지면 앞 세트를 덜어낸다 — 마지막 한 번을 위해 힘을 남긴다", () => {
  const plan = makePlan(5);
  const last = plan.at(-1);
  const warmup = totalReps(last) - last.target;
  assert.ok(warmup < last.target,
    `100개 전에 ${warmup}개를 시키면 계획이 아니라 못 할 숙제다`);
  // 앞 세트 합은 중간에 가장 크고 끝에서 줄어든다.
  const warmupOf = (s) => totalReps(s) - s.target;
  assert.ok(warmupOf(plan[Math.floor(plan.length * 0.8)]) > warmupOf(last));
});

test("세트는 항상 다섯이고 마지막이 목표다", () => {
  for (const item of makePlan(5)) {
    assert.equal(item.sets.length, 5);
    assert.equal(item.sets.at(-1), item.target);
    assert.ok(item.sets.every((count) => count >= 1));
  }
});

test("최대량은 1개 이상 300개 이하만 받는다", () => {
  assert.equal(normalizeMax("7"), 7);
  assert.equal(normalizeMax(7.9), 7);
  for (const bad of [0, -3, "", "다섯", NaN, 301]) assert.throws(() => normalizeMax(bad));
});

test("회차를 마치면 기록이 남고 다음 회차로 넘어간다", () => {
  let state = emptyState(5);
  assert.equal(nextDay(state), 1);
  state = completeSession(state, 1, 4, new Date("2026-08-19T00:00:00Z"));
  assert.equal(isDone(state, 1), true);
  assert.equal(nextDay(state), 2);
  assert.equal(state.log.at(-1).reps, 4);
  // 같은 회차를 두 번 눌러도 한 번만 센다.
  state = completeSession(state, 1, 6);
  assert.deepEqual(state.done, [1]);
  assert.equal(bestRecord(state), 6);
  assert.throws(() => completeSession(state, 999, 1), /그런 회차/);
});

test("재검사는 계획을 다시 짜고 진행을 되돌리되 기록은 남긴다", () => {
  let state = emptyState(5);
  state = completeSession(state, 1, 4);
  state = completeSession(state, 2, 5);
  const after = retest(state, 12, new Date("2026-09-01T00:00:00Z"));
  assert.equal(after.max, 12);
  assert.deepEqual(after.done, [], "새 사다리는 1일차부터다");
  assert.equal(after.log.length, 3, "지금까지 한 것은 남는다");
  assert.equal(after.log.at(-1).test, true);
  assert.ok(sessionCount(12) < sessionCount(5), "세지면 남은 회차가 줄어든다");
});

test("저장된 값이 깨졌거나 계획 밖이면 버린다", () => {
  assert.equal(parseState("{"), null);
  assert.equal(parseState(JSON.stringify({ v: 2, max: 5 })), null);
  assert.equal(parseState(JSON.stringify({ v: 1, max: 0 })), null);
  const trimmed = parseState(JSON.stringify({ v: 1, max: 5, done: [1, 1, 999, -3, "2"], log: [{ bad: true }] }));
  assert.deepEqual(trimmed.done, [1], "계획에 없는 회차는 버린다");
  assert.deepEqual(trimmed.log, []);
});
