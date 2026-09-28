// 명식 위에 얹는 해석 데이터 — 지장간·오행 분포·12운성·12신살·주요 신살·대운·세운.
//
// manseryeok 는 값이 하나로 정해지는 계산(팔자·십신·공망·대운)만 준다. 신살과
// 12운성은 학파마다 표가 갈리므로 여기서 **한 가지 통용 기준을 골라 버전을 붙인다**
// (SHINSAL_RULES). 표를 바꾸면 버전도 올린다 — 응답에 그대로 실려 화면이 기준을 밝힌다.
// 표에 없는 신살은 만들어 넣지 않는다.
import manseryeok from "manseryeok";

const { calculateFourPillars, getHeavenlyStemElement, getEarthlyBranchElement } = manseryeok;

const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const ELEMENTS = ["목", "화", "토", "금", "수"];
const PILLAR_KEYS = ["year", "month", "day", "hour"];
const PILLAR_NAMES = { year: "연주", month: "월주", day: "일주", hour: "시주" };

export const SHINSAL_RULES = {
  version: "shinsal-kr-v1",
  hiddenStems: "여기·중기·본기 3분법(자·묘·유는 2개)",
  twelveStages: "일간 기준, 양간 순행·음간 역행, 무는 병·기는 정을 따름(화토동법)",
  twelveShinsal: "삼합 기준 — 연지 기준과 일지 기준을 함께 표시",
  yangin: "양간만(갑·병·무·경·임)",
  pairs: "귀문관살·원진살은 원국 지지 두 개씩 모든 짝을 본다",
};

// 지장간: 여기 → 중기 → 본기 순.
const HIDDEN_STEMS = {
  자: ["임", "계"], 축: ["계", "신", "기"], 인: ["무", "병", "갑"], 묘: ["갑", "을"],
  진: ["을", "계", "무"], 사: ["무", "경", "병"], 오: ["병", "기", "정"], 미: ["정", "을", "기"],
  신: ["무", "임", "경"], 유: ["경", "신"], 술: ["신", "정", "무"], 해: ["무", "갑", "임"],
};

const TWELVE_STAGES = ["장생", "목욕", "관대", "건록", "제왕", "쇠", "병", "사", "묘", "절", "태", "양"];
// 일간별 장생 지지.
const STAGE_BIRTH = { 갑: "해", 병: "인", 무: "인", 경: "사", 임: "신",
  을: "오", 정: "유", 기: "유", 신: "자", 계: "묘" };

const TWELVE_SHINSAL = ["겁살", "재살", "천살", "지살", "년살", "월살",
  "망신살", "장성살", "반안살", "역마살", "육해살", "화개살"];
// 삼합의 생지(지살 자리). 신자진→신, 인오술→인, 사유축→사, 해묘미→해.
const TRIAD_START = { 신: "신", 자: "신", 진: "신", 인: "인", 오: "인", 술: "인",
  사: "사", 유: "사", 축: "사", 해: "해", 묘: "해", 미: "해" };

const HEAVENLY_NOBLE = { 갑: ["축", "미"], 무: ["축", "미"], 경: ["축", "미"],
  을: ["자", "신"], 기: ["자", "신"], 병: ["해", "유"], 정: ["해", "유"],
  임: ["사", "묘"], 계: ["사", "묘"], 신: ["인", "오"] };
const LITERARY_STAR = { 갑: "사", 을: "오", 병: "신", 정: "유", 무: "신",
  기: "유", 경: "해", 신: "자", 임: "인", 계: "묘" };
const RED_FLAME = { 갑: "오", 을: "오", 병: "인", 정: "미", 무: "진",
  기: "진", 경: "술", 신: "유", 임: "자", 계: "신" };
