// 서명 토큰 한 곳. admin·work·duri·life 게이트, 싱크 토큰(duri·life), 팟캐스트가
// 모두 같은 모양의 "만료.난수.HMAC" 토큰을 쓴다 — 예전에는 이름만 바꾼 사본이
// 여섯 벌 있었다. 키를 만드는 비밀 문자열은 쓰는 쪽마다 그대로 두므로(바꾸면 기존
// 세션이 전부 끊긴다) 여기서는 문자열을 받아 키로 만들기만 한다.
//
//   issueToken(key, ttl)              → "만료.난수.서명"
//   isValidToken(key, token)          → true/false
//   issueSubjectToken(key, ttl, who)  → "만료.who.난수.서명"  (work 의뢰 ID, 팟캐스트 사용자)
//   tokenSubject(key, token)          → who 또는 null

const encoder = new TextEncoder();
const SIGNATURE = /^[0-9a-f]{64}$/;

const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function signed(key, payload) {
  const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${signature}`;
}

// 마지막 조각이 서명, 나머지가 서명된 payload. 만료가 지났거나 서명이 틀리면 null.
async function verifiedParts(key, token, partCount) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== partCount) return null;
  if (parts.some((part) => !part)) return null;
  const signature = parts[parts.length - 1];
  if (!SIGNATURE.test(signature)) return null;
  const expiry = Number(parts[0]);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
  const payload = parts.slice(0, -1).join(".");
  const signatureBytes = Uint8Array.from(signature.match(/../g), (pair) => parseInt(pair, 16));
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payload));
  return valid ? parts : null;
}

export async function issueToken(key, ttlMs) {
  return signed(key, `${Date.now() + ttlMs}.${crypto.randomUUID()}`);
}

export async function isValidToken(key, token) {
  return (await verifiedParts(key, token, 3)) !== null;
}

export async function issueSubjectToken(key, ttlMs, subject) {
  return signed(key, `${Date.now() + ttlMs}.${subject}.${crypto.randomUUID()}`);
}

export async function tokenSubject(key, token) {
  const parts = await verifiedParts(key, token, 4);
  return parts ? parts[1] : null;
}

/** 비밀번호 비교. 길이·내용과 무관하게 HMAC verify 한 번이라 시간으로 새지 않는다. */
export async function matchesCredential(key, supplied, expected) {
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(expected)));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(String(supplied ?? "")));
}

/** Cookie 헤더 하나의 값. 없으면 undefined. */
export function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
