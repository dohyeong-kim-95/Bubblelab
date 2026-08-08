import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  aggregateHoldings,
  buildSeries,
  describeUpstreamError,
  kstDate,
  MAX_SNAPSHOTS,
  parseDecimal,
  READ_ONLY_PATHS,
  snapshotOf,
  tokenRequestBody,
  tossFetch,
} from "./invest.js";

const ROOT = new URL("..", import.meta.url).pathname;

// 토스 holdings 응답 한 건 (공식 스키마의 필드명 그대로).
const holding = (over = {}) => ({
  symbol: "005930",
  name: "삼성전자",
  marketCountry: "KR",
  currency: "KRW",
  quantity: "10",
  lastPrice: "80000",
  averagePurchasePrice: "70000",
  marketValue: { amount: "800000", purchaseAmount: "700000" },
  profitLoss: { amount: "100000", rate: "0.1428" },
  dailyProfitLoss: { amount: "5000", rate: "0.006" },
  ...over,
});

// ── 조회 전용 보증 ─────────────────────────────────────────────────────

test("주문 계열 엔드포인트는 화이트리스트에 없다", () => {
  for (const path of READ_ONLY_PATHS) {
    assert.match(path, /^\/api\/v1\/(accounts|holdings|buying-power)$/);
  }
  assert.equal(READ_ONLY_PATHS.size, 3);
});

test("화이트리스트 밖의 경로는 네트워크를 타기 전에 거부한다", async () => {
  let called = false;
  const fetchImpl = () => { called = true; };
  await assert.rejects(
    () => tossFetch("/api/v1/orders", { token: "t", fetchImpl }),
    /read-only/,
  );
  assert.equal(called, false, "거부된 경로인데 fetch가 불렸다");
});

// 실수로 주문 코드가 섞여 들어오는 것을 소스 수준에서 막는다. 2·3단계는
// 이 파일이 아니라 별도 모듈에서 (한도·킬스위치를 갖추고) 시작해야 한다.
test("invest.js 소스에 주문 경로가 들어 있지 않다", () => {
  const source = readFileSync(join(ROOT, "_infra/invest.js"), "utf8");
  for (const forbidden of ["/api/v1/orders", "/cancel", "/modify"]) {
    assert.ok(!source.includes(forbidden), `invest.js에 주문 경로(${forbidden})가 있다`);
  }
});

// ── 집계 ───────────────────────────────────────────────────────────────

test("parseDecimal은 소수 문자열을 숫자로, 쓰레기 값을 0으로 만든다", () => {
  assert.equal(parseDecimal("1234.5"), 1234.5);
  assert.equal(parseDecimal(undefined), 0);
  assert.equal(parseDecimal("없음"), 0);
});

test("보유종목을 통화별로 합산한다", () => {
  const { byCurrency, positions } = aggregateHoldings([
    holding(),
    holding({ symbol: "000660", name: "SK하이닉스", marketValue: { amount: "300000", purchaseAmount: "400000" }, profitLoss: { amount: "-100000", rate: "-0.25" } }),
    holding({
      symbol: "AAPL", name: "애플", marketCountry: "US", currency: "USD",
      marketValue: { amount: "2000", purchaseAmount: "1500" },
      profitLoss: { amount: "500", rate: "0.3333" },
    }),
  ]);

  assert.equal(byCurrency.KRW.value, 1_100_000);
  assert.equal(byCurrency.KRW.cost, 1_100_000);
  assert.equal(byCurrency.KRW.pnl, 0);
  assert.equal(byCurrency.KRW.rate, 0);
  assert.equal(byCurrency.USD.value, 2000);
  // 통화를 섞어서 더하지 않는다 — 환율 없이 합치면 틀린 숫자가 된다.
  assert.deepEqual(Object.keys(byCurrency).sort(), ["KRW", "USD"]);
  // 평가금액 큰 순
  assert.deepEqual(positions.map((p) => p.symbol), ["005930", "000660", "AAPL"]);
});

