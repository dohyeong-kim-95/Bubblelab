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

  const podcast = await worker.fetch(
    new Request("https://podcast.bubblelab.dev/_podcast/session"),
    env,
    ctx,
  );
  assert.equal(podcast.status, 503);
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

test("subdomain .html redirects strip the internal /site prefix from Location", async () => {
  // 에셋 서버가 .html→확장자 제거로 307을 돌려줄 때 Location에 내부 /work
  // 프리픽스가 담긴다. 서브도메인 공개 URL에는 site 세그먼트가 없으므로 워커가
  // 그 프리픽스를 떼어 브라우저가 /work/work/... 이중 프리픽스 404로 가지 않게 한다.
  const assets = {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (p.endsWith(".html")) {
        return new Response(null, { status: 307, headers: { Location: p.replace(/\.html$/, "") } });
      }
      return new Response("<p>keybox</p>", { headers: { "Content-Type": "text/html" } });
    },
  };
  const env = { WORK_PASSWORD: "hunter2", ASSETS: assets };

  const form = new FormData();
  form.set("password", "hunter2");
  let response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  const cookie = response.headers.get("Set-Cookie").split(";")[0];

  // 상품 상세 .html 클릭 → 307이되 Location에서 /work가 제거되어야 한다
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/daonfit/goods/keybox.html", {
      headers: { Cookie: cookie },
    }), env, ctx);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("Location"), "/daonfit/goods/keybox");

  // 확장자 없는 최종 경로는 그대로 200으로 서빙된다
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/daonfit/goods/keybox", {
      headers: { Cookie: cookie },
    }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<p>keybox</p>");
});

test("optout toggle is admin-gated and sets a domain-wide bl_notrack cookie", async () => {
  const env = { ADMIN_ID: "boss", ADMIN_PASSWORD: "hunter2" };

  // 미인증 → 로그인으로 리다이렉트, 쿠키 없음
  let response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/optout"), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/login");

  // 로그인해서 admin 세션 획득
  const form = new FormData();
  form.set("id", "boss");
  form.set("password", "hunter2");
  response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 303);
  const adminCookie = response.headers.get("Set-Cookie").split(";")[0];

  // GET: 현재 상태 안내 페이지
  response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/optout", {
      headers: { Cookie: adminCookie },
    }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /통계에 포함되고 있어요/);

  // POST on → 전체 서브도메인 장기 쿠키 심고 같은 화면으로 리다이렉트
  const toggle = new FormData();
  toggle.set("state", "on");
  response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/optout", {
      method: "POST", body: toggle, headers: { Cookie: adminCookie },
    }), env, ctx);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("Set-Cookie"),
    /^bl_notrack=1; Path=\/; HttpOnly; Max-Age=157680000; SameSite=Lax; Domain=bubblelab\.dev; Secure$/);

  // 켜진 상태의 GET은 제외 중이라고 안내
  response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/optout", {
      headers: { Cookie: `${adminCookie}; bl_notrack=1` },
    }), env, ctx);
  assert.match(await response.text(), /제외되고 있어요/);

  // POST off → 쿠키 삭제
  const off = new FormData();
  off.set("state", "off");
  response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/optout", {
      method: "POST", body: off, headers: { Cookie: `${adminCookie}; bl_notrack=1` },
    }), env, ctx);
  assert.match(response.headers.get("Set-Cookie"), /^bl_notrack=; .*Max-Age=0/);
});

test("opted-out browser is excluded from visit, qualify, and engagement tracking", async () => {
  const analyticsCalls = [];
  const env = {
    ASSETS: { fetch: async () => new Response("<p>hi</p>", { headers: { "Content-Type": "text/html" } }) },
    ANALYTICS: {
      idFromName: () => "global",
      get: () => ({ fetch: async (target) => { analyticsCalls.push(new URL(target).pathname); return new Response(null, { status: 204 }); } }),
    },
  };
  const pending = [];
  const trackingCtx = { waitUntil: (promise) => pending.push(promise) };
  const chromeHeaders = {
    "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    "Sec-Fetch-Dest": "document",
  };
  const vid = "bl_vid=00000000-0000-4000-8000-000000000001";

  // 제외 쿠키가 있으면 문서 방문에 bl_vid 발급도 track 호출도 없다
  let response = await worker.fetch(
    new Request("https://slop.bubblelab.dev/circle/", {
      headers: { ...chromeHeaders, Cookie: `${vid}; bl_notrack=1` },
    }), env, trackingCtx);
  await Promise.all(pending);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.deepEqual(analyticsCalls, []);

  // /_visit와 /_engagement도 조용히 무시한다
  for (const [path, body] of [["/_visit", "{}"], ["/_engagement", '{"activeMs":5000}']]) {
    response = await worker.fetch(
      new Request(`https://slop.bubblelab.dev${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `${vid}; bl_notrack=1` },
        body,
      }), env, trackingCtx);
    assert.equal(response.status, 204);
  }
  assert.deepEqual(analyticsCalls, []);

  // 제외 쿠키가 없으면 같은 요청이 정상 집계된다
  response = await worker.fetch(
    new Request("https://slop.bubblelab.dev/circle/", {
      headers: { ...chromeHeaders, Cookie: vid },
    }), env, trackingCtx);
  await Promise.all(pending);
  assert.match(response.headers.get("Set-Cookie") ?? "", /^bl_vid=/);
  assert.deepEqual(analyticsCalls, ["/track"]);
});
