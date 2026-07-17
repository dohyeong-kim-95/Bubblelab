import test from "node:test";
import assert from "node:assert/strict";
import {
  applySecurityHeaders,
  featureEnabled,
  RateLimiterDO,
  requireJsonRequest,
  validateMutationRequest,
  validateWebSocketOrigin,
} from "./security.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  get(key) { return this.values.get(key); }
  put(key, value) { this.values.set(key, value); }
  deleteAll() { this.values.clear(); }
  setAlarm() {}
}

test("security-sensitive feature flags are exact and default closed", () => {
  assert.equal(featureEnabled({}, "ENABLE_REALTIME"), false);
  assert.equal(featureEnabled({ ENABLE_REALTIME: "false" }, "ENABLE_REALTIME"), false);
  assert.equal(featureEnabled({ ENABLE_REALTIME: "true" }, "ENABLE_REALTIME"), true);
});

test("requires JSON for JSON-only API requests", () => {
  const request = new Request("https://bubblelab.dev/_records", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(requireJsonRequest(request)?.status, 415);
  assert.equal(requireJsonRequest(new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: "{}",
  })), null);
});

test("rejects cross-origin mutations and oversized declared bodies", () => {
  const crossOrigin = new Request("https://bubblelab.dev/_suggest", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(validateMutationRequest(crossOrigin)?.status, 403);

  const oversized = new Request("https://bubblelab.dev/_suggest", {
    method: "POST",
    headers: { "Content-Length": "70000" },
  });
  assert.equal(validateMutationRequest(oversized)?.status, 413);
  assert.equal(validateMutationRequest(new Request("https://bubblelab.dev/")), null);
});

test("requires an exact browser origin for websocket upgrades", () => {
  const allowed = new Request("https://games.bubblelab.dev/_rt/avalon", {
    headers: { Origin: "https://games.bubblelab.dev" },
  });
  assert.equal(validateWebSocketOrigin(allowed), null);
  assert.equal(validateWebSocketOrigin(new Request(allowed.url))?.status, 403);
  assert.equal(validateWebSocketOrigin(new Request(allowed.url, {
    headers: { Origin: "https://attacker.example" },
  }))?.status, 403);
});

test("adds browser hardening headers without replacing response metadata", () => {
  const response = applySecurityHeaders(
    new Response("ok", { headers: { "Cache-Control": "public, max-age=60" } }),
    new Request("https://bubblelab.dev/"),
  );
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Strict-Transport-Security"), /includeSubDomains/);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
});

test("admin responses are never cached or indexed", () => {
  const response = applySecurityHeaders(
    new Response(null, { status: 303, headers: { Location: "/login" } }),
    new Request("https://admin.bubblelab.dev/"),
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

test("durable rate limiter persists a fixed-window limit", async () => {
  const limiter = new RateLimiterDO({ storage: new MemoryStorage() });
  const check = () => limiter.fetch(new Request("https://rate-limit.internal/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 2, windowMs: 60_000 }),
  })).then((response) => response.json());

  assert.equal((await check()).allowed, true);
  assert.equal((await check()).allowed, true);
  const blocked = await check();
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
});
