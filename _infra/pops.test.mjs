import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("pops는 LIFE 도구 페이지와 정적 manifest를 가진다", () => {
  const html = read("life/pops/index.html");
  const manifest = JSON.parse(read("life/pops/content/manifest.json"));
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.match(html, /id="sound"[^>]*>🔇<\/button>/);
  assert.match(html, /href="\.\.\/styles\.css"/);
  assert.equal(manifest.version, 2);
  assert.ok(Array.isArray(manifest.items));
  assert.equal(manifest.items.length, 50);
  for (const item of manifest.items) {
    assert.ok(existsSync(join(ROOT, "life/pops", item.src)), item.src);
    assert.ok(item.exampleMeaning, `${item.id} has no example translation`);
    assert.doesNotMatch(item.exampleMeaning, /뜻은 .*입니다/, `${item.id} still uses the placeholder translation`);
  }
  assert.equal(existsSync(join(ROOT, "life/pops/content/tts")), false, "TTS 원본은 서비스하지 않는다");
  assert.equal(existsSync(join(ROOT, "life/pops/content/a1-words.json")), false, "단어 원본은 서비스하지 않는다");
});

test("pops 재생기는 active/next만 준비하고 화면 밖 source를 해제한다", () => {
  const js = read("life/pops/app.js");
  assert.match(js, /MAX_PREPARED_AHEAD = 1/);
  assert.match(js, /video\.pause\(\)/);
  assert.match(js, /removeAttribute\("src"\)/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /video\.play\(\)/);
  assert.doesNotMatch(js, /caption/);
  assert.match(js, /feed\.scrollHeight/);
});

test("pops는 추천 서버 없이 정적 콘텐츠를 로드한다", () => {
  const js = read("life/pops/app.js");
  assert.match(js, /fetch\("content\/manifest\.json"/);
  assert.doesNotMatch(js, /https?:\/\//);
});
