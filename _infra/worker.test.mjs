import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const ctx = { waitUntil() {} };

test("realtime and planner routes are closed unless explicitly enabled", async () => {
  const env = { ENABLE_REALTIME: "false", ENABLE_PLANNER: "false" };
  const realtime = await worker.fetch(
    new Request("https://games.bubblelab.dev/_rt/avalon", {
      headers: { Upgrade: "websocket" },
    }),
    env,
    ctx,
  );
  assert.equal(realtime.status, 503);

  const planner = await worker.fetch(
    new Request("https://util.bubblelab.dev/_planner/data"),
    env,
    ctx,
  );
  assert.equal(planner.status, 503);
  assert.match(planner.headers.get("Content-Security-Policy"), /default-src 'self'/);
});

test("worker rejects cross-site public writes before storage access", async () => {
  const response = await worker.fetch(
    new Request("https://slop.bubblelab.dev/_suggest", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "spam" }),
    }),
    {},
    ctx,
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
});

test("enabled realtime still rejects missing websocket origin before binding access", async () => {
  const response = await worker.fetch(
    new Request("https://games.bubblelab.dev/_rt/avalon", {
      headers: { Upgrade: "websocket" },
    }),
    { ENABLE_REALTIME: "true" },
    ctx,
  );
  assert.equal(response.status, 403);
});
