import manseryeok from "manseryeok";
import { sendWebPush, validPushSubscription } from "./webpush.js";
import { createDelivery, postToDiscord, secretMatches } from "./papers.js";
import { comicReadyNotice, reviewNotice, IG_FORM_ROUND_CAP } from "./fortune-comic-notice.js";
import { igformInDO, newReceiptToken, receiptHash, RECEIPT_TOKEN_RE, reminderIcs, roundCap } from "./fortune-igform.js";
import { shareInDO } from "./fortune-share.js";
import { igInDO } from "./fortune-ig.js";
export { handleFortuneShare, SHARE_FILES, SHARE_TTL_MS } from "./fortune-share.js";
export { handleFortuneIg } from "./fortune-ig.js";
import { LITERARY_STAR, buildSajuDetail, twelveShinsal } from "./saju-detail.js";
import {
  READING_RULES, branchRelation as branchRelationName, buildCompatibility, buildSajuReading, elementCounts, markSpans,
  elementWord, josa, stemElement, TEN_GOD_GLOSS, tenGodOf,
} from "./saju-reading.js";
import { tojeongHexagram } from "./tojeong.js";
import { sajuNoteInput } from "./saju-traits.js";
import { buildLifeCurve } from "./life-curve.js";

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
  겁재: "경쟁심과 추진력이 커지는 날이에요. 일이 빨리 나아가는 대신, 즉흥 지출과 성급한 승부는 조심하세요.",
  식신: "꾸준히 만들고 표현하기 좋은 날이에요. 작은 결과물 하나를 끝까지 완성해 보세요.",
  상관: "아이디어와 말에 힘이 붙는 날이에요. 다만 솔직함이 날카로움으로 들리지 않게 한 번 다듬어 주세요.",
  편재: "사람과 기회가 넓게 들어오는 날이에요. 가능성은 크게 보되 약속과 지출은 현실적으로 확인하세요.",
  정재: "실무와 돈 감각이 안정되는 날이에요. 미뤄 둔 정리를 끝내거나 확실한 한 걸음을 내딛기에 좋아요.",
  편관: "해야 할 일과 긴장감이 몰려오는 날이에요. 그래서 다 해내려 하기보다 우선순위부터 세우는 게 좋아요.",
  정관: "책임과 질서를 세우기 좋은 날이에요. 원칙대로 처리할수록 신뢰를 얻기 쉬워요.",
  편인: "익숙한 답보다 새로운 관점이 눈에 들어오는 날이에요. 바로 결론 내리기보다 한 번 더 살펴보세요.",
  정인: "배우고 도움받는 흐름이 좋은 날이에요. 기록하고 조언을 구하면 실마리가 생겨요.",
};
// brief 총평용 한 문장(40자 안팎). 십성마다 "~날" 명사구 하나, 합·충이면 꼬리 하나를 붙인다.
const HEADLINE_CORE = {
  비견: "내 기준을 또렷이 세우기 좋은 날", 겁재: "추진력이 커지는 날",
  식신: "작은 결과물을 완성하기 좋은 날", 상관: "아이디어가 빛나는 날",
  편재: "사람과 기회가 넓게 들어오는 날", 정재: "미뤄 둔 정리를 끝내기 좋은 날",
  편관: "할 일이 몰려오는 날", 정관: "원칙대로 하면 신뢰를 얻는 날",
  편인: "새로운 관점이 눈에 들어오는 날", 정인: "배우고 도움받기 좋은 날",
};
const HEADLINE_TAIL = {
  harmony: (core) => `${core}이고, 사람을 잇기에도 좋아요.`,
  clash: (core) => `${core}이지만, 일정 변화엔 여유를 두세요.`,
  both: (core) => `${core}이에요. 속도보다 조율이 먼저예요.`,
  none: (core) => `${core}이에요.`,
};
export function dailyHeadline(god, harmony, clash) {
  const kind = harmony && clash ? "both" : harmony ? "harmony" : clash ? "clash" : "none";
  return HEADLINE_TAIL[kind](HEADLINE_CORE[god]);
}
const TRIADS = [["신", "자", "진"], ["인", "오", "술"], ["사", "유", "축"], ["해", "묘", "미"]];
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
// 근거가 엇갈릴 때의 절 — 같은 두 근거가 여러 분야에 걸려도 틀이 겹치지 않게 돌려 쓴다.
const MIXED_LEAD = [
  (p, n) => `${josa(p, "과", "와")} ${josa(n, "이", "가")} 엇갈려서`,
  (p, n) => `좋은 신호(${p})와 조심할 신호(${n})가 맞물려서`,
  (p, n) => `${josa(p, "은", "는")} 도움이 되고 ${josa(n, "은", "는")} 부담이 돼서`,
];
// 근거가 하나뿐인 무난 — "조금 힘이 실리고," 같은 절을 분야마다 돌려 쓴다.
const WEAK_POS = ["조금 힘이 실리고,", "살짝 보탬이 되고,", "한결 수월해지고,"];
const WEAK_NEG = ["조금 신경 쓰일 수 있지만,", "살짝 걸리는 데가 있지만,", "조금 거슬릴 수 있지만,"];
const NO_SIGNAL = ["특별히 걸리는 신호가 없어서", "크게 기우는 신호가 없어서", "오늘은 이쪽으로 기우는 신호가 없어서"];
// 십성 근거 절 — 분야마다 틀을 돌려 써서 같은 절이 여섯 번 반복되지 않게 한다(괄호 풀이는 총평에서 한 번만).
const GOD_CAUSE = [
  (god) => `오늘 ${god}의 기운이 들어와서`,
  (god) => `일진이 나에게 ${josa(god, "이라서", "라서")}`,
  (god) => `${god}의 기운이 도는 날이라서`,
  (god) => `${josa(god, "이", "가")} 들어온 날이라서`,
  (god) => `${god}의 흐름을 타는 날이라서`,
  (god) => `오늘은 ${god} 기운이 함께해서`,
];
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
  else if (pos && neg) lead = MIXED_LEAD[CATEGORY_KEYS.indexOf(key) % MIXED_LEAD.length](pos.label, neg.label);
  // 근거가 하나뿐인데 무난이면(점수 ±1) "조금 ~지만"으로 받아야 결론과 어긋나지 않는다.
  else if (pos) lead = `${pos.cause} ${WEAK_POS[CATEGORY_KEYS.indexOf(key) % WEAK_POS.length]}`;
  else if (neg) lead = `${neg.cause} ${WEAK_NEG[CATEGORY_KEYS.indexOf(key) % WEAK_NEG.length]}`;
  else lead = NO_SIGNAL[seed % NO_SIGNAL.length];
  const body = CATEGORY_TEXT[key][level].replace("{body}", ELEMENT_BODY[dayElement]);
  return { level, comment: `${lead} ${body}`, reasons: reasons.map((r) => r.key) };
}

