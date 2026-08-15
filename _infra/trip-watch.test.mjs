// 항공권 가격 관측(trip/ 계획 탭) 검사.
// 여기서 제일 중요한 건 "예매가와 참고가를 섞지 않는다" 는 것 — 참고가를
// 예매가처럼 보여 주면 예산 전체가 거짓말이 된다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRID_LIMITS, buildDateGrid, comboKey, validateWatch, parseAmadeusOffers,
  amadeusConfig, createFlightProvider, mockPrice, summarizeObservations, pickStaleCombos,
} from "./trip-flights.js";
import { TripWatchDO } from "./trip-watch.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── 날짜 그리드 ─────────────────────────────────────────────────────── */

test("그리드는 출발 구간 × 밤수 범위의 모든 조합이다", () => {
  const combos = buildDateGrid({ from: "2026-09-01", to: "2026-09-03", minNights: 3, maxNights: 4 });
  assert.equal(combos.length, 6, "출발 3일 × 밤수 2가지");
  assert.deepEqual(combos[0], { depart: "2026-09-01", ret: "2026-09-04", nights: 3 });
  assert.deepEqual(combos.at(-1), { depart: "2026-09-03", ret: "2026-09-07", nights: 4 });
});

test("편도는 귀국일이 없다", () => {
  const combos = buildDateGrid({ from: "2026-09-01", to: "2026-09-02", oneWay: true });
  assert.deepEqual(combos, [
    { depart: "2026-09-01", ret: null, nights: null },
    { depart: "2026-09-02", ret: null, nights: null },
  ]);
  assert.equal(comboKey(combos[0]), "2026-09-01:-");
});

test("구간이 거꾸로거나 날짜가 깨졌으면 빈 그리드", () => {
  assert.deepEqual(buildDateGrid({ from: "2026-09-05", to: "2026-09-01" }), []);
  assert.deepEqual(buildDateGrid({ from: "2026-02-31", to: "2026-03-05" }), []);
  assert.deepEqual(buildDateGrid({ from: "", to: "" }), []);
});

/* ── watch 검사 ──────────────────────────────────────────────────────── */

const baseWatch = {
  origin: "icn", dest: "uln", from: "2026-09-01", to: "2026-09-07",
  minNights: 5, maxNights: 7,
};

test("watch 는 IATA 3글자와 기간을 요구한다", () => {
  assert.deepEqual(validateWatch({ ...baseWatch, origin: "서울" }).errors,
    ["출발지는 IATA 3글자여야 합니다 (예: ICN)"]);
  assert.match(validateWatch({ ...baseWatch, dest: "ICN" }).errors.join(), /같습니다/);
  assert.match(validateWatch({ ...baseWatch, to: "2026-08-01" }).errors.join(), /끝이 시작보다/);
});

test("정상 watch 는 코드를 대문자로 올리고 기본값을 채운다", () => {
  const { watch, combos, errors } = validateWatch(baseWatch);
  assert.deepEqual(errors, []);
  assert.equal(watch.origin, "ICN");
  assert.equal(watch.dest, "ULN");
  assert.equal(watch.cabin, "ECONOMY");
  assert.equal(watch.currency, "KRW");
  assert.equal(watch.adults, 1);
  assert.equal(watch.label, "ICN→ULN");
  assert.equal(combos.length, 21, "출발 7일 × 밤수 3가지");
});

test("조합이 상한을 넘으면 거절한다 — 쿼터가 하루치 예산이다", () => {
  const { errors } = validateWatch({
    ...baseWatch, from: "2026-09-01", to: "2026-10-30", minNights: 3, maxNights: 10,
  });
  assert.match(errors.join(), new RegExp(`${GRID_LIMITS.maxCombos}개까지만`));
});

test("인원은 1~9로 눌리고 모르는 좌석등급은 이코노미로 떨어진다", () => {
  const { watch } = validateWatch({ ...baseWatch, adults: 99, cabin: "SUITE" });
  assert.equal(watch.adults, 9);
  assert.equal(watch.cabin, "ECONOMY");
  assert.equal(validateWatch({ ...baseWatch, adults: 0 }).watch.adults, 1);
});

/* ── Amadeus 응답 파싱 ───────────────────────────────────────────────── */

const offer = (total, segs) => ({
  price: { grandTotal: total, currency: "KRW" },
  itineraries: segs.map((s) => ({ segments: s })),
});
const seg = (carrier, number) => ({ carrierCode: carrier, number });