const YANGIN = { 갑: "묘", 병: "오", 무: "오", 경: "유", 임: "자" };
const WHITE_TIGER = new Set(["갑진", "을미", "병술", "정축", "무진", "임술", "계축"]);
const GOEGANG = new Set(["경진", "경술", "임진", "임술"]);
const GHOST_GATE = new Set(["자유", "축오", "인미", "묘신", "진해", "사술"]);
const RESENTMENT = new Set(["자미", "축오", "인유", "묘신", "진해", "사술"]);

// 한 줄 뜻풀이. 길흉 단정보다 "이런 기운으로 본다"는 전통 해석의 요지만 적는다.
export const SHINSAL_MEANING = {
  천을귀인: "어려울 때 돕는 사람이 나타나는 가장 대표적인 길신",
  문창귀인: "학문·글·시험에 총명함이 드러나는 길신",
  양인살: "강한 추진력과 결단력, 과하면 다툼·다침을 조심",
  백호살: "강한 기운이 몰리는 자리, 사고·건강을 조심하라는 신호",
  괴강살: "우두머리 기질과 강한 고집, 극단으로 치우치지 않게",
  홍염살: "이성에게 끌림을 받는 매력",
  도화살: "사람을 끄는 매력과 인기, 구설도 함께 따름",
  역마살: "이동·변화·해외와 인연, 한곳에 머물기 어려움",
  화개살: "예술·종교·학문적 기질, 고독을 즐기는 면",
  귀문관살: "직관과 예민함이 뛰어나지만 신경이 날카로워지기 쉬움",
  원진살: "까닭 없이 서로 꺼리고 원망하는 관계의 기운",
  공망: "그 자리의 힘이 비어 있어 기대만큼 채워지지 않음",
};

function stemBranch(pillar) {
  return { stem: pillar.stem.korean, branch: pillar.branch.korean, ganji: pillar.korean };
}

export function hiddenStems(branch) {
  return HIDDEN_STEMS[branch].map((stem) => ({ stem, element: getHeavenlyStemElement(stem) }));
}

export function twelveStage(dayStem, branch) {
  const start = BRANCHES.indexOf(STAGE_BIRTH[dayStem]);
  const target = BRANCHES.indexOf(branch);
  const yang = STEMS.indexOf(dayStem) % 2 === 0;
  const offset = yang ? target - start : start - target;
  return TWELVE_STAGES[(offset + 12) % 12];
}

export function twelveShinsal(baseBranch, branch) {
  const start = BRANCHES.indexOf(TRIAD_START[baseBranch]);
  return TWELVE_SHINSAL[(BRANCHES.indexOf(branch) - start + 3 + 12) % 12];
}

function pairKey(a, b) {
  return [a, b].sort((x, y) => BRANCHES.indexOf(x) - BRANCHES.indexOf(y)).join("");
}

function elementCounts(pillars) {
  const counts = Object.fromEntries(ELEMENTS.map((element) => [element, 0]));
  for (const pillar of pillars) {
    counts[getHeavenlyStemElement(pillar.stem)] += 1;
    counts[getEarthlyBranchElement(pillar.branch)] += 1;
  }
  return counts;
}