function godReason(key, god) {
  const w = CATEGORY_GOD_WEIGHT[key][god] ?? 0;
  if (!w) return [];
  const i = CATEGORY_KEYS.indexOf(key);
  return [{ key: `god:${god}`, w, label: `${god}의 기운`, cause: GOD_CAUSE[i % GOD_CAUSE.length](god) }];
}

function relationReason(prefix, place, relation, weight) {
  if (!relation) return [];
  const short = place.replace(/\(.*\)$/, "");   // 라벨에는 괄호 풀이를 넣지 않는다(괄호 겹침)
  return relation > 0
    ? [{ key: `${prefix}:합`, w: weight, label: `${short} 합`, cause: `오늘 지지가 ${place}와 합을 이뤄서` }]
    : [{ key: `${prefix}:충`, w: -weight, label: `${short} 충`, cause: `오늘 지지가 ${place}와 부딪혀서(충)` }];
}

function categoryFortunes(candidate, today, god, harmony, clash, gender, seed) {
  const todayBranch = today.branch.korean;
  const dayStem = candidate.pillars.day.stem.korean;
  const dayElement = stemElement(dayStem);
  const dayRelation = branchRelation(candidate.pillars.day?.branch.korean, todayBranch);
  const monthRelation = branchRelation(candidate.pillars.month?.branch.korean, todayBranch);
  const general = [
    ...(harmony.length ? [{ key: "natal:합", w: 1, label: "명식과의 합", cause: "오늘 지지가 명식과 합을 이뤄서" }] : []),
    ...(clash.length ? [{ key: "natal:충", w: -1, label: "명식과의 충", cause: "오늘 지지가 명식과 충(부딪침)이라서" }] : []),
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
    ? [{ key: "day:원진", w: -1, label: "일지 원진", cause: "오늘 지지가 일지와 원진(까닭 없이 서로 꺼림)이라서" }] : [];
  const literary = LITERARY_STAR[dayStem] === todayBranch
    ? [{ key: "문창", w: 2, label: "문창", cause: "오늘 지지가 문창(글과 시험의 별) 자리라서" }] : [];
  const hwagae = twelveShinsal(candidate.pillars.day.branch.korean, todayBranch) === "화개살"
    ? [{ key: "화개", w: 1, label: "화개", cause: "혼자 몰두하기 좋은 날이라서" }] : [];
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
  // 좋은 때는 일지와 육합하는 시진. 그 시진이 오늘 조심할 때와 같으면 삼합 짝으로 옮긴다
  // (같은 시간을 좋다·조심하라 두 번 말하지 않게).
  let goodIndex = BRANCH_NAMES.findIndex((b) => b !== dayBranch && BRANCH_HARMONY.has(pairKey(b, dayBranch)));
  let goodWhy = "합하는";
  if (goodIndex === clashIndex) {
    const triad = TRIADS.find((t) => t.includes(dayBranch)).filter((b) => b !== dayBranch && BRANCH_NAMES.indexOf(b) !== clashIndex);
    goodIndex = BRANCH_NAMES.indexOf(triad[0]);
    goodWhy = "삼합으로 어울리는";
  }
  const label = (i) => `${BRANCH_NAMES[i]}시(${BRANCH_RANGE[i]})`;
  return {
    caution: { branch: BRANCH_NAMES[clashIndex], range: BRANCH_RANGE[clashIndex],
      text: `${josa(label(clashIndex), "은", "는")} 오늘 일진의 ${josa(today.branch.korean, "과", "와")} 정면으로 부딪히는(충) 시간이라, 중요한 결정이나 말다툼은 이때를 피하는 게 좋아요.` },
    good: { branch: BRANCH_NAMES[goodIndex], range: BRANCH_RANGE[goodIndex],
      text: `${josa(label(goodIndex), "은", "는")} 내 일지 ${josa(dayBranch, "과", "와")} ${goodWhy} 시간이라, 연락·약속·부탁을 잡기에 좋아요.` },
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
  else if (clash.length) {
    picks.push("accent:clash");
    const joiner = DAILY_BODY[god].includes("다만") ? "그리고" : "다만";   // 같은 접속어 연달아 쓰지 않기
    parts.push(`${joiner} 오늘 지지가 내 명식과 충(부딪침)이라 일정이 바뀌거나 감정이 앞서기 쉬우니 여유를 두세요.`);
  }
  if (SHINSAL_ACCENT[todayShinsal]) { picks.push(`shinsal:${todayShinsal}`); parts.push(SHINSAL_ACCENT[todayShinsal]); }
  return {
    date: `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
    iljin: todayPillar.korean,
    iljinHanja: todayPillar.hanja,
    tenGod: god,
    emoji: STEM_EMOJI[god],
    text: parts.join(" "),
    marks: markSpans(parts.join(" ")),
    headline: dailyHeadline(god, harmony.length > 0, clash.length > 0),
    categories,
    lucky: luckyOf(candidate, todayPillar, dayElement),
    times: timesOf(candidate, todayPillar),
    signals: { harmony, clash, shinsal: todayShinsal },
    picks,
    method: "natal-daymaster+daily-pillar-v6",
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
      candidate.lifeCurve = buildLifeCurve(candidate, {
        luck: result.luckPillars ?? null, birth: { year, month, day }, today,
        strengthLevel: candidate.reading.strength.level,
      });
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
    // 종합 노트(fortune.bubblelab.dev) 사주 칸 재료 — 특성과 일간 후보만(saju-traits.js). 저장하지 않는다.
    chart.note = sajuNoteInput(chart);
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
// 알림을 누르면 여는 화면 — 구독한 자리로(구독 기록의 site). fortune.bubblelab.dev 에서 구독하면 탭 화면(/note/),
// util 에서 구독했거나 출처가 없는 옛 구독(2026-11-16 이전)은 util 그대로.
export const FORTUNE_PUSH_URLS = {
  util: "https://util.bubblelab.dev/fortune",
  fortune: "https://fortune.bubblelab.dev/note/",
};
// 구독 출처 — 운영에서는 요청 주소(호스트)로만 정한다. 로컬 개발(경로로 서브도메인을 고르는 localhost)에서만 화면이 준 힌트를 쓴다.
export function pushSiteOf(request, hint) {
  const host = new URL(request.url).hostname;
  if (host === "fortune.bubblelab.dev") return "fortune";
  if (host === "bubblelab.dev" || host.endsWith(".bubblelab.dev")) return "util";
  return hint === "fortune" ? "fortune" : "util";
}
export const pushUrlOf = (sub) => FORTUNE_PUSH_URLS[sub?.site === "fortune" ? "fortune" : "util"];
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
  let body = await request.text();
  if (request.method === "POST") {   // 구독에 출처(site)를 붙여 넘긴다 — 발송 때 구독마다 여는 주소를 고른다
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* DO 가 400 으로 */ }
    if (parsed && typeof parsed === "object") body = JSON.stringify({ ...parsed, site: pushSiteOf(request, parsed.site) });
  }
  return fortuneStub(env).fetch("https://fortune.internal/push", {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// cron(23:00 UTC = 08:00 KST)에서 호출 — 구독한 모든 기기에 알림 발송
export function sendFortuneDaily(env) {
  return fortuneStub(env).fetch("https://fortune.internal/notify", { method: "POST" });
}

// ── 만화 사주 신청 ── 옛 메일 접수(/_fortune/comic-request)는 닫았다. 신청은 아래 신청서(ig-form) 하나로 받는다.
const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/i;

async function postComicNotice(env, payload) {
  const delivery = createDelivery(env ?? {});
  if (!delivery) return false;
  try {
    return await postToDiscord(delivery, payload, { sleep: async () => {} });
  } catch (error) {
    console.error("comic request discord notice failed", error);
    return false;
  }
}

// 생년월일 검사 — 신청서가 쓴다. h 는 12지시 번호(0=자시) 또는 null(모름).
function validateBirth(b = {}, today = kstToday()) {
  b = b && typeof b === "object" ? b : {};
  const y = Number(b.y), m = Number(b.m), d = Number(b.d);
  const h = b.h == null || b.h === "" ? null : Number(b.h);
  const calendar = b.calendar === "lunar" ? "lunar" : "solar";
  if (!Number.isInteger(y) || y < 1900 || y > today.year || !Number.isInteger(m) || m < 1 || m > 12
    || !Number.isInteger(d) || d < 1 || (calendar === "lunar" ? d > 30 : !validSolarDate(y, m, d))
    || (h !== null && (!Number.isInteger(h) || h < 0 || h > 11))) return null;
  return { y, m, d, h, calendar, lunarLeap: b.lunarLeap === true };
}

// ── 신청서 (util/fortune/insta) ── 인스타 아이디나 메일 주소 중 하나만 받는다. 저장 모양은 fortune-igform.js.
export { IG_FORM_ROUND_CAP };
const IG_HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const IG_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const IG_FORM_LINK_PREFIX = "https://util.bubblelab.dev/fortune/get/#";
const IG_FORM_LINK_RE = /^https:\/\/util\.bubblelab\.dev\/fortune\/get\/#[A-Za-z0-9_-]{8,200}$/;
const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>@]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * 신청서 본문 검사 — { contact:"instagram"|"email", handle? | email?, name, birth{y,m,d,h,calendar,lunarLeap}, time, calendar, gender, consent }.
 * contact 가 없으면 instagram(옛 화면). 둘 다 적으면 contact.
 */
export function validateIgForm(body, today = kstToday()) {
  if (!body || typeof body !== "object") return { error: "invalid" };
  if (body.website) return { error: "bot" };
  if (body.consent !== true) return { error: "consent" };
  const contact = body.contact == null || body.contact === "instagram" ? "instagram" : body.contact === "email" ? "email" : null;
  if (!contact) return { error: "contact" };
  const handle = typeof body.handle === "string" ? body.handle.trim().replace(/^@+/, "").toLowerCase() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (contact === "instagram") {
    if (email) return { error: "contact" };
    if (!IG_HANDLE_RE.test(handle)) return { error: "handle" };
  } else {
    if (handle) return { error: "contact" };
    if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email)) return { error: "email" };
  }
  const typed = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if ([...typed].length > 12 || /[\u0000-\u001f<>@]/.test(typed)) return { error: "name" };
  const name = typed || (contact === "instagram" ? handle.slice(0, 12) : "");
  const time = body.time == null || body.time === "" ? null : String(body.time);
  if (time !== null && !IG_TIME_RE.test(time)) return { error: "birth" };
  const calendar = (body.calendar ?? body.birth?.calendar) === "lunar" ? "lunar" : "solar";
  // 시각(HH:MM)을 적었으면 12지시 번호는 버린다 — 집 PC 의 insta 명령도 둘 중 하나만 받는다.
  const birth = validateBirth({ ...(body.birth ?? {}), calendar, ...(time ? { h: null } : {}) }, today);
  if (!birth) return { error: "birth" };
  const gender = ["male", "female"].includes(body.gender) ? body.gender : "unspecified";
  return { value: { contact, handle: contact === "instagram" ? handle : "", ...(contact === "email" ? { email } : {}), name, birth, time, calendar, gender } };
}

/**
 * 워커 라우트(속도 제한은 worker.js 가 먼저 건다):
 *   GET  /_fortune/comic-request/status        → { open: false, remaining: 0 } (닫음)
 *   POST /_fortune/comic-request               → 410 { error: "closed", form } (닫음 — 신청서로)
 *   GET  /_fortune/comic-requests              (Bearer COMIC_SINK_SECRET) → { count, remaining, requests }
 *   POST /_fortune/comic-requests/<id>/done    (Bearer) → { ok } — 그 신청의 메일·생년월일 삭제
 *   POST /_fortune/comic-requests/<id>/ready   (Bearer) {status:"packaged"|"failed", reason} → 디스코드 알림
 */
// ── 만화 사주 후기 ── util/fortune/review/ 에서 받는다. 연락처는 받지 않는다(별점·글·별명·소개 동의만).
// 소개 동의(publish)는 나중에 화면에 이름 없이 싣는 것에 대한 것 — 지금은 싣지 않고 모으기만 한다.
export const REVIEW_CAP = 500;
export const REVIEW_DEDUPE_MS = 10 * 60 * 1000;
export function validateReview(body) {
  if (!body || typeof body !== "object") return { error: "invalid" };
  if (body.website) return { error: "bot" };
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "rating" };
  const text = typeof body.text === "string" ? body.text.replace(/\r\n?/g, "\n").trim() : "";
  if (text.length < 5 || text.length > 500) return { error: "text" };
  const nick = typeof body.nick === "string" ? body.nick.replace(/\s+/g, " ").trim().slice(0, 12) : "";
  return { value: { rating, text, nick, publish: body.publish === true } };
}

/**
 *   POST /_fortune/review     {rating, text, nick?, publish?}  → { ok } | { error }
 *   GET  /_fortune/reviews    (Bearer COMIC_SINK_SECRET) → { count, reviews }
 */
export async function handleFortuneReview(request, env, url) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const relay = async (target, init) => {
    const res = await fortuneStub(env).fetch(`https://fortune.internal${target}`, init);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  };
  if (url.pathname === "/_fortune/review") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    if (+(request.headers.get("Content-Length") ?? 0) > 4096) return json({ error: "too-large" }, 413);
    const checked = validateReview(await request.json().catch(() => null));
    if (checked.error === "bot") return json({ ok: true });
    if (checked.error) return json({ error: checked.error }, 400);
    return relay("/review/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checked.value) });
  }
  if (url.pathname !== "/_fortune/reviews") return json({ error: "not found" }, 404);
  if (request.method !== "GET") return json({ error: "method" }, 405);
  if (!env.COMIC_SINK_SECRET) return json({ error: "not configured" }, 503);
  const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secretMatches(offered, env.COMIC_SINK_SECRET)) return json({ error: "unauthorized" }, 401);
  return relay("/review/list");
}

/**
 * admin 화면(✍️ 후기)용 — worker.js 의 handleAdmin 이 admin 세션을 확인한 뒤에만 부른다.
 * 브라우저에는 COMIC_SINK_SECRET 이 가지 않는다 — admin 로그인 세션이 곧 권한이다.
 *   GET    /api/fortune/reviews          → { count, reviews } (최신순)
 *   DELETE /api/fortune/reviews?id=<id>  → { ok, count } | 404
 */
export async function handleFortuneReviewAdmin(request, env, url) {
  if (url.pathname !== "/api/fortune/reviews") return null;
  let res;
  if (request.method === "GET") res = await fortuneStub(env).fetch("https://fortune.internal/review/list");
  else if (request.method === "DELETE") {
    res = await fortuneStub(env).fetch("https://fortune.internal/review/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: url.searchParams.get("id") ?? "" }),
    });
  } else return Response.json({ error: "method" }, { status: 405 });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function handleFortuneComic(request, env, url) {
  const path = url.pathname;
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const relay = async (target, init) => {
    const res = await fortuneStub(env).fetch(`https://fortune.internal${target}`, init);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  };
  if (path === "/_fortune/comic-request/status") {
    if (request.method !== "GET") return json({ error: "method" }, 405);
    return json({ open: false, remaining: 0 });
  }
  if (path === "/_fortune/comic-request") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    return json({ error: "closed", form: "https://util.bubblelab.dev/fortune/insta/" }, 410);
  }
  // 아래는 집 PC 몫 — 논문·오픽과 같은 시크릿.
  const done = /^\/_fortune\/comic-requests\/([0-9a-f]{16})\/done$/.exec(path);
  const ready = /^\/_fortune\/comic-requests\/([0-9a-f]{16})\/ready$/.exec(path);
  if (path !== "/_fortune/comic-requests" && !done && !ready) return json({ error: "not found" }, 404);
  if (!env.COMIC_SINK_SECRET) return json({ error: "not configured" }, 503);
  const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secretMatches(offered, env.COMIC_SINK_SECRET)) return json({ error: "unauthorized" }, 401);
  if (done) {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    return relay(`/comic/done/${done[1]}`, { method: "POST" });
  }
  if (ready) {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const body = await request.json().catch(() => ({}));
    const status = body?.status === "failed" ? "failed" : "packaged";
    const reason = String(body?.reason ?? "").replace(/[\u0000-\u001f@<>]/g, " ").slice(0, 120);
    return relay(`/comic/ready/${ready[1]}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, reason }) });
  }
  if (request.method !== "GET") return json({ error: "method" }, 405);
  return relay("/comic/list");
}

/**
 *   GET  /_fortune/ig-form/status                  → { open, remaining, cap }
 *   POST /_fortune/ig-form                         → { ok, remaining, receipt } | { error, message? } — receipt 는 접수증 토큰(서버엔 해시만)
 *   POST /_fortune/ig-form/receipt  { token }      → { state: queued(position)|making|delayed|ready(link,expires)|expired|unknown }
 *   POST /_fortune/ig-form/receipt/push { token, subscription } → { ok } | 400 token·subscription | 404 unknown | 409 ready | 503
 *                                                  완성되면 한 번 알림(토큰 없는 접수증 주소 — 서버엔 해시 연결만)
 *   GET  /_fortune/ig-form/reminder.ics            → 내일 10:00 KST 「만화 사주 확인하기」 일정(토큰 없음)
 *   GET  /_fortune/ig-form-requests                (Bearer COMIC_SINK_SECRET) → { requests } 먼저 온 순, 아직 만들 것만
 *   POST /_fortune/ig-form-requests/<id>/ready     (Bearer) { status:"ready", link, expires } | { status:"failed", reason }
 *   POST /_fortune/ig-form-requests/<id>/done      (Bearer) → 삭제
 */
export async function handleFortuneIgForm(request, env, url) {
  const path = url.pathname;
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const relay = async (target, init) => {
    const res = await fortuneStub(env).fetch(`https://fortune.internal${target}`, init);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  };
  const post = (target, body) => relay(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (path === "/_fortune/ig-form/status") {
    if (request.method !== "GET") return json({ error: "method" }, 405);
    return relay("/igform/status");
  }
  if (path === "/_fortune/ig-form") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    if (+(request.headers.get("Content-Length") ?? 0) > 2048) return json({ error: "too-large" }, 413);
    const checked = validateIgForm(await request.json().catch(() => null));
    if (checked.error === "bot") return json({ ok: true, remaining: null });
    if (checked.error) return json({ error: checked.error }, 400);
    const token = newReceiptToken();
    const res = await fortuneStub(env).fetch("https://fortune.internal/igform/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...checked.value, receipt: await receiptHash(token) }),
    });
    const out = await res.json().catch(() => ({}));
    return json(res.ok ? { ...out, receipt: token } : out, res.status);
  }
  // 내일 확인 일정(.ics) — 토큰을 받지도 싣지도 않는다. 아이폰 사파리는 text/calendar 를 열면 일정 추가 화면을 띄운다.
  if (path === "/_fortune/ig-form/reminder.ics") {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method" }, 405);
    return new Response(request.method === "HEAD" ? null : reminderIcs(), { headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="comic-saju-check.ics"',
      "Cache-Control": "no-store",
    } });
  }
  // 접수증 알림 받기 — 토큰·구독 모두 본문으로만.
  if (path === "/_fortune/ig-form/receipt/push") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    if (+(request.headers.get("Content-Length") ?? 0) > 4096) return json({ error: "too-large" }, 413);
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return json({ error: "push is not configured" }, 503);
    const got = await request.json().catch(() => null);
    const token = got?.token;
    if (typeof token !== "string" || !RECEIPT_TOKEN_RE.test(token)) return json({ error: "token" }, 400);
    if (!validPushSubscription(got.subscription)) return json({ error: "subscription" }, 400);
    const { endpoint, keys } = got.subscription;
    return post("/igform/receipt-push", { hash: await receiptHash(token), subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } });
  }
  // 접수증 — 토큰은 주소가 아니라 본문으로만 받는다(로그에 남지 않게).
  if (path === "/_fortune/ig-form/receipt") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    if (+(request.headers.get("Content-Length") ?? 0) > 512) return json({ error: "too-large" }, 413);
    const token = (await request.json().catch(() => null))?.token;
    if (typeof token !== "string" || !RECEIPT_TOKEN_RE.test(token)) return json({ error: "token" }, 400);
    return post("/igform/receipt", { hash: await receiptHash(token) });
  }
  const done = /^\/_fortune\/ig-form-requests\/([0-9a-f]{16})\/done$/.exec(path);
  const ready = /^\/_fortune\/ig-form-requests\/([0-9a-f]{16})\/ready$/.exec(path);
  if (path !== "/_fortune/ig-form-requests" && !done && !ready) return json({ error: "not found" }, 404);
  if (!env.COMIC_SINK_SECRET) return json({ error: "not configured" }, 503);
  const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secretMatches(offered, env.COMIC_SINK_SECRET)) return json({ error: "unauthorized" }, 401);
  if (!done && !ready) {
    if (request.method !== "GET") return json({ error: "method" }, 405);
    return relay("/igform/list");
  }
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (done) return relay(`/igform/done/${done[1]}`, { method: "POST" });
  const body = await request.json().catch(() => ({}));
  if (body?.status === "failed") return post(`/igform/ready/${ready[1]}`, { status: "failed", reason: cleanText(body.reason, 120) });
  if (body?.status !== "ready") return json({ error: "status" }, 400);
  const link = typeof body.link === "string" ? body.link.trim() : "";
  if (!link.startsWith(IG_FORM_LINK_PREFIX) || !IG_FORM_LINK_RE.test(link)) return json({ error: "link" }, 400);
  return post(`/igform/ready/${ready[1]}`, { status: "ready", link, expires: cleanText(body.expires, 40) });
}

