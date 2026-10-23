// mindfulness 카드들이 함께 쓰는 작은 도구 — 각 카드의 app.js 보다 먼저 불러온다.
// 화면 전환(setView)은 카드마다 화면 구성이 달라 각 app.js 에 둔다.
window.mindCommon = (() => {
  "use strict";
  let toastTimer = 0;
  let wakeLock = null;

  // Args: toast — 알림 요소, message — 보여 줄 문구, durationMs — 떠 있는 시간
  function showToast(toast, message, durationMs) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), durationMs);
  }

  // Args: nodes — 멈추고 연결을 끊을 오디오 노드 배열(비워서 돌려준다)
  function stopNodes(nodes) {
    for (const node of nodes) {
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    nodes.length = 0;
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // Args: dialog — 안내 <dialog>, closeButtons — 누르면 닫히는 버튼들. 바깥(배경)을 눌러도 닫힌다.
  function bindInfoDialog(dialog, closeButtons) {
    for (const button of closeButtons) {
      button.addEventListener("click", () => dialog.close());
    }
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  return { showToast, stopNodes, requestWakeLock, releaseWakeLock, bindInfoDialog };
})();
