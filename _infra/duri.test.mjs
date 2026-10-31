import test from "node:test";
import assert from "node:assert/strict";
import {
  DuriDO,
  DURI_MAX_TEXT_BLOB,
  DURI_MAX_META_BLOB,
  isBlob,
  validateMsgFrame,
  validatePhotoMeta,
  isPhotoKey,
  isLendKey,
  DURI_LEND_TTL_MS,
  parseAlbumHeader,
  validateRemindSet,
  kstYmd,
} from "./duri.js";
import { b64uEncode, generateVapidKeys } from "./webpush.js";

// 복호화 가능한(유효한 P-256) 구독 키를 생성한다(fortune.test.mjs 와 동일 패턴).
async function fakeSubscription(endpoint) {
  const uaPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const p256dh = b64uEncode(new Uint8Array(await crypto.subtle.exportKey("raw", uaPair.publicKey)));
  const auth = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { endpoint, keys: { p256dh, auth } };
}
const pushReq = (method, body, role = "peer") => new Request("https://x/_duri/push", {
  method, headers: { "Content-Type": "application/json", "X-Duri-Role": role }, body: JSON.stringify(body),
});

// storage.list 가 CF처럼 Map 을 돌려주는 최소 가짜 스토리지.
function fakeStorage(initial) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async get(k) { return map.get(k); },
    async put(k, v) { map.set(k, v); },
    async delete(keys) { for (const k of [].concat(keys)) map.delete(k); },
    async list({ prefix, start, end, limit, reverse } = {}) {
      let ks = [...map.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort();
      if (start) ks = ks.filter((k) => k >= start);
      if (end) ks = ks.filter((k) => k < end);
      if (reverse) ks.reverse();
      if (limit != null) ks = ks.slice(0, limit);
      return new Map(ks.map((k) => [k, map.get(k)]));
    },
  };
}
function fakeBucket(keys) {
  const set = new Set(keys);
  return {
    set,
    async delete(k) { for (const key of [].concat(k)) set.delete(key); },
    async list({ prefix } = {}) {
      return {
        objects: [...set].filter((key) => !prefix || key.startsWith(prefix)).map((key) => ({ key })),
        truncated: false,
      };
    },
  };
}

test("isBlob accepts base64 within the length limit only", () => {
  assert.equal(isBlob("YWJjZA==", 32), true);
  assert.equal(isBlob("", 32), false);
  assert.equal(isBlob("not base64!", 32), false);
  assert.equal(isBlob("YWJj".repeat(20), 8), false); // 길이 초과
  assert.equal(isBlob(42, 32), false);
  assert.equal(isBlob(null, 32), false);
});

test("validateMsgFrame passes opaque iv/ct and rejects malformed frames", () => {
  const ok = validateMsgFrame({ type: "msg", iv: "YWJjZGVmZ2hpamts", ct: "c29tZWNpcGhlcg==" });
  assert.deepEqual(ok, { iv: "YWJjZGVmZ2hpamts", ct: "c29tZWNpcGhlcg==" });
  assert.throws(() => validateMsgFrame({ iv: "###", ct: "c29tZQ==" }), /invalid iv/);
  assert.throws(() => validateMsgFrame({ iv: "YWJj", ct: "###" }), /invalid ct/);
  assert.throws(() => validateMsgFrame({ iv: "YWJj", ct: "A".repeat(DURI_MAX_TEXT_BLOB + 1) }), /invalid ct/);
  assert.throws(() => validateMsgFrame(null), /invalid message/);
});

test("validatePhotoMeta requires a 64-hex sha256 and base64 blobs", () => {
  const sha = "a".repeat(64);
  const meta = validatePhotoMeta({ imgIv: "YWJjZA==", sha256: sha, metaIv: "ZWZnaA==", metaCt: "aWpr" });
  assert.deepEqual(meta, { imgIv: "YWJjZA==", sha256: sha, metaIv: "ZWZnaA==", metaCt: "aWpr" });
  assert.equal(validatePhotoMeta({ imgIv: "YWJjZA==", sha256: "xyz", metaIv: "ZWZnaA==", metaCt: "aWpr" }), null);
  assert.equal(validatePhotoMeta({ imgIv: "###", sha256: sha, metaIv: "ZWZnaA==", metaCt: "aWpr" }), null);
  assert.equal(validatePhotoMeta({ imgIv: "YWJjZA==", sha256: sha, metaIv: "ZWZnaA==", metaCt: "A".repeat(DURI_MAX_META_BLOB + 1) }), null);
});

test("isPhotoKey accepts only server-minted keys", () => {
  assert.equal(isPhotoKey("photo/000000000012-a1b2c3d4e5f6a7b8"), true);
  assert.equal(isPhotoKey("photo/12-abcd1234"), false); // seq 자리수 부족
  assert.equal(isPhotoKey("photo/000000000012-short"), false); // rand 길이 부족
  assert.equal(isPhotoKey("../secret"), false);
  assert.equal(isPhotoKey("photo/000000000012-abcd1234/extra"), false);
  assert.equal(isPhotoKey(42), false);
});

test("parseAlbumHeader accepts id.i.n within bounds only", () => {
  assert.deepEqual(parseAlbumHeader("ab12cd34.1.3"), { id: "ab12cd34", i: 1, n: 3 });
  assert.deepEqual(parseAlbumHeader("ABCdef.2.2"), { id: "ABCdef", i: 2, n: 2 });
  assert.equal(parseAlbumHeader("ab12cd34.1.1"), null); // n<2 는 앨범 아님(단일)
  assert.equal(parseAlbumHeader("ab12cd34.4.3"), null); // i>n
  assert.equal(parseAlbumHeader("ab12cd34.1.99"), null); // n>30
  assert.equal(parseAlbumHeader("short.1.2"), null); // id 길이 부족(<6)
  assert.equal(parseAlbumHeader("bad!.1.2"), null); // 잘못된 문자
  assert.equal(parseAlbumHeader(null), null);
});

test("calendar put/del use last-write-wins and reset clears them", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const sent = [];
  const conn = { ws: { send: (s) => sent.push(JSON.parse(s)) }, role: "peer", stamps: [], alive: true };

  await room.calPut(null, "evt123abc", "aXY=", "Y2lwaGVy", 100);
  assert.deepEqual(storage.map.get("cal:evt123abc"), { id: "evt123abc", iv: "aXY=", ct: "Y2lwaGVy", rev: 100, deleted: false });
  await room.calPut(null, "evt123abc", "b2xk", "b2xk", 50);   // 오래된 rev → 무시
  assert.equal(storage.map.get("cal:evt123abc").iv, "aXY=");
  await room.calPut(null, "evt123abc", "bmV3", "bmV3", 200);  // 새 rev → 반영
  assert.equal(storage.map.get("cal:evt123abc").ct, "bmV3");
  await room.calDel(null, "evt123abc", 300);                  // 삭제 → 툼스톤
  const tomb = storage.map.get("cal:evt123abc");
  assert.equal(tomb.id, "evt123abc");
  assert.equal(tomb.rev, 300);
  assert.equal(tomb.deleted, true);
  assert.equal(typeof tomb.at, "number"); // 삭제 시각은 서버가 찍는다(정리 기준)

  await room.sendCalState(conn);
  const st = sent.find((m) => m.type === "cal-state");
  assert.ok(st && st.events.length === 1 && st.events[0].deleted === true);

  await room.handleReset();
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith("cal:")).length, 0);
});

