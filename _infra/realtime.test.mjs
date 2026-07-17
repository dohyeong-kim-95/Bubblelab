import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRealtimePath, validateRealtimeValue } from "./realtime.js";

test("normalizes expected game paths and rejects dangerous segments", () => {
  assert.equal(
    normalizeRealtimePath("/rooms/ABCDEF/players/u_0123456789/"),
    "rooms/ABCDEF/players/u_0123456789",
  );
  assert.throws(() => normalizeRealtimePath("rooms/__proto__/polluted"), /invalid path/);
  assert.throws(() => normalizeRealtimePath("rooms/constructor/prototype"), /invalid path/);
  assert.throws(() => normalizeRealtimePath(`rooms/${"x".repeat(65)}`), /invalid path/);
});

test("accepts bounded JSON and rejects prototype-pollution keys", () => {
  const normal = {
    meta: { status: "waiting", createdAt: { ".sv": "timestamp" } },
    players: { u_123: { name: "버블", online: true } },
  };
  assert.equal(validateRealtimeValue(normal), normal);

  const poisoned = JSON.parse('{"__proto__":{"isAdmin":true}}');
  assert.throws(() => validateRealtimeValue(poisoned), /invalid key/);
});

test("rejects excessively deep or oversized realtime values", () => {
  let deep = "end";
  for (let i = 0; i < 22; i += 1) deep = { child: deep };
  assert.throws(() => validateRealtimeValue(deep), /value too complex/);
  assert.throws(() => validateRealtimeValue("x".repeat(8_193)), /string too long/);
});
