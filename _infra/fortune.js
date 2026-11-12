import manseryeok from "manseryeok";
import { sendWebPush } from "./webpush.js";
import { LITERARY_STAR, buildSajuDetail, twelveShinsal } from "./saju-detail.js";
import {
  READING_RULES, branchRelation as branchRelationName, buildCompatibility, buildSajuReading, elementCounts,
  elementWord, josa, stemElement, TEN_GOD_GLOSS, tenGodOf,
} from "./saju-reading.js";
import { tojeongHexagram } from "./tojeong.js";

const {
  calculateFourPillars,
  getEarthlyBranchElement,
  getEarthlyBranchYinYang,
  getHeavenlyStemElement,
  getHeavenlyStemYinYang,
  solarToLunar,
} = manseryeok;

const BRANCH_NAMES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const ELEMENTS = ["목", "화", "토", "금", "수"];
const STEM_EMOJI = { 비견: "🤝", 겁재: "⚡", 식신: "🌱", 상관: "💬", 편재: "🎯",
  정재: "🧾", 편관: "🧭", 정관: "📌", 편인: "💡", 정인: "📚" };
// 오늘 일진의 천간이 나에게 무엇인지(십성)를 밝힌 절 뒤에 바로 이어지는 문장.
const DAILY_BODY = {
  비견: "내 기준이 또렷해지는 날이에요. 함께하더라도 역할과 경계를 분명히 해 두면 편해요.",
  겁재: "경쟁심과 추진력이 커지는 날이에요. 그래서 일은 빨리 나아가지만, 즉흥 지출과 성급한 승부만은 조심하세요.",
  식신: "꾸준히 만들고 표현하기 좋은 날이에요. 작은 결과물 하나를 끝까지 완성해 보세요.",
  상관: "아이디어와 말에 힘이 붙는 날이에요. 다만 솔직함이 날카로움으로 들리지 않게 한 번 다듬어 주세요.",
  편재: "사람과 기회가 넓게 들어오는 날이에요. 가능성은 크게 보되 약속과 지출은 현실적으로 확인하세요.",
  정재: "실무와 돈 감각이 안정되는 날이에요. 미뤄 둔 정리나 확실한 한 걸음을 내딛기에 좋아요.",
  편관: "해야 할 일과 긴장감이 몰려오는 날이에요. 그래서 다 해내려 하기보다 우선순위부터 세우는 게 좋아요.",
  정관: "책임과 질서를 세우기 좋은 날이에요. 원칙대로 처리할수록 신뢰를 얻기 쉬워요.",
  편인: "익숙한 답보다 새로운 관점이 눈에 들어오는 날이에요. 바로 결론 내리기보다 한 번 더 살펴보세요.",
  정인: "배우고 도움받는 흐름이 좋은 날이에요. 기록하고 조언을 구하면 실마리가 생겨요.",
};
const BRANCH_HARMONY = new Set(["자축", "인해", "묘술", "진유", "사신", "오미"]);
const BRANCH_CLASH = new Set(["자오", "축미", "인신", "묘유", "진술", "사해"]);
// 분야별 십성 가중치. wealth·career·love 는 v2 와 같다(기존 판정이 바뀌지 않게).
const CATEGORY_GOD_WEIGHT = {
  wealth: { 정재: 2, 편재: 2, 식신: 1, 상관: 1, 비견: -1, 겁재: -2, 편관: -1 },
  career: { 정관: 2, 편관: 1, 정인: 2, 편인: 1, 식신: 1, 정재: 1, 편재: 1, 겁재: -1 },
  love: { 식신: 1, 정재: 1, 편재: 1, 정관: 1, 정인: 1, 상관: -1, 겁재: -1 },
  health: { 정인: 1, 편인: 1, 비견: 1, 식신: 1, 상관: -1, 편재: -1, 편관: -2, 정관: -1 },
  social: { 비견: 1, 겁재: -1, 식신: 1, 상관: -2, 편재: 1, 편관: -1, 정관: 1, 편인: -1, 정인: 1 },
  study: { 정인: 2, 편인: 2, 식신: 1, 정관: 1, 겁재: -1, 편재: -2, 정재: -1 },
};
export const CATEGORY_KEYS = ["wealth", "career", "love", "health", "social", "study"];
export const CATEGORY_NAMES = { wealth: "재물운", career: "직업운", love: "연애운",
  health: "건강운", social: "대인운", study: "학업운" };
