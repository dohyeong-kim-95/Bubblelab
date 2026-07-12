// 토이별 주간 신기록 보드. 이번 주(월요일 09:00 KST = 월요일 00:00 UTC 시작)
// 최고 기록 하나(닉네임+점수)만 게임별로 저장한다. 인증 없는 자율 시스템이라
// 친구들끼리 자랑하는 용도다.

const GAME = /^[a-z0-9-]{1,32}$/;
const NICK = /^[가-힣a-zA-Z0-9]{1,6}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const VISITOR_ID = /^[a-f0-9-]{36}$/i;

// 토이 아이디어 우편함 (홈의 💡 버튼 → admin에서 조회)
const SUG_TEXT = /^[^\x00-\x1f]{1,200}$/;
const SUG_MAX = 300;   // 이 이상 쌓이면 오래된 것부터 정리
const SUG_DAILY = 5;   // 방문자당 하루 제출 수

// 주간 보드를 쓰는 토이는 여기에 한 줄 등록한다. 비교 방향과 점수 범위는
// 서버가 고정한다 — 클라이언트가 보낸 dir은 무시된다 (dir 바꿔치기·
// 터무니없는 점수 등록 방지). 등록 안 된 게임의 제출은 거절된다.
export const GAMES = {
  "10sec":      { dir: "min", min: 0, max: 60 },        // 10초 오차(초)
  beer:         { dir: "min", min: 0, max: 501 },       // 500cc 오차(cc)+시간 타이브레이커
  "2048":       { dir: "max", min: 0, max: 1000000 },   // 점수
  circle:       { dir: "max", min: 0, max: 100 },       // 정확도(%)
  reactiontime: { dir: "min", min: 30, max: 60000 },    // 반응속도(ms)
  touch25:      { dir: "min", min: 0, max: 3600 },      // 완주 시간(초)
  trader:       { dir: "max", min: -1, max: 100 },      // 수익률(비율)
  "yacht-bot":  { dir: "max", min: 0, max: 400 },       // 야추 총점
};

// 가장 최근 월요일 00:00 UTC의 날짜 = 주차 key
export function weekKey(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export class RecordsDO {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const week = weekKey();

    // ---------- 토이 아이디어 우편함 ----------
    if (url.pathname === "/_suggest" && request.method === "POST") {
      const { text, page, vid, date } = await request.json().catch(() => ({}));
      const clean = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
      if (!SUG_TEXT.test(clean) || !DATE_KEY.test(date ?? "")) {
        return new Response("invalid suggestion", { status: 400 });
      }

      // 방문자당 하루 SUG_DAILY건 (쿠키 없는 익명은 공용 버킷 20건)
      const who = VISITOR_ID.test(vid ?? "") ? vid : "anon";
      const dayKey = `sugday:${date}:${who}`;
      const used = (await this.state.storage.get(dayKey)) ?? 0;
      if (used >= (who === "anon" ? 20 : SUG_DAILY)) {
        return new Response("daily limit", { status: 429 });
      }
      await this.state.storage.put(dayKey, used + 1);

      // 지난날 카운터와 넘치는 옛 제안 정리
      const days = await this.state.storage.list({ prefix: "sugday:" });
      const staleDays = [...days.keys()].filter((k) => k.split(":")[1] !== date);
      if (staleDays.length) await this.state.storage.delete(staleDays);
      const all = await this.state.storage.list({ prefix: "sug:" });
      if (all.size >= SUG_MAX) {
        await this.state.storage.delete(
          [...all.keys()].sort().slice(0, all.size - SUG_MAX + 1),
        );
      }

      const id = `sug:${String(Date.now()).padStart(14, "0")}:${crypto.randomUUID().slice(0, 8)}`;
      await this.state.storage.put(id, {
        text: clean,
        page: typeof page === "string" ? page.slice(0, 40) : "",
        at: Date.now(),
      });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (url.pathname === "/_suggestions") {
      if (request.method === "GET") {
        const all = await this.state.storage.list({ prefix: "sug:" });
        const items = [...all]
          .map(([id, v]) => ({ id, ...v }))
          .sort((a, b) => b.at - a.at)
          .slice(0, 200);
        return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
      }
      if (request.method === "DELETE") {
        const id = url.searchParams.get("id") ?? "";
        if (!id.startsWith("sug:")) return new Response("invalid id", { status: 400 });
        await this.state.storage.delete(id);
        return new Response(null, { status: 204 });
      }
    }

    // ---------- 관리자용 (worker의 admin 인증 뒤에서만 도달) ----------
    if (url.pathname === "/_allrecords" && request.method === "GET") {
      const all = await this.state.storage.list({ prefix: `rec:${week}:` });
      const records = {};
      for (const [key, v] of all) records[key.split(":")[2]] = v;
      return Response.json({ week, records }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "DELETE") {
      const game = url.searchParams.get("game");
      if (!GAME.test(game ?? "")) return new Response("invalid game", { status: 400 });
      await this.state.storage.delete(`rec:${week}:${game}`);
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET") {
      // 배치 조회 (카테고리 홈 카드용): ?games=a,b,c → { records: { 이름: 기록 } }
      const batch = url.searchParams.get("games");
      if (batch !== null) {
        const records = {};
        for (const g of batch.split(",").filter((g) => GAME.test(g)).slice(0, 50)) {
          const r = await this.state.storage.get(`rec:${week}:${g}`);
          if (r) records[g] = r;
        }
        return Response.json({ week, records }, { headers: { "Cache-Control": "no-store" } });
      }
      const game = url.searchParams.get("game");
      if (!GAME.test(game ?? "")) return new Response("invalid game", { status: 400 });
      const record = (await this.state.storage.get(`rec:${week}:${game}`)) ?? null;
      return Response.json({ week, record }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST") {
      const { game, nick, score, text } = await request.json().catch(() => ({}));
      const cfg = GAMES[game];
      if (!cfg || !NICK.test(nick ?? "") ||
          typeof score !== "number" || !Number.isFinite(score) ||
          score < cfg.min || score > cfg.max) {
        return new Response("invalid record", { status: 400 });
      }
      // 표시용 문자열(토이의 fmt 결과, 예: "12.34초"). 홈 카드처럼 단위를
      // 모르는 화면에서 쓴다. 수상하면 숫자 그대로로 대체.
      const display = typeof text === "string" && /^[^\x00-\x1f<>&"']{1,24}$/.test(text.trim())
        ? text.trim() : String(score);

      const key = `rec:${week}:${game}`;
      const current = await this.state.storage.get(key);
      const better = !current ||
        (cfg.dir === "max" ? score > current.score : score < current.score);
      if (!better) {
        return Response.json({ week, accepted: false, record: current });
      }

      const record = { nick, score, text: display, dir: cfg.dir, at: Date.now() };
      await this.state.storage.put(key, record);

      // 지난주 기록은 새 기록이 들어올 때 정리한다.
      const stored = await this.state.storage.list({ prefix: "rec:" });
      const stale = [...stored.keys()].filter((k) => k.split(":")[1] !== week);
      if (stale.length) await this.state.storage.delete(stale);

      return Response.json({ week, accepted: true, record });
    }

    return new Response("not found", { status: 404 });
  }
}
