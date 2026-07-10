// 모든 토이 공용 주간 신기록 보드 (월요일 09:00 KST 초기화).
// 사용법:
//   window.blWeekly = { game: "touch25", dir: "min", fmt: (v) => v.toFixed(2) + "초" };
//   <script defer src="/_shared/records.js"></script>
//   기록이 나올 때마다 window.blWeeklyReport(점수) 호출.
// 이번 주 1위보다 좋은 기록이면 닉네임(한글/영문/숫자 6자) 등록 폼이 뜬다.
(() => {
  const cfg = window.blWeekly;
  if (!cfg?.game || !["min", "max"].includes(cfg.dir)) return;
  const fmt = cfg.fmt ?? ((v) => String(v));
  const NICK = /^[가-힣a-zA-Z0-9]{1,6}$/;

  const css = `
  #bl-weekly { position: fixed; left: 1rem; bottom: 1rem; z-index: 9999;
    font: bold .85rem ui-monospace, monospace; padding: .55rem .95rem;
    border-radius: 2rem; border: 1.5px solid currentColor;
    color: light-dark(#334, #ccd); max-width: min(60vw, 18rem);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: light-dark(rgba(255,255,255,.75), rgba(20,26,36,.75));
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  #bl-claim { position: fixed; left: 1rem; bottom: 3.6rem; z-index: 9999;
    font: .85rem ui-monospace, monospace; padding: .9rem 1rem;
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
    .then((data) => { current = data.record; renderBadge(); })
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
        body: JSON.stringify({ game: cfg.game, nick, score: pending, dir: cfg.dir,
                               text: fmt(pending) }),
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
