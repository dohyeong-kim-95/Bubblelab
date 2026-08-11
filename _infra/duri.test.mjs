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
  parseAlbumHeader,
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
    async list({ prefix, start, end, limit } = {}) {
      let ks = [...map.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort();
      if (start) ks = ks.filter((k) => k >= start);
      if (end) ks = ks.filter((k) => k < end);
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

test("notifyPush skips devices that are currently connected (no silent push to active viewers)", async () => {
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
  assert.deepEqual(hits, [away]); // 접속 중인 online 은 건너뛰고, 자리 비운 away 에만 발송
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
