// invest — 토스증권 Open API 조회 전용 대시보드 (1단계).
//
// **이 모듈은 읽기 전용이다.** 주문·정정·취소 엔드포인트를 절대 부르지 않는다.
// 호출 가능한 경로는 READ_ONLY_PATHS 화이트리스트로 못박혀 있고, 그 밖의 경로는
// tossFetch가 던진다. 주문 기능을 붙이려면 화이트리스트를 늘리는 게 아니라
// 별도 모듈 + 별도 검토를 거쳐야 한다 (invest/README.md의 단계 계획 참고).
//
// 이 파일은 두 곳에서 돌아간다:
//  · 위쪽(토스 조회) — 집 PC 데몬 `_src/invest-sink/`. 토스가 콘솔에 등록한 IP
//    에서만 받아주는데 Workers 는 나가는 IP 가 고정이 아니라 등록이 불가능하다.
//  · 아래쪽(InvestDO) — 엣지. 데몬이 올린 스냅샷을 보관하고 화면에 돌려준다.
//    **엣지에는 API 키가 아예 없다.**
//
// 공식 스펙 (openapi.tossinvest.com, OpenAPI v1.0.3):
//  · 인증: OAuth2 client_credentials — POST /oauth2/token
//          → access_token, expires_in 86400, refresh token 없음.
//          **client 당 유효 토큰이 1개**라 발급을 한 곳에 모아야 한다.
//  · 계좌·자산 API 는 Authorization: Bearer 외에 X-Tossinvest-Account 헤더 필수.
//  · 응답은 {"result": …} 봉투로 감싸여 온다.
//  · rate limit 이 빡빡하다 — ACCOUNT 그룹 초당 1회, ASSET 초당 5회.

export const TOSS_BASE = "https://openapi.tossinvest.com";

// 부를 수 있는 경로. 조회 4종이 전부다 — 주문 계열은 의도적으로 없다.
// /stocks 는 종목 기본정보(종목유형)만 본다. 계좌와 무관해서 계좌 헤더도 없다.
export const READ_ONLY_PATHS = new Set([
  "/api/v1/accounts",
  "/api/v1/holdings",
  "/api/v1/buying-power",
  "/api/v1/stocks",
]);

// 토큰 만료 60초 전에 미리 새로 받는다 (공식 CLI와 같은 skew).
const TOKEN_SKEW_MS = 60 * 1000;
// 이 시간이 지나도록 새 스냅샷이 안 올라오면 화면에 "갱신이 멈췄다"고 알린다.
// 데몬은 하루 한 번 도는 것이 기본이라 하루로는 부족하고, 이틀이면 확실히 이상하다.
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
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

/* ── 그룹 ──────────────────────────────────────────────────────────────
 *
 * 토스 앱에서 나눠 둔 종목 그룹은 **Open API 로 내려오지 않는다** (스펙 v1.2.13
 * 전체에 group/folder/portfolio 필드가 없고, 계좌도 종합매매 하나만 반환된다).
 * 그래서 그룹은 우리가 정한다 — 수동 지정이 있으면 그것, 없으면 종목 기본정보
 * (/api/v1/stocks 의 securityType) 로 자동 분류한다.
 */

/** 그룹 라벨 길이 상한. 저장·표시가 같은 값을 쓴다. */
export const MAX_GROUP_LABEL = 24;
const DEFAULT_GROUP = "기타";

const COUNTRY_LABEL = { KR: "국내", US: "미국" };
const TYPE_LABEL = {
  STOCK: "주식", FOREIGN_STOCK: "주식", ETF: "ETF", FOREIGN_ETF: "ETF",
  ETN: "ETN", REIT: "리츠", INFRASTRUCTURE_FUND: "인프라펀드",
  DEPOSITARY_RECEIPT: "DR", STOCK_WARRANTS: "신주인수권",
};

/**
 * 자동 분류 라벨. 나라(보유 종목이 늘 알려준다) + 종목유형(기본정보가 있을 때만).
 * 기본정보 조회가 실패하면 **아는 만큼만** 쓴다 — ETF를 주식이라고 우기지 않는다.
 */
