// 오프라인에서도 열리게만 한다. 할 일은 localStorage 에 있어 네트워크가 필요 없다.
const CACHE = "life-v4";
const SHELL = ["./", "index.html", "styles.css", "app.js", "store.js"];
// 크롬이 설치 가능 여부를 판단할 때 직접 보는 것들. 서비스워커가 중간에서
// 만지지 않는다 — 한 번이라도 옛 응답을 돌려주면 설치가 막힌다.
const INSTALL_ASSETS = ["/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"];

/* 리다이렉트된 응답은 캐시하지 않는다. 게이트가 /login 으로 돌려보낸 것을 그대로
 * 담아 두면, 그 뒤로 원본 대신 로그인 페이지가 나온다(설치가 막히던 원인 중 하나). */
async function store(cache, request, response) {
  if (!response.ok || response.redirected) return false;
  await cache.put(request, response.clone());
  return true;
}

self.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map(async (path) => {
    const request = new Request(path, { cache: "reload" });
    await store(cache, request, await fetch(request));
  }));
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
    await store(cache, request, response);
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: request.mode === "navigate" })) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/login") || INSTALL_ASSETS.includes(url.pathname)) return;
  event.respondWith(networkFirst(request));
});