/**
 * admin 「📸 인스타 신청」 — worker.js 의 handleAdmin 이 admin 세션을 확인한 뒤에만 부른다.
 *   GET  /api/fortune/ig-form-round  → { round, pending: [{ id, round, seq, created, contact, to, name, state, failed?, link?, expires?, message? }] }
 *   POST /api/fortune/ig-form-round  { action: "new" | "open" | "close", cap? } → { round } — cap 은 새 회차 정원(1~10, 아니면 10)
 *                                    { action: "sent" | "retry" | "drop", id } → { ok } — sent 는 개인정보를 지우고 접수증엔 링크만
 */
export async function handleFortuneIgFormAdmin(request, env, url) {
  if (url.pathname !== "/api/fortune/ig-form-round") return null;
  let res;
  if (request.method === "GET") res = await fortuneStub(env).fetch("https://fortune.internal/igform/round");
  else if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    const perItem = ["sent", "retry", "drop"].includes(action);
    if (!perItem && !["new", "open", "close"].includes(action)) return Response.json({ error: "action" }, { status: 400 });
    if (perItem && !/^[0-9a-f]{16}$/.test(body.id ?? "")) return Response.json({ error: "id" }, { status: 400 });
    res = await fortuneStub(env).fetch("https://fortune.internal/igform/round", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(perItem ? { action, id: body.id } : action === "new" ? { action, cap: roundCap(body.cap) } : { action }),
    });
  } else return Response.json({ error: "method" }, { status: 405 });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// ── 그림(타로 등) ── 그림은 저장소가 아니라 R2 FORTUNE_BUCKET 의 art/ 에 있다(_src/fortune-tarot/upload-art.sh).