test("handleReset wipes the buffer and R2 photos but keeps seq monotonic", async () => {
  const photoKey = "photo/000000000002-a1b2c3d4e5f6a7b8";
  const storage = fakeStorage({
    seq: 3,
    ackSeq: 1,
    "buf:000000000001": { seq: 1, kind: "msg", iv: "aa", ct: "bb" },
    "buf:000000000002": { seq: 2, kind: "photo", r2key: photoKey },
    "buf:000000000003": { seq: 3, kind: "msg", iv: "cc", ct: "dd" },
  });
  // 참조 사진 + 버퍼엔 없지만 R2엔 남은 고아 사진.
  const bucket = fakeBucket([photoKey, "photo/000000000009-deadbeefdeadbeef"]);
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: bucket });

  const res = await room.fetch(
    new Request("https://x/_duri/reset", { method: "POST", headers: { "X-Duri-Role": "peer" } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  // 버퍼 항목 전부 삭제
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith("buf:")).length, 0);
  // seq 는 유지, ackSeq 는 head 로 상승("전부 소비됨")
  assert.equal(storage.map.get("seq"), 3);
  assert.equal(storage.map.get("ackSeq"), 3);
  // 참조·고아 사진 모두 R2에서 삭제
  assert.equal(bucket.set.size, 0);
});

// 화면의 "접속중"은 사람을 뜻한다. 싱크 데몬도 같은 WebSocket 으로 붙기 때문에
// 전체 연결 수를 세면, 싱크를 켠 순간부터 상대가 없어도 늘 접속중으로 보인다.
// 싱크(PC 백업)가 받아 갔다는 것과 두 사람이 다 봤다는 것은 다른 얘기다. 예전엔
// 싱크 ack 하나로 버퍼·R2 를 비워서, 그 순간 앱을 안 열어 둔 쪽은 사진을 영영 받지
// 못했다(알림만 오고 화면엔 안 뜸).
test("sink ack must not discard entries a peer has not seen yet", async () => {
  const photoKey = "photo/000000000003-a1b2c3d4e5f6a7b8";
  const storage = fakeStorage({
    seq: 3, ackSeq: 0,
    "buf:000000000001": { seq: 1, kind: "msg", iv: "aa", ct: "bb" },
    "buf:000000000002": { seq: 2, kind: "msg", iv: "cc", ct: "dd" },
    "buf:000000000003": { seq: 3, kind: "photo", r2key: photoKey },
  });
  const bucket = fakeBucket([photoKey]);
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: bucket });
  await room.load();

  // 상대 기기는 1번까지만 봤다. 싱크는 3번까지 다 받아 ack 한다.
  await storage.put("peer:devicebbbbbb", { seq: 1, at: Date.now() });
  await room.prune(3);

  const left = [...storage.map.keys()].filter((k) => k.startsWith("buf:"));
  assert.deepEqual(left, ["buf:000000000002", "buf:000000000003"]); // 못 본 건 남는다
  assert.equal(bucket.set.has(photoKey), true);                     // 사진도 R2에 남아 있어야
  assert.equal(storage.map.get("ackSeq"), 1);

  // 그 기기가 3번까지 보고 나면 그때 비워진다.
  await storage.put("peer:devicebbbbbb", { seq: 3, at: Date.now() });
  await room.prune(3);
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith("buf:")).length, 0);
  assert.equal(bucket.set.size, 0);
});

test("a device that stopped checking in is not waited for forever", async () => {
  const storage = fakeStorage({
    seq: 2, ackSeq: 0,
    "buf:000000000001": { seq: 1, kind: "msg", iv: "aa", ct: "bb" },
    "buf:000000000002": { seq: 2, kind: "msg", iv: "cc", ct: "dd" },
  });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  // 40일째 소식이 없는 기기 — 이것까지 기다리면 버퍼가 무한히 쌓인다
  await storage.put("peer:deviceoldddd", { seq: 0, at: Date.now() - 40 * 24 * 60 * 60 * 1000 });
  await room.prune(2);
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith("buf:")).length, 0);
});

test("presence counts people only — the sink daemon must not look like the partner", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const mk = (role) => ({ ws: { send() {} }, role, stamps: [], alive: true });

  const me = mk("peer");
  room.conns.add(me);
  assert.equal(room.peerCount(), 1);
  assert.deepEqual(room.presence(), { online: 1, sink: false }); // PC 꺼짐 → 앱이 "당이가 자고 있어요"

  room.conns.add(mk("sink")); // 데스크톱 백업이 붙어도
  assert.equal(room.peerCount(), 1); // 여전히 사람은 나 혼자다
  assert.equal(room.conns.size, 2);
  assert.deepEqual(room.presence(), { online: 1, sink: true }); // 대신 당이가 깨어 있다고 알린다

  room.conns.add(mk("peer")); // 상대가 실제로 들어오면
  assert.equal(room.peerCount(), 2); // 그때 비로소 2명
});

test("calendar cap counts live events only, and rejects loudly when full", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const sent = [];
  const conn = { ws: { send: (s) => sent.push(JSON.parse(s)) }, role: "peer", stamps: [], alive: true };

  // 만들고 지우기를 반복하면 툼스톤만 쌓인다 — 예전엔 이것만으로 한도가 찼다.
  for (let i = 0; i < 50; i++) {
    const id = `evt${String(i).padStart(6, "0")}`;
    await room.calPut(conn, id, "aXY=", "Y2lwaGVy", 100 + i);
    await room.calDel(conn, id, 200 + i);
  }
  assert.equal((await storage.list({ prefix: "cal:" })).size, 50); // 전부 툼스톤
  sent.length = 0;
  await room.calPut(conn, "evtliveaaa", "aXY=", "Y2lwaGVy", 9000); // 살아 있는 건 0개 → 받아들여야 한다
  assert.equal((await storage.get("cal:evtliveaaa")).deleted, false);
  assert.ok(!sent.some((m) => m.type === "cal-reject"));
});