// 근거 절 뒤에 이어지는 결론+조언. {body} 는 건강 주의일 때 일간 오행의 전통 대응 부위.
const CATEGORY_TEXT = {
  wealth: {
    원활: "수입과 지출의 흐름을 잡기 좋아요. 눈앞의 기회를 차분히 따져 보세요.",
    무난: "큰 변동보다 관리가 중요한 날이에요. 계획한 범위 안에서 움직여 보세요.",
    주의: "충동 지출이나 성급한 결정이 나오기 쉬워요. 조건을 한 번 더 확인하세요.",
  },
  career: {
    원활: "집중력과 실행력이 잘 이어져요. 중요한 일을 한 단계 진전시켜 보세요.",
    무난: "평소 리듬을 지키면 안정적인 날이에요. 우선순위대로 처리해 보세요.",
    주의: "업무 압박이나 의견 충돌이 생기기 쉬워요. 서두르지 말고 기준부터 확인하세요.",
  },
  love: {
    원활: "대화와 교류가 자연스럽게 이어져요. 먼저 마음을 표현해 보세요.",
    무난: "큰 기복 없이 편안한 흐름이에요. 평소처럼 솔직하게 대화해 보세요.",
    주의: "감정이 엇갈리기 쉬워요. 단정하기보다 상대의 말을 한 번 더 들어 보세요.",
  },
  health: {
    원활: "몸에 기운이 차는 편이에요. 가벼운 운동을 새로 시작하기 좋아요.",
    무난: "컨디션이 평소와 비슷해요. 잠과 식사 리듬만 지켜 주세요.",
    주의: "피로가 쉽게 쌓일 수 있어요. 전통적으로 {body}에 빗대는 기운이니, 무리하지 말고 일찍 쉬어 주세요.",
  },
  social: {
    원활: "사람 사이가 매끄러워요. 미뤄 둔 연락이나 부탁을 꺼내기 좋아요.",
    무난: "무난하게 어울리는 날이에요. 말하기보다 듣는 쪽에 조금 더 서 보세요.",
    주의: "말이 오해를 부르기 쉬워요. 메시지는 보내기 전에 한 번 더 읽어 보세요.",
  },
  study: {
    원활: "머리에 잘 들어오는 날이에요. 어려운 단원이나 자격 공부를 붙잡아 보세요.",
    무난: "평소 분량을 꾸준히 채우면 되는 날이에요.",
    주의: "집중이 흩어지기 쉬워요. 25분씩 짧게 끊어서 해 보세요.",
  },
};
const NO_SIGNAL = ["특별히 걸리는 신호가 없어서", "크게 기우는 신호가 없어서", "눈에 띄는 합이나 충이 없어서"];
const ELEMENT_BODY = { 목: "간·눈·근육", 화: "심장·혈액순환", 토: "위장·소화", 금: "폐·호흡기·피부", 수: "신장·몸의 수분" };
// 행운 표시 — 오행마다 전래 대응(색·방위·하도수).
const LUCKY = {
  목: { color: "초록", direction: "동쪽", numbers: [3, 8] },
  화: { color: "빨강", direction: "남쪽", numbers: [2, 7] },
  토: { color: "노랑·황토", direction: "가까운 곳(중앙)", numbers: [5, 10] },
  금: { color: "흰색·은색", direction: "서쪽", numbers: [4, 9] },
  수: { color: "검정·남색", direction: "북쪽", numbers: [1, 6] },
};
const BRANCH_RANGE = ["23~01시", "01~03시", "03~05시", "05~07시", "07~09시", "09~11시",
  "11~13시", "13~15시", "15~17시", "17~19시", "19~21시", "21~23시"];
