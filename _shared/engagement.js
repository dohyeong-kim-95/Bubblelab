// 카드 페이지가 실제로 보이는 시간만 익명 세션 단위로 누적한다.
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
  if (site === "admin" || !/^[a-z0-9_-]{1,32}\/[a-z0-9._-]{1,64}$/.test(page)) return;

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
