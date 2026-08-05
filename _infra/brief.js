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

// ── 환율 ──────────────────────────────────────────────────────
// Frankfurter(api.frankfurter.dev)는 유럽중앙은행 고시환율을 그대로 서빙하는
// 오픈소스 API다 — API 키 없음, 등록 없음, 호출 한도 없음(MIT).
// 뉴스와 달리 저작권 협상이 필요 없는 것이 이 소스를 고른 이유다.
//
// 주의: ECB는 유로 기준으로 매 영업일 16:00 CET에 한 번 고시한다. 따라서
// ① 원/달러는 EUR/USD와 EUR/KRW로 만든 **교차환율**이라 은행 매매기준율과 다르고
// ② 한국 아침 8시에는 전 영업일 고시가 최신이다. 화면에 기준일을 함께 적는다.
export const RATE_SYMBOLS = [
  { code: "USD", label: "달러", unit: 1 },
  { code: "JPY", label: "엔", unit: 100 },      // 엔은 100엔 단위가 관례
  { code: "EUR", label: "유로", unit: 1 },
  { code: "CNY", label: "위안", unit: 1 },
];

const won = (unit, rate) => (Number.isFinite(rate) && rate > 0 ? unit / rate : null);

// ECB는 TARGET 영업일(월~금)에만 고시한다. 달력 일수로 재면 금요일 고시가 월요일
// 아침에 "3일 전 값"이 되어 **매주 월요일마다** 정상값이 stale로 뜬다. 주말을
// 빼고 영업일로 센다 (공휴일 달력은 없으므로 아래 임계값에서 하루치 여유를 둔다).
// from 다음 날부터 to까지의 월~금 일수 — 같은 날이거나 역순이면 0.
export function businessDaysBetween(from, to) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  if (end - start > 400 * 86400000) return Number.MAX_SAFE_INTEGER;  // 망가진 입력에 루프 금지
  let days = 0;
  for (let t = start + 86400000; t <= end; t += 86400000) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days++;
  }
  return days;
}

// Frankfurter 기간 응답 → 최신 고시일과 그 직전 고시일
export function buildRates({ series, now = new Date() }) {
  const byDate = series?.rates && typeof series.rates === "object" ? series.rates : {};
  const dates = Object.keys(byDate).sort();                 // 오름차순 = 과거 → 최신
  const latest = dates[dates.length - 1];
  const previous = dates[dates.length - 2];
  if (!latest) return { date: null, items: [], text: "", stale: true };

  const items = [];
  for (const symbol of RATE_SYMBOLS) {
    const value = won(symbol.unit, +byDate[latest]?.[symbol.code]);
    if (value === null) continue;                           // 못 받은 통화는 빼고 그린다
    const before = previous ? won(symbol.unit, +byDate[previous]?.[symbol.code]) : null;
    items.push({
      code: symbol.code,
      label: symbol.label,
      unit: symbol.unit,
      value: Math.round(value * 100) / 100,
      change: before === null ? null : Math.round((value - before) * 100) / 100,
    });
  }

  // 기준일이 영업일로 이틀 넘게 예전이면 연휴 등으로 밀린 것이다 — 숨기지 않고 알린다.
  const ageDays = businessDaysBetween(latest, kstStamp(now));
  const dollar = items.find((i) => i.code === "USD");
  const lines = [];
  if (dollar) {
    const moved = dollar.change === null || dollar.change === 0 ? ""
      : ` 어제보다 ${Math.abs(dollar.change).toFixed(1)}원 ${dollar.change > 0 ? "올랐습니다" : "내렸습니다"}.`;
    lines.push(`달러 환율은 ${Math.round(dollar.value)}원입니다.${moved}`);
  }
  const rest = items.filter((i) => i.code !== "USD")
    .map((i) => `${i.unit === 100 ? "백 " : ""}${i.label}은 ${Math.round(i.value)}원`);
  if (rest.length) lines.push(`${rest.join(", ")}입니다.`);

  return {
    date: latest,
    previousDate: previous ?? null,
    stale: ageDays > 2,
    items,
    text: lines.join(" "),
  };
}

