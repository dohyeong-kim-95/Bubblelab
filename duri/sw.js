// Duri 서비스워커 — 푸시 알림 표시만 담당한다(캐싱은 하지 않음, fetch 핸들러 없음).
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
    try { req = indexedDB.open("duri", 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("entries")) req.result.createObjectStore("entries", { keyPath: "seq" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
// 패스프레이즈는 index.html이 로그인 때 IndexedDB "meta" 스토어에도 저장해 둔다
// (localStorage는 이 기기의 페이지에서만 보이고 서비스워커에선 못 읽는다).
function readPassphrase(db) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains("meta")) return resolve(null);
    try {
      const req = db.transaction("meta").objectStore("meta").get("pass");
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
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
  if (!data || data.kind === "generic") return GENERIC;
  try {
    const db = await openDB();
    const pass = await readPassphrase(db);
    if (!pass) return GENERIC; // 이 기기에 문구가 없으면(로그인 전) 내용 없이만 알린다
    const key = await deriveKey(pass);
    if (data.kind === "msg") {
      const p = await decryptJson(key, data.iv, data.ct);
      return { title: p.name || "💞 Duri", body: p.sticker ? "(이모티콘)" : (p.text || "") };
    }
    if (data.kind === "photo") {
      const p = await decryptJson(key, data.metaIv, data.metaCt);
      return { title: p.name || "💞 Duri", body: "사진" };
    }
  } catch { /* 문구가 다르거나 복호화 실패 — 내용 없이만 알린다 */ }
  return GENERIC;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = null;
    try { data = event.data?.json() ?? null; } catch { /* 형식이 다르면 일반 알림으로 */ }
    const { title, body } = await buildNotification(data);
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
