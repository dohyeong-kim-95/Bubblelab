// 항공권 가격 관측(trip/ 계획 탭) 검사.
// 여기서 제일 중요한 건 "예매가와 참고가를 섞지 않는다" 는 것 — 참고가를
// 예매가처럼 보여 주면 예산 전체가 거짓말이 된다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRID_LIMITS, buildDateGrid, comboKey, validateDestination, flightGrid, findFlight,
  parseAmadeusOffers, amadeusConfig, createFlightProvider, mockPrice, qualityOf,
  summarizeObservations, summarizeChecks, pickStaleCombos,
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
  name: "몽골", country: "mn", from: "2026-09-01", to: "2026-09-07",
  minNights: 5, maxNights: 7,
  flights: [{ origin: "icn", dest: "uln" }],
};
const withFlight = (patch) => ({ ...baseWatch, flights: [{ origin: "icn", dest: "uln", ...patch }] });

test("여행지는 이름과 기간을, 노선은 IATA 3글자를 요구한다", () => {
  assert.match(validateDestination({ ...baseWatch, name: "" }).errors.join(), /여행지 이름/);
  assert.match(validateDestination(withFlight({ origin: "서울" })).errors.join(), /출발 공항은 IATA/);
  assert.match(validateDestination(withFlight({ dest: "ICN" })).errors.join(), /같습니다/);
  assert.match(validateDestination({ ...baseWatch, to: "2026-08-01" }).errors.join(), /끝이 시작보다/);
});

test("여행지와 공항은 다른 개념이다 — 노선은 여행지 아래에 여러 개 붙는다", () => {
  const { destination, errors } = validateDestination({
    ...baseWatch, name: "홋카이도", country: "jp",
    flights: [{ origin: "icn", dest: "cts" }, { origin: "pus", dest: "cts" }],
  });
  assert.deepEqual(errors, []);
  assert.equal(destination.name, "홋카이도");
  assert.equal(destination.country, "JP");
  assert.equal(destination.flights.length, 2);
  assert.deepEqual(destination.flights.map((f) => `${f.origin}→${f.dest}`), ["ICN→CTS", "PUS→CTS"]);
  // 기간·밤수·인원은 여행지에 있다 — 노선끼리 같은 조건으로 비교해야 한다
  assert.equal(flightGrid(destination, destination.flights[0]).length,
    flightGrid(destination, destination.flights[1]).length);
  assert.ok(destination.flights.every((f) => f.id), "노선마다 id 가 있어야 관측이 붙는다");
});

test("정상 여행지는 코드를 대문자로 올리고 기본값을 채운다", () => {
  const { destination, errors } = validateDestination(baseWatch);
  assert.deepEqual(errors, []);
  assert.equal(destination.flights[0].origin, "ICN");
  assert.equal(destination.flights[0].dest, "ULN");
  assert.equal(destination.flights[0].cabin, "ECONOMY");
  assert.equal(destination.flights[0].currency, "KRW");
  assert.equal(destination.people, 1);
  assert.equal(destination.status, "watching");
  assert.equal(flightGrid(destination, destination.flights[0]).length, 21, "출발 7일 × 밤수 3가지");
});

test("조합이 상한을 넘으면 거절한다 — 쿼터가 하루치 예산이다", () => {
  const { errors } = validateDestination({
    ...baseWatch, from: "2026-09-01", to: "2026-10-30", minNights: 3, maxNights: 10,
  });
  assert.match(errors.join(), new RegExp(`${GRID_LIMITS.maxCombos}개까지만`));
});

test("인원은 1~9로 눌리고 모르는 좌석등급·상태는 기본값으로 떨어진다", () => {
  const { destination } = validateDestination({
    ...baseWatch, people: 99, status: "삭제됨", flights: [{ origin: "ICN", dest: "ULN", cabin: "SUITE" }],
  });
  assert.equal(destination.people, 9);
  assert.equal(destination.flights[0].cabin, "ECONOMY");
  assert.equal(destination.status, "watching");
  assert.equal(validateDestination({ ...baseWatch, people: 0 }).destination.people, 1);
});

