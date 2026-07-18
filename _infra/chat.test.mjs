import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_STICKER_PACKS,
  parseMaxConnections,
  sanitizeChatNick,
  validateChatMessage,
} from "./chat.js";

test("sanitizes nicknames and rejects unusable ones", () => {
  assert.equal(sanitizeChatNick("  포근한   골당이 "), "포근한 골당이");
  assert.equal(sanitizeChatNick("버블​러버"), "버블러버");
  assert.equal(sanitizeChatNick("줄\n바꿈 닉"), "줄 바꿈 닉");
  assert.equal(sanitizeChatNick(""), null);
  assert.equal(sanitizeChatNick("​​"), null);
  assert.equal(sanitizeChatNick("가".repeat(17)), null);
  assert.equal(sanitizeChatNick(42), null);
  assert.equal(sanitizeChatNick(null), null);
});

test("accepts text messages and strips control characters", () => {
  assert.deepEqual(
    validateChatMessage({ type: "text", text: "  안녕하세요! " }),
    { kind: "text", text: "안녕하세요!" },
  );
  // 줄바꿈은 남고 나머지 제어문자는 지워진다
  assert.deepEqual(
    validateChatMessage({ type: "text", text: "첫 줄\n둘째 줄‎" }),
    { kind: "text", text: "첫 줄\n둘째 줄" },
  );
  assert.throws(() => validateChatMessage({ type: "text", text: "" }), /invalid text/);
  assert.throws(() => validateChatMessage({ type: "text", text: "   " }), /invalid text/);
  assert.throws(
    () => validateChatMessage({ type: "text", text: "가".repeat(501) }),
    /invalid text/,
  );
  assert.throws(() => validateChatMessage({ type: "text", text: 1 }), /invalid text/);
});

test("accepts only registered sticker pack references", () => {
  for (const [pack, count] of CHAT_STICKER_PACKS) {
    assert.deepEqual(
      validateChatMessage({ type: "sticker", pack, n: count }),
      { kind: "sticker", pack, n: count },
    );
  }
  assert.throws(
    () => validateChatMessage({ type: "sticker", pack: "kakao-friends", n: 1 }),
    /unknown sticker pack/,
  );
  assert.throws(
    () => validateChatMessage({ type: "sticker", pack: "brown-horse", n: 0 }),
    /invalid sticker/,
  );
  assert.throws(
    () => validateChatMessage({ type: "sticker", pack: "brown-horse", n: 17 }),
    /invalid sticker/,
  );
  assert.throws(
    () => validateChatMessage({ type: "sticker", pack: "brown-horse", n: 1.5 }),
    /invalid sticker/,
  );
  assert.throws(
    () => validateChatMessage({ type: "sticker", pack: "brown-horse", n: "3" }),
    /invalid sticker/,
  );
});

test("rejects unknown or malformed frames", () => {
  assert.throws(() => validateChatMessage(null), /invalid message/);
  assert.throws(() => validateChatMessage([]), /invalid message/);
  assert.throws(() => validateChatMessage({ type: "eval", code: "x" }), /unknown type/);
});

test("admin max-connections values are validated as integers 1-100", () => {
  assert.equal(parseMaxConnections(10), 10);
  assert.equal(parseMaxConnections("25"), 25);
  assert.equal(parseMaxConnections(1), 1);
  assert.equal(parseMaxConnections(100), 100);
  assert.equal(parseMaxConnections(0), null);
  assert.equal(parseMaxConnections(101), null);
  assert.equal(parseMaxConnections(2.5), null);
  assert.equal(parseMaxConnections(""), null);
  assert.equal(parseMaxConnections("abc"), null);
  assert.equal(parseMaxConnections(null), null);
  assert.equal(parseMaxConnections(undefined), null);
});
