import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVELS, RANDOM_TOPICS, ROLEPLAYS, SURVEY, TOPICS, buildFirst, buildSecond, pickedItems, surveyProblems,
} from "../opic/questions.js";

const allItems = SURVEY.groups.flatMap(g => g.items.map(([id]) => id));
const survey = (picks = allItems.slice(0, 12)) => ({ job: "business", student: "no", housing: "family", picks });
const whole = (level, adjust, seed = 7) => {
  const s = survey();
  const a = buildFirst({ survey: s, level, seed });
  return [...a.questions, ...buildSecond({ survey: s, level, adjust, used: a.used, seed }).questions];
};

test("서베이: 네 파트를 다 답하고 Part 4 를 12개 이상 골라야 시작된다", () => {
  assert.deepEqual(surveyProblems(survey()), []);
  assert.equal(surveyProblems(survey(allItems.slice(0, 11))).length, 1);
  assert.equal(surveyProblems({ picks: [] }).length, 4);
  // 표에 없는 값은 세지 않는다
  assert.equal(pickedItems(survey(["movie", "nope"])).length, 1);
});

test("서베이 Part 4 의 모든 항목에 문항 세트가 있고, 문장이 비어 있지 않다", () => {
  for (const id of allItems) {
    const t = TOPICS[id];
    assert.ok(t, `${id} 주제가 없다`);
    for (const k of ["d", "r", "p", "c", "i"]) assert.ok(t[k]?.length > 20, `${id}.${k}`);
  }
  for (const t of Object.values(RANDOM_TOPICS)) for (const k of ["d", "r", "p"]) assert.ok(t[k].length > 20);
  for (const rp of ROLEPLAYS) for (const k of ["ask", "fix", "past"]) assert.ok(rp[k].length > 20);
  assert.equal(LEVELS.length, 6);
});

test("시험지는 1–6단계·난이도 재조정 셋 모두 15문항, 번호가 1부터 이어지고 같은 문장을 두 번 묻지 않는다", () => {
  for (let level = 1; level <= 6; level++) {
    for (const adjust of [-1, 0, 1]) {
      for (const seed of [1, 2, 3, 99]) {
        const qs = whole(level, adjust, seed);
        assert.equal(qs.length, 15, `level ${level} adjust ${adjust}`);
        assert.deepEqual(qs.map(q => q.no), Array.from({ length: 15 }, (_, i) => i + 1));
        assert.equal(new Set(qs.map(q => q.text)).size, 15, `중복 문항 level ${level} adjust ${adjust} seed ${seed}`);
        assert.equal(qs[0].kind, "자기소개");
      }
    }
  }
});

test("1번 다음 콤보는 거주지부터, 서베이에서 고른 주제가 이어진다", () => {
  const qs = whole(4, 0);
  assert.equal(qs[1].topic, "거주지");
  const picked = new Set(pickedItems(survey()).map(id => TOPICS[id].label));
  assert.ok(picked.has(qs[4].topic), qs[4].topic);
});

test("난이도: 높은 단계는 롤플레이 문제 해결과 비교·사회 이슈까지, 낮은 단계는 묘사·습관 위주", () => {
  const hi = whole(5, 1).map(q => q.kind);
  assert.ok(hi.includes("롤플레이 · 문제 해결") && hi.includes("비교") && hi.includes("사회 이슈"));
  const lo = whole(2, -1).map(q => q.kind);
  assert.ok(!lo.includes("비교") && !lo.includes("사회 이슈") && !lo.includes("롤플레이 · 문제 해결"));
  // 재조정 '쉬운 질문'은 5단계를 4단계처럼 — 비교·이슈가 빠진다
  assert.ok(!whole(5, -1).map(q => q.kind).includes("사회 이슈"));
});

test("같은 시드면 같은 시험지", () => {
  assert.deepEqual(whole(4, 0, 42), whole(4, 0, 42));
});
