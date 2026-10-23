import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveKey, createStore, extOfBytes, SALT, ITER } from "./store.mjs";
import { createSinkQueue, backfillReply, ACK_DELAY_MS, FAIL_RETRY_MS, GAP_RETRY_MS } from "./queue.mjs";

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

test("calendar: merges by rev, keeps tombstones, and renders a readable view", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const pass = "캘린더문구";
    const ek = await encKeyFor(pass);
    const store = createStore({ dir, key: await deriveKey(pass), fetchPhoto: async () => new Uint8Array() });
    const put = async (id, rev, content) => ({ id, rev, deleted: false, ...(await encJson(ek, content)) });

    await store.persistCalendar([
      await put("evtaaaaaa", 100, { date: "2026-08-15", title: "휴가", owner: "도경", shared: false, start: "09:00", end: "18:00" }),
      await put("evtbbbbbb", 100, { date: "2026-08-20", title: "저녁 약속", shared: true }),
      await put("mk20260811", 100, { date: "2026-08-11", marker: "🌙", kind: "marker" }),
    ]);
    let saved = JSON.parse(readFileSync(join(dir, "calendar/events.json"), "utf8"));
    assert.equal(saved.events.length, 3);

    // 같은 id 는 rev 가 큰 쪽이 이긴다 (웹앱·서버와 같은 LWW 규칙)
    await store.persistCalendar([await put("evtaaaaaa", 90, { date: "2026-08-15", title: "옛 제목" })]);  // 무시
    await store.persistCalendar([await put("evtaaaaaa", 200, { date: "2026-08-16", title: "휴가(수정)", shared: true })]);
    saved = JSON.parse(readFileSync(join(dir, "calendar/events.json"), "utf8"));
    assert.equal(saved.events.find((e) => e.id === "evtaaaaaa").title, "휴가(수정)");

    // 삭제는 툼스톤으로 남는다(내용은 지우되 rev 는 유지)
    await store.persistCalendar([{ id: "evtbbbbbb", rev: 300, deleted: true }]);
    saved = JSON.parse(readFileSync(join(dir, "calendar/events.json"), "utf8"));
    assert.equal(saved.events.find((e) => e.id === "evtbbbbbb").deleted, true);

    const md = readFileSync(join(dir, "calendar/calendar.md"), "utf8");
    assert.match(md, /## 2026-08-16/);
    assert.match(md, /휴가\(수정\)/);
    assert.match(md, /공통/);
    assert.doesNotMatch(md, /저녁 약속/); // 지운 일정은 뷰에 없다
    assert.match(md, /## 표식[\s\S]*2026-08-11 🌙/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("calendar: comments are backed up under their event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const pass = "댓글문구";
    const ek = await encKeyFor(pass);
    const store = createStore({ dir, key: await deriveKey(pass), fetchPhoto: async () => new Uint8Array() });
    const put = async (id, rev, content) => ({ id, rev, deleted: false, ...(await encJson(ek, content)) });
    await store.persistCalendar([
      await put("evtaaaaaa", 100, { date: "2026-08-20", title: "저녁 약속", shared: true }),
      await put("cmt1aaaaaa", 110, { kind: "comment", eventId: "evtaaaaaa", text: "몇 시에 만날까?", author: "도경", at: 110 }),
      await put("cmt2aaaaaa", 120, { kind: "comment", eventId: "evtaaaaaa", text: "7시!", author: "상대", at: 120 }),
    ]);
    const md = readFileSync(join(dir, "calendar/calendar.md"), "utf8");
    assert.match(md, /- \(종일\) \*\*저녁 약속\*\*/);
    // 댓글은 일정 바로 아래에 시간순으로
    assert.match(md, /저녁 약속[\s\S]*💬 도경: 몇 시에 만날까\?[\s\S]*💬 상대: 7시!/);
    // 댓글 자체가 일정처럼 별도 항목으로 새어 나오지 않는다
    assert.equal((md.match(/^- \(/gm) || []).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("calendar: an empty cal-state (room reset) must not wipe the backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const pass = "초기화문구";
    const ek = await encKeyFor(pass);
    const store = createStore({ dir, key: await deriveKey(pass), fetchPhoto: async () => new Uint8Array() });
    const frame = await encJson(ek, { date: "2026-08-15", title: "소중한 일정", shared: true });
    await store.persistCalendar([{ id: "evtaaaaaa", rev: 100, deleted: false, ...frame }]);

    // 방초기화 뒤 재접속 → 서버는 아무것도 없다고 말한다. 여기가 백업의 존재 이유다.
    await store.persistCalendar([]);

    const saved = JSON.parse(readFileSync(join(dir, "calendar/events.json"), "utf8"));
    assert.equal(saved.events.length, 1);
    assert.equal(saved.events[0].title, "소중한 일정");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("quarantine keeps the raw blob so one bad entry can't block the rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "duri-"));
  try {
    const otherKey = await encKeyFor("옛날문구");           // 지금 문구로는 안 풀리는 항목
    const store = createStore({
      dir, key: await deriveKey("지금문구"),
      fetchPhoto: async () => new Uint8Array([9, 9, 9, 9]), // 암호화된 사진 블롭
    });
    const at = Date.UTC(2026, 6, 25, 1, 52, 0);
    const frame = await encJson(otherKey, { name: "도경", text: "안 풀리는 옛 메시지", at });
    await assert.rejects(store.persist({ seq: 140, kind: "msg", at, iv: frame.iv, ct: frame.ct }));

    // 못 읽어도 원본은 남긴다 — 나중에 옛 문구를 알면 여기서 풀 수 있다.
    const saved = await store.quarantine({ seq: 140, kind: "msg", at, iv: frame.iv, ct: frame.ct });
    const rec = JSON.parse(readFileSync(join(dir, "undecryptable", saved), "utf8"));
    assert.equal(rec.seq, 140);
    assert.equal(rec.ct, frame.ct); // 암호문 그대로

    // 사진은 서버에서 사라지면 끝이라 블롭까지 받아 둔다
    const photoSaved = await store.quarantine({
      seq: 141, kind: "photo", at, r2key: "photo/000000000141-aaaabbbbccccdddd",
      imgIv: "aXY=", metaIv: "aXY=", metaCt: "zzz",
    });
    const photoRec = JSON.parse(readFileSync(join(dir, "undecryptable", photoSaved), "utf8"));
    assert.equal(photoRec.encryptedImage, "000000000141.img.enc");
    assert.deepEqual(
      new Uint8Array(readFileSync(join(dir, "undecryptable", "000000000141.img.enc"))),
      new Uint8Array([9, 9, 9, 9]),
    );
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

// ── 순서 큐(queue.mjs) ─────────────────────────────────────────
// 같은 파일에 두는 이유: deploy-scope 가 _src/duri-sink 의 테스트를 파일 이름으로
// 분류하는데, 새 파일은 분류표에 없어서 배포 전체를 full 로 올린다.

// 소켓·디스크·타이머를 가짜로 바꾼 큐. timers 에 쌓인 콜백은 runTimers 로 직접 돌린다.
function fakeSink(options = {}) {
  const saved = [];
  const acks = [];
  const timers = [];
  const cursorWrites = [];
  const persist = options.persist || (async (entry) => { saved.push(entry.seq); });
  const sink = createSinkQueue({
    cursor: options.cursor || 0,
    persist,
    quarantine: async (entry) => `${entry.seq}.json`,
    writeCursor: (seq) => cursorWrites.push(seq),
    sendAck: (seq) => acks.push(seq),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    log: () => {},
    stop: (message) => { throw new Error(message); },
  });
  async function runTimers() {
    const due = timers.splice(0, timers.length);
    for (const timer of due) await timer.fn();
  }
  return { sink, saved, acks, timers, cursorWrites, runTimers };
}

const entry = (seq) => ({ seq, kind: "msg" });

test("queue: 백필이 more=true 로 잘려 오면 앞 구간을 다 받기 전까지 쓰지도 ack 하지도 않는다", async () => {
  const { sink, saved, acks, runTimers } = fakeSink();
  sink.startBackfill();
  // 서버는 150건 중 최근 100건(51~150)만 먼저 보내고 more=true 를 붙인다.
  for (let seq = 51; seq <= 150; seq += 1) await sink.enqueue(entry(seq));
  const reply = backfillReply({ type: "backfill-done", more: true, oldest: 51 });
  assert.deepEqual(reply, { type: "fetch-older", before: 51 });
  assert.deepEqual(saved, []);
  await runTimers(); // 빈 번호 대기 재시도가 돌아도 건너뛰지 않는다
  assert.deepEqual(saved, []);
  assert.deepEqual(acks, []);

  for (let seq = 1; seq <= 50; seq += 1) await sink.enqueue(entry(seq));
  assert.equal(backfillReply({ type: "older-done", more: false }), null);
  await sink.finishBackfill();
  assert.equal(saved.length, 150);
  assert.equal(saved[0], 1);
  await runTimers();
  assert.deepEqual(acks, [150]);
});

test("queue: 백필이 끝난 뒤의 빈 번호는 서버에 없는 항목이라 건너뛴다", async () => {
  const { sink, saved, cursorWrites } = fakeSink({ cursor: 10 });
  sink.startBackfill();
  await sink.enqueue(entry(14));
  assert.deepEqual(saved, []);
  await sink.finishBackfill();
  assert.deepEqual(saved, [14]);
  assert.deepEqual(cursorWrites, [13, 14]);
  assert.equal(sink.cursor(), 14);
});

test("queue: 백필 전 빈 번호는 기다리고 재시도를 예약한다", async () => {
  const { sink, timers } = fakeSink();
  sink.startBackfill();
  await sink.enqueue(entry(3));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, GAP_RETRY_MS);
});

test("queue: 보존 실패하면 커서를 멈추고 새 항목이 없어도 스스로 다시 시도한다", async () => {
  let failures = 1;
  const saved = [];
  const { sink, acks, timers, runTimers } = fakeSink({
    persist: async (item) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("photo HTTP 503");
      }
      saved.push(item.seq);
    },
  });
  await sink.finishBackfill();
  await sink.enqueue(entry(1));
  assert.deepEqual(saved, []);
  assert.equal(sink.cursor(), 0);
  const retry = timers.find((timer) => timer.ms === FAIL_RETRY_MS);
  assert.ok(retry, "실패 경로에도 재시도 타이머가 있어야 한다");
  await runTimers();
  assert.deepEqual(saved, [1]);
  await runTimers();
  assert.deepEqual(acks, [1]);
});

test("queue: ack 는 몰아서 한 번, 마지막으로 쓴 커서로 보낸다", async () => {
  const { sink, acks, timers, runTimers } = fakeSink();
  await sink.finishBackfill();
  for (let seq = 1; seq <= 5; seq += 1) await sink.enqueue(entry(seq));
  const ackTimers = timers.filter((timer) => timer.ms === ACK_DELAY_MS);
  assert.equal(ackTimers.length, 1);
  await runTimers();
  assert.deepEqual(acks, [5]);
});

test("queue: 이미 보존한 번호는 다시 쓰지 않는다", async () => {
  const { sink, saved } = fakeSink({ cursor: 5 });
  await sink.finishBackfill();
  await sink.enqueue(entry(4));
  await sink.enqueue(entry(6));
  await sink.enqueue(entry(6));
  assert.deepEqual(saved, [6]);
});

test("queue: 복호화 실패는 격리하고 넘어가되 연속 10건이면 멈춘다", async () => {
  const decryptError = Object.assign(new Error("bad"), { name: "OperationError" });
  const { sink } = fakeSink({ persist: async () => { throw decryptError; } });
  await sink.finishBackfill();
  for (let seq = 1; seq <= 9; seq += 1) await sink.enqueue(entry(seq));
  assert.equal(sink.cursor(), 9);
  await assert.rejects(sink.enqueue(entry(10)), /연속 10건/);
});