// 원국에 걸린 신살 목록. 같은 이름이 여러 기둥에 걸리면 기둥을 모아 한 줄로 낸다.
function findShinsal(entries, voidBranches) {
  const found = new Map();
  const add = (name, key, basis) => {
    if (!found.has(name)) found.set(name, { name, meaning: SHINSAL_MEANING[name], pillars: [], basis });
    const item = found.get(name);
    if (!item.pillars.includes(key)) item.pillars.push(key);
  };
  const day = entries.find(([key]) => key === "day")[1];
  const year = entries.find(([key]) => key === "year")[1];
  for (const [key, p] of entries) {
    if (HEAVENLY_NOBLE[day.stem].includes(p.branch)) add("천을귀인", key, "일간");
    if (LITERARY_STAR[day.stem] === p.branch) add("문창귀인", key, "일간");
    if (YANGIN[day.stem] === p.branch) add("양인살", key, "일간");
    if (RED_FLAME[day.stem] === p.branch) add("홍염살", key, "일간");
    if (WHITE_TIGER.has(p.ganji)) add("백호살", key, "간지");
    if (key === "day" && GOEGANG.has(p.ganji)) add("괴강살", key, "일주");
    if (voidBranches.includes(p.branch) && key !== "day") add("공망", key, "일주");
    for (const [base, label] of [[year, "연지"], [day, "일지"]]) {
      if (p === base) continue;
      const name = twelveShinsal(base.branch, p.branch);
      if (name === "년살") add("도화살", key, label);
      if (name === "역마살" || name === "화개살") add(name, key, label);
    }
  }
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const key = pairKey(entries[i][1].branch, entries[j][1].branch);
      if (GHOST_GATE.has(key)) { add("귀문관살", entries[i][0], "지지 짝"); add("귀문관살", entries[j][0], "지지 짝"); }
      if (RESENTMENT.has(key)) { add("원진살", entries[i][0], "지지 짝"); add("원진살", entries[j][0], "지지 짝"); }
    }
  }
  return [...found.values()].map((item) => ({
    ...item, pillarNames: item.pillars.map((key) => PILLAR_NAMES[key]),
  }));
}

function addYears(date, years, months = 0, days = 0) {
  const d = new Date(Date.UTC(date.year + years, date.month - 1 + months, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function dateNum(d) { return d.year * 10000 + d.month * 100 + d.day; }

// 대운: 라이브러리 값 그대로, "지금 몇 번째 대운인가"만 정밀 시작일(년·월·일)로 가른다.
function luckCycles(luck, birth, today, dayStem) {
  if (!luck) return null;
  const start = addYears(birth, luck.startYears, luck.startMonths, luck.startDays);
  let current = -1;
  luck.pillars.forEach((_, index) => {
    if (dateNum(addYears(start, index * 10)) <= dateNum(today)) current = index;
  });
  return {
    forward: luck.forward,
    startAge: luck.startAge,
    current,
    pillars: luck.pillars.map((item) => ({
      age: item.age,
      ganji: item.korean,
      stage: twelveStage(dayStem, item.pillar.earthlyBranch),
    })),
  };
}

// 세운(올해 간지). 입춘 이후인 양력 7월 1일 정오로 그해 간지를 확정한다.
export function yearPillar(year) {
  const r = calculateFourPillars({ year, month: 7, day: 1, hour: 12, minute: 0 });
  return { stem: r.year.heavenlyStem, branch: r.year.earthlyBranch, ganji: r.yearString, hanja: r.yearHanja };
}

export function buildSajuDetail(candidate, { birth, today, luck, tenGod }) {
  const entries = PILLAR_KEYS
    .filter((key) => candidate.pillars[key])
    .map((key) => [key, stemBranch(candidate.pillars[key])]);
  const byKey = Object.fromEntries(entries);
  const dayStem = byKey.day.stem;
  const pillars = Object.fromEntries(entries.map(([key, p]) => [key, {
    hiddenStems: hiddenStems(p.branch),
    stage: twelveStage(dayStem, p.branch),
    shinsalByYear: twelveShinsal(byKey.year.branch, p.branch),
    shinsalByDay: twelveShinsal(byKey.day.branch, p.branch),
  }]));
  const annual = yearPillar(today.year);
  return {
    rules: SHINSAL_RULES,
    elements: elementCounts(entries.map(([, p]) => p)),
    pillars,
    shinsal: findShinsal(entries, candidate.voidBranches ?? []),
    luck: luckCycles(luck, birth, today, dayStem),
    annual: {
      year: today.year,
      ganji: annual.ganji,
      hanja: annual.hanja,
      tenGod: tenGod(dayStem, annual.stem),
      stage: twelveStage(dayStem, annual.branch),
      shinsalByYear: twelveShinsal(byKey.year.branch, annual.branch),
      shinsalByDay: twelveShinsal(byKey.day.branch, annual.branch),
    },
  };
}
