import test from "node:test";
import assert from "node:assert/strict";
import {
  DURI_MAX_TEXT_BLOB,
  DURI_MAX_META_BLOB,
  isBlob,
  validateMsgFrame,
  validatePhotoMeta,
  isPhotoKey,
} from "./duri.js";

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
