import test from "node:test";
import assert from "node:assert/strict";

import {
  assertChatWelcome,
  assertDuriStatus,
  assertHealth,
  assertInvestState,
  assertLifeStatus,
  assertStats,
  assertCatalog,
  assetCategories,
  buildProbes,
  createChecks,
  credsFromEnv,
  GATED_SITES,
  kstDate,
  listSites,
  parseArgs,
  runProbes,
  Warning,
} from "./verify-prod.mjs";

const COMMIT = "a".repeat(40);
const at = (checks) => checks.failures.map((f) => f.at);

const health = (over = {}) => ({
  ok: true,
  commit: COMMIT,
  builtAt: "2026-08-12T00:00:00.000Z",
  siteCount: 12,
  date: kstDate(),
  bindings: { ASSETS: true, INVEST: true },
  ...over,
});

test("정상 health 는 통과한다", () => {
  const checks = createChecks();
  assertHealth(health(), checks, { expectedCommit: COMMIT });
  assert.deepEqual(checks.failures, []);
});

// 이게 없으면 옛 배포를 검사하고 "통과"라고 말하게 된다.
test("서빙 중인 커밋이 배포한 커밋과 다르면 실패한다", () => {
  const checks = createChecks();
  assertHealth(health({ commit: "b".repeat(40) }), checks, { expectedCommit: COMMIT });
  assert.ok(at(checks).some((label) => label.includes("배포한 커밋")));
});

test("바인딩이 빠진 배포를 잡는다", () => {
  const checks = createChecks();
  assertHealth(health({ bindings: { ASSETS: true, INVEST: false } }), checks, {});
  assert.deepEqual(at(checks), ["health.bindings.INVEST"]);
});

test("health 날짜가 KST 가 아니면 실패한다 (타임존이 새는 자리)", () => {
  const checks = createChecks();
  assertHealth(health({ date: "1999-01-01" }), checks, {});
  assert.deepEqual(at(checks), ["health.date (KST)"]);
});

test("stats 날짜는 KST 오늘이어야 한다", () => {
  const good = createChecks();
  assertStats({ date: kstDate(), days: 7, pages: { www: 3 } }, good);
  assert.deepEqual(good.failures, []);

  const bad = createChecks();
  assertStats({ date: "2020-01-01", days: 7, pages: { www: 3 } }, bad);
  assert.deepEqual(at(bad), ["stats.date (KST)"]);
});

test("빈 집계는 통과시키지 않는다", () => {
  const checks = createChecks();
  assertStats({ date: kstDate(), days: 7, pages: {} }, checks);
  assert.deepEqual(at(checks), ["stats.pages"]);
});

const investState = (over = {}) => ({
  updatedAt: Date.now(),
  byCurrency: { KRW: { value: 1_000_000, cost: 900_000, pnl: 100_000, rate: 0.11 } },
  positions: [{ symbol: "005930", value: 1_000_000 }],
  series: { KRW: [{ date: kstDate(), value: 1_000_000 }] },
  stale: false,
  ...over,
});

test("정상 잔고 상태는 통과한다", () => {
  const checks = createChecks();
  assertInvestState(investState(), checks);
  assert.deepEqual(checks.failures, []);
});

// 과거 사고의 회귀 테스트: 200 이어도 안이 비어 있으면 실패여야 한다.
test("빈 값으로 덮인 잔고를 잡는다", () => {
  const checks = createChecks();
  assertInvestState({
    updatedAt: Date.now(), byCurrency: {}, positions: [], series: {}, stale: false,
  }, checks);
  const labels = at(checks);
  assert.ok(labels.includes("invest.byCurrency"));
  assert.ok(labels.includes("invest.positions"));
  assert.ok(labels.includes("invest.series"));
});

test("합계가 전부 0인 잔고도 잡는다", () => {
  const checks = createChecks();
  assertInvestState(investState({
    byCurrency: { KRW: { value: 0, cost: 0, pnl: 0, rate: 0 } },
  }), checks);
  assert.ok(at(checks).some((label) => label.includes("전부 0이 아님")));
});

test("스냅샷이 아예 없으면(updatedAt null) 실패한다", () => {
  const checks = createChecks();
  assertInvestState(investState({ updatedAt: null }), checks);
  assert.ok(at(checks).includes("invest.updatedAt"));
});

// 집 PC 데몬이 꺼져 있는 것은 배포 잘못이 아니다 — 되돌리지 않고 경고만.
test("오래된 잔고는 경고지 실패가 아니다", () => {
  const checks = createChecks();
  assert.throws(() => assertInvestState(investState({ stale: true }), checks), Warning);
  assert.deepEqual(checks.failures, []);
});

test("duri 상태: ack 가 head 를 넘어서면 실패", () => {
  const checks = createChecks();
  assertDuriStatus({ head: 3, ackSeq: 9, buffered: 0, cal: 0, pending: 0 }, checks);
  assert.ok(at(checks).some((label) => label.includes("ackSeq <= head")));
});

test("duri 상태: 밀린 큐는 경고", () => {
  const checks = createChecks();
  assert.throws(
    () => assertDuriStatus({ head: 900, ackSeq: 100, buffered: 800, cal: 2, pending: 800 }, checks),
    Warning,
  );
});

