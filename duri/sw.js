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
// 패스프레이즈·이름은 index.html이 로그인 때 IndexedDB "meta" 스토어에도 저장해 둔다
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
const readPassphrase = (db) => readMeta(db, "pass");
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
  if (!data || data.kind === "generic") return GENERIC;
  try {
    const db = await openDB();
    const pass = await readPassphrase(db);
    if (!pass) return GENERIC; // 이 기기에 문구가 없으면(로그인 전) 내용 없이만 알린다
    const key = await deriveKey(pass);
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
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ── 앱 셸 캐싱 ───────────────────────────────────────────────
// 문서(내비게이션)·manifest·아이콘만 대상 — 네이티브 앱처럼 다음 실행 때
// 네트워크 없이 즉시 뜨게 한다("캐시 먼저 보여주고, 최신본은 백그라운드로").
// /_duri·/_rt(실시간·게이트 API)는 항상 최신이어야 하므로 손대지 않는다 —
// 실제 데이터·인증은 이 캐시와 무관하게 매번 쿠키·E2E 패스프레이즈로 따로
// 검증되므로, 셸(빈 껍데기 마크업)을 캐싱해도 보안엔 영향이 없다.
const SHELL_CACHE = "duri-shell-v1";
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    // 게이트를 안 넘겨(bl_duri 쿠키 만료 등) /login으로 리다이렉트된 응답은
    // fetch가 자동으로 따라가 버려서, 캐싱하면 원래 URL 밑에 로그인 페이지가
    // 깔려버린다(다음에 로그인 성공해도 그 캐시부터 보임) — redirected면 skip.
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
  if (req.mode !== "navigate" && url.pathname !== "/manifest.json" && !url.pathname.endsWith("icon.svg")) return;

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
    if (await isAppFocused()) return;
    let data = null;
    try { data = event.data?.json() ?? null; } catch { /* 형식이 다르면 일반 알림으로 */ }
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
