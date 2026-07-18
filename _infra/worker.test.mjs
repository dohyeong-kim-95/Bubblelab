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

test("work preview stays closed without a password and gates access with one", async () => {
  // secret 미설정 → fail-closed
  let response = await worker.fetch(new Request("https://work.bubblelab.dev/"), {}, ctx);
  assert.equal(response.status, 503);

  const assets = { fetch: async () => new Response("<p>brand</p>", { headers: { "Content-Type": "text/html" } }) };
  const env = { WORK_PASSWORD: "hunter2", ASSETS: assets };

  // 미인증 → 로그인으로 리다이렉트
  response = await worker.fetch(new Request("https://work.bubblelab.dev/brand/"), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/login");

  // 잘못된 비밀번호 → 401
  let form = new FormData();
  form.set("password", "wrong");
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 401);

  // 올바른 비밀번호 → 세션 쿠키 발급
  form = new FormData();
  form.set("password", "hunter2");
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 303);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /^bl_work=/);

  // 세션 쿠키로 접근 → 정적 서빙 + noindex/no-store
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/brand/", {
      headers: { Cookie: cookie.split(";")[0] },
    }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<p>brand</p>");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