test("가장 싼 offer 하나를 뽑고 경유는 나쁜 쪽을 대표값으로 둔다", () => {
  const best = parseAmadeusOffers({
    data: [
      offer("980000", [[seg("KE", "867")], [seg("KE", "868")]]),
      offer("640000", [[seg("OM", "302")], [seg("OM", "301"), seg("OM", "305")]]),
    ],
  });
  assert.equal(best.price, 640000);
  assert.equal(best.currency, "KRW");
  assert.equal(best.carrier, "OM");
  assert.equal(best.stops, 1, "왕복 중 한쪽이 1경유면 1경유로 본다");
  assert.equal(best.flights, "OM302 OM301 OM305");
});

test("가격이 없는 offer 는 무시하고, 하나도 없으면 null", () => {
  assert.equal(parseAmadeusOffers({ data: [{ price: { grandTotal: "" } }] }), null);
  assert.equal(parseAmadeusOffers({ data: [] }), null);
  assert.equal(parseAmadeusOffers(null), null);
  const best = parseAmadeusOffers({
    data: [{ price: { grandTotal: "abc" } }, offer("500000", [[seg("KE", "1")]])],
  });
  assert.equal(best.price, 500000);
});

/* ── 프로바이더 선택 ─────────────────────────────────────────────────── */

test("실제 예매가는 프로덕션 키일 때만 예매가로 센다", () => {
  assert.equal(amadeusConfig({ AMADEUS_ENV: "production" }).bookable, true);
  assert.equal(amadeusConfig({ AMADEUS_ENV: "test" }).bookable, false);
  assert.equal(amadeusConfig({}).bookable, false, "기본값은 테스트 환경이라 참고가다");
  assert.match(amadeusConfig({ AMADEUS_ENV: "production" }).host, /^https:\/\/api\.amadeus\.com$/);
});

test("프로바이더는 env 하나로 갈아끼운다", () => {
  assert.equal(createFlightProvider({}).name, "mock", "키가 없으면 목업");
  assert.equal(createFlightProvider({ AMADEUS_CLIENT_ID: "x" }).name, "amadeus/test");
  const sink = createFlightProvider({ TRIP_FLIGHT_PROVIDER: "sink" });
  assert.equal(sink.live, false, "데몬 방식은 엣지가 조회하지 않는다");
  assert.equal(sink.bookable, true);
});

test("목업은 절대 예매가가 아니다", async () => {
  const provider = createFlightProvider({ TRIP_FLIGHT_PROVIDER: "mock" });
  const quote = await provider.quote({ origin: "ICN", dest: "ULN", depart: "2026-09-01", adults: 1 });
  assert.equal(quote.bookable, false);
  assert.equal(provider.bookable, false);
});

test("목업 가격은 같은 입력이면 같다 — 그래프가 이유 없이 요동치면 안 된다", () => {
  const q = { origin: "ICN", dest: "ULN", depart: "2026-09-01", ret: "2026-09-06" };
  assert.equal(mockPrice(q), mockPrice({ ...q }));
  assert.notEqual(mockPrice(q), mockPrice({ ...q, depart: "2026-09-02" }));
});

/* ── 집계 ────────────────────────────────────────────────────────────── */

const obs = (depart, ret, price, extra = {}) =>
  ({ depart, ret, price, bookable: true, observedAt: 1000, ...extra });

test("집계는 최저가·출발일별 최저가·추이를 한 번에 낸다", () => {
  const s = summarizeObservations({ id: "w1" }, [
    obs("2026-09-02", "2026-09-07", 720000),
    obs("2026-09-01", "2026-09-06", 880000),
    obs("2026-09-01", "2026-09-07", 810000),
  ], [
    { date: "2026-08-14", min: 900000 },
    { date: "2026-08-15", min: 720000 },
  ]);
  assert.equal(s.best.price, 720000);
  assert.equal(s.cells[0].depart, "2026-09-01", "격자는 출발일 순으로 정렬된다");
  assert.equal(s.departures.length, 2);
  assert.equal(s.departures.find((d) => d.depart === "2026-09-01").price, 810000);
  assert.equal(s.change, 720000 - 900000, "직전 관측일 대비 변화");
  assert.equal(s.stats.min, 720000);
  assert.equal(s.stats.max, 880000);
  assert.equal(s.stats.bookable, true);
  assert.equal(s.stats.reference, false);
});

test("관측이 한 점뿐이면 변화는 null이다 (0%는 '안정적'으로 오해된다)", () => {
  const s = summarizeObservations({}, [obs("2026-09-01", null, 500000)],
    [{ date: "2026-08-15", min: 500000 }]);
  assert.equal(s.change, null);
});