// 이름에 내용 해시가 붙어 바뀌지 않으므로 1년 immutable. 읽기만 — 목록·쓰기 경로는 없다.
// 이름 규칙 밖은 R2 에 묻지도 않는다: 타로 카드(art/tarot/maj_NN-<해시>.webp, 마이너 art/tarot/<무늬>_NN-<해시>.webp,
// 클래식 덱은 같은 이름 규칙으로 art/tarot-classic/),
// 다그당스 표정(art/dangi/dg-<표정>-<해시>.webp).
const ART_PATH_RE = /^\/_fortune\/art\/(tarot(?:-classic)?\/(?:maj|wands|cups|swords|pentacles)_\d{2}-[0-9a-f]{10}\.webp|dangi\/dg-[a-z]+-[0-9a-f]{10}\.webp)$/;
export async function handleFortuneArt(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const m = ART_PATH_RE.exec(url.pathname);
  if (!m || !env.FORTUNE_BUCKET) return new Response("not found", { status: 404 });
  const obj = await env.FORTUNE_BUCKET.get(`art/${m[1]}`);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" };
  if (obj.httpEtag) headers.ETag = obj.httpEtag;
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}

// ── 손금 베타(M2) ── 사진 1장 + 왼손/오른손을 받아 집 PC(_src/util-palm-sink)가 읽고 결과 JSON(palm.m2.v1)을 올린다.
// 사진은 R2 palm/<id> 에 잠깐만 둔다: 결과가 오면 바로 지우고, R2 수명 규칙(palm/ 1일)이 한 번 더 지운다.
// 결과에는 사진이 없다(선 좌표·풀이·특성) — 화면은 폰에 남은 원본 위에 선을 그린다.
// ENABLE_PALM 이 "true" 가 아니면 모든 경로가 503 이다(fail-closed, 기본 꺼짐).
export const PALM = {
  maxBytes: 5 * 1024 * 1024,      // 사진 한 장(화면이 긴 변 1800 JPEG 로 줄여 보내니 보통 1MB 안쪽)
  resultMaxBytes: 256 * 1024,     // 결과 JSON(보통 15KB 안팎)
  leaseMs: 120_000,               // 집 PC 는 90초 안에 끝내거나 TIMEOUT 을 올린다
  maxAttempts: 2,                 // 임대 만료·TIMEOUT 은 한 번 더 — 그다음은 failed
  beatMs: 60_000,                 // 이만큼 집 PC 소식이 없으면 화면이 "쉬어요"
  queueCap: 10,
  queueTtlMs: 15 * 60_000,        // 이만큼 아무도 안 가져가면 failed(사진도 지움)
  resultTtlMs: 60 * 60_000,       // 결과는 한 시간만 둔다
};
const PALM_SCHEMA = "palm.m2.v1";
export function palmBodyLimit(path) {
  if (path === "/_fortune/palm/jobs") return PALM.maxBytes;
  return /^\/_fortune\/palm\/jobs\/[0-9a-f]{16}\/result$/.test(path) ? PALM.resultMaxBytes : null;
}
export function palmImageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}
const palmFailed = (job, code, now) => ({
  ...job, state: "failed", finished: now, leaseUntil: null,
  result: { schema: PALM_SCHEMA, job_id: job.id, ok: false, status: "error", error: { code, retryable: true } },
});

