// 토이별 주간 신기록 보드. 이번 주(월요일 09:00 KST = 월요일 00:00 UTC 시작)
// 최고 기록 하나(닉네임+점수)만 게임별로 저장한다. 인증 없는 자율 시스템이라
// 친구들끼리 자랑하는 용도다.

const GAME = /^[a-z0-9-]{1,32}$/;
const NICK = /^[가-힣a-zA-Z0-9]{1,6}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 관리자 공지 (기록 조회 응답에 실려 나가 방문자 팝업으로 전파)
const NOTICE_TEXT = /^[^\x00-\x09\x0b-\x1f]{1,200}$/; // 줄바꿈은 허용

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
  fruitmerge:   { dir: "max", min: 0, max: 1000000000 }, // 합체 점수
  "bubble-pop": { dir: "max", min: 0, max: 300 },       // 20초 터트린 버블 수
  "bubble-pop-idle": { dir: "max", min: 0, max: 1e100 }, // 7일 누적 버블 수
  circle:       { dir: "max", min: 0, max: 100 },       // 정확도(%)
  clicker:      { dir: "max", min: 0, max: 300 },       // 10초 클릭 수
  dart:         { dir: "max", min: 0, max: 1000 },      // 원에 꽂은 다트 수
  "dart-adv":   { dir: "max", min: 0, max: 1000 },      // 파워 게이지 다트 수
  flags:        { dir: "max", min: 0, max: 1000 },      // 연속으로 맞춘 국기 수
  logroll:      { dir: "max", min: 0, max: 100000 },    // 버틴 시간(초)
  reactiontime: { dir: "min", min: 30, max: 60000 },    // 반응속도(ms)
  touch25:      { dir: "min", min: 0, max: 3600 },      // 완주 시간(초)
  trader:       { dir: "max", min: -1, max: 100 },      // 수익률(비율)
  "yacht-bot":  { dir: "max", min: 0, max: 400 },       // 야추 총점
};
const HISTORICAL_GAMES = new Set(["bubble-pop-idle"]);

const beats = (dir, score, record) =>
  !record || (dir === "max" ? score > record.score : score < record.score);

