// 사주 → 특성(_infra/saju-traits.js, M4 설계 §2) — 규칙표가 어휘 안에 있는지, 설계의 가상 인물 5명 값과 같은지,
// 결정적인지, 사주 혼자서 모순 쌍을 내지 않는지.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChart } from "./fortune.js";
import {
  SAJU_TRAIT_RULES, DAY_MASTER_TRAITS, DAY_MASTER_CONF, ELEMENT_TRAITS, GROUP_TRAITS, STRENGTH_TRAITS, SHINSAL_TRAITS,
  sajuTraits, sajuNoteInput,
} from "./saju-traits.js";
import { TRAITS, BANNED_RE } from "../fortune/lib/traits.js";

const FIX = JSON.parse(readFileSync(new URL("./fortune-note.fixtures.json", import.meta.url), "utf8"));
const TODAY = { year: 2026, month: 11, day: 16 };

test("규칙표: 모든 id 가 공통 어휘에 있고, 10간·5행·5갈래를 빠짐없이 덮는다", () => {
  assert.match(SAJU_TRAIT_RULES.version, /^saju-traits-v\d+$/);
  // 신강약은 혼자서 특성을 내지 않는다(최소 아래) — 다른 근거를 거들기만
  for (const list of Object.values(STRENGTH_TRAITS)) for (const [, c] of list) assert.ok(c < SAJU_TRAIT_RULES.min);
  assert.deepEqual(Object.keys(DAY_MASTER_TRAITS), ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"]);
  assert.deepEqual(Object.keys(ELEMENT_TRAITS), ["목", "화", "토", "금", "수"]);
  assert.deepEqual(Object.keys(GROUP_TRAITS), ["비겁", "식상", "재성", "관성", "인성"]);
  const lists = [
    ...Object.values(DAY_MASTER_TRAITS).map((ids) => ids.map((id, i) => [id, DAY_MASTER_CONF[i]])),
    ...Object.values(ELEMENT_TRAITS).flatMap((r) => [r.excess, r.missing]),
    ...Object.values(GROUP_TRAITS).flatMap((r) => [r.many, r.none]),
    ...Object.values(STRENGTH_TRAITS), ...Object.values(SHINSAL_TRAITS),
  ];
  for (const list of lists) for (const [id, c] of list) {
    assert.ok(TRAITS[id], `어휘에 없는 id: ${id}`);
    assert.ok(c > 0 && c <= SAJU_TRAIT_RULES.cap, `${id} 확신도 ${c}`);
  }
  // 금칙(§1-5): 사고·다툼·건강 쪽 신살과 '돕는 사람'은 쓰지 않는다. 재성 없음·토 결핍은 내지 않는다.
  for (const name of ["백호살", "양인살", "괴강살", "귀문관살", "원진살", "공망", "천을귀인"]) assert.equal(SHINSAL_TRAITS[name], undefined, name);
  assert.deepEqual(GROUP_TRAITS.재성.none, []);
  assert.deepEqual(ELEMENT_TRAITS.토.missing, []);
  // 순서만 근거가 있다: 일간 첫째가 가장 세고, 신살은 결핍·없음보다 약하다(혼자서는 화면 문턱을 못 넘는다).
  const shinsalMax = Math.max(...Object.values(SHINSAL_TRAITS).flat().map(([, c]) => c));
  const weakMin = Math.min(...[...Object.values(ELEMENT_TRAITS).flatMap((r) => r.missing), ...Object.values(GROUP_TRAITS).flatMap((r) => r.none)].map(([, c]) => c));
  assert.ok(shinsalMax < weakMin && shinsalMax < 0.45);
  for (const list of [...Object.values(ELEMENT_TRAITS).map((r) => r.excess), ...Object.values(GROUP_TRAITS).map((r) => r.many)]) {
    for (const [, c] of list) assert.ok(c <= DAY_MASTER_CONF[0]);
  }
});

test("가상 인물 5명: 고정해 둔 특성·확신도(시간 모름·자시 포함), 같은 입력이면 같은 결과", () => {
  for (const p of FIX.people) {
    const chart = buildChart(p.birth, TODAY);
    const out = sajuTraits(chart);
    assert.deepEqual(out.map((t) => [t.trait, t.confidence]), p.expect.saju, p.name);
    assert.deepEqual(sajuTraits(buildChart(p.birth, TODAY)), out, `${p.name} 결정적`);
    for (const t of out) {
      assert.equal(t.kind, "trait");
      assert.equal(t.source, "saju");
      assert.equal(t.label, TRAITS[t.trait].label);
      assert.ok(t.confidence >= SAJU_TRAIT_RULES.min && t.confidence <= SAJU_TRAIT_RULES.cap);
      assert.match(t.evidence[0], /^saju:/, "기계용 근거가 앞");
      assert.doesNotMatch(t.evidence.at(-1), /^saju:/, "사람용 근거가 마지막");
      assert.doesNotMatch(t.evidence.at(-1), BANNED_RE);
    }
    // 확신도 내림차순, 같으면 id 순
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1].confidence > out[i].confidence || (out[i - 1].confidence === out[i].confidence && out[i - 1].trait < out[i].trait));
    }
  }
  // 시간 모름은 시주가 없어 0.05 를 빼고 노트에 '시간을 알면' 안내가 붙는다
  const unknown = sajuNoteInput(buildChart(FIX.people[2].birth, TODAY));
  assert.equal(unknown.hour_known, false);
  const known = sajuNoteInput(buildChart({ ...FIX.people[2].birth, timeMode: "clock", time: "12:00" }, TODAY));
  assert.equal(known.hour_known, true);
});

