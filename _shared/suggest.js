// 토이 아이디어 우편함 버튼. 카테고리 홈에 자동 포함된다 (build.mjs).
// 우측 하단 💡 버튼 → 텍스트 입력 → /_suggest 로 제출 → admin에서 조회.
(() => {
  // 색·글꼴은 bubble.css 토큰(카테고리 홈은 bubble.css 를 불러온다). 괄호 안은 토큰이
  // 없는 페이지를 위한 예전 값이다. 본문은 --sans — 모노는 숫자·라벨에만 쓴다.
  const css = `
  #bl-suggest { position: fixed; right: 1rem; bottom: 1rem; z-index: 9999;
    width: 3.2rem; height: 3.2rem; border-radius: 50%; cursor: pointer;
    font-size: 1.6rem; line-height: 1; border: 1.5px solid var(--line, currentColor);
    color: var(--ink, light-dark(#334, #ccd));
    background: color-mix(in srgb, var(--field, light-dark(#fff, #141a24)) 75%, transparent);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  #bl-suggest:active { transform: scale(.92); }
  #bl-suggest-panel { position: fixed; right: 1rem; bottom: 4.2rem; z-index: 9999;
    width: min(85vw, 19rem); padding: 1rem; border-radius: var(--r-lg, 1rem);
    border: 1.5px solid var(--line, currentColor); color: var(--ink, light-dark(#334, #ccd));
    font: .85rem var(--sans, system-ui, sans-serif);
    background: color-mix(in srgb, var(--field, light-dark(#fff, #141a24)) 95%, transparent);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    display: none; flex-direction: column; gap: .6rem; box-sizing: border-box; }
  #bl-suggest-panel.show { display: flex; }
  #bl-suggest-panel b { font-size: .95rem; }
  #bl-suggest-panel textarea { font: inherit; padding: .5rem .6rem; resize: none;
    border-radius: var(--r-sm, .5rem); border: 1px solid var(--line, currentColor); background: none;
    color: inherit; height: 4.2em; }
  #bl-suggest-panel .row { display: flex; justify-content: space-between;
    align-items: center; gap: .5rem; }
  #bl-suggest-panel .count { color: var(--muted, inherit); font: .75rem var(--mono, ui-monospace, monospace); }
  #bl-suggest-panel button { font: inherit; font-weight: bold; padding: .45rem .9rem;
    border-radius: 999px; border: 1.5px solid var(--line, currentColor); background: none;
    color: inherit; cursor: pointer; }
  #bl-suggest-panel .msg { color: var(--muted, inherit); min-height: 1em; font-size: .78rem; }
  #bl-suggest-panel .x { position: absolute; top: .35rem; right: .55rem;
    border: 0; background: none; color: inherit; opacity: .5; cursor: pointer;
    font: inherit; padding: .2rem; }
  #bl-suggest-panel .x:hover { opacity: 1; }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "bl-suggest";
  btn.type = "button";
  btn.textContent = "💡";
  btn.title = "이런 토이 만들어줘요!";
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "bl-suggest-panel";
  panel.innerHTML = `
    <button class="x" type="button" title="닫기">✕</button>
    <b>💡 이런 토이 만들어줘요!</b>
    <textarea maxlength="200" placeholder="예: 사무실에서 몰래 하는 테트리스"></textarea>
    <div class="row"><span class="count">0/200</span><button type="button">보내기</button></div>
    <span class="msg"></span>`;
  document.body.appendChild(panel);

  const ta = panel.querySelector("textarea");
  const countEl = panel.querySelector(".count");
  const msgEl = panel.querySelector(".msg");
  const sendBtn = panel.querySelector("button");

  for (const el of [btn, panel]) {
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => e.stopPropagation());
  }

  btn.addEventListener("click", () => {
    panel.classList.toggle("show");
    if (panel.classList.contains("show")) ta.focus();
  });
  panel.querySelector(".x").addEventListener("click", () => panel.classList.remove("show"));
  ta.addEventListener("input", () => { countEl.textContent = `${ta.value.length}/200`; });

  // 어느 페이지에서 보냈는지 (admin 표시용)
  function pageOf() {
    const seg = location.pathname.split("/").filter(Boolean);
    const site = location.hostname.endsWith("bubblelab.dev")
      ? location.hostname.split(".")[0] : (seg.shift() ?? "www");
    return seg.length ? `${site}/${seg[0]}` : site;
  }

  sendBtn.addEventListener("click", async () => {
    const text = ta.value.trim();
    if (!text) { msgEl.textContent = "내용을 적어주세요!"; return; }
    sendBtn.disabled = true;
    msgEl.textContent = "보내는 중…";
    try {
      const res = await fetch("/_suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, page: pageOf() }),
      });
      if (res.status === 429) {
        msgEl.textContent = "오늘은 이미 많이 보내주셨어요 — 내일 또 부탁해요 🙏";
      } else if (!res.ok) {
        msgEl.textContent = "⚠️ 전송 실패 — 잠시 후 다시 시도해주세요";
      } else {
        msgEl.textContent = "고마워요! 아이디어 잘 받았어요 🙌";
        ta.value = "";
        countEl.textContent = "0/200";
        setTimeout(() => { panel.classList.remove("show"); msgEl.textContent = ""; }, 1600);
      }
    } catch {
      msgEl.textContent = "⚠️ 전송 실패 — 잠시 후 다시 시도해주세요";
    }
    sendBtn.disabled = false;
  });
})();
