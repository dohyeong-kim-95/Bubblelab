const CATEGORIES = new Set(["wallpaper", "sticker", "photo-frame"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 4;
const CATALOG_KEY = "catalog.json";

export function detectImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { extension: "png", contentType: "image/png" };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  if (b.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...b.slice(0, 6)))) {
    return { extension: "gif", contentType: "image/gif" };
  }
  return null;
}

const cleanText = (value, max) => String(value || "").trim().replace(/[\x00-\x08\x0b-\x1f]/g, "").slice(0, max);

async function readCatalog(bucket) {
  const object = await bucket.get(CATALOG_KEY);
  if (!object) return [];
  try {
    const data = JSON.parse(await object.text());
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

async function writeCatalog(bucket, items) {
  await bucket.put(CATALOG_KEY, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items }), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

export function publicAsset(item) {
  return {
    id: item.id, category: item.category, title: item.title,
    description: item.description, tags: item.tags, preview: item.preview,
    downloads: item.downloads.map(({ label, file, url }) => ({ label, file, url })),
    createdAt: item.createdAt, active: item.active !== false,
  };
}

export async function handleAdminAssets(request, env, url) {
  const bucket = env.UPLOADED_ASSETS;
  if (!bucket) return Response.json({ error: "asset storage is not configured" }, { status: 503 });

  if (request.method === "GET") {
    return Response.json({ items: await readCatalog(bucket) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    if (!/^[a-z0-9-]{8,64}$/.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
    const items = await readCatalog(bucket);
    const item = items.find((entry) => entry.id === id);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    await bucket.delete([...new Set(item.downloads.map((entry) => entry.key).filter(Boolean))]);
    await writeCatalog(bucket, items.filter((entry) => entry.id !== id));
    return new Response(null, { status: 204 });
  }

  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "invalid form" }, { status: 400 });
  const category = String(form.get("category") || "");
  const title = cleanText(form.get("title"), 50);
  const description = cleanText(form.get("description"), 200);
  const tags = cleanText(form.get("tags"), 120).split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  const files = form.getAll("files").filter((file) => file instanceof File && file.size > 0);
  let labels = [];
  try { labels = JSON.parse(String(form.get("labels") || "[]")); } catch {}
  if (!CATEGORIES.has(category) || !title) return Response.json({ error: "category and title are required" }, { status: 400 });
  if (!files.length || files.length > MAX_FILES) return Response.json({ error: `1-${MAX_FILES} images required` }, { status: 400 });

  const id = `a-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const uploaded = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (file.size > MAX_FILE_SIZE) throw new Error("각 이미지는 10MB 이하여야 합니다.");
      const buffer = await file.arrayBuffer();
      const type = detectImageType(new Uint8Array(buffer).slice(0, 16));
      if (!type) throw new Error("PNG, JPG, WebP, GIF 이미지만 올릴 수 있습니다.");
      const filename = `image-${index + 1}.${type.extension}`;
      const key = `upload/${category}/${id}/${filename}`;
      await bucket.put(key, buffer, {
        httpMetadata: { contentType: type.contentType, cacheControl: "public, max-age=31536000, immutable" },
      });
      uploaded.push({
        label: cleanText(labels[index], 30) || (files.length === 1 ? "다운로드" : `파일 ${index + 1}`),
        file: filename, key, url: `/_assets/${key}`,
      });
    }
    const item = {
      id, category, title, description, tags,
      preview: uploaded[0].url, downloads: uploaded,
      createdAt: new Date().toISOString().slice(0, 10), active: true,
    };
    const items = await readCatalog(bucket);
    items.unshift(item);
    await writeCatalog(bucket, items);
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    if (uploaded.length) await bucket.delete(uploaded.map((entry) => entry.key));
    return Response.json({ error: error.message || "upload failed" }, { status: 400 });
  }
}

export async function serveUploadedAsset(request, env, path) {
  if (!env.UPLOADED_ASSETS || request.method !== "GET") return new Response("not found", { status: 404 });
  const key = path.slice("/_assets/".length);
  if (!/^upload\/(wallpaper|sticker|photo-frame)\/[a-z0-9-]+\/[a-z0-9.-]+$/.test(key)) {
    return new Response("not found", { status: 404 });
  }
  const object = await env.UPLOADED_ASSETS.get(key, { range: request.headers });
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

export async function serveMergedCatalog(request, env) {
  const staticResponse = await env.ASSETS.fetch(request);
  const staticCatalog = staticResponse.ok ? await staticResponse.json().catch(() => ({ items: [] })) : { items: [] };
  const uploaded = env.UPLOADED_ASSETS ? await readCatalog(env.UPLOADED_ASSETS) : [];
  return Response.json({
    version: 1, generatedAt: new Date().toISOString(),
    items: [...uploaded.filter((item) => item.active !== false).map(publicAsset), ...(staticCatalog.items || [])],
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
