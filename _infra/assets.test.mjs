import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { generateAssetCatalog } from "./assets.js";

test("asset catalog is generated from item metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "bubblelab-assets-"));
  const item = join(root, "sticker", "hello-bear");
  mkdirSync(item, { recursive: true });
  writeFileSync(join(item, "preview.webp"), "preview");
  writeFileSync(join(item, "sticker.png"), "download");
  writeFileSync(join(item, "metadata.json"), JSON.stringify({
    title: "안녕 곰돌이", preview: "preview.webp", createdAt: "2026-07-14",
    downloads: [{ label: "투명 PNG", file: "sticker.png" }],
  }));

  const items = generateAssetCatalog(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "hello-bear");
  assert.equal(items[0].preview, "/_assets/sticker/hello-bear/preview.webp");
  assert.equal(items[0].downloads[0].url, "/_assets/sticker/hello-bear/sticker.png");
});

test("music assets support a video preview and audio download", () => {
  const root = mkdtempSync(join(tmpdir(), "bubblelab-assets-"));
  const item = join(root, "music", "upward-drift");
  mkdirSync(item, { recursive: true });
  writeFileSync(join(item, "upward_drift_preview.webp"), "preview");
  writeFileSync(join(item, "upward_drift.mp3"), "audio");
  writeFileSync(join(item, "metadata.json"), JSON.stringify({
    title: "Upward Drift", preview: "upward_drift_preview.webp", createdAt: "2026-07-17",
    downloads: [{ label: "MP3", file: "upward_drift.mp3" }],
  }));

  const [music] = generateAssetCatalog(root);
  assert.equal(music.category, "music");
  assert.equal(music.preview, "/_assets/music/upward-drift/upward_drift_preview.webp");
  assert.equal(music.downloads[0].url, "/_assets/music/upward-drift/upward_drift.mp3");
});

test("inactive assets are kept out of the public catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "bubblelab-assets-"));
  const item = join(root, "wallpaper", "hidden");
  mkdirSync(item, { recursive: true });
  writeFileSync(join(item, "preview.webp"), "preview");
  writeFileSync(join(item, "mobile.webp"), "download");
  writeFileSync(join(item, "metadata.json"), JSON.stringify({
    title: "숨김", preview: "preview.webp", active: false,
    downloads: [{ file: "mobile.webp" }],
  }));
  assert.deepEqual(generateAssetCatalog(root), []);
});

test("wallpaper downloads carry the device tab classification", () => {
  const root = mkdtempSync(join(tmpdir(), "bubblelab-assets-"));
  const item = join(root, "wallpaper", "night-sky");
  mkdirSync(item, { recursive: true });
  for (const file of ["preview.jpg", "mobile.png", "desktop.png", "square.png"]) {
    writeFileSync(join(item, file), "image");
  }
  const metadata = {
    title: "밤하늘", preview: "preview.jpg", createdAt: "2026-08-06",
    downloads: [
      { label: "모바일", file: "mobile.png", device: "mobile" },
      { label: "PC", file: "desktop.png", device: "desktop" },
      { label: "정사각", file: "square.png" },
    ],
  };
  writeFileSync(join(item, "metadata.json"), JSON.stringify(metadata));

  const [wallpaper] = generateAssetCatalog(root);
  assert.deepEqual(wallpaper.downloads.map((d) => d.device), ["mobile", "desktop", undefined]);

  // 오타는 조용히 넘어가지 않는다 (탭에서 통째로 사라지는 사고 방지)
  writeFileSync(join(item, "metadata.json"), JSON.stringify({
    ...metadata,
    downloads: [{ label: "모바일", file: "mobile.png", device: "phone" }],
  }));
  assert.throws(() => generateAssetCatalog(root), /device must be/);
});

test("previewSize is passed through and half-written values are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "bubblelab-assets-"));
  const item = join(root, "wallpaper", "tall-one");
  mkdirSync(item, { recursive: true });
  writeFileSync(join(item, "preview.jpg"), "preview");
  writeFileSync(join(item, "mobile.png"), "image");
  const base = {
    title: "세로", preview: "preview.jpg", createdAt: "2026-08-06",
    downloads: [{ label: "모바일", file: "mobile.png", device: "mobile" }],
  };
  writeFileSync(join(item, "metadata.json"), JSON.stringify({ ...base, previewSize: { width: 369, height: 800 } }));
  assert.deepEqual(generateAssetCatalog(root)[0].previewSize, { width: 369, height: 800 });

  writeFileSync(join(item, "metadata.json"), JSON.stringify(base));
  assert.equal(generateAssetCatalog(root)[0].previewSize, undefined, "없으면 카테고리 기본 비율로");

  writeFileSync(join(item, "metadata.json"), JSON.stringify({ ...base, previewSize: { width: 369 } }));
  assert.throws(() => generateAssetCatalog(root), /previewSize must be/);
});
