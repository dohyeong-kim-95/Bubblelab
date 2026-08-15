// 여행 패키지 관측 (trip/ 계획 탭, PackageWatch v0).
//
// **표시가만 저장하지 않는다.** "749,900원" 상품이라도 실제로 나가는 돈에는
// 가이드·기사 경비, 필수 선택관광, 현지 결제가 붙는다. 표시가만 쌓으면 나중에
// 자유여행과 비교할 때 패키지가 실제보다 싸 보인다.
//
//   listedPrice     … 광고된 1인가
//   effectivePrice  … listedPrice + 필수 현지경비 + 아는 필수 선택관광
//   unknownCosts[]  … 있는 건 알지만 금액을 모르는 것들
//
// 모르는 값을 0원으로 채우지 않는다. unknownCosts 가 비어 있지 않으면
// effectivePrice 는 **하한**이고, 화면은 "추가비용 확인 필요"로 표시한다.
//
// 파서는 순수 함수라 엣지·데몬·교정 CLI 가 같은 코드를 쓴다
// (`node _infra/trip-package-parse.mjs 저장한페이지.html`).

export const PACKAGE_SOURCES = [
  { key: "modetour", label: "모두투어", host: "modetour.com" },
];
export const PACKAGE_SOURCE_KEYS = PACKAGE_SOURCES.map((s) => s.key);

export const PACKAGE_LIMITS = {
  maxProducts: 60,      // 여행지 하나가 들고 있는 상품 상한
  historyDays: 180,
  maxTitle: 120,
};

const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v ?? "").replace(/[,\s원₩]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : null;
};
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const bool = (v) => v === true || v === "true" || v === 1;

/**
 * 실제로 나가는 1인 금액. 아는 것만 더하고, 모르는 것은 이름만 남긴다.
 * (억지로 0원 처리하면 패키지가 자유여행보다 싸다고 잘못 말하게 된다.)
 */
export function effectiveCost(raw) {
  const listed = num(raw?.listedPrice ?? raw?.pricePerPerson);
  if (listed === null) return { listedPrice: null, effectivePrice: null, unknownCosts: [], floor: true };

  const parts = [
    { key: "mandatoryLocalFee", label: "현지 필수경비" },
    { key: "knownMandatoryOptions", label: "필수 선택관광" },
  ];
  let effective = listed;
  const unknown = [];
  for (const part of parts) {
    const value = num(raw?.[part.key]);
    if (value === null) continue;   // 없으면 없는 것 — 미상은 아래 unknownCosts 로 온다
    effective += value;
  }
  // 상품이 "선택관광 있음"·"쇼핑 3회"라고만 알려 주고 금액을 말하지 않는 경우.
  for (const label of Array.isArray(raw?.unknownCosts) ? raw.unknownCosts : []) {
    const name = text(label, 30);
    if (name && !unknown.includes(name)) unknown.push(name);
  }
  return {
    listedPrice: Math.round(listed),
    effectivePrice: Math.round(effective),
    unknownCosts: unknown,
    // 모르는 항목이 있으면 effectivePrice 는 "적어도 이 값"이라는 뜻이다.
    floor: unknown.length > 0,
  };
}

/** 저장·비교가 믿고 쓸 수 있는 모양으로 고친다. */
export function normalizePackage(raw, { destinationId, source, now = Date.now() } = {}) {
  const p = raw && typeof raw === "object" ? raw : {};
  const cost = effectiveCost(p);
  const list = (v) => (Array.isArray(v) ? v.map((x) => text(x, 40)).filter(Boolean).slice(0, 20) : []);

  return {
    destinationId: text(destinationId ?? p.destinationId, 64),
    source: text(source ?? p.source, 20),
    productId: text(p.productId ?? p.id, 64),
    title: text(p.title, PACKAGE_LIMITS.maxTitle),
    departureDate: /^\d{4}-\d{2}-\d{2}$/.test(String(p.departureDate ?? "")) ? p.departureDate : "",
    nights: num(p.nights) ?? null,
    days: num(p.days) ?? null,

    listedPrice: cost.listedPrice,
    mandatoryLocalFee: num(p.mandatoryLocalFee),
    knownMandatoryOptions: num(p.knownMandatoryOptions),
    effectivePrice: cost.effectivePrice,
    unknownCosts: cost.unknownCosts,
    floor: cost.floor,

    airline: text(p.airline, 40),
    direct: p.direct === undefined ? null : bool(p.direct),
    shopping: num(p.shopping),
    optionTour: num(p.optionTour),
    guideFee: num(p.guideFee),
    included: list(p.included),
    excluded: list(p.excluded),
    url: /^https?:\/\//.test(String(p.url ?? "")) ? String(p.url).slice(0, 300) : "",
    observedAt: num(p.observedAt) ?? now,
  };
}

