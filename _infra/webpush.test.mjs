import test from "node:test";
import assert from "node:assert/strict";
import {
  b64uDecode, b64uEncode, encryptPushPayload, generateVapidKeys, vapidAuthorization,
} from "./webpush.js";

test("generates web-push 형식의 VAPID 키쌍", async () => {
  const keys = await generateVapidKeys();
  const publicRaw = b64uDecode(keys.publicKey);
  assert.equal(publicRaw.length, 65);
  assert.equal(publicRaw[0], 4);
  assert.equal(b64uDecode(keys.privateKey).length, 32);
});

test("VAPID Authorization 헤더의 JWT가 공개키로 검증된다", async () => {
  const keys = await generateVapidKeys();
  const header = await vapidAuthorization("https://push.example.com/send/abc", {
    ...keys, subject: "mailto:test@example.com",
  });
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(match);
  assert.equal(match[2], keys.publicKey);

  const [head, payload, signature] = match[1].split(".");
  const decoded = JSON.parse(new TextDecoder().decode(b64uDecode(payload)));
  assert.equal(decoded.aud, "https://push.example.com");
  assert.equal(decoded.sub, "mailto:test@example.com");
  assert.ok(decoded.exp > Date.now() / 1000);

  const publicRaw = b64uDecode(keys.publicKey);
  const verifyKey = await crypto.subtle.importKey(
    "raw", publicRaw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, verifyKey,
    b64uDecode(signature), new TextEncoder().encode(`${head}.${payload}`),
  );
  assert.equal(valid, true);
});

test("aes128gcm 암호문을 수신 측 절차로 복호화하면 원문이 나온다", async () => {
  // 브라우저(UA) 쪽 구독 키를 흉내 낸다
  const uaPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const uaPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", uaPair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const message = JSON.stringify({ title: "테스트", body: "안녕" });

  const body = await encryptPushPayload(message, {
    p256dh: b64uEncode(uaPublicRaw), auth: b64uEncode(authSecret),
  });

  // RFC 8188 헤더 파싱
  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(body[20], 65);
  const asPublicRaw = body.slice(21, 86);
  const ciphertext = body.slice(86);

  // RFC 8291 수신 측 키 유도
  const asPublicKey = await crypto.subtle.importKey(
    "raw", asPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: asPublicKey }, uaPair.privateKey, 256,
  ));
  const encoder = new TextEncoder();
  const hkdf = async (saltBytes, ikm, info, length) => {
    const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: saltBytes, info }, key, length * 8,
    ));
  };
  const keyInfo = new Uint8Array([...encoder.encode("WebPush: info\0"), ...uaPublicRaw, ...asPublicRaw]);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const gcmKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce }, gcmKey, ciphertext,
  ));

  assert.equal(record.at(-1), 2); // 마지막 레코드 구분자
  assert.equal(new TextDecoder().decode(record.slice(0, -1)), message);
});
