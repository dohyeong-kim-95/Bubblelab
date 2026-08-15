// 항공권 최저가 조회 프로바이더. trip/ 계획 탭의 가격 관측이 여기서 나온다.
//
// **가격의 성격이 제일 중요하다.** 우리가 보고 싶은 건 "지금 결제하면 실제로 나갈
// 금액"이지 참고 시세가 아니다. 그래서 관측마다 `bookable` 을 같이 저장하고 화면이
// 배지로 구분한다 — 참고가를 예매가처럼 보여 주면 예산 전체가 거짓말이 된다.
//
//   amadeus  … Flight Offers Search. 세금·수수료 포함 총액(grandTotal)이고
//              프로덕션 키일 때만 실제 예매 가능한 offer 다(테스트 환경은 제한된
//              캐시 데이터라 bookable=false 로 내려간다).
//   sink     … 엣지가 조회하지 않는다. 집 PC 데몬이 실제 예매 화면에서 긁어
//              /_trip/snapshot 으로 밀어 넣는다(_src/trip-sink). GDS 에 없는
//              LCC·국내 OTA 할인가까지 잡히는 대신 PC 가 꺼져 있으면 멈춘다.
//   mock     … 로컬 개발·테스트용 가짜 가격. 절대 bookable 이 아니다.
//
// 프로바이더를 바꾸는 건 env 하나(TRIP_FLIGHT_PROVIDER)뿐이고, 저장 형식은 셋 다
// 같다 — 나중에 갈아끼워도 그동안 쌓은 관측이 그대로 이어진다.

export const GRID_LIMITS = {
  maxCombos: 120,      // watch 하나가 만드는 (출발,귀국) 조합 상한 = 쿼터 보호선
  maxWindowDays: 180,  // 출발 가능 구간 길이 상한
  maxNights: 30,
  maxWatches: 8,
  historyDays: 180,
};

const DAY_MS = 86400000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(iso) {
  const m = ISO.exec(String(iso ?? ""));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null;
  return ms;
}

export function dayISO(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * 날짜 조합 그리드. Google Flights 의 날짜 격자와 같은 모양 —
 * 출발 가능 구간 × 여행 밤수 범위의 모든 (출발일, 귀국일) 쌍.
 * 편도는 nights 를 비워 두면 된다(귀국일 null).
 */
export function buildDateGrid({ from, to, minNights, maxNights, oneWay = false }) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (start === null || end === null || end < start) return [];

  const combos = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const depart = dayISO(ms);
    if (oneWay) {
      combos.push({ depart, ret: null, nights: null });
      continue;
    }
    const lo = Math.max(0, Math.round(minNights ?? 0));
    const hi = Math.max(lo, Math.round(maxNights ?? lo));
    for (let n = lo; n <= hi; n += 1) combos.push({ depart, ret: dayISO(ms + n * DAY_MS), nights: n });
  }
  return combos;
}

export const comboKey = (c) => `${c.depart}:${c.ret ?? "-"}`;