test("참고가가 하나라도 섞이면 reference 로 표시된다", () => {
  const s = summarizeObservations({}, [
    obs("2026-09-01", null, 500000),
    obs("2026-09-02", null, 400000, { bookable: false }),
  ]);
  assert.equal(s.stats.reference, true, "참고가가 섞였는데 예매가처럼 보이면 안 된다");
  assert.equal(s.stats.bookable, true);
});

test("가격이 0이거나 숫자가 아닌 관측은 격자에서 빠진다", () => {
  const s = summarizeObservations({}, [
    obs("2026-09-01", null, 0),
    obs("2026-09-02", null, Number.NaN),
    obs("2026-09-03", null, 300000),
  ]);
  assert.equal(s.cells.length, 1);
  assert.equal(s.best.price, 300000);
});

test("갱신은 한 번도 못 본 조합부터, 그다음 오래된 것부터", () => {
  const combos = [
    { depart: "2026-09-01", ret: "2026-09-06" },
    { depart: "2026-09-02", ret: "2026-09-07" },
    { depart: "2026-09-03", ret: "2026-09-08" },
  ];
  const picked = pickStaleCombos(combos, [
    { depart: "2026-09-01", ret: "2026-09-06", observedAt: 500 },
    { depart: "2026-09-03", ret: "2026-09-08", observedAt: 100 },
  ], 2);
  assert.deepEqual(picked.map((c) => c.depart), ["2026-09-02", "2026-09-03"]);
});

/* ── DO ──────────────────────────────────────────────────────────────── */

function storageStub() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.get(key); },
    async put(key, value) {
      // 실제 DO storage 처럼 객체 일괄 put 도 받는다
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

test("watch 를 만들고 관측을 넣으면 격자와 추이가 나온다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, { TRIP_FLIGHT_PROVIDER: "mock" });

  const created = await (await call(dо, "/watches", post({ ...baseWatch, id: "w1" }))).json();
  assert.equal(created.watch.id, "w1");
  assert.equal(created.combos, 21);

  await call(dо, "/observe", post({
    watchId: "w1",
    observations: [
      { depart: "2026-09-01", ret: "2026-09-06", price: 810000, bookable: true, carrier: "KE" },
      { depart: "2026-09-02", ret: "2026-09-07", price: 720000, bookable: true, carrier: "OM" },
    ],
  }));

  const grid = await (await call(dо, "/grid?watch=w1")).json();
  assert.equal(grid.cells.length, 2);
  assert.equal(grid.best.price, 720000);
  assert.equal(grid.history.length, 1, "관측일 하나 = 점 하나");
  assert.equal(grid.history[0].min, 720000);
});

