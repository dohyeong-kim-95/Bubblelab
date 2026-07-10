// 토이별 주간 신기록 보드. 이번 주(월요일 09:00 KST = 월요일 00:00 UTC 시작)
// 최고 기록 하나(닉네임+점수)만 게임별로 저장한다. 인증 없는 자율 시스템이라
// 친구들끼리 자랑하는 용도다.

const GAME = /^[a-z0-9-]{1,32}$/;
const NICK = /^[가-힣a-zA-Z0-9]{1,6}$/;

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

    if (request.method === "GET") {
      const game = url.searchParams.get("game");
      if (!GAME.test(game ?? "")) return new Response("invalid game", { status: 400 });
      const record = (await this.state.storage.get(`rec:${week}:${game}`)) ?? null;
      return Response.json({ week, record }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST") {
      const { game, nick, score, dir } = await request.json().catch(() => ({}));
      if (!GAME.test(game ?? "") || !NICK.test(nick ?? "") ||
          typeof score !== "number" || !Number.isFinite(score) ||
          !["min", "max"].includes(dir)) {
        return new Response("invalid record", { status: 400 });
      }

      const key = `rec:${week}:${game}`;
      const current = await this.state.storage.get(key);
      // 방향은 첫 기록이 정한다 (이후 제출이 dir을 바꿔치기 못하게).
      const effectiveDir = current?.dir ?? dir;
      const better = !current ||
        (effectiveDir === "max" ? score > current.score : score < current.score);
      if (!better) {
        return Response.json({ week, accepted: false, record: current });
      }

      const record = { nick, score, dir: effectiveDir, at: Date.now() };
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
