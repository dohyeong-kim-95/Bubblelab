import test from "node:test";
import assert from "node:assert/strict";
import { buildChart } from "./fortune.js";
import { ageRange, buildLifeCurve, favorableElements, LIFE_CURVE_RULES, scorePillar, spreadOf } from "./life-curve.js";

const TODAY = { year: 2026, month: 11, day: 12 };
// 1992-10-24 05:30 남 = 임신·경술·계유·을묘, 대운수 4년 9개월 7일(순행)
const me = (gender = "male") => buildChart({ year: 1992, month: 10, day: 24, timeMode: "clock", time: "05:30", gender }, TODAY).candidates[0];

test("버전·구간 수·점수 범위", () => {
  const c = me().lifeCurve;
  assert.equal(c.version, LIFE_CURVE_RULES.version);
  // 대운 전 1 + 대운 10개(시작 4.77세 → 94.77세지만 90세에서 자른다: 4.77, 14.77 … 84.77 → 9개)
  assert.equal(c.sections[0].kind, "before");
  assert.equal(c.sections.filter((s) => s.kind === "luck").length, 9);
  for (const s of c.sections) {
    assert.ok(s.score >= 5 && s.score <= 95, `${s.ganji} ${s.score}`);
    assert.ok(s.to > s.from && s.to <= 90);
    assert.match(s.why, /(대운|월주)/);
    assert.match(s.text, /요\.$/);
  }
});

test("대운수: 첫 대운은 정밀 대운수에서 시작하고, 그 전은 '대운 전'(월주)", () => {
  const c = me().lifeCurve;
  assert.equal(c.startAge, 4.77);                 // 4년 + 9/12 + 7/365.24
  assert.equal(c.sections[0].from, 0);
  assert.equal(c.sections[0].to, c.startAge);
  assert.equal(c.sections[0].ganji, "경술");        // 월주
  assert.equal(c.sections[1].from, c.startAge);
  assert.equal(c.sections[1].ganji, "신해");
  for (let i = 2; i < c.sections.length; i += 1) assert.equal(+(c.sections[i].from - c.sections[i - 1].from).toFixed(2), 10);
  assert.equal(ageRange(c.sections[1]), "5~14세");
});

test("지금 여기: 만 나이가 들어 있는 구간을 가리키고, saju-detail 의 현재 대운과 같다", () => {
  const cand = me();
  const c = cand.lifeCurve;
  assert.equal(c.age, 34.05);
  const now = c.sections[c.currentIndex];
  assert.ok(c.age >= now.from && c.age < now.to);
  assert.equal(now.ganji, cand.detail.luck.pillars[cand.detail.luck.current].ganji);   // 계축
  // 세운 점은 지금 대운 안의 해만
  assert.ok(c.yearly.length >= 9 && c.yearly.length <= 10);
  for (const p of c.yearly) assert.ok(p.age >= Math.floor(now.from) && p.age < now.to);
});

test("대운 시작 전인 아이는 '대운 전' 구간에 있고, 성별이 없으면 곡선이 없다", () => {
  const kid = buildChart({ year: 2024, month: 3, day: 1, timeMode: "branch", branch: null, gender: "female" }, TODAY).candidates[0].lifeCurve;
  assert.equal(kid.sections[kid.currentIndex].kind, "before");
  assert.ok(kid.age < kid.startAge);
  assert.equal(me("unspecified").lifeCurve, null);
});

test("전성기·조심할 때는 대운 구간 중 최고·최저", () => {
  const c = me().lifeCurve;
  const luck = c.sections.filter((s) => s.kind === "luck").map((s) => s.score);
  assert.equal(c.sections[c.best.index].score, Math.max(...luck));
  assert.equal(c.sections[c.worst.index].score, Math.min(...luck));
  assert.match(c.best.label, /^전성기 \d+~\d+세$/);
  assert.match(c.worst.label, /^조심할 때 \d+~\d+세$/);
});

test("희용신: 신약이면 인성·비겁, 신강이면 식상·재성·관성을 반긴다", () => {
  const cand = me();
  const weak = favorableElements(cand, "약");
  assert.ok(weak.favorable.has("금") && weak.favorable.has("수"));   // 계수: 인성 금, 비겁 수
  const strong = favorableElements(cand, "강");
  assert.ok(strong.favorable.has("목") && strong.favorable.has("화") && strong.favorable.has("토"));
  // 같은 기둥이라도 용신이면 점수가 오르고 기신이면 내린다
  const up = scorePillar(cand, { ...weak, yong: "금" }, "경", "신").score;
  const down = scorePillar(cand, strong, "경", "신").score;
  assert.ok(up > down, `${up} > ${down}`);
});

test("분포: 표본 120명 — 모두 평평하거나 모두 극단이 아니다", () => {
  const curves = [];
  for (let i = 0; i < 120; i += 1) {
    const d = new Date(Date.UTC(1950 + ((i * 7) % 60), (i * 5) % 12, 1 + ((i * 11) % 28)));
    curves.push(buildChart({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
      timeMode: "branch", branch: i % 12, gender: i % 2 ? "male" : "female" }, TODAY).candidates[0].lifeCurve);
  }
  const spread = spreadOf(curves);
  console.log(`인생 곡선 점수 분포: n=${spread.n} min=${spread.min} max=${spread.max} 평균=${spread.mean} 표준편차=${spread.sd}`);
  assert.ok(spread.sd >= 8 && spread.sd <= 25, `표준편차 ${spread.sd}`);
  assert.ok(spread.min <= 30 && spread.max >= 75);
  const flat = curves.filter((c) => {
    const s = c.sections.filter((x) => x.kind === "luck").map((x) => x.score);
    return Math.max(...s) - Math.min(...s) < 10;
  });
  assert.ok(flat.length / curves.length < 0.1, `거의 평평한 곡선 ${flat.length}개`);
  const pinned = curves.flatMap((c) => c.sections).filter((s) => s.score === 5 || s.score === 95);
  assert.ok(pinned.length / spread.n < 0.05, `양 끝에 붙은 구간 ${pinned.length}개`);
});

test("buildLifeCurve 는 대운 정보가 없으면 null", () => {
  assert.equal(buildLifeCurve(me(), { luck: null, birth: { year: 1992, month: 10, day: 24 }, today: TODAY, strengthLevel: "중" }), null);
});