test("calendar sweeps tombstones older than the TTL, keeping recent ones", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const DAY = 24 * 60 * 60 * 1000;
  await storage.put("cal:oldtombaaa", { id: "oldtombaaa", rev: 1, deleted: true, at: Date.now() - 120 * DAY });
  await storage.put("cal:newtombaaa", { id: "newtombaaa", rev: 2, deleted: true, at: Date.now() - 3 * DAY });
  // 삭제 시각이 없는 옛 툼스톤 — 나이를 모르니 지우지 말고 지금 시각을 찍어 둔다
  await storage.put("cal:notimeaaaa", { id: "notimeaaaa", rev: 3, deleted: true });
  // 오래됐어도 살아 있는 일정은 절대 건드리지 않는다
  await storage.put("cal:oldliveaaa", { id: "oldliveaaa", rev: Date.now() - 300 * DAY, deleted: false, iv: "aXY=", ct: "Y2lwaGVy" });

  const swept = await room.sweepCalTombstones();
  assert.equal(swept, 1);
  assert.equal(await storage.get("cal:oldtombaaa"), undefined); // 오래된 툼스톤만 사라짐
  assert.ok(await storage.get("cal:newtombaaa"));
  assert.ok(await storage.get("cal:oldliveaaa"));
  assert.equal(typeof (await storage.get("cal:notimeaaaa")).at, "number"); // 나이를 모르면 지우지 않고 찍어만 둔다
});

test("push subscribe/unsubscribe is peer-only, dedupes by endpoint, and caps subscriber count", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const sub = await fakeSubscription("https://push.example.com/a");

  const sinkRejected = await room.fetch(pushReq("POST", { subscription: sub }, "sink"));
  assert.equal(sinkRejected.status, 403); // 싱크(데스크톱 데몬)는 알림을 구독할 수 없다

  const ok = await room.fetch(pushReq("POST", { subscription: sub }));
  assert.equal(ok.status, 200);
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);

  await room.fetch(pushReq("POST", { subscription: sub })); // 같은 endpoint 재구독은 중복 안 만듦
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);

  const bad = await room.fetch(pushReq("POST", { subscription: { endpoint: "http://insecure", keys: {} } }));
  assert.equal(bad.status, 400);

  // 이미 1개(sub) 있으니 7개를 더 채우면 상한(8)에 정확히 닿는다.
  for (let i = 0; i < 7; i++) {
    await room.fetch(pushReq("POST", { subscription: await fakeSubscription(`https://push.example.com/extra${i}`) }));
  }
  assert.equal((await storage.list({ prefix: "push:" })).size, 8);
  // 상한을 넘으면 거절하지 않고 가장 오래된 구독을 밀어낸다. 방금 알림을 켠 기기가
  // 좀비 구독 때문에 등록에 실패해 조용히 알림이 끊기는 쪽이 훨씬 나쁘다.
  const newest = await fakeSubscription("https://push.example.com/one-too-many");
  const full = await room.fetch(pushReq("POST", { subscription: newest }));
  assert.equal(full.status, 200);
  const after = await storage.list({ prefix: "push:" });
  assert.equal(after.size, 8); // 상한은 지키되
  assert.ok([...after.values()].some((v) => v.endpoint === newest.endpoint)); // 새 구독은 반드시 들어간다
  assert.ok(![...after.values()].some((v) => v.endpoint === sub.endpoint)); // 가장 오래된 것이 밀려남

  const gone = await room.fetch(pushReq("DELETE", { endpoint: newest.endpoint }));
  assert.equal(gone.status, 200);
  assert.equal((await storage.list({ prefix: "push:" })).size, 7); // 하나만 해지됨
});

// 배포·SW 갱신 때마다 브라우저가 endpoint 를 회전시키면 옛 구독이 쌓여 슬롯을
// 채우고, 결국 새 구독이 밀려나 알림이 조용히 끊겼다. deviceId 로 같은 기기의
// 옛 구독을 알아보고 치우는지 확인한다.
test("push subscribe replaces the same device's rotated subscription", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();

  const first = await fakeSubscription("https://push.example.com/rot-1");
  await room.fetch(pushReq("POST", { subscription: first, deviceId: "device-aaaaaa" }));
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);

  // 같은 기기가 회전한 새 endpoint 로 다시 등록 → 옛 것은 사라지고 하나만 남는다.
  const rotated = await fakeSubscription("https://push.example.com/rot-2");
  await room.fetch(pushReq("POST", { subscription: rotated, deviceId: "device-aaaaaa" }));
  const subs = await storage.list({ prefix: "push:" });
  assert.equal(subs.size, 1);
  assert.equal([...subs.values()][0].endpoint, rotated.endpoint);

  // 다른 기기는 그대로 공존한다(상대방 기기가 밀려나면 안 된다).
  const other = await fakeSubscription("https://push.example.com/other");
  await room.fetch(pushReq("POST", { subscription: other, deviceId: "device-bbbbbb" }));
  assert.equal((await storage.list({ prefix: "push:" })).size, 2);

  // 형식이 틀린 deviceId 는 없는 셈 친다(회전 정리만 못 할 뿐 구독은 정상 등록).
  const noId = await fakeSubscription("https://push.example.com/no-id");
  const res = await room.fetch(pushReq("POST", { subscription: noId, deviceId: "!!" }));
  assert.equal(res.status, 200);
  assert.equal((await storage.list({ prefix: "push:" })).size, 3);
});

