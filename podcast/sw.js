// 데일리 팟캐스트 PWA 서비스워커 — 푸시 표시와 앱 셸 캐시만 담당한다.
const CACHE = "bl-podcast-v1";

self.addEventListener("install", (event) => {
  // 캐시 실패는 설치를 막지 않되, 조용히 삼키지 않고 로그를 남긴다.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["./"]))
      .catch((error) => console.warn("앱 셸 캐시 실패:", error)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

// 내비게이션만 네트워크 우선 + 오프라인 셸 폴백. API·오디오는 손대지 않는다.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("./")));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(
    data.title ?? "🎙️ 데일리 팟캐스트",
    { body: data.body ?? "", data: { url: data.url ?? "./" }, icon: "icon.svg" },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "./";
  event.waitUntil(clients.matchAll({ type: "window" }).then((windows) => {
    const existing = windows.find((w) => "focus" in w);
    return existing ? existing.focus() : clients.openWindow(url);
  }));
});
