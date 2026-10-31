// 아침 브리핑의 오늘 날씨 — 지역마다 한 줄. 모델이 아니라 코드가 만든다(날씨를 지어내면 안 된다).
//
// 데이터는 util/brief 와 같은 Open-Meteo(무료·API 키 없음·CC-BY 4.0)를 PC 에서 바로 부른다.
// 하늘 표·미세먼지 등급 경계는 `_infra/brief.js` 가 원본이다(설치본은 리포 밖이라 import 못 해 옮겨 왔다).
// 날씨를 못 가져오면 그 지역 줄만 빠지고 브리핑은 그대로 나간다.

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TIMEOUT_MS = 8000;
const RAIN_ALERT = 30; // 이 이상이면 우산 안내
// 줄 끝 안내. 당이 인사가 이미 같은 말을 했으면 브리핑이 떼어 낸다(assistant.mjs) — 두 번 말하지 않게.
export const HINTS = { umbrella: " ☔ 우산 챙기승!", mask: " 😷 마스크 챙기승!" };

// 시청 좌표. 설정 assistant.weather 로 바꾼다.
export const DEFAULT_PLACES = [
  { name: "청주", lat: 36.6424, lon: 127.489 },
  { name: "용인", lat: 37.2411, lon: 127.1776 },
];

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
// 환경부 예보 등급 경계(㎍/㎥). PM10·PM2.5 중 나쁜 쪽.
const PM10_STEPS = [30, 80, 150], PM25_STEPS = [15, 35, 75];
const AIR = ["좋음", "보통", "나쁨", "매우 나쁨"];

const num = (v) => (v !== null && v !== "" && Number.isFinite(+v) ? +v : null); // Number(null) 은 0(=맑음)이라 먼저 거른다
function step(v, steps) {
  if (v === null) return -1;
  const i = steps.findIndex((s) => v <= s);
  return i === -1 ? steps.length : i; // 마지막 경계를 넘으면 매우 나쁨
}

export function airLabel(pm10, pm25) {
  const level = Math.max(step(num(pm10), PM10_STEPS), step(num(pm25), PM25_STEPS));
  return level < 0 ? null : AIR[level];
}

/** Open-Meteo 응답 → "· 청주 ☀️ 맑음, 지금 8° (낮 17° / 아침 5°) · 비 10% · 미세먼지 보통". 오늘 값이 없으면 null. */
export function weatherLine(name, forecast, air, today) {
  const d = forecast?.daily, i = (d?.time ?? []).indexOf(today);
  if (i < 0) return null;
  const sky = SKY.get(num(d.weather_code?.[i]));
  const max = num(d.temperature_2m_max?.[i]), min = num(d.temperature_2m_min?.[i]);
  const rain = num(d.precipitation_probability_max?.[i]), cur = num(forecast?.current?.temperature_2m);
  if (!sky && max === null) return null;
  let head = `· ${name}${sky ? ` ${sky[1]} ${sky[0]}` : ""}`;
  const temps = [cur !== null && `지금 ${Math.round(cur)}°`, max !== null && min !== null && `(낮 ${Math.round(max)}° / 아침 ${Math.round(min)}°)`].filter(Boolean);
  if (temps.length) head += `, ${temps.join(" ")}`;
  const bits = [head];
  if (rain !== null) bits.push(`비 ${Math.round(rain)}%`);
  const a = airLabel(air?.current?.pm10, air?.current?.pm2_5);
  if (a) bits.push(`미세먼지 ${a}`);
  let line = bits.join(" · ");
  if (rain !== null && rain >= RAIN_ALERT) line += HINTS.umbrella;
  if (a === "나쁨" || a === "매우 나쁨") line += HINTS.mask;
  return line;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`날씨 ${res.status}`);
  return res.json();
}

/** 지역들의 오늘 날씨 줄. 한 곳도 못 가져오면 []. 미세먼지만 실패하면 날씨만. */
export async function weatherLines(places, today, { fetchImpl = fetch, log } = {}) {
  const lines = await Promise.all(places.map(async (p) => {
    const q = `latitude=${p.lat}&longitude=${p.lon}&timezone=Asia%2FSeoul`;
    try {
      const [forecast, air] = await Promise.all([
        getJson(`${FORECAST_URL}?${q}&current=temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2`, fetchImpl),
        getJson(`${AIR_URL}?${q}&current=pm10,pm2_5`, fetchImpl).catch(() => null),
      ]);
      return weatherLine(p.name, forecast, air, today);
    } catch (e) {
      log?.("당이: 날씨 못 가져옴", p.name, String(e?.message || e));
      return null;
    }
  }));
  const ok = lines.filter(Boolean);
  return ok.length ? ["🌡️ 오늘 날씨", ...ok] : [];
}
