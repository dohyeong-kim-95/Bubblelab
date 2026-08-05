// 호스트명 → sites/ 최상위 폴더 라우팅.
//   slop.bubblelab.dev/foo  → dist/slop/foo
//   bubblelab.dev/          → dist/www/
// 로컬 개발(wrangler dev)에서는 호스트명이 localhost라서
// 첫 번째 경로 세그먼트를 서브도메인 대신 사용한다:
//   localhost:8787/slop/foo → dist/slop/foo

const ROOT_DOMAIN = "bubblelab.dev";

// 이름이 바뀐 폴더의 옛 주소 → 새 주소. 키는 `<서브도메인>:<경로>`(끝 슬래시 없음).
// 폴더 이름은 곧 카드 라벨이자 URL이라, 하는 일을 못 알리는 이름은 바꾸는 게 맞다.
// 다만 바꾸는 순간 예전 링크가 죽으므로 여기 한 줄을 함께 남긴다.
const MOVED_PATHS = new Map([
  ["util:/convert", "/image-convert/"],   // 2026-08: "convert"만으로는 이미지 도구인 줄 모른다
]);
const REALTIME_NAMESPACES = new Set(["avalon", "liargame", "yacht"]);
// cron이 리뷰를 주기적으로 동기화할 외주 프로젝트 목록 (커머스 API, 현재 mock).
const WORK_REVIEW_PROJECTS = ["daonfit"];
import { validPlannerCode } from "./planner.js";
import { handleFortuneChart, handleFortunePush, sendFortuneDaily } from "./fortune.js";
import { handleBriefPush, handleBriefRates, handleBriefToday, sendBriefDaily } from "./brief.js";
import { handlePodcast, handlePodcastAdmin, runDailyGeneration, runEveningReminder, UPLOAD_MAX_BYTES } from "./podcast.js";
import { handleEstateDeals } from "./estate.js";
import { serveAssetDownload, serveAssetDownloadCounts } from "./downloads.js";
import { fetchStoreReviews, REVIEWS_SYNC_VERSION } from "./reviews.js";
import { DURI_MAX_PHOTO_BYTES } from "./duri.js";
import { EMOTICON_MAX_BODY, EMOTICON_MAX_PROMPT, EMOTICON_MAX_REFERENCES, geminiGenerate } from "./emoticon-gen.js";
import {
  applySecurityHeaders,
  consumeRateLimit,
  featureEnabled,
  rateLimitResponse,
  requireJsonRequest,
  validateMutationRequest,
  validateWebSocketOrigin,
} from "./security.js";

export { RealtimeDO } from "./realtime.js";
export { ChatDO } from "./chat.js";
export { WorkQnaDO } from "./workqna.js";
export { WorkReviewsDO } from "./reviews.js";
export { EmoticonReviewDO } from "./emoticon-review.js";
export { AnalyticsDO } from "./analytics.js";
export { RecordsDO } from "./records.js";
export { PlannerDO } from "./planner.js";
export { PodcastDO } from "./podcast.js";
export { RateLimiterDO } from "./security.js";
export { DuriDO } from "./duri.js";
export { FortuneDO } from "./fortune.js";
export { BriefDO } from "./brief.js";

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

// 외주 작업(work.bubblelab.dev) 의뢰 조회 로그인 화면
const WORK_LOGIN_PAGE = (failed, base, next = "") => `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>의뢰 조회 — bubblelab works</title><style>
:root { color-scheme: dark; }
body { font-family: ui-monospace, monospace; min-height: 100dvh; margin: 0; display: grid;
       place-items: center; background: light-dark(#f2f4f7, #0d131c); color: light-dark(#1c2733, #e2e9f0); }
form { display: grid; gap: .7rem; width: min(19rem, 88vw); padding: 1.6rem;
       background: light-dark(#fff, #171f2b); border: 1px solid light-dark(#d9e0e7, #2a3646);
       border-radius: 1rem; }
h1 { margin: 0; font-size: 1.05rem; }
p { margin: 0; font-size: .74rem; opacity: .65; line-height: 1.6; }
input { font: inherit; color: inherit; padding: .65rem .8rem; border-radius: .6rem;
        border: 1px solid light-dark(#d9e0e7, #2a3646); background: transparent; }
button { font: inherit; padding: .65rem; border: 0; border-radius: .6rem;
         background: #4f7fdd; color: #fff; font-weight: bold; cursor: pointer; }
.error { color: #d05a5a; font-size: .74rem; min-height: 1em; margin: 0; }
.back { font-size: .74rem; text-align: center; }
.back a { color: inherit; opacity: .65; }</style></head>
<body><form method="post" action="${base}/login${next ? `?next=${next}` : ""}">
<h1>의뢰 조회</h1>
<p>발급받은 의뢰 ID와 비밀번호를 입력하면 진행 중인 프로젝트를 확인할 수 있습니다.</p>
<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="의뢰 ID" aria-label="의뢰 ID" required autofocus>
<input name="password" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호" required>
<p class="error">${failed ? "의뢰 ID 또는 비밀번호가 맞지 않습니다." : ""}</p>
<button type="submit">들어가기</button>
<p class="back"><a href="${base}/">← bubblelab works 홈</a></p></form></body></html>`;

// Duri 전용 서브도메인(duri.bubblelab.dev) 로그인 화면. 세션이 1년이라 설치형
// 앱에선 최초 1회만 보게 된다. E2E 암호 문구는 이 게이트와 별개로 앱 안에서 받는다.
const DURI_LOGIN_PAGE = (failed, base) => `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Duri</title><style>
:root { color-scheme: dark; }
body { font-family: ui-monospace, monospace; min-height: 100dvh; margin: 0; display: grid;
       place-items: center; background: light-dark(#fafbfc, #10151c); color: light-dark(#1c2733, #e2e9f0); }
form { display: grid; gap: .7rem; width: min(19rem, 88vw); padding: 1.6rem;
       background: light-dark(#fff, #161c25); border: 1px solid light-dark(#e6eaef, #232c38);
       border-radius: 1rem; }
h1 { margin: 0; font-size: 1.05rem; }
p { margin: 0; font-size: .74rem; opacity: .65; line-height: 1.6; }
input { font: inherit; color: inherit; padding: .65rem .8rem; border-radius: .6rem;
        border: 1px solid light-dark(#e6eaef, #232c38); background: transparent; }
button { font: inherit; padding: .65rem; border: 0; border-radius: .6rem;
         background: light-dark(#c0568a, #f0a8ce); color: light-dark(#fff, #1a1016); font-weight: bold; cursor: pointer; }
.error { color: #d05a5a; font-size: .74rem; min-height: 1em; margin: 0; }</style></head>
<body><form method="post" action="${base}/login">
<h1>💞 Duri</h1>
<p>둘만의 비공개 공간입니다. 비밀번호를 입력해주세요. (한 번 입력하면 오래 유지됩니다)</p>
<input name="password" type="password" autocomplete="current-password" aria-label="비밀번호" required autofocus>
<p class="error">${failed ? "비밀번호가 맞지 않습니다." : ""}</p>
<button type="submit">들어가기</button></form></body></html>`;