test("원가가 0이면 수익률은 0으로 둔다 (0으로 나누지 않는다)", () => {
  const { byCurrency } = aggregateHoldings([
    holding({ marketValue: { amount: "0", purchaseAmount: "0" }, profitLoss: { amount: "0", rate: "0" } }),
  ]);
  assert.equal(byCurrency.KRW.rate, 0);
  assert.ok(Number.isFinite(byCurrency.KRW.rate));
});

test("빈 보유목록도 안전하게 처리한다", () => {
  for (const input of [[], null, undefined]) {
    const { byCurrency, positions } = aggregateHoldings(input);
    assert.deepEqual(byCurrency, {});
    assert.deepEqual(positions, []);
  }
});

// ── 스냅샷·시계열 ──────────────────────────────────────────────────────

test("스냅샷 날짜는 KST 기준이다", () => {
  // 2026-08-08 00:30 KST = 2026-08-07 15:30 UTC — UTC로 찍으면 하루 밀린다.
  assert.equal(kstDate(Date.parse("2026-08-07T15:30:00Z")), "2026-08-08");
  assert.equal(kstDate(Date.parse("2026-08-07T14:30:00Z")), "2026-08-07");
});

test("시계열은 통화별로 날짜순 정렬된다", () => {
  const series = buildSeries([
    { date: "2026-08-02", byCurrency: { KRW: { rate: 0.2, value: 12, pnl: 2 } } },
    { date: "2026-08-01", byCurrency: { KRW: { rate: 0.1, value: 11, pnl: 1 }, USD: { rate: -0.05, value: 5, pnl: -0.25 } } },
  ]);
  assert.deepEqual(series.KRW.map((p) => p.date), ["2026-08-01", "2026-08-02"]);
  assert.deepEqual(series.KRW.map((p) => p.rate), [0.1, 0.2]);
  assert.equal(series.USD.length, 1);
});

test("스냅샷은 합계만 담고 종목 단위는 담지 않는다", () => {
  const snapshot = snapshotOf(aggregateHoldings([holding()]), { KRW: 5000 }, Date.parse("2026-08-08T01:00:00Z"));
  assert.equal(snapshot.date, "2026-08-08");
  assert.equal(snapshot.cash.KRW, 5000);
  assert.ok(!("positions" in snapshot));
});

test("보관 개수는 3년치 영업일을 덮는다", () => {
  assert.ok(MAX_SNAPSHOTS >= 730, "스냅샷 보관량이 2년치보다 적다");
});

// ── 전송 계층 ──────────────────────────────────────────────────────────

test("토큰 요청은 client_credentials 폼이다", () => {
  const body = tokenRequestBody("id", "secret");
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(body.get("client_id"), "id");
  assert.equal(body.get("client_secret"), "secret");
});

test("계좌 조회에 Bearer와 X-Tossinvest-Account를 함께 싣는다", async () => {
  let seen = null;
  const fetchImpl = (url, init) => {
    seen = { url: new URL(url), headers: init.headers, method: init.method };
    return Promise.resolve(Response.json({ result: { items: [] } }));
  };
  await tossFetch("/api/v1/buying-power", {
    token: "tok", accountSeq: 42, query: { currency: "USD" }, fetchImpl,
  });
  assert.equal(seen.method, "GET");
  assert.equal(seen.url.origin, "https://openapi.tossinvest.com");
  assert.equal(seen.url.searchParams.get("currency"), "USD");
  assert.equal(seen.headers.Authorization, "Bearer tok");
  assert.equal(seen.headers["X-Tossinvest-Account"], "42");
});

test("result 봉투를 벗겨서 돌려준다", async () => {
  const fetchImpl = () => Promise.resolve(Response.json({ result: { items: [holding()] } }));
  const result = await tossFetch("/api/v1/holdings", { token: "t", accountSeq: 1, fetchImpl });
  assert.equal(result.items.length, 1);
});