export function autoGroupLabel(position, info) {
  const country = COUNTRY_LABEL[position?.market] ?? "";
  const type = TYPE_LABEL[info?.securityType] ?? "";
  return [country, type].filter(Boolean).join(" ") || DEFAULT_GROUP;
}

/**
 * 수동 그룹 매핑 파싱. `그룹 2:TSLA,NVDA;그룹 1:*` 형식이고 `*` 는 나머지 전부.
 * 코드가 아니라 데몬 환경변수(INVEST_GROUPS)로 들어온다 — 그래야 그룹을 바꿀 때
 * 재배포가 필요 없다.
 */
export function parseGroupMap(spec) {
  const bySymbol = new Map();
  let fallback = null;

  for (const chunk of String(spec ?? "").split(";")) {
    const at = chunk.indexOf(":");
    if (at < 0) continue;
    const label = chunk.slice(0, at).trim().slice(0, MAX_GROUP_LABEL);
    const symbols = chunk.slice(at + 1).split(",").map((s) => s.trim()).filter(Boolean);
    if (!label || !symbols.length) continue;
    for (const symbol of symbols) {
      if (symbol === "*") fallback = label;
      else bySymbol.set(symbol.toUpperCase(), label);
    }
  }
  return { bySymbol, fallback };
}

/** 종목 하나의 그룹. 수동 지정 > 수동 기본값(`*`) > 자동 분류 순. */
export function groupOf(position, info, map) {
  const manual = map?.bySymbol?.get(String(position?.symbol ?? "").toUpperCase());
  if (manual) return manual;
  if (map?.fallback) return map.fallback;
  return autoGroupLabel(position, info);
}

/** 예수금이 들어갈 그룹. 따로 지정이 없으면 `*`(나머지) 그룹으로 보낸다. */
export function cashGroupOf(map, override) {
  return String(override || map?.fallback || DEFAULT_GROUP).trim().slice(0, MAX_GROUP_LABEL);
}

const emptyBucket = () => ({ value: 0, cost: 0, pnl: 0, rate: 0, cash: 0 });

/**
 * 그룹별 합계. **그룹 안에서도 통화를 섞지 않는다** — byCurrency 와 같은 이유로
 * KRW 와 USD 를 더한 금액은 뜻이 없다. 그래서 group → currency → 합계 2단이다.
 *
 * 예수금은 `cash` 로 **따로** 담고 value·cost·pnl 에 섞지 않는다. 섞으면
 * 원가가 없는 돈이 평가금액에 얹혀 `value = cost + pnl` 이 깨지고, 수익률이
 * 현금 비중에 따라 희석된다. 그래서 수익률은 끝까지 보유분 기준이다.
 */
export function aggregateGroups(positions, { cash, cashGroup } = {}) {
  const byGroup = {};

  for (const position of Array.isArray(positions) ? positions : []) {
    const group = String(position?.group || DEFAULT_GROUP).slice(0, MAX_GROUP_LABEL);
    const currency = position?.currency || "KRW";
    const bucket = ((byGroup[group] ??= {})[currency] ??= emptyBucket());
    bucket.value += position?.value ?? 0;
    bucket.cost += position?.cost ?? 0;
    bucket.pnl += position?.pnl ?? 0;
  }

  // 예수금만 있고 보유 종목이 없는 그룹도 나와야 한다 — 그 돈이 안 보이면
  // 화면에서 통째로 사라진다(실제로 KRW 예수금이 그렇게 숨었다).
  const target = String(cashGroup || DEFAULT_GROUP).slice(0, MAX_GROUP_LABEL);
  for (const [currency, amount] of Object.entries(cash ?? {})) {
    if (!Number.isFinite(amount) || amount === 0) continue;
    ((byGroup[target] ??= {})[currency] ??= emptyBucket()).cash += amount;
  }

  for (const byCurrency of Object.values(byGroup)) {
    for (const bucket of Object.values(byCurrency)) {
      bucket.rate = bucket.cost > 0 ? bucket.pnl / bucket.cost : 0;
    }
  }
  return byGroup;
}

