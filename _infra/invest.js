// invest — 토스증권 Open API 조회 전용 대시보드 (1단계).
//
// **이 모듈은 읽기 전용이다.** 주문·정정·취소 엔드포인트를 절대 부르지 않는다.
// 호출 가능한 경로는 READ_ONLY_PATHS 화이트리스트로 못박혀 있고, 그 밖의 경로는
// tossFetch가 던진다. 주문 기능을 붙이려면 화이트리스트를 늘리는 게 아니라
// 별도 모듈 + 별도 검토를 거쳐야 한다 (invest/README.md의 단계 계획 참고).
//
// 공식 스펙 (openapi.tossinvest.com, OpenAPI v1.0.3):
//  · 인증: OAuth2 client_credentials — POST /oauth2/token (form-urlencoded)
//          → access_token, expires_in 86400, refresh token 없음.
//          **client 당 유효 토큰이 1개**라 발급을 한 곳(이 DO)에 모아야 한다.
//  · 계좌·자산 API 는 Authorization: Bearer 외에 X-Tossinvest-Account 헤더 필수.
//  · 응답은 {"result": …} 봉투로 감싸여 온다.
//  · rate limit 이 빡빡하다 — ACCOUNT 그룹 초당 1회, ASSET 초당 5회.
//    그래서 상류 호출은 REFRESH_MIN_MS 간격으로만 하고 나머지는 캐시로 답한다.

export const TOSS_BASE = "https://openapi.tossinvest.com";

// 부를 수 있는 경로. 조회 3종이 전부다 — 주문 계열은 의도적으로 없다.
export const READ_ONLY_PATHS = new Set([
  "/api/v1/accounts",
  "/api/v1/holdings",
  "/api/v1/buying-power",
]);

// 토큰 만료 60초 전에 미리 새로 받는다 (공식 CLI와 같은 skew).
const TOKEN_SKEW_MS = 60 * 1000;
// 상류 재조회 최소 간격. 새로고침을 연타해도 토스 한도를 건드리지 않는다.
export const REFRESH_MIN_MS = 30 * 1000;
// 보관할 일별 스냅샷 개수 (약 3년치 영업일).
export const MAX_SNAPSHOTS = 800;