test("패키지는 모델에만 있고 수집기는 없다 (자리만 지킨다)", () => {
  const { destination } = validateDestination({
    ...baseWatch, packages: [{ source: "하나투어", query: "몽골 5박6일" }],
  });
  assert.equal(destination.packages.length, 1);
  assert.equal(destination.packages[0].source, "하나투어");
  assert.ok(destination.packages[0].id);
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

test("프로덕션 키라도 '결제 가능'이 아니라 live 다", () => {
  // 검색 결과 가격은 좌석·수수료 때문에 결제 화면에서 바뀔 수 있다.
  assert.equal(amadeusConfig({ AMADEUS_ENV: "production" }).quality, "live");
  assert.equal(amadeusConfig({ AMADEUS_ENV: "test" }).quality, "reference");
  assert.equal(amadeusConfig({}).quality, "reference", "기본값은 테스트 환경이라 참고가다");
  assert.match(amadeusConfig({ AMADEUS_ENV: "production" }).host, /^https:\/\/api\.amadeus\.com$/);
});

test("프로바이더는 env 하나로 갈아끼운다", () => {
  assert.equal(createFlightProvider({}).name, "mock", "키가 없으면 목업");
  assert.equal(createFlightProvider({ AMADEUS_CLIENT_ID: "x" }).name, "amadeus/test");
  const sink = createFlightProvider({ TRIP_FLIGHT_PROVIDER: "sink" });
  assert.equal(sink.live, false, "데몬 방식은 엣지가 조회하지 않는다");
  assert.equal(sink.quality, "live");
});

test("목업은 언제나 참고가다", async () => {
  const provider = createFlightProvider({ TRIP_FLIGHT_PROVIDER: "mock" });
  const quote = await provider.quote({ origin: "ICN", dest: "ULN", depart: "2026-09-01", adults: 1 });
  assert.equal(quote.quality, "reference");
  assert.equal(provider.quality, "reference");
});

test("옛 레코드의 bookable 도 읽는다 (quality 로 옮기기 전 관측)", () => {
  assert.equal(qualityOf({ bookable: true }), "live");
  assert.equal(qualityOf({ bookable: false }), "reference");
  assert.equal(qualityOf({ quality: "verified" }), "verified");
  assert.equal(qualityOf({}), "reference");
});

test("목업 가격은 같은 입력이면 같다 — 그래프가 이유 없이 요동치면 안 된다", () => {
  const q = { origin: "ICN", dest: "ULN", depart: "2026-09-01", ret: "2026-09-06" };
  assert.equal(mockPrice(q), mockPrice({ ...q }));
  assert.notEqual(mockPrice(q), mockPrice({ ...q, depart: "2026-09-02" }));
});

/* ── 집계 ────────────────────────────────────────────────────────────── */

const obs = (depart, ret, price, extra = {}) =>
  ({ depart, ret, price, quality: "live", observedAt: 1000, ...extra });

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
  assert.equal(s.stats.quality, "live");
  assert.equal(s.stats.reference, false);
});

test("관측이 한 점뿐이면 변화는 null이다 (0%는 '안정적'으로 오해된다)", () => {
  const s = summarizeObservations({}, [obs("2026-09-01", null, 500000)],
    [{ date: "2026-08-15", min: 500000 }]);
  assert.equal(s.change, null);
});

