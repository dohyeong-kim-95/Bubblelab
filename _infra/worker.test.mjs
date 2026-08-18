import test from "node:test";
import assert from "node:assert/strict";
import worker, { resetAssetFlagsCache } from "./worker.js";
import { AssetFlagsDO } from "./asset-flags.js";

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

test("life 은 fail-closed 이고 게이트 뒤에서만 열린다", async () => {
  let response = await worker.fetch(new Request("https://life.bubblelab.dev/"), {
    ENABLE_LIFE: "true",
  }, ctx);
  assert.equal(response.status, 503, "시크릿이 없으면 플래그가 켜져 있어도 닫힌다");

  const env = {
    ENABLE_LIFE: "true", LIFE_PASSWORD: "only-me", LIFE_SESSION_SECRET: "session-secret",
    ASSETS: {
      // 실제 에셋 서버처럼 없는 파일에는 404 를 준다.
      fetch: async (request) => (new URL(request.url).pathname.includes("/_life/")
        ? new Response("not found", { status: 404 })
        : new Response("<main>할 일</main>", { headers: { "Content-Type": "text/html" } })),
    },
  };
  response = await worker.fetch(new Request("https://life.bubblelab.dev/"), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/login");

  const wrong = new FormData();
  wrong.set("password", "nope");
  response = await worker.fetch(
    new Request("https://life.bubblelab.dev/login", { method: "POST", body: wrong }), env, ctx);
  assert.equal(response.status, 401);

  const form = new FormData();
  form.set("password", "only-me");
  response = await worker.fetch(
    new Request("https://life.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("Set-Cookie"), /^bl_life=.*HttpOnly; SameSite=Lax; Max-Age=31536000; Secure/);
  const cookie = response.headers.get("Set-Cookie").split(";", 1)[0];

  response = await worker.fetch(
    new Request("https://life.bubblelab.dev/", { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.headers.get("Content-Security-Policy"), /unsafe-inline/);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");

  // 서버에 저장하는 경로는 없다 — 예전 API 가 남아 있지 않아야 한다.
  for (const path of ["/_life/status", "/_life/commit", "/_life/devices"]) {
    response = await worker.fetch(
      new Request(`https://life.bubblelab.dev${path}`, { headers: { Cookie: cookie } }), env, ctx);
    assert.equal(response.status, 404, path);
  }
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

  // 미인증 → 로그인으로 리다이렉트 (목적지를 next로 보존)
  response = await worker.fetch(new Request("https://work.bubblelab.dev/brand/"), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/login?next=brand");

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

test("work root is public and client sessions are scoped to their project", async () => {
  const assets = { fetch: async () => new Response("ok", { headers: { "Content-Type": "text/html" } }) };
  const env = { WORK_PASSWORD: "master", WORK_CLIENTS: '{"daonfit":"fitpw"}', ASSETS: assets };

  // 루트 브랜딩·의뢰 안내 페이지는 로그인 없이 공개
  let response = await worker.fetch(new Request("https://work.bubblelab.dev/"), env, ctx);
  assert.equal(response.status, 200);
  response = await worker.fetch(new Request("https://work.bubblelab.dev/request"), env, ctx);
  assert.equal(response.status, 200);
  response = await worker.fetch(new Request("https://work.bubblelab.dev/showcase/mindfulness"), env, ctx);
  assert.equal(response.status, 200);

  // 의뢰 ID + 비밀번호 로그인 → 자기 프로젝트로 리다이렉트
  const form = new FormData();
  form.set("id", "daonfit");
  form.set("password", "fitpw");
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/daonfit/");
  const cookie = response.headers.get("Set-Cookie").split(";")[0];

  // 자기 프로젝트는 열리고, 남의 프로젝트는 로그인으로 돌려보낸다
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/daonfit/", { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(response.status, 200);
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/other/", { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/login?next=other");

  // 접근 못 하는 목적지의 로그인 페이지는 홈으로 튕기지 않고 폼을 보여준다
  // (예전에는 daonfit 세션이 /emoticon → /login → /daonfit/ 루프로 끌려갔다)
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login?next=other", { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /action="\/login\?next=other"/);

  // next가 자기 프로젝트면 로그인 페이지는 그리로 보낸다
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login?next=daonfit", { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/daonfit/");

  // 마스터로 next 로그인 → 원래 가려던 폴더로
  const master = new FormData();
  master.set("id", "whatever");
  master.set("password", "master");
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login?next=emoticon", { method: "POST", body: master }), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/emoticon/");

  // 남의 ID + 남의 비밀번호 조합은 401
  const bad = new FormData();
  bad.set("id", "other");
  bad.set("password", "fitpw");
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login", { method: "POST", body: bad }), env, ctx);
  assert.equal(response.status, 401);
});

test("work intake accepts public chat submissions and validates required fields", async () => {
  const calls = [];
  const env = {
    WORK_QNA: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (target, init) => {
          calls.push({ id, target, body: JSON.parse(init.body) });
          return Response.json({ saved: true });
        },
      }),
    },
  };
  let response = await worker.fetch(new Request("https://work.bubblelab.dev/_workintake", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "홍길동", contact: "a@b.c", what: "브랜드 랜딩", when: "1개월 안", budget: "미정", note: "" }),
  }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(calls[0].id, "__intake__");
  assert.match(calls[0].body.question, /브랜드 랜딩/);
  assert.match(calls[0].body.question, /a@b\.c/);
  assert.equal(calls[0].body.nick, "홍길동");

  // 필수값 누락 → 400, DO 호출 없음
  response = await worker.fetch(new Request("https://work.bubblelab.dev/_workintake", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }), env, ctx);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);

  // GET은 허용하지 않는다 (조회는 admin 전용)
  response = await worker.fetch(new Request("https://work.bubblelab.dev/_workintake"), env, ctx);
  assert.equal(response.status, 405);
});

