// 여행지 관측 저장소 (trip/ 계획 탭).
//
// **경계**: 개인 일정·예산은 브라우저 localStorage 에만 있고 여기 오지 않는다.
// 여기 쌓이는 건 관측 대상(여행지·노선)과 "어느 날짜 조합이 얼마였나" 뿐이다.
// 그래도 여행 의향(어디를·언제·몇 명)은 드러나므로 읽기도 토큰을 요구한다.
//
// **여행지와 공항은 다른 것이다.** 관측 대상의 상위 개념은 여행지(몽골)이고,
// ICN→UBN 은 그걸 실현하는 노선 중 하나다. 날짜 격자·관측은 노선마다 붙지만
// 기간·밤수·인원은 여행지에 있다 — 같은 여행을 여러 노선으로 비교하려면
// 조건이 하나여야 하기 때문이다(홋카이도 = ICN→CTS + PUS→CTS).
//
// 저장 구조
//   dest:<destId>                  … 여행지 (flights[]·packages[] 를 품는다)
//   obs:<flightId>:<depart>:<ret>  … 노선의 조합별 **최신** 관측 (격자 한 칸)
//   checks:<flightId>              … 조합별 마지막 **조회 시도**(at·status·foundAt).
//                                    가격이 없던 날(no_offer)도 남겨야 다음 cron 이
//                                    같은 조합에 갇히지 않는다.
//   hist:<flightId>                … 관측일별 최저가 + 그날 몇 칸을 봤는지(coverage)
//   cursor:<flightId>              … 마지막 갱신 시각·시도 수 (디버깅용)
//   watch:<id>                     … (옛 모델) 첫 접근 때 dest 아래로 옮기고 지운다
import {
  GRID_LIMITS, CHECK_STATUSES, validateDestination, flightGrid, findFlight,
  createFlightProvider, summarizeObservations, summarizeChecks, pickStaleCombos,
} from "./trip-flights.js";

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

