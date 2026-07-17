// 개인정보 없이 브라우저별 익명 ID만 저장하는 간단한 방문 통계.
// 날짜+ID(seen:)와 날짜+페이지+ID(pv:)를 storage key로 보관하고
// 35일이 지나면 삭제한다.

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_ID = UUID_V4;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_KEY = /^[a-z0-9_-]{1,32}(\/[a-z0-9._-]{1,64})?$/;
const SESSION_ID = UUID_V4;
const MAX_SESSION_MS = 30 * 60 * 1000;
const ASSET_CATEGORY = /^(sticker|wallpaper|photo-frame|music)$/;
const ASSET_PART = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

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

    if (request.method === "POST" && url.pathname === "/download") {
      const { category, id, file } = await request.json().catch(() => ({}));
      if (!ASSET_CATEGORY.test(category ?? "") || !ASSET_PART.test(id ?? "") ||
          !ASSET_PART.test(file ?? "")) {
        return new Response("invalid download", { status: 400 });
      }
      const key = `download:${category}:${id}:${file}`;
      let count;
      const increment = async (storage) => {
        count = (Number(await storage.get(key)) || 0) + 1;
        await storage.put(key, count);
      };
      if (typeof this.state.storage.transaction === "function") {
        await this.state.storage.transaction(increment);
      } else {
        await increment(this.state.storage);
      }
      return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "GET" && url.pathname === "/downloads") {
      const stored = await this.state.storage.list({ prefix: "download:" });
      const files = {};
      const items = {};
      let total = 0;
      for (const [key, value] of stored) {
        const [, category, id, file] = key.split(":");
        const count = Number(value) || 0;
        const fileKey = `${category}/${id}/${file}`;
        const itemKey = `${category}/${id}`;
        files[fileKey] = count;
        items[itemKey] = (items[itemKey] || 0) + count;
        total += count;
      }
      return Response.json({ files, items, total });
    }

    if (request.method === "POST" && url.pathname === "/streak") {
      const { visitorId, date } = await request.json().catch(() => ({}));
      if (!VISITOR_ID.test(visitorId ?? "") || !DATE_KEY.test(date ?? "")) {
        return new Response("invalid event", { status: 400 });
      }
      const key = `streak:${visitorId}`;
      const previous = await this.state.storage.get(key);
      if (previous?.lastDate !== date) {
        const yesterday = recentDates(date, 2)[1];
        const streak = previous?.lastDate === yesterday ? previous.streak + 1 : 1;
        await this.state.storage.put(key, { lastDate: date, streak });
      }
      const current = await this.state.storage.get(key);
      return Response.json(current, { headers: { "Cache-Control": "no-store" } });
    }

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
        if (page === "slop" || page.startsWith("slop/")) {
          const streakKey = `streak:${visitorId}`;
          const previous = await this.state.storage.get(streakKey);
          if (previous?.lastDate !== date) {
            const yesterday = recentDates(date, 2)[1];
            const streak = previous?.lastDate === yesterday ? previous.streak + 1 : 1;
            await this.state.storage.put(streakKey, { lastDate: date, streak });
          }
        }
      }

      // 매일 첫 방문 때 오래된 버킷을 정리한다. DAU가 작은 동안 충분히 가볍다.
      const cleanupKey = `cleanup:${date}`;
      if (!(await this.state.storage.get(cleanupKey))) {
        const keep = new Set(recentDates(date, 35));
        const stored = await this.state.storage.list();
        // 모든 key(seen:/pv:/cleanup:)는 두 번째 조각이 날짜다.
        const stale = [...stored.keys()].filter((k) =>
          /^(seen|pv|eng|cleanup):/.test(k) && !keep.has(k.split(":")[1]));
        if (stale.length) await this.state.storage.delete(stale);
        await this.state.storage.put(cleanupKey, true);
      }

      return new Response(null, { status: 204 });
    }

    // 한 카드 페이지 세션의 누적 활성화면 시간을 저장한다. 클라이언트가 같은
    // 세션을 주기적으로 다시 보내므로 delta를 더하지 않고 가장 큰 누적값만 둔다.
    // 네트워크 재시도나 순서 역전이 있어도 시간이 부풀지 않는다.
    if (request.method === "POST" && url.pathname === "/engage") {
      const { visitorId, date, page, sessionId, activeMs } = await request.json().catch(() => ({}));
      if (!VISITOR_ID.test(visitorId ?? "") || !DATE_KEY.test(date ?? "") ||
          !PAGE_KEY.test(page ?? "") || !page.includes("/") ||
          !SESSION_ID.test(sessionId ?? "") || !Number.isFinite(activeMs) || activeMs < 0) {
        return new Response("invalid engagement", { status: 400 });
      }
      const key = `eng:${date}:${page}:${visitorId}:${sessionId}`;
      const previous = await this.state.storage.get(key);
      const nextMs = Math.min(MAX_SESSION_MS, Math.round(activeMs));
      if (nextMs >= 1000 && nextMs > (previous?.activeMs ?? 0)) {
        await this.state.storage.put(key, { activeMs: nextMs });
      }
      return new Response(null, { status: 204 });
    }

    // 페이지별 최근 N일 순방문자 (카테고리 홈의 접속량순 정렬용, 공개)
    if (request.method === "GET" && url.pathname === "/pages") {
      const date = url.searchParams.get("date");
      if (!DATE_KEY.test(date ?? "")) return new Response("invalid date", { status: 400 });
      const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 7));
      const window = new Set(recentDates(date, days));
      const visitorsByPage = new Map();
      const pv = await this.state.storage.list({ prefix: "pv:" });
      for (const key of pv.keys()) {
        const [, day, page, visitorId] = key.split(":");
        if (!window.has(day)) continue;
        if (!visitorsByPage.has(page)) visitorsByPage.set(page, new Set());
        visitorsByPage.get(page).add(visitorId);
      }
      return Response.json({
        date,
        days,
        pages: Object.fromEntries(
          [...visitorsByPage].map(([page, ids]) => [page, ids.size]),
        ),
      });
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const date = url.searchParams.get("date");
      if (!DATE_KEY.test(date ?? "")) return new Response("invalid date", { status: 400 });
      const engagementDays = Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 30));

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

      const engagementWindow = new Set(dates.slice(0, engagementDays));
      const engagementByPage = new Map();
      const engagementStored = await this.state.storage.list({ prefix: "eng:" });
      for (const [key, value] of engagementStored) {
        const [, day, page, visitorId] = key.split(":");
        const activeMs = Number(value?.activeMs);
        if (!engagementWindow.has(day) || !page?.includes("/") || !Number.isFinite(activeMs)) continue;
        if (!engagementByPage.has(page)) {
          engagementByPage.set(page, { visitors: new Set(), sessions: [] });
        }
        const group = engagementByPage.get(page);
        group.visitors.add(visitorId);
        group.sessions.push(activeMs);
      }
      const engagement = [...engagementByPage]
        .map(([page, group]) => {
          const totalMs = group.sessions.reduce((sum, ms) => sum + ms, 0);
          const engagedSessions = group.sessions.filter((ms) => ms >= 10_000).length;
          return {
            page,
            visitors: group.visitors.size,
            sessions: group.sessions.length,
            totalMs,
            medianMs: median(group.sessions),
            engagedRate: Math.round(engagedSessions / group.sessions.length * 1000) / 10,
          };
        })
        .sort((a, b) => b.totalMs - a.totalMs || b.medianMs - a.medianMs || a.page.localeCompare(b.page));

      return Response.json({
        date,
        daily: unique(1),
        weekly: unique(7),
        monthly: unique(30),
        top,
        engagementDays,
        engagement,
        generatedAt: new Date().toISOString(),
      });
    }

    return new Response("not found", { status: 404 });
  }
}
