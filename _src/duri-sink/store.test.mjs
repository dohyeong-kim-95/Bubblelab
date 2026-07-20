import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveKey, createStore, SALT, ITER } from "./store.mjs";

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");
const sha256hex = async (bytes) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");

// 웹앱과 동일한 방식으로 암호화하는 헬퍼(암호화 키 usage 만 다름).
async function encKeyFor(pass) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: SALT, iterations: ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
}
async function encBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: b64(iv), ct };
}
async function encJson(key, obj) {
  const { iv, ct } = await encBytes(key, enc.encode(JSON.stringify(obj)));
  return { iv, ct: b64(ct) };
}

test("persists a message entry to metadata.json and messages.md", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const ek = await encKeyFor("우리만아는긴문장");
    const store = createStore({ dir, key: await deriveKey("우리만아는긴문장"), fetchPhoto: async () => { throw new Error("no photo"); } });
    const at = Date.UTC(2026, 6, 20, 5, 45, 0); // 2026-07-20T05:45:00Z
    const frame = await encJson(ek, { name: "도경", text: "오늘 저녁 뭐 먹을까? 🍕", at });
    await store.persist({ seq: 1, kind: "msg", at, iv: frame.iv, ct: frame.ct });

    const meta = JSON.parse(readFileSync(join(dir, "timeline/2026/2026-07/metadata.json"), "utf8"));
    assert.equal(meta.logs.length, 1);
    assert.deepEqual(
      { type: meta.logs[0].type, name: meta.logs[0].name, text: meta.logs[0].text },
      { type: "message", name: "도경", text: "오늘 저녁 뭐 먹을까? 🍕" },
    );
    const md = readFileSync(join(dir, "timeline/2026/2026-07/messages.md"), "utf8");
    assert.match(md, /## 2026-07-20/);
    assert.match(md, /\*\*도경\*\* \(05:45\)/);

    // 같은 seq 재전송은 멱등 — 중복 기록 없음
    await store.persist({ seq: 1, kind: "msg", at, iv: frame.iv, ct: frame.ct });
    const meta2 = JSON.parse(readFileSync(join(dir, "timeline/2026/2026-07/metadata.json"), "utf8"));
    assert.equal(meta2.logs.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("persists a photo entry: decrypts original bytes and records a verified hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const ek = await encKeyFor("사진테스트문구");
    const img = crypto.getRandomValues(new Uint8Array(2048)); // 가짜 원본 이미지
    const sha256 = await sha256hex(img);
    const imgEnc = await encBytes(ek, img); // 서버·R2엔 이 암호블롭만 있다
    const meta = await encJson(ek, { name: "상대", caption: "노을.png", at: Date.UTC(2026, 6, 21, 8, 0, 0) });
    const store = createStore({
      dir, key: await deriveKey("사진테스트문구"),
      fetchPhoto: async (r2key) => { assert.match(r2key, /^photo\//); return new Uint8Array(imgEnc.ct); },
    });
    const at = Date.UTC(2026, 6, 21, 8, 0, 0);
    await store.persist({
      seq: 7, kind: "photo", at, r2key: "photo/000000000007-a1b2c3d4e5f6a7b8",
      imgIv: imgEnc.iv, sha256, metaIv: meta.iv, metaCt: meta.ct,
    });

    const rec = JSON.parse(readFileSync(join(dir, "timeline/2026/2026-07/metadata.json"), "utf8")).logs[0];
    assert.equal(rec.type, "photo");
    assert.equal(rec.photo.hashOk, true); // 다운로드·복호화한 원본 해시가 일치
    assert.equal(rec.photo.caption, "노을.png");
    const saved = readFileSync(join(dir, "timeline/2026/2026-07/photos", rec.photo.file));
    assert.equal(saved.length, 2048);
    assert.deepEqual(new Uint8Array(saved), img); // 원본 그대로 복원
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("wrong passphrase throws (so the daemon can halt instead of acking away data)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const ek = await encKeyFor("올바른문구");
    const at = Date.now();
    const frame = await encJson(ek, { name: "x", text: "secret", at });
    const store = createStore({ dir, key: await deriveKey("틀린문구"), fetchPhoto: async () => new Uint8Array() });
    await assert.rejects(store.persist({ seq: 1, kind: "msg", at, iv: frame.iv, ct: frame.ct }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