export const packageKey = (o) => `${o.source}:${o.productId}`;

/**
 * 여행지 하나의 패키지 요약. 카드가 쓰는 값은 전부 여기서 나온다.
 * 비교는 **effectivePrice 기준**이다 — 표시가로 줄 세우면 현지경비를 감춘 상품이
 * 항상 이긴다.
 */
export function summarizePackages(observations, previous = new Map()) {
  const items = (observations ?? []).filter((o) => Number.isFinite(o?.effectivePrice));
  if (!items.length) {
    return { count: 0, best: null, change: null, floor: false, unknownCosts: [], sources: [] };
  }
  const sorted = [...items].sort((a, b) => a.effectivePrice - b.effectivePrice);
  const best = sorted[0];
  const prior = previous instanceof Map ? previous.get(packageKey(best)) : previous?.[packageKey(best)];
  const priorPrice = Number.isFinite(prior?.effectivePrice) ? prior.effectivePrice : null;

  return {
    count: items.length,
    best,
    // 같은 상품의 직전 관측과 비교한다. 다른 상품과 비교하면 "가격이 내렸다"가
    // 아니라 "더 싼 상품이 새로 떴다"인데 둘은 다른 이야기다.
    change: priorPrice === null ? null : best.effectivePrice - priorPrice,
    // 최저가 상품에 모르는 비용이 있으면 그 최저가는 하한이다.
    floor: best.floor,
    unknownCosts: best.unknownCosts,
    sources: [...new Set(items.map((o) => o.source))],
    listedBest: sorted.reduce((min, o) =>
      (min === null || (Number.isFinite(o.listedPrice) && o.listedPrice < min) ? o.listedPrice : min), null),
  };
}

/* ── 파싱 ──────────────────────────────────────────────────────────────
 *
 * ⚠️ **셀렉터는 실제 페이지로 교정해야 한다.** 이 저장소를 만든 환경에서는
 * 여행사 사이트로 나가는 네트워크가 막혀 있어 실제 HTML 을 확인하지 못했다.
 * 그래서 되도록 사이트별 CSS 셀렉터가 아니라 **표준 구조**부터 읽는다:
 *
 *   ① JSON-LD (schema.org Product/Offer/ItemList) — 여행사 상품 목록이 SEO 용으로
 *      가장 흔히 내보내는 형식이고, 화면을 개편해도 잘 살아남는다.
 *   ② 페이지에 심긴 상태 JSON (__NEXT_DATA__ 등)
 *   ③ 그래도 없으면 실패로 남긴다 — 억지로 정규식을 긁어 잘못된 숫자를 저장하는
 *      것보다 "못 읽었다"가 낫다. 가격 데이터의 품질이 이 제품의 핵심이다.
 *
 * 교정: 실제 검색 결과 페이지를 저장해서
 *   node _infra/trip-package-parse.mjs 저장한페이지.html --source modetour
 * 로 무엇이 잡히는지 보고 여기 전략을 고친다.
 */

const scriptBlocks = (html, attrPattern) => {
  const out = [];
  const re = new RegExp(`<script[^>]*${attrPattern}[^>]*>([\\s\\S]*?)</script>`, "gi");
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
};

const flatten = (node, seen = []) => {
  if (!node || typeof node !== "object") return seen;
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, seen);
    return seen;
  }
  seen.push(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") flatten(value, seen);
  }
  return seen;
};

