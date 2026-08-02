// util/brief — 아침 브리핑(날씨·미세먼지)과 매일 오전 8시(KST) 알림.
//
// 데이터는 Open-Meteo(무료·API 키 없음·CC-BY 4.0)에서 가져온다. 브라우저가 직접
// 부르지 않고 Worker를 거치는 이유는 셋이다: ① 브리핑 문장을 만드는 코드가
// 화면과 cron 알림에서 하나여야 한다 ② Cache API로 지역당 호출을 10분에 한 번으로
// 묶는다 ③ 좌표를 클라이언트가 정하지 못하게 지역 허용 목록으로 고정한다.
import { sendWebPush } from "./webpush.js";

// 광역시는 시청, 도는 도청 소재지 좌표. 사용자가 고르는 값은 이 id뿐이라
// 위치 권한도, 좌표 입력도 받지 않는다.
export const BRIEF_REGIONS = [
  { id: "seoul", name: "서울", lat: 37.5665, lon: 126.978 },
  { id: "busan", name: "부산", lat: 35.1796, lon: 129.0756 },
  { id: "daegu", name: "대구", lat: 35.8714, lon: 128.6014 },
  { id: "incheon", name: "인천", lat: 37.4563, lon: 126.7052 },
  { id: "gwangju", name: "광주", lat: 35.1595, lon: 126.8526 },
  { id: "daejeon", name: "대전", lat: 36.3504, lon: 127.3845 },
  { id: "ulsan", name: "울산", lat: 35.5384, lon: 129.3114 },
  { id: "sejong", name: "세종", lat: 36.48, lon: 127.289 },
  { id: "gyeonggi", name: "경기(수원)", lat: 37.2636, lon: 127.0286 },
  { id: "gangwon", name: "강원(춘천)", lat: 37.8813, lon: 127.73 },
  { id: "chungbuk", name: "충북(청주)", lat: 36.6424, lon: 127.489 },
  { id: "chungnam", name: "충남(홍성)", lat: 36.6009, lon: 126.665 },
  { id: "jeonbuk", name: "전북(전주)", lat: 35.8242, lon: 127.148 },
  { id: "jeonnam", name: "전남(무안)", lat: 34.99, lon: 126.48 },
  { id: "gyeongbuk", name: "경북(안동)", lat: 36.5684, lon: 128.7294 },
  { id: "gyeongnam", name: "경남(창원)", lat: 35.228, lon: 128.6811 },
  { id: "jeju", name: "제주", lat: 33.4996, lon: 126.5312 },
];

export const DEFAULT_REGION = "seoul";
const regionById = new Map(BRIEF_REGIONS.map((r) => [r.id, r]));
export const findRegion = (id) => regionById.get(String(id ?? "")) ?? null;

// WMO 코드 → 한국어. Open-Meteo는 이 표준 코드만 주므로 표시는 우리가 정한다.
const SKY = new Map([
  [0, ["맑음", "☀️"]], [1, ["대체로 맑음", "🌤️"]], [2, ["구름 조금", "⛅"]], [3, ["흐림", "☁️"]],
  [45, ["안개", "🌫️"]], [48, ["짙은 안개", "🌫️"]],
  [51, ["약한 이슬비", "🌦️"]], [53, ["이슬비", "🌦️"]], [55, ["굵은 이슬비", "🌧️"]],
  [56, ["어는 이슬비", "🌧️"]], [57, ["어는 이슬비", "🌧️"]],
  [61, ["약한 비", "🌦️"]], [63, ["비", "🌧️"]], [65, ["강한 비", "🌧️"]],
  [66, ["어는 비", "🌧️"]], [67, ["어는 비", "🌧️"]],
  [71, ["약한 눈", "🌨️"]], [73, ["눈", "❄️"]], [75, ["많은 눈", "❄️"]], [77, ["싸락눈", "🌨️"]],
  [80, ["소나기", "🌦️"]], [81, ["소나기", "🌧️"]], [82, ["강한 소나기", "⛈️"]],
  [85, ["소낙눈", "🌨️"]], [86, ["많은 소낙눈", "❄️"]],
  [95, ["천둥번개", "⛈️"]], [96, ["우박 동반 뇌우", "⛈️"]], [99, ["우박 동반 뇌우", "⛈️"]],
]);

export function skyOf(code) {
  // Number(null)은 0(=맑음)이라 값이 없는데 "맑음"이라고 우기게 된다 — 먼저 거른다.
  const known = Number.isFinite(+code) && code !== null && code !== "" ? SKY.get(+code) : null;
  const [label, icon] = known ?? ["정보 없음", "❔"];
  return { label, icon };
}

