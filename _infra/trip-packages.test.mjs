// 패키지 관측(trip/ 계획 탭) 검사.
//
// 여기서 제일 중요한 건 **표시가와 실질가를 섞지 않는 것**이다. 표시가만 쌓으면
// 나중에 자유여행과 비교할 때 패키지가 실제보다 싸 보인다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PACKAGE_LIMITS, effectiveCost, normalizePackage, packageKey, summarizePackages,
  parseJsonLd, parseEmbeddedState, parsePackages,
} from "./trip-packages.js";
import { TripWatchDO } from "./trip-watch.js";

/* ── 실질가 ──────────────────────────────────────────────────────────── */

test("실질가는 표시가에 아는 필수비용을 더한다", () => {
  const cost = effectiveCost({
    listedPrice: 749900, mandatoryLocalFee: 150000, knownMandatoryOptions: 100000,
  });
  assert.equal(cost.listedPrice, 749900);
  assert.equal(cost.effectivePrice, 999900);
  assert.equal(cost.floor, false);
});

test("모르는 비용은 0원으로 세지 않고 이름만 남긴다", () => {
  // 749,900원 상품이 실제로는 가이드경비·선택관광·기사팁이 붙는 경우.
  const cost = effectiveCost({
    listedPrice: 749900, mandatoryLocalFee: 150000,
    unknownCosts: ["선택관광", "기사팁"],
  });
  assert.equal(cost.effectivePrice, 899900, "아는 것까지만 더한다");
  assert.equal(cost.floor, true, "모르는 비용이 있으면 이 값은 하한이다");
  assert.deepEqual(cost.unknownCosts, ["선택관광", "기사팁"]);
});

test("표시가가 없으면 실질가도 없다 (0원으로 만들지 않는다)", () => {
  const cost = effectiveCost({ listedPrice: null, mandatoryLocalFee: 100000 });
  assert.equal(cost.effectivePrice, null);
  assert.equal(cost.floor, true);
});

test("쉼표·원 표기가 붙은 숫자도 읽는다", () => {
  assert.equal(effectiveCost({ listedPrice: "1,039,000원" }).listedPrice, 1039000);
});

/* ── 정규화 ──────────────────────────────────────────────────────────── */

test("관측은 저장·비교가 믿을 수 있는 모양으로 고쳐진다", () => {
  const o = normalizePackage({
    productId: "P1", title: "  몽골 테를지   5박6일  ", listedPrice: "1,039,000",
    departureDate: "2027-06-12", nights: 5, days: 6,
    airline: "OM", direct: "true", shopping: 3, optionTour: 2, guideFee: 150000,
    included: ["항공", "호텔", ""], excluded: ["가이드팁"],
    url: "https://www.modetour.com/goods/1", unknownCosts: ["선택관광"],
  }, { destinationId: "d1", source: "modetour", now: 1000 });

  assert.equal(o.title, "몽골 테를지 5박6일", "공백이 정리된다");
  assert.equal(o.listedPrice, 1039000);
  assert.equal(o.direct, true);
  assert.deepEqual(o.included, ["항공", "호텔"], "빈 항목은 버린다");
  assert.equal(o.observedAt, 1000);
  assert.equal(packageKey(o), "modetour:P1");
  assert.equal(o.floor, true);
});

test("이상한 url 은 저장하지 않는다 (링크가 화면에 그대로 나간다)", () => {
  assert.equal(normalizePackage({ listedPrice: 1, url: "javascript:alert(1)" }).url, "");
  assert.equal(normalizePackage({ listedPrice: 1, url: "https://x.kr/a" }).url, "https://x.kr/a");
});

/* ── 요약 ────────────────────────────────────────────────────────────── */

const pkg = (id, listed, extra = {}) =>
  normalizePackage({ productId: id, title: id, listedPrice: listed, ...extra },
    { destinationId: "d1", source: "modetour", now: 5000 });

test("최저가는 표시가가 아니라 실질가로 고른다", () => {
  // 표시가는 A 가 싸지만 필수 현지경비까지 보면 B 가 싸다.
  const a = pkg("A", 890000, { mandatoryLocalFee: 300000 });
  const b = pkg("B", 990000, { mandatoryLocalFee: 50000 });
  const s = summarizePackages([a, b]);
  assert.equal(s.best.productId, "B", "표시가로 줄 세우면 현지경비를 감춘 상품이 이긴다");
  assert.equal(s.best.effectivePrice, 1040000);
  assert.equal(s.count, 2);
});

