// 즉시 열리게 하는 것이 목적이다. 할 일은 localStorage 에 있어 네트워크가 필요 없고,
// 화면을 이루는 파일은 몇 KB 라 캐시에서 바로 내주고 뒤에서 새로 받아 둔다.
const CACHE = "life-v5";
const SHELL = ["./", "index.html", "styles.css", "app.js", "store.js"];
// 크롬이 설치 가능 여부를 판단할 때 직접 보는 것들. 서비스워커가 만지지 않는다.
const INSTALL_ASSETS = ["/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"];

/* 리다이렉트된 응답은 캐시하지 않는다. 게이트가 /login 으로 돌려보낸 것을 담아 두면
 * 그 뒤로 원본 대신 로그인 페이지가 나온다. */
const storable = (response) => response.ok && !response.redirected;

self.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map(async (path) => {
    const request = new Request(path, { cache: "reload" });
    const response = await fetch(request);
    if (storable(response)) await cache.put(request, response);
  }));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("life-") && key !== CACHE).map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

async function announceUpdate() {
  for (const client of await self.clients.matchAll()) client.postMessage({ type: "life:updated" });
}

/* 캐시에 있으면 그걸 바로 내주고(네트워크를 기다리지 않는다), 뒤에서 새로 받아
 * 캐시를 갈아 둔다. 내용이 실제로 달라졌을 때만 화면에 알려 새로고침하게 한다 —
 * 배포하면 곧바로 반영되면서도 여는 순간은 네트워크를 타지 않는다. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
  const fresh = fetch(request).then(async (response) => {
    if (!storable(response)) return response;
    const before = cached ? await cached.clone().text() : null;
    const after = await response.clone().text();
    await cache.put(request, response.clone());
    if (before !== null && before !== after) await announceUpdate();
    return response;
  }).catch(() => null);

  if (cached) { fresh.catch(() => {}); return cached; }
  return (await fresh) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/login") || INSTALL_ASSETS.includes(url.pathname)) return;
  event.respondWith(staleWhileRevalidate(request));
});
