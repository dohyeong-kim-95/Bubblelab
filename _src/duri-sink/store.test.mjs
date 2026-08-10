import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveKey, createStore, extOfBytes, SALT, ITER } from "./store.mjs";

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
    // 진짜 PNG 매직바이트로 시작하는 가짜 원본 — 확장자는 바이트로 판별된다.
    const img = crypto.getRandomValues(new Uint8Array(2048));
    img.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
    const sha256 = await sha256hex(img);
    const imgEnc = await encBytes(ek, img); // 서버·R2엔 이 암호블롭만 있다
    const at = Date.UTC(2026, 6, 21, 8, 0, 0);
    const meta = await encJson(ek, {
      name: "상대", at, file: "노을.png", type: "image/png", loc: { lat: 37.5, lng: 127.02 },
    });
    const store = createStore({
      dir, key: await deriveKey("사진테스트문구"),
      fetchPhoto: async (r2key) => { assert.match(r2key, /^photo\//); return new Uint8Array(imgEnc.ct); },
    });
    await store.persist({
      seq: 7, kind: "photo", at, r2key: "photo/000000000007-a1b2c3d4e5f6a7b8",
      imgIv: imgEnc.iv, sha256, metaIv: meta.iv, metaCt: meta.ct,
    });

    const rec = JSON.parse(readFileSync(join(dir, "timeline/2026/2026-07/metadata.json"), "utf8")).logs[0];
    assert.equal(rec.type, "photo");
    assert.equal(rec.photo.hashOk, true); // 다운로드·복호화한 원본 해시가 일치
    assert.equal(rec.photo.original, "노을.png"); // 원본 파일명 보존
    assert.match(rec.photo.file, /\.png$/);       // 확장자는 매직바이트로 (예전엔 무조건 .jpg)
    assert.deepEqual(rec.loc, { lat: 37.5, lng: 127.02 }); // 지도를 되살릴 수 있게 위치도 남는다
    const saved = readFileSync(join(dir, "timeline/2026/2026-07/photos", rec.photo.file));
    assert.equal(saved.length, 2048);
    assert.deepEqual(new Uint8Array(saved), img); // 원본 그대로 복원
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("photo extension comes from the bytes, not a guess", async () => {
  const magic = {
    ".png": [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0],
    ".jpg": [0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0],
    ".gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0],
    ".webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
    // 아이폰이 올리는 HEIC — 예전엔 이것도 .jpg 로 저장됐다
    ".heic": [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
    ".avif": [0, 0, 0, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],
  };
  for (const [ext, bytes] of Object.entries(magic)) {
    assert.equal(extOfBytes(new Uint8Array(bytes)), ext, `${ext} 판별`);
  }
  // 정체를 모르면 .jpg 라고 우기지 않는다
  assert.equal(extOfBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), ".bin");
  assert.equal(extOfBytes(new Uint8Array([1, 2])), ".bin"); // 너무 짧아도 안전하게
});

test("sticker/location keep their content, and unpin control frames are not stored", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const pass = "제어항목문구";
    const ek = await encKeyFor(pass);
    const store = createStore({ dir, key: await deriveKey(pass), fetchPhoto: async () => { throw new Error("no photo"); } });
    const at = Date.UTC(2026, 6, 22, 1, 0, 0);
    const put = async (seq, payload) => {
      const f = await encJson(ek, { name: "도경", at, ...payload });
      await store.persist({ seq, kind: "msg", at, iv: f.iv, ct: f.ct });
    };
    await put(1, { sticker: { pack: "couple-cat", n: 3 } });
    await put(2, { here: { lat: 37.4979, lng: 127.0276 } });
    await put(3, { unpin: { seqs: [1, 2] } }); // 지도 핀 삭제 — 대화가 아니다
    await put(4, { text: "잘 자" });

    const logs = JSON.parse(readFileSync(join(dir, "timeline/2026/2026-07/metadata.json"), "utf8")).logs;
    assert.deepEqual(logs.map((l) => l.seq), [1, 2, 4]); // unpin 은 저장되지 않는다
    assert.equal(logs[0].type, "sticker");
    assert.deepEqual(logs[0].sticker, { pack: "couple-cat", n: 3 });
    assert.equal(logs[1].type, "location");
    assert.deepEqual(logs[1].loc, { lat: 37.4979, lng: 127.0276 });

    const md = readFileSync(join(dir, "timeline/2026/2026-07/messages.md"), "utf8");
    assert.match(md, /🧸 이모티콘 couple-cat\/3/); // 예전엔 이름만 있고 빈 줄이었다
    assert.match(md, /📍 위치 37\.4979, 127\.0276/);
    assert.match(md, /잘 자/);
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