test("채팅 welcome 형태를 본다", () => {
  const good = createChecks();
  assertChatWelcome({ type: "welcome", id: "a1", nick: "손님", online: [{ id: "a1" }], max: 10 }, good);
  assert.deepEqual(good.failures, []);

  const bad = createChecks();
  assertChatWelcome({ type: "error", error: "rate" }, bad);
  assert.ok(at(bad).includes("chat.welcome.type"));
});

test("카탈로그 항목의 필수 필드를 본다", () => {
  const checks = createChecks();
  assertCatalog({ version: 1, items: [{ id: "x", title: "", category: "sticker" }] }, checks);
  assert.ok(at(checks).some((label) => label.includes("title")));
  assert.ok(at(checks).includes("catalog.items"));
});

test("배포되는 폴더만 사이트로 센다", () => {
  const sites = listSites();
  assert.ok(sites.includes("www"));
  assert.ok(sites.includes("slop"));
  assert.ok(!sites.some((name) => name.startsWith("_") || name.startsWith(".")));
  assert.ok(!sites.includes("dist"));
  assert.ok(!sites.includes("node_modules"));
});

test("모든 서브도메인에 첫 화면 프로브가 하나씩 생긴다", () => {
  const sites = listSites();
  const probes = buildProbes({ sites, expectedCommit: COMMIT, ws: true });
  for (const site of sites) {
    assert.ok(probes.some((probe) => probe.id === `site:${site}`), `${site} 프로브가 없다`);
  }
  assert.equal(new Set(probes.map((p) => p.id)).size, probes.length, "프로브 id 가 겹친다");
  // 게이트 뒤 서브도메인은 worker.js 의 분기와 같아야 한다.
  assert.deepEqual([...GATED_SITES].sort(), ["admin", "duri", "invest", "life"]);
});

test("life status는 숫자 메타데이터만 허용한다", () => {
  const checks = createChecks();
  assertLifeStatus({ protocol: 1, head: 3, oldestSeq: 1, entityCount: 2,
    currentBytes: 300, sinkAckSeq: 1, sinkLag: 2 }, checks);
  assert.deepEqual(checks.failures, []);
  const leaked = createChecks();
  assertLifeStatus({ protocol: 1, head: 0, oldestSeq: 1, entityCount: 0,
    currentBytes: 0, sinkAckSeq: 0, sinkLag: 0, entities: [] }, leaked);
  assert.ok(at(leaked).includes("life status has no entity bodies"));
});

test("커밋을 지정하지 않으면 health 프로브는 경고로만 다룬다", () => {
  const withCommit = buildProbes({ sites: [], expectedCommit: COMMIT, ws: false });
  const without = buildProbes({ sites: [], expectedCommit: null, ws: false });
  assert.equal(withCommit.find((p) => p.id === "health").soft, false);
  assert.equal(without.find((p) => p.id === "health").soft, true);
});

test("자격증명이 없으면 게이트 안쪽은 SKIP (거짓 실패를 만들지 않는다)", async () => {
  const creds = credsFromEnv({});
  const probes = [{
    id: "invest:state", surface: "do", title: "잔고", needs: "invest",
    run: () => { throw new Error("불려서는 안 된다"); },
  }];
  const [result] = await runProbes(probes, { creds });
  assert.equal(result.state, "SKIP");
  assert.match(result.note, /자격증명/);
});

test("검사 실패는 기대값·실제값과 함께 FAIL 로 남는다", async () => {
  const probes = [{
    id: "x", surface: "worker", title: "예시",
    run: ({ checks }) => checks.eq("status", 500, 200),
  }];
  const [result] = await runProbes(probes, { creds: credsFromEnv({}) });
  assert.equal(result.state, "FAIL");
  assert.deepEqual(result.failures, [{ at: "status", expected: "200", actual: "500" }]);
});

test("soft 프로브의 실패는 WARN 이다 (배포를 되돌리지 않는다)", async () => {
  const probes = [{
    id: "브리핑", surface: "worker", title: "상류 의존", soft: true,
    run: () => { throw new Error("상류 503"); },
  }];
  const [result] = await runProbes(probes, { creds: credsFromEnv({}) });
  assert.equal(result.state, "WARN");
});

test("옵션 파싱", () => {
  const args = parseArgs(["--domain", "example.dev", "--commit", COMMIT, "--wait", "60", "--no-ws", "--json"]);
  assert.equal(args.domain, "example.dev");
  assert.equal(args.commit, COMMIT);
  assert.equal(args.waitMs, 60_000);
  assert.equal(args.ws, false);
  assert.equal(args.json, true);
  assert.throws(() => parseArgs(["--nope"]), /알 수 없는 옵션/);
});

test("카탈로그 카테고리는 _assets/ 폴더에서 읽는다 (하드코딩 금지)", () => {
  const categories = assetCategories();
  assert.ok(categories.includes("wallpaper"));
  assert.ok(categories.includes("sticker"));
  const checks = createChecks();
  // 새 카테고리 폴더가 생겨도 거짓 실패가 나면 안 된다.
  assertCatalog(
    { version: 1, items: Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, title: "t", category: categories[0] })) },
    checks, { categories });
  assert.deepEqual(checks.failures, []);
});