test("참고가가 하나라도 섞이면 배지를 낮춘다", () => {
  const s = summarizeObservations({}, [
    obs("2026-09-01", null, 500000),
    obs("2026-09-02", null, 400000, { quality: "reference" }),
  ]);
  assert.equal(s.stats.quality, "reference", "참고가가 섞였는데 실시간처럼 보이면 안 된다");
  assert.equal(s.stats.reference, true);
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

test("갱신은 한 번도 못 본 조합부터, 그다음 오래 안 본 것부터", () => {
  const combos = [
    { depart: "2026-09-01", ret: "2026-09-06" },
    { depart: "2026-09-02", ret: "2026-09-07" },
    { depart: "2026-09-03", ret: "2026-09-08" },
  ];
  const picked = pickStaleCombos(combos, {
    "2026-09-01:2026-09-06": { at: 500, status: "found" },
    "2026-09-03:2026-09-08": { at: 100, status: "found" },
  }, 2);
  assert.deepEqual(picked.map((c) => c.depart), ["2026-09-02", "2026-09-03"]);
});

test("항공편이 없던 조합도 '봤다'로 친다 — 안 그러면 뒤쪽을 영원히 굶긴다", () => {
  const combos = [
    { depart: "2026-09-01", ret: "2026-09-06" },
    { depart: "2026-09-02", ret: "2026-09-07" },
  ];
  // 09-01 은 조회했지만 파는 항공편이 없었다(no_offer). 가격이 없다고 해서
  // 다음 회차에 또 09-01 이 먼저 잡히면 09-02 는 한 번도 못 본다.
  const picked = pickStaleCombos(combos, {
    "2026-09-01:2026-09-06": { at: 900, status: "no_offer" },
  }, 1);
  assert.deepEqual(picked.map((c) => c.depart), ["2026-09-02"]);
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

const dest = (patch = {}) => ({ ...baseWatch, id: "d1", flights: [{ id: "f1", origin: "ICN", dest: "ULN" }], ...patch });

test("여행지를 만들고 관측을 넣으면 노선 격자와 추이가 나온다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, { TRIP_FLIGHT_PROVIDER: "mock" });

  const created = await (await call(dо, "/destinations", post(dest()))).json();
  assert.equal(created.destination.id, "d1");
  assert.equal(created.combos[0].combos, 21);

  await call(dо, "/observe", post({
    flightId: "f1",
    observations: [
      { depart: "2026-09-01", ret: "2026-09-06", price: 810000, bookable: true, carrier: "KE" },
      { depart: "2026-09-02", ret: "2026-09-07", price: 720000, bookable: true, carrier: "OM" },
    ],
  }));

  const grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.cells.length, 2);
  assert.equal(grid.best.price, 720000);
  assert.equal(grid.destination.name, "몽골", "격자는 어느 여행지의 노선인지 함께 알려 준다");
  assert.equal(grid.history.length, 1, "관측일 하나 = 점 하나");
  assert.equal(grid.history[0].min, 720000);

  // 목록은 카드에 필요한 것(노선별 최저가·커버리지)을 함께 준다
  const list = await (await call(dо, "/destinations")).json();
  assert.equal(list.destinations[0].flights[0].best.price, 720000);
  assert.equal(list.destinations[0].flights[0].coverage.found, 2);
});

test("cron 은 항공편 없는 앞 날짜에 갇히지 않는다 (starvation)", async () => {
  const storage = storageStub();
  const env = { TRIP_FLIGHT_PROVIDER: "mock" };
  const dо = new TripWatchDO({ storage }, env);
  const real = createFlightProvider(env);
  const asked = [];
  dо.provider = () => ({
    ...real,
    quote: async (q) => {
      asked.push(q.depart);
      return q.depart <= "2026-09-03" ? null : real.quote(q);
    },
  });

  await call(dо, "/destinations", post(dest({
    from: "2026-09-01", to: "2026-09-06", minNights: 5, maxNights: 5,
  })));
  await call(dо, "/refresh", post({ limit: 3 }));
  await call(dо, "/refresh", post({ limit: 3 }));
  assert.deepEqual(asked, ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"],
    "두 번째 회차가 같은 앞 날짜를 다시 조회하고 있다 (starvation)");

  const grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.coverage.attempted, 6, "조회 시도는 모두 기록된다");
  assert.equal(grid.coverage.noOffer, 3, "항공편 없던 조합도 센다");
  assert.equal(grid.cells.length, 3, "가격이 나온 것만 격자에 들어간다");
});

test("추이는 그날 조회한 것만으로 계산하고 커버리지를 함께 남긴다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  await call(dо, "/destinations", post(dest({
    from: "2026-09-01", to: "2026-09-04", minNights: 5, maxNights: 5,
  })));

  // 어제: 09-01 이 35만원이었다
  const yesterday = Date.UTC(2026, 7, 14, 3);
  await dо.ingest("f1", [{ depart: "2026-09-01", ret: "2026-09-06", price: 350000 }], yesterday);

  // 오늘: 09-01 은 조회하지 않고 다른 조합만 봤다 (42만~50만)
  const today = Date.UTC(2026, 7, 15, 3);
  await dо.ingest("f1", [
    { depart: "2026-09-02", ret: "2026-09-07", price: 420000 },
    { depart: "2026-09-03", ret: "2026-09-08", price: 500000 },
  ], today);

  const grid = await (await call(dо, "/grid?flight=f1")).json();
  const [d1, d2] = grid.history;
  assert.equal(d1.min, 350000);
  assert.equal(d2.min, 420000,
    "오늘 보지도 않은 어제의 35만원이 오늘 최저가로 찍히면 그래프가 거짓말을 한다");
  assert.equal(d2.checked, 2);
  assert.equal(d2.total, 4, "그리드 전체 칸 수를 함께 남겨 '2/4 확인'으로 말할 수 있다");
  // 격자 자체는 마지막으로 알려진 값을 계속 보여 준다(관측 시각과 함께)
  assert.equal(grid.best.price, 350000);
  assert.equal(grid.change, 420000 - 350000, "변화는 그날 관측끼리 비교한다");
});

