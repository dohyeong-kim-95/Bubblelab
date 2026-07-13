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
        transform: translateX(-50%); font: .85rem ui-monospace, "SF Mono",
        "Cascadia Mono", "Roboto Mono", Consolas, monospace;
        padding: .85rem 2.3rem .85rem 1.1rem; border-radius: 1rem;
        border: 1.5px solid currentColor; color: light-dark(#334, #ccd);
        width: max-content; max-width: min(85vw, 22rem); white-space: pre-line;
        background: light-dark(rgba(255,255,255,.92), rgba(20,26,36,.92));
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        animation: bl-week-drop .35s cubic-bezier(.2,1.4,.4,1); }
      #bl-week-reset .x { position: absolute; top: .25rem; right: .5rem;
        border: 0; background: none; color: inherit; font: inherit;
        opacity: .5; cursor: pointer; padding: .2rem; }
      @keyframes bl-week-drop { from { transform: translate(-50%, -1.5rem); opacity: 0; } }
      #bl-notice { position: fixed; top: 50%; left: 50%; z-index: 10000;
        transform: translate(-50%, -50%); font: .9rem ui-monospace, "SF Mono",
        "Cascadia Mono", "Roboto Mono", Consolas, monospace;
        padding: 1.15rem 1.25rem; border-radius: 1rem;
        border: 1.5px solid currentColor; color: light-dark(#334, #ccd);
        width: min(85vw, 20rem); white-space: pre-line; text-align: left;
        background: light-dark(rgba(255,255,255,.96), rgba(20,26,36,.96));
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 12px 40px light-dark(rgba(30,50,70,.25), rgba(0,0,0,.55));
        display: flex; flex-direction: column; gap: .9rem;
        animation: bl-notice-pop .3s cubic-bezier(.2,1.4,.4,1); }
      #bl-notice b { font-size: 1rem; }
      #bl-notice .btns { display: flex; gap: .5rem; justify-content: flex-end; }
      #bl-notice button { font: inherit; font-size: .82rem; padding: .45rem .8rem;
        border-radius: .6rem; border: 1.5px solid currentColor; background: none;
        color: inherit; cursor: pointer; }
      #bl-notice .never { opacity: .55; }
      #bl-notice .ok { font-weight: bold; }
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
    font: bold .85rem ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace; padding: .55rem .95rem;
    border-radius: 2rem; border: 1.5px solid currentColor;
    color: light-dark(#334, #ccd); max-width: min(60vw, 18rem);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: light-dark(rgba(255,255,255,.75), rgba(20,26,36,.75));
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  #bl-claim { position: fixed; left: 1rem; bottom: 3.6rem; z-index: 9999;
    font: .85rem ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace; padding: .9rem 1rem;
    border-radius: 1rem; border: 1.5px solid currentColor;
    color: light-dark(#334, #ccd); width: min(80vw, 17rem);
    background: light-dark(rgba(255,255,255,.92), rgba(20,26,36,.92));
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    display: none; flex-direction: column; gap: .55rem; }
  #bl-claim.show { display: flex; }
  #bl-claim b { font-size: .95rem; }
  #bl-claim .row { display: flex; gap: .5rem; }
  #bl-claim input { flex: 1; min-width: 0; font: inherit; padding: .45rem .6rem;
    border-radius: .5rem; border: 1px solid currentColor; background: none; color: inherit; }
  #bl-claim button { font: inherit; font-weight: bold; padding: .45rem .8rem;
    border-radius: .5rem; border: 1.5px solid currentColor; background: none;
    color: inherit; cursor: pointer; }
  #bl-claim .msg { opacity: .65; min-height: 1em; }
  #bl-claim .x { position: absolute; top: .3rem; right: .55rem; border: 0;
    padding: .2rem; opacity: .5; font-weight: normal; }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const badge = document.createElement("div");
  badge.id = "bl-weekly";
  badge.textContent = "👑 주간 1위 …";
  document.body.appendChild(badge);

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
  let pending = null; // 등록 대기 중인 내 기록

  const beats = (score, record) =>
    !record || (cfg.dir === "max" ? score > record.score : score < record.score);

  function renderBadge() {
    badge.textContent = current
      ? `👑 ${current.nick} · ${current.text ?? fmt(current.score)}`
      : "👑 주간 1위 자리가 비어있어요";
    badge.title = "주간 신기록 보드 — 매주 월요일 09시 초기화";
  }

  fetch(`/_records?game=${cfg.game}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      current = data.record;
      renderBadge();
      window.blWeeklyResetNotice(data.week); // 공지 모달은 홈에서만

    })
    .catch(() => { badge.textContent = "👑 기록 보드 연결 실패"; });

  window.blWeeklyReport = (score) => {
    if (typeof score !== "number" || !Number.isFinite(score)) return;
    if (!beats(score, current)) return;
    if (pending && !beats(score, { score: pending })) return; // 이미 더 좋은 게 대기 중
    pending = score;
    claim.querySelector(".score").textContent =
      `${fmt(score)} — 이번 주 1위예요. 닉네임을 남겨보세요!`;
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
