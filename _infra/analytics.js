// 개인정보 없이 브라우저별 익명 ID만 저장하는 간단한 방문 통계.
// 날짜+ID를 storage key로 보관하고 35일이 지나면 삭제한다.

const DAY_MS = 24 * 60 * 60 * 1000;
const VISITOR_ID = /^[a-f0-9-]{36}$/i;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

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
      const { visitorId, date } = await request.json();
      if (!VISITOR_ID.test(visitorId ?? "") || !DATE_KEY.test(date ?? "")) {
        return new Response("invalid event", { status: 400 });
      }

      // 방문자별 key라 동시에 첫 방문이 들어와도 서로 덮어쓰지 않는다.
      await this.state.storage.put(`seen:${date}:${visitorId}`, true);

      // 매일 첫 방문 때 오래된 버킷을 정리한다. DAU가 작은 동안 충분히 가볍다.
      const cleanupKey = `cleanup:${date}`;
      if (!(await this.state.storage.get(cleanupKey))) {
        const keep = new Set(recentDates(date, 35));
        const stored = await this.state.storage.list({ prefix: "seen:" });
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

      return Response.json({
        date,
        daily: unique(1),
        weekly: unique(7),
        monthly: unique(30),
        generatedAt: new Date().toISOString(),
      });
    }

    return new Response("not found", { status: 404 });
  }
}
