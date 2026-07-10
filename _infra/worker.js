// 호스트명 → sites/ 최상위 폴더 라우팅.
//   slop.bubblelab.dev/foo  → dist/slop/foo
//   bubblelab.dev/          → dist/www/
// 로컬 개발(wrangler dev)에서는 호스트명이 localhost라서
// 첫 번째 경로 세그먼트를 서브도메인 대신 사용한다:
//   localhost:8787/slop/foo → dist/slop/foo

const ROOT_DOMAIN = "bubblelab.dev";

export { RealtimeDO } from "./realtime.js";
export { AnalyticsDO } from "./analytics.js";

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

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const expected = await sha256(`${adminId}\0${adminPassword}`);
  const isAuthed = cookies(request).bl_admin === expected;
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol === "https:" ? "; Secure" : ""}`;

  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    if (form.get("id") === adminId && form.get("password") === adminPassword) {
      return redirect(`${base}/`, { "Set-Cookie": `bl_admin=${expected}; ${cookieFlags}` });
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
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;

    let site;
    let path = url.pathname;

    // 공용 에셋(_shared/*)은 모든 서브도메인에서 사이트 프리픽스 없이 서빙
    if (path.startsWith("/_shared/")) {
      return env.ASSETS.fetch(request);
    }

    // 실시간 데이터 서버: /_rt/<이름> → 이름당 Durable Object 하나
    if (path.startsWith("/_rt/")) {
      const name = path.slice("/_rt/".length).split("/")[0];
      if (!name) return new Response("missing name", { status: 400 });
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
      const adminUrl = new URL(url);
      adminUrl.pathname = path || "/";
      const localBase = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`) ? "" : "/admin";
      const adminResponse = await handleAdmin(request, env, adminUrl, localBase);
      if (adminResponse) return adminResponse;
    }

    url.pathname = `/${site}${path}`;
    const response = await env.ASSETS.fetch(new Request(url, request));

    // HTML 문서 방문만 집계한다. IP/UA는 저장하지 않고 익명 쿠키 ID만 사용한다.
    // 페이지별 인기 집계를 위해 문서마다 보낸다 (DO 쓰기는 방문자별 key라 멱등).
    const isDocument = request.headers.get("Sec-Fetch-Dest") === "document" ||
      request.headers.get("Accept")?.includes("text/html");
    if (site !== "admin" && isDocument && response.ok &&
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
