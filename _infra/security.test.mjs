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

test("test subdomain relaxes CSP for Pyodide CDN and wasm only there", () => {
  const relaxed = applySecurityHeaders(
    new Response("ok"),
    new Request("https://test.bubblelab.dev/"),
  ).headers.get("Content-Security-Policy");
  assert.match(relaxed, /script-src [^;]*'wasm-unsafe-eval' https:\/\/cdn\.jsdelivr\.net/);
  assert.match(relaxed, /connect-src [^;]*https:\/\/cdn\.jsdelivr\.net/);

  const localRelaxed = applySecurityHeaders(
    new Response("ok"),
    new Request("http://localhost:8787/test/solve.html"),
  ).headers.get("Content-Security-Policy");
  assert.match(localRelaxed, /wasm-unsafe-eval/);

  const strict = applySecurityHeaders(
    new Response("ok"),
    new Request("https://slop.bubblelab.dev/"),
  ).headers.get("Content-Security-Policy");
  assert.doesNotMatch(strict, /jsdelivr|wasm-unsafe-eval/);
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

// 별자리 화면은 기기 방향과 위치를 쓴다. 기본 정책이 이 넷을 빈 목록으로 잠가 두면
// 브라우저가 권한을 묻기도 전에 이벤트를 안 보내서 "값이 안 들어온다"가 된다.
test("별자리 화면만 방향·위치 기능을 self로 연다", () => {
  const policyOf = (url) => applySecurityHeaders(new Response("ok"), new Request(url))
    .headers.get("Permissions-Policy");

  for (const url of ["https://util.bubblelab.dev/stars/", "https://util.bubblelab.dev/stars",
                     "http://localhost:8787/util/stars/"]) {
    const policy = policyOf(url);
    for (const feature of ["accelerometer", "gyroscope", "magnetometer", "geolocation", "camera"]) {
      assert.match(policy, new RegExp(`${feature}=\\(self\\)`), `${url} 에서 ${feature}가 막혀 있다`);
    }
    // 열어 준 것만 연다 — 마이크·결제·USB는 그대로 잠근 채로 둔다
    for (const feature of ["microphone", "payment", "usb"]) {
      assert.match(policy, new RegExp(`${feature}=\\(\\)`), `${url} 에서 ${feature}가 열렸다`);
    }
  }

  // 다른 화면은 기본 정책 그대로 — 이 완화가 사이트 전체로 새면 안 된다
  for (const url of ["https://util.bubblelab.dev/", "https://util.bubblelab.dev/fortune/",
                     "https://bubblelab.dev/", "https://slop.bubblelab.dev/stars/"]) {
    const policy = policyOf(url);
    assert.match(policy, /geolocation=\(\)/, `${url} 에서 위치가 열렸다`);
    assert.match(policy, /accelerometer=\(\)/, `${url} 에서 방향 센서가 열렸다`);
  }
});