test("변화는 같은 상품의 직전 관측과 비교한다", () => {
  const now = pkg("A", 1000000);
  const s = summarizePackages([now], new Map([["modetour:A", { effectivePrice: 1090000 }]]));
  assert.equal(s.change, -90000);
  // 직전 값이 없으면 변화는 없다 — 새 상품이 뜬 것을 "가격이 내렸다"고 하면 안 된다
  assert.equal(summarizePackages([now]).change, null);
});

test("최저가에 모르는 비용이 있으면 요약도 하한으로 표시된다", () => {
  const s = summarizePackages([pkg("A", 749900, { unknownCosts: ["선택관광"] })]);
  assert.equal(s.floor, true);
  assert.deepEqual(s.unknownCosts, ["선택관광"]);
});

test("관측이 없으면 빈 요약", () => {
  const s = summarizePackages([]);
  assert.equal(s.count, 0);
  assert.equal(s.best, null);
  assert.equal(s.change, null);
});

/* ── 파싱 ────────────────────────────────────────────────────────────── */

const jsonLdPage = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
 {"@type":"Product","productID":"MT-1","name":"몽골 테를지 5일","url":"https://www.modetour.com/g/1",
  "offers":{"@type":"Offer","price":"1039000","priceCurrency":"KRW"}},
 {"@type":"Product","productID":"MT-2","name":"몽골 홉스골 7일",
  "offers":{"@type":"Offer","price":"1890000","priceCurrency":"KRW"}}]}
</script></head><body>목록</body></html>`;

test("JSON-LD 상품 목록을 읽는다", () => {
  const rows = parseJsonLd(jsonLdPage);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].productId, "MT-1");
  assert.equal(rows[0].listedPrice, 1039000);
  assert.equal(rows[0].url, "https://www.modetour.com/g/1");
});

test("깨진 JSON-LD 블록 하나 때문에 전체를 버리지 않는다", () => {
  const page = `<script type="application/ld+json">{ 깨짐 </script>` + jsonLdPage;
  assert.equal(parseJsonLd(page).length, 2);
});

test("상태 JSON(__NEXT_DATA__)에서도 상품을 줍는다", () => {
  const page = `<script id="__NEXT_DATA__" type="application/json">
  {"props":{"list":[{"goodsCd":"G1","goodsNm":"몽골 5박6일","price":1290000,"nights":5,"days":6,"airLineNm":"OM"},
                    {"goodsCd":"G2","goodsNm":"광고배너","price":100}]}}
  </script>`;
  const rows = parseEmbeddedState(page);
  assert.equal(rows.length, 1, "가격이 너무 낮은 것은 상품이 아니다");
  assert.equal(rows[0].productId, "G1");
  assert.equal(rows[0].nights, 5);
  assert.equal(rows[0].airline, "OM");
});

test("못 읽으면 억지로 긁지 않고 실패로 남긴다", () => {
  const out = parsePackages("<html><body><div>상품 999,000원</div></body></html>", { destinationId: "d1" });
  assert.equal(out.observations.length, 0);
  assert.equal(out.strategy, "none");
  assert.match(out.warnings.join(), /전략을 .*추가/);
});

test("파싱 결과는 관측 모양으로 나오고, 표시가만 읽혔음을 경고한다", () => {
  const out = parsePackages(jsonLdPage, { destinationId: "d1", source: "modetour", now: 7000 });
  assert.equal(out.strategy, "json-ld");
  assert.equal(out.observations.length, 2);
  assert.equal(out.observations[0].destinationId, "d1");
  assert.equal(out.observations[0].source, "modetour");
  assert.equal(out.observations[0].observedAt, 7000);
  assert.match(out.warnings.join(), /표시가만 읽힙니다/);
});

test("같은 상품을 두 번 세지 않는다", () => {
  const twice = jsonLdPage + jsonLdPage;
  assert.equal(parsePackages(twice, { destinationId: "d1" }).observations.length, 2);
});

/* ── DO 저장 ─────────────────────────────────────────────────────────── */

function storageStub() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.get(key); },
    async put(key, value) {
      if (typeof key === "object") for (const [k, v] of Object.entries(key)) map.set(k, v);
      else map.set(key, value);
    },
    async delete(keys) { for (const key of [].concat(keys)) map.delete(key); },
    async list({ prefix }) {
      return new Map([...map.entries()].filter(([key]) => key.startsWith(prefix)));
    },
  };
}
const call = (dо, path, init) => dо.fetch(new Request(`https://trip-watch${path}`, init));
const post = (body) => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const destination = {
  id: "d1", name: "몽골", country: "MN", from: "2027-06-01", to: "2027-06-05",
  minNights: 5, maxNights: 5, flights: [{ id: "f1", origin: "ICN", dest: "UBN" }],
};

test("패키지 관측을 넣으면 여행지 카드 요약에 최저가가 붙는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(destination));
  await call(dо, "/observe-packages", post({
    destinationId: "d1", source: "modetour",
    packages: [
      { productId: "A", title: "테를지 5일", listedPrice: 1039000, nights: 5, days: 6 },
      { productId: "B", title: "홉스골 7일", listedPrice: 1890000 },
    ],
  }));

  const list = await (await call(dо, "/destinations")).json();
  const summary = list.destinations[0].packageSummary;
  assert.equal(summary.count, 2);
  assert.equal(summary.best.productId, "A");
  assert.equal(summary.best.effectivePrice, 1039000);

  const detail = await (await call(dо, "/packages?destination=d1")).json();
  assert.equal(detail.packages.length, 2);
  assert.equal(detail.packages[0].productId, "A", "실질가 순으로 정렬된다");
  assert.equal(detail.history.length, 1);
  assert.equal(detail.history[0].min, 1039000);
});