test("push/test self-diagnostic reports no-vapid, targets only my endpoint, and prunes expired", async () => {
  const testReq = (body, role = "peer") => new Request("https://x/_duri/push/test", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Duri-Role": role },
    body: JSON.stringify(body),
  });

  // VAPID 미설정 → no-vapid 로 어디서 막혔는지 알린다.
  {
    const storage = fakeStorage({ seq: 0, ackSeq: 0 });
    const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, { DURI_BUCKET: fakeBucket([]) });
    await room.load();
    const res = await room.fetch(testReq({}));
    assert.deepEqual(await res.json(), { ok: false, reason: "no-vapid" });
  }

  // 싱크(데스크톱 데몬)는 테스트 알림을 쏠 수 없다.
  {
    const storage = fakeStorage({ seq: 0, ackSeq: 0 });
    const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, { DURI_BUCKET: fakeBucket([]) });
    await room.load();
    const rejected = await room.fetch(testReq({}, "sink"));
    assert.equal(rejected.status, 403);
  }

  // VAPID 설정 + 여러 구독 → endpoint 를 준 내 기기 하나에만 발송, 410 은 정리.
  const vapid = await generateVapidKeys();
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, {
    DURI_BUCKET: fakeBucket([]),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://duri.bubblelab.dev",
  });
  await room.load();
  const mine = "https://push.example.com/mine";
  await room.fetch(pushReq("POST", { subscription: await fakeSubscription(mine) }));
  await room.fetch(pushReq("POST", { subscription: await fakeSubscription("https://push.example.com/other") }));

  let hit = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint) => { hit = String(endpoint); return new Response(null, { status: 201 }); };
  try {
    const res = await room.fetch(testReq({ endpoint: mine }));
    const r = await res.json();
    assert.equal(r.ok, true);
    assert.equal(r.subs, 2);      // 두 구독이 있지만
    assert.equal(r.targeted, 1);  // endpoint 를 준 내 기기 하나에만
    assert.equal(r.sent, 1);
    assert.equal(hit, mine);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 🧪 실전 테스트(probe): 응답은 바로, 발송은 delayMs 뒤 — 그사이 앱이 내려가 요청이 끊겨도 간다.
  const hits = [];
  let job = null;
  room.state.waitUntil = (p) => { job = p; };
  globalThis.fetch = async (endpoint) => { hits.push(String(endpoint)); return new Response(null, { status: 201 }); };
  try {
    const r = await (await room.fetch(testReq({ endpoint: mine, nonce: "probe1", probe: true, delayMs: 30 }))).json();
    assert.deepEqual(r, { ok: true, scheduled: true, delayMs: 30 });
    assert.equal(hits.length, 0); // 아직 안 보냄
    await job;
    assert.deepEqual(hits, [mine]);
    // 등록 안 된 기기·최대 지연
    assert.deepEqual(await (await room.fetch(testReq({ endpoint: "https://push.example.com/nope", probe: true }))).json(), { ok: false, reason: "not-registered" });
    const realTimeout = globalThis.setTimeout;
    let waited = null;
    globalThis.setTimeout = (fn, ms) => { waited = ms; return realTimeout(fn, 0); };
    try {
      const capped = await (await room.fetch(testReq({ endpoint: mine, probe: true, delayMs: 999_999 }))).json();
      assert.equal(capped.delayMs, 15_000);
    } finally { globalThis.setTimeout = realTimeout; }
    assert.equal(waited, 15_000);
    await job;
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("appending a msg/photo entry pushes the opaque blob to subscribers and prunes expired ones", async () => {
  const vapid = await generateVapidKeys();
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, {
    DURI_BUCKET: fakeBucket([]),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://duri.bubblelab.dev",
  });
  await room.load();
  await room.fetch(pushReq("POST", { subscription: await fakeSubscription("https://push.example.com/live") }));
  await room.fetch(pushReq("POST", { subscription: await fakeSubscription("https://push.example.com/expired") }));

  // sendWebPush 는 페이로드를 aes128gcm 으로 암호화해 보내므로(웹 표준 자체가
  // 요구하는 암호화 — webpush.test.mjs 가 그 라운드트립을 이미 검증한다), 여기선
  // 발송 횟수·상태 코드에 따른 만료 정리만 확인한다. 실제로 어떤 내용이 담겼는지는
  // buildPushPayload 단위 테스트가 담당한다.
  let sent = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint) => {
    sent += 1;
    return new Response(null, { status: String(endpoint).endsWith("/expired") ? 410 : 201 });
  };
  try {
    await room.append({ kind: "msg", at: Date.now(), iv: "aXY=", ct: "Y2lwaGVy" });
    // notifyPush 는 append 안에서 기다리지 않고 발사되므로(fire-and-forget — 실시간
    // 브로드캐스트를 다음 웹소켓 메시지 처리가 푸시 발송으로 늦어지지 않게), 두
    // 구독 모두에 실제 fetch(발송)가 끝날 때까지 짧게 기다린다.
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(sent, 2);
  // 410(만료) 구독은 정리되고 살아있는 구독만 남는다
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);
});

test("notifyPush still pushes to connected devices (presence is not trusted)", async () => {
  const vapid = await generateVapidKeys();
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, {
    DURI_BUCKET: fakeBucket([]),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://duri.bubblelab.dev",
  });
  await room.load();
  const online = "https://push.example.com/online";
  const away = "https://push.example.com/away";
  await room.fetch(pushReq("POST", { subscription: await fakeSubscription(online) }));
  await room.fetch(pushReq("POST", { subscription: await fakeSubscription(away) }));

  // "online" 기기는 지금 접속 중(웹소켓)이라고 표시 → 그 기기엔 푸시가 가면 안 된다.
  // (append 가 broadcast 하며 conn.ws.send 를 부르므로 no-op ws 를 붙여둔다.)
  room.conns.add({ endpoint: online, ws: { send() {} }, role: "peer", stamps: [], alive: true });

  const hits = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint) => { hits.push(String(endpoint)); return new Response(null, { status: 201 }); };
  try {
    await room.append({ kind: "msg", at: Date.now(), iv: "aXY=", ct: "Y2lwaGVy" });
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    globalThis.fetch = originalFetch;
  }
  // 접속 중이어도 보낸다 — 백그라운드 재접속이 "보는 중"으로 잡혀 푸시가 끊기던 버그.
  // 보고 있는지는 기기의 sw.js 가 판단한다(알림을 띄웠다 바로 닫음).
  assert.deepEqual(hits.sort(), [away, online].sort());
});

test("notifyPush skips every device of the sender (by who), sends high urgency, and records the last result", async () => {
  const vapid = await generateVapidKeys();
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, {
    DURI_BUCKET: fakeBucket([]),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://duri.bubblelab.dev",
  });
  await room.load();
  // 나: 폰(phone-a)·PC(pc-a), 상대: 폰(phone-b). 내 PC 는 지금 접속해 있지 않다.
  const sub = async (name, deviceId) =>
    room.fetch(pushReq("POST", { subscription: await fakeSubscription(`https://push.example.com/${name}`), deviceId }));
  await sub("phone-a", "phone-aaaaaa");
  await sub("pc-a", "pc-aaaaaaaa");
  await sub("phone-b", "phone-bbbbbb");
  const noop = { send() {} };
  for (const [deviceId, who] of [["pc-aaaaaaaa", "aaaaaaaaaaaaaaaa"], ["phone-bbbbbb", "bbbbbbbbbbbbbbbb"]]) {
    const conn = { ws: noop, role: "peer", stamps: [], alive: true };
    room.handle(conn, { type: "hello", since: 0, deviceId, who });
    room.conns.delete?.(conn); // 접속 기록(peer:)만 남기고 지금은 자리 비움
  }
  await new Promise((resolve) => setTimeout(resolve, 10));

  const hits = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint, init) => {
    hits.push([String(endpoint).split("/").pop(), init.headers.Urgency]);
    return new Response(null, { status: 201 });
  };
  try {
    // 내 폰에서 보낸 메시지 — 같은 who 인 내 PC 에도 보내지 않는다(받아 봐야 알림을 안
    // 띄우는 silent push 가 되고, iOS 는 그게 쌓이면 구독을 끊는다).
    await room.append({ kind: "msg", at: Date.now(), iv: "aXY=", ct: "Y2lwaGVy" },
      { deviceId: "phone-aaaaaa", who: "aaaaaaaaaaaaaaaa" });
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(hits, [["phone-b", "high"]]);

  const status = await (await room.fetch(new Request("https://x/_duri/status", { headers: { "X-Duri-Role": "peer" } }))).json();
  assert.equal(status.push.length, 3);
  const b = status.push.find((p) => p.device === "phon" && p.last);
  assert.equal(b.host, "push.example.com");
  assert.equal(b.last.status, 201);
  assert.ok(!JSON.stringify(status.push).includes("/phone-b")); // 주소는 내보내지 않는다
});

