const CACHE = "life-shell-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "model.js", "crypto.js", "db.js", "sync.js", "manifest.json", "icon.svg"];

/* 설치할 때 셸을 실제로 담아 둔다. 예전에는 SHELL 목록만 있고 precache 가 없어서
 * 문서가 캐시에 들어간 적이 없었고, 오프라인 재진입이 그대로 실패했다. */
self.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map((path) => cache.add(new Request(path, { cache: "reload" }))));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("life-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

async function fetchAndCache(request, timeoutMs = 3500) {
  const cache = await caches.open(CACHE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request, { signal: controller.signal });
    const url = new URL(response.url);
    if (response.ok && !response.redirected && !url.pathname.endsWith("/login")) await cache.put(request, response.clone());
    return response;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/* 문서 요청은 네트워크를 먼저 본다. 캐시를 먼저 돌려주면 세션이 만료돼
 * 게이트가 로그인 화면으로 돌려보내는 것을 앱이 영영 볼 수 없어, 잠금 화면과
 * 401 사이를 오가며 빠져나갈 길이 없어진다. 네트워크가 죽었을 때만 캐시. */
async function networkFirstNavigation(request) {
  const response = await fetchAndCache(request, 2000);
  if (response) return response;
  const cache = await caches.open(CACHE);
  return (await cache.match(request, { ignoreSearch: true })) || Response.error();
}

async function networkFirst(request) {
  const response = await fetchAndCache(request);
  if (response) return response;
  const cache = await caches.open(CACHE);
  return (await cache.match(request, { ignoreSearch: false })) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/_life/") || url.pathname.endsWith("/login")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (SHELL.some((path) => path !== "./" && url.pathname.endsWith(path.replace("./", "/")))) event.respondWith(networkFirst(request));
});
