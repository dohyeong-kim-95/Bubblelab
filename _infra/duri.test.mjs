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
  assert.deepEqual(storage.map.get("cal:evt123abc"), { id: "evt123abc", rev: 300, deleted: true });

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
  const full = await room.fetch(pushReq("POST", { subscription: await fakeSubscription("https://push.example.com/one-too-many") }));
  assert.equal(full.status, 503); // MAX_PUSH_SUBS(8) 상한 — 9번째는 거절
  assert.equal((await storage.list({ prefix: "push:" })).size, 8);

  const gone = await room.fetch(pushReq("DELETE", { endpoint: sub.endpoint }));
  assert.equal(gone.status, 200);
  assert.equal((await storage.list({ prefix: "push:" })).size, 7); // 하나만 해지됨
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

test("buildPushPayload carries the opaque blob for msg/photo but falls back to generic when oversized", () => {
  const storage = fakeStorage({ seq: 0, ackSeq: 0 });
  const room = new DuriDO({ storage, blockConcurrencyWhile: (fn) => fn() }, {});
  assert.deepEqual(room.buildPushPayload({ kind: "msg", iv: "aXY=", ct: "Y2lwaGVy" }), { kind: "msg", iv: "aXY=", ct: "Y2lwaGVy" });
  assert.deepEqual(room.buildPushPayload({ kind: "photo", metaIv: "aXY=", metaCt: "bWV0YQ==" }), { kind: "photo", metaIv: "aXY=", metaCt: "bWV0YQ==" });
  assert.deepEqual(room.buildPushPayload({ kind: "msg", iv: "aXY=", ct: "A".repeat(4000) }), { kind: "generic" });
});
