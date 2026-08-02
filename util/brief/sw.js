// 아침 브리핑 서비스워커 — 매일 오전 8시(KST) 푸시 알림 표시만 담당한다.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(
    data.title ?? "🌤️ 아침 브리핑",
    {
      body: data.body ?? "오늘의 날씨를 확인해보세요.",
      data: { url: data.url ?? "https://util.bubblelab.dev/brief" },
      icon: "icon.svg",
      tag: "brief-daily",
    },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/brief";
  event.waitUntil(clients.matchAll({ type: "window" }).then((windows) => {
    const existing = windows.find((w) => "focus" in w && w.url.includes("/brief"));
    return existing ? existing.focus() : clients.openWindow(url);
  }));
});
