// 항공권 가격 관측 저장소 (trip/ 계획 탭).
//
// **경계**: 개인 일정·예산은 브라우저 localStorage 에만 있고 여기 오지 않는다.
// 여기 쌓이는 건 "어느 노선의 어느 날짜 조합이 얼마였나" 라는 가격 관측뿐이라,
// 새어 나가도 남의 여행 계획이 드러나지 않는다.
//
// 저장 구조
//   watch:<id>                     … 관측 대상(노선·구간·밤수·인원)
//   obs:<watchId>:<depart>:<ret>   … 조합별 **최신** 관측 (격자 한 칸)
//   hist:<watchId>                 … 관측일별 그리드 최저가 (추이 그래프의 점)
//   cursor:<watchId>               … 갱신 위치. cron 이 한 번에 그리드 전체를
//                                    돌리면 API 쿼터가 남지 않아 조금씩 밀어 둔다.
import {
  GRID_LIMITS, buildDateGrid, comboKey, validateWatch,
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

  /** 관측을 반영하고 그날의 그리드 최저가를 추이에 남긴다. */
  async record(watchId, observations, now = Date.now()) {
    const writes = {};
    let accepted = 0;
    for (const raw of observations) {
      const depart = String(raw?.depart ?? "");
      const ret = raw?.ret ? String(raw.ret) : null;
      const price = Math.round(Number(raw?.price));
      if (!depart || !Number.isFinite(price) || price <= 0) continue;
      writes[`obs:${watchId}:${depart}:${ret ?? "-"}`] = {
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
    if (!accepted) return { accepted: 0 };
    await this.state.storage.put(writes);

    const all = await this.observations(watchId);
    const min = all.reduce((m, o) => (m === null || o.price < m ? o.price : m), null);
    if (min !== null) {
      const date = kstDay(now);
      const hist = await this.history(watchId);
      const last = hist[hist.length - 1];
      // 하루 한 점만 남긴다. 같은 날 다시 관측하면 더 싼 값으로만 내린다 —
      // 그날의 "잡을 수 있었던 최저가"가 알고 싶은 값이다.
      if (last && last.date === date) last.min = Math.min(last.min, min);
      else hist.push({ date, min });
      await this.state.storage.put(
        `hist:${watchId}`, hist.slice(-GRID_LIMITS.historyDays),
      );
    }
    return { accepted };
  }

  /** 오래된 조합부터 limit 개만 실제로 조회한다. cron 과 수동 갱신이 같이 쓴다. */
  async refresh(watchId, limit) {
    const watch = await this.state.storage.get(`watch:${watchId}`);
    if (!watch) return { error: "watch not found", status: 404 };
    if (watch.active === false) return { refreshed: 0, skipped: "inactive" };

    const provider = createFlightProvider(this.env);
    if (!provider.live) return { refreshed: 0, skipped: `provider:${provider.name}` };
    if (!provider.configured) return { refreshed: 0, skipped: "provider not configured" };

    const combos = buildDateGrid(watch).slice(0, GRID_LIMITS.maxCombos);
    const observations = await this.observations(watchId);
    const targets = pickStaleCombos(combos, observations, limit);

    const results = [];
    const errors = [];
    for (const combo of targets) {
      try {
        const quote = await provider.quote({
          origin: watch.origin, dest: watch.dest,
          depart: combo.depart, ret: combo.ret,
          adults: watch.adults, cabin: watch.cabin,
          nonstop: watch.nonstop, currency: watch.currency,
        });
        // 해당 날짜에 파는 항공편이 없을 수도 있다(널). 그건 오류가 아니다.
        if (quote) results.push({ ...quote, depart: combo.depart, ret: combo.ret });
      } catch (error) {
        errors.push(String(error.message ?? error));
        // 상류가 막히면(429·인증) 남은 조합도 같은 결과다 — 쿼터를 더 태우지 않는다.
        break;
      }
    }
    const { accepted } = results.length ? await this.record(watchId, results) : { accepted: 0 };
    await this.state.storage.put(`cursor:${watchId}`, { at: Date.now(), tried: targets.length });
    return { refreshed: accepted, tried: targets.length, provider: provider.name, errors };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/watches" && request.method === "GET") {
      const watches = await this.watches();
      const provider = createFlightProvider(this.env);
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
      const obs = await this.state.storage.list({ prefix: `obs:${id}:` });
      if (obs.size) await this.state.storage.delete([...obs.keys()]);
      return json({ deleted: id });
    }

    if (path === "/grid" && request.method === "GET") {
      const id = url.searchParams.get("watch") ?? "";
      const watch = await this.state.storage.get(`watch:${id}`);
      if (!watch) return json({ error: "watch not found" }, 404);
      const provider = createFlightProvider(this.env);
      return json({
        ...summarizeObservations(watch, await this.observations(id), await this.history(id)),
        cursor: (await this.state.storage.get(`cursor:${id}`)) ?? null,
        provider: { name: provider.name, bookable: provider.bookable },
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
