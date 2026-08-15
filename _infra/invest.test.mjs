import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  aggregateGroups,
  cashGroupOf,
  aggregateHoldings,
  autoGroupLabel,
  buildGroupSeries,
  buildSeries,
  groupOf,
  parseGroupMap,
  describeUpstreamError,
  fetchSnapshot,
  InvestDO,
  isEmptySnapshot,
  kstDate,
  MAX_SNAPSHOTS,
  memoryTokenCache,
  normalizeSnapshot,
  parseDecimal,
  READ_ONLY_PATHS,
  REFRESH_TTL_MS,
  snapshotOf,
  tokenRequest,
  TOKEN_AUTH_METHODS,
  tossFetch,
  upstreamError,
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

// 화이트리스트가 늘어날 때 이 테스트를 같이 고치게 만드는 것이 목적이다 —
// 개수까지 박아 두면 "조회 하나만 더" 가 소리 없이 지나갈 수 없다.
test("주문 계열 엔드포인트는 화이트리스트에 없다", () => {
  for (const path of READ_ONLY_PATHS) {
    assert.match(path, /^\/api\/v1\/(accounts|holdings|buying-power|stocks)$/);
  }
  assert.equal(READ_ONLY_PATHS.size, 4);
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

test("basic 방식은 자격증명을 Authorization 헤더에만 싣는다", () => {
  const { headers, body } = tokenRequest("id", "secret", "basic");
  assert.equal(headers.Authorization, `Basic ${Buffer.from("id:secret").toString("base64")}`);
  assert.equal(body.get("grant_type"), "client_credentials");
  // RFC 6749 §2.3 — 한 요청에 두 인증 방식을 같이 쓰면 안 된다
  assert.equal(body.get("client_id"), null);
  assert.equal(body.get("client_secret"), null);
});

test("post 방식은 자격증명을 폼 본문에만 싣는다", () => {
  const { headers, body } = tokenRequest("id", "secret", "post");
  assert.equal(headers.Authorization, undefined);
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(body.get("client_id"), "id");
  assert.equal(body.get("client_secret"), "secret");
});

test("basic 을 먼저 시도한다 (토스가 WWW-Authenticate: Basic 을 요구한다)", () => {
  assert.deepEqual(TOKEN_AUTH_METHODS, ["basic", "post"]);
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
  assert.match(describeUpstreamError(403), /권한/);
  assert.match(describeUpstreamError(429), /한도/);
  assert.match(describeUpstreamError(503), /서버/);
});

// 키를 아무리 다시 발급해도 안 풀리는 원인이라 구분해서 알려야 한다. 다만
// 단정은 명시적으로 거부당했을 때만 한다.
test("IP 거부가 분명할 때만 IP 문제로 단정한다", () => {
  for (const status of [401, 403]) {
    assert.match(describeUpstreamError(status, '{"message":"IP not allowed"}'), /IP를 거부/);
    assert.match(describeUpstreamError(status, "not allowed ip: 1.2.3.4"), /IP를 거부/);
  }
  // "description" 같은 단어에 들어 있는 ip 는 오탐이면 안 된다
  assert.match(describeUpstreamError(401, '{"error":"invalid_client description"}'), /인증/);
});

// 실제로 겪은 오진: 토스는 키가 틀려도 IP가 아니어도 같은 코드를 주면서
// "액세스 토큰 또는 IP를 확인해 주세요"라고 답한다. 여기서 한쪽으로 단정하면
// 멀쩡한 키를 다시 만들거나, 반대로 IP 문제를 놓친다.
test("unidentified-client는 두 원인을 모두 알린다", () => {
  const body = '{"error":{"code":"unidentified-client","message":"클라이언트를 식별할 수 없습니다. 액세스 토큰 또는 IP를 확인해 주세요."}}';
  const message = describeUpstreamError(401, body);
  assert.match(message, /API 키/);
  assert.match(message, /IP/);
  assert.ok(!/IP를 거부/.test(message), "좁힐 수 없는데 IP 문제로 단정했다");
});

test("오류에 어느 단계에서 깨졌는지와 상태코드가 담긴다", () => {
  const token = upstreamError(401, "", "토큰 발급");
  assert.match(token.message, /^토큰 발급:/);
  assert.match(token.message, /HTTP 401/);
  assert.equal(token.status, 401);
  assert.match(upstreamError(403, "", "잔고 조회").message, /^잔고 조회:/);
});

test("상류 본문을 안내 문구에 섞지 않는다", async () => {
  const fetchImpl = () => Promise.resolve(new Response("upstream internal trace", { status: 403 }));
  await assert.rejects(
    () => tossFetch("/api/v1/holdings", { token: "t", accountSeq: 1, fetchImpl }),
    (error) => {
      assert.ok(!error.message.includes("internal trace"), "안내 문구에 상류 본문이 섞였다");
      assert.match(error.message, /잔고 조회/);
      assert.equal(error.body, "upstream internal trace", "진단용 원문이 보존되지 않았다");
      return true;
    },
  );
});

// ── 토스 조회 (집 PC 데몬이 실행하는 경로) ─────────────────────────────

/** 응답 스크립트를 순서대로 돌려주는 fetch. 호출 기록을 남긴다. */
function fetchStub(script) {
  const calls = [];
  const impl = async (input, init) => {
    calls.push({ url: String(input), body: init?.body, token: init?.headers?.Authorization });
    const step = script.shift();
    if (!step) throw new Error(`예상치 못한 호출: ${input}`);
    return step(String(input), init);
  };
  return { impl, calls };
}

const tokenResponse = (value) => Response.json({ access_token: value, expires_in: 86400 });
const okAccounts = () => Response.json({ result: [{ accountNo: "123-45", accountSeq: 7, accountType: "BROKERAGE" }] });
const okHoldings = () => Response.json({ result: { items: [holding()] } });
const okStocks = () => Response.json({ result: [{ symbol: "005930", market: "KOSPI", securityType: "STOCK" }] });
const okCash = () => Response.json({ result: { cashBuyingPower: "1000", currency: "KRW" } });
const denied = (body = '{"error":{"code":"unidentified-client"}}') => () => new Response(body, { status: 401 });

async function runSink(script, options = {}) {
  const stub = fetchStub(script);
  const snapshot = await fetchSnapshot({
    clientId: "id", clientSecret: "secret", fetchImpl: stub.impl, ...options,
  });
  return { snapshot, calls: stub.calls };
}

test("잔고를 읽어 엣지로 올릴 스냅샷을 만든다", async () => {
  const { snapshot } = await runSink([
    () => tokenResponse("tok-1"), okAccounts, okHoldings, okStocks, okCash, okCash,
  ]);
  assert.equal(snapshot.byCurrency.KRW.value, 800000);
  assert.equal(snapshot.cash.KRW, 1000);
  assert.equal(snapshot.positions.length, 1);
  assert.match(snapshot.date, /^\d{4}-\d{2}-\d{2}$/);
});

// 토스는 client당 유효 토큰이 1개라, 다른 곳에서 발급하면 쓰던 토큰이 즉시 죽는다.
test("401이면 토큰을 새로 받아 한 번 재시도한다", async () => {
  const cache = memoryTokenCache();
  cache.write({ value: "죽은토큰", expiresAt: Date.now() + 3600_000, method: "basic" });

  const { snapshot, calls } = await runSink([
    () => new Response("unauthorized", { status: 401 }),  // 죽은 토큰으로 accounts
    () => tokenResponse("tok-2"),                          // 강제 재발급
    okAccounts, okHoldings, okStocks, okCash, okCash,
  ], { cache });

  assert.equal(snapshot.byCurrency.KRW.value, 800000);
  assert.equal(calls[0].token, "Bearer 죽은토큰");
  assert.match(calls[1].url, /\/oauth2\/token$/);
  assert.equal(cache.read().value, "tok-2", "새 토큰이 캐시되지 않았다");
});

test("토큰 캐시가 살아 있으면 재발급하지 않는다", async () => {
  const cache = memoryTokenCache();
  cache.write({ value: "tok-live", expiresAt: Date.now() + 3600_000, method: "basic" });
  const { calls } = await runSink([okAccounts, okHoldings, okStocks, okCash, okCash], { cache });
  assert.ok(!calls.some((call) => call.url.includes("/oauth2/token")), "토큰을 불필요하게 재발급했다");
});

test("basic 이 거부되면 post 방식으로 한 번 더 시도하고 통한 쪽을 기억한다", async () => {
  const cache = memoryTokenCache();
  const { calls } = await runSink([
    denied(), () => tokenResponse("tok-post"), okAccounts, okHoldings, okStocks, okCash, okCash,
  ], { cache });

  assert.match(calls[0].token, /^Basic /, "basic 을 먼저 시도하지 않았다");
  assert.equal(calls[1].token, undefined, "폴백이 basic 헤더를 그대로 달고 갔다");
  assert.equal(new URLSearchParams(calls[1].body).get("client_id"), "id");
  assert.equal(cache.read().method, "post", "통한 방식을 기억하지 않았다");
});

test("두 방식 모두 거부되면 단계와 상태코드를 담아 던진다", async () => {
  await assert.rejects(
    () => runSink([denied(), denied(), denied(), denied()]),
    (error) => {
      assert.match(error.message, /토큰 발급/);
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /API 키가 틀렸거나 허용 IP/);
      return true;
    },
  );
});

test("API 키 앞뒤 공백·줄바꿈을 털어내고 보낸다", async () => {
  const { calls } = await runSink(
    [() => tokenResponse("tok-1"), okHoldings, okCash, okCash],
    { clientId: "  id-1 ", clientSecret: "secret-1\n", accountSeq: 7 },
  );
  assert.equal(calls[0].token, `Basic ${Buffer.from("id-1:secret-1").toString("base64")}`);
});

test("accountSeq를 알면 계좌 목록을 조회하지 않는다", async () => {
  const { calls } = await runSink(
    [() => tokenResponse("tok-1"), okHoldings, okCash, okCash],
    { accountSeq: 42 },
  );
  assert.ok(!calls.some((call) => call.url.includes("/api/v1/accounts")), "계좌 목록을 불필요하게 조회했다");
  assert.ok(calls.some((call) => call.url.includes("/api/v1/holdings")));
});

// ── 엣지가 받는 스냅샷 검증 ────────────────────────────────────────────

const validPush = () => ({
  byCurrency: { KRW: { value: 100, cost: 90, pnl: 10, rate: 0.111 } },
  cash: { KRW: 5000 },
  positions: [{ symbol: "005930", name: "삼성전자", currency: "KRW", quantity: 1, value: 100 }],
});

test("정상 스냅샷은 통과하고 빠진 값은 0으로 채운다", () => {
  const snapshot = normalizeSnapshot(validPush(), Date.parse("2026-08-08T01:00:00Z"));
  assert.equal(snapshot.date, "2026-08-08");
  assert.equal(snapshot.byCurrency.KRW.value, 100);
  assert.equal(snapshot.positions[0].symbol, "005930");
  assert.equal(snapshot.positions[0].pnl, 0, "빠진 수치가 0으로 채워지지 않았다");
});

// 바깥에서 들어오는 값이라 통과시키지 말고 다시 지어서 쓴다.
test("망가진 스냅샷은 거부한다", () => {
  const broken = [
    null,
    "문자열",
    { ...validPush(), positions: "배열이 아님" },
    { ...validPush(), byCurrency: { KRW: { value: "숫자아님", cost: 0, pnl: 0, rate: 0 } } },
    { ...validPush(), byCurrency: { KRW: { value: Infinity, cost: 0, pnl: 0, rate: 0 } } },
    { ...validPush(), byCurrency: { "원화": { value: 1, cost: 1, pnl: 0, rate: 0 } } },
    { ...validPush(), cash: { KRW: "많음" } },
  ];
  for (const payload of broken) {
    assert.equal(normalizeSnapshot(payload), null, `거부됐어야 한다: ${JSON.stringify(payload)}`);
  }
});

// 시계가 어긋난 PC가 미래 날짜를 올리면 그래프가 영영 이상해진다.
test("날짜는 데몬 값이 아니라 받은 시각으로 다시 찍는다", () => {
  const snapshot = normalizeSnapshot(
    { ...validPush(), date: "2099-01-01", ts: 4102444800000 },
    Date.parse("2026-08-08T01:00:00Z"),
  );
  assert.equal(snapshot.date, "2026-08-08");
  assert.equal(snapshot.ts, Date.parse("2026-08-08T01:00:00Z"));
});

// ── 엣지 저장소 (InvestDO) ─────────────────────────────────────────────

/** DO storage 최소 스텁 — get/put/list({prefix})/delete(keys)만 쓴다. */
function storageStub() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async delete(keys) { for (const key of [].concat(keys)) map.delete(key); },
    async list({ prefix }) {
      return new Map([...map.entries()].filter(([key]) => key.startsWith(prefix)));
    },
  };
}

