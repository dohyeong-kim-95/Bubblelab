// util/filter-cam — 필터 표와 색 계산만 본다(카메라·캔버스 겹은 브라우저 몫).
import test from "node:test";
import assert from "node:assert/strict";

import { FILTERS, applyColor, applyEffect, buildLuts, stampText } from "../util/filter-cam/filters.js";

const pixels = () => {
  const data = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) data.set([v, 255 - v, (v * 7) & 255, 255], v * 4);
  return data;
};

test("감성 8개·장난 8개, id·이름이 겹치지 않는다", () => {
  assert.equal(FILTERS.filter((f) => f.group === "mood").length, 8);
  assert.equal(FILTERS.filter((f) => f.group === "fun").length, 8);
  assert.equal(FILTERS.length, 16, "탭이 없는 필터가 있다");
  assert.equal(FILTERS[0].id, "original");
  assert.equal(new Set(FILTERS.map((f) => f.id)).size, 16);
  assert.equal(new Set(FILTERS.map((f) => f.name)).size, 16);
  assert.ok(FILTERS.filter((f) => f.group === "fun").every((f) => f.effect), "장난 필터는 effect 가 있어야 한다");
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
  for (const filter of FILTERS.filter((f) => f.group === "mood").slice(1)) {
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

// 장난 필터 — 가로 그라데이션 + 세로 줄무늬가 섞인 작은 화면으로 본다.
const W = 40, H = 50;
const frame = () => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    data.set([x * 6, y * 5, (x * y) % 256, 255], (y * W + x) * 4);
  }
  return { width: W, height: H, data };
};
const run = (id) => {
  const src = frame(), dst = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  assert.ok(applyEffect(src, dst, FILTERS.find((f) => f.id === id)), id);
  return dst.data;
};
const px = (data, x, y) => Array.from(data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

test("장난 필터는 모두 화면을 바꾸고 불투명하게 둔다 (타임 워프는 화면이 따로 돌린다)", () => {
  for (const filter of FILTERS.filter((f) => f.group === "fun" && f.effect !== "timewarp")) {
    const data = run(filter.id);
    assert.notDeepEqual(data, frame().data, filter.id);
    for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, filter.id);
  }
  assert.deepEqual(run("timewarp"), frame().data);
});

test("데칼코마니는 좌우 대칭이다", () => {
  const data = run("mirror");
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) {
    assert.deepEqual(px(data, x, y), px(data, W - 1 - x, y));
  }
});

test("볼록·소용돌이는 가운데 밖 모서리를 건드리지 않는다", () => {
  for (const id of ["bulge", "swirl"]) {
    const data = run(id);
    assert.deepEqual(px(data, 0, 0), px(frame().data, 0, 0), id);
    assert.deepEqual(px(data, W - 1, H - 1), px(frame().data, W - 1, H - 1), id);
  }
});

test("열화상은 밝을수록 뜨거운 색이다", () => {
  const src = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
  const dst = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
  applyEffect(src, dst, FILTERS.find((f) => f.id === "thermal"));
  assert.ok(dst.data[2] > dst.data[0], "어두운 곳은 푸르다");
  assert.deepEqual(Array.from(dst.data.slice(4, 7)), [255, 255, 255], "가장 밝은 곳은 흰색");
});

test("8비트는 16색 안에서만 칠한다", () => {
  const data = run("pixel");
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  assert.ok(colors.size <= 16, `${colors.size}색`);
});

test("팝아트는 네 칸이 서로 다른 색 조합이다", () => {
  const data = run("popart");
  const quads = [[0, 0], [W / 2, 0], [0, H / 2], [W / 2, H / 2]].map(([qx, qy]) => {
    const set = new Set();
    for (let y = qy; y < qy + H / 2; y++) for (let x = qx; x < qx + W / 2; x++) set.add(px(data, x, y).join());
    return [...set].sort().join("|");
  });
  assert.equal(new Set(quads).size, 4);
});

test("볼록거울은 가운데를 확대한다 — 가운데 근처는 원본의 더 가운데 쪽에서 가져온다", () => {
  const data = run("bulge");
  const src = frame().data;
  // 가운데에서 오른쪽으로 반지름의 반쯤(r≈0.5) 떨어진 칸은 원본의 r≈0.275 지점이다.
  const radius = Math.min(W, H) * 0.46, cx = W / 2, cy = H / 2;
  const x = Math.round(cx + radius * 0.5);
  const k = 0.5 * 0.3 + 0.25 * 0.7;
  const expected = px(src, Math.round(cx + (x - cx) * (k / ((x - cx) / radius))), cy);
  assert.deepEqual(px(data, x, cy), expected);
  assert.notDeepEqual(px(data, x, cy), px(src, x, cy));
});