test("같은 날 뒤늦은 no_offer 가 앞선 found 를 지우지 않는다", async () => {
  // 09:00 found → 15:00 no_offer 인데 found 0 으로 세면
  // "오늘 가격을 하나도 못 찾았는데 최저가 41.2만" 처럼 읽힌다.
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(dest()));
  const morning = Date.UTC(2026, 7, 15, 0);
  const evening = Date.UTC(2026, 7, 15, 6);
  await dо.ingest("f1", [{ depart: "2026-09-01", ret: "2026-09-06", price: 412000 }], morning);
  await dо.ingest("f1", [{ depart: "2026-09-01", ret: "2026-09-06", status: "no_offer" }], evening);

  const grid = await (await call(dо, "/grid?flight=f1")).json();
  const today = grid.history.at(-1);
  assert.equal(today.min, 412000, "오늘 본 가격은 그대로 남는다");
  assert.equal(today.checked, 1);
  assert.equal(today.found, 1, "오늘 한 번이라도 찾았으면 found 다");
});

test("어제 찾은 사실이 오늘 found 로 넘어오지는 않는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(dest()));
  await dо.ingest("f1", [{ depart: "2026-09-01", ret: "2026-09-06", price: 412000 }], Date.UTC(2026, 7, 14, 3));
  await dо.ingest("f1", [{ depart: "2026-09-02", ret: "2026-09-07", status: "no_offer" }], Date.UTC(2026, 7, 15, 3));
  const grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.history.at(-1).found, 0, "오늘 찾은 건 하나도 없다");
});

test("커버리지는 시도와 해결을 나눈다 — 오류가 '확인'으로 숨으면 안 된다", () => {
  const c = summarizeChecks({
    a: { at: 3, status: "found" },
    b: { at: 2, status: "no_offer" },
    c: { at: 1, status: "error" },
  }, 10);
  assert.equal(c.attempted, 3);
  assert.equal(c.resolved, 2, "429 로 실패한 조합은 '확인'이 아니다");
  assert.equal(c.found, 1);
  assert.equal(c.noOffer, 1);
  assert.equal(c.error, 1);
  assert.equal(c.total, 10);
  assert.equal(c.oldestCheckedAt, 1);
  assert.equal(c.lastCheckedAt, 3);
});

test("아무 가격도 못 받은 날도 점으로 남는다 ('안 봤다'와 다르다)", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(dest()));
  await dо.ingest("f1", [
    { depart: "2026-09-01", ret: "2026-09-06", status: "no_offer" },
  ], Date.UTC(2026, 7, 15, 3));
  const grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.history.length, 1);
  assert.equal(grid.history[0].min, null);
  assert.equal(grid.history[0].checked, 1);
  assert.equal(grid.history[0].found, 0);
});

