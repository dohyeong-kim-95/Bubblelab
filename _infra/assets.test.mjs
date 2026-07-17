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
  writeFileSync(join(item, "upward_drift.mp4"), "preview");
  writeFileSync(join(item, "upward_drift.mp3"), "audio");
  writeFileSync(join(item, "metadata.json"), JSON.stringify({
    title: "Upward Drift", preview: "upward_drift.mp4", createdAt: "2026-07-17",
    downloads: [{ label: "MP3", file: "upward_drift.mp3" }],
  }));

  const [music] = generateAssetCatalog(root);
  assert.equal(music.category, "music");
  assert.equal(music.preview, "/_assets/music/upward-drift/upward_drift.mp4");
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
