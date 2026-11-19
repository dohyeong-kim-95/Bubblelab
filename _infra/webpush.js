// 표준 Web Push 발송기 (RFC 8291 aes128gcm + RFC 8292 VAPID).
// 외부 라이브러리 없이 WebCrypto만 사용하므로 Worker와 Node 어디서든 동작한다.
// 키 형식은 web-push 라이브러리와 동일: 공개키 = 비압축 P-256 포인트(65바이트)
// base64url, 개인키 = d 값(32바이트) base64url.

const encoder = new TextEncoder();

export function b64uEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

// 브라우저가 실제로 쓰는 푸시 서비스(FCM·Mozilla·Apple·Windows)만 받는다. endpoint 는
// 매일 아침 워커가 POST 하는 주소라, 아무 https 호스트나 받으면 남의 서버로 요청을
// 퍼뜨리는 통로가 된다(보안 감사 M-6, 2026-11-18).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

function b64uLength(value, max) {
  if (typeof value !== "string" || value.length > max || !/^[A-Za-z0-9_-]+=*$/.test(value)) return -1;
  try { return b64uDecode(value.replace(/=+$/, "")).length; } catch { return -1; }
}

/** 웹 푸시 구독 형식 검사: 알려진 푸시 서비스의 https endpoint, p256dh 65바이트(0x04 비압축 점), auth 16바이트. */
export function validPushSubscription(sub) {
  if (typeof sub?.endpoint !== "string" || sub.endpoint.length > 1024) return false;
  let url;
  try { url = new URL(sub.endpoint); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname))) return false;
  if (b64uLength(sub?.keys?.p256dh, 128) !== 65 || b64uDecode(sub.keys.p256dh.replace(/=+$/, ""))[0] !== 4) return false;
  return b64uLength(sub?.keys?.auth, 32) === 16;
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8,
  );
  return new Uint8Array(bits);
}

function publicKeyToJwk(publicKey) {
  const raw = b64uDecode(publicKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("invalid P-256 public key");
  return {
    kty: "EC", crv: "P-256",
    x: b64uEncode(raw.slice(1, 33)),
    y: b64uEncode(raw.slice(33, 65)),
  };
}

// 설정용 일회성 헬퍼: VAPID 키쌍 생성 — 키를 다시 만들 일이 있으면
//   node -e "import('./_infra/webpush.js').then(m => m.generateVapidKeys()).then(console.log)"
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = b64uEncode(concatBytes(
    Uint8Array.of(4), b64uDecode(jwk.x), b64uDecode(jwk.y),
  ));
  return { publicKey, privateKey: jwk.d };
}

// RFC 8292: 푸시 서비스 origin을 aud로 하는 ES256 JWT
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }) {
  const jwk = { ...publicKeyToJwk(publicKey), d: privateKey, key_ops: ["sign"] };
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const header = b64uEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64uEncode(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })));
  // WebCrypto ECDSA 서명은 r||s 원시 형식이라 그대로 JOSE 서명으로 쓸 수 있다.
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${payload}`),
  ));
  return `vapid t=${header}.${payload}.${b64uEncode(signature)}, k=${publicKey}`;
}

// RFC 8291: 구독의 p256dh/auth 키로 페이로드를 aes128gcm 암호화
export async function encryptPushPayload(payload, { p256dh, auth }) {
  const uaPublicRaw = b64uDecode(p256dh);
  const authSecret = b64uDecode(auth);
  const uaPublicKey = await crypto.subtle.importKey(
    "raw", uaPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const asPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asPair.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPublicKey }, asPair.privateKey, 256,
  ));

  const keyInfo = concatBytes(encoder.encode("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const plaintext = typeof payload === "string" ? encoder.encode(payload) : payload;
  const record = concatBytes(plaintext, Uint8Array.of(2)); // 마지막 레코드 구분자
  const gcmKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, gcmKey, record,
  ));

  // aes128gcm 헤더: salt(16) || record size(4) || keyid 길이(1) || 발신자 공개키(65)
  const headerBlock = new Uint8Array(16 + 4 + 1 + 65);
  headerBlock.set(salt, 0);
  new DataView(headerBlock.buffer).setUint32(16, 4096);
  headerBlock[20] = 65;
  headerBlock.set(asPublicRaw, 21);
  return concatBytes(headerBlock, ciphertext);
}

// 발송. 반환의 gone=true는 구독이 만료(404/410)되어 지워야 한다는 뜻.
// urgency "high" 는 사람이 기다리는 알림(채팅)용이다 — "normal" 이면 안드로이드는 절전
// (Doze) 중 몇 시간씩 미루고 애플도 전원 상태에 맞춰 늦게·뭉쳐 보낸다.
export async function sendWebPush(subscription, payload, vapid, { ttl = 24 * 60 * 60, urgency = "normal" } = {}) {
  const body = await encryptPushPayload(payload, subscription.keys);
  const authorization = await vapidAuthorization(subscription.endpoint, vapid);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return { ok: response.ok, status: response.status, gone: [404, 410].includes(response.status) };
}