// 오늘 일진이 일지 기준 12신살 중 무엇에 걸리는지 — 뚜렷한 셋만 한 문장 덧붙인다.
const SHINSAL_ACCENT = {
  역마살: "또 역마(움직임의 별)가 드는 날이라 이동이나 새 일정이 잦아질 수 있어요.",
  년살: "또 도화(사람을 끄는 별)가 드는 날이라 눈길이 모이니, 말과 행동을 가볍게 흘리지 마세요.",
  화개살: "또 화개(혼자 몰두하는 별)가 드는 날이라 공부나 창작에 집중하기 좋아요.",
};
const PILLAR_KEYS = ["year", "month", "day", "hour"];
const RULES = {
  version: "korea-kst-midnight-v1",
  calendar: "solar",
  timeZone: "Asia/Seoul",
  solarTerms: "minute-precision",
  dayBoundary: "midnight",
  trueSolarTime: false,
};

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} 값이 올바르지 않습니다.`);
  }
  return value;
}

function validSolarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
  if (!match) throw new RangeError("출생 시각은 HH:MM 형식이어야 합니다.");
  const hour = integer(+match[1], "시", 0, 23);
  const minute = integer(+match[2], "분", 0, 59);
  return { hour, minute, label: value };
}

function timeCandidates(input) {
  if (input.timeMode === "clock") {
    return { includeHour: true, points: [parseClock(input.time)] };
  }
  if (input.timeMode !== "branch") throw new RangeError("시간 입력 방식이 올바르지 않습니다.");
  if (input.branch == null) {
    return {
      includeHour: false,
      points: [
        { hour: 0, minute: 0, label: "00:00 기준" },
        { hour: 23, minute: 59, label: "23:59 기준" },
      ],
    };
  }
  const branch = integer(input.branch, "시진", 0, 11);
  if (branch === 0) {
    return {
      includeHour: true,
      points: [
        { hour: 0, minute: 30, label: "자시 중 00시대 기준" },
        { hour: 23, minute: 30, label: "자시 중 23시대 기준" },
      ],
    };
  }
  const startHour = branch * 2 - 1;
  return {
    includeHour: true,
    points: [
      { hour: startHour, minute: 0, label: `${BRANCH_NAMES[branch]}시 시작 기준` },
      { hour: startHour + 1, minute: 59, label: `${BRANCH_NAMES[branch]}시 끝 기준` },
    ],
  };
}

function pillarData(result, key, includeHour) {
  if (key === "hour" && !includeHour) return null;
  const pillar = result[key];
  const hanja = Array.from(result[`${key}Hanja`]);
  return {
    korean: result[`${key}String`],
    hanja: result[`${key}Hanja`],
    stem: {
      korean: pillar.heavenlyStem,
      hanja: hanja[0],
      element: getHeavenlyStemElement(pillar.heavenlyStem),
      yinYang: getHeavenlyStemYinYang(pillar.heavenlyStem),
      tenGod: result.tenGods[key]?.stem ?? null,
    },
    branch: {
      korean: pillar.earthlyBranch,
      hanja: hanja[1],
      element: getEarthlyBranchElement(pillar.earthlyBranch),
      yinYang: getEarthlyBranchYinYang(pillar.earthlyBranch),
      tenGod: result.tenGods[key]?.branch ?? null,
    },
  };
}

function serialize(result, point, includeHour) {
  return {
    timeLabel: point.label,
    pillars: Object.fromEntries(PILLAR_KEYS.map((key) => [key, pillarData(result, key, includeHour)])),
    voidBranches: result.voidBranches,
  };
}

function signature(candidate) {
  return PILLAR_KEYS.map((key) => candidate.pillars[key]?.korean ?? "미상").join("|");
}

const tenGod = tenGodOf;

function pairKey(a, b) {
  return [a, b].sort((x, y) => BRANCH_NAMES.indexOf(x) - BRANCH_NAMES.indexOf(y)).join("");
}

function branchRelation(natalBranch, todayBranch) {
  if (!natalBranch) return 0;
  const key = pairKey(natalBranch, todayBranch);
  if (BRANCH_HARMONY.has(key)) return 1;
  if (BRANCH_CLASH.has(key)) return -1;
  return 0;
}

// 분야 하나: 근거(reason)들을 모아 점수를 내고, 결론과 같은 방향의 가장 센 근거를
// 문장 앞머리 절로 쓴다. 근거끼리 엇갈리면 둘을 함께 밝힌다.
function categoryResult(key, reasons, seed, dayElement) {
  const score = reasons.reduce((sum, r) => sum + r.w, 0);
  const level = score >= 2 ? "원활" : score <= -2 ? "주의" : "무난";
  const strongest = (sign) => reasons.filter((r) => Math.sign(r.w) === sign)
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))[0];
  const pos = strongest(1);
  const neg = strongest(-1);
  let lead;
  if (level === "원활") lead = pos.cause;
  else if (level === "주의") lead = neg.cause;
  else if (pos && neg) lead = `좋은 신호(${pos.label})와 조심할 신호(${neg.label})가 섞여 있어서`;
  else lead = (pos ?? neg)?.cause ?? NO_SIGNAL[seed % NO_SIGNAL.length];
  const body = CATEGORY_TEXT[key][level].replace("{body}", ELEMENT_BODY[dayElement]);
  return { level, comment: `${lead} ${body}`, reasons: reasons.map((r) => r.key) };
}

function godReason(key, god) {
  const w = CATEGORY_GOD_WEIGHT[key][god] ?? 0;
  if (!w) return [];
  return [{ key: `god:${god}`, w, label: `${god}의 기운`,
    cause: `오늘 들어온 ${god}(${TEN_GOD_GLOSS[god]})${josa(god, "이라서", "라서").slice(god.length)}` }];
}

function relationReason(prefix, place, relation, weight) {
  if (!relation) return [];
  return relation > 0
    ? [{ key: `${prefix}:합`, w: weight, label: `${place} 합`, cause: `오늘 지지가 ${place}와 합을 이뤄서` }]
    : [{ key: `${prefix}:충`, w: -weight, label: `${place} 충`, cause: `오늘 지지가 ${place}와 부딪혀서(충)` }];
}

function categoryFortunes(candidate, today, god, harmony, clash, gender, seed) {
  const todayBranch = today.branch.korean;
  const dayStem = candidate.pillars.day.stem.korean;
  const dayElement = stemElement(dayStem);
  const dayRelation = branchRelation(candidate.pillars.day?.branch.korean, todayBranch);
  const monthRelation = branchRelation(candidate.pillars.month?.branch.korean, todayBranch);
  const general = [
    ...(harmony.length ? [{ key: "natal:합", w: 1, label: "명식과 합", cause: "오늘 지지가 명식과 합을 이뤄서" }] : []),
    ...(clash.length ? [{ key: "natal:충", w: -1, label: "명식과 충", cause: "오늘 지지가 명식과 충(부딪침)이라" }] : []),
  ];
  const spouse = (gender === "male" && ["정재", "편재"].includes(god))
    || (gender === "female" && ["정관", "편관"].includes(god))
    ? [{ key: "spouse", w: 1, label: "배우자 별", cause: "오늘 기운이 전통적으로 배우자를 뜻하는 별(남성은 재성, 여성은 관성)이라서" }] : [];
  const counts = elementCounts(candidate);
  const todayElements = [...new Set([today.stem.element, today.branch.element])];
  const supply = todayElements.filter((e) => counts[e] === 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const crowd = todayElements.filter((e) => counts[e] >= Math.ceil(total * 3 / 8));
  const elementReasons = [
    ...supply.slice(0, 1).map((e) => ({ key: `supply:${e}`, w: 1, label: `${e} 기운 보충`,
      cause: `명식에 비어 있던 ${elementWord(e)} 기운이 오늘 채워져서` })),
    ...crowd.slice(0, 1).map((e) => ({ key: `crowd:${e}`, w: -1, label: `${e} 기운 과다`,
      cause: `이미 많은 ${elementWord(e)} 기운이 오늘 더 보태져서` })),
  ];
  const dayResentment = branchRelationName(candidate.pillars.day.branch.korean, todayBranch) === "원진"
    ? [{ key: "day:원진", w: -1, label: "일지 원진", cause: "오늘 지지가 일지와 원진(까닭 없이 서로 꺼림)이라" }] : [];
  const literary = LITERARY_STAR[dayStem] === todayBranch
    ? [{ key: "문창", w: 2, label: "문창", cause: "오늘 지지가 문창(글과 시험의 별) 자리라서" }] : [];
  const hwagae = twelveShinsal(candidate.pillars.day.branch.korean, todayBranch) === "화개살"
    ? [{ key: "화개", w: 1, label: "화개", cause: "화개(혼자 몰두하는 별)가 드는 날이라서" }] : [];
  const dayClashOnly = dayRelation < 0 ? relationReason("day", "일지(나 자신의 자리)", dayRelation, 1) : [];
  const reasons = {
    wealth: [...godReason("wealth", god), ...general],
    career: [...godReason("career", god), ...relationReason("month", "월지(일터·사회 자리)", monthRelation, 2)],
    love: [...godReason("love", god), ...relationReason("day", "일지(가까운 사람의 자리)", dayRelation, 2), ...spouse],
    health: [...godReason("health", god), ...dayClashOnly, ...elementReasons],
    social: [...godReason("social", god), ...general, ...dayResentment],
    study: [...godReason("study", god), ...literary, ...hwagae],
  };
  return Object.fromEntries(CATEGORY_KEYS.map((key, i) =>
    [key, categoryResult(key, reasons[key], seed + i, dayElement)]));
}

// 행운의 오행: 명식 + 오늘 일진 두 글자를 합쳐 가장 모자란 오행. 같으면 나를 낳는 오행 →
// 나와 같은 오행 → 내가 낳는 오행 … 순(나를 받쳐 주는 쪽 먼저).
function luckyOf(candidate, today, dayElement) {
  const counts = elementCounts(candidate);
  counts[today.stem.element] += 1;
  counts[today.branch.element] += 1;
  const start = (ELEMENTS.indexOf(dayElement) + 4) % 5;
  const order = [0, 1, 2, 3, 4].map((i) => ELEMENTS[(start + i) % 5]);
  const element = order.reduce((best, e) => (counts[e] < counts[best] ? e : best), order[0]);
  const info = LUCKY[element];
  const number = info.numbers[today.stem.yinYang === "양" ? 0 : 1];
  return {
    element, color: info.color, direction: info.direction, number,
    text: `명식에 오늘 일진까지 더해 보면 ${josa(elementWord(element), "이", "가")} 가장 모자라요(${counts[element]}개). 그래서 ${elementWord(element)}을 뜻하는 ${info.color} 계열 색, ${info.direction}, 숫자 ${number}${josa(String(number), "이", "가").slice(String(number).length)} 오늘 기운을 채워 주는 행운 표시예요.`
      .replace(`${elementWord(element)}을`, josa(elementWord(element), "을", "를")),
  };
}

// 조심할 시간: 오늘 일진 지지와 충하는 시진. 좋은 시간: 내 일지와 육합하는 시진.
function timesOf(candidate, today) {
  const todayIndex = BRANCH_NAMES.indexOf(today.branch.korean);
  const clashIndex = (todayIndex + 6) % 12;
  const dayBranch = candidate.pillars.day.branch.korean;
  const goodIndex = BRANCH_NAMES.findIndex((b) => b !== dayBranch && BRANCH_HARMONY.has(pairKey(b, dayBranch)));
  const label = (i) => `${BRANCH_NAMES[i]}시(${BRANCH_RANGE[i]})`;
  return {
    caution: { branch: BRANCH_NAMES[clashIndex], range: BRANCH_RANGE[clashIndex],
      text: `${josa(label(clashIndex), "은", "는")} 오늘 일진의 ${josa(today.branch.korean, "과", "와")} 정면으로 부딪히는(충) 시간이라, 중요한 결정이나 말다툼은 이때를 피하는 게 좋아요.` },
    good: { branch: BRANCH_NAMES[goodIndex], range: BRANCH_RANGE[goodIndex],
      text: `${josa(label(goodIndex), "은", "는")} 내 일지 ${josa(dayBranch, "과", "와")} 합하는 시간이라, 연락·약속·부탁을 잡기에 좋아요.` },
  };
}

export function buildDailyFortune(candidate, date, gender = "unspecified") {
  const todayChart = calculateFourPillars({
    year: date.year, month: date.month, day: date.day, hour: 12, minute: 0,
    dayBoundary: RULES.dayBoundary,
  });
  const todayPillar = pillarData(todayChart, "day", true);
  const dayStem = candidate.pillars.day.stem.korean;
  const dayElement = stemElement(dayStem);
  const god = tenGod(dayStem, todayPillar.stem.korean);
  const natalBranches = PILLAR_KEYS.map((key) => candidate.pillars[key]?.branch.korean).filter(Boolean);
  const harmony = natalBranches.filter((branch) => BRANCH_HARMONY.has(pairKey(branch, todayPillar.branch.korean)));
  const clash = natalBranches.filter((branch) => BRANCH_CLASH.has(pairKey(branch, todayPillar.branch.korean)));
  const seed = date.year * 372 + date.month * 31 + date.day;
  const categories = categoryFortunes(candidate, todayPillar, god, harmony, clash, gender, seed);
  const todayShinsal = twelveShinsal(candidate.pillars.day.branch.korean, todayPillar.branch.korean);
  const stemName = `${todayPillar.stem.korean}${todayPillar.stem.element}`;
  const parts = [
    `오늘은 ${todayPillar.korean}(${todayPillar.hanja})일이에요.`,
    `일진의 천간 ${josa(stemName, "이", "가")} ${dayStem}${dayElement}인 나에게 ${god}(${TEN_GOD_GLOSS[god]})${josa(god, "이라서", "라서").slice(god.length)}, ${DAILY_BODY[god]}`,
  ];
  const picks = [`god:${god}`];
  if (harmony.length && clash.length) { picks.push("accent:both"); parts.push("그리고 명식과 합(어울림)과 충(부딪침)이 함께 걸려 있어서, 속도보다 조율이 중요해요."); }
  else if (harmony.length) { picks.push("accent:harmony"); parts.push("게다가 오늘 지지가 내 명식과 합(어울림)을 이뤄서 사람이나 계획을 잇기에 좋아요."); }
  else if (clash.length) { picks.push("accent:clash"); parts.push("다만 오늘 지지가 내 명식과 충(부딪침)이라 일정이 바뀌거나 감정이 앞서기 쉬우니 여유를 두세요."); }
  if (SHINSAL_ACCENT[todayShinsal]) { picks.push(`shinsal:${todayShinsal}`); parts.push(SHINSAL_ACCENT[todayShinsal]); }
  return {
    date: `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
    iljin: todayPillar.korean,
    iljinHanja: todayPillar.hanja,
    tenGod: god,
    emoji: STEM_EMOJI[god],
    text: parts.join(" "),
    categories,
    lucky: luckyOf(candidate, todayPillar, dayElement),
    times: timesOf(candidate, todayPillar),
    signals: { harmony, clash, shinsal: todayShinsal },
    picks,
    method: "natal-daymaster+daily-pillar-v3",
  };
}

function kstToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RULES.timeZone, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: +value.year, month: +value.month, day: +value.day };
}

export function buildChart(input, today = kstToday()) {
  const year = integer(input?.year, "연도", 1800, 2300);
  const month = integer(input?.month, "월", 1, 12);
  const day = integer(input?.day, "일", 1, 31);
  if (!validSolarDate(year, month, day)) throw new RangeError("실재하지 않는 양력 날짜입니다.");

  const { includeHour, points } = timeCandidates(input);
  const gender = ["male", "female"].includes(input?.gender) ? input.gender : undefined;
  const candidates = [];
  const seen = new Set();
  for (const point of points) {
    const result = calculateFourPillars({
      year, month, day, hour: point.hour, minute: point.minute,
      dayBoundary: RULES.dayBoundary, gender,
    });
    const candidate = serialize(result, point, includeHour);
    const key = signature(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      candidate.detail = buildSajuDetail(candidate, {
        birth: { year, month, day }, today, luck: result.luckPillars ?? null, tenGod,
      });
      candidate.reading = buildSajuReading(candidate, candidate.detail);
      candidates.push(candidate);
    }
  }

  return {
    birthDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    rules: RULES,
    readingRules: READING_RULES,
    ambiguous: candidates.length > 1,
    ambiguityReason: candidates.length > 1
      ? (input.branch === 0 ? "자시는 00시대와 23시대가 날짜 경계를 사이에 둡니다."
        : "선택한 시간 범위 안에서 절기 또는 날짜 경계가 바뀝니다.")
      : null,
    candidates,
  };
}