/** 화면·그래프가 쓰는 스냅샷 한 장. 종목 단위는 빼고 합계만 남긴다. */
export function snapshotOf(aggregate, cash, at = Date.now(), byGroup = {}) {
  return {
    date: kstDate(at),
    ts: at,
    byCurrency: aggregate.byCurrency,
    byGroup,
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

/**
 * 그룹별 시계열. 그룹 → 통화 → 점 배열 (합계와 같은 이유로 통화를 섞지 않는다).
 *
 * 그룹을 나중에 넣으면 지난 날짜는 되살릴 수 없다 — 일별 스냅샷은 종목 단위를
 * 버리고 합계만 남기기 때문이다. 그래서 byGroup 이 없던 날의 점은 그냥 없다.
 */
export function buildGroupSeries(history) {
  const series = {};
  for (const snap of Array.isArray(history) ? history : []) {
    for (const [group, byCurrency] of Object.entries(snap?.byGroup ?? {})) {
      for (const [currency, bucket] of Object.entries(byCurrency ?? {})) {
        ((series[group] ??= {})[currency] ??= []).push({
          date: snap.date,
          rate: bucket.rate ?? 0,
          value: bucket.value ?? 0,
          pnl: bucket.pnl ?? 0,
        });
      }
    }
  }
  for (const byCurrency of Object.values(series)) {
    for (const points of Object.values(byCurrency)) points.sort((a, b) => a.date.localeCompare(b.date));
  }
  return series;
}

// IP 가 거부됐다고 **단정할 수 있는** 문구만 여기서 잡는다. 본문에 ip 라는
// 단어가 있다는 것만으로 단정하면 안 된다 — 토스의 unidentified-client 응답은
// "액세스 토큰 또는 IP를 확인해 주세요"처럼 두 원인을 함께 말하므로, 키가 틀린
// 경우까지 IP 문제로 오진하게 된다(실제로 그렇게 오진한 적이 있다).
const IP_DENIED = /(not\s+allowed\s+ip|ip\s+not\s+allowed|허용되지\s*않은\s*ip)/i;
// 토스가 클라이언트를 식별하지 못했을 때 쓰는 코드. 키·IP 어느 쪽이든 날 수 있다.
const UNIDENTIFIED = /unidentified-client/i;

/**
 * 토스 오류 응답을 화면에 보여줄 짧은 문구로 바꾼다.
 * body 는 분류에만 쓰고 안내 문구에 원문을 섞지 않는다 (원문은 detail 로 따로 간다).
 *
 * **원인을 모를 때 아는 척하지 않는다** — 좁힐 수 없으면 후보를 둘 다 적는다.
 */
export function describeUpstreamError(status, body = "") {
  const text = String(body);
  if (IP_DENIED.test(text)) return "토스가 이 서버의 IP를 거부했습니다 — 허용 IP 설정 문제입니다";
  if (UNIDENTIFIED.test(text)) {
    return "토스가 클라이언트를 식별하지 못했습니다 — API 키가 틀렸거나 허용 IP가 아닙니다";
  }
  if (status === 401) return "토스 인증 실패 — API 키를 확인해주세요";
  if (status === 403) return "토스 권한 없음 — 앱 승인 상태와 조회 권한을 확인해주세요";
  if (status === 429) return "토스 요청 한도 초과 — 잠시 후 다시 시도합니다";
  if (status >= 500) return "토스 서버 오류";
  return "토스 응답 오류";
}

/**
 * 어느 단계에서 깨졌는지까지 담은 오류. 토큰 발급이 막힌 것과 조회 권한이 없는
 * 것은 원인도 대처도 달라서, 한 문구로 뭉뚱그리면 진단이 안 된다.
 */
export function upstreamError(status, body, stage) {
  const error = new Error(`${stage}: ${describeUpstreamError(status, body)} (HTTP ${status})`);
  error.status = status;
  // 원문은 서버 로그(wrangler tail)에만 쓰고 화면에는 내보내지 않는다. 화면 문구는
  // 본문에 "ip"가 있는지 보는 휴리스틱이라, 판정이 맞는지 확인할 근거가 필요하다.
  error.body = body;
  return error;
}

/** 분류에 쓸 만큼만 본문을 읽는다. 읽기 실패는 무시한다(원 오류가 더 중요하다). */
async function errorBody(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
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
  if (!response.ok) throw upstreamError(response.status, await errorBody(response), "잔고 조회");
  const body = await response.json();
  // 공식 API 는 {"result": …} 봉투를 쓴다. 봉투가 없으면 스펙이 바뀐 것이다.
  if (!body || !("result" in body)) throw new Error("토스 응답 형식이 예상과 다릅니다");
  return body.result;
}

// OAuth2 는 클라이언트 인증 방식이 두 가지다(RFC 6749 §2.3).
//  · basic — Authorization: Basic base64(id:secret) 헤더. 스펙의 기본값이다.
//  · post  — client_id·client_secret 을 폼 본문에 담는다. 선택 사항이다.
// 토스가 401 에 `WWW-Authenticate: Basic realm="openapi"` 를 실어 보내는 것으로
// 보아 basic 을 기대한다. 다만 문서를 직접 확인할 수 없어 단정하지 않고,
// basic 을 먼저 시도한 뒤 실패하면 post 로 한 번 더 시도한다(성공한 쪽을 기억).
// **두 방식을 한 요청에 같이 쓰면 안 된다** — 스펙이 금지하고, 거부하는 서버가 있다.
export const TOKEN_AUTH_METHODS = ["basic", "post"];

/** UTF-8 안전 base64 (btoa 는 latin1 만 받는다). */
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes));
}