// ── 지수 ──────────────────────────────────────────────────────
// 코스피·코스닥은 키 없이 쓸 수 있는 최신 소스가 없어서(공공데이터포털은 기준일
// 다음 영업일 13시 갱신, KRX는 키 필요) 미국 지수를 쓴다. Stooq는 키 없이 일별
// 시세를 CSV로 준다. 지수값은 사실이지만 소스 약관은 개인·비상업 이용 기준이다.
export const INDEX_SYMBOLS = [
  { id: "dow", label: "다우", name: "다우존스", stooq: "^dji", yahoo: "^DJI" },
  { id: "nasdaq", label: "나스닥", name: "나스닥 종합", stooq: "^ndq", yahoo: "^IXIC" },
];

// Number(null)도 Number("")도 0이다. 휴장일·빈 칸을 그대로 통과시키면 지수가
// 0으로 찍히고 등락률이 -100%가 된다 — 숫자로 쓰기 전에 반드시 여기를 거친다.
const closeOf = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Stooq 일별 CSV: "Date,Open,High,Low,Close,Volume" 헤더 + 날짜 오름차순 행
export function parseStooqDaily(csv) {
  const lines = String(csv ?? "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",");
  const dateAt = header.indexOf("date");
  const closeAt = header.indexOf("close");
  if (dateAt < 0 || closeAt < 0) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const close = closeOf(cells[closeAt]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[dateAt] ?? "") || close === null) continue;
    rows.push({ date: cells[dateAt], close });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Yahoo 차트 응답 → {date, close} 행. 장중에는 마지막 행이 미확정 종가라
// 그대로 쓰면 "전일 대비"가 아니라 "현재가 대비"가 되지만, 아침 브리핑에는
// 미국장이 이미 닫혀 있어 마지막 행이 곧 종가다.
export function parseYahooChart(json) {
  const result = json?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return [];
  const rows = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closeOf(closes[i]);                 // 휴장일은 null이 온다
    const at = Number(stamps[i]);
    if (close === null || !Number.isFinite(at)) continue;
    rows.push({ date: new Date(at * 1000).toISOString().slice(0, 10), close });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function buildIndex(symbol, rows) {
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  if (!latest) return null;
  const change = previous ? latest.close - previous.close : null;
  return {
    id: symbol.id,
    label: symbol.label,
    name: symbol.name,
    date: latest.date,
    value: Math.round(latest.close * 100) / 100,
    change: change === null ? null : Math.round(change * 100) / 100,
    changePct: change === null || !previous.close
      ? null : Math.round((change / previous.close) * 10000) / 100,
  };
}

export function indexSpeech(indices) {
  const parts = [];
  for (const index of indices) {
    if (index.changePct === null || index.changePct === 0) {
      parts.push(`${index.label}지수는 ${Math.round(index.value)}입니다`);
      continue;
    }
    parts.push(`${index.label}지수는 ${Math.round(index.value)}으로`
      + ` ${Math.abs(index.changePct).toFixed(2)}퍼센트 ${index.changePct > 0 ? "올랐습니다" : "내렸습니다"}`);
  }
  return parts.length ? `${parts.join(", ")}.` : "";
}

const RATES_URL = "https://api.frankfurter.dev/v1";
// 상류를 하나만 쓰면 그 하나가 막힐 때 지수가 통째로 사라진다 — 실제로 Stooq가
// Cloudflare Worker에서 빈 응답을 줘서 배포 후에야 알았다. 순서대로 시도한다.
//
// Yahoo가 먼저인 이유: Stooq는 Worker에서 **항상** 막히는 것으로 확인됐다(배포 후
// 실측). 그대로 두면 캐시가 만료될 때마다 실패가 확정된 호출을 기다렸다가 넘어가서
// 첫 응답이 그만큼 늦어진다. Stooq는 Yahoo가 막힐 때를 위한 예비로만 남긴다.
// 브라우저가 아닌 곳에서 오는 요청을 막는 상류가 있어 User-Agent를 붙인다.
const UA = "Mozilla/5.0 (compatible; BubblelabBrief/1.0; +https://util.bubblelab.dev/brief)";

const INDEX_PROVIDERS = [
  {
    name: "Yahoo",
    async rows(symbol) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/`
        + `${encodeURIComponent(symbol.yahoo)}?range=1mo&interval=1d`;
      return parseYahooChart(JSON.parse(await getText(url)));
    },
  },
  {
    name: "Stooq",
    async rows(symbol, { start, end }) {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.stooq)}`
        + `&i=d&d1=${start}&d2=${end}`;
      const csv = await getText(url);
      // 상류가 CSV 대신 안내·차단 HTML을 200으로 돌려주는 일이 있다.
      if (/^\s*</.test(csv)) throw new Error("non-CSV response (HTML?)");
      return parseStooqDaily(csv);
    },
  },
];

async function getText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { "User-Agent": UA, Accept: "*/*" },
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.text();
}

