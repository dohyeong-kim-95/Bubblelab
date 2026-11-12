// 인생 곡선 — 10년 단위 대운마다 0~100점을 매겨 한 장의 곡선으로 보여 주는 규칙 모듈.
//
// 점수는 **예측이 아니라 규칙으로 읽은 결**이다. 같은 명식이면 언제나 같은 곡선이 나오고
// LLM·외부 API 는 쓰지 않는다. 규칙(LIFE_CURVE_RULES.version)을 바꾸면 버전을 올린다.
//
//   1) 일간의 세기(saju-reading 의 간이 신강·신약)로 반가운 오행(희용)과 부담되는 오행(기신)을 가른다.
//      신약이면 나를 돕는 인성·비겁이, 신강이면 내가 쓰는 식상·재성·관성이 반갑다. 중간이면
//      원국에 가장 모자란 오행을 반긴다. 반가운 쪽 중 원국에 가장 적은 오행이 용신(간이).
//   2) 대운의 천간(앞 5년)·지지(뒤 5년, 비중 조금 더)가 용신·희신·기신 중 무엇인지로 가감한다.
//   3) 대운 지지가 내 일지·월지와 합·충·원진이면, 천간이 일간과 천간합·충이면 가감한다.
//   4) 원국에 하나도 없던 오행을 대운이 채우면 조금 더한다. 5~95로 자른다.
//
// 대운은 대운수(첫 대운이 시작되는 정밀 나이) 전에는 없다 — 그 구간은 "대운 전"으로 따로 두고
// 월주(타고난 계절)로 매긴다. 만 나이·시작 나이는 년·월·일까지 반영한 소수 나이로 계산한다.
import {
  branchRelation, controls, elementCounts, generates, josa, stemElement, branchElement,
  TEN_GOD_GLOSS, TEN_GOD_GROUP, tenGodOf, elementWord,
} from "./saju-reading.js";
import { yearPillar } from "./saju-detail.js";

export const LIFE_CURVE_RULES = {
  version: "life-curve-v1",
  basis: "간이 신강·신약으로 희용·기신을 가르고, 대운 천간·지지의 오행과 일지·월지 합충으로 가감(5~95)",
  maxAge: 90,
  flatGap: 8,
  flatText: "앞으로는 큰 굴곡 없이 고른 편이에요.",
};

const ELEMENTS = ["목", "화", "토", "금", "수"];
const STEM_CLASH = new Set(["갑경", "을신", "병임", "정계"]);
const STEM_UNION = new Set(["갑기", "을경", "병신", "정임", "무계"]);
const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const pairOf = (a, b) => [a, b].sort((x, y) => STEMS.indexOf(x) - STEMS.indexOf(y)).join("");

// 일간 오행 기준으로 다섯 갈래의 오행을 구한다.
function groupElements(me) {
  const out = { 비겁: me };
  for (const e of ELEMENTS) {
    if (generates(me, e)) out.식상 = e;
    if (controls(me, e)) out.재성 = e;
    if (controls(e, me)) out.관성 = e;
    if (generates(e, me)) out.인성 = e;
  }
  return out;
}

// 간이 희용신. 반환: { yong, hee, favorable:Set, unfavorable:Set, level }
export function favorableElements(candidate, strengthLevel) {
  const me = stemElement(candidate.pillars.day.stem.korean);
  const g = groupElements(me);
  const counts = elementCounts(candidate);
  let favorable, unfavorable;
  if (strengthLevel === "약") {
    favorable = [g.인성, g.비겁]; unfavorable = [g.식상, g.재성, g.관성];
  } else if (strengthLevel === "강") {
    favorable = [g.식상, g.재성, g.관성]; unfavorable = [g.인성, g.비겁];
  } else {
    const min = Math.min(...ELEMENTS.map((e) => counts[e]));
    const max = Math.max(...ELEMENTS.map((e) => counts[e]));
    favorable = ELEMENTS.filter((e) => counts[e] === min);
    unfavorable = ELEMENTS.filter((e) => counts[e] === max && max >= 3);
  }
  // 용신: 반가운 오행 중 원국에 가장 적은 것(같으면 반가운 목록 순서). 희신: 용신을 낳는 오행.
  const yong = favorable.reduce((best, e) => (counts[e] < counts[best] ? e : best), favorable[0]);
  const hee = ELEMENTS.find((e) => generates(e, yong));
  return { yong, hee, favorable: new Set(favorable), unfavorable: new Set(unfavorable), level: strengthLevel, counts };
}