test("봉투가 없으면 스펙 변경으로 보고 던진다", async () => {
  const fetchImpl = () => Promise.resolve(Response.json({ items: [] }));
  await assert.rejects(
    () => tossFetch("/api/v1/holdings", { token: "t", accountSeq: 1, fetchImpl }),
    /응답 형식/,
  );
});

test("오류 응답은 상태코드를 달고 던지며 키·토큰을 노출하지 않는다", async () => {
  const fetchImpl = () => Promise.resolve(new Response("nope", { status: 429 }));
  await assert.rejects(
    () => tossFetch("/api/v1/holdings", { token: "super-secret", accountSeq: 1, fetchImpl }),
    (error) => {
      assert.equal(error.status, 429);
      assert.ok(!error.message.includes("super-secret"), "오류 문구에 토큰이 샜다");
      return true;
    },
  );
});

test("상태코드별 안내 문구", () => {
  assert.match(describeUpstreamError(401), /인증/);
  assert.match(describeUpstreamError(429), /한도/);
  assert.match(describeUpstreamError(503), /서버/);
});

// ── 토큰 수명 (InvestDO) ───────────────────────────────────────────────

/** DO storage 최소 스텁 — get/put/list({prefix})/delete(keys)만 쓴다. */
function storageStub() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async delete(keys) { for (const key of [].concat(keys)) map.delete(key); },
    async list({ prefix }) {
      const hit = [...map.entries()].filter(([key]) => key.startsWith(prefix));
      return new Map(hit);
    },
  };
}

/** 응답 스크립트를 순서대로 돌려주는 fetch. 호출 기록을 남긴다. */
function fetchStub(script) {
  const calls = [];
  const impl = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body, token: init?.headers?.Authorization });
    const step = script.shift();
    if (!step) throw new Error(`예상치 못한 호출: ${url}`);
    return step(url, init);
  };
  return { impl, calls };
}

const tokenResponse = (value) => Response.json({ access_token: value, expires_in: 86400 });
const okAccounts = () => Response.json({ result: [{ accountNo: "123-45", accountSeq: 7, accountType: "BROKERAGE" }] });
const okHoldings = () => Response.json({ result: { items: [holding()] } });
const okCash = () => Response.json({ result: { cashBuyingPower: "1000", currency: "KRW" } });

async function runDO(script, { storage = storageStub(), env = {} } = {}) {
  const { InvestDO } = await import("./invest.js");
  const stub = fetchStub(script);
  const original = globalThis.fetch;
  globalThis.fetch = stub.impl;
  try {
    const instance = new InvestDO({ storage }, {
      INVEST_CLIENT_ID: "id", INVEST_CLIENT_SECRET: "secret", ...env,
    });
    const response = await instance.fetch(new Request("https://invest/state", { method: "GET" }));
    return { body: await response.json(), status: response.status, calls: stub.calls, storage };
  } finally {
    globalThis.fetch = original;
  }
}

test("토큰을 받아 잔고를 조회하고 스냅샷을 남긴다", async () => {
  const { body, status, storage } = await runDO([
    () => tokenResponse("tok-1"), okAccounts, okHoldings, okCash, okCash,
  ]);
  assert.equal(status, 200);
  assert.equal(body.byCurrency.KRW.value, 800000);
  assert.equal(body.cash.KRW, 1000);
  assert.equal(body.positions.length, 1);
  assert.equal(body.stale, false);
  // 하루치 스냅샷이 남아 그래프의 첫 점이 된다
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith("snap:")).length, 1);
  assert.equal(storage.map.get("accountSeq"), 7);
});