test("두 번째 수집에서 같은 상품의 가격 변화를 잡는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(destination));
  await dо.ingestPackages("d1", [{ productId: "A", title: "테를지", listedPrice: 1090000 }], "modetour", 1000);
  await dо.ingestPackages("d1", [{ productId: "A", title: "테를지", listedPrice: 1039000 }], "modetour", 2000);

  const detail = await (await call(dо, "/packages?destination=d1")).json();
  assert.equal(detail.summary.change, -51000, "같은 상품이 5만천원 내렸다");
  assert.equal(detail.packages[0].previous.effectivePrice, 1090000);
});

test("없는 여행지로는 패키지를 넣을 수 없다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  const res = await call(dо, "/observe-packages", post({
    destinationId: "없음", packages: [{ productId: "A", listedPrice: 1 }],
  }));
  assert.equal(res.status, 404);
});

test("여행지를 지우면 패키지 관측도 함께 지워진다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  await call(dо, "/destinations", post(destination));
  await call(dо, "/observe-packages", post({
    destinationId: "d1", packages: [{ productId: "A", listedPrice: 1000000 }],
  }));
  await call(dо, "/destinations/d1", { method: "DELETE" });
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith("pkg")).length, 0);
});

test("패키지 추이도 그날 관측만 쓰고 하루 안에서는 내려가기만 한다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(destination));
  const morning = Date.UTC(2026, 7, 15, 0);
  const evening = Date.UTC(2026, 7, 15, 6);
  await dо.ingestPackages("d1", [{ productId: "A", listedPrice: 1000000 }], "modetour", morning);
  await dо.ingestPackages("d1", [{ productId: "A", listedPrice: 1400000 }], "modetour", evening);
  const detail = await (await call(dо, "/packages?destination=d1")).json();
  assert.equal(detail.history.at(-1).min, 1000000, "그날 잡을 수 있었던 최저가");
  assert.equal(detail.packages[0].effectivePrice, 1400000, "목록은 최신 값을 보여 준다");
});

test("상품 수 상한이 있다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(destination));
  const many = Array.from({ length: PACKAGE_LIMITS.maxProducts + 20 }, (_, i) =>
    ({ productId: `P${i}`, listedPrice: 1000000 + i }));
  const out = await dо.ingestPackages("d1", many, "modetour");
  assert.equal(out.accepted, PACKAGE_LIMITS.maxProducts);
});

/* ── 배선 ────────────────────────────────────────────────────────────── */

test("데몬 입구 하나로 항공·패키지를 함께 받는다", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const worker = readFileSync(join(root, "_infra/worker.js"), "utf8");
  const handler = worker.slice(worker.indexOf("async function handleTripWatch"));
  const body = handler.slice(0, handler.indexOf("async function handleDuri"));
  // packages 가 있으면 패키지 경로로, 없으면 항공 관측 경로로 넘어간다
  assert.match(body, /Array\.isArray\(parsed\?\.packages\) \? "\/observe-packages" : "\/observe"/);
  // 패키지 조회도 토큰 뒤에 있어야 한다
  assert.ok(body.indexOf("validSession(key, bearer)") < body.indexOf('path === "/packages"'),
    "패키지 조회가 인증보다 먼저 처리되고 있다");
});
