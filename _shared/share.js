// 모든 토이 공용 공유 버튼.
// 사용법: <script defer src="/_shared/share.js"></script> 한 줄이면 끝.
//   - 모바일: OS 공유 시트 (카카오톡/문자 등 포함)
//   - 데스크톱: 클립보드에 링크 복사 + 토스트
(() => {
  // 토스트 모양·동작은 dock.js 의 window.blToast 하나다.
  function toast(msg) {
    window.blToast?.(msg);
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
  // 파일을 오래 만들면 iOS Safari 는 탭(사용자 제스처)의 유효시간이 지나
  // navigator.share 를 NotAllowedError 로 거절한다. 그때는 링크 복사로 넘어가면서
  // 왜 이미지가 빠졌는지 토스트로 알린다(조용히 다른 동작을 하지 않는다).
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
        if (err.name === "NotAllowedError") {
          await copyLink();
          toast("공유 창을 열지 못해 링크를 복사했어요 — 한 번 더 누르면 이미지와 함께 공유돼요");
          return;
        }
      }
    }
    copyLink();
    },
  });
})();
