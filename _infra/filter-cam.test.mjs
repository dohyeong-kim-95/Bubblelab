// util/filter-cam — 필터 표와 색 계산만 본다(카메라·캔버스 겹은 브라우저 몫).
import test from "node:test";
import assert from "node:assert/strict";

import { FILTERS, applyColor, buildLuts, stampText } from "../util/filter-cam/filters.js";

const pixels = () => {
  const data = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) data.set([v, 255 - v, (v * 7) & 255, 255], v * 4);
  return data;
};

test("필터는 원본 포함 8개, id·이름이 겹치지 않는다", () => {
  assert.equal(FILTERS.length, 8);
  assert.equal(FILTERS[0].id, "original");
  assert.equal(new Set(FILTERS.map((f) => f.id)).size, 8);
  assert.equal(new Set(FILTERS.map((f) => f.name)).size, 8);
});

test("원본은 픽셀을 바꾸지 않는다", () => {
  const data = pixels();
  assert.deepEqual(applyColor(data, FILTERS[0]), pixels());
});

test("기본 톤 곡선은 항등이다", () => {
  for (const lut of buildLuts()) {
    for (let v = 0; v < 256; v++) assert.equal(lut[v], v);
  }
});

test("흑백은 세 채널이 같다", () => {
  const mono = FILTERS.find((f) => f.id === "mono");
  const data = applyColor(pixels(), { ...mono, grain: 0 });
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i], data[i + 1]);
    assert.equal(data[i + 1], data[i + 2]);
  }
});

test("모든 필터가 실제로 색을 바꾸고 알파는 그대로 둔다", () => {
  for (const filter of FILTERS.slice(1)) {
    const data = applyColor(pixels(), filter, 3);
    assert.notDeepEqual(data, pixels(), filter.id);
    for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, filter.id);
  }
});

test("필름 계열은 검정을 들어 올린다(fade)", () => {
  const [r] = buildLuts({ fade: 0.06 });
  assert.ok(r[0] >= 15);
});

test("날짜 도장은 디카 형식이다", () => {
  assert.equal(stampText(new Date(2026, 9, 3)), "'26 10 03");
});
