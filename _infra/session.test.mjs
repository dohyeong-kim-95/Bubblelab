import test from "node:test";
import assert from "node:assert/strict";
import {
  hmacKey,
  isValidToken,
  issueSubjectToken,
  issueToken,
  matchesCredential,
  readCookie,
  tokenSubject,
} from "./session.js";

// 예전 worker.js·podcast.js 사본이 만들던 방식 그대로 서명한다 — 배포 전에 발급된
// 쿠키·싱크 토큰이 합친 뒤에도 그대로 통과해야 한다(바뀌면 모두 다시 로그인).
async function legacyToken(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${payload}.${hex}`;
}

test("예전 사본이 발급한 토큰을 그대로 받는다", async () => {
  const secret = "pw\0bl-duri-session";
  const key = await hmacKey(secret);
  const future = Date.now() + 60_000;
  assert.equal(await isValidToken(key, await legacyToken(secret, `${future}.nonce-1`)), true);
  assert.equal(await tokenSubject(key, await legacyToken(secret, `${future}.daonfit.nonce-2`)), "daonfit");
  assert.equal(await tokenSubject(key, await legacyToken(secret, `${future}.*.nonce-3`)), "*");
});

test("발급한 토큰은 검증되고, 만료·위조·모양이 틀리면 거절된다", async () => {
  const key = await hmacKey("secret");
  const other = await hmacKey("other");
  const token = await issueToken(key, 60_000);
  assert.equal(await isValidToken(key, token), true);
  assert.equal(await isValidToken(other, token), false);
  assert.equal(await isValidToken(key, await issueToken(key, -1)), false, "만료");
  assert.equal(await isValidToken(key, token.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), false);
  assert.equal(await isValidToken(key, `${token}.extra`), false);
  assert.equal(await isValidToken(key, undefined), false);
  assert.equal(await isValidToken(key, ""), false);
  // 주제 토큰(4조각)은 3조각 자리에 쓸 수 없고, 그 반대도 마찬가지다
  const subject = await issueSubjectToken(key, 60_000, "user-1");
  assert.equal(await tokenSubject(key, subject), "user-1");
  assert.equal(await isValidToken(key, subject), false);
  assert.equal(await tokenSubject(key, token), null);
  assert.equal(await tokenSubject(key, await issueSubjectToken(key, -1, "user-1")), null);
});

test("matchesCredential 과 readCookie", async () => {
  const key = await hmacKey("k");
  assert.equal(await matchesCredential(key, "pw", "pw"), true);
  assert.equal(await matchesCredential(key, "pw2", "pw"), false);
  assert.equal(await matchesCredential(key, undefined, "pw"), false);
  const request = new Request("https://x.test/", { headers: { Cookie: "a=1; bl_pod=x.y=z; b=2" } });
  assert.equal(readCookie(request, "bl_pod"), "x.y=z");
  assert.equal(readCookie(request, "missing"), undefined);
});