test("같은 날 다시 관측하면 추이의 점은 더 싼 값으로만 내려간다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  await call(dо, "/destinations", post(dest()));

  await call(dо, "/observe", post({ flightId: "f1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 800000 }] }));
  await call(dо, "/observe", post({ flightId: "f1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 600000 }] }));
  let grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.history.length, 1, "하루에 점 하나만 남는다");
  assert.equal(grid.history[0].min, 600000);

  // 더 비싼 관측이 와도 그날 "잡을 수 있었던 최저가"는 올라가지 않는다
  await call(dо, "/observe", post({ flightId: "f1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 950000 }] }));
  grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.history[0].min, 600000);
  assert.equal(grid.cells[0].price, 950000, "격자 칸은 최신 관측을 보여 준다");
});

test("하루 안의 최저가 바닥은 어제 값을 끌고 오지 않는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  await call(dо, "/destinations", post(dest()));
  await dо.ingest("f1", [{ depart: "2026-09-01", ret: "2026-09-06", price: 300000 }],
    Date.UTC(2026, 7, 14, 3));
  await dо.ingest("f1", [{ depart: "2026-09-02", ret: "2026-09-07", price: 900000 }],
    Date.UTC(2026, 7, 15, 3));
  const grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.history.at(-1).min, 900000, "어제의 30만이 오늘 점의 바닥이 되면 안 된다");
});

test("없는 노선으로는 관측을 넣을 수 없다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  const res = await call(dо, "/observe", post({ flightId: "없음", observations: [{ depart: "2026-09-01", price: 1 }] }));
  assert.equal(res.status, 404);
});

test("여행지를 지우면 노선의 관측·추이도 같이 지워진다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  await call(dо, "/destinations", post(dest()));
  await call(dо, "/observe", post({ flightId: "f1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 800000 }] }));
  await call(dо, "/destinations/d1", { method: "DELETE" });

  assert.equal([...storage.map.keys()].filter((k) => k.includes("f1") || k.includes("d1")).length, 0);
  assert.equal((await (await call(dо, "/grid?flight=f1")).json()).error, "flight not found");
});

test("노선을 빼면 그 노선의 관측만 지워지고 나머지는 남는다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  await call(dо, "/destinations", post(dest({
    flights: [{ id: "f1", origin: "ICN", dest: "CTS" }, { id: "f2", origin: "PUS", dest: "CTS" }],
  })));
  await call(dо, "/observe", post({ flightId: "f1", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 500000 }] }));
  await call(dо, "/observe", post({ flightId: "f2", observations: [{ depart: "2026-09-01", ret: "2026-09-06", price: 600000 }] }));

  await call(dо, "/destinations", post(dest({ flights: [{ id: "f2", origin: "PUS", dest: "CTS" }] })));
  assert.equal([...storage.map.keys()].filter((k) => k.includes("f1")).length, 0, "뺀 노선의 키가 남았다");
  assert.ok([...storage.map.keys()].some((k) => k.startsWith("obs:f2:")), "남긴 노선의 관측은 살아 있어야 한다");
});

test("여행지 개수 상한이 있다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, {});
  for (let i = 0; i < GRID_LIMITS.maxDestinations; i += 1) {
    const res = await call(dо, "/destinations", post(dest({ id: `d${i}`, flights: [{ id: `f${i}`, origin: "ICN", dest: "ULN" }] })));
    assert.equal(res.status, 200);
  }
  const over = await call(dо, "/destinations", post(dest({ id: "over", flights: [{ id: "fx", origin: "ICN", dest: "ULN" }] })));
  assert.equal(over.status, 400);
  // 기존 여행지 수정은 상한에 걸리지 않는다
  assert.equal((await call(dо, "/destinations", post(dest({ id: "d0", name: "수정", flights: [{ id: "f0", origin: "ICN", dest: "ULN" }] })))).status, 200);
});