/**
 *   GET    /_fortune/palm/status                 → { online, queue }
 *   POST   /_fortune/palm/jobs[?hand=auto|left|right]   (본문 = image/jpeg|png) → { id, position } | 503 offline·busy
 *          hand 가 없으면 auto — 판독(m2_run)이 사진에서 왼손·오른손을 알아본다
 *   GET    /_fortune/palm/jobs/<id>              → { state, position?, online, result? }   id 를 아는 사람만
 *   POST   /_fortune/palm/claim                  (Bearer COMIC_SINK_SECRET) → { job: { id, hand, attempt } | null }
 *   POST   /_fortune/palm/heartbeat              (Bearer) → { ok }
 *   GET    /_fortune/palm/jobs/<id>/photo        (Bearer, 가져간 일만) → 사진
 *   DELETE /_fortune/palm/jobs/<id>/photo        (Bearer) → { ok }
 *   POST   /_fortune/palm/jobs/<id>/result       (Bearer) palm.m2.v1 → { ok, state }
 */
export async function handleFortunePalm(request, env, url) {
  const path = url.pathname;
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (env.ENABLE_PALM !== "true") return json({ error: "disabled" }, 503);
  if (!env.FORTUNE_BUCKET) return json({ error: "not configured" }, 503);
  const relay = async (target, init) => {
    const res = await fortuneStub(env).fetch(`https://fortune.internal${target}`, init);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  };
  const post = (target, body) => relay(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

  if (path === "/_fortune/palm/status") {
    if (request.method !== "GET") return json({ error: "method" }, 405);
    return relay("/palm/status");
  }
  if (path === "/_fortune/palm/jobs") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const hand = url.searchParams.get("hand") || "auto";
    if (!["auto", "left", "right"].includes(hand)) return json({ error: "hand" }, 400);
    const type = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
    if (type !== "image/jpeg" && type !== "image/png") return json({ error: "type" }, 415);
    if (+(request.headers.get("Content-Length") ?? 0) > PALM.maxBytes) return json({ error: "too-large" }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > PALM.maxBytes) return json({ error: "too-large" }, 413);
    const kind = palmImageType(bytes);
    if (!kind) return json({ error: "image" }, 400);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    await env.FORTUNE_BUCKET.put(`palm/${id}`, bytes, { httpMetadata: { contentType: kind } });
    const res = await fortuneStub(env).fetch("https://fortune.internal/palm/create", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, hand, type: kind }),
    });
    if (!res.ok) await env.FORTUNE_BUCKET.delete(`palm/${id}`);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const job = /^\/_fortune\/palm\/jobs\/([0-9a-f]{16})(?:\/(photo|result))?$/.exec(path);
  if (job && !job[2]) {
    if (request.method !== "GET") return json({ error: "method" }, 405);
    return relay(`/palm/job/${job[1]}`);
  }
  // 여기부터 집 PC 몫
  const daemonPath = job || path === "/_fortune/palm/claim" || path === "/_fortune/palm/heartbeat";
  if (!daemonPath) return json({ error: "not found" }, 404);
  if (!env.COMIC_SINK_SECRET) return json({ error: "not configured" }, 503);
  const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secretMatches(offered, env.COMIC_SINK_SECRET)) return json({ error: "unauthorized" }, 401);
  if (!job) {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    return relay(path === "/_fortune/palm/claim" ? "/palm/claim" : "/palm/heartbeat", { method: "POST" });
  }
  const [, id, part] = job;
  if (part === "photo") {
    if (request.method === "DELETE") { await env.FORTUNE_BUCKET.delete(`palm/${id}`); return json({ ok: true }); }
    if (request.method !== "GET") return json({ error: "method" }, 405);
    const ok = await fortuneStub(env).fetch(`https://fortune.internal/palm/claimed/${id}`);
    if (!ok.ok) return json({ error: "not claimed" }, 409);
    const obj = await env.FORTUNE_BUCKET.get(`palm/${id}`);
    if (!obj) return json({ error: "gone" }, 410);
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const text = await request.text();
  if (text.length > PALM.resultMaxBytes) return json({ error: "too-large" }, 413);
  let result;
  try { result = JSON.parse(text); } catch { return json({ error: "json" }, 400); }
  if (result?.schema !== PALM_SCHEMA || typeof result.ok !== "boolean" || result.job_id !== id) return json({ error: "schema" }, 400);
  delete result.render_jpg_b64;   // 그림이 실려 와도 서버에는 남기지 않는다
  return post(`/palm/result/${id}`, result);
}