export function basicAuthHeader(clientId, clientSecret) {
  return `Basic ${base64(`${clientId}:${clientSecret}`)}`;
}

/** 토큰 발급 요청의 헤더·본문. 방식(basic|post)에 따라 자격증명 위치가 달라진다. */
export function tokenRequest(clientId, clientSecret, method = "basic") {
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };

  if (method === "basic") {
    headers.Authorization = basicAuthHeader(clientId, clientSecret);
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }
  return { headers, body };
}

/* ── 토스 조회 (집 PC 데몬에서 실행된다) ─────────────────────────────────
 *
 * 토스 Open API 는 콘솔에 등록한 IP 에서만 받아준다. Cloudflare Workers 는
 * 요청마다 다른 엣지에서 나가고 그 대역이 수천 개라 등록이 불가능하다 —
 * 그래서 **토스를 부르는 쪽은 엣지가 아니라 고정 IP 를 가진 내 PC** 다.
 * 여기 함수들은 `_src/invest-sink/` 데몬이 가져다 쓴다(엣지에서는 실행되지 않음).
 * 조회 전용 보증(READ_ONLY_PATHS)은 그대로 이 모듈 안에 남아 있다.
 */

/** 토큰 캐시 어댑터의 기본값 — 프로세스가 사는 동안만 기억한다. */
export function memoryTokenCache() {
  let held = null;
  return { read: () => held, write: (value) => { held = value; } };
}

/**
 * 액세스 토큰을 받아온다. 캐시가 살아 있으면 그대로 쓰고, force 면 새로 받는다.
 *
 * 토스는 client 당 유효 토큰이 1개라, 다른 곳에서 같은 키로 발급하면 이 토큰이
 * 즉시 무효가 된다. 그래서 401 을 만나면 만료 전이라도 다시 받아야 한다.
 *
 * 클라이언트 인증 방식(basic/post)은 문서로 확정할 수 없어 자동 판별한다 —
 * 통한 방식을 캐시에 적어 두고 다음부터 먼저 쓴다.
 */
