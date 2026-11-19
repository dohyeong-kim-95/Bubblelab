import { consumeRateLimit } from "./security.js";

const ASSET_CATEGORIES = new Set(["sticker", "wallpaper", "photo-frame", "music"]);
const SAFE_PART = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function parseAssetDownloadPath(pathname) {
  if (!pathname.startsWith("/_download/")) return null;
  const encoded = pathname.slice("/_download/".length).split("/");
  if (encoded.length !== 3) return null;

  let category;
  let id;
  let file;
  try {
    [category, id, file] = encoded.map(decodeURIComponent);
  } catch {
    return null;
  }

  if (!ASSET_CATEGORIES.has(category) || !SAFE_PART.test(id) || !SAFE_PART.test(file)) return null;
  return { category, id, file };
}

export function downloadContentDisposition(file) {
  const fallback = file.replace(/[^a-z0-9._-]/gi, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

export async function serveAssetDownload(request, env, ctx, url) {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
  }
  const asset = parseAssetDownloadPath(url.pathname);
  if (!asset) return new Response("not found", { status: 404 });

  const assetUrl = new URL(url);
  assetUrl.pathname = `/_assets/${asset.category}/${asset.id}/${asset.file}`;
  assetUrl.search = "";
  // Range 재요청이 한 번의 다운로드를 여러 번 세지 않도록 전체 파일을 한 번 응답한다.
  const response = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
  if (!response.ok) return response;

  // 동일 IP의 같은 파일은 하루에 한 번만 집계한다. 실제 다운로드는 막지
  // 않으므로 공유기/NAT 환경에서도 사용성은 유지되고, 카운터 반복 호출만 줄인다.
  let shouldCount = false;
  try {
    const result = await consumeRateLimit(request, env, {
      scope: `asset-download:${asset.category}/${asset.id}/${asset.file}`,
      limit: 1,
      windowMs: 24 * 60 * 60 * 1000,
    });
    shouldCount = result.allowed;
  } catch {
    // 통계 인프라 장애가 파일 다운로드 자체를 실패시키지 않게 한다.
  }
  if (shouldCount) {
    const analyticsId = env.ANALYTICS.idFromName("global");
    ctx.waitUntil(env.ANALYTICS.get(analyticsId).fetch("https://analytics.internal/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(asset),
    }));
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Disposition", downloadContentDisposition(asset.file));
  return new Response(response.body, { status: response.status, headers });
}

export async function serveAssetDownloadCounts(env) {
  const analyticsId = env.ANALYTICS.idFromName("global");
  const response = await env.ANALYTICS.get(analyticsId).fetch("https://analytics.internal/downloads");
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=30");
  return new Response(response.body, { status: response.status, headers });
}
