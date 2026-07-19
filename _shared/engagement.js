// ① 사람 행동(표시 상태 체류 또는 상호작용)이 확인되면 유효 방문 비콘을 보내고
// ② 카드 페이지가 실제로 보이는 시간만 익명 세션 단위로 누적한다.
// 같은 누적값을 주기적으로 덮어써 네트워크 재시도로 시간이 부풀지 않는다.
(() => {
  const MAX_ACTIVE_MS = 30 * 60 * 1000;
  const REPORT_EVERY_MS = 15 * 1000;
  const host = location.hostname.toLowerCase();
  const parts = location.pathname.split("/").filter(Boolean);
  let site;
  let card;

  if (host === "bubblelab.dev" || host === "www.bubblelab.dev") {
    site = "www";
    [card] = parts;
  } else if (host.endsWith(".bubblelab.dev")) {
    site = host.slice(0, -".bubblelab.dev".length);
    [card] = parts;
  } else {
    [site, card] = parts;
  }

  const page = `${site ?? ""}/${card ?? ""}`.toLowerCase();
  if (["admin", "work", "estate"].includes(site)) return;

  // 유효 방문 확정: 화면에 실제로 표시된 채 3초 이상 머물거나 클릭·키·휠·
  // 터치·스크롤이 발생하면 /_visit 비콘을 한 번 보낸다. HTML만 여는 크롤러는
  // JS를 실행해도 쿠키가 없으면 서버가 무시하므로 유효 방문자가 되지 않는다.
  // 서버는 방문자 쿠키로만 집계하므로 홈 페이지를 포함해 어디서든 보낸다.
  {
    const QUALIFY_MS = 3000;
    const INTERACTIONS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    let qualifyTimer = null;
    let qualifyAccumMs = 0;
    let qualifySince = null;

    const qualify = () => {
      clearTimeout(qualifyTimer);
      for (const type of INTERACTIONS) removeEventListener(type, qualify);
      document.removeEventListener("visibilitychange", onVisibility);
      const body = new Blob(["{}"], { type: "application/json" });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/_visit", body);
        return;
      }
      fetch("/_visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        keepalive: true,
      }).catch(() => {});
    };
    const armDwell = () => {
      if (qualifySince !== null) return;
      qualifySince = performance.now();
      qualifyTimer = setTimeout(qualify, Math.max(0, QUALIFY_MS - qualifyAccumMs));
    };
    const pauseDwell = () => {
      if (qualifySince === null) return;
      qualifyAccumMs += performance.now() - qualifySince;
      qualifySince = null;
      clearTimeout(qualifyTimer);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") armDwell();
      else pauseDwell();
    };

    for (const type of INTERACTIONS) addEventListener(type, qualify, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") armDwell();
  }

  if (!/^[a-z0-9_-]{1,32}\/[a-z0-9._-]{1,64}$/.test(page)) return;

  const sessionId = crypto.randomUUID();
  let accumulatedMs = 0;
  let activeSince = document.visibilityState === "visible" ? performance.now() : null;
  let lastSentMs = 0;

  const pause = () => {
    if (activeSince === null) return;
    accumulatedMs = Math.min(MAX_ACTIVE_MS, accumulatedMs + performance.now() - activeSince);
    activeSince = null;
  };
  const resume = () => {
    if (activeSince === null && accumulatedMs < MAX_ACTIVE_MS) activeSince = performance.now();
  };
  const currentMs = () => Math.min(
    MAX_ACTIVE_MS,
    accumulatedMs + (activeSince === null ? 0 : performance.now() - activeSince),
  );
  const payload = (activeMs) => JSON.stringify({ page, sessionId, activeMs: Math.round(activeMs) });

  const report = (leaving = false) => {
    const activeMs = currentMs();
    if (activeMs < 1000 || activeMs <= lastSentMs) return;
    lastSentMs = activeMs;
    if (leaving && navigator.sendBeacon) {
      navigator.sendBeacon("/_engagement", new Blob([payload(activeMs)], { type: "application/json" }));
      return;
    }
    fetch("/_engagement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload(activeMs),
      keepalive: true,
    }).catch(() => {});
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pause();
      report(true);
    } else {
      resume();
    }
  });
  addEventListener("pagehide", () => {
    pause();
    report(true);
  });
  setInterval(report, REPORT_EVERY_MS);
})();
