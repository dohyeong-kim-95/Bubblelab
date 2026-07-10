// 개인정보 없이 브라우저별 익명 ID만 저장하는 간단한 방문 통계.
// 날짜+ID(seen:)와 날짜+페이지+ID(pv:)를 storage key로 보관하고
// 35일이 지나면 삭제한다.

const DAY_MS = 24 * 60 * 60 * 1000;
const VISITOR_ID = /^[a-f0-9-]{36}$/i;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_KEY = /^[a-z0-9_-]{1,32}(\/[a-z0-9._-]{1,64})?$/;

function recentDates(endDate, count) {
  const end = new Date(`${endDate}T00:00:00+09:00`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(end.getTime() - i * DAY_MS);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  });
}

export class AnalyticsDO {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/track") {
      const { visitorId, date, page } = await request.json();
      if (!VISITOR_ID.test(visitorId ?? "") || !DATE_KEY.test(date ?? "")) {
        return new Response("invalid event", { status: 400 });
      }

      // 방문자별 key라 동시에 첫 방문이 들어와도 서로 덮어쓰지 않는다.
      await this.state.storage.put(`seen:${date}:${visitorId}`, true);

      // 페이지가 유효하면 페이지별 순방문자도 기록한다. 이상한 경로는
      // 방문자 집계까지 버리지 않도록 조용히 무시한다.
      if (typeof page === "string" && PAGE_KEY.test(page)) {
        await this.state.storage.put(`pv:${date}:${page}:${visitorId}`, true);
      }

      // 매일 첫 방문 때 오래된 버킷을 정리한다. DAU가 작은 동안 충분히 가볍다.
      const cleanupKey = `cleanup:${date}`;
      if (!(await this.state.storage.get(cleanupKey))) {
        const keep = new Set(recentDates(date, 35));
        const stored = await this.state.storage.list();
        // 모든 key(seen:/pv:/cleanup:)는 두 번째 조각이 날짜다.
        const stale = [...stored.keys()].filter((k) => !keep.has(k.split(":")[1]));
        if (stale.length) await this.state.storage.delete(stale);
        await this.state.storage.put(cleanupKey, true);
      }

      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const date = url.searchParams.get("date");
      if (!DATE_KEY.test(date ?? "")) return new Response("invalid date", { status: 400 });

      const dates = recentDates(date, 30);
      const stored = await this.state.storage.list({ prefix: "seen:" });
      const visitorsByDate = new Map(dates.map((d) => [d, new Set()]));
      for (const key of stored.keys()) {
        const [, day, visitorId] = key.split(":");
        visitorsByDate.get(day)?.add(visitorId);
      }
      const unique = (count) => new Set(
        dates.slice(0, count).flatMap((d) => [...visitorsByDate.get(d)]),
      ).size;

      // 최근 30일 페이지별 순방문자 TOP 3. 사이트 홈(슬래시 없는 page)은
      // 카드가 아니므로 제외한다.
      const window = new Set(dates);
      const visitorsByPage = new Map();
      const pv = await this.state.storage.list({ prefix: "pv:" });
      for (const key of pv.keys()) {
        const [, day, page, visitorId] = key.split(":");
        if (!window.has(day) || !page.includes("/")) continue;
        if (!visitorsByPage.has(page)) visitorsByPage.set(page, new Set());
        visitorsByPage.get(page).add(visitorId);
      }
      const top = [...visitorsByPage]
        .map(([page, ids]) => ({ page, users: ids.size }))
        .sort((a, b) => b.users - a.users || a.page.localeCompare(b.page))
        .slice(0, 3);

      return Response.json({
        date,
        daily: unique(1),
        weekly: unique(7),
        monthly: unique(30),
        top,
        generatedAt: new Date().toISOString(),
      });
    }

    return new Response("not found", { status: 404 });
  }
}
