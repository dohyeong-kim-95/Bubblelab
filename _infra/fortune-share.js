// 만화 사주 다운로드 링크 — 화면에 그려지지 않는 서버 코드라 fortune.js(글꼴 조각 검사 대상)와 떼어 둔다.
import { secretMatches } from "./papers.js";

const fortuneStub = (env) => env.FORTUNE.get(env.FORTUNE.idFromName("global"));

// ── 만화 사주 다운로드 링크 ── 인스타 DM 으로 받은 신청은 메일 대신 링크로 준다.
// 주소는 util.bubblelab.dev/fortune/get/#<토큰> — 토큰을 # 뒤에 둬서 서버 로그·Referer 로 새지 않게 한다.
// 파일은 R2(FORTUNE_BUCKET) share/<토큰>/<파일>, 목록·만료는 FortuneDO. 7일 지나면 지운다.
export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SHARE_FILES = ["saju-01.jpg", "saju-02.jpg", "saju-03.jpg", "saju-04.jpg", "saju-05.jpg", "saju-06.jpg", "saju_comic.pdf", "comic.zip"];
const SHARE_MAX_BYTES = 12 * 1024 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const shareType = (file) => file.endsWith(".pdf") ? "application/pdf" : file.endsWith(".zip") ? "application/zip" : "image/jpeg";

function newShareToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 *   POST   /_fortune/share                      (Bearer COMIC_SINK_SECRET) {title} → { token, expires }
 *   PUT    /_fortune/share/<토큰>/<파일>          (Bearer) 파일 올리기(SHARE_FILES 만)
 *   DELETE /_fortune/share/<토큰>                (Bearer) 바로 지우기
 *   GET    /_fortune/share/<토큰>                → { title, files, expires } | 410
 *   GET    /_fortune/share/<토큰>/<파일>          → 파일 | 410
 */
export async function handleFortuneShare(request, env, url) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!env.FORTUNE_BUCKET) return json({ error: "not configured" }, 503);
  const m = /^\/_fortune\/share(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(url.pathname);
  if (!m) return json({ error: "not found" }, 404);
  const [, token, file] = m;
  if (token && !TOKEN_RE.test(token)) return json({ error: "not found" }, 404);
  if (file && !SHARE_FILES.includes(file)) return json({ error: "not found" }, 404);
  const stub = fortuneStub(env);
  const meta = async () => {
    const res = await stub.fetch(`https://fortune.internal/share/get/${token}`);
    return res.ok ? res.json() : null;
  };
  const authed = () => {
    if (!env.COMIC_SINK_SECRET) return false;
    return secretMatches((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env.COMIC_SINK_SECRET);
  };

  if (request.method === "GET") {
    if (!token) return json({ error: "not found" }, 404);
    const item = await meta();
    if (!item) return json({ error: "gone" }, 410);
    if (!file) return json({ title: item.title, files: item.files, expires: item.expires });
    if (!item.files.includes(file)) return json({ error: "not found" }, 404);
    const obj = await env.FORTUNE_BUCKET.get(`share/${token}/${file}`);
    if (!obj) return json({ error: "gone" }, 410);
    const name = file === "comic.zip" ? "만화사주.zip" : file === "saju_comic.pdf" ? "만화사주.pdf" : file;
    return new Response(obj.body, { headers: {
      "Content-Type": shareType(file), "Cache-Control": "private, no-store",
      "Content-Disposition": `${file.endsWith(".jpg") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Robots-Tag": "noindex",
    } });
  }
  if (!authed()) return json({ error: "unauthorized" }, env.COMIC_SINK_SECRET ? 401 : 503);
  if (request.method === "POST" && !token) {
    const body = await request.json().catch(() => ({}));
    const title = String(body?.title ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 60);
    const res = await stub.fetch("https://fortune.internal/share/create", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: newShareToken(), title }),
    });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (request.method === "PUT" && token && file) {
    if (+(request.headers.get("Content-Length") ?? 0) > SHARE_MAX_BYTES) return json({ error: "too-large" }, 413);
    const item = await meta();
    if (!item) return json({ error: "gone" }, 410);
    const data = await request.arrayBuffer();
    if (data.byteLength > SHARE_MAX_BYTES || data.byteLength === 0) return json({ error: "size" }, 413);
    await env.FORTUNE_BUCKET.put(`share/${token}/${file}`, data, { httpMetadata: { contentType: shareType(file) } });
    await stub.fetch(`https://fortune.internal/share/file/${token}`, { method: "POST", body: file });
    return json({ ok: true });
  }
  if (request.method === "DELETE" && token && !file) {
    await removeShare(env, token);
    await stub.fetch(`https://fortune.internal/share/delete/${token}`, { method: "POST" });
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}

async function removeShare(env, token) {
  const listed = await env.FORTUNE_BUCKET.list({ prefix: `share/${token}/` });
  for (const o of listed.objects ?? []) await env.FORTUNE_BUCKET.delete(o.key);
}

export async function shareInDO(storage, env, request, url) {
  const [, , action, token] = url.pathname.split("/");
  const now = Date.now();
  if (action === "create" && request.method === "POST") {
    const { token: t, title } = await request.json();
    // 만들 때마다 기한 지난 링크를 치운다(R2 파일까지). 버킷 수명 규칙이 한 번 더 받친다.
    for (const [key, item] of await storage.list({ prefix: "share:" })) {
      if (item.expires <= now) { await removeShare(env, item.token); await storage.delete(key); }
    }
    const item = { token: t, title, files: [], created: now, expires: now + SHARE_TTL_MS };
    await storage.put(`share:${t}`, item);
    return Response.json({ token: t, expires: item.expires });
  }
  const key = `share:${token}`;
  const item = await storage.get(key);
  if (action === "get") {
    if (!item) return new Response("gone", { status: 410 });
    if (item.expires <= now) {
      await removeShare(env, token); await storage.delete(key);
      return new Response("gone", { status: 410 });
    }
    return Response.json(item);
  }
  if (action === "file" && request.method === "POST" && item) {
    const file = await request.text();
    if (SHARE_FILES.includes(file) && !item.files.includes(file)) {
      item.files.push(file); item.files.sort(); await storage.put(key, item);
    }
    return Response.json({ ok: true });
  }
  if (action === "delete" && request.method === "POST") { await storage.delete(key); return Response.json({ ok: true }); }
  return new Response("not found", { status: 404 });
}
