import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("pops는 LIFE 도구 페이지와 정적 manifest를 가진다", () => {
  const html = read("life/pops/index.html");
  const manifest = JSON.parse(read("life/pops/content/manifest.json"));
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.match(html, /href="\.\.\/styles\.css"/);
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.items));
});

test("pops 재생기는 active/next만 준비하고 화면 밖 source를 해제한다", () => {
  const js = read("life/pops/app.js");
  assert.match(js, /MAX_PREPARED_AHEAD = 1/);
  assert.match(js, /video\.pause\(\)/);
  assert.match(js, /removeAttribute\("src"\)/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /video\.play\(\)/);
});

test("pops는 추천 서버 없이 정적 콘텐츠를 로드한다", () => {
  const js = read("life/pops/app.js");
  assert.match(js, /fetch\("content\/manifest\.json"/);
  assert.doesNotMatch(js, /https?:\/\//);
});