test("같은 날 다시 관측하면 추이의 점은 더 싼 값으로만 내려간다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  await call(dо, "/watches", post({ ...baseWatch, id: "w1" }));

  await call(dо, "/observe", post({ watchId: "w1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 800000 }] }));
  await call(dо, "/observe", post({ watchId: "w1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 600000 }] }));
  let grid = await (await call(dо, "/grid?watch=w1")).json();
  assert.equal(grid.history.length, 1, "하루에 점 하나만 남는다");
  assert.equal(grid.history[0].min, 600000);

  // 더 비싼 관측이 와도 그날 "잡을 수 있었던 최저가"는 올라가지 않는다
  await call(dо, "/observe", post({ watchId: "w1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 950000 }] }));
  grid = await (await call(dо, "/grid?watch=w1")).json();
  assert.equal(grid.history[0].min, 600000);
  assert.equal(grid.cells[0].price, 950000, "격자 칸은 최신 관측을 보여 준다");
});

test("없는 watch 로는 관측을 넣을 수 없다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  const res = await call(dо, "/observe", post({ watchId: "없음", observations: [{ depart: "2026-09-01", price: 1 }] }));
  assert.equal(res.status, 404);
});

test("watch 를 지우면 관측·추이도 같이 지워진다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  await call(dо, "/watches", post({ ...baseWatch, id: "w1" }));
  await call(dо, "/observe", post({ watchId: "w1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 800000 }] }));
  await call(dо, "/watches/w1", { method: "DELETE" });

  assert.equal([...storage.map.keys()].filter((k) => k.includes("w1")).length, 0);
  assert.equal((await (await call(dо, "/grid?watch=w1")).json()).error, "watch not found");
});

test("watch 개수 상한이 있다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  for (let i = 0; i < GRID_LIMITS.maxWatches; i += 1) {
    const res = await call(dо, "/watches", post({ ...baseWatch, id: `w${i}` }));
    assert.equal(res.status, 200);
  }
  const over = await call(dо, "/watches", post({ ...baseWatch, id: "over" }));
  assert.equal(over.status, 400);
  // 기존 watch 수정은 상한에 걸리지 않는다
  assert.equal((await call(dо, "/watches", post({ ...baseWatch, id: "w0", label: "수정" }))).status, 200);
});

test("cron 갱신은 limit 만큼만 조회하고 커서를 남긴다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, { TRIP_FLIGHT_PROVIDER: "mock" });
  await call(dо, "/watches", post({ ...baseWatch, id: "w1" }));

  const first = await (await call(dо, "/refresh", post({ limit: 5 }))).json();
  assert.equal(first.runs[0].refreshed, 5, "한 번에 그리드 전체를 돌리지 않는다");
  assert.ok(await storage.get("cursor:w1"));

  // 두 번째 갱신은 아직 못 본 조합으로 넘어간다
  await call(dо, "/refresh", post({ limit: 5 }));
  const grid = await (await call(dо, "/grid?watch=w1")).json();
  assert.equal(grid.cells.length, 10);
  assert.equal(grid.stats.reference, true, "목업 관측은 참고가로 표시된다");
});

test("데몬 방식(sink)일 때 엣지는 조회하지 않는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, { TRIP_FLIGHT_PROVIDER: "sink" });
  await call(dо, "/watches", post({ ...baseWatch, id: "w1" }));
  const out = await (await call(dо, "/refresh", post({ limit: 5 }))).json();
  assert.equal(out.runs[0].refreshed, 0);
  assert.match(out.runs[0].skipped, /^provider:sink$/);
});

test("멈춘 watch 는 갱신하지 않는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, { TRIP_FLIGHT_PROVIDER: "mock" });
  await call(dо, "/watches", post({ ...baseWatch, id: "w1", active: false }));
  const out = await (await call(dо, "/refresh", post({ limit: 5 }))).json();
  assert.deepEqual(out.runs, [], "활성 watch 만 갱신 대상이다");
});

/* ── 배선 ────────────────────────────────────────────────────────────── */

test("워커가 TripWatchDO를 내보내고 /_trip 을 라우팅한다", () => {
  const worker = readFileSync(join(ROOT, "_infra/worker.js"), "utf8");
  assert.match(worker, /export \{ TripWatchDO \} from "\.\/trip-watch\.js"/);
  assert.match(worker, /path\.startsWith\("\/_trip\/"\)/);
  // 기능 플래그·바인딩이 없으면 열리지 않는다 (fail-closed)
  const handler = worker.slice(worker.indexOf("async function handleTripWatch"));
  assert.match(handler.slice(0, 700), /featureEnabled\(env, "ENABLE_TRIP_WATCH"\)/);
  assert.match(handler.slice(0, 700), /if \(!env\.TRIP_WATCH\)/);
});

test("쓰기는 토큰 없이 열리지 않고, 데몬 push 는 별도 secret 이다", () => {
  const worker = readFileSync(join(ROOT, "_infra/worker.js"), "utf8");
  const handler = worker.slice(worker.indexOf("async function handleTripWatch"));
  const body = handler.slice(0, handler.indexOf("async function handleDuri"));
  // GET 만 무인증 — 그 뒤로 토큰 검사가 반드시 있다
  assert.match(body, /validSession\(key, bearer\)/);
  assert.match(body, /return new Response\("authentication required", \{ status: 401 \}\)/);
  assert.match(body, /env\.TRIP_SINK_SECRET/);
  // 쓰기 경로가 토큰 검사보다 앞에 오면 안 된다
  assert.ok(body.indexOf("validSession(key, bearer)") < body.indexOf('path === "/watches" && request.method === "POST"'),
    "watch 생성이 인증보다 먼저 처리되고 있다");
});

test("wrangler 에 DO 바인딩·cron·기능 플래그가 있다", () => {
  const config = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  assert.match(config, /"name": "TRIP_WATCH", "class_name": "TripWatchDO"/);
  // 바인딩만 있고 migration 이 없으면 배포가 통째로 실패한다 (새 DO 클래스는
  // 반드시 migration 태그가 있어야 한다).
  assert.match(config, /"new_sqlite_classes": \["TripWatchDO"\]/);
  assert.match(config, /"20 \*\/6 \* \* \*"/);
  assert.match(config, /"ENABLE_TRIP_WATCH": "true"/);
  // 자격증명은 secret 목록에만 있고 값이 박혀 있으면 안 된다
  assert.match(config, /"AMADEUS_CLIENT_SECRET"/);
  assert.ok(!/AMADEUS_CLIENT_SECRET"\s*:/.test(config), "secret 값이 설정에 박혔다");
});
