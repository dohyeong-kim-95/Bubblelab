// 오늘의 운세 서비스워커 — 매일 오전 8시(KST) 푸시 알림 표시만 담당한다.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(
    data.title ?? "🔮 오늘의 운세",
    {
      body: data.body ?? "오늘의 운세를 확인해보세요.",
      data: { url: data.url ?? "https://util.bubblelab.dev/fortune" },
      icon: "icon.svg",
      tag: "fortune-daily",
    },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/fortune";
  event.waitUntil(clients.matchAll({ type: "window" }).then((windows) => {
    const existing = windows.find((w) => "focus" in w && w.url.includes("/fortune"));
    return existing ? existing.focus() : clients.openWindow(url);
  }));
});
