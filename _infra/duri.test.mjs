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