/** JSON-LD 의 Product/Offer 를 관측 후보로 바꾼다. */
export function parseJsonLd(html) {
  const found = [];
  for (const block of scriptBlocks(html, 'type=["\']application/ld\\+json["\']')) {
    let data;
    try {
      data = JSON.parse(block.trim());
    } catch {
      continue; // 깨진 블록 하나 때문에 전체를 버리지 않는다
    }
    const nodes = flatten(data);
    // 상품 노드만 센다. Offer 는 상품 안에 들어 있는 가격이라, 따로 세면 같은
    // 상품이 두 번 잡혀 최저가가 어긋난다.
    const isProduct = (n) => /^(Product|TouristTrip|Trip)$/i.test(String(n["@type"] ?? ""));
    const products = nodes.filter(isProduct);
    // 상품 타입 없이 Offer 만 내보내는 페이지를 위한 예비 경로 (이름이 있는 것만).
    const items = products.length
      ? products
      : nodes.filter((n) => /^Offer$/i.test(String(n["@type"] ?? "")) && n.name);

    for (const node of items) {
      const offer = node.offers && typeof node.offers === "object"
        ? (Array.isArray(node.offers) ? node.offers[0] : node.offers) : null;
      const price = num(offer?.price ?? offer?.lowPrice ?? node.price ?? node.lowPrice);
      if (price === null) continue;
      found.push({
        productId: text(node.productID ?? node.sku ?? node["@id"] ?? offer?.sku ?? "", 64),
        title: text(node.name ?? "", PACKAGE_LIMITS.maxTitle),
        listedPrice: price,
        url: text(node.url ?? offer?.url ?? "", 300),
      });
    }
  }
  return found;
}

/** 페이지에 심긴 상태 JSON 에서 상품처럼 보이는 객체를 줍는다. */
export function parseEmbeddedState(html) {
  const found = [];
  const blocks = [
    ...scriptBlocks(html, 'id=["\']__NEXT_DATA__["\']'),
    ...scriptBlocks(html, 'id=["\']__NUXT_DATA__["\']'),
  ];
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block.trim());
    } catch {
      continue;
    }
    for (const node of flatten(data)) {
      // 상품처럼 보이는 최소 조건: 이름 비슷한 것 + 가격 비슷한 것
      const title = node.goodsNm ?? node.prdtNm ?? node.title ?? node.name;
      const price = num(node.price ?? node.minPrice ?? node.salePrice ?? node.goodsPrice);
      if (!title || price === null || price < 10000) continue;
      found.push({
        productId: text(node.goodsCd ?? node.prdtCd ?? node.productId ?? node.id ?? "", 64),
        title: text(title, PACKAGE_LIMITS.maxTitle),
        listedPrice: price,
        nights: num(node.nights ?? node.night),
        days: num(node.days ?? node.day),
        departureDate: /^\d{4}-\d{2}-\d{2}$/.test(String(node.departureDate ?? node.depDate ?? ""))
          ? (node.departureDate ?? node.depDate) : "",
        airline: text(node.airline ?? node.airLineNm ?? "", 40),
        url: text(node.url ?? "", 300),
      });
    }
  }
  return found;
}

/**
 * 저장된 페이지 → 관측 목록. 어떤 전략으로 읽었는지와 경고를 함께 돌려준다
 * (교정 CLI 가 그대로 보여 준다).
 */
export function parsePackages(html, { destinationId, source = "modetour", now = Date.now() } = {}) {
  const warnings = [];
  const page = String(html ?? "");
  if (!page.trim()) return { observations: [], strategy: "none", warnings: ["빈 문서"] };

  let rows = parseJsonLd(page);
  let strategy = "json-ld";
  if (!rows.length) {
    rows = parseEmbeddedState(page);
    strategy = "embedded-state";
  }
  if (!rows.length) {
    return {
      observations: [], strategy: "none",
      warnings: ["JSON-LD·상태 JSON 어느 쪽에서도 상품을 찾지 못했습니다 — " +
        "이 페이지 구조에 맞는 전략을 _infra/trip-packages.js 에 추가하세요"],
    };
  }

  const seen = new Set();
  const observations = [];
  for (const row of rows) {
    // 상품 id 가 없으면 제목+가격으로 대신한다(같은 상품을 두 번 세지 않게).
    const productId = row.productId || `${row.title}|${row.listedPrice}`.slice(0, 64);
    if (seen.has(productId)) continue;
    seen.add(productId);
    if (!row.title) warnings.push(`제목 없는 상품(${productId})`);
    observations.push(normalizePackage({ ...row, productId }, { destinationId, source, now }));
    if (observations.length >= PACKAGE_LIMITS.maxProducts) break;
  }
  // 표시가만 읽힌 상태라는 걸 분명히 남긴다 — 현지경비·선택관광은 상세 페이지에 있다.
  warnings.push("목록 페이지에서는 표시가만 읽힙니다 — 현지 필수경비·선택관광은 " +
    "상세 페이지를 봐야 하고, 그전까지 effectivePrice 는 하한입니다");
  return { observations, strategy, warnings };
}