test("duri subdomain gates with its own long-lived bl_duri session", async () => {
  // secret 미설정 → fail-closed
  let response = await worker.fetch(new Request("https://duri.bubblelab.dev/"), {}, ctx);
  assert.equal(response.status, 503);

  const assets = { fetch: async () => new Response("<p>duri</p>", { headers: { "Content-Type": "text/html" } }) };
  const env = { WORK_PASSWORD: "hunter2", ENABLE_DURI: "true", ASSETS: assets };

  // 미인증 → 로그인으로 리다이렉트
  response = await worker.fetch(new Request("https://duri.bubblelab.dev/"), env, ctx);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/login");

  // 잘못된 비밀번호 → 401
  let form = new FormData();
  form.set("password", "wrong");
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 401);

  // 올바른 비밀번호 → bl_duri 세션 쿠키(1년) 발급
  form = new FormData();
  form.set("password", "hunter2");
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 303);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /^bl_duri=/);
  assert.match(cookie, /Max-Age=31536000/);
  assert.match(cookie, /SameSite=Lax/); // PWA 홈 화면 실행에도 세션 유지

  // 세션 쿠키로 접근 → 정적 서빙 + noindex/no-store
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/", {
      headers: { Cookie: cookie.split(";")[0] },
    }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<p>duri</p>");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  // /_duri 릴레이는 bl_duri 세션(또는 싱크 토큰)을 요구한다: 쿠키 없으면 401
  const relayEnv = {
    ...env,
    DURI_BUCKET: {},
    DURI: { idFromName: () => "main", get: () => ({ fetch: async () => new Response("relayed") }) },
  };
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/_duri", { headers: { Upgrade: "websocket" } }),
    relayEnv, ctx);
  assert.equal(response.status, 401);

  // bl_duri 세션이 있으면 work 게이트를 거치지 않고 릴레이 인증을 통과한다
  // (WebSocket 업그레이드가 아니라면 sink-token 아닌 경로는 404로 떨어짐 — 인증은 통과).
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/_duri/nope", {
      headers: { Cookie: cookie.split(";")[0] },
    }), relayEnv, ctx);
  assert.equal(response.status, 404);
});