// 한 기둥(천간·지지)의 점수와 근거. 대운·세운·대운 전(월주)이 같은 규칙을 쓴다.
export function scorePillar(candidate, fav, stem, branch) {
  const dayStem = candidate.pillars.day.stem.korean;
  const why = [];
  let score = 50;
  const se = stemElement(stem), be = branchElement(branch);
  const weigh = (element, place, [yong, good, bad]) => {
    if (element === fav.yong) { score += yong; why.push(`${place} 용신 ${element}`); }
    else if (element === fav.hee || fav.favorable.has(element)) { score += good; why.push(`${place} 희신 ${element}`); }
    else if (fav.unfavorable.has(element)) { score -= bad; why.push(`${place} 기신 ${element}`); }
  };
  weigh(se, "천간", [12, 7, 9]);
  weigh(be, "지지", [15, 9, 12]);
  const dayRel = branchRelation(candidate.pillars.day.branch.korean, branch);
  if (dayRel === "합") { score += 6; why.push("일지 합"); }
  if (dayRel === "충") { score -= 10; why.push("일지 충"); }
  if (dayRel === "원진") { score -= 4; why.push("일지 원진"); }
  if (candidate.pillars.month && branchRelation(candidate.pillars.month.branch.korean, branch) === "충") { score -= 5; why.push("월지 충"); }
  const pair = pairOf(dayStem, stem);
  if (STEM_UNION.has(pair)) { score += 4; why.push("천간합"); }
  if (STEM_CLASH.has(pair)) { score -= 6; why.push("천간충"); }
  const filled = [...new Set([se, be])].filter((e) => fav.counts[e] === 0);
  if (filled.length) { score += 5; why.push(`빈 ${filled.join("·")} 채움`); }
  const god = tenGodOf(dayStem, stem);
  return { score: Math.max(5, Math.min(95, score)), god, group: TEN_GOD_GROUP[god], why };
}