test("push/recv records delivery receipts so 'sent but never arrived' is visible", async () => {
  const vapid = await generateVapidKeys();
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, {
    DURI_BUCKET: fakeBucket([]),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  });
  await room.load();
  const endpoint = "https://web.push.apple.com/abc";
  await room.fetch(pushReq("POST", { subscription: await fakeSubscription(endpoint), deviceId: "iphone-aaaa" }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 201 });
  try {
    await room.append({ kind: "msg", at: Date.now(), iv: "aXY=", ct: "Y2lwaGVy" });
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    globalThis.fetch = originalFetch;
  }
  const recvReq = (body, role = "peer") => new Request("https://x/_duri/push/recv", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Duri-Role": role }, body: JSON.stringify(body),
  });
  const status = async () => (await (await room.fetch(new Request("https://x/_duri/status", { headers: { "X-Duri-Role": "peer" } }))).json()).push[0];
  let d = await status();
  assert.equal(d.last.seq, 1);   // 발송은 됐지만
  assert.equal(d.recv, null);    // 도착 확인은 아직 없다 → 화면이 ⚠️ 로 보인다

  assert.equal((await room.fetch(recvReq({ endpoint, seq: 1, shown: true }, "sink"))).status, 403);
  assert.deepEqual(await (await room.fetch(recvReq({ endpoint: "https://web.push.apple.com/unknown", seq: 1 }))).json(), { known: false });
  await room.fetch(recvReq({ endpoint, seq: 1, shown: true }));
  d = await status();
  assert.equal(d.recv.seq, 1);
  assert.equal(d.recv.shown, true);
});

test("push subscriptions survive a redeploy (DO restart) — messages still push to away devices", async () => {
  const vapid = await generateVapidKeys();
  // 재배포 = Worker 재기동 → DO 인스턴스가 새로 만들어지지만 storage(구독)는 영속된다.
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const mkRoom = () => new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, {
    DURI_BUCKET: fakeBucket([]),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://duri.bubblelab.dev",
  });

  const before = mkRoom();
  await before.load();
  await before.fetch(pushReq("POST", { subscription: await fakeSubscription("https://push.example.com/away") }));
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);

  // 재배포: 새 DO 인스턴스(메모리상 conns 비어 있음), 같은 storage 로 load.
  const after = mkRoom();
  await after.load();
  assert.equal((await storage.list({ prefix: "push:" })).size, 1); // 구독은 그대로 남아 있다

  const hits = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint) => { hits.push(String(endpoint)); return new Response(null, { status: 201 }); };
  try {
    await after.append({ kind: "msg", at: Date.now(), iv: "aXY=", ct: "Y2lwaGVy" });
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(hits, ["https://push.example.com/away"]); // 재배포 뒤에도 알림 정상 발송
});

test("deleteEntry removes the buffer entry + R2 원본 and broadcasts deleted to both", async () => {
  const r2key = "photo/000000000001-abcdef0123456789";
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const bucket = fakeBucket([r2key]);
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, { DURI_BUCKET: bucket });
  await room.load();
  const full = await room.append({ kind: "photo", at: Date.now(), r2key, imgIv: "aXY=", sha256: "x", metaIv: "aXY=", metaCt: "bWV0YQ==" });
  assert.equal((await storage.list({ prefix: "buf:" })).size, 1);
  assert.ok(bucket.set.has(r2key));

  const sent = [];
  room.conns.add({ ws: { send: (s) => sent.push(JSON.parse(s)) }, role: "peer", stamps: [], alive: true, endpoint: null });
  await room.deleteEntry(full.seq);

  assert.equal((await storage.list({ prefix: "buf:" })).size, 0);       // 버퍼에서 삭제
  assert.equal(bucket.set.has(r2key), false);                            // R2 원본 삭제
  assert.ok(sent.some((m) => m.type === "deleted" && m.seq === full.seq)); // 양쪽 전파
});

test("buildPushPayload carries the opaque blob for msg/photo but falls back to generic when oversized", () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, {});
  assert.deepEqual(room.buildPushPayload({ kind: "msg", iv: "aXY=", ct: "Y2lwaGVy" }), { kind: "msg", iv: "aXY=", ct: "Y2lwaGVy" });
  assert.deepEqual(room.buildPushPayload({ kind: "photo", metaIv: "aXY=", metaCt: "bWV0YQ==" }), { kind: "photo", metaIv: "aXY=", metaCt: "bWV0YQ==" });
  assert.deepEqual(room.buildPushPayload({ kind: "msg", iv: "aXY=", ct: "A".repeat(4000) }), { kind: "generic" });
});

// ── 아침 일정 리마인드 ───────────────────────────────────────────
const remindDay = (date) => ({ date, iv: "aXY=", ct: "Y2lwaGVy" });