// 환경부 예보 등급 경계(㎍/㎥). PM10과 PM2.5 중 나쁜 쪽을 대표 등급으로 쓴다 —
// 둘 중 하나만 나빠도 마스크를 챙겨야 하기 때문이다.
const PM10_STEPS = [30, 80, 150];
const PM25_STEPS = [15, 35, 75];
const AIR_GRADES = [
  { label: "좋음", icon: "😀" }, { label: "보통", icon: "🙂" },
  { label: "나쁨", icon: "😷" }, { label: "매우 나쁨", icon: "🤢" },
];

const stepOf = (value, steps) => {
  if (!Number.isFinite(value)) return -1;
  const index = steps.findIndex((limit) => value <= limit);
  return index === -1 ? steps.length : index;      // 마지막 경계를 넘으면 매우 나쁨
};

export function airGrade(pm10, pm25) {
  const level = Math.max(stepOf(pm10, PM10_STEPS), stepOf(pm25, PM25_STEPS));
  if (level < 0) return { pm10: null, pm25: null, label: null, icon: "❔" };
  return {
    pm10: Number.isFinite(pm10) ? Math.round(pm10) : null,
    pm25: Number.isFinite(pm25) ? Math.round(pm25) : null,
    ...AIR_GRADES[level],
  };
}

const num = (value) => (Number.isFinite(+value) ? +value : null);
const round = (value) => (value === null ? null : Math.round(value));

// KST 기준 오늘 날짜. Worker는 UTC로 돌아가므로 9시간 더해서 자른다.
export function kstStamp(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const RAIN_ALERT = 30;   // 이 이상이면 우산 안내 + 푸시 한 줄에도 넣는다

function dayOf(daily, index) {
  if (!daily || !Array.isArray(daily.time) || index >= daily.time.length) return null;
  const code = num(daily.weather_code?.[index]);
  return {
    date: daily.time[index],
    min: round(num(daily.temperature_2m_min?.[index])),
    max: round(num(daily.temperature_2m_max?.[index])),
    rainChance: round(num(daily.precipitation_probability_max?.[index])),
    code,
    ...skyOf(code),
  };
}

// 화면·읽어주기·푸시가 같은 문장을 쓰도록 서버에서 한 번만 만든다.
// text는 TTS가 읽을 문장(기호 대신 "도"·"퍼센트"), summary는 푸시 본문 한 줄이다.
export function buildBrief({ region, weather, air, now = new Date() }) {
  const stamp = kstStamp(now);
  const daily = weather?.daily;
  const todayIndex = Math.max(0, (daily?.time ?? []).indexOf(stamp));
  const today = dayOf(daily, todayIndex);
  const tomorrow = dayOf(daily, todayIndex + 1);
  const currentCode = num(weather?.current?.weather_code);
  const current = {
    temp: round(num(weather?.current?.temperature_2m)),
    code: currentCode,
    ...skyOf(currentCode),
  };

  const [year, month, day] = stamp.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];

  // 값이 없으면 그 줄을 통째로 뺀다. `day?.max !== null`은 day 자체가 null일 때도
  // 참이라(undefined !== null) 쓰면 안 된다 — 있는지부터 확인한다.
  const has = (day, ...keys) => !!day && keys.every((k) => day[k] !== null && day[k] !== undefined);

  const lines = [`${month}월 ${day}일 ${weekday}요일, ${region.name} 아침 브리핑입니다.`];
  if (current.temp !== null) {
    lines.push(`지금 기온은 ${current.temp}도, 하늘은 ${current.label}입니다.`);
  }
  if (has(today, "max", "min")) {
    lines.push(`오늘 낮 최고 ${today.max}도, 아침 최저 ${today.min}도로 ${today.label}이 예상됩니다.`);
  }
  if (has(today, "rainChance")) {
    lines.push(today.rainChance >= RAIN_ALERT
      ? `비 올 확률은 ${today.rainChance}퍼센트입니다. 우산을 챙기세요.`
      : `비 올 확률은 ${today.rainChance}퍼센트로 낮습니다.`);
  }
  if (air.label) {
    lines.push(air.label === "좋음" || air.label === "보통"
      ? `미세먼지는 ${air.label}입니다.`
      : `미세먼지가 ${air.label}입니다. 외출할 때 마스크를 챙기세요.`);
  }
  if (has(tomorrow, "max")) {
    lines.push(`내일은 ${tomorrow.label}, 최고 ${tomorrow.max}도로 예보돼 있습니다.`);
  }

  // 푸시 한 줄은 짧을수록 읽힌다 — 낮은 강수확률은 넣지 않는다.
  const parts = [];
  if (current.temp !== null) parts.push(`지금 ${current.temp}°`);
  if (has(today, "max")) parts.push(`낮 최고 ${today.max}°`);
  if (has(today, "rainChance") && today.rainChance >= RAIN_ALERT) parts.push(`비 ${today.rainChance}%`);
  if (air.label) parts.push(`미세먼지 ${air.label}`);

  return {
    region: { id: region.id, name: region.name },
    date: stamp,
    weekday,
    current,
    today,
    tomorrow,
    air,
    text: lines.join("\n"),
    title: `${today?.icon ?? current.icon} ${region.name} 아침 브리핑`,
    summary: parts.join(" · "),
  };
}

