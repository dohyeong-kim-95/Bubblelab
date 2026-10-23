// util 의 스티커 누끼(util/photo/sticker-picker.js — photo·calendar·chat 공용)와
// util/pdf 의 페이지 캐시 — 둘 다 고친 뒤 다시 깨지지 않게 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 브라우저용 스크립트라 window.blStickers 에 붙는다. 불러오는 것만으로 정의되고 DOM 은 건드리지 않는다.
globalThis.window = globalThis;
await import("../util/photo/sticker-picker.js");
const { cutoutWhiteBackground } = globalThis.blStickers;

// width×height 를 한 색으로 채운 ImageData 비슷한 객체
function solidImage(width, height, [r, g, b, a]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([r, g, b, a], p * 4);
  return { data, width, height };
}
function setPixel(image, x, y, rgba) {
  image.data.set(rgba, (y * image.width + x) * 4);
}
function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

test("흰 불투명 배경은 테두리부터 지우고 가운데 어두운 그림은 남긴다", () => {
  const image = solidImage(5, 5, [255, 255, 255, 255]);
  setPixel(image, 2, 2, [20, 20, 20, 255]);
  cutoutWhiteBackground(image);
  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 4, 4), 0);
  assert.equal(alphaAt(image, 2, 2), 255);
});

test("그림 선에 둘러싸인 흰 속살은 지우지 않는다", () => {
  const image = solidImage(7, 7, [255, 255, 255, 255]);
  for (let i = 1; i <= 5; i++) {
    setPixel(image, i, 1, [0, 0, 0, 255]);
    setPixel(image, i, 5, [0, 0, 0, 255]);
    setPixel(image, 1, i, [0, 0, 0, 255]);
    setPixel(image, 5, i, [0, 0, 0, 255]);
  }
  cutoutWhiteBackground(image);
  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 3, 3), 255, "선 안쪽 흰 몸통이 지워졌다");
});

test("모서리가 이미 투명한 스티커는 한 픽셀도 바꾸지 않는다 (흰 몸통이 뚫리던 회귀)", () => {
  // sticker-pack.mjs 가 이미 누끼를 딴 PNG: 투명 픽셀의 RGB 는 흰색이고, 바로 옆에 밝은 털이 붙어 있다
  const image = solidImage(6, 6, [255, 255, 255, 0]);
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 4; x++) setPixel(image, x, y, [240, 240, 240, 255]);
  }
  const before = Uint8ClampedArray.from(image.data);
  cutoutWhiteBackground(image);
  assert.deepEqual(image.data, before);
});

test("모서리 하나만 투명해도 건너뛴다", () => {
  const image = solidImage(4, 4, [255, 255, 255, 255]);
  setPixel(image, 3, 0, [255, 255, 255, 0]);
  const before = Uint8ClampedArray.from(image.data);
  cutoutWhiteBackground(image);
  assert.deepEqual(image.data, before);
});

test("photo·calendar·chat 이 각자 누끼 사본을 두지 않고 공용 파일을 불러 쓴다", () => {
  for (const tool of ["photo", "calendar", "chat"]) {
    const html = readFileSync(new URL(`../util/${tool}/index.html`, import.meta.url), "utf8");
    assert.match(html, /<script src="(\.\.\/photo\/)?sticker-picker\.js"><\/script>/, `${tool} 가 공용 파일을 안 부른다`);
    assert.doesNotMatch(html, /function cutoutWhiteBackground/, `${tool} 에 누끼 사본이 남아 있다`);
  }
});

test("util/pdf: 문서를 닫으면 페이지 캐시도 비운다 (다음 파일이 파괴된 옛 페이지를 받던 회귀)", () => {
  // 캐시 키가 "원본번호:쪽"이라 닫은 뒤 새 파일을 열면 같은 키가 다시 쓰인다
  const html = readFileSync(new URL("../util/pdf/index.html", import.meta.url), "utf8");
  const start = html.indexOf("function closeDoc()");
  assert.ok(start >= 0, "closeDoc 이 없다");
  const body = html.slice(start, html.indexOf("\n}\n", start));
  assert.match(body, /\.destroy/);
  assert.match(body, /pageCache\.clear\(\)/);
});