function xmlTag(xml, name) {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match?.[1]?.trim() ?? null;
}

function xmlItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
}

function serviceKey(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}

async function kasiDay(env, year, month, day) {
  const key = serviceKey(env.KASI_SERVICE_KEY);
  if (!key) return { status: "not-configured" };

  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheRequest = new Request(`https://kasi-cache.bubblelab.dev/${dateKey}`);
  const cached = await cache?.match(cacheRequest);
  if (cached) return cached.json();

  const endpoint = new URL("https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo");
  endpoint.searchParams.set("solYear", String(year));
  endpoint.searchParams.set("solMonth", String(month).padStart(2, "0"));
  endpoint.searchParams.set("solDay", String(day).padStart(2, "0"));
  endpoint.searchParams.set("ServiceKey", key);

  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    const xml = await response.text();
    if (!response.ok || xmlTag(xml, "resultCode") !== "00") {
      return { status: "unavailable" };
    }
    const result = {
      status: "received",
      lunar: {
        year: +(xmlTag(xml, "lunYear") ?? 0),
        month: +(xmlTag(xml, "lunMonth") ?? 0),
        day: +(xmlTag(xml, "lunDay") ?? 0),
        leapMonth: xmlTag(xml, "lunLeapmonth"),
      },
      secha: xmlTag(xml, "lunSecha"),
      wolgeon: xmlTag(xml, "lunWolgeon"),
      iljin: xmlTag(xml, "lunIljin"),
      julianDay: +(xmlTag(xml, "solJd") ?? 0),
    };
    if (cache) {
      await cache.put(cacheRequest, Response.json(result, {
        headers: { "Cache-Control": "public, max-age=2592000" },
      }));
    }
    return result;
  } catch {
    return { status: "unavailable" };
  }
}