// ── 상류 조회 ─────────────────────────────────────────────────
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const UPSTREAM_TIMEOUT_MS = 8000;

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

export async function fetchBrief(region, now = new Date()) {
  const common = `latitude=${region.lat}&longitude=${region.lon}&timezone=Asia%2FSeoul`;
  // 미세먼지는 없어도 브리핑이 성립하므로 실패해도 날씨만으로 진행한다.
  const [weather, airRaw] = await Promise.all([
    getJson(`${FORECAST_URL}?${common}&current=temperature_2m,weather_code`
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
      + "&forecast_days=2"),
    getJson(`${AIR_URL}?${common}&current=pm10,pm2_5`).catch(() => null),
  ]);
  const air = airGrade(num(airRaw?.current?.pm10), num(airRaw?.current?.pm2_5));
  return buildBrief({ region, weather, air, now });
}

// ── 워커 라우트 ───────────────────────────────────────────────
const CACHE_SECONDS = 600;   // 지역당 10분 — 상류 무료 API를 아껴 쓴다

export async function handleBriefToday(request, env, url) {
  const region = findRegion(url.searchParams.get("region") ?? DEFAULT_REGION);
  if (!region) return Response.json({ error: "unknown region" }, { status: 400 });

  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheRequest = new Request(`https://brief-cache.bubblelab.dev/v1/${region.id}`);
  const cached = await cache?.match(cacheRequest);
  if (cached) return new Response(cached.body, cached);

  let brief;
  try {
    brief = await fetchBrief(region);
  } catch (error) {
    console.error("brief upstream failed", error);
    return Response.json(
      { error: "날씨 정보를 불러오지 못했어요." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const response = Response.json(brief, {
    headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
  });
  await cache?.put(cacheRequest, response.clone());
  return response;
}

// ── 매일 오전 8시(KST) 알림 ────────────────────────────────────
// 로그인 없는 공개 유틸이라 익명 구독을 BriefDO 한 인스턴스에 endpoint 해시로
// 저장한다. 함께 저장하는 값은 사용자가 고른 지역 id 하나뿐이다 — 좌표도,
// 위치 권한도, 그 밖의 개인정보도 받지 않는다.
const MAX_BRIEF_SUBS = 20000;
const BRIEF_URL = "https://util.bubblelab.dev/brief";

const hexDigest = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function endpointKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return `push:${hexDigest(digest).slice(0, 32)}`;
}

const briefStub = (env) => env.BRIEF.get(env.BRIEF.idFromName("global"));

export async function handleBriefPush(request, env) {
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
  return briefStub(env).fetch("https://brief.internal/push", {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}

// cron(23:00 UTC = 08:00 KST)에서 호출
export function sendBriefDaily(env) {
  return briefStub(env).fetch("https://brief.internal/notify", { method: "POST" });
}

export class BriefDO {
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
    const region = findRegion(body.region) ?? findRegion(DEFAULT_REGION);
    const key = await endpointKey(sub.endpoint);
    // 이미 등록된 endpoint면 지역만 갱신, 새 endpoint면 전체 상한을 확인한다.
    if (!(await this.storage.get(key))) {
      const count = (await this.storage.list({ prefix: "push:", limit: MAX_BRIEF_SUBS + 1 })).size;
      if (count >= MAX_BRIEF_SUBS) {
        return Response.json({ error: "구독자가 가득 찼습니다" }, { status: 503 });
      }
    }
    await this.storage.put(key, {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      region: region.id,
    });
    return Response.json({ subscribed: true, region: region.id });
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

    // 구독자를 지역별로 묶어 지역당 한 번만 조회한다.
    const byRegion = new Map();
    for (const [key, sub] of await this.storage.list({ prefix: "push:" })) {
      const id = findRegion(sub.region)?.id ?? DEFAULT_REGION;
      if (!byRegion.has(id)) byRegion.set(id, []);
      byRegion.get(id).push([key, sub]);
    }

    let sent = 0;
    for (const [id, subs] of byRegion) {
      let brief;
      try {
        brief = await fetchBrief(findRegion(id));
      } catch (error) {
        // 날씨를 못 받으면 그 지역은 건너뛴다 — 빈 알림을 보내지 않는다.
        console.error("brief notify skipped region", id, error);
        continue;
      }
      const payload = JSON.stringify({
        title: brief.title,
        body: brief.summary || "오늘의 날씨를 확인해보세요.",
        url: BRIEF_URL,
      });
      for (const [key, sub] of subs) {
        try {
          const result = await sendWebPush(sub, payload, vapid);
          if (result.gone) await this.storage.delete(key);   // 만료 구독 정리
          else if (result.ok) sent += 1;
        } catch (error) {
          console.error("brief push send failed", error);
        }
      }
    }
    return Response.json({ sent });
  }
}
