// 운세 노트 서비스워커 — 푸시 알림 표시만 담당한다(캐시 없음).
// 같은 파일이 fortune.bubblelab.dev/note/ 와 util.bubblelab.dev/fortune/ 두 자리에서 등록된다. 여는 주소는 서버가 알림마다 정해
// 보내고(data.url), 없거나 다른 출처(origin)면 이 서비스워커가 등록된 자리(scope)를 연다.
// 알림 두 가지: 매일 오전 8시(KST) 오늘의 운세, 만화 사주 접수증의 완성 알림(토큰 없는 접수증 주소 — 화면이 이 기기에 적어 둔 토큰으로 연다).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// 같은 출처의 주소만 연다 — 다른 출처거나 읽을 수 없으면 자리(scope).
function safeUrl(raw, scope) {
  if (typeof raw !== "string" || !raw) return scope;
  try {
    const url = new URL(raw, scope);
    if (url.origin === new URL(scope).origin) return url.href;
  } catch { /* 자리로 */ }
  return scope;
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(
    data.title ?? "🔮 오늘의 운세",
    {
      body: data.body ?? "오늘의 운세를 확인해보세요.",
      data: { url: data.url ?? self.registration.scope },
      icon: "icon.svg",
      tag: data.tag === "comic-ready" ? "comic-ready" : "fortune-daily",
    },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const url = safeUrl(event.notification.data?.url, scope);
  // 자리 첫 화면(오늘의 운세)이면 자리 안의 아무 창이나 앞으로. 그 밖(접수증 등)은 같은 화면 창을 다시 불러 앞으로, 없으면 새로 연다.
  const path = (u) => new URL(u).pathname.replace(/\/$/, "");
  const home = path(url) === path(scope);
  event.waitUntil(clients.matchAll({ type: "window" }).then(async (windows) => {
    const existing = windows.find((w) => "focus" in w && (home ? w.url.startsWith(scope) : path(w.url) === path(url)));
    if (!existing) return clients.openWindow(url);
    if (!home && "navigate" in existing) await existing.navigate(url).catch(() => {});   // 새 상태로 다시 읽게
    return existing.focus();
  }));
});
