// 오프라인에서도 열리게만 한다. 할 일은 localStorage 에 있어 네트워크가 필요 없다.
const CACHE = "life-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "store.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map((path) => cache.add(new Request(path, { cache: "reload" }))));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("life-") && key !== CACHE).map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

/* 네트워크를 먼저 본다. 캐시를 먼저 주면 로그인 세션이 끝났을 때 게이트가
 * 보내는 리다이렉트를 앱이 영영 보지 못한다. 끊겼을 때만 캐시로 연다. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    const url = new URL(response.url);
    if (response.ok && !response.redirected && !url.pathname.endsWith("/login")) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: request.mode === "navigate" })) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith("/login")) return;
  event.respondWith(networkFirst(request));
});