export async function issueToken({ clientId, clientSecret, cache = memoryTokenCache(), force = false, fetchImpl = fetch }) {
  const held = force ? null : cache.read();
  if (held?.value && held.expiresAt - TOKEN_SKEW_MS > Date.now()) return held.value;

  const id = String(clientId ?? "").trim();
  const secret = String(clientSecret ?? "").trim();
  if (!id || !secret) throw new Error("토스 API 키가 설정되지 않았습니다");

  const known = held?.method ?? cache.read()?.method ?? null;
  const order = known
    ? [known, ...TOKEN_AUTH_METHODS.filter((method) => method !== known)]
    : TOKEN_AUTH_METHODS;

  let last = null;
  for (const method of order) {
    const { headers, body } = tokenRequest(id, secret, method);
    const response = await fetchImpl(`${TOSS_BASE}/oauth2/token`, {
      method: "POST", headers, body: body.toString(),
    });
    if (response.ok) {
      const payload = await response.json();
      const value = payload?.access_token;
      if (!value) throw new Error("토스가 액세스 토큰을 주지 않았습니다");
      const expiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 86400) * 1000;
      cache.write({ value, expiresAt, method });
      return value;
    }
    const failure = upstreamError(response.status, await errorBody(response), "토큰 발급");
    // 자격증명을 못 알아본 경우에만 다른 방식을 시도할 값어치가 있다.
    if (failure.status !== 401 && failure.status !== 400) throw failure;
    last = failure;
  }
  throw last;
}

/** X-Tossinvest-Account 값. 미리 알고 있으면 계좌 목록 조회(초당 1회)를 아낀다. */
export async function resolveAccountSeq({ token, configured, fetchImpl = fetch }) {
  const given = Number(configured);
  if (Number.isFinite(given) && given > 0) return given;

  const accounts = await tossFetch("/api/v1/accounts", { token, fetchImpl });
  const seq = Array.isArray(accounts) ? accounts[0]?.accountSeq : null;
  if (!seq) throw new Error("조회할 계좌를 찾지 못했습니다");
  return seq;
}

/**
 * 보유 종목의 기본정보(종목유형 등)를 한 번에 받는다. 계좌 헤더가 필요 없는 조회다.
 * **실패해도 던지지 않는다** — 분류가 안 되는 것보다 잔고가 안 올라가는 게 더 나쁘다.
 * 빈 맵이면 그룹 라벨이 나라까지만 붙는다.
 */
export async function stockInfoOf(positions, { token, fetchImpl = fetch } = {}) {
  const symbols = [...new Set((positions ?? []).map((p) => p?.symbol).filter(Boolean))];
  if (!symbols.length) return new Map();
  try {
    // 다건 조회 상한이 200개다. 보유 종목이 그보다 많을 일은 없지만 잘라서 보낸다.
    const rows = await tossFetch("/api/v1/stocks", {
      token, query: { symbols: symbols.slice(0, 200).join(",") }, fetchImpl,
    });
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.symbol, row]));
  } catch {
    return new Map();
  }
}

/**
 * 잔고 한 장을 읽어 스냅샷으로 만든다. 엣지로 올릴 최종 형태를 그대로 돌려준다.
 * 401 을 만나면 토큰을 새로 받아 한 번만 재시도한다.
 */