const kstDay = (now = Date.now()) => {
  const d = new Date(now + 9 * 3600000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

export class TripWatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /** 조회 상류. 테스트가 갈아끼울 수 있게 메서드로 둔다. */
  provider() {
    return createFlightProvider(this.env);
  }

  async destinations() {
    await this.migrateLegacy();
    const map = await this.state.storage.list({ prefix: "dest:" });
    return [...map.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  /**
   * 옛 `watch:<id>`(노선 하나 = 관측 대상)를 여행지 아래로 옮긴다.
   * 노선 id 를 그대로 쓰므로 obs·checks·hist 는 손대지 않아도 이어진다.
   */
  async migrateLegacy() {
    const legacy = await this.state.storage.list({ prefix: "watch:" });
    if (!legacy.size) return 0;
    for (const [key, w] of legacy) {
      const { destination } = validateDestination({
        id: `d${w.id}`,
        name: w.label || `${w.origin}→${w.dest}`,
        from: w.from, to: w.to,
        oneWay: w.oneWay, minNights: w.minNights, maxNights: w.maxNights,
        people: w.adults,
        createdAt: w.createdAt,
        flights: [{
          id: w.id, origin: w.origin, dest: w.dest,
          cabin: w.cabin, nonstop: w.nonstop, currency: w.currency, active: w.active,
        }],
      });
      await this.state.storage.put(`dest:${destination.id}`, destination);
      await this.state.storage.delete(key);
    }
    return legacy.size;
  }

  async observations(watchId) {
    const map = await this.state.storage.list({ prefix: `obs:${watchId}:` });
    return [...map.values()];
  }

  async history(watchId) {
    return (await this.state.storage.get(`hist:${watchId}`)) ?? [];
  }

  /** 조합별 마지막 **조회 시도** 기록. 가격이 없었어도(no_offer) 남는다. */
  async checks(watchId) {
    return (await this.state.storage.get(`checks:${watchId}`)) ?? {};
  }

  /** 노선 id 로 여행지·노선을 함께 찾는다. */
  async locate(flightId) {
    return findFlight(await this.destinations(), flightId);
  }

  async gridSize(flightId) {
    const found = await this.locate(flightId);
    return found ? flightGrid(found.destination, found.flight).slice(0, GRID_LIMITS.maxCombos).length : 0;
  }

  /**
   * 조회 결과를 반영한다. **가격이 나온 것뿐 아니라 시도한 모든 조합**을 기록한다 —
   * 안 그러면 항공편 없는 날짜가 매 cron 마다 다시 잡혀 그리드 뒤쪽을 굶긴다.
   *
   * results: [{ depart, ret, status?, price?, ... }]
   *   status 를 생략하면 가격 유무로 found / no_offer 를 정한다.
   */
  async ingest(watchId, results, now = Date.now()) {
    const writes = {};
    const checks = await this.checks(watchId);
    let accepted = 0;
    let checked = 0;

    for (const raw of results) {
      const depart = String(raw?.depart ?? "");
      if (!depart) continue;
      const ret = raw?.ret ? String(raw.ret) : null;
      const price = Math.round(Number(raw?.price));
      const priced = Number.isFinite(price) && price > 0;
      const status = CHECK_STATUSES.includes(raw?.status)
        ? raw.status : (priced ? "found" : "no_offer");

      const key = `${depart}:${ret ?? "-"}`;
      // foundAt 은 **가격을 받았을 때만** 갱신하고 지우지 않는다. 아침에 가격을
      // 봤다가 저녁에 no_offer 가 되어도 "오늘 한 번은 찾았다"는 사실이 남아야
      // 그날 점이 "최저가 41.2만인데 found 0" 처럼 읽히지 않는다.
      const previousFoundAt = checks[key]?.foundAt;
      checks[key] = { at: now, status };
      const foundAt = status === "found" && priced ? now : previousFoundAt;
      if (Number.isFinite(foundAt)) checks[key].foundAt = foundAt;
      checked += 1;

      if (status !== "found" || !priced) continue;
      writes[`obs:${watchId}:${key}`] = {
        depart, ret, price,
        currency: String(raw?.currency ?? "KRW").toUpperCase().slice(0, 3),
        carrier: String(raw?.carrier ?? "").slice(0, 40),
        flights: String(raw?.flights ?? "").slice(0, 80),
        stops: Math.max(0, Math.round(Number(raw?.stops) || 0)),
        // 프로바이더가 "실제 예매 가능한 값"이라고 말한 것만 예매가로 센다.
        bookable: raw?.bookable === true,
        source: String(raw?.source ?? "").slice(0, 40),
        observedAt: now,
      };
      accepted += 1;
    }
    if (!checked) return { accepted: 0, checked: 0 };

    // 지운 watch 의 조합이 남지 않게 그리드 밖 키는 정리한다.
    await this.state.storage.put({ ...writes, [`checks:${watchId}`]: checks });
    await this.recomputeHistory(watchId, now);
    return { accepted, checked };
  }

  /** 하위 호환 이름 — 데몬 push 경로가 쓴다. */
  async record(watchId, observations, now = Date.now()) {
    return this.ingest(watchId, observations, now);
  }

  /**
   * 오늘 자 추이 점을 **오늘 실제로 조회한 것만으로** 다시 계산한다.
   *
   * 예전에는 "지금 저장된 모든 관측의 최소값"을 오늘 값으로 찍었다. cron 이 하루에
   * 그리드의 일부만 도는 구조라, 며칠 전에 본 싼 가격이 오늘 가격인 것처럼 그래프에
   * 남았다("8/15에도 35만원이 있었다" — 실제로는 그날 그 조합을 보지 않았다).
   * 이제 그날 관측된 값만 최저가로 쓰고, 그리드의 몇 칸을 봤는지(coverage)를 함께
   * 저장해 화면이 "412,000원 · 34/120 조합 확인"으로 정직하게 말한다.
   */
  async recomputeHistory(watchId, now = Date.now()) {
    const date = kstDay(now);
    const [observations, checks, total] = await Promise.all([
      this.observations(watchId), this.checks(watchId), this.gridSize(watchId),
    ]);

    const todayPrices = observations
      .filter((o) => kstDay(o.observedAt ?? 0) === date && o.price > 0)
      .map((o) => o.price);
    const checkedToday = Object.values(checks).filter((c) => kstDay(c.at ?? 0) === date);

    // 하루 안에서는 더 싼 값으로만 내려간다. 아침에 60만이었다가 저녁에 95만이
    // 됐어도 "그날 잡을 수 있었던 최저가"는 60만이다 — 관측은 조합마다 최신값
    // 하나만 남으므로, 그날 점의 이전 값을 바닥으로 함께 본다.
    const previous = (await this.history(watchId)).find((h) => h.date === date);
    const candidates = [
      ...todayPrices,
      ...(Number.isFinite(previous?.min) ? [previous.min] : []),
    ];

    // 당일 점은 **누적 통계**다: 오늘 한 번이라도 조회한 조합 / 한 번이라도 가격을
    // 받은 조합. 마지막 상태로 세면 뒤늦은 no_offer 가 앞선 found 를 지운다.
    const entry = {
      date,
      min: candidates.length ? Math.min(...candidates) : null,
      checked: checkedToday.length,
      found: Object.values(checks).filter((c) => kstDay(c.foundAt ?? 0) === date).length,
      total,
    };
    const hist = (await this.history(watchId)).filter((h) => h.date !== date);
    hist.push(entry);
    hist.sort((a, b) => a.date.localeCompare(b.date));
    await this.state.storage.put(`hist:${watchId}`, hist.slice(-GRID_LIMITS.historyDays));
    return entry;
  }

  /**
   * 오래 안 본 조합부터 limit 개만 실제로 조회한다. cron 과 수동 갱신이 같이 쓴다.
   * 여러 노선이 있으면 **노선을 가리지 않고 전체에서 가장 오래된 것부터** 고른다 —
   * 노선마다 한 바퀴씩 돌리면 늦게 추가한 노선이 계속 밀린다.
   */
  async refresh({ limit, destinationId = null, flightId = null } = {}) {
    const provider = this.provider();
    if (!provider.live) return { refreshed: 0, skipped: `provider:${provider.name}` };
    if (!provider.configured) return { refreshed: 0, skipped: "provider not configured" };

    const destinations = (await this.destinations())
      .filter((d) => d.status !== "archived")
      .filter((d) => !destinationId || d.id === destinationId);

    const candidates = [];
    for (const destination of destinations) {
      for (const flight of destination.flights ?? []) {
        if (flight.active === false) continue;
        if (flightId && flight.id !== flightId) continue;
        const combos = flightGrid(destination, flight).slice(0, GRID_LIMITS.maxCombos);
        const checks = await this.checks(flight.id);
        pickStaleCombos(combos, checks, limit).forEach((combo, rank) => {
          candidates.push({
            destination, flight, combo, rank,
            at: checks[`${combo.depart}:${combo.ret ?? "-"}`]?.at ?? 0,
          });
        });
      }
    }
    // 오래 안 본 것부터. 다만 **같은 나이(대개 둘 다 처음)면 노선끼리 번갈아** 잡는다 —
    // 그러지 않으면 먼저 등록한 노선의 그리드를 다 돌 때까지 새 노선이 한 칸도 못 본다.
    candidates.sort((a, b) => (a.at - b.at) || (a.rank - b.rank));

    const perFlight = new Map();
    const errors = [];
    let stop = false;
    for (const { destination, flight, combo } of candidates.slice(0, limit)) {
      if (stop) break;
      const at = { depart: combo.depart, ret: combo.ret };
      const bucket = perFlight.get(flight.id) ?? [];
      try {
        const quote = await provider.quote({
          origin: flight.origin, dest: flight.dest,
          depart: combo.depart, ret: combo.ret,
          adults: destination.people, cabin: flight.cabin,
          nonstop: flight.nonstop, currency: flight.currency,
        });
        // 해당 날짜에 파는 항공편이 없을 수도 있다(널). 그건 오류가 아니지만,
        // **시도했다는 사실은 반드시 남긴다** — 안 남기면 다음 cron 이 또 여기부터
        // 시작해서 그리드 뒤쪽은 영원히 못 본다.
        bucket.push(quote ? { ...quote, ...at, status: "found" } : { ...at, status: "no_offer" });
      } catch (error) {
        errors.push(`${flight.origin}→${flight.dest}: ${error.message ?? error}`);
        bucket.push({ ...at, status: "error" });
        // 상류가 막히면(429·인증) 남은 조합도 같은 결과다 — 쿼터를 더 태우지 않는다.
        stop = true;
      }
      perFlight.set(flight.id, bucket);
    }

    const runs = [];
    for (const [id, results] of perFlight) {
      const { accepted, checked } = await this.ingest(id, results);
      await this.state.storage.put(`cursor:${id}`, { at: Date.now(), tried: results.length });
      runs.push({
        flight: id, refreshed: accepted, checked,
        noOffer: results.filter((r) => r.status === "no_offer").length,
        error: results.filter((r) => r.status === "error").length,
      });
    }
    return { runs, provider: provider.name, errors, tried: Math.min(candidates.length, limit) };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/destinations" && request.method === "GET") {
      const destinations = await this.destinations();
      const provider = this.provider();
      // 카드 한 장에 필요한 것(노선별 최저가·마지막 조사 시각)을 여기서 붙인다 —
      // 화면이 노선마다 grid 를 따로 부르지 않게.
      const summarized = [];
      for (const destination of destinations) {
        const flights = [];
        for (const flight of destination.flights ?? []) {
          const [observations, checks, total] = await Promise.all([
            this.observations(flight.id), this.checks(flight.id), this.gridSize(flight.id),
          ]);
          const best = observations
            .filter((o) => o.price > 0)
            .reduce((min, o) => (!min || o.price < min.price ? o : min), null);
          flights.push({ ...flight, best, coverage: summarizeChecks(checks, total) });
        }
        summarized.push({ ...destination, flights });
      }
      return json({
        destinations: summarized,
        provider: { name: provider.name, bookable: provider.bookable, live: provider.live,
          configured: provider.configured },
        limits: GRID_LIMITS,
      });
    }

    if (path === "/destinations" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const { destination, errors } = validateDestination(body);
      if (errors.length) return json({ errors }, 400);
      const existing = await this.destinations();
      if (!existing.some((d) => d.id === destination.id) &&
          existing.length >= GRID_LIMITS.maxDestinations) {
        return json({ errors: [`여행지는 ${GRID_LIMITS.maxDestinations}개까지입니다`] }, 400);
      }
      // 노선을 빼면 그 노선의 관측도 함께 지운다 (고아 키가 남지 않게).
      const before = existing.find((d) => d.id === destination.id);
      const kept = new Set(destination.flights.map((f) => f.id));
      for (const flight of before?.flights ?? []) {
        if (!kept.has(flight.id)) await this.dropFlight(flight.id);
      }
      await this.state.storage.put(`dest:${destination.id}`, destination);
      return json({
        destination,
        combos: destination.flights.map((f) => ({ flight: f.id, combos: flightGrid(destination, f).length })),
      });
    }

    if (path.startsWith("/destinations/") && request.method === "DELETE") {
      const id = decodeURIComponent(path.slice("/destinations/".length));
      const destination = await this.state.storage.get(`dest:${id}`);
      for (const flight of destination?.flights ?? []) await this.dropFlight(flight.id);
      await this.state.storage.delete(`dest:${id}`);
      return json({ deleted: id });
    }

    if (path === "/grid" && request.method === "GET") {
      const id = url.searchParams.get("flight") ?? url.searchParams.get("watch") ?? "";
      const found = await this.locate(id);
      if (!found) return json({ error: "flight not found" }, 404);
      const provider = this.provider();
      const checks = await this.checks(id);
      return json({
        ...summarizeObservations(found.flight, await this.observations(id), await this.history(id)),
        destination: found.destination,
        cursor: (await this.state.storage.get(`cursor:${id}`)) ?? null,
        provider: { name: provider.name, bookable: provider.bookable },
        // 한 바퀴를 얼마나 돌았는지. 시도(attempted)와 답을 얻은 것(resolved)을
        // 나눠야 "120/120 확인"인데 실제로는 40개가 429였던 상황이 숨지 않는다.
        coverage: summarizeChecks(checks, await this.gridSize(id)),
      });
    }

    // 데몬 push 와 화면의 "지금 갱신"이 같은 입구를 쓴다.
    if (path === "/observe" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const flightId = String(body?.flightId ?? body?.watchId ?? "");
      if (!await this.locate(flightId)) return json({ error: "flight not found" }, 404);
      const list = Array.isArray(body?.observations) ? body.observations.slice(0, GRID_LIMITS.maxCombos) : [];
      return json(await this.ingest(flightId, list));
    }

    if (path === "/refresh" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const limit = Math.min(60, Math.max(1, Math.round(Number(body?.limit) || 12)));
      return json(await this.refresh({
        limit,
        destinationId: body?.destinationId ?? null,
        flightId: body?.flightId ?? body?.watchId ?? null,
      }));
    }

    return json({ error: "not found" }, 404);
  }

  /** 노선 하나에 딸린 관측·조회이력·추이를 지운다. */
  async dropFlight(flightId) {
    await this.state.storage.delete([
      `hist:${flightId}`, `cursor:${flightId}`, `checks:${flightId}`,
    ]);
    const obs = await this.state.storage.list({ prefix: `obs:${flightId}:` });
    if (obs.size) await this.state.storage.delete([...obs.keys()]);
  }
}

/** cron 이 부르는 진입점. 활성 watch 를 조금씩 갱신한다. */
export async function refreshTripWatches(env, limit) {
  const stub = env.TRIP_WATCH.get(env.TRIP_WATCH.idFromName("main"));
  const res = await stub.fetch("https://trip-watch/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: limit ?? (Number(env.TRIP_REFRESH_LIMIT) || 12) }),
  });
  return res.json().catch(() => null);
}
