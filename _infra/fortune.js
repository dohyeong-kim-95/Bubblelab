import manseryeok from "manseryeok";
import { sendWebPush } from "./webpush.js";

const {
  calculateFourPillars,
  getEarthlyBranchElement,
  getEarthlyBranchYinYang,
  getHeavenlyStemElement,
  getHeavenlyStemYinYang,
} = manseryeok;

const BRANCH_NAMES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const ELEMENTS = ["목", "화", "토", "금", "수"];
const STEM_EMOJI = { 비견: "🤝", 겁재: "⚡", 식신: "🌱", 상관: "💬", 편재: "🎯",
  정재: "🧾", 편관: "🧭", 정관: "📌", 편인: "💡", 정인: "📚" };
const DAILY_TEXT = {
  비견: "내 기준이 또렷해지는 날입니다. 함께하되 역할과 경계를 분명히 해보세요.",
  겁재: "경쟁심과 추진력이 커지는 날입니다. 즉흥 지출과 성급한 승부만 조심하세요.",
  식신: "꾸준히 만들고 표현하기 좋은 날입니다. 작은 결과물을 하나 완성해보세요.",
  상관: "아이디어와 말의 힘이 살아나는 날입니다. 솔직함이 날카로움이 되지 않게 다듬어보세요.",
  편재: "사람과 기회가 넓게 들어오는 날입니다. 가능성을 보되 약속과 지출은 현실적으로 확인하세요.",
  정재: "실무와 재정 감각이 안정되는 날입니다. 미뤄둔 정리나 확실한 한 걸음에 좋습니다.",
  편관: "요구와 긴장감이 추진력으로 바뀌는 날입니다. 무리한 돌파보다 우선순위를 세워보세요.",
  정관: "책임과 질서를 세우기 좋은 날입니다. 원칙대로 처리하면 신뢰를 얻기 쉽습니다.",
  편인: "익숙한 답보다 새로운 관점이 보이는 날입니다. 바로 결론 내리기보다 한 번 더 살펴보세요.",
  정인: "배우고 도움받는 흐름이 좋은 날입니다. 기록하고 조언을 구하면 실마리가 생깁니다.",
};
const BRANCH_HARMONY = new Set(["자축", "인해", "묘술", "진유", "사신", "오미"]);
const BRANCH_CLASH = new Set(["자오", "축미", "인신", "묘유", "진술", "사해"]);
const CATEGORY_GOD_WEIGHT = {
  wealth: { 정재: 2, 편재: 2, 식신: 1, 상관: 1, 비견: -1, 겁재: -2, 편관: -1 },
  career: { 정관: 2, 편관: 1, 정인: 2, 편인: 1, 식신: 1, 정재: 1, 편재: 1, 겁재: -1 },
  love: { 식신: 1, 정재: 1, 편재: 1, 정관: 1, 정인: 1, 상관: -1, 겁재: -1 },
};
const CATEGORY_TEXT = {
  wealth: {
    원활: "수입과 지출의 흐름을 잡기 좋은 날이에요. 현실적인 기회를 차분히 살펴보세요.",
    무난: "큰 변동보다는 관리가 중요한 날이에요. 계획한 범위 안에서 움직여보세요.",
    주의: "충동적인 지출이나 성급한 결정은 피하고, 조건을 한 번 더 확인하세요.",
  },
  career: {
    원활: "집중력과 실행력이 잘 이어지는 날이에요. 중요한 일을 한 단계 진전시켜보세요.",
    무난: "평소의 리듬을 지키면 안정적인 날이에요. 우선순위대로 처리해보세요.",
    주의: "업무 압박이나 의견 충돌이 생기기 쉬워요. 서두르지 말고 기준을 확인하세요.",
  },
  love: {
    원활: "대화와 교류가 자연스럽게 이어지는 날이에요. 먼저 마음을 표현해보세요.",
    무난: "큰 기복 없이 편안한 흐름이에요. 평소처럼 솔직하게 대화해보세요.",
    주의: "감정이 엇갈리기 쉬운 날이에요. 단정하기보다 상대의 말을 한 번 더 들어보세요.",
  },
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

function tenGod(dayStem, targetStem) {
  const dayElement = getHeavenlyStemElement(dayStem);
  const targetElement = getHeavenlyStemElement(targetStem);
  const samePolarity = getHeavenlyStemYinYang(dayStem) === getHeavenlyStemYinYang(targetStem);
  const dayIndex = ELEMENTS.indexOf(dayElement);
  const targetIndex = ELEMENTS.indexOf(targetElement);
  if (dayIndex === targetIndex) return samePolarity ? "비견" : "겁재";
  if ((dayIndex + 1) % 5 === targetIndex) return samePolarity ? "식신" : "상관";
  if ((dayIndex + 2) % 5 === targetIndex) return samePolarity ? "편재" : "정재";
  if ((targetIndex + 2) % 5 === dayIndex) return samePolarity ? "편관" : "정관";
  return samePolarity ? "편인" : "정인";
}

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

function categoryResult(key, score) {
  const level = score >= 2 ? "원활" : score <= -2 ? "주의" : "무난";
  return { level, comment: CATEGORY_TEXT[key][level] };
}

function categoryFortunes(candidate, todayBranch, god, harmony, clash, gender) {
  const dayRelation = branchRelation(candidate.pillars.day?.branch.korean, todayBranch);
  const monthRelation = branchRelation(candidate.pillars.month?.branch.korean, todayBranch);
  const generalRelation = (harmony.length ? 1 : 0) + (clash.length ? -1 : 0);
  const spouseStar = (gender === "male" && ["정재", "편재"].includes(god))
    || (gender === "female" && ["정관", "편관"].includes(god)) ? 1 : 0;
  return {
    wealth: categoryResult("wealth", (CATEGORY_GOD_WEIGHT.wealth[god] ?? 0) + generalRelation),
    career: categoryResult("career", (CATEGORY_GOD_WEIGHT.career[god] ?? 0) + monthRelation * 2),
    love: categoryResult("love", (CATEGORY_GOD_WEIGHT.love[god] ?? 0) + dayRelation * 2 + spouseStar),
  };
}

export function buildDailyFortune(candidate, date, gender = "unspecified") {
  const today = calculateFourPillars({
    year: date.year, month: date.month, day: date.day, hour: 12, minute: 0,
    dayBoundary: RULES.dayBoundary,
  });
  const todayPillar = pillarData(today, "day", true);
  const dayStem = candidate.pillars.day.stem.korean;
  const god = tenGod(dayStem, todayPillar.stem.korean);
  const natalBranches = PILLAR_KEYS.map((key) => candidate.pillars[key]?.branch.korean).filter(Boolean);
  const harmony = natalBranches.filter((branch) => BRANCH_HARMONY.has(pairKey(branch, todayPillar.branch.korean)));
  const clash = natalBranches.filter((branch) => BRANCH_CLASH.has(pairKey(branch, todayPillar.branch.korean)));
  const categories = categoryFortunes(candidate, todayPillar.branch.korean, god, harmony, clash, gender);
  let accent = "";
  if (harmony.length && clash.length) accent = " 관계의 연결과 변화 신호가 함께 있어, 속도보다 조율이 중요합니다.";
  else if (harmony.length) accent = " 원국과 합의 신호가 있어 사람이나 계획을 연결하기에 좋습니다.";
  else if (clash.length) accent = " 원국과 충의 신호가 있어 일정 변경이나 감정적 반응에는 여유를 두세요.";
  return {
    date: `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
    iljin: todayPillar.korean,
    iljinHanja: todayPillar.hanja,
    tenGod: god,
    emoji: STEM_EMOJI[god],
    text: DAILY_TEXT[god] + accent,
    categories,
    signals: { harmony, clash },
    method: "natal-daymaster+daily-pillar-v1",
  };
}

function kstToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RULES.timeZone, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: +value.year, month: +value.month, day: +value.day };
}

export function buildChart(input) {
  const year = integer(input?.year, "연도", 1800, 2300);
  const month = integer(input?.month, "월", 1, 12);
  const day = integer(input?.day, "일", 1, 31);
  if (!validSolarDate(year, month, day)) throw new RangeError("실재하지 않는 양력 날짜입니다.");

  const { includeHour, points } = timeCandidates(input);
  const candidates = [];
  const seen = new Set();
  for (const point of points) {
    const result = calculateFourPillars({
      year, month, day, hour: point.hour, minute: point.minute,
      dayBoundary: RULES.dayBoundary,
    });
    const candidate = serialize(result, point, includeHour);
    const key = signature(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return {
    birthDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    rules: RULES,
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

export async function handleFortuneChart(request, env) {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (+(request.headers.get("Content-Length") ?? 0) > 2048) {
    return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }
  try {
    const input = await request.json();
    const resolved = await resolveBirthDate(input, env);
    const chart = buildChart({ ...input, ...resolved.solar });
    chart.inputCalendar = resolved.calendar;
    chart.inputDate = resolved.inputDate;
    chart.solarDate = resolved.solar;
    const today = kstToday();
    const gender = ["male", "female"].includes(input?.gender) ? input.gender : "unspecified";
    chart.gender = gender;
    chart.dailyFortunes = chart.candidates.map((candidate) => buildDailyFortune(candidate, today, gender));
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