const yearsBetween = (a, b) => (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / (365.2425 * 86400000);

// "5~14세"처럼 — 시작은 반올림한 대운수, 끝은 다음 구간 시작 바로 전 해.
export const ageRange = (s) => `${Math.round(s.from)}~${Math.max(Math.round(s.from), Math.round(s.to) - 1)}세`;

const TONE = [
  [70, "힘이 크게 실리는 시기예요"],
  [56, "순하게 흘러가는 시기예요"],
  [44, "평탄하게 기반을 다지는 시기예요"],
  [0, "속도를 늦추고 지키면 좋은 시기예요"],
];
const toneOf = (score) => TONE.find(([min]) => score >= min)[1];

// 근거를 한 줄 해요체로. 기둥 이름·십성을 밝히고, 용신/기신·합충은 쉬운 말로 덧붙인다.
function sentence(section, fav) {
  const [stem, branch] = Array.from(section.ganji);
  const range = ageRange(section);
  const head = section.kind === "before"
    ? `${range}는 대운이 시작되기 전이라 타고난 월주 ${section.ganji}의 결로 봐요.`
    : `${range}는 ${section.ganji} 대운이에요.`;
  const bits = [`천간 ${josa(stem, "이", "가")} 나에게 ${section.god}(${TEN_GOD_GLOSS[section.god]})이고`];
  const be = branchElement(branch);
  if (be === fav.yong) bits.push(`지지 ${branch}의 ${elementWord(be)} 기운이 내게 가장 반가운 기운(용신)이라`);
  else if (be === fav.hee || fav.favorable.has(be)) bits.push(`지지 ${branch}의 ${elementWord(be)} 기운이 나를 돕는 쪽이라`);
  else if (fav.unfavorable.has(be)) bits.push(`지지 ${branch}의 ${elementWord(be)} 기운이 부담이 되는 쪽이라`);
  else bits.push(`지지 ${branch}의 ${elementWord(be)} 기운은 중간쯤이라`);
  const extra = section.why.includes("일지 충") ? " 다만 일지와 부딪히는(충) 자리라 생활의 변화가 잦을 수 있어요."
    : section.why.includes("일지 합") ? " 게다가 일지와 합을 이뤄 사람과 인연이 잘 이어져요." : "";
  return `${head} ${bits.join(", ")} ${toneOf(section.score)}.${extra}`;
}

/**
 * @param candidate buildChart 의 후보(pillars·reading 필요)
 * @param luck manseryeok 의 luckPillars(성별이 없으면 null → 곡선 없음)
 * @param birth {year,month,day} 양력, today {year,month,day} KST
 */
export function buildLifeCurve(candidate, { luck, birth, today, strengthLevel }) {
  if (!luck?.pillars?.length) return null;
  const fav = favorableElements(candidate, strengthLevel);
  const start = luck.startYears + luck.startMonths / 12 + luck.startDays / 365.2425;   // 대운수(정밀)
  const sections = [];
  const month = candidate.pillars.month;
  if (start > 0.5) {
    const s = scorePillar(candidate, fav, month.stem.korean, month.branch.korean);
    sections.push({ kind: "before", from: 0, to: start, ganji: month.korean, ...s });
  }
  luck.pillars.forEach((p, i) => {
    const from = start + i * 10;
    if (from >= LIFE_CURVE_RULES.maxAge) return;
    const s = scorePillar(candidate, fav, p.pillar.heavenlyStem, p.pillar.earthlyBranch);
    sections.push({ kind: "luck", from, to: Math.min(from + 10, LIFE_CURVE_RULES.maxAge), ganji: p.korean, ...s });
  });
  for (const section of sections) {
    section.why = [`${section.group} ${section.kind === "before" ? "월주" : "대운"}`, ...section.why].join(" + ");
    section.text = sentence({ ...section, why: section.why }, fav);
  }
  const age = Math.max(0, yearsBetween(birth, today));
  const currentIndex = sections.findIndex((s) => age >= s.from && age < s.to);
  // 전성기·조심할 때는 **지금 구간부터 앞으로**에서만 고른다 — 지나간 구간에 이름을 붙여도 쓸 데가 없다.
  // 남은 구간이 고르면(최고=최저이거나 차이가 FLAT_GAP 미만) 조심할 때를 붙이지 않는다.
  const ahead = currentIndex >= 0 ? sections.slice(currentIndex) : [];
  const best = ahead.length ? ahead.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  let worst = ahead.length ? ahead.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const flat = !best || worst === best || best.score - worst.score < LIFE_CURVE_RULES.flatGap;
  if (flat) worst = null;

  // 지금 대운 안의 해마다(세운) 점 — 같은 규칙으로.
  const yearly = [];
  const current = sections[currentIndex];
  if (current?.kind === "luck") {
    for (let y = Math.ceil(birth.year + current.from); y < birth.year + current.to; y += 1) {
      const p = yearPillar(y);
      yearly.push({ year: y, age: y - birth.year, ganji: p.ganji, score: scorePillar(candidate, fav, p.stem, p.branch).score });
    }
  }
  const range = ageRange;
  const name = (x) => `${x.ganji}${x.kind === "luck" ? " 대운" : ""}`;
  const bestOut = best && { index: sections.indexOf(best), label: `전성기 ${range(best)}`,
    text: `${range(best)} ${josa(name(best), "이", "가")} 앞으로 남은 흐름에서 가장 높은 곳이에요. 하고 싶던 일을 크게 펼쳐 보기 좋은 때로 읽혀요.` };
  const worstOut = worst && { index: sections.indexOf(worst), label: `조심할 때 ${range(worst)}`,
    text: `${range(worst)} ${josa(name(worst), "은", "는")} 앞으로 남은 흐름에서 가장 낮아요. 무리한 확장보다 건강과 기반을 지키는 쪽이 좋아요.` };
  return {
    version: LIFE_CURVE_RULES.version,
    basis: LIFE_CURVE_RULES.basis,
    startAge: +start.toFixed(2),
    age: +age.toFixed(2),
    favorable: { yong: fav.yong, hee: fav.hee, level: fav.level },
    sections: sections.map((s) => ({
      kind: s.kind, from: +s.from.toFixed(2), to: +s.to.toFixed(2), ganji: s.ganji,
      score: s.score, god: s.god, group: s.group, why: s.why, text: s.text,
    })),
    currentIndex,
    best: bestOut,
    worst: worstOut,
    flat,
    summary: [bestOut?.text, worstOut ? `반대로 ${worstOut.text}` : LIFE_CURVE_RULES.flatText].filter(Boolean).join(" "),
    yearly,
  };
}

// 테스트·검증용: 표본 명식으로 점수 분포를 낸다.
export function spreadOf(curves) {
  const scores = curves.flatMap((c) => c.sections.filter((s) => s.kind === "luck").map((s) => s.score));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  return { n: scores.length, min: Math.min(...scores), max: Math.max(...scores), mean: +mean.toFixed(1), sd: +sd.toFixed(1) };
}