/** watch 설정 검사. 화면과 API 가 같은 규칙을 쓰도록 여기 한 곳에만 둔다. */
export function validateWatch(raw) {
  const w = raw && typeof raw === "object" ? raw : {};
  const code = (v) => String(v ?? "").trim().toUpperCase();
  const origin = code(w.origin);
  const dest = code(w.dest);
  const errors = [];

  if (!/^[A-Z]{3}$/.test(origin)) errors.push("출발지는 IATA 3글자여야 합니다 (예: ICN)");
  if (!/^[A-Z]{3}$/.test(dest)) errors.push("도착지는 IATA 3글자여야 합니다 (예: ULN)");
  if (origin && origin === dest) errors.push("출발지와 도착지가 같습니다");

  const from = parseDay(w.from);
  const to = parseDay(w.to);
  if (from === null || to === null) errors.push("출발 가능 구간의 날짜 형식이 올바르지 않습니다");
  else if (to < from) errors.push("구간의 끝이 시작보다 앞섭니다");
  else if ((to - from) / DAY_MS + 1 > GRID_LIMITS.maxWindowDays) {
    errors.push(`출발 가능 구간은 ${GRID_LIMITS.maxWindowDays}일까지입니다`);
  }

  const oneWay = w.oneWay === true;
  const minNights = Math.max(0, Math.round(Number(w.minNights) || 0));
  const maxNights = Math.max(minNights, Math.round(Number(w.maxNights) || minNights));
  if (!oneWay && maxNights > GRID_LIMITS.maxNights) {
    errors.push(`여행 밤수는 ${GRID_LIMITS.maxNights}박까지입니다`);
  }

  const adults = Math.min(9, Math.max(1, Math.round(Number(w.adults) || 1)));
  const cabin = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"].includes(code(w.cabin))
    ? code(w.cabin) : "ECONOMY";

  const watch = {
    id: String(w.id ?? "").slice(0, 64) || `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    label: String(w.label ?? "").slice(0, 60) || `${origin}→${dest}`,
    origin, dest,
    from: w.from, to: w.to,
    oneWay, minNights, maxNights,
    adults, cabin,
    nonstop: w.nonstop === true,
    currency: /^[A-Z]{3}$/.test(code(w.currency)) ? code(w.currency) : "KRW",
    active: w.active !== false,
    createdAt: Number(w.createdAt) || Date.now(),
  };

  const combos = errors.length ? [] : buildDateGrid(watch);
  if (!errors.length && combos.length > GRID_LIMITS.maxCombos) {
    errors.push(
      `날짜 조합이 ${combos.length}개입니다 — ${GRID_LIMITS.maxCombos}개까지만 관측합니다. ` +
      "구간이나 밤수 범위를 좁혀 주세요",
    );
  }
  return { watch, combos, errors };
}

/* ── Amadeus ──────────────────────────────────────────────────────────
 *
 * 테스트 환경(test.api.amadeus.com)은 일부 노선의 캐시된 샘플만 돌려준다.
 * 그래서 여기서 bookable 을 켜지 않는다 — "실제 예매가"로 믿으려면 프로덕션 키가
 * 필요하고, 그 판단을 화면이 아니라 이 계층에서 한 번에 한다.
 */
const AMADEUS_HOSTS = {
  production: "https://api.amadeus.com",
  test: "https://test.api.amadeus.com",
};

export function amadeusConfig(env) {
  const mode = env.AMADEUS_ENV === "production" ? "production" : "test";
  return {
    mode,
    host: AMADEUS_HOSTS[mode],
    clientId: env.AMADEUS_CLIENT_ID || "",
    clientSecret: env.AMADEUS_CLIENT_SECRET || "",
    bookable: mode === "production",
  };
}

/** Flight Offers Search 응답에서 가장 싼 offer 하나를 뽑는다. */
export function parseAmadeusOffers(json) {
  const offers = Array.isArray(json?.data) ? json.data : [];
  let best = null;
  for (const offer of offers) {
    const price = Number(offer?.price?.grandTotal ?? offer?.price?.total);
    if (!Number.isFinite(price) || price <= 0) continue;
    const itineraries = Array.isArray(offer.itineraries) ? offer.itineraries : [];
    const segments = itineraries.flatMap((it) => (Array.isArray(it.segments) ? it.segments : []));
    // 왕복은 편도별 경유가 다를 수 있다 — 더 나쁜 쪽(최대)을 대표값으로 둔다.
    const stops = itineraries.length
      ? Math.max(...itineraries.map((it) => Math.max(0, (it.segments?.length ?? 1) - 1)))
      : 0;
    const carriers = [...new Set(segments.map((s) => s?.carrierCode).filter(Boolean))];
    const candidate = {
      price: Math.round(price),
      currency: String(offer?.price?.currency ?? json?.meta?.currency ?? "KRW"),
      carrier: carriers.join(","),
      stops,
      flights: segments
        .map((s) => `${s?.carrierCode ?? ""}${s?.number ?? ""}`)
        .filter(Boolean).join(" "),
    };
    if (!best || candidate.price < best.price) best = candidate;
  }
  return best;
}

function amadeusProvider(env) {
  const cfg = amadeusConfig(env);
  let token = null; // { value, expiresAt } — 조회마다 다시 받지 않는다

  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 30000) return token.value;
    const res = await fetch(`${cfg.host}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`amadeus auth failed (${res.status})`);
    const json = await res.json();
    token = {
      value: json.access_token,
      expiresAt: Date.now() + Math.max(60, Number(json.expires_in) || 1799) * 1000,
    };
    return token.value;
  }

  return {
    name: `amadeus/${cfg.mode}`,
    bookable: cfg.bookable,
    live: true,
    configured: !!(cfg.clientId && cfg.clientSecret),
    async quote(query) {
      if (!this.configured) throw new Error("AMADEUS_CLIENT_ID/SECRET is not configured");
      const params = new URLSearchParams({
        originLocationCode: query.origin,
        destinationLocationCode: query.dest,
        departureDate: query.depart,
        adults: String(query.adults ?? 1),
        currencyCode: query.currency ?? "KRW",
        travelClass: query.cabin ?? "ECONOMY",
        max: "20",
      });
      if (query.ret) params.set("returnDate", query.ret);
      if (query.nonstop) params.set("nonStop", "true");

      const res = await fetch(`${cfg.host}/v2/shopping/flight-offers?${params}`, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
      });
      if (res.status === 429) throw new Error("amadeus rate limited");
      if (!res.ok) throw new Error(`amadeus search failed (${res.status})`);
      const best = parseAmadeusOffers(await res.json());
      return best ? { ...best, bookable: cfg.bookable, source: this.name } : null;
    },
  };
}

