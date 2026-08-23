// 즉시 열리게 하는 것이 목적이다. 할 일은 localStorage 에 있어 네트워크가 필요 없고,
// 화면을 이루는 파일은 몇 KB 라 캐시에서 바로 내주고 뒤에서 새로 받아 둔다.
//
// **셸과 도구는 규칙이 다르다.** 셸(여기 이 폴더의 파일들)은 누르자마자 떠야 하므로
// 캐시에서 먼저 내준다. 도구(life/<이름>/)는 눌러서 이동하는 별도 페이지라 100ms 는
// 보이지 않는 반면, 캐시를 먼저 내주면 **배포한 것이 한 박자 늦게 도착한다** —
// 고쳐서 배포했는데 폰에서 그대로인 사고가 실제로 났다. 그래서 도구는 네트워크 먼저,
// 실패하면 캐시(오프라인에서도 열린다).
const CACHE = "life-v7";
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

/* 스코프 밑에 폴더가 하나 더 있으면 도구다. 주소는 배포(life.bubblelab.dev/espanol/)와
 * 로컬(localhost/life/espanol/)이 다르므로 등록 스코프를 기준으로 잘라 본다. */
const SCOPE = new URL(self.registration.scope).pathname;
const isTool = (url) =>
  (url.pathname.startsWith(SCOPE) ? url.pathname.slice(SCOPE.length) : "").includes("/");

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (storable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    // 네트워크가 없을 때만 캐시로 내려온다 — 마지막으로 받아 둔 것으로 연다.
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    return cached ?? Response.error();
  }
}

/* 공유 시트로 들어온 것(manifest 의 share_target)은 POST 로 온다. 서비스워커가
 * 가로채 잠깐 담아 두고 그 화면을 연다.
 *
 * 파일을 이렇게 받는 이유: 브라우저는 파일 선택창이 어느 폴더에서 열릴지 정할 수
 * 없다(안드로이드 크롬에는 File System Access API 자체가 없다). 폴더를 찾아가는
 * 대신 파일을 앱으로 보내는 쪽으로 뒤집으면 선택창이 통째로 없어진다.
 *
 * 셸은 어느 도구가 받는지 모른다 — life 안에서 POST 하는 곳은 여기뿐이라
 * 들어온 경로의 화면으로 그대로 넘긴다. */
const SHARE_CACHE = "bl-life-share";
const SHARE_KEY = "/__share";

async function receiveShare(request, target) {
  let payload = "";
  try {
    const form = await request.formData();
    const file = form.getAll("file").find((one) => one && typeof one.text === "function" && one.size);
    payload = file ? await file.text() : [form.get("text"), form.get("title")].filter(Boolean).join("\n");
  } catch { /* 못 읽으면 빈손으로 연다 — 화면은 떠야 한다 */ }
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(SHARE_KEY, new Response(payload, { headers: { "content-type": "text/plain" } }));
  return Response.redirect(`${target}?share=1`, 303);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const shared = new URL(request.url);
  if (request.method === "POST" && shared.origin === self.location.origin
    && shared.pathname.startsWith(SCOPE)) {
    event.respondWith(receiveShare(request, shared.pathname));
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/login") || INSTALL_ASSETS.includes(url.pathname)) return;
  event.respondWith(isTool(url) ? networkFirst(request) : staleWhileRevalidate(request));
});
