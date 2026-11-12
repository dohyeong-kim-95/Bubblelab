import test from "node:test";
import assert from "node:assert/strict";
import { buildChart } from "./fortune.js";
import {
  READING_RULES, branchRelation, buildCompatibility, buildSajuReading, DAY_MASTER, josa, tenGodOf,
} from "./saju-reading.js";

// 풀이는 조각을 골라 잇는다. 테스트는 문장 내용이 아니라 "조건에 맞는 조각이 골랐나(picks)"를 본다.
const TODAY = { year: 2026, month: 11, day: 12 };
const chartOf = (input) => buildChart({ timeMode: "branch", branch: null, ...input }, TODAY).candidates[0];
// 1992-10-24 05:30 = 임신·경술·계유·을묘 — 목2 화0 토1 금3 수2
const ME = () => buildChart({ year: 1992, month: 10, day: 24, timeMode: "clock", time: "05:30", gender: "male" }, TODAY).candidates[0];

test("버전이 응답에 실린다", () => {
  assert.equal(ME().reading.version, READING_RULES.version);
});

test("josa: 받침 따라 조사가 갈리고 괄호 한자는 건너뛴다", () => {
  assert.equal(josa("금(金)", "이", "가"), "금(金)이");
  assert.equal(josa("화(火)", "이", "가"), "화(火)가");
  assert.equal(josa("계수(癸水)", "은", "는"), "계수(癸水)는");
  assert.equal(josa("비견", "이라서", "라서"), "비견이라서");
});

test("십성·지지 관계 기본표", () => {
  assert.equal(tenGodOf("계", "경"), "정인");
  assert.equal(tenGodOf("갑", "기"), "정재");
  assert.equal(tenGodOf("갑", "경"), "편관");
  assert.equal(branchRelation("자", "축"), "합");
  assert.equal(branchRelation("자", "오"), "충");
  assert.equal(branchRelation("자", "미"), "원진");
  assert.equal(branchRelation("자", "인"), null);
});

test("일간 열 개 모두 풀이 조각이 있고 해요체다", () => {
  for (const [stem, dm] of Object.entries(DAY_MASTER)) {
    for (const key of ["nature", "more", "caution"]) {
      assert.match(dm[key], /요\.$/, `${stem}.${key}`);
      assert.doesNotMatch(dm[key], /니다/);
    }
  }
});

test("첫머리 요약: 비어 있는 오행이 있으면 그 결핍 조각을 고른다", () => {
  const reading = ME().reading;
  assert.deepEqual(reading.overview.picks, ["dayMaster:계", "overview:missing:화"]);
  assert.match(reading.overview.paragraph, /^계수\(癸水\) 일간이라 /);
  assert.match(reading.overview.paragraph, /그런데 명식에 화\(火\)가 하나도 없어서/);
});

test("오행: 과다·결핍 조각을 모두 고르고, 고루 퍼지면 균형 조각", () => {
  const reading = ME().reading;
  assert.deepEqual(reading.elements.picks, ["excess:금", "missing:화"]);
  // 시주 없는 1988-08-17(무진·경신·갑술 무렵) — 결핍이 둘 이상이면 차례로 잇는다.
  const other = chartOf({ year: 1988, month: 8, day: 17 }).reading;
  assert.ok(other.elements.picks.length >= 1);
  const balanced = { pillars: {
    year: { stem: { korean: "갑" }, branch: { korean: "오" } },
    month: { stem: { korean: "무" }, branch: { korean: "신" } },
    day: { stem: { korean: "임" }, branch: { korean: "인" } },
    hour: { stem: { korean: "정" }, branch: { korean: "축" } },
  } };
  const r = buildSajuReading(balanced, null);
  assert.deepEqual(r.elements.picks, ["balanced"]);
  assert.deepEqual(r.overview.picks, ["dayMaster:임", "overview:balanced"]);
});

test("십성 갈래: 3개 이상 몰린 갈래와 빈 갈래를 고른다", () => {
  const reading = ME().reading;
  assert.deepEqual(reading.tenGods.picks, ["many:인성", "none:재성"]);
});

test("세운: 올해 십성·12운성·일지 관계 조각", () => {
  const annual = ME().reading.annual;
  assert.deepEqual(annual.picks, ["year:정재", "stage:절"]);   // 2026 병오, 계유 일주
  assert.match(annual.paragraph, /정재\(차곡차곡 쌓는 재물\)라서/);
});

test("대운: 지금 대운의 갈래와 다음 대운으로의 이동", () => {
  const luck = ME().reading.luck;
  assert.equal(luck.current.ganji, "계축");
  assert.deepEqual(luck.picks, ["luck:비겁", "luckStage:관대", "next:식상"]);
});

test("성별이 없으면 대운 풀이는 비운다", () => {
  assert.equal(chartOf({ year: 1992, month: 10, day: 24 }).reading.luck, null);
});

test("궁합: 일간 생극·일지 합·오행 보완 조각을 고르고 점수가 범위 안", () => {
  const me = ME();
  const partner = chartOf({ year: 1988, month: 8, day: 17, branch: 4 });
  const c = buildCompatibility(me, partner);
  assert.equal(c.picks[0], "element:a생b");   // 계수 → 갑목
  assert.ok(c.picks.includes("branch:합"));    // 유 ↔ 진
  assert.ok(c.picks.includes("fill"));
  assert.ok(c.score >= 30 && c.score <= 98);
  assert.equal(c.paragraphs.length, 2);
  for (const p of c.paragraphs) assert.doesNotMatch(p, /니다/);
});

test("궁합: 천간합이면 union 조각, 일지 충이면 감점", () => {
  const a = { pillars: { day: { stem: { korean: "갑" }, branch: { korean: "자" } } } };
  const b = { pillars: { day: { stem: { korean: "기" }, branch: { korean: "오" } } } };
  const c = buildCompatibility(a, b);
  assert.ok(c.picks.includes("union"));
  assert.ok(c.picks.includes("branch:충"));
});
