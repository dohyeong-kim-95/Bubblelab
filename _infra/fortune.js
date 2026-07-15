import manseryeok from "manseryeok";

const {
  calculateFourPillars,
  getEarthlyBranchElement,
  getEarthlyBranchYinYang,
  getHeavenlyStemElement,
  getHeavenlyStemYinYang,
} = manseryeok;

const BRANCH_NAMES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
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

export async function handleFortuneChart(request, env) {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (+(request.headers.get("Content-Length") ?? 0) > 2048) {
    return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }
  try {
    const input = await request.json();
    const chart = buildChart(input);
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
