// 모든 토이 공용 공유 버튼.
// 사용법: <script defer src="/_shared/share.js"></script> 한 줄이면 끝.
//   - 모바일: OS 공유 시트 (카카오톡/문자 등 포함)
//   - 데스크톱: 클립보드에 링크 복사 + 토스트
(() => {
  const css = `
  #bl-share { position: fixed; right: 1rem; bottom: 1rem; z-index: 9999;
    font: bold .85rem ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace; padding: .55rem .95rem;
    border-radius: 2rem; border: 1.5px solid currentColor; cursor: pointer;
    color: light-dark(#334, #ccd);
    background: light-dark(rgba(255,255,255,.75), rgba(20,26,36,.75));
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  #bl-share:active { transform: scale(.94); }
  #bl-toast { position: fixed; left: 50%; bottom: 4.2rem; z-index: 9999;
    transform: translateX(-50%); font: .85rem ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace;
    padding: .55rem 1rem; border-radius: 2rem; pointer-events: none;
    color: light-dark(#fff, #123); background: light-dark(#333c46, #dce6f0);
    opacity: 0; transition: opacity .25s; }
  #bl-toast.show { opacity: 1; }`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const toastEl = document.createElement("div");
  toastEl.id = "bl-toast";
  document.body.appendChild(toastEl);
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  // 토이가 자랑 문구를 지정할 수 있다:
  //   window.blShareText = () => `내 기록은 123ms! 도전해보세요`;
  // (문자열도 가능. 없으면 링크만 공유)
  function shareText() {
    const t = window.blShareText;
    return (typeof t === "function" ? t() : t) || "";
  }

  async function copyLink() {
    const text = shareText();
    const payload = text ? `${text}\n${location.href}` : location.href;
    try {
      await navigator.clipboard.writeText(payload);
      toast(text ? "자랑 문구를 복사했어요 ✓" : "링크를 복사했어요 ✓");
    } catch {
      toast("복사 실패 — 주소창에서 복사해주세요");
    }
  }

  const btn = document.createElement("button");
  btn.id = "bl-share";
  btn.type = "button";
  btn.textContent = "📤 공유";
  // 전체 화면을 클릭 영역으로 쓰는 토이(반응속도 등)에 이벤트가 새지 않게
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        const data = { title: document.title, url: location.href };
        const text = shareText();
        if (text) data.text = text;
        await navigator.share(data);
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // 사용자가 시트를 닫음
      }
    }
    copyLink();
  });
  document.body.appendChild(btn);
})();