/** 집 PC 데몬이 밀어 넣는 방식. 엣지는 조회하지 않는다. */
function sinkProvider() {
  return {
    name: "sink",
    bookable: true, // 실제 예매 화면에서 받아 온 값이라는 전제
    live: false,
    configured: true,
    async quote() {
      throw new Error("sink provider는 엣지에서 조회하지 않는다 (데몬이 push 한다)");
    },
  };
}

/** 로컬 개발·테스트용. 같은 입력이면 같은 값이 나와야 그래프가 요동치지 않는다. */
export function mockPrice(query) {
  const key = `${query.origin}${query.dest}${query.depart}${query.ret ?? ""}${query.adults ?? 1}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return 380000 + (h % 520000);
}

function mockProvider() {
  return {
    name: "mock",
    bookable: false,
    live: true,
    configured: true,
    async quote(query) {
      return {
        price: mockPrice(query) * (query.adults ?? 1),
        currency: query.currency ?? "KRW",
        carrier: "MOCK",
        stops: 0,
        flights: "",
        bookable: false,
        source: "mock",
      };
    },
  };
}

export function createFlightProvider(env) {
  const name = env.TRIP_FLIGHT_PROVIDER || (env.AMADEUS_CLIENT_ID ? "amadeus" : "mock");
  if (name === "amadeus") return amadeusProvider(env);
  if (name === "sink") return sinkProvider();
  return mockProvider();
}

/* ── 관측 집계 ─────────────────────────────────────────────────────────
 * 화면이 그리는 세 가지 — 날짜 격자, 출발일별 최저가 그래프, 관측일별 추이 —
 * 를 여기서 한 번에 만든다. 같은 최소값을 화면에서 또 구하면 언젠가 어긋난다.
 */
export function summarizeObservations(watch, observations, history = []) {
  const cells = [...observations]
    .filter((o) => Number.isFinite(o?.price) && o.price > 0)
    .sort((a, b) => (a.depart === b.depart ? String(a.ret).localeCompare(String(b.ret)) : a.depart.localeCompare(b.depart)));

  const best = cells.reduce((min, o) => (!min || o.price < min.price ? o : min), null);
  const prices = cells.map((o) => o.price);

  // 출발일별 최저가 (Google Flights 의 가격 그래프에 해당)
  const byDepart = new Map();
  for (const o of cells) {
    const cur = byDepart.get(o.depart);
    if (!cur || o.price < cur.price) byDepart.set(o.depart, o);
  }

  // 관측일 점은 그날 실제로 조회한 것만 담는다. 아무 가격도 못 받은 날(min=null)도
  // 점으로 남는다 — "그날 얼마였는지 모른다"와 "그날 안 봤다"는 다른 이야기다.
  const sortedHistory = [...history]
    .filter((h) => h && h.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const priced = sortedHistory.filter((h) => Number.isFinite(h.min));
  const previous = priced.length > 1 ? priced[priced.length - 2].min : null;
  const latest = priced.length ? priced[priced.length - 1] : null;

  return {
    watch,
    cells,
    departures: [...byDepart.values()],
    history: sortedHistory,
    best,
    latest,
    // 관측이 한 점뿐일 때 0% 변동을 보여 주면 "안정적"으로 오해한다 — null 로 둔다.
    // 비교는 **그날 관측된 최저가끼리** 한다. 격자의 best 는 며칠 전 값일 수 있어
    // 오늘 값처럼 빼면 있지도 않은 하락으로 보인다.
    change: latest && previous ? latest.min - previous : null,
    stats: {
      observed: cells.length,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      median: prices.length
        ? [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)]
        : null,
      bookable: cells.some((o) => o.bookable),
      // 하나라도 참고가가 섞여 있으면 화면이 배지를 낮춰 단다.
      reference: cells.some((o) => !o.bookable),
    },
  };
}

/**
 * 오래 안 본 조합부터 갱신한다 — cron 한 번에 그리드 전체를 돌리면 쿼터가 남지 않는다.
 *
 * 기준은 **"가격을 받은 시각"이 아니라 "조회를 시도한 시각"** 이다. 항공편이 아예
 * 없는 날짜(no_offer)는 관측이 기록되지 않으므로, 관측 시각으로 줄을 세우면 그 조합이
 * 영원히 맨 앞에 남아 매 cron 마다 다시 조회되고 뒤쪽 날짜는 한 번도 못 본다.
 * (실제로 앞 12개가 no_offer 면 그 12개만 무한 반복했다.)
 */
export function pickStaleCombos(combos, checks, limit) {
  const seen = checks instanceof Map ? checks : new Map(Object.entries(checks ?? {}));
  const at = (combo) => seen.get(comboKey(combo))?.at ?? 0;
  return [...combos]
    .sort((a, b) => at(a) - at(b))
    .slice(0, Math.max(0, limit));
}

export const CHECK_STATUSES = ["found", "no_offer", "error"];