// 10초 맞추기는 내부 비교 단위를 초로 유지하되 모든 화면에는 ms로 표시한다.
// 예전에 저장된 "0.123초" 형식의 기록도 읽는 즉시 새 단위로 보인다.
const presentRecord = (game, record) =>
  record && game === "10sec"
    ? { ...record, text: `오차 ${Math.round(record.score * 1000).toLocaleString("ko-KR")} ms` }
    : record;

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

    // ---------- 공지 (작성·삭제는 worker의 admin 인증 뒤에서만 도달) ----------
    if (url.pathname === "/_notice") {
      if (request.method === "GET") {
        const notice = (await this.state.storage.get("notice")) ?? null;
        return Response.json({ notice }, { headers: { "Cache-Control": "no-store" } });
      }
      if (request.method === "POST") {
        const { text } = await request.json().catch(() => ({}));
        const clean = typeof text === "string" ? text.trim() : "";
        if (!NOTICE_TEXT.test(clean)) return new Response("invalid notice", { status: 400 });
        const notice = { text: clean, at: Date.now() };
        await this.state.storage.put("notice", notice);
        return Response.json({ notice }, { status: 201 });
      }
      if (request.method === "DELETE") {
        await this.state.storage.delete("notice");
        return new Response(null, { status: 204 });
      }
    }

    // ---------- 관리자용 (worker의 admin 인증 뒤에서만 도달) ----------
    if (url.pathname === "/_allrecords" && request.method === "GET") {
      const all = await this.state.storage.list({ prefix: `rec:${week}:` });
      const records = {};
      for (const [key, v] of all) {
        const game = key.split(":")[2];
        records[game] = presentRecord(game, v);
      }
      return Response.json({ week, records }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "DELETE") {
      const game = url.searchParams.get("game");
      if (!GAME.test(game ?? "")) return new Response("invalid game", { status: 400 });
      await this.state.storage.delete(
        url.searchParams.has("alltime")
          ? `alltime:${game}`
          : [`rec:${week}:${game}`, `top3:${week}:${game}`], // 주간 리셋은 top3도 함께
      );
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET") {
      // 유한 시즌 게임의 주차별 우승 기록. 아직 프루닝되지 않은 rec 키와
      // 프루닝 전에 보존한 idlehall 키를 합쳐 최근 시즌부터 돌려준다.
      if (url.searchParams.has("history")) {
        const game = url.searchParams.get("game");
        if (!HISTORICAL_GAMES.has(game)) return new Response("invalid history game", { status: 400 });
        const byWeek = new Map();
        for (const [key, value] of await this.state.storage.list({ prefix: "idlehall:" })) {
          const [, savedWeek, savedGame] = key.split(":");
          if (savedGame === game) byWeek.set(savedWeek, value);
        }
        for (const [key, value] of await this.state.storage.list({ prefix: "rec:" })) {
          const [, savedWeek, savedGame] = key.split(":");
          if (savedGame === game) byWeek.set(savedWeek, value);
        }
        const records = [...byWeek]
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 52)
          .map(([savedWeek, record]) => ({ week: savedWeek, ...presentRecord(game, record) }));
        return Response.json({ week, game, records }, { headers: { "Cache-Control": "no-store" } });
      }
      // 올타임 명예의 전당: 저장된 올타임 + 이번 주 기록의 병합.
      // (올타임 저장 기능 도입 전에 세워진 이번 주 기록도 보이게 한다)
      if (url.searchParams.has("alltime")) {
        const records = {};
        for (const [k, v] of await this.state.storage.list({ prefix: "alltime:" })) {
          records[k.slice("alltime:".length)] = v;
        }
        for (const [k, v] of await this.state.storage.list({ prefix: `rec:${week}:` })) {
          const game = k.split(":")[2];
          if (beats(GAMES[game]?.dir ?? v.dir, v.score, records[game])) records[game] = v;
        }
        for (const game of Object.keys(records)) records[game] = presentRecord(game, records[game]);
        return Response.json({ records }, { headers: { "Cache-Control": "no-store" } });
      }
      // 공지는 별도 요청 없이 기록 조회에 실어 보낸다 (방문자 팝업용)
      const notice = (await this.state.storage.get("notice")) ?? null;

      // 배치 조회 (카테고리 홈 카드용): ?games=a,b,c → { records: { 이름: 기록 } }
      const batch = url.searchParams.get("games");
      if (batch !== null) {
        const records = {};
        const personal = {};
        const supported = [];
        const vid = url.searchParams.get("vid");
        for (const g of batch.split(",").filter((g) => GAME.test(g)).slice(0, 50)) {
          const r = await this.state.storage.get(`rec:${week}:${g}`);
          if (r) records[g] = presentRecord(g, r);
          if (GAMES[g]) {
            supported.push(g);
            if (VISITOR_ID.test(vid ?? "")) {
              const mine = await this.state.storage.get(`personal:${vid}:${g}`);
              if (mine) personal[g] = presentRecord(g, mine);
            }
          }
        }
        return Response.json(
          { week, records, personal, supported, notice },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const game = url.searchParams.get("game");
      if (!GAME.test(game ?? "")) return new Response("invalid game", { status: 400 });
      const rawRec = (await this.state.storage.get(`rec:${week}:${game}`)) ?? null;
      // top3(주간 1~3위). 배포 전 세워진 주는 top3가 없으니 1위 기록으로 시드.
      const rawTop3 = (await this.state.storage.get(`top3:${week}:${game}`)) ?? (rawRec ? [rawRec] : []);
      return Response.json({
        week,
        record: presentRecord(game, rawRec),
        top3: rawTop3.map((r) => presentRecord(game, r)),
        notice,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST" && url.pathname === "/_personal") {
      const { game, score, text, vid } = await request.json().catch(() => ({}));
      const cfg = GAMES[game];
      if (!cfg || !VISITOR_ID.test(vid ?? "") ||
          typeof score !== "number" || !Number.isFinite(score) ||
          score < cfg.min || score > cfg.max) {
        return new Response("invalid personal record", { status: 400 });
      }
      const display = typeof text === "string" && /^[^\x00-\x1f<>&"']{1,24}$/.test(text.trim())
        ? text.trim() : String(score);
      const key = `personal:${vid}:${game}`;
      const current = await this.state.storage.get(key);
      if (!beats(cfg.dir, score, current)) {
        return Response.json({ accepted: false, record: presentRecord(game, current) });
      }
      const record = { score, text: display, dir: cfg.dir, at: Date.now() };
      await this.state.storage.put(key, record);
      return Response.json({ accepted: true, record: presentRecord(game, record) });
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
      const top3Key = `top3:${week}:${game}`;
      const current = await this.state.storage.get(key);
      // 기존 top3(없으면 1위 기록으로 시드 — 배포 전 기록 호환)
      let list = (await this.state.storage.get(top3Key)) ?? (current ? [current] : []);

      const record = { nick, score, text: display, dir: cfg.dir, at: Date.now() };
      // 같은 닉네임은 더 좋은 기록만 유지 (나쁜 점수 재제출로 자기 순위가 내려가지 않게)
      const mine = list.find((e) => e.nick === nick);
      const keepEntry = mine && !beats(cfg.dir, score, mine) ? mine : record;
      let merged = [...list.filter((e) => e.nick !== nick), keepEntry];
      merged.sort((a, b) => (cfg.dir === "max" ? b.score - a.score : a.score - b.score));
      merged = merged.slice(0, 3);
      // 새 기록이 실제로 3위 안에 들었는지
      const accepted = keepEntry === record && merged.includes(record);

      if (accepted) {
        await this.state.storage.put(top3Key, merged);
        const top1 = merged[0];
        await this.state.storage.put(key, top1); // 1위는 항상 top3[0] (홈/올타임 호환)

        // 올타임 명예의 전당 갱신
        if (beats(cfg.dir, top1.score, await this.state.storage.get(`alltime:${game}`))) {
          await this.state.storage.put(`alltime:${game}`, top1);
        }

        // 지난주 기록 정리(rec + top3). 지우기 전에 올타임/명예의전당에 흡수.
        const stored = await this.state.storage.list({ prefix: "rec:" });
        const stale = [...stored].filter(([k]) => k.split(":")[1] !== week);
        for (const [k, v] of stale) {
          const g = k.split(":")[2];
          const oldWeek = k.split(":")[1];
          if (HISTORICAL_GAMES.has(g)) {
            await this.state.storage.put(`idlehall:${oldWeek}:${g}`, v);
          }
          if (beats(GAMES[g]?.dir ?? v.dir, v.score, await this.state.storage.get(`alltime:${g}`))) {
            await this.state.storage.put(`alltime:${g}`, v);
          }
        }
        if (stale.length) await this.state.storage.delete(stale.map(([k]) => k));
        const staleTop3 = [...(await this.state.storage.list({ prefix: "top3:" }))]
          .filter(([k]) => k.split(":")[1] !== week)
          .map(([k]) => k);
        if (staleTop3.length) await this.state.storage.delete(staleTop3);
      }

      return Response.json({
        week,
        accepted,
        record: presentRecord(game, merged[0] ?? null),
        top3: merged.map((r) => presentRecord(game, r)),
      });
    }

    return new Response("not found", { status: 404 });
  }
}