// 운영자 브라우저 집계 제외 화면 (admin 로그인 뒤 /optout). 켜면 전체 서브도메인
// bl_notrack 쿠키가 심어지고 그 브라우저의 방문·체류·유효방문이 모두 통계에서
// 빠진다. 브라우저(프로필)마다 admin에 로그인해 한 번씩 켠다 — 방문자가 임의로
// 자신을 통계에서 빼지 못하도록 인증 뒤에만 둔다.
const OPTOUT_PAGE = (active) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Bubblelab 집계 제외</title>
<style>:root{color-scheme:light dark}body{font-family:ui-monospace,monospace;display:grid;place-items:center;
min-height:100vh;margin:0;background:light-dark(#f2f6fa,#0d131c);color:light-dark(#17202b,#dbe5ef)}
main{width:min(24rem,calc(100% - 2rem));padding:2rem;border:1px solid light-dark(#dce4ec,#263445);
border-radius:1rem;background:light-dark(#fff,#151e2a)}h1{font-size:1.1rem;margin:0 0 1rem}
p{font-size:.82rem;line-height:1.7;opacity:.75}.state{font-weight:bold;font-size:.95rem;opacity:1;
color:${active ? "#477a5d" : "#d05a5a"}}button{width:100%;font:inherit;font-weight:bold;padding:.75rem;
margin-top:1rem;border-radius:.6rem;border:1px solid currentColor;background:none;color:inherit;cursor:pointer}</style></head>
<body><main><h1>🫥 이 브라우저 집계 제외</h1>
<p class="state">${active ? "지금 이 브라우저는 방문 통계에서 제외되고 있어요." : "지금 이 브라우저는 방문 통계에 포함되고 있어요."}</p>
<p>켜면 이 브라우저의 방문·체류·유효방문이 모두 집계에서 빠집니다.
쿠키로 기억하므로 브라우저(프로필)마다 한 번씩 켜야 하고, 쿠키를 지우면 다시 집계됩니다.</p>
<form method="post"><input type="hidden" name="state" value="${active ? "off" : "on"}">
<button type="submit">${active ? "다시 집계에 포함하기" : "이 브라우저 집계 제외 켜기"}</button></form>
<p style="text-align:center;margin-bottom:0"><a href="./" style="color:inherit;opacity:.6;font-size:.8rem">‹ 관리 홈으로</a></p></main></body></html>`;

function cookies(request) {
  return Object.fromEntries(
    (request.headers.get("Cookie") ?? "").split(";").filter(Boolean).map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    }),
  );
}

const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function visitorId(request) {
  const value = cookies(request).bl_vid;
  return VISITOR_ID.test(value ?? "") ? value : null;
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
  if (!expiry || !nonce || !/^[0-9a-f]{64}$/.test(sig ?? "")) return false;
  if (!Number.isFinite(+expiry) || Date.now() > +expiry) return false;
  const sigBytes = Uint8Array.from(sig.match(/../g) ?? [], (h) => parseInt(h, 16));
  return crypto.subtle.verify(
    "HMAC", key, sigBytes, new TextEncoder().encode(`${expiry}.${nonce}`),
  );
}

async function matchesCredential(key, supplied, expected) {
  const expectedBytes = new TextEncoder().encode(String(expected));
  const signature = await crypto.subtle.sign("HMAC", key, expectedBytes);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(String(supplied ?? "")),
  );
}

/* work 의뢰 세션: 만료.의뢰ID.난수 에 HMAC 서명. 의뢰 ID가 payload 에 들어가
 * 프로젝트별 접근 범위를 갖는다. 운영자 마스터는 ID "*" (모든 프로젝트). */
async function issueWorkSession(key, client) {
  const payload = `${Date.now() + SESSION_TTL_MS}.${client}.${crypto.randomUUID()}`;
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

async function workSessionClient(key, token) {
  const [expiry, client, nonce, sig] = token?.split(".") ?? [];
  if (!expiry || !client || !nonce || !/^[0-9a-f]{64}$/.test(sig ?? "")) return null;
  if (!Number.isFinite(+expiry) || Date.now() > +expiry) return null;
  const sigBytes = Uint8Array.from(sig.match(/../g) ?? [], (h) => parseInt(h, 16));
  const valid = await crypto.subtle.verify(
    "HMAC", key, sigBytes, new TextEncoder().encode(`${expiry}.${client}.${nonce}`),
  );
  return valid ? client : null;
}

// 의뢰 계정: WORK_CLIENTS secret 에 JSON 으로 { "의뢰ID": "비밀번호" }.
// ID는 프로젝트 폴더명과 같다 (예: {"daonfit": "..."}).
function workClients(env) {
  try {
    const parsed = JSON.parse(env.WORK_CLIENTS || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function workKeyOf(env) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`${env.WORK_PASSWORD}\0bl-work-session`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
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
  if (url.pathname === "/_planner/data" && ["GET", "PUT", "PATCH", "DELETE"].includes(request.method)) {
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

/* 외주 작업 게이트. 루트(브랜딩·의뢰 안내 등 루트 파일)는 공개하고,
 * 프로젝트 폴더(/<의뢰ID>/…)만 로그인 뒤 접근된다. 의뢰 ID/비밀번호는
 * WORK_CLIENTS secret(JSON), WORK_PASSWORD 는 운영자 마스터(모든 프로젝트).
 * 인증되면 null을 돌려 정적 서빙으로 폴스루한다. */
const WORK_PUBLIC_PAGES = new Set(["request", "showcase"]); // 확장자 없는 공개 루트 경로(폴더 포함)

async function handleWork(request, env, url, base = "") {
  const key = await workKeyOf(env);
  const client = await workSessionClient(key, cookies(request).bl_work);
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol === "https:" ? "; Secure" : ""}`;
  const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  const homeOf = (grant) => (grant === "*" ? `${base}/` : `${base}/${grant}/`);
  // 목적지 폴더(next): 접근 부족으로 로그인에 온 경우 로그인 후 그리로 보낸다.
  const nextRaw = url.searchParams.get("next") ?? "";
  const next = /^[a-z0-9-]{1,32}$/.test(nextRaw) ? nextRaw : "";

  if (url.pathname === "/login" && request.method === "POST") {
    const limited = await enforceRateLimit(request, env, {
      scope: "work-login", limit: 5, windowMs: 15 * 60 * 1000,
    });
    if (limited) return limited;
    const form = await request.formData();
    const id = String(form.get("id") ?? "").trim().toLowerCase();
    const password = form.get("password");
    const accounts = workClients(env);
    let grant = null;
    if (/^[a-z0-9-]{1,32}$/.test(id) && accounts[id]
      && await matchesCredential(key, password, accounts[id])) {
      grant = id;
    } else if (await matchesCredential(key, password, env.WORK_PASSWORD)) {
      grant = "*"; // 운영자 마스터 — ID 무관
    }
    if (grant) {
      const token = await issueWorkSession(key, grant);
      const dest = next && (grant === "*" || grant === next) ? `${base}/${next}/` : homeOf(grant);
      return redirect(dest, { "Set-Cookie": `bl_work=${token}; ${cookieFlags}` });
    }
    return new Response(WORK_LOGIN_PAGE(true, base, next), { status: 401, headers: htmlHeaders });
  }
  if (url.pathname === "/logout") {
    return redirect(`${base}/`, { "Set-Cookie": "bl_work=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
  }
  if (url.pathname === "/login") {
    // 세션이 목적지에 못 들어가는 경우(예: daonfit 세션으로 emoticon 접근)는
    // 홈으로 튕기지 말고 로그인 폼을 보여 계정을 바꿀 수 있게 한다.
    if (client && (client === "*" || client === next)) return redirect(next ? `${base}/${next}/` : homeOf(client));
    if (client && !next) return redirect(homeOf(client));
    return new Response(WORK_LOGIN_PAGE(false, base, next), { headers: htmlHeaders });
  }

  // 공개 영역: 루트("/")·확장자 있는 루트 파일(에셋)·공개 페이지 목록.
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (first === "" || WORK_PUBLIC_PAGES.has(first) || /\.[a-z0-9]+$/i.test(first)) return null;

  // 프로젝트 폴더 — 해당 의뢰 세션(또는 마스터)만. 목적지를 next로 넘겨
  // 로그인 후 원래 가려던 폴더로 돌아오게 한다.
  const loginUrl = /^[a-z0-9-]{1,32}$/.test(first) ? `${base}/login?next=${first}` : `${base}/login`;
  if (!client) return redirect(loginUrl);
  if (client !== "*" && client !== first) return redirect(loginUrl);
  return null;
}

/* Duri 전용 서브도메인(duri.bubblelab.dev) 게이트. 비밀번호는 work과 같은
 * WORK_PASSWORD를 쓰되 세션은 별도(bl_duri)이고 1년이라, 설치형 앱이 한 번
 * 로그인하면 사실상 다시 묻지 않는다. 인증되면 null을 돌려 정적 서빙으로
 * 폴스루한다. E2E 암호 문구는 이 게이트와 무관하게 앱 안에서 받는다. */
const DURI_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// duri 게이트/릴레이 비밀번호. 전용 DURI_PASSWORD 가 있으면 그것을, 없으면
// work 과 공유하던 WORK_PASSWORD 로 폴백한다(설정 전에도 안 끊기게). DURI_PASSWORD
// 를 설정하는 순간 duri 는 work 과 독립되고, 파생 키가 바뀌므로 기존 bl_duri
// 세션·싱크토큰(DURI_SINK_SECRET 미설정 시)은 무효화된다 — 새로 시작에 부합.
function duriPassword(env) {
  return env.DURI_PASSWORD || env.WORK_PASSWORD || null;
}

async function duriSessionKey(env) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`${duriPassword(env)}\0bl-duri-session`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function issueDuriSession(key) {
  const payload = `${Date.now() + DURI_SESSION_TTL_MS}.${crypto.randomUUID()}`;
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

async function handleDuriGate(request, env, url, base = "") {
  const key = await duriSessionKey(env);
  const isAuthed = await validSession(key, cookies(request).bl_duri);
  // SameSite=Lax: 홈 화면에서 PWA를 새로 띄우는 top-level 진입에도 쿠키가 실려
  // 매번 재로그인하지 않게 한다(Strict는 이 진입에서 쿠키가 누락됨). 교차 사이트
  // 하위요청엔 안 실려 CSRF 보호는 유지된다.
  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(DURI_SESSION_TTL_MS / 1000)}${url.protocol === "https:" ? "; Secure" : ""}`;
  const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };

  if (url.pathname === "/login" && request.method === "POST") {
    const limited = await enforceRateLimit(request, env, {
      scope: "duri-login", limit: 5, windowMs: 15 * 60 * 1000,
    });
    if (limited) return limited;
    const form = await request.formData();
    if (await matchesCredential(key, form.get("password"), duriPassword(env))) {
      const token = await issueDuriSession(key);
      return redirect(`${base}/`, { "Set-Cookie": `bl_duri=${token}; ${cookieFlags}` });
    }
    return new Response(DURI_LOGIN_PAGE(true, base), { status: 401, headers: htmlHeaders });
  }
  if (url.pathname === "/logout") {
    return redirect(`${base}/login`, { "Set-Cookie": "bl_duri=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  }
  if (url.pathname === "/login") {
    if (isAuthed) return redirect(`${base}/`);
    return new Response(DURI_LOGIN_PAGE(false, base), { headers: htmlHeaders });
  }
  if (!isAuthed) return redirect(`${base}/login`);
  return null;
}

/* Duri 실시간 중계 + 사진 버퍼. 접근은 둘 중 하나로만: duri 게이트를 통과한
 * 브라우저(bl_duri 쿠키) 또는 싱크 토큰을 제시한 데스크톱 데몬. 서버는 E2E
 * 암호블롭만 다루므로 평문·키·신원을 알지 못한다. 판정한 역할을 X-Duri-Role
 * 헤더로 DO에 넘긴다. */
const SINK_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

async function duriSinkKey(env) {
  const pw = duriPassword(env);
  const secret = env.DURI_SINK_SECRET || (pw ? `${pw}\0bl-duri-sink` : null);
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function issueSinkToken(key) {
  const payload = `${Date.now() + SINK_TOKEN_TTL_MS}.${crypto.randomUUID()}`;
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

function withDuriRole(request, role) {
  const headers = new Headers(request.headers);
  headers.set("X-Duri-Role", role);
  return new Request(request, { headers });
}

async function handleDuri(request, env, url) {
  if (!featureEnabled(env, "ENABLE_DURI")) {
    return Response.json({ error: "duri is temporarily unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "86400" },
    });
  }
  // R2 버퍼·게이트 비밀번호가 없으면 fail-closed.
  if (!env.DURI_BUCKET || !duriPassword(env)) {
    return new Response("duri is not configured", { status: 503 });
  }
  const path = url.pathname;

  const gateKey = await duriSessionKey(env);
  const gated = await validSession(gateKey, cookies(request).bl_duri);
  const sinkKey = await duriSinkKey(env);
  const token = url.searchParams.get("token") ||
    (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const sinkOk = !!(sinkKey && token) && await validSession(sinkKey, token);

  // 소유자(duri 게이트)만 싱크 토큰을 발급받는다 → 데스크톱 데몬 설정에 넣는다.
  if (path === "/_duri/sink-token" && request.method === "POST") {
    if (!gated) return new Response("authentication required", { status: 401 });
    if (!sinkKey) return new Response("sink secret not configured", { status: 503 });
    return Response.json({ token: await issueSinkToken(sinkKey) }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!gated && !sinkOk) return new Response("authentication required", { status: 401 });
  const role = sinkOk ? "sink" : "peer";
  const stub = env.DURI.get(env.DURI.idFromName("main"));

  if (path === "/_duri" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    if (role === "peer") {
      const originError = validateWebSocketOrigin(request);
      if (originError) return originError;
    }
    const limited = await enforceRateLimit(request, env, {
      scope: "duri-connect", limit: 30, windowMs: 60 * 1000,
    });
    if (limited) return limited;
    return stub.fetch(withDuriRole(request, role));
  }

  if (path === "/_duri/photo" || path.startsWith("/_duri/photo/") || path === "/_duri/status") {
    return stub.fetch(withDuriRole(request, role));
  }

  // 알림 자가진단: 내 기기로 테스트 알림을 쏴 어디서 막히는지(구독 없음·VAPID
  // 미설정·발송 성공) 알려준다. 브라우저(peer)만.
  if (path === "/_duri/push/test" && request.method === "POST") {
    return stub.fetch(withDuriRole(request, role));
  }

  // 새 메시지 웹 푸시. 공개키 조회는 DO 없이 바로(민감하지 않음), 구독·해지는 DO에
  // 위임(peer 전용 — DO가 다시 확인한다).
  if (path === "/_duri/push") {
    if (request.method === "GET") {
      return Response.json({ vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" || request.method === "DELETE") {
      return stub.fetch(withDuriRole(request, role));
    }
  }

  // 방 초기화: 소유자(duri 게이트 세션)만. 싱크 토큰으로는 못 지운다. 서버 버퍼와
  // 참조 사진(R2)을 비워 "새로 시작"을 만든다. 각자 PC 싱크 아카이브는 손대지 않는다.
  if (path === "/_duri/reset" && request.method === "POST") {
    if (!gated) return new Response("owner only", { status: 403 });
    const limited = await enforceRateLimit(request, env, {
      scope: "duri-reset", limit: 5, windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;
    return stub.fetch(withDuriRole(request, role));
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

async function enforceRateLimit(request, env, options) {
  const result = await consumeRateLimit(request, env, options);
  return result.allowed ? null : rateLimitResponse(result);
}

async function handleAdmin(request, env, url, base = "") {
  const adminId = env.ADMIN_ID || "admin";
  const adminPassword = env.ADMIN_PASSWORD || "admin";
  const key = await sessionKey(env, adminId, adminPassword);
  const isAuthed = await validSession(key, cookies(request).bl_admin);
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol === "https:" ? "; Secure" : ""}`;

  if (url.pathname === "/login" && request.method === "POST") {
    const limited = await enforceRateLimit(request, env, {
      scope: "admin-login", limit: 5, windowMs: 15 * 60 * 1000,
    });
    if (limited) return limited;
    const form = await request.formData();
    const [idMatches, passwordMatches] = await Promise.all([
      matchesCredential(key, form.get("id"), adminId),
      matchesCredential(key, form.get("password"), adminPassword),
    ]);
    if (idMatches && passwordMatches) {
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

  // 로그인한 운영자의 현재 브라우저를 방문 통계에서 제외/복귀시킨다.
  // bl_notrack은 전체 서브도메인 쿠키라 admin 밖의 모든 방문에 적용된다.
  if (url.pathname === "/optout") {
    const host = url.hostname;
    const domain = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)
      ? `; Domain=${ROOT_DOMAIN}; Secure` : "";
    if (request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const cookie = form?.get("state") === "on"
        ? `bl_notrack=1; Path=/; HttpOnly; Max-Age=157680000; SameSite=Lax${domain}`
        : `bl_notrack=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax${domain}`;
      return redirect(`${base}/optout`, { "Set-Cookie": cookie });
    }
    return new Response(OPTOUT_PAGE(cookies(request).bl_notrack === "1"), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (url.pathname === "/api/stats") {
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const id = env.ANALYTICS.idFromName("global");
    const response = await env.ANALYTICS.get(id).fetch(
      `https://analytics.internal/stats?date=${kstDate()}&days=${days}`,
    );
    const data = await response.json();
    data.usingDefaultCredentials = !env.ADMIN_ID || !env.ADMIN_PASSWORD;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  // 봇 유입 등으로 오염된 특정 날짜의 방문 통계를 통째로 지운다.
  if (url.pathname === "/api/stats/reset" && request.method === "POST") {
    const date = url.searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "invalid date" }, { status: 400 });
    }
    const id = env.ANALYTICS.idFromName("global");
    return env.ANALYTICS.get(id).fetch(
      `https://analytics.internal/reset?date=${date}`,
      { method: "POST" },
    );
  }

  if (url.pathname === "/api/records") {
    const id = env.RECORDS.idFromName("global");
    const stub = env.RECORDS.get(id);
    if (request.method === "GET") {
      return stub.fetch(url.searchParams.has("alltime")
        ? "https://records.internal/_records?alltime=1"
        : "https://records.internal/_allrecords");
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

  // 신규 의뢰 채팅 접수 확인함 — work의 /_workintake가 쌓은 항목을 조회·삭제
  if (url.pathname === "/api/work") {
    const stub = env.WORK_QNA.get(env.WORK_QNA.idFromName("__intake__"));
    if (request.method === "GET") {
      return stub.fetch("https://workqna.internal/");
    }
    if (request.method === "DELETE") {
      const intakeId = url.searchParams.get("id") ?? "";
      return stub.fetch("https://workqna.internal/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: intakeId }),
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
  if (url.pathname === "/api/chat") {
    const stub = env.CHAT.get(env.CHAT.idFromName("lobby"));
    if (request.method === "GET") {
      return stub.fetch("https://chat.internal/settings");
    }
    if (request.method === "POST") {
      return stub.fetch("https://chat.internal/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await request.json().catch(() => ({}))),
      });
    }
    if (request.method === "DELETE") { // 로비 초기화: 모든 연결을 끊는다
      return stub.fetch("https://chat.internal/reset", { method: "POST" });
    }
  }
  if (url.pathname.startsWith("/api/podcast/")) {
    if (!featureEnabled(env, "ENABLE_PODCAST")) {
      return Response.json({ error: "podcast is disabled" }, { status: 503 });
    }
    const podcastResponse = await handlePodcastAdmin(request, env, url);
    if (podcastResponse) return podcastResponse;
  }
  if (url.pathname === "/api/assets") {
    return new Response("not found", { status: 404 });
  }
  return null;
}

export async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;

    let site;
    let path = url.pathname;

    const mutationError = validateMutationRequest(
      request,
      path === "/_podcast/upload" ? UPLOAD_MAX_BYTES :
      path === "/_duri/photo" ? DURI_MAX_PHOTO_BYTES :
      path === "/_emoticon/generate" ? EMOTICON_MAX_BODY :
      path === "/_planner/data" ? 600 * 1024 : 64 * 1024,
    );
    if (mutationError) return mutationError;

    if (path.startsWith("/_download/")) {
      return serveAssetDownload(request, env, ctx, url);
    }
    if (path === "/_asset-downloads" && request.method === "GET") {
      const limited = await enforceRateLimit(request, env, {
        scope: "asset-download-counts", limit: 60, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      return serveAssetDownloadCounts(env);
    }

    // R2 활성화 전까지 관리자 업로드 파일은 공개하지 않는다.
    if (path.startsWith("/_assets/upload/")) {
      return new Response("not found", { status: 404 });
    }
    // 공용 코드와 이미지 에셋은 모든 서브도메인에서 사이트 프리픽스 없이 서빙
    if (path.startsWith("/_shared/") || path.startsWith("/_assets/")) {
      return env.ASSETS.fetch(request);
    }

    if (path.startsWith("/_planner/")) {
      if (!featureEnabled(env, "ENABLE_PLANNER")) {
        return Response.json({ error: "planner is temporarily unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "86400" },
        });
      }
      if (path === "/_planner/login" && request.method === "POST") {
        const contentTypeError = requireJsonRequest(request);
        if (contentTypeError) return contentTypeError;
        const limited = await enforceRateLimit(request, env, {
          scope: "planner-login", limit: 5, windowMs: 15 * 60 * 1000,
        });
        if (limited) return limited;
      }
      if (path === "/_planner/data" && ["PUT", "PATCH", "DELETE"].includes(request.method)) {
        if (request.method !== "DELETE") {
          const contentTypeError = requireJsonRequest(request);
          if (contentTypeError) return contentTypeError;
        }
        const limited = await enforceRateLimit(request, env, {
          scope: "planner-write", limit: 60, windowMs: 60 * 1000,
        });
        if (limited) return limited;
      }
      return handlePlanner(request, env, url);
    }

    // 생년월일시는 저장하지 않고 요청 순간에만 명식으로 변환한다.
    // KASI 인증키는 Worker secret에서만 읽으며 브라우저로 전달하지 않는다.
    if (path === "/_fortune/chart") {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const limited = await enforceRateLimit(request, env, {
        scope: "fortune-chart", limit: 10, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      return handleFortuneChart(request, env);
    }

    // 매일 오전 8시(KST) 운세 알림 구독 — 익명 Web Push. GET은 공개키 조회.
    if (path === "/_fortune/push") {
      if (!["GET", "POST", "DELETE"].includes(request.method)) {
        return new Response("method not allowed", {
          status: 405, headers: { Allow: "GET, POST, DELETE" },
        });
      }
      if (request.method !== "GET") {
        const contentTypeError = requireJsonRequest(request);
        if (contentTypeError) return contentTypeError;
        const limited = await enforceRateLimit(request, env, {
          scope: "fortune-push", limit: 20, windowMs: 60 * 1000,
        });
        if (limited) return limited;
      }
      return handleFortunePush(request, env);
    }

    // 아침 브리핑 날씨·미세먼지 (util/brief). 좌표가 아니라 허용된 지역 id만 받고,
    // Open-Meteo 응답은 지역당 10분 캐싱해 상류 무료 API 호출을 묶는다.
    if (path === "/_brief/today") {
      if (request.method !== "GET") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
      }
      const limited = await enforceRateLimit(request, env, {
        scope: "brief-today", limit: 60, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      return handleBriefToday(request, env, url);
    }

    // 아침 브리핑 환율 (util/brief). ECB 고시환율을 30분 캐싱해 그대로 넘긴다.
    if (path === "/_brief/rates") {
      if (request.method !== "GET") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
      }
      const limited = await enforceRateLimit(request, env, {
        scope: "brief-rates", limit: 60, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      return handleBriefRates(request, env);
    }

    // 매일 오전 8시(KST) 날씨 알림 구독 — 익명 Web Push. GET은 공개키 조회.
    if (path === "/_brief/push") {
      if (!["GET", "POST", "DELETE"].includes(request.method)) {
        return new Response("method not allowed", {
          status: 405, headers: { Allow: "GET, POST, DELETE" },
        });
      }
      if (request.method !== "GET") {
        const contentTypeError = requireJsonRequest(request);
        if (contentTypeError) return contentTypeError;
        const limited = await enforceRateLimit(request, env, {
          scope: "brief-push", limit: 20, windowMs: 60 * 1000,
        });
        if (limited) return limited;
      }
      return handleBriefPush(request, env);
    }

    // 국토부 아파트 실거래가 프록시 (estate.bubblelab.dev). 조회 전용이며
    // 지역·기간은 estate.js가 허용 목록으로 고정하고 응답은 Cache API에 캐싱한다.
    if (path === "/_estate/deals") {
      const limited = await enforceRateLimit(request, env, {
        scope: "estate-deals", limit: 120, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      return handleEstateDeals(request, env, url);
    }

    // 공개 페이지 통계 (카테고리 홈의 접속량순 정렬용). 개인 데이터 없음.
    if (path === "/_stats") {
      if (request.method !== "GET") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
      }
      const limited = await enforceRateLimit(request, env, {
        scope: "public-stats", limit: 60, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      const id = env.ANALYTICS.idFromName("global");
      const response = await env.ANALYTICS.get(id).fetch(
        `https://analytics.internal/pages?date=${kstDate()}&days=7`,
      );
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(response.body, { status: response.status, headers });
    }

    if (path === "/_streak" && request.method === "GET") {
      const limited = await enforceRateLimit(request, env, {
        scope: "streak", limit: 30, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      const currentVisitorId = visitorId(request);
      if (!currentVisitorId) return Response.json({ streak: 1 }, { headers: { "Cache-Control": "no-store" } });
      const id = env.ANALYTICS.idFromName("global");
      return env.ANALYTICS.get(id).fetch("https://analytics.internal/streak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: currentVisitorId, date: kstDate() }),
      });
    }

    // 카드 페이지의 활성화면 체류시간. 방문 문서에서 발급한 익명 쿠키만 사용하고
    // 클라이언트가 임의 방문자 ID를 제출하지 못하게 Worker에서 ID를 붙인다.
    if (path === "/_engagement" && request.method === "POST") {
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const limited = await enforceRateLimit(request, env, {
        scope: "engagement", limit: 120, windowMs: 60 * 60 * 1000,
      });
      if (limited) return limited;
      const currentVisitorId = visitorId(request);
      if (!currentVisitorId || cookies(request).bl_notrack === "1") {
        return new Response(null, { status: 204 });
      }
      const body = await request.json().catch(() => ({}));
      const id = env.ANALYTICS.idFromName("global");
      return env.ANALYTICS.get(id).fetch("https://analytics.internal/engage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, visitorId: currentVisitorId, date: kstDate() }),
      });
    }

    // 유효 방문 확정 비콘. 방문 문서에서 발급한 익명 쿠키가 있어야만 기록하므로
    // 쿠키를 버리는 크롤러·격리 브라우저는 JS를 실행해도 유효 방문자가 못 된다.
    if (path === "/_visit" && request.method === "POST") {
      const limited = await enforceRateLimit(request, env, {
        scope: "visit-qualify", limit: 120, windowMs: 60 * 60 * 1000,
      });
      if (limited) return limited;
      const currentVisitorId = visitorId(request);
      if (!currentVisitorId || cookies(request).bl_notrack === "1") {
        return new Response(null, { status: 204 });
      }
      const id = env.ANALYTICS.idFromName("global");
      return env.ANALYTICS.get(id).fetch("https://analytics.internal/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: currentVisitorId, date: kstDate() }),
      });
    }

    // 토이 아이디어 제출 (조회는 admin 전용 /api/suggestions)
    if (path === "/_suggest" && request.method === "POST") {
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const limited = await enforceRateLimit(request, env, {
        scope: "suggestion", limit: 5, windowMs: 60 * 60 * 1000,
      });
      if (limited) return limited;
      const { text, page } = await request.json().catch(() => ({}));
      const id = env.RECORDS.idFromName("global");
      return env.RECORDS.get(id).fetch("https://records.internal/_suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, page, vid: visitorId(request), date: kstDate() }),
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
        const limited = await enforceRateLimit(request, env, {
          scope: "records-read", limit: 120, windowMs: 60 * 1000,
        });
        if (limited) return limited;
        const recordsUrl = new URL(request.url);
        // 개인 기록 조회는 서버가 인증한 방문자 쿠키로만 스코프한다.
        // 클라이언트가 직접 붙인 ?vid=<타인 UUID>는 무시(개인 기록 누출 방지).
        recordsUrl.searchParams.delete("vid");
        const vid = visitorId(request);
        if (vid) recordsUrl.searchParams.set("vid", vid);
        return env.RECORDS.get(id).fetch(new Request(recordsUrl, request));
      }
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const limited = await enforceRateLimit(request, env, {
        scope: "records", limit: 10, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      return env.RECORDS.get(id).fetch(request);
    }

    // puzzle 명예의 전당: 전체 스테이지 총합 랭킹 (조회 공개, 등록은 닉네임 제출)
    if (path === "/_puzzletotal") {
      const id = env.RECORDS.idFromName("global");
      if (request.method === "GET") {
        const limited = await enforceRateLimit(request, env, {
          scope: "puzzletotal-read", limit: 60, windowMs: 60 * 1000,
        });
        if (limited) return limited;
        const vid = visitorId(request);
        return env.RECORDS.get(id).fetch(
          `https://records.internal/_puzzletotal${vid ? `?vid=${encodeURIComponent(vid)}` : ""}`,
        );
      }
      if (request.method === "POST") {
        const contentTypeError = requireJsonRequest(request);
        if (contentTypeError) return contentTypeError;
        const limited = await enforceRateLimit(request, env, {
          scope: "puzzletotal", limit: 10, windowMs: 60 * 1000,
        });
        if (limited) return limited;
        const { nick } = await request.json().catch(() => ({}));
        return env.RECORDS.get(id).fetch("https://records.internal/_puzzletotal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nick, vid: visitorId(request) }),
        });
      }
      return new Response("method not allowed", { status: 405 });
    }

    // 게임 추천(좋아요): 방문자당 게임별 1회. 집계는 공개 조회.
    if (path === "/_like") {
      const id = env.RECORDS.idFromName("global");
      if (request.method === "GET") {
        const limited = await enforceRateLimit(request, env, {
          scope: "like-read", limit: 60, windowMs: 60 * 1000,
        });
        if (limited) return limited;
        const game = new URL(request.url).searchParams.get("game") ?? "";
        return env.RECORDS.get(id).fetch(
          `https://records.internal/_like?game=${encodeURIComponent(game)}`,
        );
      }
      if (request.method === "POST") {
        const contentTypeError = requireJsonRequest(request);
        if (contentTypeError) return contentTypeError;
        const limited = await enforceRateLimit(request, env, {
          scope: "like", limit: 10, windowMs: 60 * 1000,
        });
        if (limited) return limited;
        const { game } = await request.json().catch(() => ({}));
        return env.RECORDS.get(id).fetch("https://records.internal/_like", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game, vid: visitorId(request) }),
        });
      }
      return new Response("method not allowed", { status: 405 });
    }

    if (path === "/_personal" && request.method === "POST") {
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const limited = await enforceRateLimit(request, env, {
        scope: "personal-record", limit: 20, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      const body = await request.json().catch(() => ({}));
      const id = env.RECORDS.idFromName("global");
      return env.RECORDS.get(id).fetch("https://records.internal/_personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, vid: visitorId(request) }),
      });
    }

    // 신규 의뢰 채팅 접수(공개 POST): work의 request 채팅이 보낸 답변을
    // WorkQnaDO("__intake__")에 쌓는다. 이름은 의뢰 ID 규칙([a-z0-9-]) 밖이라
    // 클라이언트 QnA 경로로는 절대 접근되지 않고, 조회는 admin(/api/work)만.
    if (path === "/_workintake") {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const limited = await enforceRateLimit(request, env, {
        scope: "work-intake", limit: 5, windowMs: 10 * 60 * 1000,
      });
      if (limited) return limited;
      const body = await request.json().catch(() => ({}));
      const field = (value, max) => String(value ?? "").trim().slice(0, max);
      const name = field(body.name, 20);
      const contact = field(body.contact, 80);
      const what = field(body.what, 450);
      const when = field(body.when, 60);
      const budget = field(body.budget, 60);
      const note = field(body.note, 200);
      if (!name || !contact || !what) {
        return Response.json({ error: "name, contact, what are required" }, { status: 400 });
      }
      const question = [
        `📦 만들고 싶은 것: ${what}`,
        `🗓️ 희망 일정: ${when || "미정"}`,
        `💰 예산: ${budget || "미정"}`,
        note && `💬 하고 싶은 말: ${note}`,
        `📮 연락처: ${contact}`,
      ].filter(Boolean).join("\n");
      const stub = env.WORK_QNA.get(env.WORK_QNA.idFromName("__intake__"));
      return stub.fetch("https://workqna.internal/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nick: name, product: "신규 의뢰", question }),
      });
    }

    // 외주 프로젝트 QnA: 해당 의뢰 세션(또는 마스터)만 읽고 쓸 수 있고,
    // 답변·삭제는 운영자(마스터) 전용이다.
    if (path.startsWith("/_workqna/")) {
      if (!env.WORK_PASSWORD) {
        return new Response("work preview is not configured", { status: 503 });
      }
      const client = await workSessionClient(await workKeyOf(env), cookies(request).bl_work);
      if (!client) {
        return Response.json({ error: "authentication required" }, { status: 401 });
      }
      const [project, action = ""] = path.slice("/_workqna/".length).split("/");
      if (!/^[a-z0-9-]{1,32}$/.test(project) || !["", "ask", "answer", "delete"].includes(action)) {
        return new Response("not found", { status: 404 });
      }
      if (client !== "*" && client !== project) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      if (["answer", "delete"].includes(action) && client !== "*") {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      if (request.method === "POST") {
        const contentTypeError = requireJsonRequest(request);
        if (contentTypeError) return contentTypeError;
        const limited = await enforceRateLimit(request, env, {
          scope: "workqna-write", limit: 10, windowMs: 10 * 60 * 1000,
        });
        if (limited) return limited;
      } else if (request.method !== "GET") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
      }
      const id = env.WORK_QNA.idFromName(project);
      return env.WORK_QNA.get(id).fetch(`https://workqna.internal/${action}`, {
        method: request.method,
        ...(request.method === "POST" && {
          headers: { "Content-Type": "application/json" }, body: await request.text(),
        }),
      });
    }

    // AI 이모티콘 생성 프록시 (work/emoticon CLI의 edge 프로바이더 전용).
    // Gemini 키가 GEMINI_STICKER_KEY Worker secret에만 있으므로 엣지가 대신
    // 호출한다. work 마스터(비밀번호 Bearer 또는 마스터 세션 쿠키)만 쓸 수
    // 있고, 키·비밀번호 미설정이면 fail-closed. 키는 응답에 노출되지 않는다.
    if (path === "/_emoticon/generate") {
      if (!env.WORK_PASSWORD || !env.GEMINI_STICKER_KEY) {
        return new Response("emoticon generator is not configured", {
          status: 503, headers: { "Cache-Control": "no-store" },
        });
      }
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const key = await workKeyOf(env);
      const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const master = bearer
        ? await matchesCredential(key, bearer, env.WORK_PASSWORD)
        : (await workSessionClient(key, cookies(request).bl_work)) === "*";
      if (!master) {
        return Response.json({ error: "authentication required" }, {
          status: 401, headers: { "Cache-Control": "no-store" },
        });
      }
      // 호출당 과금이므로 마스터 인증 뒤에도 폭주를 막는다 (60회/10분 ≈ 컷 5개)
      const limited = await enforceRateLimit(request, env, {
        scope: "emoticon-generate", limit: 60, windowMs: 10 * 60 * 1000,
      });
      if (limited) return limited;
      let payload;
      try { payload = await request.json(); } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const prompt = String(payload?.prompt ?? "").trim();
      const references = Array.isArray(payload?.references) ? payload.references : [];
      if (!prompt || prompt.length > EMOTICON_MAX_PROMPT
        || references.length > EMOTICON_MAX_REFERENCES
        || references.some((r) => typeof r !== "string" || !/^[A-Za-z0-9+/=]+$/.test(r))) {
        return Response.json({ error: "invalid payload" }, { status: 400 });
      }
      try {
        const bytes = await geminiGenerate({
          apiKey: env.GEMINI_STICKER_KEY,
          model: env.EMOTICON_IMAGE_MODEL || undefined,
          prompt,
          referencesB64: references,
        });
        return new Response(bytes, {
          headers: {
            "Content-Type": bytes[0] === 0xff ? "image/jpeg" : "image/png",
            "Cache-Control": "no-store",
          },
        });
      } catch (error) {
        return Response.json({ error: String(error?.message ?? error) }, {
          status: 502, headers: { "Cache-Control": "no-store" },
        });
      }
    }

    // 컷별 사람 검수 댓글. 자동 게이트가 못 잡는 "지시대로 움직였는가"를
    // 컷 id에 붙여 남긴다. 읽기는 공개(Actions가 secret 없이 끌어가 리포에
    // 커밋한다), 쓰기는 work 마스터만.
    if (path === "/_emoticon/review") {
      const id = env.EMOTICON_REVIEW.idFromName("board");
      const stub = env.EMOTICON_REVIEW.get(id);
      if (request.method === "GET") {
        const limited = await enforceRateLimit(request, env, {
          scope: "emoticon-review-read", limit: 120, windowMs: 60 * 1000,
        });
        if (limited) return limited;
        return stub.fetch("https://emoticon-review.internal/");
      }
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
      }
      if (!env.WORK_PASSWORD) {
        return new Response("emoticon review board is not configured", {
          status: 503, headers: { "Cache-Control": "no-store" },
        });
      }
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
      const key = await workKeyOf(env);
      if ((await workSessionClient(key, cookies(request).bl_work)) !== "*") {
        return Response.json({ error: "authentication required" }, {
          status: 401, headers: { "Cache-Control": "no-store" },
        });
      }
      const limited = await enforceRateLimit(request, env, {
        scope: "emoticon-review-write", limit: 30, windowMs: 10 * 60 * 1000,
      });
      if (limited) return limited;
      const requested = new URL(request.url).searchParams.get("action");
      const action = ["delete", "verdict"].includes(requested) ? requested : "add";
      return stub.fetch(`https://emoticon-review.internal/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
      });
    }

    // 외주 프로젝트 상품 리뷰(읽기 전용): 커머스 API에서 동기화된 캐시를 노출.
    // 품목별 상세페이지가 이 데이터를 읽어 렌더한다. 페이지가 work 게이트
    // 안에서 동작하므로 동일 세션을 요구한다.
    if (path.startsWith("/_workreviews/")) {
      if (!env.WORK_PASSWORD) {
        return new Response("work preview is not configured", { status: 503 });
      }
      const client = await workSessionClient(await workKeyOf(env), cookies(request).bl_work);
      if (!client) {
        return Response.json({ error: "authentication required" }, { status: 401 });
      }
      const [project, action = ""] = path.slice("/_workreviews/".length).split("/");
      if (!/^[a-z0-9-]{1,32}$/.test(project) || !["", "submit"].includes(action)) {
        return new Response("not found", { status: 404 });
      }
      if (client !== "*" && client !== project) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      const stub = env.WORK_REVIEWS.get(env.WORK_REVIEWS.idFromName(project));

      // 후기 작성: 사용자가 남긴 후기를 DO에 저장한다(동기화분과 분리 보존).
      if (action === "submit") {
        if (request.method !== "POST") {
          return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
        }
        const contentTypeError = requireJsonRequest(request);
        if (contentTypeError) return contentTypeError;
        const limited = await enforceRateLimit(request, env, {
          scope: "workreviews-write", limit: 10, windowMs: 10 * 60 * 1000,
        });
        if (limited) return limited;
        return stub.fetch("https://workreviews.internal/submit", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text(),
        });
      }

      if (request.method !== "GET") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
      }
      let data = await (await stub.fetch("https://workreviews.internal/")).json();
      // 최초 조회 또는 캐시 구조가 옛 버전이면 재동기화(mock/live)해 즉시 채운다.
      // 이후엔 cron이 갱신. (버전 체크로 배포 후 옛 캐시가 남는 문제 방지.)
      if (data.version !== REVIEWS_SYNC_VERSION) {
        const synced = await fetchStoreReviews(env, project).catch(() => null);
        if (synced && synced.items.length) {
          await stub.fetch("https://workreviews.internal/sync", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(synced),
          });
          data = { ...synced, submitted: data.submitted ?? [] };
        }
      }
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    }

    // 데일리 팟캐스트 (podcast.bubblelab.dev). 초대 코드 로그인 뒤에만
    // 쓸 수 있고, ENABLE_PODCAST가 없으면 fail-closed로 닫힌다.
    if (path.startsWith("/_podcast/")) {
      if (!featureEnabled(env, "ENABLE_PODCAST")) {
        return Response.json({ error: "podcast is temporarily unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "86400" },
        });
      }
      return handlePodcast(request, env, url);
    }

    // 익명 채팅 로비: /_chat → 단일 Durable Object (util.bubblelab.dev/chat).
    // 메시지는 서버에 저장하지 않고 접속자에게만 브로드캐스트한다.
    if (path === "/_chat") {
      if (!featureEnabled(env, "ENABLE_CHAT")) {
        return Response.json({ error: "chat is temporarily unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "86400" },
        });
      }
      const originError = validateWebSocketOrigin(request);
      if (originError) return originError;
      const limited = await enforceRateLimit(request, env, {
        scope: "chat-connect", limit: 20, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      const id = env.CHAT.idFromName("lobby");
      return env.CHAT.get(id).fetch(request);
    }

    // 실시간 데이터 서버: /_rt/<이름> → 이름당 Durable Object 하나.
    // 임의 이름 폭주로 DO가 무한 생성되지 않게 형식·길이를 제한한다.
    if (path.startsWith("/_rt/")) {
      if (!featureEnabled(env, "ENABLE_REALTIME")) {
        return Response.json({ error: "realtime experiments are temporarily unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "86400" },
        });
      }
      const name = path.slice("/_rt/".length).split("/")[0];
      if (!REALTIME_NAMESPACES.has(name)) {
        return new Response("invalid name", { status: 400 });
      }
      const originError = validateWebSocketOrigin(request);
      if (originError) return originError;
      const limited = await enforceRateLimit(request, env, {
        scope: `realtime-connect:${name}`, limit: 20, windowMs: 60 * 1000,
      });
      if (limited) return limited;
      const id = env.REALTIME.idFromName(name);
      return env.REALTIME.get(id).fetch(request);
    }

    // Duri 실시간 중계 + 사진 버퍼: /_duri (work.bubblelab.dev/duri 전용).
    // 서버는 E2E 암호블롭만 중계·버퍼링하고, 데스크톱 싱크가 받아 ack 하면 폐기한다.
    if (path === "/_duri" || path.startsWith("/_duri/")) {
      return handleDuri(request, env, url);
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

    // 폴더 이름을 바꾸면 예전 주소로 온 사람(북마크·공유 링크)이 404를 만난다.
    // 옮긴 자리만 알려주고 끝낸다 — 페이지를 남겨 두면 두 벌을 관리하게 된다.
    const moved = MOVED_PATHS.get(`${site}:${path.replace(/\/+$/, "") || "/"}`);
    if (moved) {
      // 서브도메인 접속은 공개 URL에 site 세그먼트가 없고, 로컬 경로 라우팅은 있다.
      const hostBased = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`);
      // 301 — 자리가 영구히 바뀐 것이라 브라우저·검색엔진이 기억해도 된다.
      return new Response(null, {
        status: 301,
        headers: { Location: hostBased ? moved : `/${site}${moved}` },
      });
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

    if (site === "work") {
      // 비밀번호 미설정이면 fail-closed. 미리보기 공개 전까지 검색·외부 접근을 막는다.
      if (!env.WORK_PASSWORD) {
        return new Response("work preview is not configured", { status: 503 });
      }
      const isProdHost = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`);
      const workUrl = new URL(url);
      workUrl.pathname = path || "/";
      const workResponse = await handleWork(request, env, workUrl, isProdHost ? "" : "/work");
      if (workResponse) return workResponse;
    }

    if (site === "duri") {
      // DURI_PASSWORD(없으면 WORK_PASSWORD 폴백)로 게이팅하되 세션은 별도(bl_duri)·
      // 장수명이다. 미설정이면 fail-closed. /_duri 릴레이는 위에서 이미 처리된다.
      if (!duriPassword(env)) {
        return new Response("duri is not configured", { status: 503 });
      }
      const isProdHost = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`);
      const duriUrl = new URL(url);
      duriUrl.pathname = path || "/";
      const duriResponse = await handleDuriGate(request, env, duriUrl, isProdHost ? "" : "/duri");
      if (duriResponse) return duriResponse;
    }

    url.pathname = `/${site}${path}`;
    let response = await env.ASSETS.fetch(new Request(url, request));

    // host 기반(서브도메인) 요청은 공개 URL에 site 세그먼트가 없다. 에셋 서버가
    // .html→확장자 제거·트레일링 슬래시 등으로 돌려주는 redirect의 Location에는
    // 내부 경로(/${site}/…)가 담기므로, 그 프리픽스를 떼지 않으면 브라우저가
    // /work/work/… 처럼 이중 프리픽스로 이동해 404가 난다. (로컬 경로 기반
    // 라우팅에서는 site가 URL에 남아 있어 그대로 두어야 한다.)
    const hostBased = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`);
    if (hostBased && response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (location) {
        const target = new URL(location, url);
        if (target.host === url.host && target.pathname.startsWith(`/${site}/`)) {
          target.pathname = target.pathname.slice(`/${site}`.length);
          const headers = new Headers(response.headers);
          headers.set("Location", target.pathname + target.search + target.hash);
          response = new Response(response.body, {
            status: response.status, statusText: response.statusText, headers,
          });
        }
      }
    }

    if (["admin", "work", "estate", "duri", "invest"].includes(site)) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    // HTML 문서 방문만 집계한다. IP/UA는 저장하지 않고 익명 쿠키 ID만 사용한다.
    // 페이지별 인기 집계를 위해 문서마다 보낸다 (DO 쓰기는 방문자별 key라 멱등).
    // 봇 부풀리기 방지: 실제 브라우저 내비게이션에만 붙는 Sec-Fetch-Dest를
    // 요구하고, 크롤러/미리보기/스크립트류 User-Agent는 집계에서 뺀다.
    const ua = request.headers.get("User-Agent") ?? "";
    const isBot = !ua ||
      /bot|crawl|spider|scrap|preview|scan|monitor|headless|lighthouse|externalhit|curl|wget|python|java|okhttp|node|undici|axios|libwww|httpclient|ruby|php|perl|postman|insomnia/i.test(ua);
    const isDocument = request.headers.get("Sec-Fetch-Dest") === "document";
    // bl_notrack: 운영자가 /_optout에서 켠 브라우저는 집계·쿠키 발급 모두 건너뛴다.
    const optedOut = cookies(request).bl_notrack === "1";
    if (!["admin", "work", "estate"].includes(site) && isDocument && !isBot && !optedOut && response.ok &&
        response.headers.get("Content-Type")?.includes("text/html")) {
      const date = kstDate();
      const jar = cookies(request);
      const currentVisitorId = VISITOR_ID.test(jar.bl_vid ?? "") ? jar.bl_vid : crypto.randomUUID();
      const segment = path.split("/").filter(Boolean)[0];
      const page = (segment ? `${site}/${segment}` : site).toLowerCase();
      const id = env.ANALYTICS.idFromName("global");
      ctx.waitUntil((async () => {
        const result = await consumeRateLimit(request, env, {
          scope: "page-view", limit: 120, windowMs: 60 * 60 * 1000,
        });
        if (!result.allowed) return;
        await env.ANALYTICS.get(id).fetch("https://analytics.internal/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId: currentVisitorId, date, page }),
        });
      })().catch(() => {}));
      const headers = new Headers(response.headers);
      const domain = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)
        ? `; Domain=${ROOT_DOMAIN}; Secure` : "";
      headers.append("Set-Cookie", `bl_vid=${currentVisitorId}; Path=/; HttpOnly; Max-Age=31536000; SameSite=Lax${domain}`);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
}

// 외주 프로젝트 리뷰 동기화 (cron). 판매자 자격증명이 없으면 mock으로 캐시를
// 채우고, 있으면 커머스 API 결과로 갱신한다. 한 프로젝트가 실패해도 계속 진행.
async function syncWorkReviews(env) {
  if (!env.WORK_REVIEWS) return;
  for (const project of WORK_REVIEW_PROJECTS) {
    try {
      const synced = await fetchStoreReviews(env, project);
      if (!synced.items.length) continue;
      const stub = env.WORK_REVIEWS.get(env.WORK_REVIEWS.idFromName(project));
      await stub.fetch("https://workreviews.internal/sync", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(synced),
      });
    } catch (error) {
      console.error("work review sync failed", project, error);
    }
  }
}

export default {
  // cron 처리 (wrangler.jsonc triggers.crons):
  //  22:00 KST(13:00 UTC) → 팟캐스트 저녁 리마인더
  //  08:00 KST(23:00 UTC) → 운세 데일리 알림 + 아침 브리핑(날씨) 알림
  //  06:40 KST(21:40 UTC) → 외주 리뷰 동기화 + 데일리 팟캐스트 생성
  async scheduled(controller, env, ctx) {
    const podcastReady = featureEnabled(env, "ENABLE_PODCAST") && env.PODCAST_BUCKET;
    if (controller.cron === "0 13 * * *") {
      if (podcastReady) ctx.waitUntil(runEveningReminder(env));
      return;
    }
    if (controller.cron === "0 23 * * *") {
      if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        ctx.waitUntil(sendFortuneDaily(env));
        ctx.waitUntil(sendBriefDaily(env));
      }
      return;
    }
    ctx.waitUntil(syncWorkReviews(env));
    if (podcastReady) ctx.waitUntil(runDailyGeneration(env));
  },
  async fetch(request, env, ctx) {
    try {
      return applySecurityHeaders(await handleRequest(request, env, ctx), request);
    } catch (error) {
      console.error("unhandled worker request", error);
      return applySecurityHeaders(
        Response.json({ error: "internal server error" }, {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        }),
        request,
      );
    }
  },
};
