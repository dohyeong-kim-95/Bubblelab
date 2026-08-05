// Duri 서비스워커 — 푸시 알림 표시 + 앱 셸(HTML·manifest·아이콘) 캐싱.
// 페이로드는 서버가 여전히 평문을 모르는 암호블롭({iv,ct} 또는 {metaIv,metaCt})뿐이라,
// 이 기기 안에서 직접 복호화한 뒤에만 알림에 진짜 내용(보낸 사람·문자)을 띄운다 —
// 그래야 브라우저 푸시 중계 서버도 절대 평문을 보지 않는 duri의 E2E 원칙이 유지된다.
// 키 유도 로직은 index.html의 deriveKey/decryptJson과 반드시 같아야 한다(같은 상수).

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const SALT = enc.encode("duri:v1:pbkdf2:shared-passphrase");
const ITER = 210_000;

function openDB() {
  return new Promise((resolve) => {
    let req;
    // index.html과 버전이 반드시 같아야 한다 — 여기 버전이 더 낮으면 실제 DB가
    // 이미 그보다 높은 버전으로 올라가 있어 VersionError로 열기 자체가 실패하고,
    // readMeta()가 항상 null을 돌려줘 미리보기·본인 메시지 제외가 조용히 죽는다.
    try { req = indexedDB.open("duri", 2); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("entries")) d.createObjectStore("entries", { keyPath: "seq" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
// 키 객체·이름은 index.html이 로그인 때 IndexedDB "meta" 스토어에 담아 둔다
// (localStorage는 이 기기의 페이지에서만 보이고 서비스워커에선 못 읽는다).
function readMeta(db, id) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains("meta")) return resolve(null);
    try {
      const req = db.transaction("meta").objectStore("meta").get(id);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
// 페이지가 로그인 때 담아 둔 **키 객체**(추출 불가 CryptoKey)를 그대로 쓴다.
// 옛 기기는 아직 평문 문구("pass")만 갖고 있을 수 있어서, 그 경우에만 유도한다
// (페이지를 한 번 열면 index.html이 키로 바꿔 담고 문구를 지운다).
async function readKey(db) {
  const key = await readMeta(db, "key");
  if (key) return key;
  const pass = await readMeta(db, "pass");
  return pass ? deriveKey(pass) : null;
}
async function deriveKey(passphrase) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
}
async function decryptJson(key, ivB64, ctB64) {
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, unb64(ctB64));
  return JSON.parse(dec.decode(bytes));
}

const GENERIC = { title: "💞 Duri", body: "새 메시지가 도착했어요" };

async function buildNotification(data) {
  if (data && data.kind === "test") { // 자가진단: 앱을 보고 있어도 무조건 뜬다
    return { title: "🔔 Duri 테스트 알림", body: "알림이 정상 동작해요!" };
  }
  if (!data || data.kind === "generic") return GENERIC;
  try {
    const db = await openDB();
    const key = await readKey(db);
    if (!key) return GENERIC; // 이 기기에 키가 없으면(로그인 전) 내용 없이만 알린다
    const myName = await readMeta(db, "name"); // 내가 보낸 메시지는 내 기기에 알리지 않는다
    if (data.kind === "msg") {
      const p = await decryptJson(key, data.iv, data.ct);
      if (myName && p.name === myName) return null;
      return { title: p.name || "💞 Duri", body: p.sticker ? "(이모티콘)" : (p.text || "") };
    }
    if (data.kind === "photo") {
      const p = await decryptJson(key, data.metaIv, data.metaCt);
      if (myName && p.name === myName) return null;
      return { title: p.name || "💞 Duri", body: "사진" };
    }
  } catch { /* 문구가 다르거나 복호화 실패 — 내용 없이만 알린다 */ }
  return GENERIC;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  // 셸 캐시 버전을 올리면 옛 캐시는 지운다 — 새 배포가 "두 번째 실행"이 아니라
  // 바로 다음 실행에 반영되게(빈 새 캐시 → 첫 로드는 네트워크 최신본).
  for (const name of await caches.keys()) {
    if (name.startsWith("duri-shell-") && name !== SHELL_CACHE) await caches.delete(name);
  }
  await self.clients.claim();
})()));

// ── 앱 셸 캐싱 ───────────────────────────────────────────────
// /_duri·/_rt(실시간·게이트 API)는 항상 최신이어야 하므로 손대지 않는다 —
// 실제 데이터·인증은 이 캐시와 무관하게 매번 쿠키·E2E 패스프레이즈로 따로
// 검증되므로, 셸(빈 껍데기 마크업)을 캐싱해도 보안엔 영향이 없다.
const SHELL_CACHE = "duri-shell-v2";

// 문서(HTML)는 '네트워크 우선'. 앱을 열 때마다 최신 코드를 받아, index.html만
// 바뀐 배포도 "다음 실행"이 아니라 바로 이번 실행에 반영된다(예전 stale-while-
// revalidate는 항상 캐시를 먼저 보여줘 새 코드가 한 박자 늦게 떴다). 오프라인일
// 때만 마지막으로 받은 셸로 폴백한다.
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    // 게이트를 안 넘겨(bl_duri 쿠키 만료 등) /login으로 리다이렉트된 응답은
    // 캐싱하지 않는다(다음 로그인 성공 뒤에도 그 캐시부터 보이는 걸 막음).
    if (res.ok && !res.redirected) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || Response.error(); // 오프라인 폴백
  }
}
// manifest·아이콘 등 거의 안 바뀌는 정적 에셋은 캐시 우선 + 백그라운드 갱신.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res.ok && !res.redirected) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return { cached, network };
}
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_duri/") || url.pathname.startsWith("/_rt/")) return;

  if (req.mode === "navigate") { // HTML 문서 → 네트워크 우선(항상 최신)
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname !== "/manifest.json" && !url.pathname.endsWith("icon.svg")) return;
  event.respondWith((async () => {
    const { cached, network } = await staleWhileRevalidate(req);
    event.waitUntil(network); // 캐시를 바로 돌려준 뒤에도 백그라운드 최신화가 끝까지 실행되게
    return cached || (await network) || Response.error();
  })());
});

// 이 기기에서 이미 앱 화면을 보고 있으면(포커스 중) 시스템 알림을 띄우지
// 않는다 — 어차피 웹소켓으로 화면에 바로 뜨는데 알림까지 겹칠 필요가 없다.
async function isAppFocused() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.some((c) => c.focused || c.visibilityState === "visible");
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = null;
    try { data = event.data?.json() ?? null; } catch { /* 형식이 다르면 일반 알림으로 */ }
    // 테스트 알림은 앱을 보고 있어도 띄운다(자가진단 목적). 그 외에는 포커스 중이면 생략.
    if (data?.kind !== "test" && await isAppFocused()) return;
    const result = await buildNotification(data);
    if (!result) return; // 내가 보낸 메시지 — 알리지 않는다
    const { title, body } = result;
    await self.registration.showNotification(title, {
      body, icon: "icon.svg", tag: "duri-msg", renotify: true,
      data: { url: "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(clients.matchAll({ type: "window" }).then((windows) => {
    const existing = windows.find((w) => "focus" in w);
    return existing ? existing.focus() : clients.openWindow(url);
  }));
});