// 당이가 빌려주는 옛 사진: 싱크만 올리고, 채팅 버퍼(seq)엔 안 들어가며, 7일 지나면 410 + 지워진다.
function fakeR2() {
  const map = new Map();
  return {
    map,
    async put(k, body) { map.set(k, new Uint8Array(body)); },
    async get(k) { return map.has(k) ? { body: map.get(k) } : null; },
    async delete(k) { for (const key of [].concat(k)) map.delete(key); },
    async list({ prefix } = {}) { return { objects: [...map.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
  };
}
test("lend: 싱크만 옛 사진을 맡기고, 버퍼·seq 는 그대로, 누구나 받고, 7일 지나면 410 으로 지운다", async () => {
  const storage = fakeStorage({ seq: 5, ackSeq: 5 });
  const bucket = fakeR2();
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, { DURI_BUCKET: bucket });
  const up = (role, body = new Uint8Array([1, 2, 3])) => room.fetch(new Request("https://x/_duri/lend", { method: "POST", headers: { "X-Duri-Role": role }, body }));
  assert.equal((await up("peer")).status, 403);
  assert.equal((await up("sink", new Uint8Array(0))).status, 400);
  const res = await up("sink");
  assert.equal(res.status, 200);
  const { key } = await res.json();
  assert.ok(isLendKey(key), key);
  assert.equal(room.head, 5); // 채팅 항목이 아니다 — 백업·지도·알림에 안 겹친다
  const got = await room.fetch(new Request(`https://x/_duri/${key}`, { headers: { "X-Duri-Role": "peer" } }));
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal((await room.fetch(new Request("https://x/_duri/lend/123-abc", { headers: { "X-Duri-Role": "peer" } }))).status, 400);
  // 기한 지난 것: 받으려 하면 410 + 삭제, 새로 맡길 때도 같이 쓸어 낸다
  const old = `lend/${Date.now() - DURI_LEND_TTL_MS - 1000}-0123456789abcdef`, old2 = `lend/${Date.now() - DURI_LEND_TTL_MS - 5000}-fedcba9876543210`;
  bucket.map.set(old, new Uint8Array([9])); bucket.map.set(old2, new Uint8Array([9]));
  assert.equal((await room.fetch(new Request(`https://x/_duri/${old}`, { headers: { "X-Duri-Role": "peer" } }))).status, 410);
  assert.equal(bucket.map.has(old), false);
  await up("sink");
  assert.equal(bucket.map.has(old2), false);
  assert.equal(bucket.map.has(key), true); // 기한 안의 것은 남는다
  // 방 초기화는 빌린 사진도 지운다
  await room.fetch(new Request("https://x/_duri/reset", { method: "POST", headers: { "X-Duri-Role": "peer" } }));
  assert.equal([...bucket.map.keys()].filter((k) => k.startsWith("lend/")).length, 0);
});

test("kstYmd rolls over at 15:00 UTC (= KST midnight)", () => {
  assert.equal(kstYmd(Date.parse("2026-10-14T14:59:59Z")), "2026-10-14");
  assert.equal(kstYmd(Date.parse("2026-10-14T15:00:00Z")), "2026-10-15");
});

test("validateRemindSet accepts a range inside the window and rejects the rest", () => {
  const today = "2026-10-14";
  const ok = validateRemindSet({ from: "2026-10-14", to: "2026-12-12", days: [remindDay("2026-10-20")] }, today);
  assert.deepEqual(ok, [remindDay("2026-10-20")]);
  assert.deepEqual(validateRemindSet({ from: "2026-10-13", to: "2026-10-13", days: [] }, today), []); // 어제까지는 허용
  const bad = [
    { from: "2026-10-12", to: "2026-10-20", days: [] },                          // 그저께 — 창 밖
    { from: "2026-10-14", to: "2026-12-16", days: [] },                          // 62일 넘게 앞
    { from: "2026-10-20", to: "2026-10-14", days: [] },                          // 뒤집힌 구간
    { from: "2026-10-14", to: "2026-10-20", days: [remindDay("2026-10-21")] },   // 구간 밖 날짜
    { from: "2026-10-14", to: "2026-10-20", days: [remindDay("2026-10-15"), remindDay("2026-10-15")] }, // 중복
    { from: "2026-10-14", to: "2026-10-20", days: [{ date: "2026-10-15", iv: "###", ct: "Y2lw" }] },    // 블롭 아님
    { from: "14-10-2026", to: "2026-10-20", days: [] },
  ];
  for (const msg of bad) assert.throws(() => validateRemindSet(msg, today), undefined, JSON.stringify(msg));
});

test("remind-set replaces its range; fire posts today's once as a normal msg and clears the past", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const sent = [];
  room.conns.add({ ws: { send: (s) => sent.push(JSON.parse(s)) }, role: "peer", stamps: [], alive: true });
  const reminders = () => [...storage.map.keys()].filter((k) => k.startsWith("remind:")).sort();

  await room.setReminders("2026-10-13", "2026-10-20",
    [remindDay("2026-10-13"), remindDay("2026-10-14"), remindDay("2026-10-16"), remindDay("2026-10-18")]);
  await room.setReminders("2026-10-21", "2026-10-30", [remindDay("2026-10-25")]);
  // 같은 구간을 다시 맡기면 빠진 날짜(16일)는 지워지고, 구간 밖(25일)은 그대로다.
  await room.setReminders("2026-10-13", "2026-10-20",
    [remindDay("2026-10-13"), remindDay("2026-10-14"), remindDay("2026-10-18")]);
  assert.deepEqual(reminders(), ["remind:2026-10-13", "remind:2026-10-14", "remind:2026-10-18", "remind:2026-10-25"]);

  const first = await room.fireReminder("2026-10-14");
  assert.equal(first.posted, true);
  assert.deepEqual(reminders(), ["remind:2026-10-18", "remind:2026-10-25"], "오늘까지의 몫은 지운다");
  const entry = storage.map.get("buf:000000000001");
  assert.equal(entry.kind, "msg");
  assert.equal(entry.ct, "Y2lwaGVy");
  assert.ok(sent.some((m) => m.type === "entry" && m.seq === 1), "접속자에게 바로 전달");

  // cron 이 두 번 돌아도 두 번 올리지 않는다.
  assert.equal((await room.fireReminder("2026-10-14")).posted, false);
  assert.equal(room.head, 1);
  // 맡긴 게 없는 날은 아무것도 올리지 않는다.
  assert.equal((await room.fireReminder("2026-10-15")).posted, false);

  await room.handleReset();
  assert.deepEqual(reminders(), [], "방 초기화는 리마인드도 지운다");
});

test("brief-done: 당이가 오늘 브리핑했다고 알리면(싱크만, 오늘만) 08:10 리마인드는 올리지 않는다", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const today = kstYmd();
  await room.setReminders(today, today, [remindDay(today)]);
  const peer = { ws: { send() {} }, role: "peer", stamps: [], alive: true };
  const sink = { ws: { send() {} }, role: "sink", stamps: [], alive: true };
  room.handle(peer, { type: "brief-done", date: today });
  room.handle(sink, { type: "brief-done", date: "2000-01-01" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(storage.map.has("briefDone"), false, "브라우저·다른 날짜는 무시");
  room.handle(sink, { type: "brief-done", date: today });
  await new Promise((r) => setTimeout(r, 0));
  const r = await room.fireReminder(today);
  assert.equal(r.posted, false);
  assert.equal(r.briefed, true);
  assert.equal(room.head, 0, "채팅에 올리지 않았다");
  assert.equal(storage.map.has("remind:" + today), false, "그날 몫은 치운다");

  // 다음 날 당이가 못 하면(PC 꺼짐) 리마인드가 fallback 으로 올라간다.
  const tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 86400_000).toISOString().slice(0, 10);
  storage.map.set("remind:" + tomorrow, { iv: remindDay(tomorrow).iv, ct: remindDay(tomorrow).ct });
  assert.equal((await room.fireReminder(tomorrow)).posted, true);
});

test("remind/fire is reachable only with the cron role; remind-set only from a browser", async () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, { DURI_BUCKET: fakeBucket([]) });
  const fire = (role) => room.fetch(new Request("https://x/remind/fire", { method: "POST", headers: { "X-Duri-Role": role } }));
  assert.equal((await fire("peer")).status, 403);
  assert.equal((await fire("sink")).status, 403);
  const ok = await fire("cron");
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).posted, false);

  const today = kstYmd();
  const sinkConn = { ws: { send() {} }, role: "sink", stamps: [], alive: true };
  room.handle(sinkConn, { type: "remind-set", from: today, to: today, days: [remindDay(today)] });
  assert.equal(storage.map.has("remind:" + today), false, "싱크는 리마인드를 맡길 수 없다");
  const errors = [];
  const peerConn = { ws: { send: (s) => errors.push(JSON.parse(s)) }, role: "peer", stamps: [], alive: true };
  room.handle(peerConn, { type: "remind-set", from: today, to: today, days: [remindDay(today)] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(storage.map.has("remind:" + today), true);
  room.handle(peerConn, { type: "remind-set", from: "2000-01-01", to: "2000-01-02", days: [] });
  assert.ok(errors.some((m) => m.error === "invalid remind"));
});