test("노트 재료(sajuNoteInput): 특성·일간 후보만 — 생년월일·명식은 싣지 않는다", () => {
  const p = FIX.people[0];
  const input = sajuNoteInput(buildChart(p.birth, TODAY));
  assert.deepEqual(Object.keys(input).sort(), ["day_master", "hour_known", "rules", "traits"]);
  assert.deepEqual(input.day_master.traits, DAY_MASTER_TRAITS[input.day_master.stem]);
  const json = JSON.stringify(input);
  assert.doesNotMatch(json, /1992|07:10|"pillars"|"year"/);
});

test("분포(1940~2010, 7일 간격): 사주 혼자 같은 축 반대 극을 내지 않고, 어떤 명식도 특성이 비지 않는다", () => {
  let n = 0;
  const freq = {};
  for (let d = Date.UTC(1940, 0, 1), i = 0; d <= Date.UTC(2010, 11, 31); d += 7 * 86400000, i++) {
    const dt = new Date(d);
    const birth = i % 10 === 0 ? { timeMode: "branch", branch: null }
      : { timeMode: "clock", time: `${String((i * 7) % 24).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}` };
    const out = sajuTraits(buildChart({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), ...birth }, TODAY));
    n++;
    assert.ok(out.length >= 1, `${dt.toISOString().slice(0, 10)} 특성 없음`);
    for (const a of out) {
      freq[a.trait] = (freq[a.trait] || 0) + 1;
      for (const b of out) {
        const A = TRAITS[a.trait], B = TRAITS[b.trait];
        assert.ok(!(A.pole && A.axis === B.axis && A.pole === -B.pole), `${dt.toISOString().slice(0, 10)}: ${a.trait} ↔ ${b.trait}`);
      }
    }
  }
  assert.ok(n > 3500);
  // 한 id 가 명식의 40% 를 넘으면 값을 낮춘다(설계 §9-1 발견 5). v1 은 work.together 가 61% 였다 → v2 에서 신강약을 거드는 값으로.
  const over = Object.entries(freq).filter(([, v]) => v / n > 0.4).map(([k]) => `${k} ${Math.round((100 * v) / n)}%`);
  assert.deepEqual(over, [], "40% 를 넘는 id — 규칙표의 값을 낮출지 본다");
});
