// 모든 토이 공용 주간 신기록 보드 (월요일 09:00 KST 초기화).
// 사용법:
//   window.blWeekly = { game: "touch25", dir: "min", fmt: (v) => v.toFixed(2) + "초" };
//   <script defer src="/_shared/records.js"></script>
//   기록이 나올 때마다 window.blWeeklyReport(점수) 호출.
// 이번 주 1위보다 좋은 기록이면 닉네임(한글/영문/숫자 6자) 등록 폼이 뜬다.
(() => {
  // 방문자 팝업: (1) 지난주에 왔던 방문자가 이번 주 처음 들어오면 주간 보드
  // 리셋 안내 토스트를 상단에 한 번 띄우고, (2) notice가 넘어오면 화면
  // 중앙 모달로 "다시 보지 않기"를 누를 때까지 방문할 때마다 띄운다.
  // records 응답의 week(주차 키)와 notice를 받아 호출한다. 공지 모달은
  // 카테고리 홈에서만 쓴다 — 게임 안에서까지 띄우는 건 부적절하므로
  // 토이 페이지(아래 fetch)는 notice를 넘기지 않는다.
  // 홈과 토이 양쪽에서 쓰므로 자급자족으로 만든다.
  window.blWeeklyResetNotice = (week, notice) => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? "")) return;
      const style = document.createElement("style");
      style.textContent = `
      #bl-week-reset { position: fixed; top: 1rem; left: 50%; z-index: 9999;
        transform: translateX(-50%); font: .85rem var(--sans, system-ui, sans-serif);
        padding: .85rem 2.3rem .85rem 1.1rem; border-radius: var(--r-lg, 1.4rem);
        border: 1px solid var(--line, light-dark(#d9d4c8, #232a36)); color: var(--ink, light-dark(#15171c, #ece8df));
        width: max-content; max-width: min(85vw, 22rem); white-space: pre-line;
        background: color-mix(in srgb, var(--field, light-dark(#fffdf8, #141a25)) 94%, transparent);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 .8rem 2.4rem light-dark(rgb(60 50 30 / .14), rgb(0 0 0 / .5));
        animation: bl-week-drop .35s cubic-bezier(.2,1.4,.4,1); }
      #bl-week-reset .x { position: absolute; top: .25rem; right: .5rem;
        border: 0; background: none; color: inherit; font: inherit;
        opacity: .5; cursor: pointer; padding: .2rem; }
      @keyframes bl-week-drop { from { transform: translate(-50%, -1.5rem); opacity: 0; } }
      #bl-notice { position: fixed; top: 50%; left: 50%; z-index: 10000;
        transform: translate(-50%, -50%); font: .9rem var(--sans, system-ui, sans-serif);
        padding: 1.15rem 1.25rem; border-radius: var(--r-lg, 1.4rem);
        border: 1px solid var(--line, light-dark(#d9d4c8, #232a36)); color: var(--ink, light-dark(#15171c, #ece8df));
        width: min(85vw, 20rem); white-space: pre-line; text-align: left;
        background: color-mix(in srgb, var(--field, light-dark(#fffdf8, #141a25)) 94%, transparent);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 .8rem 2.4rem light-dark(rgb(60 50 30 / .18), rgb(0 0 0 / .55));
        display: flex; flex-direction: column; gap: .9rem;
        animation: bl-notice-pop .3s cubic-bezier(.2,1.4,.4,1); }
      #bl-notice b { font-size: 1rem; }
      #bl-notice .btns { display: flex; gap: .5rem; justify-content: flex-end; }
      #bl-notice button { font: inherit; font-size: .85rem; font-weight: 600; min-height: 2.4rem;
        padding: .45rem 1rem; border-radius: 999px; border: 1px solid var(--line, light-dark(#d9d4c8, #232a36)); cursor: pointer;
        background: var(--field, light-dark(#fffdf8, #141a25)); color: inherit; }
      #bl-notice .never { border-color: transparent; background: none; color: var(--muted, inherit); }
      #bl-notice .ok { border-color: transparent; background: var(--accent, #3f5fd0);
        color: var(--accent-ink, #fff); }
      @keyframes bl-notice-pop { from { transform: translate(-50%, -50%) scale(.9); opacity: 0; } }`;
      document.head.appendChild(style);

      // 전체 화면을 클릭 영역으로 쓰는 토이에 이벤트가 새지 않게
      const shield = (el) => {
        for (const ev of ["pointerdown", "click", "keydown"]) {
          el.addEventListener(ev, (e) => e.stopPropagation());
        }
      };

      // (1) 주간 리셋 안내 토스트 — 이번 주 첫 방문에 한 번
      const prev = localStorage.getItem("bl-seen-week");
      localStorage.setItem("bl-seen-week", week);
      if (prev && prev !== week) { // 처음 온 사람에게 리셋 안내는 무의미
        const lines = ["🧹 새로운 한 주가 시작됐어요!\n주간 1위 보드는 매주 월요일 09시에 리셋돼요. 빈자리를 노려보세요 👑"];
        // 2026-07-13 주 한정 안내 (공지 기능 도입 전 주의 기록 — 다음부터는 admin 공지로)
        if (week === "2026-07-13") lines.push("지난주 통합 1위는 김윤배님이었어요 🏆");
        const box = document.createElement("div");
        box.id = "bl-week-reset";
        box.setAttribute("role", "status");
        box.textContent = lines.join("\n\n");
        const x = document.createElement("button");
        x.className = "x";
        x.textContent = "✕";
        x.addEventListener("click", () => box.remove());
        box.appendChild(x);
        shield(box);
        document.body.appendChild(box);
        setTimeout(() => box.remove(), 4000 + lines.length * 4000);
      }

      // (2) 공지 모달 — "다시 보지 않기" 전까지 방문할 때마다
      if (notice?.text && localStorage.getItem("bl-seen-notice") !== String(notice.at)) {
        const modal = document.createElement("div");
        modal.id = "bl-notice";
        modal.setAttribute("role", "alertdialog");
        modal.setAttribute("aria-label", "공지");
        const title = document.createElement("b");
        title.textContent = "📢 공지";
        const body = document.createElement("span");
        body.textContent = notice.text;
        const btns = document.createElement("div");
        btns.className = "btns";
        const never = document.createElement("button");
        never.className = "never";
        never.textContent = "다시 보지 않기";
        never.addEventListener("click", () => {
          localStorage.setItem("bl-seen-notice", String(notice.at));
          modal.remove();
        });
        const ok = document.createElement("button");
        ok.className = "ok";
        ok.textContent = "닫기";
        ok.addEventListener("click", () => modal.remove());
        btns.append(never, ok);
        modal.append(title, body, btns);
        shield(modal);
        document.body.appendChild(modal);
      }
    } catch {} // localStorage 불가(시크릿 모드 등)면 조용히 넘어간다
  };

  const cfg = window.blWeekly;
  if (!cfg?.game || !["min", "max"].includes(cfg.dir)) return;
  const fmt = cfg.fmt ?? ((v) => String(v));
  const NICK = /^[가-힣a-zA-Z0-9]{1,6}$/;

  const css = `
  #bl-weekly { position: fixed; left: 1rem; bottom: 1rem; z-index: 9999;
    font: 700 .85rem var(--sans, system-ui, sans-serif); padding: .6rem 1rem;
    border-radius: var(--r-lg, 1.4rem); border: 1px solid var(--line, light-dark(#d9d4c8, #232a36));
    color: var(--ink, light-dark(#15171c, #ece8df)); max-width: min(72vw, 18rem); font-variant-numeric: tabular-nums;
    white-space: pre-line; line-height: 1.55; cursor: pointer;
    background: color-mix(in srgb, var(--field, light-dark(#fffdf8, #141a25)) 94%, transparent);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 .8rem 2.4rem light-dark(rgb(60 50 30 / .14), rgb(0 0 0 / .5)); }
  #bl-weekly.collapsed { padding: .5rem .8rem; }
  /* 결과 카드는 대개 화면 가운데에 뜬다 — 겹치지 않게 위쪽 가운데에서 내려온다 */
  #bl-claim { position: fixed; top: calc(env(safe-area-inset-top, 0px) + .75rem); left: 50%;
    transform: translateX(-50%); z-index: 9999;
    font: .85rem var(--sans, system-ui, sans-serif); padding: .9rem 1rem;
    border-radius: var(--r-lg, 1.4rem); border: 1px solid var(--line, light-dark(#d9d4c8, #232a36));
    color: var(--ink, light-dark(#15171c, #ece8df)); width: min(92vw, 22rem);
    background: color-mix(in srgb, var(--field, light-dark(#fffdf8, #141a25)) 94%, transparent);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 .8rem 2.4rem light-dark(rgb(60 50 30 / .14), rgb(0 0 0 / .5));
    display: none; flex-direction: column; gap: .55rem; }
  #bl-claim.show { display: flex; }
  #bl-claim b { font-size: .95rem; }
  #bl-claim .row { display: flex; gap: .5rem; }
  #bl-claim input { flex: 1; min-width: 0; font: inherit; font-size: 1rem; padding: .55rem .8rem;
    border-radius: var(--r-sm, .6rem); border: 1px solid var(--line, light-dark(#d9d4c8, #232a36)); background: var(--field, light-dark(#fffdf8, #141a25)); color: inherit; }
  #bl-claim input:focus-visible { outline: 2px solid var(--focus, #3f5fd0); outline-offset: 1px; }
  #bl-claim button { font: inherit; font-weight: 700; padding: .55rem 1rem; border-radius: 999px;
    border: 0; background: var(--accent, #3f5fd0); color: var(--accent-ink, #fff); cursor: pointer; }
  #bl-claim .msg { color: var(--muted, inherit); min-height: 1em; }
  #bl-claim .x { position: absolute; top: .3rem; right: .45rem; padding: .3rem .45rem;
    background: none; color: var(--muted, inherit); font-weight: normal; }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const badge = document.createElement("div");
  badge.id = "bl-weekly";
  badge.textContent = "👑 주간 순위 …";
  document.body.appendChild(badge);
  const MEDALS = ["🥇", "🥈", "🥉"];

  const claim = document.createElement("div");
  claim.id = "bl-claim";
  claim.innerHTML = `
    <button class="x" type="button">✕</button>
    <b>🏆 주간 신기록!</b>
    <span class="score"></span>
    <div class="row">
      <input maxlength="6" placeholder="닉네임 (6자)" aria-label="닉네임">
      <button class="ok" type="button">등록</button>
    </div>
    <span class="msg">한글/영문/숫자 6자 이내</span>`;
  document.body.appendChild(claim);
  const input = claim.querySelector("input");
  const msgEl = claim.querySelector(".msg");
  input.value = localStorage.getItem("bl-nick") ?? "";

  // 전체 화면을 클릭 영역으로 쓰는 토이에 이벤트가 새지 않게
  for (const el of [badge, claim]) {
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => e.stopPropagation());
  }

  let current = null; // 이번 주 1위 { nick, score } | null
  let top3 = [];      // 이번 주 1~3위 [{ nick, score, text }]
  let pending = null; // 등록 대기 중인 내 기록
  let collapsed = false; // 배지 접힘 상태(탭으로 토글, 저장됨)
  try { collapsed = localStorage.getItem("bl-weekly-collapsed") === "1"; } catch {}
  if (collapsed) { badge.classList.add("collapsed"); badge.textContent = "👑 ▸"; }

  const beats = (score, record) =>
    !record || (cfg.dir === "max" ? score > record.score : score < record.score);

  // 이 점수가 주간 3위 안에 들 수 있는가 (자리가 남았거나 현재 3위보다 좋음)
  const inTop3 = (score) => top3.length < 3 || beats(score, top3[2]);

  function renderBadge() {
    badge.classList.toggle("collapsed", collapsed);
    if (collapsed) {
      badge.textContent = "👑 ▸";
      badge.title = "주간 순위 펼치기";
      return;
    }
    if (top3.length) {
      badge.textContent =
        "👑 주간 순위 ▾\n" +
        top3.map((r, i) => `${MEDALS[i]} ${r.nick} · ${r.text ?? fmt(r.score)}`).join("\n");
      badge.title = "주간 신기록 1~3위 — 매주 월요일 09시 초기화 · 탭하면 접기";
    } else {
      badge.textContent = "👑 주간 순위 ▾\n자리가 비어있어요";
      badge.title = "주간 신기록 보드 — 매주 월요일 09시 초기화 · 탭하면 접기";
    }
  }

  badge.addEventListener("click", () => {
    collapsed = !collapsed;
    try { localStorage.setItem("bl-weekly-collapsed", collapsed ? "1" : "0"); } catch {}
    renderBadge();
  });

  fetch(`/_records?game=${cfg.game}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      current = data.record;
      top3 = data.top3 ?? (data.record ? [data.record] : []);
      renderBadge();
      window.blWeeklyResetNotice(data.week); // 공지 모달은 홈에서만

    })
    .catch(() => { badge.textContent = "👑 기록 보드 연결 실패"; });

  window.blWeeklyReport = (score) => {
    if (typeof score !== "number" || !Number.isFinite(score)) return;
    // 주간 1위 여부와 무관하게 이 브라우저의 올타임 최고 기록을 갱신한다.
    fetch("/_personal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: cfg.game, score, text: fmt(score) }),
      keepalive: true,
    }).catch(() => {});
    if (!inTop3(score)) return;
    if (pending && !beats(score, { score: pending })) return; // 이미 더 좋은 게 대기 중
    pending = score;
    const rank = top3.filter((r) => beats(r.score, { score })).length + 1; // 예상 순위
    claim.querySelector(".score").textContent =
      `${fmt(score)} — 주간 ${rank}위예요! 닉네임을 남겨보세요!`;
    msgEl.textContent = "한글/영문/숫자 6자 이내";
    claim.classList.add("show");
    input.focus();
  };

  claim.querySelector(".x").addEventListener("click", () => {
    claim.classList.remove("show");
    pending = null;
  });

  async function submit() {
    const nick = input.value.trim();
    if (!NICK.test(nick)) {
      msgEl.textContent = "⚠️ 한글/영문/숫자만, 1~6자로 부탁해요";
      return;
    }
    localStorage.setItem("bl-nick", nick);
    msgEl.textContent = "등록 중…";
    try {
      const res = await fetch("/_records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: cfg.game, nick, score: pending, text: fmt(pending) }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      current = data.record;
      if (data.top3) top3 = data.top3;
      renderBadge();
      if (data.accepted) {
        claim.classList.remove("show");
        pending = null;
      } else {
        msgEl.textContent = "😅 그 사이에 더 좋은 기록이 나왔어요";
        pending = null;
        setTimeout(() => claim.classList.remove("show"), 1800);
      }
    } catch {
      msgEl.textContent = "⚠️ 등록 실패 — 잠시 후 다시 시도해주세요";
    }
  }
  claim.querySelector(".ok").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
})();