// 토스는 client당 유효 토큰이 1개라, 다른 곳에서 발급하면 캐시된 토큰이 즉시
// 죽는다. 만료 전이라도 401이면 새로 받아 재시도해야 24시간 먹통을 피한다.
test("401이면 캐시된 토큰을 버리고 새로 받아 한 번 재시도한다", async () => {
  const storage = storageStub();
  await storage.put("token", { value: "죽은토큰", expiresAt: Date.now() + 60 * 60 * 1000 });
  await storage.put("accountSeq", 7);

  const { body, status, calls } = await runDO([
    () => new Response("unauthorized", { status: 401 }),  // 죽은 토큰으로 holdings
    () => tokenResponse("tok-2"),                          // 강제 재발급
    okHoldings, okCash, okCash,
  ], { storage });

  assert.equal(status, 200);
  assert.equal(body.byCurrency.KRW.value, 800000);
  assert.equal(calls[0].token, "Bearer 죽은토큰");
  assert.match(calls[1].url, /\/oauth2\/token$/);
  assert.equal(calls[2].token, "Bearer tok-2", "재시도가 새 토큰을 쓰지 않았다");
  assert.equal(storage.map.get("token").value, "tok-2", "새 토큰이 저장되지 않았다");
});

test("재시도까지 실패하면 캐시가 없을 때 오류를 그대로 알린다", async () => {
  // 재시도 때는 accountSeq가 이미 캐시돼 있어 계좌 목록을 다시 부르지 않는다.
  const { body, status } = await runDO([
    () => tokenResponse("tok-1"), okAccounts,
    () => new Response("nope", { status: 401 }),
    () => tokenResponse("tok-2"),
    () => new Response("nope", { status: 401 }),
  ]);
  assert.equal(status, 502);
  assert.match(body.error, /인증/);
});

test("상류가 막혀도 캐시가 있으면 stale 표시로 직전 값을 준다", async () => {
  const storage = storageStub();
  await storage.put("accountSeq", 7);
  // 1회차: 정상 조회로 캐시를 만든다
  await runDO([() => tokenResponse("tok-1"), okHoldings, okCash, okCash], { storage });
  // 2회차: 30초 캐시를 무시하도록 시각을 되돌린 뒤 상류를 429로 막는다
  const latest = await storage.get("latest");
  await storage.put("latest", { ...latest, ts: latest.ts - 10 * 60 * 1000 });

  const { body, status } = await runDO([
    () => new Response("slow down", { status: 429 }),
    () => new Response("slow down", { status: 429 }),
  ], { storage });

  assert.equal(status, 200, "캐시가 있는데 화면을 비웠다");
  assert.equal(body.stale, true);
  assert.match(body.error, /한도/);
  assert.equal(body.byCurrency.KRW.value, 800000);
});

test("INVEST_ACCOUNT_SEQ가 있으면 계좌 목록을 조회하지 않는다", async () => {
  const { calls, status } = await runDO(
    [() => tokenResponse("tok-1"), okHoldings, okCash, okCash],
    { env: { INVEST_ACCOUNT_SEQ: "42" } },
  );
  assert.equal(status, 200);
  assert.ok(!calls.some((call) => call.url.includes("/api/v1/accounts")), "계좌 목록을 불필요하게 조회했다");
  assert.ok(calls.some((call) => call.url.includes("/api/v1/holdings")));
});

// ── 배선 ───────────────────────────────────────────────────────────────

test("invest는 기본 닫힘이고 DO·마이그레이션이 등록돼 있다", () => {
  const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, /"ENABLE_INVEST":\s*"false"/, "invest는 fail-closed여야 한다");
  assert.match(wrangler, /"name":\s*"INVEST",\s*"class_name":\s*"InvestDO"/);
  assert.match(wrangler, /"new_sqlite_classes":\s*\["InvestDO"\]/);
});

test("워커가 InvestDO를 내보내고 invest를 noindex로 돌린다", () => {
  const worker = readFileSync(join(ROOT, "_infra/worker.js"), "utf8");
  assert.match(worker, /export \{ InvestDO \} from "\.\/invest\.js"/);
  assert.match(worker, /\["admin", "work", "estate", "duri", "invest"\]/);
  // 게이트 비밀번호에 폴백을 두지 않는다 — 계좌 화면은 명시 설정만 허용한다.
  assert.match(worker, /return env\.INVEST_PASSWORD \|\| null;/);
});
