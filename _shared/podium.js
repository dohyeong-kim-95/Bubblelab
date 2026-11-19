// 삼대장 시상대 공용 렌더러.
//
// 게임별 1위 기록 묶음({ 게임: { nick, at } })을 받아 "몇 관왕인지"로 순위를 매기고
// 시상대를 그린다. 카테고리 홈(이번 주)과 명예의 전당(올타임)이 같은 규칙을 쓰도록
// 여기 한 곳에만 둔다 — 동점 처리가 두 곳으로 갈라지면 금방 어긋난다.
//
//   window.blPodium.render(mountEl, window.blPodium.rank(records), gameEmoji)
//
// 관왕 수가 같으면 한 단에 함께 세운다(경쟁 순위). 공동 1위가 둘이면 다음은 3위다.
(() => {
  const MEDAL = ["🥇", "🥈", "🥉"];
  const MAX_EMOJI = 6; // 시상대 단에 넣을 이모지 최대 개수

  const css = `
  .bl-podium { margin: 0 0 1.4rem; }
  .bl-podium[hidden] { display: none; }
  .bl-podium .podium-title { text-align: center; font-weight: bold; font-size: .95rem;
          margin: 0 0 .7rem; letter-spacing: .02em;
          color: light-dark(#8a6d12, #ffd873); }
  .bl-podium .podium-row { display: flex; justify-content: center; align-items: flex-end;
          gap: .55rem; max-width: 30rem; margin: 0 auto; }
  .bl-podium .podium-item { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
          align-items: center; text-align: center;
          animation: bl-podium-pop .5s cubic-bezier(.2,1.5,.4,1) both; }
  .bl-podium .rank-3 { animation-delay: .04s; }
  .bl-podium .rank-2 { animation-delay: .09s; }
  .bl-podium .rank-1 { animation-delay: .15s; }
  .bl-podium .podium-figure { font-size: 2rem; line-height: 1; filter: drop-shadow(0 2px 2px #0003); }
  .bl-podium .rank-1 .podium-figure { font-size: 2.7rem; }
  /* 동점이면 한 단에 여러 이름이 올라가므로 두 줄까지 접어서 보여준다 */
  .bl-podium .podium-nick { font-weight: bold; font-size: .88rem; margin-top: .25rem;
          max-width: 100%; overflow: hidden; overflow-wrap: anywhere;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .bl-podium .podium-count { font-size: .7rem; opacity: .72; margin-bottom: .4rem; }
  .bl-podium .podium-base { position: relative; width: 100%; overflow: hidden;
          border-radius: .55rem .55rem 0 0; }
  .bl-podium .podium-rank { position: absolute; inset: 0; display: grid; place-items: center;
          font-weight: 900; font-size: 2.4rem; color: #fff; opacity: .3;
          text-shadow: 0 1px 2px #0004; pointer-events: none; }
  .bl-podium .podium-games { position: relative; height: 100%; display: flex; flex-wrap: wrap;
          align-content: center; justify-content: center; gap: .05rem .1rem;
          padding: .25rem; font-size: .82rem; line-height: 1.05; }
  .bl-podium .podium-more { align-self: center; font-size: .58rem; font-weight: 800; color: #fff;
          text-shadow: 0 1px 1px #0006; }
  .bl-podium .rank-1 .podium-base { height: 4.6rem; background: linear-gradient(#f6d979, #dcae32); }
  .bl-podium .rank-2 .podium-base { height: 3.4rem; background: linear-gradient(#dfe6ec, #a8b4c1); }
  .bl-podium .rank-3 .podium-base { height: 2.6rem; background: linear-gradient(#e6b083, #bf7a45); }
  @keyframes bl-podium-pop { from { transform: scale(.6); opacity: 0; } }`;

  let styled = false;
  function ensureStyle() {
    if (styled) return;
    styled = true;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // { 게임: { nick, at } } → [{ rank, count, members:[{nick, at, games}] }, …] (상위 3단)
  function rank(records) {
    const byNick = new Map();
    for (const [game, r] of Object.entries(records ?? {})) {
      if (!r || !r.nick) continue;
      const cur = byNick.get(r.nick) ?? { count: 0, at: 0, games: [] };
      cur.count += 1;
      cur.at = Math.max(cur.at, r.at ?? 0);
      cur.games.push(game);
      byNick.set(r.nick, cur);
    }
    const people = [...byNick.entries()]
      .map(([nick, v]) => ({ nick, count: v.count, at: v.at, games: v.games }))
      .sort((a, b) => b.count - a.count || b.at - a.at || a.nick.localeCompare(b.nick));
    // 관왕 수가 같으면 같은 등수. 공동 1위가 둘이면 다음 사람은 3위다.
    const tiers = [];
    let placed = 0;
    for (const p of people) {
      const last = tiers[tiers.length - 1];
      if (last && last.count === p.count) last.members.push(p);
      else tiers.push({ rank: placed + 1, count: p.count, members: [p] });
      placed += 1;
    }
    return tiers.filter((t) => t.rank <= 3);
  }

  function render(mount, tiers, gameEmoji = {}) {
    if (!mount) return false;
    if (!Array.isArray(tiers) || !tiers.length) return false;
    if (!tiers.every((t) => t && Array.isArray(t.members) && t.rank)) return false;
    ensureStyle();
    const row = mount.querySelector(".podium-row");
    if (!row) return false;
    row.textContent = "";
    const byRank = new Map(tiers.map((t) => [t.rank, t]));
    // 세 단이 다 있으면 1등을 가운데 두는 고전 배치(3·1·2). 동점 때문에 단이
    // 빠지면(공동 1위 둘이면 2등 단이 없다) 1등이 끝으로 밀리므로 등수 순으로 둔다.
    const full = [1, 2, 3].every((r) => byRank.has(r));
    for (const pos of full ? [3, 1, 2] : [...byRank.keys()].sort((a, b) => a - b)) {
      const t = byRank.get(pos);
      if (!t) continue;
      const item = document.createElement("div");
      item.className = "podium-item rank-" + pos;
      const fig = document.createElement("div");
      fig.className = "podium-figure";
      fig.textContent = MEDAL[pos - 1];
      const nick = document.createElement("div");
      nick.className = "podium-nick";
      nick.textContent = t.members.map((m) => m.nick).join(" · ");
      const cnt = document.createElement("div");
      cnt.className = "podium-count";
      cnt.textContent = (t.members.length > 1 ? "공동 " : "") + "👑 " + t.count + "관왕";
      // 시상대 단: 큰 순위 숫자(워터마크) 위에 1등한 게임 이모지들을 올린다.
      // 동점이면 그 단에 선 사람들의 게임을 모두 합쳐 얹는다.
      const base = document.createElement("div");
      base.className = "podium-base";
      const rankNum = document.createElement("span");
      rankNum.className = "podium-rank";
      rankNum.textContent = String(pos);
      const games = document.createElement("div");
      games.className = "podium-games";
      const emojis = t.members.flatMap((m) => m.games ?? []).map((g) => gameEmoji[g] ?? "🫧");
      for (const e of emojis.slice(0, MAX_EMOJI)) {
        const s = document.createElement("span");
        s.textContent = e;
        games.appendChild(s);
      }
      if (emojis.length > MAX_EMOJI) {
        const more = document.createElement("span");
        more.className = "podium-more";
        more.textContent = "+" + (emojis.length - MAX_EMOJI);
        games.appendChild(more);
      }
      base.append(rankNum, games);
      item.append(fig, nick, cnt, base);
      row.appendChild(item);
    }
    mount.hidden = false;
    return true;
  }

  window.blPodium = { rank, render };
})();
