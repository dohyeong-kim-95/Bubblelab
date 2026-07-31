import test from "node:test";
import assert from "node:assert/strict";
import { encodeGif, inspectGif } from "./gif.mjs";

function makeImage(width, height, fill) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

test("encodeGif: GIF89a 구조·프레임 수·무한 반복을 기록한다", () => {
  const frames = [makeImage(8, 8, [255, 0, 0, 255]), makeImage(8, 8, [0, 0, 255, 255])];
  const gif = encodeGif(frames, { fps: 10 });
  assert.equal(gif.subarray(0, 6).toString("latin1"), "GIF89a");
  const info = inspectGif(gif);
  assert.deepEqual([info.width, info.height, info.frames, info.loops], [8, 8, 2, 0]);
  assert.ok(info.animated);
  assert.equal(info.delays.length, 2);
  assert.ok(Math.abs(info.delays[0] - 0.1) < 0.011);
});

test("encodeGif: delaysMs로 프레임별 지속시간을 쓴다 (1/100초 단위)", () => {
  const frames = [makeImage(4, 4, [10, 20, 30, 255]), makeImage(4, 4, [200, 100, 50, 255])];
  const info = inspectGif(encodeGif(frames, { delaysMs: [500, 80] }));
  assert.ok(Math.abs(info.delays[0] - 0.5) < 0.011);
  assert.ok(Math.abs(info.delays[1] - 0.08) < 0.011);
  // 0으로 반올림되면 뷰어마다 속도가 제각각이라 최소 1(=0.01초)로 올린다
  assert.ok(inspectGif(encodeGif(frames, { delaysMs: [1, 1] })).delays.every((d) => d >= 0.01));
});

test("encodeGif: 투명 픽셀은 배경색에 합성되고 반투명 경계도 뭉개지지 않는다", () => {
  // GIF는 1비트 투명만 지원한다 — 카카오 제안이 흰 배경을 요구하므로 흰색 합성이 기본.
  const frame = makeImage(2, 1, [255, 0, 0, 255]);
  frame.data.set([0, 255, 0, 128], 4);          // 반투명 초록 → 흰색과 절반 섞임
  const gif = encodeGif([frame, frame], { fps: 8 });
  assert.equal(inspectGif(gif).frames, 2);
  // 배경색을 바꾸면 결과 바이트도 달라진다(합성이 실제로 일어난다)
  const onBlack = encodeGif([frame, frame], { fps: 8, background: [0, 0, 0] });
  assert.notEqual(gif.toString("base64"), onBlack.toString("base64"));
});

test("encodeGif: 256색을 넘으면 양자화해서 팔레트에 담는다", () => {
  const width = 64, height = 8;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set([i % 256, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
  }
  const frame = { width, height, data };
  const info = inspectGif(encodeGif([frame, frame], { fps: 12 }));
  assert.equal(info.frames, 2);
  assert.deepEqual([info.width, info.height], [64, 8]);
});

test("encodeGif: 잘못된 입력은 명확히 거부한다", () => {
  assert.throws(() => encodeGif([]), /프레임이 없습니다/);
  assert.throws(
    () => encodeGif([makeImage(4, 4, [0, 0, 0, 255]), makeImage(8, 8, [0, 0, 0, 255])]),
    /크기가 다릅니다/,
  );
  assert.throws(
    () => encodeGif([makeImage(4, 4, [0, 0, 0, 255])], { delaysMs: [10, 20] }),
    /delaysMs 길이/,
  );
});