function investDO(storage = storageStub()) {
  const instance = new InvestDO({ storage }, {});
  return {
    storage,
    push: (payload) => instance.fetch(new Request("https://invest/push", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })),
    state: () => instance.fetch(new Request("https://invest/state", { method: "GET" })),
    refresh: () => instance.fetch(new Request("https://invest/refresh", { method: "POST" })),
    pending: () => instance.fetch(new Request("https://invest/pending")),
    served: (at, payload) => instance.fetch(new Request(`https://invest/push?served=${at}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })),
  };
}

test("올라온 스냅샷을 저장하고 화면 상태로 돌려준다", async () => {
  const server = investDO();
  assert.equal((await server.push(validPush())).status, 200);

  const state = await (await server.state()).json();
  assert.equal(state.byCurrency.KRW.value, 100);
  assert.equal(state.cash.KRW, 5000);
  assert.equal(state.positions.length, 1);
  assert.equal(state.stale, false);
  assert.equal(state.error, null);
  assert.equal(state.series.KRW.length, 1, "그래프 점이 남지 않았다");
});

test("아직 아무것도 안 올라왔으면 데몬을 확인하라고 알린다", async () => {
  const state = await (await investDO().state()).json();
  assert.match(state.error, /데몬/);
  assert.deepEqual(state.positions, []);
  assert.deepEqual(state.series, {});
});

test("망가진 스냅샷은 400으로 돌려주고 저장하지 않는다", async () => {
  const server = investDO();
  const response = await server.push({ positions: "배열이 아님" });
  assert.equal(response.status, 400);
  assert.equal(server.storage.map.get("latest"), undefined);
});

// 데몬이 멈춘 것을 화면이 알아야 한다 — 숫자는 있는데 그저께 것일 수 있다.
test("오래된 스냅샷은 stale 로 표시한다", async () => {
  const server = investDO();
  await server.push(validPush());
  const latest = server.storage.map.get("latest");
  server.storage.map.set("latest", { ...latest, ts: latest.ts - 2 * 24 * 60 * 60 * 1000 });

  const state = await (await server.state()).json();
  assert.equal(state.stale, true);
  assert.equal(state.byCurrency.KRW.value, 100, "오래됐다고 값을 숨기면 안 된다");
});

test("같은 날 다시 올리면 그날 점을 덮어쓴다", async () => {
  const server = investDO();
  await server.push(validPush());
  await server.push({ ...validPush(), byCurrency: { KRW: { value: 200, cost: 90, pnl: 110, rate: 1.22 } } });

  const state = await (await server.state()).json();
  assert.equal(state.series.KRW.length, 1, "같은 날인데 점이 늘었다");
  assert.equal(state.series.KRW[0].value, 200);
});

test("일별 스냅샷에는 종목 단위를 담지 않는다", async () => {
  const server = investDO();
  await server.push(validPush());
  const daily = [...server.storage.map.entries()].find(([key]) => key.startsWith("snap:"))[1];
  assert.ok(!("positions" in daily), "일별 스냅샷에 종목이 들어갔다");
});

// ── 배선 ───────────────────────────────────────────────────────────────

test("invest DO·마이그레이션이 등록돼 있다", () => {
  const wrangler = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, /"ENABLE_INVEST":\s*"(true|false)"/, "기능 플래그가 있어야 한다");
  assert.match(wrangler, /"name":\s*"INVEST",\s*"class_name":\s*"InvestDO"/);
  assert.match(wrangler, /"new_sqlite_classes":\s*\["InvestDO"\]/);
});

test("엣지는 토스 API 키를 알 필요가 없다", () => {
  const worker = readFileSync(join(ROOT, "_infra/worker.js"), "utf8");
  // 조회는 집 PC 데몬이 한다 — 워커가 키를 들고 있으면 구조가 되돌아간 것이다.
  assert.ok(!worker.includes("INVEST_CLIENT_SECRET"), "워커가 토스 시크릿을 참조한다");
  assert.match(worker, /!investPassword\(env\)/, "게이트 비밀번호를 요구하지 않는다");
  assert.match(worker, /env\.INVEST_SINK_SECRET/, "업로드 인증이 없다");
});

test("업로드 경로는 인증 없이는 열리지 않는다", () => {
  const worker = readFileSync(join(ROOT, "_infra/worker.js"), "utf8");
  const push = worker.slice(worker.indexOf('"/_invest/snapshot"'));
  assert.match(push.slice(0, 900), /matchesCredential/, "업로드가 secret 검증을 거치지 않는다");
});

test("워커가 InvestDO를 내보내고 invest를 noindex로 돌린다", () => {
  const worker = readFileSync(join(ROOT, "_infra/worker.js"), "utf8");
  assert.match(worker, /export \{ InvestDO \} from "\.\/invest\.js"/);
  // 목록 전체를 그대로 박아 두면 비공개 서브도메인이 하나 늘 때마다 invest 와
  // 상관없이 깨진다 — invest 가 그 안에 있는지만 본다.
  const noindex = worker.match(/if \((\["admin"[^\]]*\])\.includes\(site\)\) \{\n\s*const headers = new Headers/);
  assert.ok(noindex, "worker 의 noindex 목록을 찾지 못했다");
  assert.match(noindex[1], /"invest"/, "invest 가 noindex 목록에서 빠졌다");
  assert.match(worker, /return env\.INVEST_PASSWORD \|\| null;/);
});

test("데몬은 배포 산출물에 들어가지 않는다", () => {
  // _ 로 시작하는 폴더는 배포에서 빠진다. API 키를 다루는 코드라 더더욱 중요하다.
  assert.ok(existsSync(join(ROOT, "_src/invest-sink/index.mjs")));
  assert.ok(!existsSync(join(ROOT, "dist/invest-sink")));
  assert.ok(!existsSync(join(ROOT, "dist/_src")));
});

// ── 그룹 ───────────────────────────────────────────────────────────────
//
// 토스 앱의 종목 그룹은 API 로 내려오지 않는다(스펙 v1.2.13 전체에 group 필드가
// 없다). 그래서 그룹은 우리가 정하고, 여기서는 그 규칙만 검사한다.

test("parseGroupMap은 라벨:심볼 목록을 읽고 *를 기본값으로 삼는다", () => {
  const map = parseGroupMap("그룹 2:TSLA,NVDA;그룹 1:*");
  assert.equal(map.bySymbol.get("TSLA"), "그룹 2");
  assert.equal(map.bySymbol.get("NVDA"), "그룹 2");
  assert.equal(map.fallback, "그룹 1");
});

test("parseGroupMap은 심볼을 대문자로 맞추고 빈 조각을 버린다", () => {
  const map = parseGroupMap(" 성장:tsla ;;라벨없음;:심볼만");
  assert.equal(map.bySymbol.get("TSLA"), "성장");
  assert.equal(map.bySymbol.size, 1);
  assert.equal(map.fallback, null);
});

test("groupOf는 수동 지정 > 기본값 > 자동 분류 순으로 고른다", () => {
  const map = parseGroupMap("그룹 2:TSLA;그룹 1:*");
  const tsla = { symbol: "TSLA", market: "US" };
  const samsung = { symbol: "005930", market: "KR" };
  assert.equal(groupOf(tsla, { securityType: "STOCK" }, map), "그룹 2");
  assert.equal(groupOf(samsung, { securityType: "STOCK" }, map), "그룹 1");
  // 매핑이 없으면 자동 분류로 내려간다.
  assert.equal(groupOf(samsung, { securityType: "ETF" }, parseGroupMap("")), "국내 ETF");
});

test("autoGroupLabel은 종목정보가 없으면 아는 만큼만 쓴다", () => {
  assert.equal(autoGroupLabel({ market: "US" }, { securityType: "ETF" }), "미국 ETF");
  // 기본정보 조회가 실패하면 종목유형을 모른다 — ETF를 주식이라고 우기지 않는다.
  assert.equal(autoGroupLabel({ market: "US" }, undefined), "미국");
  assert.equal(autoGroupLabel({ market: "??" }, undefined), "기타");
});

test("aggregateGroups는 그룹 안에서도 통화를 섞지 않는다", () => {
  const byGroup = aggregateGroups([
    { group: "그룹 1", currency: "KRW", value: 100, cost: 80, pnl: 20 },
    { group: "그룹 1", currency: "USD", value: 10, cost: 20, pnl: -10 },
    { group: "그룹 1", currency: "KRW", value: 50, cost: 20, pnl: 30 },
  ]);
  assert.deepEqual(Object.keys(byGroup["그룹 1"]).sort(), ["KRW", "USD"]);
  assert.equal(byGroup["그룹 1"].KRW.value, 150);
  assert.equal(byGroup["그룹 1"].KRW.rate, 50 / 100);
  assert.equal(byGroup["그룹 1"].USD.rate, -10 / 20);
});

test("aggregateGroups는 원가 0인 그룹의 수익률을 0으로 둔다", () => {
  const byGroup = aggregateGroups([{ group: "정리", currency: "KRW", value: 0, cost: 0, pnl: 0 }]);
  assert.equal(byGroup["정리"].KRW.rate, 0);
});

test("normalizeSnapshot은 byGroup을 다시 지어 저장한다", () => {
  const snap = normalizeSnapshot({
    byCurrency: {}, cash: {}, positions: [],
    byGroup: { "그룹 1": { KRW: { value: 1, cost: 2, pnl: -1, rate: -0.5, 몰래: "x" } } },
  });
  assert.deepEqual(snap.byGroup, { "그룹 1": { KRW: { value: 1, cost: 2, pnl: -1, rate: -0.5, cash: 0 } } });
});

test("normalizeSnapshot은 망가진 byGroup을 거부한다", () => {
  const base = { byCurrency: {}, cash: {}, positions: [] };
  assert.equal(normalizeSnapshot({ ...base, byGroup: { g: { KRW: { value: "x" } } } }), null);
  assert.equal(normalizeSnapshot({ ...base, byGroup: { g: { krw: {} } } }), null);
  assert.equal(normalizeSnapshot({ ...base, byGroup: { g: null } }), null);
});

test("buildGroupSeries는 그룹→통화로 나눠 날짜순으로 세운다", () => {
  const series = buildGroupSeries([
    { date: "2026-08-12", byGroup: { A: { USD: { rate: 0.2, value: 12, pnl: 2 } } } },
    { date: "2026-08-11", byGroup: { A: { USD: { rate: 0.1, value: 11, pnl: 1 } } } },
  ]);
  assert.deepEqual(series.A.USD.map((p) => p.date), ["2026-08-11", "2026-08-12"]);
});

test("byGroup이 없던 날의 스냅샷은 그룹 시계열에서 그냥 빠진다", () => {
  // 그룹을 넣기 전에 쌓인 날은 되살릴 수 없다 — 조용히 건너뛰는 게 맞다.
  const series = buildGroupSeries([{ date: "2026-08-11" }, { date: "2026-08-12", byGroup: { A: { USD: { rate: 0.1 } } } }]);
  assert.deepEqual(Object.keys(series), ["A"]);
  assert.equal(series.A.USD.length, 1);
});

test("스냅샷에 그룹이 붙고 예수금 조회가 밀리지 않는다", async () => {
  // 종목 기본정보 조회가 holdings 와 buying-power 사이에 낀다. 순서가 어긋나면
  // 예수금 응답을 종목정보가 먹어서 통화 하나가 조용히 사라진다(실제로 그랬다).
  const usdCash = () => Response.json({ result: { cashBuyingPower: "50", currency: "USD" } });
  const { snapshot, calls } = await runSink(
    [() => tokenResponse("t"), okAccounts, okHoldings, okStocks, okCash, usdCash],
    { groups: "그룹 2:TSLA;그룹 1:*" },
  );

  assert.equal(snapshot.positions[0].group, "그룹 1", "매핑의 * 기본값이 안 붙었다");
  assert.deepEqual(snapshot.byGroup, {
    "그룹 1": {
      KRW: { value: 800000, cost: 700000, pnl: 100000, rate: 100000 / 700000, cash: 1000 },
      // USD 는 보유 종목 없이 예수금만 있는 통화 — 그래도 남아야 한다.
      USD: { value: 0, cost: 0, pnl: 0, rate: 0, cash: 50 },
    },
  });
  assert.equal(snapshot.cash.KRW, 1000);
  assert.equal(snapshot.cash.USD, 50, "USD 예수금이 사라졌다 — 호출 순서가 밀렸다");
  assert.ok(calls.some((c) => c.url.includes("/api/v1/stocks")), "종목 기본정보를 부르지 않았다");
});

test("종목 기본정보 조회가 실패해도 잔고는 올라간다", async () => {
  const { snapshot } = await runSink([
    () => tokenResponse("t"), okAccounts, okHoldings,
    () => new Response("boom", { status: 500 }),   // /stocks 실패
    okCash, okCash,
  ]);
  assert.equal(snapshot.byCurrency.KRW.value, 800000);
  // 종목유형을 모르므로 나라까지만 붙인다.
  assert.equal(snapshot.positions[0].group, "국내");
});

test("매핑이 없으면 종목유형으로 자동 분류한다", async () => {
  const etf = () => Response.json({ result: [{ symbol: "005930", market: "KOSPI", securityType: "ETF" }] });
  const { snapshot } = await runSink([
    () => tokenResponse("t"), okAccounts, okHoldings, etf, okCash, okCash,
  ]);
  assert.equal(snapshot.positions[0].group, "국내 ETF");
  assert.ok(snapshot.byGroup["국내 ETF"]);
});

// ── 예수금 ─────────────────────────────────────────────────────────────
//
// KRW 보유 종목이 하나도 없으면 KRW 예수금이 화면에서 통째로 사라지던 버그가
// 있었다. 조회는 멀쩡했고 집계·표시가 byCurrency 의 통화만 돌았던 게 원인이다.

test("보유 종목이 없는 통화의 예수금도 그룹에 남는다", () => {
  const byGroup = aggregateGroups(
    [{ group: "그룹 2", currency: "USD", value: 30, cost: 38, pnl: -8 }],
    { cash: { KRW: 200000, USD: 3.66 }, cashGroup: "그룹 1" },
  );
  // KRW 는 보유 종목이 없지만 예수금 때문에 그룹이 생겨야 한다.
  assert.equal(byGroup["그룹 1"].KRW.cash, 200000);
  assert.equal(byGroup["그룹 1"].KRW.value, 0);
  assert.equal(byGroup["그룹 1"].USD.cash, 3.66);
  assert.equal(byGroup["그룹 2"].USD.cash, 0, "예수금이 엉뚱한 그룹에 붙었다");
});

test("예수금은 평가금액·원가에 섞이지 않는다 (수익률이 희석되면 안 된다)", () => {
  const positions = [{ group: "그룹 1", currency: "KRW", value: 110, cost: 100, pnl: 10 }];
  const withCash = aggregateGroups(positions, { cash: { KRW: 1_000_000 }, cashGroup: "그룹 1" });
  const without = aggregateGroups(positions);
  assert.equal(withCash["그룹 1"].KRW.rate, without["그룹 1"].KRW.rate);
  assert.equal(withCash["그룹 1"].KRW.value, 110, "예수금이 평가금액에 얹혔다");
  assert.equal(withCash["그룹 1"].KRW.cost, 100, "예수금이 원가에 얹혔다");
});

test("0원인 예수금은 그룹을 만들지 않는다", () => {
  const byGroup = aggregateGroups([], { cash: { KRW: 0, USD: null }, cashGroup: "그룹 1" });
  assert.deepEqual(byGroup, {});
});

test("cashGroupOf는 지정 > * 그룹 > 기타 순으로 고른다", () => {
  const map = parseGroupMap("그룹 2:TSLA;그룹 1:*");
  assert.equal(cashGroupOf(map, "현금"), "현금");
  assert.equal(cashGroupOf(map), "그룹 1");
  assert.equal(cashGroupOf(parseGroupMap("성장:TSLA")), "기타");
});

test("예수금 필드가 없던 옛 스냅샷도 통과한다", () => {
  const snap = normalizeSnapshot({
    byCurrency: {}, cash: {}, positions: [],
    byGroup: { A: { KRW: { value: 1, cost: 1, pnl: 0, rate: 0 } } },
  });
  assert.equal(snap.byGroup.A.KRW.cash, 0);
});

test("스냅샷의 예수금이 그룹까지 흘러간다", async () => {
  const krwCash = () => Response.json({ result: { cashBuyingPower: "200000", currency: "KRW" } });
  const usdCash = () => Response.json({ result: { cashBuyingPower: "3.66", currency: "USD" } });
  const { snapshot } = await runSink(
    [() => tokenResponse("t"), okAccounts, okHoldings, okStocks, krwCash, usdCash],
    { groups: "그룹 2:005930;그룹 1:*" },
  );
  assert.equal(snapshot.cash.KRW, 200000);
  // 매핑에 * 가 그룹 1 이므로 예수금도 그룹 1 로 간다.
  assert.equal(snapshot.byGroup["그룹 1"].KRW.cash, 200000);
  assert.equal(snapshot.byGroup["그룹 2"].KRW.value, 800000);
});

test("메인 그룹은 * 그룹이고 스냅샷에 실려 화면까지 간다", async () => {
  const { snapshot } = await runSink(
    [() => tokenResponse("t"), okAccounts, okHoldings, okStocks, okCash, okCash],
    { groups: "그룹 2:TSLA;그룹 1:*" },
  );
  assert.equal(snapshot.mainGroup, "그룹 1");
  assert.equal(normalizeSnapshot(snapshot).mainGroup, "그룹 1");
});

test("메인 그룹은 이력이 아니라 설정이라 일별 스냅샷에는 남기지 않는다", async () => {
  const instance = investDO();
  await instance.push({
    byCurrency: {}, cash: {}, positions: [], mainGroup: "그룹 1",
    byGroup: { "그룹 1": { KRW: { value: 1, cost: 1, pnl: 0, rate: 0, cash: 5 } } },
  });
  const state = await (await instance.state()).json();
  assert.equal(state.mainGroup, "그룹 1", "최신 스냅샷에는 있어야 한다");
  assert.equal(state.groupSeries["그룹 1"].KRW.length, 1, "일별 스냅샷은 그대로 쌓여야 한다");
  // 일별 저장분에는 설정값이 들어가지 않는다.
  const daily = await instance.storage.get(`snap:${kstDate()}`);
  assert.ok(!("mainGroup" in daily), "일별 스냅샷에 설정값이 섞였다");
  assert.ok(!("positions" in daily), "일별 스냅샷에 종목이 섞였다");
});

// ── "지금 갱신" 요청 ────────────────────────────────────────────────────
//
// 엣지는 토스를 부를 수 없다(허용 IP). 그래서 버튼은 요청만 남기고 집 PC 데몬이
// 가져간다. 여기서 검사할 것은 그 주고받음이 어긋나지 않는지다.

test("갱신을 요청하면 데몬이 가져갈 수 있게 남는다", async () => {
  const server = investDO();
  assert.equal((await (await server.pending()).json()).pending, false);

  const asked = await (await server.refresh()).json();
  assert.equal(asked.ok, true);

  const pending = await (await server.pending()).json();
  assert.equal(pending.pending, true);
  assert.equal(pending.at, asked.at);
  // 화면을 새로 열어도 기다리는 중인 걸 알 수 있어야 한다.
  assert.equal((await (await server.state()).json()).refreshPending, true);
});

test("데몬이 처리하면 요청이 지워진다", async () => {
  const server = investDO();
  const { at } = await (await server.refresh()).json();
  await server.served(at, validPush());
  assert.equal((await (await server.pending()).json()).pending, false);
});

test("조회하는 사이에 다시 누른 요청은 남겨 둔다", async () => {
  const server = investDO();
  const first = (await (await server.refresh()).json()).at;
  // 데몬이 조회하는 동안 사용자가 한 번 더 눌렀다.
  await server.storage.put("refresh", { at: first + 5000 });
  await server.served(first, validPush());
  const pending = await (await server.pending()).json();
  assert.equal(pending.pending, true, "더 최신 요청까지 지워 버렸다");
  assert.equal(pending.at, first + 5000);
});

test("오래된 요청은 없는 셈 친다 (PC가 한참 꺼져 있던 경우)", async () => {
  const server = investDO();
  await server.storage.put("refresh", { at: Date.now() - REFRESH_TTL_MS - 1000 });
  assert.equal((await (await server.pending()).json()).pending, false);
  assert.equal((await (await server.state()).json()).refreshPending, false);
});

test("served 없이 올린 정기 스냅샷은 대기 중인 요청을 지우지 않는다", async () => {
  const server = investDO();
  await server.refresh();
  await server.push(validPush());   // 22시 정기 업로드
  assert.equal((await (await server.pending()).json()).pending, true);
});

// 형태만 보던 시절, 검증용 빈 페이로드 한 방이 그날 스냅샷을 덮어써서 복구해야
// 했다. 형태(normalizeSnapshot)와 별개로 **내용**이 비었는지까지 본다.
test("빈 스냅샷은 살아 있는 값을 덮지 않는다", async () => {
  const server = investDO();
  await server.push(validPush());

  const empty = { byCurrency: {}, cash: {}, positions: [] };
  const response = await server.push(empty);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /empty/);

  const state = await (await server.state()).json();
  assert.equal(state.byCurrency.KRW.value, 100, "빈 값으로 덮였다");
  assert.equal(state.positions.length, 1);
  assert.equal(state.series.KRW.length, 1, "그날 그래프 점이 날아갔다");
});

test("합계가 0뿐인 페이로드도 빈 것으로 본다 (조회 실패의 흔한 모습)", async () => {
  const server = investDO();
  await server.push(validPush());
  const zeros = {
    byCurrency: { KRW: { value: 0, cost: 0, pnl: 0, rate: 0 } },
    cash: { KRW: 0 },
    positions: [],
  };
  assert.equal((await server.push(zeros)).status, 409);
  assert.equal((await (await server.state()).json()).byCurrency.KRW.value, 100);
});

test("첫 스냅샷이 비어 있는 것은 막지 않는다 (아직 덮을 값이 없다)", async () => {
  const server = investDO();
  const response = await server.push({ byCurrency: {}, cash: {}, positions: [] });
  assert.equal(response.status, 200);
});

test("정말 빈 계좌는 allowEmpty로 명시해 올린다", async () => {
  const server = investDO();
  await server.push(validPush());
  const instance = new InvestDO({ storage: server.storage }, {});
  const response = await instance.fetch(new Request("https://invest/push?allowEmpty=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ byCurrency: {}, cash: {}, positions: [] }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await (await server.state()).json()).positions.length, 0);
});

test("isEmptySnapshot은 보유종목이 있으면 비었다고 하지 않는다", () => {
  assert.equal(isEmptySnapshot(null), true);
  assert.equal(isEmptySnapshot({ positions: [], byCurrency: {}, cash: {} }), true);
  assert.equal(isEmptySnapshot({ positions: [{ symbol: "005930" }] }), false);
  assert.equal(isEmptySnapshot({ byCurrency: { KRW: { value: 1, cost: 0 } } }), false);
  assert.equal(isEmptySnapshot({ cash: { KRW: 5000 } }), false);
});
