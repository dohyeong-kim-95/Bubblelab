import test from "node:test";
import assert from "node:assert/strict";
import manseryeok from "manseryeok";
import { buildChart } from "./fortune.js";
import { ageRange, buildLifeCurve, favorableElements, LIFE_CURVE_RULES, scorePillar, spreadOf } from "./life-curve.js";

const TODAY = { year: 2026, month: 11, day: 12 };
// 1992-10-24 05:30 남 = 임신·경술·계유·을묘, 대운수 4년 9개월 7일(순행)
const rawLuck = () => manseryeok.calculateFourPillars({ year: 1992, month: 10, day: 24, hour: 5, minute: 30, gender: "male" }).luckPillars;
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

test("전성기·조심할 때는 지금 구간부터 앞으로 중 최고·최저 — 지난 구간에는 이름을 붙이지 않는다", () => {
  const c = me().lifeCurve;
  const ahead = c.sections.slice(c.currentIndex);
  assert.equal(c.sections[c.best.index].score, Math.max(...ahead.map((s) => s.score)));
  assert.equal(c.sections[c.worst.index].score, Math.min(...ahead.map((s) => s.score)));
  assert.ok(c.best.index >= c.currentIndex && c.worst.index >= c.currentIndex);
  // 이 명식의 전체 최저는 지나간 5~14세(41점)지만, 앞으로 중 최저는 지금 25~34세 계축(50점)
  assert.equal(c.sections[1].score, 41);
  assert.notEqual(c.worst.index, 1);
  assert.match(c.best.label, /^전성기 \d+~\d+세$/);
  assert.match(c.worst.label, /^조심할 때 \d+~\d+세$/);
  assert.equal(c.flat, false);
});

test("앞으로가 고르면(최고=최저이거나 차이 8점 미만) 조심할 때 없이 '고른 편' 문장", () => {
  const base = me().lifeCurve;
  // 대운이 다 끝나 가는 나이(마지막 구간 하나만 남음) → 최고 = 최저
  const late = buildLifeCurve(me(), { luck: rawLuck(), birth: { year: 1992, month: 10, day: 24 },
    today: { year: 2080, month: 1, day: 1 }, strengthLevel: "중" });
  assert.equal(late.sections.length - late.currentIndex, 1);
  assert.equal(late.worst, null);
  assert.equal(late.flat, true);
  assert.equal(late.sections[late.best.index], late.sections.at(-1));
  assert.match(late.summary, /앞으로는 큰 굴곡 없이 고른 편이에요\.$/);
  // 차이 8점 미만: 60갑자 중 점수 차가 1~7점인 두 기둥으로 대운 목록을 직접 만든다(지금 = 첫 대운).
  const cand = me();
  const fav = favorableElements(cand, "중");
  const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
  const BR = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
  const ganji = Array.from({ length: 60 }, (_, i) => [STEMS[i % 10], BR[i % 12]]);
  const scored = ganji.map(([st, br]) => ({ st, br, score: scorePillar(cand, fav, st, br).score }));
  const a = scored[0];
  const b = scored.find((x) => x.score !== a.score && Math.abs(x.score - a.score) < 8);
  const far = scored.find((x) => Math.abs(x.score - a.score) >= 8);
  const fake = (list) => ({ startYears: 1, startMonths: 0, startDays: 0, forward: true,
    pillars: list.map((x, i) => ({ age: 1 + i * 10, pillar: { heavenlyStem: x.st, earthlyBranch: x.br }, korean: x.st + x.br })) });
  const at5 = { year: 2000, month: 1, day: 1 };
  const born = { year: 1995, month: 1, day: 1 };
  const near = buildLifeCurve(cand, { luck: fake([a, b]), birth: born, today: at5, strengthLevel: "중" });
  assert.equal(near.sections[near.currentIndex].ganji, a.st + a.br);
  assert.equal(near.worst, null, `${a.score} vs ${b.score}`);
  assert.equal(near.flat, true);
  assert.notEqual(near.best, null);
  const wide = buildLifeCurve(cand, { luck: fake([a, far]), birth: born, today: at5, strengthLevel: "중" });
  assert.notEqual(wide.worst, null);
  assert.equal(wide.flat, false);
});

test("90세가 넘어 지금 구간이 없으면 이름표 없이 고른 편 문장만", () => {
  const old = buildLifeCurve(me(), { luck: rawLuck(), birth: { year: 1992, month: 10, day: 24 },
    today: { year: 2090, month: 1, day: 1 }, strengthLevel: "중" });
  assert.equal(old.currentIndex, -1);
  assert.equal(old.best, null);
  assert.equal(old.worst, null);
  assert.equal(old.summary, "앞으로는 큰 굴곡 없이 고른 편이에요.");
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

test("요약 문장은 전성기·조심할 때 문장이다(구간 풀이를 되풀이하지 않는다)", () => {
  const c = me().lifeCurve;
  assert.match(c.summary, /^\d+~\d+세 .+(이|가) 앞으로 남은 흐름에서 가장 높은 곳이에요\./);
  assert.match(c.summary, /반대로 \d+~\d+세 .+(은|는) 앞으로 남은 흐름에서 가장 낮아요\./);
});