test("duri prefers DURI_PASSWORD over WORK_PASSWORD and room reset is owner-only", async () => {
  const assets = { fetch: async () => new Response("<p>duri</p>", { headers: { "Content-Type": "text/html" } }) };
  const stub = { fetch: async () => Response.json({ ok: true }) };
  const env = {
    DURI_PASSWORD: "duonly", WORK_PASSWORD: "hunter2", ENABLE_DURI: "true",
    ASSETS: assets, DURI_BUCKET: {}, DURI: { idFromName: () => "main", get: () => stub },
  };

  // DURI_PASSWORD 가 설정되면 duri 게이트는 work 비번을 더 이상 받지 않는다(독립)
  let form = new FormData();
  form.set("password", "hunter2");
  let response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 401);

  // 전용 비번으로 로그인 → bl_duri 세션
  form = new FormData();
  form.set("password", "duonly");
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  assert.equal(response.status, 303);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /^bl_duri=/);

  // 방 초기화: 세션 없으면 인증 실패
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/_duri/reset", { method: "POST" }), env, ctx);
  assert.equal(response.status, 401);

  // 소유자 세션이면 DO 로 전달되어 초기화된다
  response = await worker.fetch(
    new Request("https://duri.bubblelab.dev/_duri/reset", {
      method: "POST", headers: { Cookie: cookie.split(";")[0] },
    }), env, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
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

test("brief routes are wired and closed without VAPID configuration", async () => {
  // 라우트 경로·메서드는 핸들러 테스트(brief.test.mjs)가 못 잡는 얇은 층이라
  // 여기서 확인한다 — 경로 한 글자만 틀려도 404가 조용히 배포된다.
  const env = {};
  const notAllowed = await worker.fetch(
    new Request("https://util.bubblelab.dev/_brief/today", { method: "POST" }), env, ctx);
  assert.equal(notAllowed.status, 405);

  // GET은 공개키 조회 — 미설정이면 null을 준다(버튼이 뜨지 않는 fail-closed 신호)
  const config = await worker.fetch(
    new Request("https://util.bubblelab.dev/_brief/push"), env, ctx);
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { vapidPublicKey: null });

  // 구독은 VAPID가 없으면 503 — DO를 건드리기 전에 막힌다(env.BRIEF 바인딩 없음)
  const subscribe = await worker.fetch(
    new Request("https://util.bubblelab.dev/_brief/push", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }), env, ctx);
  assert.equal(subscribe.status, 503);
});

// 폴더 이름을 바꾸면 예전 링크가 죽는다. 옮긴 자리만 알려주고 페이지는 남기지 않는다.
test("이름이 바뀐 폴더의 옛 주소는 새 주소로 안내한다", async () => {
  const assets = { fetch: async () => new Response("<p>page</p>", { headers: { "Content-Type": "text/html" } }) };
  const env = { ASSETS: assets };

  // 서브도메인 접속 — 공개 URL에 site 세그먼트가 없다
  for (const from of ["https://util.bubblelab.dev/convert", "https://util.bubblelab.dev/convert/"]) {
    const response = await worker.fetch(new Request(from), env, ctx);
    assert.equal(response.status, 301, `${from} 이 옮겨가지 않았다`);
    assert.equal(response.headers.get("Location"), "/image-convert/");
  }

  // 로컬 경로 라우팅 — site 세그먼트를 붙여 준다
  const local = await worker.fetch(new Request("http://localhost:8787/util/convert/"), env, ctx);
  assert.equal(local.status, 301);
  assert.equal(local.headers.get("Location"), "/util/image-convert/");

  // 새 주소와 무관한 경로는 건드리지 않는다
  const fresh = await worker.fetch(new Request("https://util.bubblelab.dev/image-convert/"), env, ctx);
  assert.equal(fresh.status, 200);
  const other = await worker.fetch(new Request("https://slop.bubblelab.dev/convert/"), env, ctx);
  assert.equal(other.status, 200, "다른 서브도메인의 같은 이름까지 옮기면 안 된다");
});

// ── 에셋 공개 여부 (admin 스티커 토글) ────────────────────────────────────