// 싱크가 오래 꺼져 있다 돌아오면 버퍼가 100건(BACKFILL_LIMIT)을 넘는다. 예전엔 싱크에도
// 최근 100건만 보내서, 싱크가 앞 50건을 "서버에 없는 구간"으로 건너뛰고 ack 했고
// 서버가 받지도 못한 항목을 지웠다.
test("backfill: 싱크에는 버퍼 전부를 보내 받기 전에는 아무것도 지워지지 않는다", async () => {
  const initial = { seq: 150, ackSeq: 0 };
  for (let seq = 1; seq <= 150; seq++) {
    initial["buf:" + String(seq).padStart(12, "0")] = { seq, kind: "msg", at: seq, iv: "aXY=", ct: "Y3Q=" };
  }
  const storage = fakeStorage(initial);
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const sent = [];
  const sink = { ws: { send: (s) => sent.push(JSON.parse(s)) }, role: "sink", stamps: [], alive: true };

  await room.backfill(sink, 0);
  const seqs = sent.filter((m) => m.type === "entry").map((m) => m.seq);
  assert.equal(seqs.length, 150);
  assert.equal(seqs[0], 1);
  assert.equal(seqs[149], 150);
  const done = sent.find((m) => m.type === "backfill-done");
  assert.equal(done.more, false);
  // 싱크가 받은 것만큼 ack 하기 전에는 버퍼가 그대로다
  assert.equal((await storage.list({ prefix: "buf:" })).size, 150);
});

test("backfill/fetch-older: 브라우저에는 가장 최근 100건, 그 앞은 이어서 준다", async () => {
  const initial = { seq: 150, ackSeq: 0 };
  for (let seq = 1; seq <= 150; seq++) {
    initial["buf:" + String(seq).padStart(12, "0")] = { seq, kind: "msg", at: seq, iv: "aXY=", ct: "Y3Q=" };
  }
  const storage = fakeStorage(initial);
  const state = { storage, blockConcurrencyWhile: (fn) => fn() };
  const room = new DuriDO(state, { DURI_BUCKET: fakeBucket([]) });
  await room.load();
  const sent = [];
  const peer = { ws: { send: (s) => sent.push(JSON.parse(s)) }, role: "peer", stamps: [], alive: true };

  await room.backfill(peer, 0);
  const firstPage = sent.filter((m) => m.type === "entry").map((m) => m.seq);
  assert.equal(firstPage.length, 100);
  assert.equal(firstPage[0], 51);
  assert.equal(firstPage[99], 150);
  const done = sent.find((m) => m.type === "backfill-done");
  assert.equal(done.oldest, 51);
  assert.equal(done.more, true);

  sent.length = 0;
  await room.fetchOlder(peer, 51, 0);
  const olderPage = sent.filter((m) => m.type === "entry").map((m) => m.seq);
  assert.equal(olderPage.length, 50);
  assert.equal(olderPage[0], 1);
  assert.equal(olderPage[49], 50);
  assert.equal(sent.find((m) => m.type === "older-done").more, false);
});

// ── sw.js 푸시 처리 — "두리 안에 있는데 알림이 계속 온다"(2026-10-25 사용자 보고) ──
// sw.js 를 가짜 서비스워커 전역에 올려 push 이벤트를 흘려 본다. 서버는 접속 중인 기기에도
// 보내므로(위 notifyPush 테스트) "보고 있으면 안 띄움"은 전적으로 sw.js 의 판단이다.
async function loadServiceWorker({ clients: windows = [] } = {}) {
  const { readFile } = await import("node:fs/promises");
  const vm = await import("node:vm");
  const src = await readFile(new URL("../duri/sw.js", import.meta.url), "utf8");
  const handlers = {};
  const open = []; // 아직 닫히지 않은 알림
  const registration = {
    showNotification: async (title, opts = {}) => { open.push({ title, ...opts, close() { open.splice(open.indexOf(this), 1); } }); },
    getNotifications: async ({ tag } = {}) => open.filter((n) => !tag || n.tag === tag),
    pushManager: { getSubscription: async () => null },
  };
  const clientsApi = { matchAll: async () => windows, claim: async () => {}, openWindow: async () => {} };
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, registration, clients: clientsApi, skipWaiting() {} };
  // 아주 작은 가짜 IndexedDB — meta 스토어 하나(pushlog 기록용)
  const meta = new Map();
  const req = (fn) => { const r = {}; queueMicrotask(() => { r.result = fn(); r.onsuccess?.(); }); return r; };
  const store = { get: (id) => req(() => meta.get(id)), put: (v) => req(() => { meta.set(v.id, v); }) };
  const fakeDb = { objectStoreNames: { contains: (n) => n === "meta" }, transaction: () => {
    const tx = { objectStore: () => store };
    queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.())));
    return tx;
  } };
  const indexedDB = { open: () => req(() => fakeDb) };
  vm.runInNewContext(src, { self, clients: clientsApi, caches: {}, fetch: async () => new Response(null), Response, URL,
    TextEncoder, TextDecoder, btoa, atob, crypto, setTimeout, clearTimeout, Date, console, indexedDB, queueMicrotask });
  const fire = async (type, init) => {
    let job = null;
    handlers[type]?.({ ...init, waitUntil: (p) => { job = p; } });
    await job;
  };
  const push = (data) => fire("push", { data: { json: () => data } });
  return { handlers, open, push, fire, log: () => meta.get("pushlog")?.value ?? [] };
}

test("sw: 앱에 포커스가 있으면 알림을 띄웠다 바로 닫는다(남는 알림 없음, silent push 아님)", async () => {
  const sw = await loadServiceWorker({ clients: [{ focused: true, visibilityState: "visible", postMessage() {} }] });
  await sw.push({ kind: "generic", seq: 1 });
  assert.equal(sw.open.length, 0);
});

test("sw: 앱이 닫혀 있으면 알림이 남는다", async () => {
  const sw = await loadServiceWorker({ clients: [] });
  await sw.push({ kind: "generic", seq: 1 });
  assert.equal(sw.open.length, 1);
  assert.equal(sw.open[0].tag, "duri-msg");
});