export function selectLunarConversion(xml, expected) {
  if (xmlTag(xml, "resultCode") !== "00") return null;
  const leapLabel = expected.leap ? "윤" : "평";
  const item = xmlItems(xml).find((value) =>
    +(xmlTag(value, "lunYear") ?? 0) === expected.year
    && +(xmlTag(value, "lunMonth") ?? 0) === expected.month
    && +(xmlTag(value, "lunDay") ?? 0) === expected.day
    && xmlTag(value, "lunLeapmonth") === leapLabel);
  if (!item) return null;
  const solar = {
    year: +(xmlTag(item, "solYear") ?? 0),
    month: +(xmlTag(item, "solMonth") ?? 0),
    day: +(xmlTag(item, "solDay") ?? 0),
  };
  return validSolarDate(solar.year, solar.month, solar.day) ? solar : null;
}

async function kasiSolarFromLunar(env, lunar) {
  const key = serviceKey(env.KASI_SERVICE_KEY);
  if (!key) throw new Error("음력 변환 서비스가 설정되지 않았습니다.");
  const cacheKey = `${lunar.year}-${lunar.month}-${lunar.day}-${lunar.leap ? "leap" : "normal"}`;
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheRequest = new Request(`https://kasi-cache.bubblelab.dev/lunar/${cacheKey}`);
  const cached = await cache?.match(cacheRequest);
  if (cached) return cached.json();

  const endpoint = new URL("https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getSolCalInfo");
  endpoint.searchParams.set("lunYear", String(lunar.year));
  endpoint.searchParams.set("lunMonth", String(lunar.month).padStart(2, "0"));
  endpoint.searchParams.set("lunDay", String(lunar.day).padStart(2, "0"));
  endpoint.searchParams.set("ServiceKey", key);
  let response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error("KASI 음력 변환 서비스에 연결하지 못했습니다.");
  }
  const xml = await response.text();
  const solar = response.ok ? selectLunarConversion(xml, lunar) : null;
  if (!solar) throw new RangeError("해당 음력 날짜가 없거나 평달·윤달 선택이 올바르지 않습니다.");
  if (cache) {
    await cache.put(cacheRequest, Response.json(solar, {
      headers: { "Cache-Control": "public, max-age=31536000" },
    }));
  }
  return solar;
}