// FortuneDO 안 — 차례(queued → running → done | failed), 임대, 집 PC 소식.
async function palmInDO(storage, env, request, url) {
  const path = url.pathname;
  const now = Date.now();
  const bucket = env.FORTUNE_BUCKET;
  const live = [];
  for (const [key, item] of await storage.list({ prefix: "palm:job:" })) {
    let next = item;
    if (item.state === "queued" && now - item.created > PALM.queueTtlMs) next = palmFailed(item, "TIMEOUT", now);
    else if (item.state === "running" && item.leaseUntil <= now) {
      next = item.attempts >= PALM.maxAttempts ? palmFailed(item, "TIMEOUT", now) : { ...item, state: "queued", leaseUntil: null };
    } else if ((item.state === "done" || item.state === "failed") && now - item.finished > PALM.resultTtlMs) {
      await storage.delete(key);
      continue;
    }
    if (next !== item) {
      if (next.state === "failed") await bucket?.delete(`palm/${item.id}`);
      await storage.put(key, next);
    }
    live.push(next);
  }
  const waiting = live.filter((j) => j.state === "queued" || j.state === "running").sort((a, b) => a.seq - b.seq);
  const running = waiting.find((j) => j.state === "running");
  const beat = (await storage.get("palm:beat")) ?? 0;
  const online = now - beat < PALM.beatMs || !!running;
  const positionOf = (j) => waiting.indexOf(j);

  if (path === "/palm/status" && request.method === "GET") return Response.json({ online, queue: waiting.length });
  if (path === "/palm/create" && request.method === "POST") {
    const { id, hand, type } = await request.json().catch(() => ({}));
    if (!/^[0-9a-f]{16}$/.test(id ?? "") || !["auto", "left", "right"].includes(hand)) return Response.json({ error: "invalid" }, { status: 400 });
    if (!online) return Response.json({ error: "offline" }, { status: 503 });
    if (waiting.length >= PALM.queueCap) return Response.json({ error: "busy" }, { status: 503 });
    const seq = ((await storage.get("palm:seq")) ?? 0) + 1;
    await storage.put("palm:seq", seq);
    await storage.put(`palm:job:${id}`, { id, hand, type, state: "queued", created: now, seq, attempts: 0, leaseUntil: null });
    return Response.json({ id, position: waiting.length });
  }
  if (path === "/palm/heartbeat" && request.method === "POST") {
    await storage.put("palm:beat", now);
    return Response.json({ ok: true });
  }
  if (path === "/palm/claim" && request.method === "POST") {
    await storage.put("palm:beat", now);
    if (running) return Response.json({ job: null, busy: true });   // 한 번에 한 건
    const next = waiting[0];
    if (!next) return Response.json({ job: null });
    const claimed = { ...next, state: "running", attempts: next.attempts + 1, leaseUntil: now + PALM.leaseMs, started: now };
    await storage.put(`palm:job:${next.id}`, claimed);
    return Response.json({ job: { id: next.id, hand: next.hand, attempt: claimed.attempts } });
  }
  const m = /^\/palm\/(job|claimed|result)\/([0-9a-f]{16})$/.exec(path);
  if (!m) return new Response("not found", { status: 404 });
  const key = `palm:job:${m[2]}`;
  const item = live.find((j) => j.id === m[2]);
  if (!item) return Response.json({ error: "gone" }, { status: 404 });
  if (m[1] === "job" && request.method === "GET") {
    const out = { state: item.state, online };
    if (item.state === "queued" || item.state === "running") out.position = positionOf(item);
    if (item.result) out.result = item.result;
    return Response.json(out);
  }
  if (m[1] === "claimed" && request.method === "GET") {
    return item.state === "running" ? Response.json({ ok: true }) : Response.json({ error: "state" }, { status: 409 });
  }
  if (m[1] === "result" && request.method === "POST") {
    if (item.state === "done" || item.state === "failed") return Response.json({ error: "finished" }, { status: 409 });
    const result = await request.json().catch(() => null);
    if (!result) return Response.json({ error: "json" }, { status: 400 });
    await storage.put("palm:beat", now);
    if (!result.ok && result.error?.code === "TIMEOUT" && item.attempts < PALM.maxAttempts) {
      await storage.put(key, { ...item, state: "queued", leaseUntil: null });
      return Response.json({ ok: true, state: "queued" });
    }
    const state = result.ok ? "done" : "failed";
    await storage.put(key, { ...item, state, finished: now, leaseUntil: null, result });
    await bucket?.delete(`palm/${item.id}`);
    return Response.json({ ok: true, state });
  }
  return new Response("not found", { status: 404 });
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
    if (url.pathname.startsWith("/comic/")) return this.comic(request, url);
    if (url.pathname.startsWith("/igform/")) {
      return igformInDO(this.storage, this.env, request, url, (payload) => postComicNotice(this.env, payload), this.sendWebPush ?? sendWebPush);
    }
    if (url.pathname.startsWith("/review/")) return this.review(request, url);
    if (url.pathname.startsWith("/palm/")) return palmInDO(this.storage, this.env, request, url);
    if (url.pathname.startsWith("/share/")) return shareInDO(this.storage, this.env, request, url);
    if (url.pathname.startsWith("/ig/")) return igInDO(this.storage, this.env, request, url, (payload) => postComicNotice(this.env, payload));
    return new Response("not found", { status: 404 });
  }

  async subscribe(request) {
    const body = await request.json().catch(() => ({}));
    const sub = body.subscription ?? body;
    if (!validPushSubscription(sub)) {
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
      site: body.site === "fortune" ? "fortune" : "util",   // 출처(handleFortunePush 가 요청 주소로 정함)
    });
    return Response.json({ subscribed: true });
  }

  async unsubscribe(request) {
    const body = await request.json().catch(() => ({}));
    const endpoint = String(body.endpoint ?? "");
    if (endpoint) await this.storage.delete(await endpointKey(endpoint));
    return Response.json({ subscribed: false });
  }

  // ── 옛 메일 신청(닫음) ── 집 PC 의 목록·완료 경로만 남는다. 개인정보는 comic:req:<id> 한 곳, done 으로 지운다.
  async comic(request, url) {
    const path = url.pathname;
    const count = (await this.storage.get("comic:count")) ?? 0;
    if (path === "/comic/list" && request.method === "GET") {
      const items = [...(await this.storage.list({ prefix: "comic:req:" })).values()]
        .sort((a, b) => (a.created < b.created ? -1 : 1));
      return Response.json({ count, remaining: 0, requests: items });
    }
    const done = /^\/comic\/done\/([0-9a-f]{16})$/.exec(path);
    if (done && request.method === "POST") {
      const key = `comic:req:${done[1]}`;
      const item = await this.storage.get(key);
      if (!item) return Response.json({ error: "not found" }, { status: 404 });
      await this.storage.delete(key);
      for (const [k, v] of await this.storage.list({ prefix: "comic:email:" })) if (v === done[1]) await this.storage.delete(k);
      return Response.json({ ok: true, count });
    }
    const ready = /^\/comic\/ready\/([0-9a-f]{16})$/.exec(path);
    if (ready && request.method === "POST") {
      if (!(await this.storage.get(`comic:req:${ready[1]}`))) return Response.json({ error: "not found" }, { status: 404 });
      const { status, reason } = await request.json().catch(() => ({}));
      const sent = await postComicNotice(this.env, comicReadyNotice(status, reason));
      return Response.json({ ok: true, notified: sent });
    }
    return new Response("not found", { status: 404 });
  }

  async review(request, url) {
    if (url.pathname === "/review/add" && request.method === "POST") {
      const value = await request.json().catch(() => null);
      if (!value?.text) return Response.json({ error: "invalid" }, { status: 400 });
      // 같은 별점·글·별명이 10분 안에 또 오면(두 번 누름·응답 유실 뒤 다시 보내기) 저장도 알림도 없이 ok.
      // 2026-11-15 실제로 20초 간격 같은 후기가 두 건 쌓였다.
      const now = Date.now();
      const items = (await this.storage.list({ prefix: "review:item:" })).values();
      for (const r of items) {
        if (now - Date.parse(r.created) < REVIEW_DEDUPE_MS
          && r.rating === value.rating && r.text === value.text && (r.nick ?? "") === (value.nick ?? "")) {
          return Response.json({ ok: true });
        }
      }
      const count = (await this.storage.get("review:count")) ?? 0;
      if (count >= REVIEW_CAP) return Response.json({ error: "full" }, { status: 409 });
      const created = new Date(now).toISOString();
      const id = `${created}-${crypto.randomUUID().slice(0, 8)}`;
      await this.storage.put(`review:item:${id}`, { id, ...value, created });
      await this.storage.put("review:count", count + 1);
      await postComicNotice(this.env, reviewNotice(value.rating, value.text, value.nick));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/review/list" && request.method === "GET") {
      // 키가 작성 시각(ISO)으로 시작하니 키 역순이 곧 최신순이다.
      const reviews = [...(await this.storage.list({ prefix: "review:item:" })).values()]
        .sort((a, b) => (a.id < b.id ? 1 : -1));
      return Response.json({ count: reviews.length, reviews });
    }
    if (url.pathname === "/review/delete" && request.method === "POST") {
      const { id } = (await request.json().catch(() => null)) ?? {};
      if (typeof id !== "string" || !id) return Response.json({ error: "invalid" }, { status: 400 });
      const key = `review:item:${id}`;
      if ((await this.storage.get(key)) === undefined) return Response.json({ error: "not found" }, { status: 404 });
      await this.storage.delete(key);
      const count = Math.max(0, ((await this.storage.get("review:count")) ?? 1) - 1);
      await this.storage.put("review:count", count);
      return Response.json({ ok: true, count });
    }
    return new Response("not found", { status: 404 });
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
    const payloadFor = (sub) => JSON.stringify({ title: "🔮 오늘의 운세", body, url: pushUrlOf(sub) });
    const send = this.sendWebPush ?? sendWebPush;   // 테스트가 바꿔 끼워 구독마다 보낸 본문을 본다(암호화 전)
    let sent = 0;
    for (const [key, sub] of await this.storage.list({ prefix: "push:" })) {
      try {
        const result = await send(sub, payloadFor(sub), vapid);
        if (result.gone) await this.storage.delete(key); // 만료 구독 정리
        else if (result.ok) sent += 1;
      } catch (error) {
        console.error("fortune push send failed", error);
      }
    }
    return Response.json({ sent });
  }
}