// 반환: { items, source } — 어느 상류가 답했는지 화면에 밝히고, 디버깅에도 쓴다.
export async function fetchIndices(now = new Date()) {
  const end = kstStamp(now).replace(/-/g, "");
  const start = new Date(Date.parse(kstStamp(now)) - 21 * 86400000)
    .toISOString().slice(0, 10).replace(/-/g, "");

  for (const provider of INDEX_PROVIDERS) {
    // 지수 하나가 실패해도 나머지는 보여주되, 전부 실패하면 다음 상류로 넘어간다.
    const items = (await Promise.all(INDEX_SYMBOLS.map(async (symbol) => {
      try {
        const index = buildIndex(symbol, await provider.rows(symbol, { start, end }));
        // 행은 받았는데 쓸 수 있는 종가가 없으면 "지수가 원래 없는 것"과 구분해야 한다
        if (!index) throw new Error("no usable rows");
        return index;
      } catch (error) {
        console.error("brief index failed", provider.name, symbol.id, error);
        return null;
      }
    }))).filter(Boolean);
    if (items.length) return { items, source: provider.name };
  }
  return { items: [], source: null };
}

export async function fetchRates(now = new Date()) {
  // 최신 고시일을 모르므로 최근 열흘을 받아 마지막 두 영업일을 쓴다
  // (연휴가 길어도 직전 고시가 들어오도록 넉넉히 잡는다).
  const end = kstStamp(now);
  const start = new Date(Date.parse(end) - 10 * 86400000).toISOString().slice(0, 10);
  const symbols = RATE_SYMBOLS.map((s) => s.code).join(",");
  const series = await getJson(`${RATES_URL}/${start}..${end}?base=KRW&symbols=${symbols}`);
  return buildRates({ series, now });
}

export async function handleBriefRates(request, env) {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheRequest = new Request("https://brief-cache.bubblelab.dev/v1/rates");
  const cached = await cache?.match(cacheRequest);
  if (cached) return new Response(cached.body, cached);

  // 환율과 지수는 서로 다른 상류다 — 한쪽이 죽어도 다른 쪽은 보여준다.
  const [rates, indices] = await Promise.all([
    fetchRates().catch((error) => {
      console.error("brief rates upstream failed", error);
      return null;
    }),
    fetchIndices().catch(() => ({ items: [], source: null })),
  ]);
  if (!rates && !indices.items.length) {
    return Response.json(
      { error: "환율·지수를 불러오지 못했어요." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const payload = {
    ...(rates ?? { date: null, items: [], text: "", stale: false }),
    indices: indices.items,
    indexSource: indices.source,
  };
  // 상류가 죽었을 때 지수 줄만 조용히 빠지면 아무도 고장을 모른다 — 화면이 알리도록 넘긴다.
  payload.indicesFailed = indices.items.length < INDEX_SYMBOLS.length;
  payload.ratesFailed = !rates;
  payload.text = [rates?.text, indexSpeech(indices.items)].filter(Boolean).join(" ");
  // ECB는 하루 한 번 고시라 자주 물을 이유가 없다. 다만 한쪽이 실패한 응답을
  // 30분씩 물고 있으면 복구도 30분 늦어지므로 그때는 짧게 잡는다.
  const maxAge = payload.indicesFailed || payload.ratesFailed ? 300 : 1800;
  const response = Response.json(payload, {
    headers: { "Cache-Control": `public, max-age=${maxAge}` },
  });
  await cache?.put(cacheRequest, response.clone());
  return response;
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