// "두리 안에 있는데 알림이 계속 온다"(2026-10-25, iPhone 홈 화면 PWA): 채팅을 보고 있는데
// "빵 / from Duri / 헉아직두?" 처럼 보낸 사람·본문이 든 진짜 알림 배너가 떴다. iOS 는 앞에 떠
// 있는 창도 focused:false 로, 내려 둔 창도 visibilityState:"visible" 로 보고해서 clients 만으론
// 구분이 안 된다 — 페이지가 app-foreground/app-background 를 직접 알려 준다(index.html tellSwVisibility).
const iosWindow = () => ({ id: "w1", focused: false, visibilityState: "visible", postMessage() {} });

test("sw: 두리 화면 안(iOS: focused:false·visible)에서는 메시지가 연달아 와도 알림이 남지 않는다", async () => {
  let sw;
  const win = { ...iosWindow(), postMessage(m) { if (m.type === "visibility-query") sw.fire("message", { data: { type: "app-foreground" }, source: win }); } };
  sw = await loadServiceWorker({ clients: [win] });
  for (let seq = 1; seq <= 3; seq++) await sw.push({ kind: "generic", seq });
  assert.equal(sw.open.length, 0);
});

test("sw: 두리를 내려 두면(iOS: 여전히 visible 로 보고) 알림이 남는다", async () => {
  const win = iosWindow();
  const sw = await loadServiceWorker({ clients: [win] });
  await sw.fire("message", { data: { type: "app-foreground" }, source: win });
  await sw.fire("message", { data: { type: "app-background" }, source: win });
  await sw.push({ kind: "generic", seq: 1 });
  assert.equal(sw.open.length, 1);
});

test("sw: 기록이 없으면(서비스워커가 새로 뜸) 페이지에 물어보고, 답하면 앞에 있는 것으로 본다", async () => {
  let sw;
  const win = { ...iosWindow(), postMessage(m) { if (m.type === "visibility-query") sw.fire("message", { data: { type: "app-foreground" }, source: win }); } };
  sw = await loadServiceWorker({ clients: [win] });
  await sw.push({ kind: "generic", seq: 1 });
  assert.equal(sw.open.length, 0);
});

test("sw: 물어봐도 답이 없으면(얼어 있는 백그라운드 페이지) 알림이 남는다", async () => {
  const sw = await loadServiceWorker({ clients: [iosWindow()] });
  await sw.push({ kind: "generic", seq: 1 });
  assert.equal(sw.open.length, 1);
});

// iPhone 에서 "두 가지가 동시에 안 된다"(2026-10-31): 두리를 보다가 홈으로 나가거나 잠그면 iOS 가
// 페이지를 곧바로 얼려서 app-background 를 못 보낼 때가 있다. 예전엔 마지막 앞 신호를 30초 믿어서
// 나가고 30초 안에 온 메시지는 알림이 안 떴다. 이제는 푸시가 올 때마다 페이지에 지금 묻는다.
test("sw: 두리를 보다가 나가자마자(신호 못 보내고 얼음) 온 메시지도 알림이 남는다", async () => {
  const win = iosWindow(); // 얼어 있어서 물음에 답하지 못한다
  const sw = await loadServiceWorker({ clients: [win] });
  await sw.fire("message", { data: { type: "app-foreground" }, source: win });
  await sw.push({ kind: "generic", seq: 1 });
  assert.equal(sw.open.length, 1);
});

test("sw: 보고 있는 페이지가 '뒤에 있다'고 답하면 기다리지 않고 바로 알린다", async () => {
  let sw;
  const win = { ...iosWindow(), postMessage(m) { if (m.type === "visibility-query") sw.fire("message", { data: { type: "app-background" }, source: win }); } };
  sw = await loadServiceWorker({ clients: [win] });
  const t = Date.now();
  await sw.push({ kind: "generic", seq: 1 });
  assert.equal(sw.open.length, 1);
  assert.ok(Date.now() - t < 400, "답이 왔으면 시간 제한까지 기다리지 않는다");
});

test("sw: 🧪 실전 테스트(probe)는 보통 메시지와 같은 판정 — 보고 있으면 숨기고, 나가 있으면 뜬다", async () => {
  let sw, fg = true;
  const win = { ...iosWindow(), postMessage(m) { if (m.type === "visibility-query" && fg) sw.fire("message", { data: { type: "app-foreground" }, source: win }); } };
  sw = await loadServiceWorker({ clients: [win] });
  await sw.push({ kind: "probe", nonce: "p1" });
  assert.equal(sw.open.length, 0);
  fg = false;
  await sw.push({ kind: "probe", nonce: "p2" });
  assert.equal(sw.open.length, 1);
  assert.match(sw.open[0].title, /실전 테스트/);
});

test("sw: 푸시마다 판정 근거를 기기 기록(pushlog)에 남긴다 — 아이폰에서 무슨 일이 있었는지 나중에 본다", async () => {
  let sw;
  const win = { ...iosWindow(), postMessage(m) { if (m.type === "visibility-query") sw.fire("message", { data: { type: "app-foreground" }, source: win }); } };
  sw = await loadServiceWorker({ clients: [win] });
  await sw.push({ kind: "generic", seq: 7 });
  const log = sw.log();
  assert.equal(log.length, 1);
  assert.equal(log[0].ev, "push");
  assert.equal(log[0].seq, 7);
  assert.equal(log[0].shown, "quiet");
  assert.equal(log[0].answer, "fg");
  assert.deepEqual(JSON.parse(JSON.stringify(log[0].clients)), [{ focused: false, vis: "visible" }]);
});

test("sw: 테스트 알림은 앱을 보고 있어도 남는다(🩺 알림 진단)", async () => {
  const win = iosWindow();
  const sw = await loadServiceWorker({ clients: [win] });
  await sw.fire("message", { data: { type: "app-foreground" }, source: win });
  await sw.push({ kind: "test", nonce: "n1" });
  assert.equal(sw.open.length, 1);
});

test("index.html 이 서비스워커에 화면 앞뒤를 알린다(sw.js 와 메시지 이름이 같아야 한다)", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../duri/index.html", import.meta.url), "utf8");
  const sw = await readFile(new URL("../duri/sw.js", import.meta.url), "utf8");
  for (const name of ["app-foreground", "app-background", "visibility-query"]) {
    assert.ok(html.includes(`"${name}"`), `index.html 에 ${name} 없음`);
    assert.ok(sw.includes(`"${name}"`), `sw.js 에 ${name} 없음`);
  }
  assert.match(html, /addEventListener\("pagehide", \(\) => \{ tellSwVisibility\(true\)/);
  // 물음에는 물어본 서비스워커(e.source)에게 답한다 — controller 없는 페이지도 답할 수 있게
  assert.match(html, /tellSwVisibility\(false, e\.source\)/);
  // 🧪 실전 테스트·기기 기록: 페이지와 sw.js 가 같은 이름을 쓴다
  for (const name of ["probe-result", "pushlog", '"probe"']) {
    assert.ok(html.includes(name), `index.html 에 ${name} 없음`);
    assert.ok(sw.includes(name), `sw.js 에 ${name} 없음`);
  }
});
