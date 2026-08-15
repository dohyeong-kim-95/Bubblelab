// 항공권 가격 관측 저장소 (trip/ 계획 탭).
//
// **경계**: 개인 일정·예산은 브라우저 localStorage 에만 있고 여기 오지 않는다.
// 여기 쌓이는 건 관측 대상(watch)과 "어느 날짜 조합이 얼마였나" 뿐이다.
// 다만 watch 자체에 노선·출발 가능 구간·인원이 들어 있어 **여행 의향**은 드러난다 —
// 지금 GET 이 공개라 주소를 아는 사람은 그걸 읽을 수 있다(읽기도 토큰으로 좁힐 예정).
//
// 저장 구조
//   watch:<id>                     … 관측 대상(노선·구간·밤수·인원)
//   obs:<watchId>:<depart>:<ret>   … 조합별 **최신** 관측 (격자 한 칸)
//   checks:<watchId>               … 조합별 마지막 **조회 시도**(at·status).
//                                    가격이 없던 날(no_offer)도 남겨야 다음 cron 이
//                                    같은 조합에 갇히지 않는다.
//   hist:<watchId>                 … 관측일별 최저가 + 그날 몇 칸을 봤는지(coverage)
//   cursor:<watchId>               … 갱신 위치. cron 이 한 번에 그리드 전체를
//                                    돌리면 API 쿼터가 남지 않아 조금씩 밀어 둔다.
import {
  GRID_LIMITS, CHECK_STATUSES, buildDateGrid, validateWatch,
  createFlightProvider, summarizeObservations, pickStaleCombos,
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

  async watches() {
    const map = await this.state.storage.list({ prefix: "watch:" });
    return [...map.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
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

  async gridSize(watchId) {
    const watch = await this.state.storage.get(`watch:${watchId}`);
    return watch ? buildDateGrid(watch).slice(0, GRID_LIMITS.maxCombos).length : 0;
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
      checks[key] = { at: now, status };
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

    const entry = {
      date,
      min: candidates.length ? Math.min(...candidates) : null,
      checked: checkedToday.length,
      found: checkedToday.filter((c) => c.status === "found").length,
      total,
    };
    const hist = (await this.history(watchId)).filter((h) => h.date !== date);
    hist.push(entry);
    hist.sort((a, b) => a.date.localeCompare(b.date));
    await this.state.storage.put(`hist:${watchId}`, hist.slice(-GRID_LIMITS.historyDays));
    return entry;
  }

  /** 오래된 조합부터 limit 개만 실제로 조회한다. cron 과 수동 갱신이 같이 쓴다. */
  async refresh(watchId, limit) {
    const watch = await this.state.storage.get(`watch:${watchId}`);
    if (!watch) return { error: "watch not found", status: 404 };
    if (watch.active === false) return { refreshed: 0, skipped: "inactive" };

    const provider = this.provider();
    if (!provider.live) return { refreshed: 0, skipped: `provider:${provider.name}` };
    if (!provider.configured) return { refreshed: 0, skipped: "provider not configured" };

    const combos = buildDateGrid(watch).slice(0, GRID_LIMITS.maxCombos);
    const targets = pickStaleCombos(combos, await this.checks(watchId), limit);

    const results = [];
    const errors = [];
    for (const combo of targets) {
      const at = { depart: combo.depart, ret: combo.ret };
      try {
        const quote = await provider.quote({
          origin: watch.origin, dest: watch.dest,
          depart: combo.depart, ret: combo.ret,
          adults: watch.adults, cabin: watch.cabin,
          nonstop: watch.nonstop, currency: watch.currency,
        });
        // 해당 날짜에 파는 항공편이 없을 수도 있다(널). 그건 오류가 아니지만,
        // **시도했다는 사실은 반드시 남긴다** — 안 남기면 다음 cron 이 또 여기부터
        // 시작해서 그리드 뒤쪽은 영원히 못 본다.
        results.push(quote ? { ...quote, ...at, status: "found" } : { ...at, status: "no_offer" });
      } catch (error) {
        errors.push(String(error.message ?? error));
        results.push({ ...at, status: "error" });
        // 상류가 막히면(429·인증) 남은 조합도 같은 결과다 — 쿼터를 더 태우지 않는다.
        break;
      }
    }
    const { accepted, checked } = await this.ingest(watchId, results);
    await this.state.storage.put(`cursor:${watchId}`, { at: Date.now(), tried: targets.length });
    return {
      refreshed: accepted, checked, tried: targets.length,
      noOffer: results.filter((r) => r.status === "no_offer").length,
      provider: provider.name, errors,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/watches" && request.method === "GET") {
      const watches = await this.watches();
      const provider = this.provider();
      return json({
        watches,
        provider: { name: provider.name, bookable: provider.bookable, live: provider.live,
          configured: provider.configured },
        limits: GRID_LIMITS,
      });
    }

    if (path === "/watches" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const { watch, combos, errors } = validateWatch(body);
      if (errors.length) return json({ errors }, 400);
      const existing = await this.watches();
      if (!existing.some((w) => w.id === watch.id) && existing.length >= GRID_LIMITS.maxWatches) {
        return json({ errors: [`watch 는 ${GRID_LIMITS.maxWatches}개까지입니다`] }, 400);
      }
      await this.state.storage.put(`watch:${watch.id}`, watch);
      return json({ watch, combos: combos.length });
    }

    if (path.startsWith("/watches/") && request.method === "DELETE") {
      const id = decodeURIComponent(path.slice("/watches/".length));
      await this.state.storage.delete(`watch:${id}`);
      await this.state.storage.delete(`hist:${id}`);
      await this.state.storage.delete(`cursor:${id}`);
      await this.state.storage.delete(`checks:${id}`);
      const obs = await this.state.storage.list({ prefix: `obs:${id}:` });
      if (obs.size) await this.state.storage.delete([...obs.keys()]);
      return json({ deleted: id });
    }

    if (path === "/grid" && request.method === "GET") {
      const id = url.searchParams.get("watch") ?? "";
      const watch = await this.state.storage.get(`watch:${id}`);
      if (!watch) return json({ error: "watch not found" }, 404);
      const provider = this.provider();
      const checks = await this.checks(id);
      const values = Object.values(checks);
      const total = await this.gridSize(id);
      return json({
        ...summarizeObservations(watch, await this.observations(id), await this.history(id)),
        cursor: (await this.state.storage.get(`cursor:${id}`)) ?? null,
        provider: { name: provider.name, bookable: provider.bookable },
        // 한 바퀴를 얼마나 돌았는지. 격자에 빈 칸이 많을 때 "아직 안 본 것"인지
        // "항공편이 없는 것"인지 화면이 구분해 말할 수 있어야 한다.
        coverage: {
          total,
          checked: values.length,
          noOffer: values.filter((c) => c.status === "no_offer").length,
          oldestCheckedAt: values.length ? Math.min(...values.map((c) => c.at ?? 0)) : null,
        },
      });
    }

    // 데몬 push 와 화면의 "지금 갱신"이 같은 입구를 쓴다.
    if (path === "/observe" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const watchId = String(body?.watchId ?? "");
      if (!await this.state.storage.get(`watch:${watchId}`)) return json({ error: "watch not found" }, 404);
      const list = Array.isArray(body?.observations) ? body.observations.slice(0, GRID_LIMITS.maxCombos) : [];
      return json(await this.record(watchId, list));
    }

    if (path === "/refresh" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const limit = Math.min(60, Math.max(1, Math.round(Number(body?.limit) || 12)));
      const only = body?.watchId ? [await this.state.storage.get(`watch:${body.watchId}`)].filter(Boolean)
        : (await this.watches()).filter((w) => w.active !== false);
      const runs = [];
      for (const watch of only) runs.push({ watch: watch.id, ...await this.refresh(watch.id, limit) });
      return json({ runs });
    }

    return json({ error: "not found" }, 404);
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
