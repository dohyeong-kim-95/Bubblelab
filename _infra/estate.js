// 국토교통부 아파트 실거래가 공개 API 프록시 (estate.bubblelab.dev 전용).
// data.go.kr은 CORS 헤더를 주지 않아 브라우저가 직접 못 부르므로 Worker가
// 중계한다. 인증키는 MOLIT_SERVICE_KEY secret에서만 읽고 응답에 싣지 않는다.
// 월 단위 데이터는 신고·해제 정정으로 조금씩 바뀌므로 지난달 이전은 하루,
// 최근 두 달은 6시간 동안 Cache API에 캐싱해 일일 호출 한도를 아낀다.
//
// 주의: 국토부 RTMS API는 해외 IP를 차단해 운영 Cloudflare에서는 403이 난다
// (같은 요청이 한국 IP의 로컬 workerd에서는 정상 도달함을 확인). 이 프록시는
// 로컬 개발용이고, 운영 데이터는 estate-import.mjs로 정적 JSON을 커밋한다.

// 법정동코드 앞 5자리 (LAWD_CD). 조회 가능한 지역을 서버가 고정한다.
export const REGIONS = new Map([
  ["hwaseong", { lawd: "41590", label: "화성시" }], // 동탄1·2 포함
  ["giheung", { lawd: "41463", label: "용인시 기흥구" }],
]);

const ENDPOINTS = {
  trade: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  rent: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
};

const PAGE_SIZE = 1500;
const MAX_PAGES = 6;

function tag(xml, name) {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match?.[1]?.trim() ?? "";
}

function num(value) {
  const cleaned = String(value).replace(/[,\s]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

function dealDate(item) {
  const y = tag(item, "dealYear");
  const m = tag(item, "dealMonth").padStart(2, "0");
  const d = tag(item, "dealDay").padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 거래금액·보증금은 만원 단위 정수, 면적은 ㎡. 해제신고(cdealType "O")된
// 계약도 내려보내되 표시해서 클라이언트가 집계에서 뺄 수 있게 한다.
function parseTradeItem(item) {
  return {
    apt: tag(item, "aptNm"),
    dong: tag(item, "umdNm"),
    jibun: tag(item, "jibun"),
    amt: num(tag(item, "dealAmount")),
    area: num(tag(item, "excluUseAr")),
    floor: num(tag(item, "floor")),
    built: num(tag(item, "buildYear")),
    date: dealDate(item),
    canceled: tag(item, "cdealType") === "O",
    direct: tag(item, "dealingGbn") === "직거래",
  };
}

function parseRentItem(item) {
  return {
    apt: tag(item, "aptNm"),
    dong: tag(item, "umdNm"),
    dep: num(tag(item, "deposit")),
    rent: num(tag(item, "monthlyRent")),
    area: num(tag(item, "excluUseAr")),
    floor: num(tag(item, "floor")),
    built: num(tag(item, "buildYear")),
    date: dealDate(item),
    renewal: tag(item, "contractType") === "갱신",
  };
}

export function parseDealsXml(xml, type) {
  // 인증키 오류 등은 OpenAPI_ServiceResponse 봉투로 온다 (resultCode 없음).
  const reason = tag(xml, "returnAuthMsg") || tag(xml, "returnReasonCode");
  const code = tag(xml, "resultCode");
  if (!code && reason) return { error: reason };
  if (code && code !== "00" && code !== "000") {
    return { error: tag(xml, "resultMsg") || `resultCode ${code}` };
  }
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const parse = type === "trade" ? parseTradeItem : parseRentItem;
  return { total: num(tag(xml, "totalCount")), items: items.map(parse) };
}

function kstYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${value.year}${value.month}`;
}

export function validateDealsQuery(params, now = new Date()) {
  const type = params.get("type");
  if (!ENDPOINTS[type]) return { error: "type은 trade 또는 rent여야 합니다." };
  const region = params.get("region");
  if (!REGIONS.has(region)) return { error: "지원하지 않는 지역입니다." };
  const ym = params.get("ym") ?? "";
  if (!/^\d{6}$/.test(ym) || ym < "200601" || ym > kstYearMonth(now)) {
    return { error: "ym은 200601부터 이번 달까지의 YYYYMM이어야 합니다." };
  }
  return { type, region, ym };
}

function serviceKey(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function fetchDealsMonth(type, lawd, ym, key) {
  const all = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const endpoint = new URL(ENDPOINTS[type]);
    endpoint.searchParams.set("serviceKey", key);
    endpoint.searchParams.set("LAWD_CD", lawd);
    endpoint.searchParams.set("DEAL_YMD", ym);
    endpoint.searchParams.set("numOfRows", String(PAGE_SIZE));
    endpoint.searchParams.set("pageNo", String(page));
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { error: `국토부 API 응답 ${response.status}` };
    const parsed = parseDealsXml(await response.text(), type);
    if (parsed.error) return parsed;
    total = parsed.total;
    all.push(...parsed.items);
    if (all.length >= total || parsed.items.length === 0) break;
  }
  return { total, items: all };
}

export async function handleEstateDeals(request, env, url) {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
  }
  const query = validateDealsQuery(url.searchParams);
  if (query.error) {
    return Response.json({ status: "bad-request", error: query.error }, { status: 400 });
  }
  const key = serviceKey(env.MOLIT_SERVICE_KEY);
  if (!key) {
    return Response.json({ status: "not-configured" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { type, region, ym } = query;
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheRequest = new Request(`https://estate-cache.bubblelab.dev/v1/${type}/${region}/${ym}`);
  const cached = await cache?.match(cacheRequest);
  if (cached) return new Response(cached.body, cached);

  const result = await fetchDealsMonth(type, REGIONS.get(region).lawd, ym, key).catch(() => (
    { error: "국토부 API에 연결하지 못했습니다." }
  ));
  if (result.error) {
    return Response.json({ status: "unavailable", error: result.error }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }

  // 최근 두 달은 매일 새 신고가 쌓이므로 짧게, 그 전은 하루 캐싱.
  const recent = ym >= kstYearMonth(new Date(Date.now() - 45 * 86400000));
  const maxAge = recent ? 6 * 3600 : 86400;
  const response = Response.json(
    { status: "ok", type, region, ym, total: result.total, items: result.items },
    { headers: { "Cache-Control": `public, max-age=${maxAge}` } },
  );
  await cache?.put(cacheRequest, response.clone());
  return response;
}