async function resolveBirthDate(input, env) {
  const calendar = input?.calendar === "lunar" ? "lunar" : "solar";
  const year = integer(input?.year, "연도", 1800, 2300);
  const month = integer(input?.month, "월", 1, 12);
  const day = integer(input?.day, "일", 1, calendar === "lunar" ? 30 : 31);
  if (calendar === "solar") {
    if (!validSolarDate(year, month, day)) throw new RangeError("실재하지 않는 양력 날짜입니다.");
    return { calendar, inputDate: { year, month, day, leap: false }, solar: { year, month, day } };
  }
  const lunar = { year, month, day, leap: input?.lunarLeap === true };
  return { calendar, inputDate: lunar, solar: await kasiSolarFromLunar(env, lunar) };
}

// 토정비결은 음력 생년월일로 괘를 짓는다. 시각과 무관해서 명식 후보가 여럿이어도 하나다.
// 보는 해는 음력 기준 올해와 내년 — 연말에 이듬해 신수를 미리 보는 일이 흔하다.
export function buildTojeong(resolved, today) {
  const lunar = resolved.calendar === "lunar"
    ? resolved.inputDate
    : (({ year, month, day, isLeapMonth }) => ({ year, month, day, leap: isLeapMonth }))(
      solarToLunar(resolved.solar.year, resolved.solar.month, resolved.solar.day));
  const thisYear = solarToLunar(today.year, today.month, today.day).year;
  return [thisYear, thisYear + 1]
    .filter((year) => year >= lunar.year)
    .map((year) => tojeongHexagram(lunar, year));
}