export async function fetchSnapshot({ clientId, clientSecret, accountSeq, groups, cashGroup, cache = memoryTokenCache(), fetchImpl = fetch, at = Date.now() }) {
  const groupMap = groups && groups.bySymbol ? groups : parseGroupMap(groups);
  const cashTarget = cashGroupOf(groupMap, cashGroup);

  const collect = async (token) => {
    const seq = await resolveAccountSeq({ token, configured: accountSeq, fetchImpl });
    const overview = await tossFetch("/api/v1/holdings", { token, accountSeq: seq, fetchImpl });
    const aggregate = aggregateHoldings(overview?.items);

    // 그룹을 붙인다. 토스는 앱의 종목 그룹을 주지 않으므로 우리가 정한다.
    const info = await stockInfoOf(aggregate.positions, { token, fetchImpl });
    for (const position of aggregate.positions) {
      position.group = groupOf(position, info.get(position.symbol), groupMap);
    }

    // 예수금은 통화별로 따로 조회한다. ACCOUNT 그룹(초당 1회)이라 순차 호출하고,
    // 실패해도 보유종목은 살려야 하므로 통화 단위로 조용히 건너뛴다.
    const cash = {};
    for (const currency of ["KRW", "USD"]) {
      try {
        const power = await tossFetch("/api/v1/buying-power", {
          token, accountSeq: seq, query: { currency }, fetchImpl,
        });
        cash[currency] = parseDecimal(power?.cashBuyingPower);
      } catch { /* 예수금 실패는 치명적이지 않다 — 그 통화만 비운다 */ }
    }
    const byGroup = aggregateGroups(aggregate.positions, { cash, cashGroup: cashTarget });
    // 화면이 처음 여는 그룹. `*`(나머지) 그룹을 메인으로 삼는다 — 분류하지 않은
    // 종목과 예수금이 모이는 곳이라 "내 기본 자산" 에 해당한다.
    return {
      ...snapshotOf(aggregate, cash, at, byGroup),
      mainGroup: cashTarget,
      positions: aggregate.positions,
    };
  };

  try {
    return await collect(await issueToken({ clientId, clientSecret, cache, fetchImpl }));
  } catch (error) {
    if (error.status !== 401) throw error;
    return collect(await issueToken({ clientId, clientSecret, cache, force: true, fetchImpl }));
  }
}

/* ── 엣지 (Durable Object) ─────────────────────────────────────────────── */

/** 숫자만 남긴다. 유한한 수가 아니면 버린다 (NaN·Infinity가 그래프를 깬다). */
function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 데몬이 올린 스냅샷을 검증해 저장 가능한 형태로 만든다.
 * 바깥에서 들어오는 값이므로 형태를 통과시키지 말고 **다시 지어서** 쓴다.
 * 형태가 어긋나면 null — 호출부가 400으로 돌려준다.
 */
export function normalizeSnapshot(payload, at = Date.now()) {
  if (!payload || typeof payload !== "object") return null;

  const byCurrency = {};
  for (const [currency, bucket] of Object.entries(payload.byCurrency ?? {})) {
    if (!/^[A-Z]{3}$/.test(currency) || !bucket || typeof bucket !== "object") return null;
    const value = finiteNumber(bucket.value);
    const cost = finiteNumber(bucket.cost);
    const pnl = finiteNumber(bucket.pnl);
    const rate = finiteNumber(bucket.rate);
    if (value === null || cost === null || pnl === null || rate === null) return null;
    byCurrency[currency] = { value, cost, pnl, rate };
  }

  // 그룹 합계. 라벨은 데몬이 정한 임의 문자열이라 길이를 자르고, 안쪽 숫자는
  // byCurrency 와 같은 엄격도로 다시 짓는다.
  const byGroup = {};
  for (const [group, byCurrency] of Object.entries(payload.byGroup ?? {})) {
    if (!group || !byCurrency || typeof byCurrency !== "object") return null;
    const bucketed = {};
    for (const [currency, bucket] of Object.entries(byCurrency)) {
      if (!/^[A-Z]{3}$/.test(currency) || !bucket || typeof bucket !== "object") return null;
      const value = finiteNumber(bucket.value);
      const cost = finiteNumber(bucket.cost);
      const pnl = finiteNumber(bucket.pnl);
      const rate = finiteNumber(bucket.rate);
      if (value === null || cost === null || pnl === null || rate === null) return null;
      // 예수금은 그룹을 나중에 붙인 필드라, 없던 시절 스냅샷도 통과해야 한다.
      bucketed[currency] = { value, cost, pnl, rate, cash: finiteNumber(bucket.cash) ?? 0 };
    }
    byGroup[group.slice(0, MAX_GROUP_LABEL)] = bucketed;
  }

  const cash = {};
  for (const [currency, amount] of Object.entries(payload.cash ?? {})) {
    if (!/^[A-Z]{3}$/.test(currency)) return null;
    const parsed = finiteNumber(amount);
    if (parsed === null) return null;
    cash[currency] = parsed;
  }

  if (!Array.isArray(payload.positions)) return null;
  const positions = payload.positions.map((item) => ({
    symbol: String(item?.symbol ?? "").slice(0, 32),
    name: String(item?.name ?? "").slice(0, 64),
    market: String(item?.market ?? "").slice(0, 8),
    group: String(item?.group ?? "").slice(0, MAX_GROUP_LABEL),
    currency: String(item?.currency ?? "").slice(0, 8),
    quantity: finiteNumber(item?.quantity) ?? 0,
    lastPrice: finiteNumber(item?.lastPrice) ?? 0,
    avgPrice: finiteNumber(item?.avgPrice) ?? 0,
    value: finiteNumber(item?.value) ?? 0,
    cost: finiteNumber(item?.cost) ?? 0,
    pnl: finiteNumber(item?.pnl) ?? 0,
    rate: finiteNumber(item?.rate) ?? 0,
    dailyPnl: finiteNumber(item?.dailyPnl) ?? 0,
    dailyRate: finiteNumber(item?.dailyRate) ?? 0,
  }));

  // 날짜는 데몬을 믿지 않고 받은 시각(KST)으로 다시 찍는다 — 시계가 어긋난 PC가
  // 미래 날짜를 올리면 그래프가 영영 이상해진다.
  const mainGroup = String(payload.mainGroup ?? "").slice(0, MAX_GROUP_LABEL);
  return { date: kstDate(at), ts: at, byCurrency, byGroup, cash, positions, mainGroup };
}

