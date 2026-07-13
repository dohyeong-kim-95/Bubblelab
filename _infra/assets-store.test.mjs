import assert from "node:assert/strict";
import test from "node:test";
import { detectImageType, handleAdminAssets, publicAsset } from "./assets-store.js";

class MemoryBucket {
  constructor() { this.objects = new Map(); }
  async put(key, value, options = {}) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
  }
  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { text: async () => new TextDecoder().decode(stored.bytes) };
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
}

test("detects supported image signatures rather than trusting a filename", () => {
  assert.equal(detectImageType(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])).contentType, "image/png");
  assert.equal(detectImageType(Uint8Array.from([0xff,0xd8,0xff])).extension, "jpg");
  assert.equal(detectImageType(new TextEncoder().encode("GIF89a")).extension, "gif");
  assert.equal(detectImageType(new TextEncoder().encode("not an image")), null);
});

test("public catalog strips internal R2 object keys", () => {
  const item = publicAsset({
    id: "a-test-1234", category: "sticker", title: "테스트", description: "", tags: [],
    preview: "/_assets/upload/sticker/a-test-1234/image-1.png", createdAt: "2026-07-14", active: true,
    downloads: [{ label: "PNG", file: "image-1.png", url: "/image.png", key: "private-key" }],
  });
  assert.equal(item.downloads[0].key, undefined);
  assert.equal(item.downloads[0].label, "PNG");
});

test("admin upload stores a validated image and updates the catalog", async () => {
  const bucket = new MemoryBucket();
  const form = new FormData();
  form.set("category", "sticker");
  form.set("title", "테스트 스티커");
  form.set("labels", JSON.stringify(["투명 PNG"]));
  form.append("files", new File([
    Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  ], "fake.txt", { type: "text/plain" }));
  const request = new Request("https://admin.bubblelab.dev/api/assets", { method: "POST", body: form });
  const response = await handleAdminAssets(request, { UPLOADED_ASSETS: bucket }, new URL(request.url));
  assert.equal(response.status, 201);
  const { item } = await response.json();
  assert.equal(item.category, "sticker");
  assert.equal(item.downloads[0].file, "image-1.png");
  assert.ok(bucket.objects.has(item.downloads[0].key));
  assert.ok(bucket.objects.has("catalog.json"));
});