export async function handleFortuneChart(request, env) {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (+(request.headers.get("Content-Length") ?? 0) > 2048) {
    return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }
  try {
    const input = await request.json();
    const resolved = await resolveBirthDate(input, env);
    const today = kstToday();
    const chart = buildChart({ ...input, ...resolved.solar }, today);
    chart.inputCalendar = resolved.calendar;
    chart.inputDate = resolved.inputDate;
    chart.solarDate = resolved.solar;
    const gender = ["male", "female"].includes(input?.gender) ? input.gender : "unspecified";
    chart.gender = gender;
    chart.dailyFortunes = chart.candidates.map((candidate) => buildDailyFortune(candidate, today, gender));
    chart.tojeong = buildTojeong(resolved, today);
    chart.lunarToday = solarToLunar(today.year, today.month, today.day);
    // 궁합: 상대 생년월일이 같이 오면 같은 방식으로 명식을 세워 견준다. 상대 정보도 저장하지
    // 않고 응답에는 상대의 팔자와 궁합 풀이만 싣는다.
    if (input?.partner && typeof input.partner === "object") {
      const partnerResolved = await resolveBirthDate(input.partner, env);
      const partnerChart = buildChart({ ...input.partner, ...partnerResolved.solar }, today);
      const partner = partnerChart.candidates[0];
      chart.partner = {
        solarDate: partnerResolved.solar,
        ambiguous: partnerChart.ambiguous,
        pillars: partner.pillars,
        dayMaster: partner.reading.dayMaster,
      };
      chart.compatibility = buildCompatibility(chart.candidates[0], partner);
    }
    const [year, month, day] = chart.birthDate.split("-").map(Number);
    const verification = await kasiDay(env, year, month, day);
    if (verification.status === "received") {
      const expected = chart.candidates[0].pillars.day;
      verification.status = verification.iljin === `${expected.korean}(${expected.hanja})`
        ? "verified" : "mismatch";
    }
    return Response.json({ ...chart, verification }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "명식을 계산하지 못했습니다.";
    return Response.json({ error: message }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }
}

// ── 매일 오전 8시(KST) 운세 알림 ──────────────────────────────────
// 운세 페이지는 로그인 없는 공개 유틸이라, 익명 푸시 구독을 FortuneDO 한
// 인스턴스에 endpoint 해시로 저장한다. 개인 명식은 브라우저에만 있으므로
// 알림은 "오늘의 운세를 확인하세요" 넛지 + 날짜별 고정 문구만 보낸다.
const MAX_FORTUNE_SUBS = 20000;
const FORTUNE_PUSH_URL = "https://util.bubblelab.dev/fortune";
// 날짜(KST)로 고른다 — 하루 동안 같은 문구가 유지된다.
const FORTUNE_NUDGES = [
  "오늘은 어떤 하루가 펼쳐질까요? 운세를 확인해보세요.",
  "좋은 아침이에요. 오늘의 운세 한 줄 보고 가세요.",
  "새로운 하루의 기운을 살펴볼 시간이에요.",
  "오늘의 바이오리듬과 운세가 준비됐어요.",
  "잠깐, 오늘의 운세부터 확인하고 시작해요.",
  "오늘 당신에게 찾아올 작은 행운을 미리 만나보세요.",
  "하루를 여는 운세 한 줄, 지금 확인해보세요.",
];

const hexDigest = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function endpointKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return `push:${hexDigest(digest).slice(0, 32)}`;
}

function kstDateStamp(now = new Date()) {
  const { year, month, day } = kstToday(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// 날짜 문자열을 안정적인 정수 시드로 — 날짜마다 다른 문구를 고정 선택한다.
function stampSeed(stamp) {
  let hash = 0;
  for (const char of stamp) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

const fortuneStub = (env) => env.FORTUNE.get(env.FORTUNE.idFromName("global"));

// 워커 라우트: /_fortune/push (GET 설정 · POST 구독 · DELETE 해지)
export async function handleFortunePush(request, env) {
  if (request.method === "GET") {
    return Response.json(
      { vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return Response.json({ error: "push is not configured" }, { status: 503 });
  }
  if (+(request.headers.get("Content-Length") ?? 0) > 4096) {
    return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }
  return fortuneStub(env).fetch("https://fortune.internal/push", {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}

// cron(23:00 UTC = 08:00 KST)에서 호출 — 구독한 모든 기기에 알림 발송
export function sendFortuneDaily(env) {
  return fortuneStub(env).fetch("https://fortune.internal/notify", { method: "POST" });
}

export class FortuneDO {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/push" && request.method === "POST") return this.subscribe(request);
    if (url.pathname === "/push" && request.method === "DELETE") return this.unsubscribe(request);
    if (url.pathname === "/notify" && request.method === "POST") return this.notifyDaily();
    return new Response("not found", { status: 404 });
  }

  async subscribe(request) {
    const body = await request.json().catch(() => ({}));
    const sub = body.subscription ?? body;
    if (typeof sub?.endpoint !== "string" || !sub.endpoint.startsWith("https://") ||
        typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") {
      return Response.json({ error: "invalid subscription" }, { status: 400 });
    }
    const key = await endpointKey(sub.endpoint);
    // 이미 등록된 endpoint면 갱신, 새 endpoint면 전체 상한을 확인한다.
    if (!(await this.storage.get(key))) {
      const count = (await this.storage.list({ prefix: "push:", limit: MAX_FORTUNE_SUBS + 1 })).size;
      if (count >= MAX_FORTUNE_SUBS) {
        return Response.json({ error: "구독자가 가득 찼습니다" }, { status: 503 });
      }
    }
    await this.storage.put(key, {
      endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    return Response.json({ subscribed: true });
  }

  async unsubscribe(request) {
    const body = await request.json().catch(() => ({}));
    const endpoint = String(body.endpoint ?? "");
    if (endpoint) await this.storage.delete(await endpointKey(endpoint));
    return Response.json({ subscribed: false });
  }

  async notifyDaily() {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = this.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return Response.json({ sent: 0 });
    const vapid = {
      publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT || "https://util.bubblelab.dev",
    };
    const stamp = kstDateStamp();
    const body = FORTUNE_NUDGES[stampSeed(stamp) % FORTUNE_NUDGES.length];
    const payload = JSON.stringify({ title: "🔮 오늘의 운세", body, url: FORTUNE_PUSH_URL });
    let sent = 0;
    for (const [key, sub] of await this.storage.list({ prefix: "push:" })) {
      try {
        const result = await sendWebPush(sub, payload, vapid);
        if (result.gone) await this.storage.delete(key); // 만료 구독 정리
        else if (result.ok) sent += 1;
      } catch (error) {
        console.error("fortune push send failed", error);
      }
    }
    return Response.json({ sent });
  }
}
