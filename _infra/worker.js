// 호스트명 → sites/ 최상위 폴더 라우팅.
//   slop.bubblelab.dev/foo  → dist/slop/foo
//   bubblelab.dev/          → dist/www/
// 로컬 개발(wrangler dev)에서는 호스트명이 localhost라서
// 첫 번째 경로 세그먼트를 서브도메인 대신 사용한다:
//   localhost:8787/slop/foo → dist/slop/foo

const ROOT_DOMAIN = "bubblelab.dev";
import { validPlannerCode } from "./planner.js";

export { RealtimeDO } from "./realtime.js";
export { AnalyticsDO } from "./analytics.js";
export { RecordsDO } from "./records.js";
export { PlannerDO } from "./planner.js";

const LOGIN_PAGE = (failed = false, base = "") => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Bubblelab Admin Login</title>
<style>:root{color-scheme:light dark}body{font-family:ui-monospace,monospace;display:grid;place-items:center;
min-height:100vh;margin:0;background:light-dark(#f2f6fa,#0d131c)}form{width:min(22rem,calc(100% - 2rem));
padding:2rem;border:1px solid light-dark(#dce4ec,#263445);border-radius:1rem;background:light-dark(#fff,#151e2a)}
h1{font-size:1.15rem;margin:0 0 1.5rem}label{display:block;margin:.8rem 0 .3rem;font-size:.82rem;opacity:.7}
input,button{width:100%;font:inherit;padding:.75rem;border-radius:.6rem;border:1px solid currentColor;background:none;color:inherit}
button{margin-top:1.2rem;cursor:pointer;font-weight:bold}.error{color:#e05252;font-size:.8rem}</style></head>
<body><form method="post" action="${base}/login"><h1>🫧 Bubblelab Admin</h1>
${failed ? '<p class="error">ID 또는 비밀번호가 맞지 않습니다.</p>' : ''}
<label for="id">ID</label><input id="id" name="id" autocomplete="username" required autofocus>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">로그인</button></form></body></html>`;

function cookies(request) {
  return Object.fromEntries(
    (request.headers.get("Cookie") ?? "").split(";").filter(Boolean).map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    }),
  );
}

/* 관리자 세션: 만료시각 + 랜덤값에 HMAC 서명한 토큰. 로그인마다 다르고
 * 만료가 있어서 쿠키가 비밀번호 등가물이 되지 않는다. 서명 키는
 * ADMIN_SESSION_SECRET, 없으면 계정 정보에서 파생(설정 부담 없이 동작). */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function sessionKey(env, adminId, adminPassword) {
  const secret = env.ADMIN_SESSION_SECRET || `${adminId}\0${adminPassword}\0bl-admin-session`;
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function issueSession(key) {
  const payload = `${Date.now() + SESSION_TTL_MS}.${crypto.randomUUID()}`;
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

async function validSession(key, token) {
  const [expiry, nonce, sig] = token?.split(".") ?? [];
  if (!expiry || !nonce || !sig || !/^[0-9a-f]+$/.test(sig)) return false;
  if (!Number.isFinite(+expiry) || Date.now() > +expiry) return false;
  const sigBytes = Uint8Array.from(sig.match(/../g) ?? [], (h) => parseInt(h, 16));
  return crypto.subtle.verify(
    "HMAC", key, sigBytes, new TextEncoder().encode(`${expiry}.${nonce}`),
  );
}

async function issuePlannerSession(key, userId) {
  const payload = `${Date.now() + 30 * 24 * 60 * 60 * 1000}.${userId}.${crypto.randomUUID()}`;
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

async function plannerSessionUser(key, token) {
  const [expiry, userId, nonce, sig] = token?.split(".") ?? [];
  if (!expiry || !/^[0-9a-f]{64}$/.test(userId ?? "") || !nonce || !/^[0-9a-f]+$/.test(sig ?? "")) return null;
  if (!Number.isFinite(+expiry) || Date.now() > +expiry) return null;
  const sigBytes = Uint8Array.from(sig.match(/../g) ?? [], (part) => parseInt(part, 16));
  const valid = await crypto.subtle.verify(
    "HMAC", key, sigBytes, new TextEncoder().encode(`${expiry}.${userId}.${nonce}`),
  );
  return valid ? userId : null;
}

async function handlePlanner(request, env, url) {
  const plannerSecret = env.PLANNER_SESSION_SECRET || env.ADMIN_SESSION_SECRET ||
    (env.ADMIN_ID && env.ADMIN_PASSWORD ? `${env.ADMIN_ID}\0${env.ADMIN_PASSWORD}` : null);
  if (!plannerSecret) return new Response("planner session secret is not configured", { status: 503 });
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`${plannerSecret}\0bl-planner-session`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  const sessionUser = await plannerSessionUser(key, cookies(request).bl_planner);
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${url.protocol === "https:" ? "; Secure" : ""}`;

  if (url.pathname === "/_planner/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const supplied = String(body.code ?? "").trim().toUpperCase();
    if (!validPlannerCode(supplied)) return Response.json({ error: "invalid code format" }, { status: 400 });
    const userId = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`user:${supplied}`)));
    const token = await issuePlannerSession(key, userId);
    return Response.json({ authenticated: true }, {
      headers: { "Set-Cookie": `bl_planner=${token}; ${cookieFlags}`, "Cache-Control": "no-store" },
    });
  }

  if (url.pathname === "/_planner/logout" && request.method === "POST") {
    return Response.json({ authenticated: false }, {
      headers: { "Set-Cookie": "bl_planner=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" },
    });
  }

  if (!sessionUser) return Response.json({ error: "authentication required" }, { status: 401 });
  if (url.pathname === "/_planner/data" && ["GET", "PUT", "PATCH"].includes(request.method)) {
    const id = env.PLANNER.idFromName(sessionUser);
    return env.PLANNER.get(id).fetch("https://planner.internal/", {
      method: request.method,
      ...(["PUT", "PATCH"].includes(request.method) && {
        headers: { "Content-Type": "application/json" }, body: await request.text(),
      }),
    });
  }
  return new Response("not found", { status: 404 });
}

function kstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const redirect = (location, headers = {}) =>
  new Response(null, { status: 303, headers: { Location: location, ...headers } });

async function handleAdmin(request, env, url, base = "") {
  const adminId = env.ADMIN_ID || "admin";
  const adminPassword = env.ADMIN_PASSWORD || "admin";
  const key = await sessionKey(env, adminId, adminPassword);
  const isAuthed = await validSession(key, cookies(request).bl_admin);
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol === "https:" ? "; Secure" : ""}`;

  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    if (form.get("id") === adminId && form.get("password") === adminPassword) {
      const token = await issueSession(key);
      return redirect(`${base}/`, { "Set-Cookie": `bl_admin=${token}; ${cookieFlags}` });
    }
    return new Response(LOGIN_PAGE(true, base), {
      status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (url.pathname === "/login") {
    if (isAuthed) return redirect(`${base}/`);
    return new Response(LOGIN_PAGE(false, base), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (url.pathname === "/logout") {
    return redirect(`${base}/login`, { "Set-Cookie": "bl_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
  }
  if (!isAuthed) return redirect(`${base}/login`);

  if (url.pathname === "/api/stats") {
    const id = env.ANALYTICS.idFromName("global");
    const response = await env.ANALYTICS.get(id).fetch(
      `https://analytics.internal/stats?date=${kstDate()}`,
    );
    const data = await response.json();
    data.usingDefaultCredentials = !env.ADMIN_ID || !env.ADMIN_PASSWORD;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  if (url.pathname === "/api/records") {
    const id = env.RECORDS.idFromName("global");
    const stub = env.RECORDS.get(id);
    if (request.method === "GET") {
      return stub.fetch("https://records.internal/_allrecords");
    }
    if (request.method === "DELETE") {
      const game = url.searchParams.get("game") ?? "";
      const alltime = url.searchParams.has("alltime") ? "&alltime=1" : "";
      return stub.fetch(
        `https://records.internal/_records?game=${encodeURIComponent(game)}${alltime}`,
        { method: "DELETE" },
      );
    }
  }

  if (url.pathname === "/api/notice") {
    const id = env.RECORDS.idFromName("global");
    const stub = env.RECORDS.get(id);
    if (["GET", "POST", "DELETE"].includes(request.method)) {
      return stub.fetch("https://records.internal/_notice", {
        method: request.method,
        ...(request.method === "POST" && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(await request.json().catch(() => ({}))),
        }),
      });
    }
  }

  if (url.pathname === "/api/suggestions") {
    const id = env.RECORDS.idFromName("global");
    const stub = env.RECORDS.get(id);
    if (request.method === "GET") {
      return stub.fetch("https://records.internal/_suggestions");
    }
    if (request.method === "DELETE") {
      const sid = url.searchParams.get("id") ?? "";
      return stub.fetch(
        `https://records.internal/_suggestions?id=${encodeURIComponent(sid)}`,
        { method: "DELETE" },
      );
    }
  }
  if (url.pathname === "/api/assets") {
    return new Response("not found", { status: 404 });
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;

    let site;
    let path = url.pathname;

    // R2 활성화 전까지 관리자 업로드 파일은 공개하지 않는다.
    if (path.startsWith("/_assets/upload/")) {
      return new Response("not found", { status: 404 });
    }
    // 공용 코드와 이미지 에셋은 모든 서브도메인에서 사이트 프리픽스 없이 서빙
    if (path.startsWith("/_shared/") || path.startsWith("/_assets/")) {
      return env.ASSETS.fetch(request);
    }

    if (path.startsWith("/_planner/")) {
      return handlePlanner(request, env, url);
    }

    // 공개 페이지 통계 (카테고리 홈의 접속량순 정렬용). 개인 데이터 없음.
    if (path === "/_stats") {
      const id = env.ANALYTICS.idFromName("global");
      const response = await env.ANALYTICS.get(id).fetch(
        `https://analytics.internal/pages?date=${kstDate()}&days=7`,
      );
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(response.body, { status: response.status, headers });
    }

    if (path === "/_streak" && request.method === "GET") {
      const visitorId = cookies(request).bl_vid;
      if (!visitorId) return Response.json({ streak: 1 }, { headers: { "Cache-Control": "no-store" } });
      const id = env.ANALYTICS.idFromName("global");
      return env.ANALYTICS.get(id).fetch("https://analytics.internal/streak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, date: kstDate() }),
      });
    }

    // 토이 아이디어 제출 (조회는 admin 전용 /api/suggestions)
    if (path === "/_suggest" && request.method === "POST") {
      const { text, page } = await request.json().catch(() => ({}));
      const id = env.RECORDS.idFromName("global");
      return env.RECORDS.get(id).fetch("https://records.internal/_suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, page, vid: cookies(request).bl_vid, date: kstDate() }),
      });
    }

    // 주간 신기록 보드: 모든 서브도메인에서 같은 저장소를 쓴다.
    // 삭제는 admin의 /api/records 뒤에만 있다 — 여기서는 조회·제출만.
    if (path === "/_records") {
      if (request.method !== "GET" && request.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }
      const id = env.RECORDS.idFromName("global");
      if (request.method === "GET") {
        const recordsUrl = new URL(request.url);
        const vid = cookies(request).bl_vid;
        if (vid) recordsUrl.searchParams.set("vid", vid);
        return env.RECORDS.get(id).fetch(new Request(recordsUrl, request));
      }
      return env.RECORDS.get(id).fetch(request);
    }

    if (path === "/_personal" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const id = env.RECORDS.idFromName("global");
      return env.RECORDS.get(id).fetch("https://records.internal/_personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, vid: cookies(request).bl_vid }),
      });
    }

    // 실시간 데이터 서버: /_rt/<이름> → 이름당 Durable Object 하나.
    // 임의 이름 폭주로 DO가 무한 생성되지 않게 형식·길이를 제한한다.
    if (path.startsWith("/_rt/")) {
      const name = path.slice("/_rt/".length).split("/")[0];
      if (!/^[a-z0-9-]{1,64}$/.test(name)) {
        return new Response("invalid name", { status: 400 });
      }
      const id = env.REALTIME.idFromName(name);
      return env.REALTIME.get(id).fetch(request);
    }

    if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) {
      site = "www";
    } else if (host.endsWith(`.${ROOT_DOMAIN}`)) {
      site = host.slice(0, -(ROOT_DOMAIN.length + 1));
    } else {
      const segments = path.split("/").filter(Boolean);
      site = segments[0] ?? "www";
      path = "/" + segments.slice(1).join("/");
      // 트레일링 슬래시 보존 (없으면 에셋 서버의 canonical 리다이렉트와 루프)
      if (url.pathname.endsWith("/") && !path.endsWith("/")) path += "/";
    }

    if (site === "admin") {
      // 프로덕션에서 secrets가 빠졌으면 admin/admin으로 열리는 대신 잠근다
      // (fail-closed). 로컬 개발에서만 기본 계정을 허용한다.
      const isProdHost = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`);
      if (isProdHost && (!env.ADMIN_ID || !env.ADMIN_PASSWORD)) {
        return new Response("admin credentials are not configured", { status: 503 });
      }
      const adminUrl = new URL(url);
      adminUrl.pathname = path || "/";
      const adminResponse = await handleAdmin(request, env, adminUrl, isProdHost ? "" : "/admin");
      if (adminResponse) return adminResponse;
    }

    url.pathname = `/${site}${path}`;
    const response = await env.ASSETS.fetch(new Request(url, request));

    // HTML 문서 방문만 집계한다. IP/UA는 저장하지 않고 익명 쿠키 ID만 사용한다.
    // 페이지별 인기 집계를 위해 문서마다 보낸다 (DO 쓰기는 방문자별 key라 멱등).
    // 봇 부풀리기 방지: 실제 브라우저 내비게이션에만 붙는 Sec-Fetch-Dest를
    // 요구하고, 크롤러/미리보기/스크립트류 User-Agent는 집계에서 뺀다.
    const ua = request.headers.get("User-Agent") ?? "";
    const isBot = !ua ||
      /bot|crawl|spider|scrap|preview|scan|monitor|headless|lighthouse|externalhit|curl|wget|python|java|okhttp|node|undici|axios|libwww|httpclient|ruby|php|perl|postman|insomnia/i.test(ua);
    const isDocument = request.headers.get("Sec-Fetch-Dest") === "document";
    if (site !== "admin" && isDocument && !isBot && response.ok &&
        response.headers.get("Content-Type")?.includes("text/html")) {
      const date = kstDate();
      const jar = cookies(request);
      const visitorId = jar.bl_vid || crypto.randomUUID();
      const segment = path.split("/").filter(Boolean)[0];
      const page = (segment ? `${site}/${segment}` : site).toLowerCase();
      const id = env.ANALYTICS.idFromName("global");
      ctx.waitUntil(env.ANALYTICS.get(id).fetch("https://analytics.internal/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, date, page }),
      }));
      const headers = new Headers(response.headers);
      const domain = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)
        ? `; Domain=${ROOT_DOMAIN}; Secure` : "";
      headers.append("Set-Cookie", `bl_vid=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax${domain}`);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  },
};