/** 소수 문자열 → 숫자. 파싱 불가·누락이면 0. */
export function parseDecimal(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** KST 기준 YYYY-MM-DD. 스냅샷은 한국 시간 하루에 하나다. */
export function kstDate(at = Date.now()) {
  return new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 보유종목 목록을 통화별로 합산한다.
 *
 * 통화가 다른 금액을 그냥 더하면 틀리므로 **환산하지 않고 통화별로 나눠서**
 * 집계한다(1단계는 환율 엔드포인트를 쓰지 않는다). 수익률은 단위가 없는
 * 비율이라 통화가 달라도 같은 축에 그릴 수 있다.
 *
 * 수익률 = 평가손익 / 매입원가. 입출금은 원가에 반영되므로 이 값은
 * 보유분 기준 누적 수익률이고, 입출금 타이밍을 반영하는 금액가중수익률(MWR)과는
 * 다르다 — 자세한 한계는 invest/README.md.
 */
export function aggregateHoldings(items) {
  const byCurrency = {};
  const positions = [];

  for (const item of Array.isArray(items) ? items : []) {
    const currency = typeof item?.currency === "string" ? item.currency : "KRW";
    const value = parseDecimal(item?.marketValue?.amount);
    const cost = parseDecimal(item?.marketValue?.purchaseAmount);
    const pnl = parseDecimal(item?.profitLoss?.amount);

    const bucket = byCurrency[currency] ??= { value: 0, cost: 0, pnl: 0, rate: 0 };
    bucket.value += value;
    bucket.cost += cost;
    bucket.pnl += pnl;

    positions.push({
      symbol: String(item?.symbol ?? ""),
      name: String(item?.name ?? ""),
      market: String(item?.marketCountry ?? ""),
      currency,
      quantity: parseDecimal(item?.quantity),
      lastPrice: parseDecimal(item?.lastPrice),
      avgPrice: parseDecimal(item?.averagePurchasePrice),
      value,
      cost,
      pnl,
      rate: parseDecimal(item?.profitLoss?.rate),
      dailyPnl: parseDecimal(item?.dailyProfitLoss?.amount),
      dailyRate: parseDecimal(item?.dailyProfitLoss?.rate),
    });
  }

  // 원가가 0이면 수익률이 정의되지 않는다 (전량 매도 후 잔량 0 등) — 0으로 둔다.
  for (const bucket of Object.values(byCurrency)) {
    bucket.rate = bucket.cost > 0 ? bucket.pnl / bucket.cost : 0;
  }
  // 평가금액 큰 순으로 — 화면에서 비중 큰 종목이 위로 온다.
  positions.sort((a, b) => b.value - a.value);
  return { byCurrency, positions };
}

/** 화면·그래프가 쓰는 스냅샷 한 장. 종목 단위는 빼고 합계만 남긴다. */
export function snapshotOf(aggregate, cash, at = Date.now()) {
  return {
    date: kstDate(at),
    ts: at,
    byCurrency: aggregate.byCurrency,
    cash: cash ?? {},
  };
}

/** 그래프용 시계열. 통화별로 (날짜, 수익률, 평가금액) 배열을 만든다. */
export function buildSeries(history) {
  const series = {};
  for (const snap of Array.isArray(history) ? history : []) {
    for (const [currency, bucket] of Object.entries(snap?.byCurrency ?? {})) {
      (series[currency] ??= []).push({
        date: snap.date,
        rate: bucket.rate ?? 0,
        value: bucket.value ?? 0,
        pnl: bucket.pnl ?? 0,
      });
    }
  }
  for (const points of Object.values(series)) points.sort((a, b) => a.date.localeCompare(b.date));
  return series;
}

/** 토스 오류 응답을 화면에 보여줄 짧은 문구로 바꾼다. 키·토큰은 절대 싣지 않는다. */
export function describeUpstreamError(status) {
  if (status === 401 || status === 403) return "토스 인증 실패 — API 키를 확인해주세요";
  if (status === 429) return "토스 요청 한도 초과 — 잠시 후 다시 시도합니다";
  if (status >= 500) return "토스 서버 오류";
  return `토스 응답 오류 (${status})`;
}

/**
 * 조회 전용 GET. READ_ONLY_PATHS 밖의 경로는 부르지 않는다.
 * 이 함수 밖에서 토스 API 를 직접 fetch 하지 말 것 — 이 화이트리스트가 무의미해진다.
 */
export async function tossFetch(path, { token, query, accountSeq, base = TOSS_BASE, fetchImpl = fetch } = {}) {
  if (!READ_ONLY_PATHS.has(path)) {
    throw new Error(`invest is read-only: ${path} is not an allowed endpoint`);
  }
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (accountSeq !== undefined && accountSeq !== null) {
    headers["X-Tossinvest-Account"] = String(accountSeq);
  }
  const response = await fetchImpl(url, { method: "GET", headers });
  if (!response.ok) {
    const error = new Error(describeUpstreamError(response.status));
    error.status = response.status;
    throw error;
  }
  const body = await response.json();
  // 공식 API 는 {"result": …} 봉투를 쓴다. 봉투가 없으면 스펙이 바뀐 것이다.
  if (!body || !("result" in body)) throw new Error("토스 응답 형식이 예상과 다릅니다");
  return body.result;
}

/** 토큰 발급 요청 본문. client_credentials 그랜트, form-urlencoded. */
export function tokenRequestBody(clientId, clientSecret) {
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  return form;
}

/**
 * 잔고·수익률 대시보드의 서버.
 *
 * 단일 인스턴스(idFromName("main"))다 — 토스가 client 당 토큰 1개만 허용하므로
 * 발급·캐시를 여기 한 곳에 모아야 서로 토큰을 무효화하지 않는다.
 *
 * 저장하는 것: 액세스 토큰(만료시각 포함), accountSeq, 마지막 조회 결과,
 * 일별 스냅샷(snap:YYYY-MM-DD). API 키 자체는 저장하지 않고 매번 env 에서 읽는다.
 */
export class InvestDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /**
   * 액세스 토큰. force 면 캐시를 버리고 새로 받는다.
   *
   * 토스는 client 당 유효 토큰을 1개만 두므로, **다른 곳에서 같은 키로 토큰을
   * 발급하면 여기 캐시된 토큰이 그 순간 무효가 된다**(터미널에서 curl 로 한 번
   * 받아보는 것만으로도 그렇게 된다). 그래서 401 을 만나면 만료 전이라도
   * 캐시를 버리고 다시 받아야 한다 — 안 그러면 24시간 내내 401 이다.
   */
  async #token({ force = false } = {}) {
    const cached = force ? null : await this.state.storage.get("token");
    if (cached && cached.expiresAt - TOKEN_SKEW_MS > Date.now()) return cached.value;

    const { INVEST_CLIENT_ID, INVEST_CLIENT_SECRET } = this.env;
    if (!INVEST_CLIENT_ID || !INVEST_CLIENT_SECRET) throw new Error("토스 API 키가 설정되지 않았습니다");

    const response = await fetch(`${TOSS_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequestBody(INVEST_CLIENT_ID, INVEST_CLIENT_SECRET).toString(),
    });
    if (!response.ok) {
      const error = new Error(describeUpstreamError(response.status));
      error.status = response.status;
      throw error;
    }
    const body = await response.json();
    const value = body?.access_token;
    if (!value) throw new Error("토스가 액세스 토큰을 주지 않았습니다");
    const expiresAt = Date.now() + Math.max(60, Number(body.expires_in) || 86400) * 1000;
    await this.state.storage.put("token", { value, expiresAt });
    return value;
  }

  /** X-Tossinvest-Account 값. secret 으로 고정해두면 ACCOUNT 그룹 호출을 아낀다. */
  async #accountSeq(token) {
    const configured = Number(this.env.INVEST_ACCOUNT_SEQ);
    if (Number.isFinite(configured) && configured > 0) return configured;

    const cached = await this.state.storage.get("accountSeq");
    if (cached) return cached;

    const accounts = await tossFetch("/api/v1/accounts", { token });
    const seq = Array.isArray(accounts) ? accounts[0]?.accountSeq : null;
    if (!seq) throw new Error("조회할 계좌를 찾지 못했습니다");
    await this.state.storage.put("accountSeq", seq);
    return seq;
  }

  /**
   * 상류에서 잔고를 새로 읽어 캐시·스냅샷을 갱신한다.
   * 토큰이 무효화된 경우(401)에 한해 새 토큰으로 딱 한 번 다시 시도한다.
   */
  async #refresh() {
    try {
      return await this.#collect(await this.#token());
    } catch (error) {
      if (error.status !== 401) throw error;
      return this.#collect(await this.#token({ force: true }));
    }
  }

  async #collect(token) {
    const accountSeq = await this.#accountSeq(token);

    const overview = await tossFetch("/api/v1/holdings", { token, accountSeq });
    const aggregate = aggregateHoldings(overview?.items);

    // 예수금은 통화별로 따로 조회한다. ACCOUNT 그룹(초당 1회)이라 순차 호출하고,
    // 실패해도 보유종목 화면은 살려야 하므로 통화 단위로 조용히 건너뛴다.
    const cash = {};
    for (const currency of ["KRW", "USD"]) {
      try {
        const power = await tossFetch("/api/v1/buying-power", { token, accountSeq, query: { currency } });
        cash[currency] = parseDecimal(power?.cashBuyingPower);
      } catch { /* 예수금 조회 실패는 치명적이지 않다 — 그 통화만 비운다 */ }
    }

    const snapshot = snapshotOf(aggregate, cash);
    await this.state.storage.put("latest", { ...snapshot, positions: aggregate.positions });
    await this.#record(snapshot);
    return snapshot;
  }

  /** 하루 한 장씩 스냅샷을 남긴다. 같은 날 재조회는 그날 값을 덮어쓴다. */
  async #record(snapshot) {
    await this.state.storage.put(`snap:${snapshot.date}`, snapshot);
    const stored = await this.state.storage.list({ prefix: "snap:" });
    if (stored.size <= MAX_SNAPSHOTS) return;
    const keys = [...stored.keys()].sort();
    await this.state.storage.delete(keys.slice(0, stored.size - MAX_SNAPSHOTS));
  }

  async #history() {
    const stored = await this.state.storage.list({ prefix: "snap:" });
    return [...stored.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  /**
   * 화면에 줄 상태. 캐시가 신선하면 그대로, 아니면 상류를 한 번 친다.
   * 상류가 실패해도 캐시가 있으면 stale 표시를 달아 그걸 돌려준다 — 한도(429)에
   * 걸렸다고 화면이 비면 안 된다.
   */
  async #state({ force = false } = {}) {
    const latest = await this.state.storage.get("latest");
    const fresh = latest && Date.now() - latest.ts < REFRESH_MIN_MS;

    let error = null;
    if (!fresh || force) {
      try {
        await this.#refresh();
      } catch (failure) {
        error = failure.message;
        if (!latest) throw failure;
      }
    }

    const current = await this.state.storage.get("latest");
    return {
      updatedAt: current?.ts ?? null,
      byCurrency: current?.byCurrency ?? {},
      cash: current?.cash ?? {},
      positions: current?.positions ?? [],
      series: buildSeries(await this.#history()),
      stale: !!error,
      error,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/state" && request.method === "GET") {
      try {
        return Response.json(await this.#state({ force: url.searchParams.get("force") === "1" }));
      } catch (error) {
        return Response.json({ error: error.message }, { status: error.status === 429 ? 429 : 502 });
      }
    }

    // cron 이 부르는 일별 스냅샷. 화면 요청과 달리 캐시를 무시하고 꼭 한 번 읽는다.
    if (url.pathname === "/snapshot" && request.method === "POST") {
      try {
        return Response.json(await this.#refresh());
      } catch (error) {
        return Response.json({ error: error.message }, { status: 502 });
      }
    }

    return new Response("not found", { status: 404 });
  }
}