test("cron 갱신은 limit 만큼만 조회하고 여러 노선에 고르게 나눈다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, { TRIP_FLIGHT_PROVIDER: "mock" });
  await call(dо, "/destinations", post(dest({
    flights: [{ id: "f1", origin: "ICN", dest: "CTS" }, { id: "f2", origin: "PUS", dest: "CTS" }],
  })));

  const first = await (await call(dо, "/refresh", post({ limit: 6 }))).json();
  const total = first.runs.reduce((sum, r) => sum + r.refreshed, 0);
  assert.equal(total, 6, "한 번에 그리드 전체를 돌리지 않는다");
  assert.equal(first.runs.length, 2, "늦게 추가한 노선이 계속 밀리면 안 된다");
  assert.ok(await storage.get("cursor:f1"));

  const grid = await (await call(dо, "/grid?flight=f1")).json();
  assert.equal(grid.stats.reference, true, "목업 관측은 참고가로 표시된다");
});

test("보류(archived) 여행지는 갱신하지 않는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, { TRIP_FLIGHT_PROVIDER: "mock" });
  await call(dо, "/destinations", post(dest({ status: "archived" })));
  const out = await (await call(dо, "/refresh", post({ limit: 5 }))).json();
  assert.deepEqual(out.runs, [], "관측 중인 여행지만 갱신 대상이다");
});

test("데몬 방식(sink)일 때 엣지는 조회하지 않는다", async () => {
  const dо = new TripWatchDO({ storage: storageStub() }, { TRIP_FLIGHT_PROVIDER: "sink" });
  await call(dо, "/destinations", post(dest()));
  const out = await (await call(dо, "/refresh", post({ limit: 5 }))).json();
  assert.equal(out.refreshed, 0);
  assert.match(out.skipped, /^provider:sink$/);
});

test("옛 watch 저장본은 여행지 아래로 옮겨지고 관측이 이어진다", async () => {
  const storage = storageStub();
  const dо = new TripWatchDO({ storage }, {});
  // 옛 모델: 노선 하나가 곧 관측 대상이었다
  await storage.put("watch:w1", {
    id: "w1", label: "몽골 여름", origin: "ICN", dest: "ULN",
    from: "2026-09-01", to: "2026-09-03", minNights: 5, maxNights: 5,
    adults: 2, cabin: "ECONOMY", currency: "KRW", active: true, createdAt: 1000,
  });
  await storage.put("obs:w1:2026-09-01:2026-09-06", {
    depart: "2026-09-01", ret: "2026-09-06", price: 700000, observedAt: 2000,
  });

  const list = await (await call(dо, "/destinations")).json();
  assert.equal(list.destinations.length, 1);
  assert.equal(list.destinations[0].name, "몽골 여름");
  assert.equal(list.destinations[0].people, 2, "인원은 여행지로 올라간다");
  assert.equal(list.destinations[0].flights[0].id, "w1", "노선 id 를 유지해야 관측이 이어진다");
  assert.equal(list.destinations[0].flights[0].best.price, 700000);
  assert.equal(await storage.get("watch:w1"), undefined, "옛 키는 정리된다");
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

test("읽기·쓰기 모두 토큰이 필요하고, 데몬 push 는 별도 secret 이다", () => {
  const worker = readFileSync(join(ROOT, "_infra/worker.js"), "utf8");
  const handler = worker.slice(worker.indexOf("async function handleTripWatch"));
  const body = handler.slice(0, handler.indexOf("async function handleDuri"));
  assert.match(body, /validSession\(key, bearer\)/);
  assert.match(body, /return new Response\("authentication required", \{ status: 401 \}\)/);
  assert.match(body, /env\.TRIP_SINK_SECRET/);
  // GET 이 토큰 검사보다 먼저 처리되면 여행 의향(여행지·기간·인원)이 공개된다.
  assert.ok(body.indexOf("validSession(key, bearer)") < body.indexOf('request.method === "GET"'),
    "GET 이 인증보다 먼저 처리되고 있다");
  assert.ok(body.indexOf("validSession(key, bearer)") < body.indexOf('path === "/destinations" && request.method === "POST"'),
    "여행지 생성이 인증보다 먼저 처리되고 있다");
  // 데몬 경로만 그 앞에 있고, 자체 secret 으로 검사한다
  assert.ok(body.indexOf('path === "/snapshot"') < body.indexOf("validSession(key, bearer)"));
  assert.match(body.slice(body.indexOf('path === "/snapshot"')), /matchesCredential\(sinkKey, bearer, secret\)/);
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