const catalogItem = (id, extra = {}) => ({
  id, category: "sticker", title: `${id} 팩`, preview: `/_assets/sticker/${id}/preview.png`,
  downloads: [{ label: "01", file: "01.png", url: `/_assets/sticker/${id}/01.png` }],
  createdAt: "2026-07-31", active: true, ...extra,
});

/** 빌드 산출물(정적 카탈로그) + 진짜 AssetFlagsDO 로 채운 env */
function assetEnv(items, extra = {}) {
  const stored = new Map();
  const flags = new AssetFlagsDO({
    storage: { async get(key) { return stored.get(key); }, async put(key, value) { stored.set(key, value); } },
  });
  return {
    ...extra,
    ASSETS: {
      fetch: async (request) => new URL(request.url).pathname === "/_assets/catalog.json"
        ? Response.json({ version: 1, generatedAt: "2026-08-06T00:00:00.000Z", items })
        : new Response("not found", { status: 404 }),
    },
    ASSET_FLAGS: {
      idFromName: (name) => name,
      get: () => ({ fetch: (input, init) => flags.fetch(new Request(input, init)) }),
    },
  };
}

async function adminSession(env) {
  const form = new FormData();
  form.set("id", "boss");
  form.set("password", "hunter2");
  const response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  return response.headers.get("Set-Cookie").split(";")[0];
}

const publicItems = async (env) => {
  const response = await worker.fetch(
    new Request("https://assets.bubblelab.dev/_assets/catalog.json"), env, ctx);
  assert.equal(response.status, 200);
  return response.json();
};

test("공개 카탈로그는 metadata에서 꺼 둔 항목을 빼고 나간다", async () => {
  resetAssetFlagsCache();
  const env = assetEnv([catalogItem("shown"), catalogItem("build-hidden", { active: false })]);
  const catalog = await publicItems(env);
  assert.deepEqual(catalog.items.map((item) => item.id), ["shown"]);
  assert.equal("active" in catalog.items[0], false, "내부 플래그를 내보내면 안 된다");
  assert.equal(catalog.version, 1);
});