/**
 * 잔고·수익률 대시보드의 저장소.
 *
 * **토스를 직접 부르지 않는다** — 허용 IP 때문에 조회는 집 PC 데몬이 하고, 여기는
 * 데몬이 올린 스냅샷을 받아 두었다가 화면에 돌려준다. 그 덕분에 API 키가 엣지에는
 * 아예 존재하지 않는다.
 *
 * 저장하는 것: 마지막 스냅샷(latest), 일별 스냅샷(snap:YYYY-MM-DD).
 */
export class InvestDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /** 하루 한 장씩 남긴다. 같은 날 다시 올라오면 그날 값을 덮어쓴다. */
  async #record(snapshot) {
    // positions 는 부피 때문에, mainGroup 은 이력이 아니라 설정값이라 뺀다.
    const { positions, mainGroup, ...daily } = snapshot;
    await this.state.storage.put(`snap:${snapshot.date}`, daily);
    const stored = await this.state.storage.list({ prefix: "snap:" });
    if (stored.size <= MAX_SNAPSHOTS) return;
    const keys = [...stored.keys()].sort();
    await this.state.storage.delete(keys.slice(0, stored.size - MAX_SNAPSHOTS));
  }

  async #history() {
    const stored = await this.state.storage.list({ prefix: "snap:" });
    return [...stored.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  async #state() {
    const latest = await this.state.storage.get("latest");
    const age = latest ? Date.now() - latest.ts : null;
    const history = await this.#history();
    return {
      updatedAt: latest?.ts ?? null,
      byCurrency: latest?.byCurrency ?? {},
      byGroup: latest?.byGroup ?? {},
      mainGroup: latest?.mainGroup ?? "",
      cash: latest?.cash ?? {},
      positions: latest?.positions ?? [],
      series: buildSeries(history),
      groupSeries: buildGroupSeries(history),
      // 데몬이 멈춘 것을 화면이 알아야 한다 — 숫자는 있는데 어제 것일 수 있다.
      stale: age !== null && age > STALE_AFTER_MS,
      error: latest ? null : "아직 올라온 잔고가 없습니다 — PC 데몬이 도는지 확인해주세요",
      detail: null,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/state" && request.method === "GET") {
      return Response.json(await this.#state());
    }

    if (url.pathname === "/push" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      const snapshot = normalizeSnapshot(payload);
      if (!snapshot) return Response.json({ error: "invalid snapshot" }, { status: 400 });
      await this.state.storage.put("latest", snapshot);
      await this.#record(snapshot);
      return Response.json({ ok: true, date: snapshot.date });
    }

    return new Response("not found", { status: 404 });
  }
}
