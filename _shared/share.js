// 모든 토이 공용 공유 버튼.
// 사용법: <script defer src="/_shared/share.js"></script> 한 줄이면 끝.
//   - 모바일: OS 공유 시트 (카카오톡/문자 등 포함)
//   - 데스크톱: 클립보드에 링크 복사 + 토스트
(() => {
  const css = `
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

  // 토이가 이미지를 함께 공유하도록 파일을 넘길 수 있다:
  //   window.blShareFiles = async () => [new File([blob], "x.png", {type:"image/png"})];
  // (File 배열 반환. 없거나 null이면 텍스트/링크만 공유)
  async function shareFiles() {
    const f = window.blShareFiles;
    if (typeof f !== "function") return null;
    try {
      const files = await f();
      return files && files.length ? files : null;
    } catch { return null; }
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

  // 우하단 공용 유틸 독에 등록한다. 독이 아직 안 떴어도 큐에 쌓였다가 그려진다.
  // (독이 알약 모양·접기·탭 전파 차단을 대신 처리하므로 여기선 동작만 넘긴다)
  (window.blDock = window.blDock || []).push({
    id: "bl-share",
    icon: "📤",
    label: "공유하기",
    order: 20,
    onClick: async () => {
    if (navigator.share) {
      try {
        const data = { title: document.title, url: location.href };
        const text = shareText();
        if (text) data.text = text;
        const files = await shareFiles();
        if (files && navigator.canShare && navigator.canShare({ files })) {
          data.files = files;
          // 일부 공유 대상은 파일이 있으면 url만 챙기고 text(문구)를 버린다.
          // 문구가 확실히 함께 가도록 url을 빼고 문구+링크를 text에 합친다.
          delete data.url;
          data.text = text ? `${text}\n${location.href}` : location.href;
        }
        await navigator.share(data);
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // 사용자가 시트를 닫음
      }
    }
    copyLink();
    },
  });
})();