test("admin에서 토글한 스티커 공개 여부가 카탈로그에 반영된다", async () => {
  resetAssetFlagsCache();
  const env = assetEnv(
    [catalogItem("jeju-cat"), catalogItem("emoticon-anim", { active: false })],
    { ADMIN_ID: "boss", ADMIN_PASSWORD: "hunter2" },
  );

  // 미인증 → 로그인으로
  let response = await worker.fetch(new Request("https://admin.bubblelab.dev/api/stickers"), env, ctx);
  assert.equal(response.status, 303);
  response = await worker.fetch(new Request("https://admin.bubblelab.dev/api/stickers", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "jeju-cat", visible: false }),
  }), env, ctx);
  assert.equal(response.status, 303);
  assert.deepEqual((await publicItems(env)).items.map((item) => item.id), ["jeju-cat"]);

  const Cookie = await adminSession(env);

  // 목록에는 숨긴 팩까지 현재 상태와 함께 나온다
  response = await worker.fetch(
    new Request("https://admin.bubblelab.dev/api/stickers", { headers: { Cookie } }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  let { items } = await response.json();
  assert.deepEqual(items.map((item) => [item.id, item.visible]), [["jeju-cat", true], ["emoticon-anim", false]]);

  // 공개 → 숨김
  response = await worker.fetch(new Request("https://admin.bubblelab.dev/api/stickers", {
    method: "POST", headers: { Cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "jeju-cat", visible: false }),
  }), env, ctx);
  assert.equal(response.status, 200);
  ({ items } = await response.json());
  assert.deepEqual(items.find((item) => item.id === "jeju-cat"), {
    id: "jeju-cat", category: "sticker", title: "jeju-cat 팩",
    preview: "/_assets/sticker/jeju-cat/preview.png", count: 1, createdAt: "2026-07-31", chat: null,
    defaultVisible: true, visible: false, overridden: true,
  });
  assert.deepEqual((await publicItems(env)).items.map((item) => item.id), []);

  // metadata에서 꺼 둔 팩도 admin에서 켤 수 있다 (재빌드 없이)
  response = await worker.fetch(new Request("https://admin.bubblelab.dev/api/stickers", {
    method: "POST", headers: { Cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "emoticon-anim", visible: true }),
  }), env, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual((await publicItems(env)).items.map((item) => item.id), ["emoticon-anim"]);

  // null → 오버라이드 해제, 리포의 metadata 값으로 되돌아간다
  response = await worker.fetch(new Request("https://admin.bubblelab.dev/api/stickers", {
    method: "POST", headers: { Cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "emoticon-anim", visible: null }),
  }), env, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual((await publicItems(env)).items.map((item) => item.id), []);

  // 토글 대상이 아닌 것들은 거절 (배경화면·경로 조작·값 형식)
  for (const body of [{ id: "night-sky/../x", visible: false }, { id: "", visible: false }, { visible: false }]) {
    response = await worker.fetch(new Request("https://admin.bubblelab.dev/api/stickers", {
      method: "POST", headers: { Cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), env, ctx);
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  // 다른 출처에서 온 쓰기는 세션이 있어도 막힌다
  response = await worker.fetch(new Request("https://admin.bubblelab.dev/api/stickers", {
    method: "POST",
    headers: { Cookie, "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ id: "jeju-cat", visible: true }),
  }), env, ctx);
  assert.equal(response.status, 403);
});

// 배포 검증의 기준점. 없으면 verify-prod 가 옛 배포를 검사하고 통과했다고 한다.
test("/_health 는 서빙 중인 커밋과 바인딩을 읽기 전용으로 알려준다", async () => {
  const stamp = { commit: "c".repeat(40), builtAt: "2026-08-12T00:00:00.000Z", siteCount: 14 };
  let assetRequests = 0;
  const env = {
    ENABLE_CHAT: "true", ENABLE_REALTIME: "false",
    ASSETS: {
      fetch(request) {
        assetRequests++;
        assert.equal(new URL(request.url).pathname, "/_health.json");
        return Response.json(stamp);
      },
    },
    CHAT: {}, INVEST: {},
  };
  const response = await worker.fetch(new Request("https://bubblelab.dev/_health"), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(assetRequests, 1);
  assert.equal(body.commit, stamp.commit);
  assert.equal(body.siteCount, 14);
  assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.features.chat, true);
  assert.equal(body.features.realtime, false);
  assert.equal(body.bindings.CHAT, true);
  assert.equal(body.bindings.RECORDS, false, "없는 바인딩을 있다고 하면 안 된다");
  // 서브도메인 이름 목록은 담지 않는다 — 비공개 서브도메인은 주소를 모르는 것이
  // 유일한 장벽이라 개수만 센다. (플래그·바인딩 이름은 공개 리포의 wrangler.jsonc
  // 에 이미 있으므로 새로 새는 정보가 아니다.)
  assert.equal(body.sites, undefined);
});

test("/_health 는 빌드 스탬프가 없어도 진단을 돌려준다", async () => {
  const env = { ASSETS: { fetch: () => new Response("not found", { status: 404 }) } };
  const response = await worker.fetch(new Request("https://bubblelab.dev/_health"), env, ctx);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commit, null);
});

test("/_health 는 POST 를 받지 않는다 (읽기 전용)", async () => {
  // 에셋 서버는 /_health.json 만 안다 — POST /_health 가 health 핸들러를 타면
  // 200 이 나오고, 안 타면 정적 서빙으로 떨어져 404 가 된다.
  const env = {
    ASSETS: {
      fetch: (request) => (new URL(request.url).pathname === "/_health.json"
        ? Response.json({ commit: "x" })
        : new Response("not found", { status: 404 })),
    },
  };
  const response = await worker.fetch(
    new Request("https://bubblelab.dev/_health", { method: "POST" }), env, ctx);
  assert.equal(response.status, 404);
});

test("public static assets cache by stability while HTML and JSON keep their existing policy", async () => {
  const env = {
    ASSETS: {
      fetch(request) {
        const path = new URL(request.url).pathname;
        const type = path.endsWith(".js") ? "text/javascript"
          : path.endsWith(".woff2") ? "font/woff2"
          : path.endsWith(".png") ? "image/png"
          : path.endsWith(".json") ? "application/json"
          : "text/html";
        return new Response("asset", { headers: { "Content-Type": type } });
      },
    },
  };

  const fetch = (url) => worker.fetch(new Request(url), env, ctx);
  let response = await fetch("https://games.bubblelab.dev/avalon/assets/index-DwRzto2u.js");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");

  response = await fetch("https://www.bubblelab.dev/_shared/search-rules.js");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600, must-revalidate");

  response = await fetch("https://www.bubblelab.dev/_shared/TwemojiCountryFlags.woff2");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=2592000, stale-while-revalidate=86400");

  response = await fetch("https://assets.bubblelab.dev/_assets/sticker/couple-cat/preview.png");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=604800, stale-while-revalidate=86400");

  response = await fetch("https://puzzle.bubblelab.dev/");
  assert.equal(response.headers.get("Cache-Control"), null, "공개 문서는 캐시 헤더를 붙이지 않는다");
});

test("confidential static cache only admits code, fonts, and explicitly non-sensitive media", async () => {
  const assets = {
    fetch(request) {
      const path = new URL(request.url).pathname;
      const type = path.endsWith(".woff2") ? "font/woff2"
        : path.endsWith(".png") ? "image/png"
        : path.endsWith(".js") ? "text/javascript"
        : "text/html";
      return new Response("asset", { headers: { "Content-Type": type } });
    },
  };

  let response = await worker.fetch(
    new Request("https://work.bubblelab.dev/showcase/img/mindfulness.png"),
    { WORK_PASSWORD: "master", ASSETS: assets }, ctx);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=604800, stale-while-revalidate=86400");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");

  const env = { WORK_PASSWORD: "master", ASSETS: assets };
  const form = new FormData();
  form.set("password", "master");
  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/login", { method: "POST", body: form }), env, ctx);
  const cookie = response.headers.get("Set-Cookie").split(";", 1)[0];

  response = await worker.fetch(new Request(
    "https://work.bubblelab.dev/daonfit/_work_assets/fonts/woff2/subset.woff2",
    { headers: { Cookie: cookie } },
  ), env, ctx);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=2592000, stale-while-revalidate=86400");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");

  response = await worker.fetch(new Request(
    "https://work.bubblelab.dev/daonfit/app.js", { headers: { Cookie: cookie } },
  ), env, ctx);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=3600, must-revalidate");

  // 인증 뒤 이미지는 지문이 박혀 있어도 디스크에 남기지 않는다.
  for (const path of ["/daonfit/private-preview.png", "/daonfit/private-preview-a1b2c3d4.png"]) {
    response = await worker.fetch(
      new Request(`https://work.bubblelab.dev${path}`, { headers: { Cookie: cookie } }), env, ctx);
    assert.equal(response.headers.get("Cache-Control"), "no-store", path);
  }

  response = await worker.fetch(
    new Request("https://work.bubblelab.dev/daonfit/", { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(response.headers.get("Cache-Control"), "no-store", "문서는 no-store");
});

test("잠든 화면은 코드와 데이터를 남긴 채 입구만 닫힌다", async () => {
  const env = { ASSETS: { fetch: () => new Response("page", { headers: { "Content-Type": "text/html" } }) } };
  const get = (url) => worker.fetch(new Request(url), env, ctx);

  for (const url of [
    "https://estate.bubblelab.dev/",
    "https://estate.bubblelab.dev/basemap-dongtan.png",
    "https://trip.bubblelab.dev/",
    "https://invest.bubblelab.dev/",
    "https://util.bubblelab.dev/planner/",
  ]) {
    assert.equal((await get(url)).status, 404, url);
  }
  // 같은 서브도메인의 다른 화면은 멀쩡해야 한다.
  assert.equal((await get("https://util.bubblelab.dev/")).status, 200);
  assert.equal((await get("https://util.bubblelab.dev/calendar/")).status, 200);
  // API 는 기능 플래그로 fail-closed.
  for (const path of ["/_invest/state", "/_planner/data", "/_trip/watches"]) {
    assert.equal((await get(`https://bubblelab.dev${path}`)).status, 503, path);
  }
});
