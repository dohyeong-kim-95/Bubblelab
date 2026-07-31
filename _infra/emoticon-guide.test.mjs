import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodePng } from "./png.mjs";
import { faceDropRatio, fitHead, loadPng, nodGuide } from "./emoticon-guide.mjs";

const REF = "_src/emoticon/rabbit/cuts/nod/frames-raw/key-1.png";

// 흰 배경 + 검은 원(머리) + 그 안 검은 점 두 개(눈) 합성 이미지
function synth({ size = 400, cx = 200, cy = 200, r = 100 } = {}) {
  const data = new Uint8Array(size * size * 4).fill(255);
  const put = (x, y, v) => {
    const i = ((y | 0) * size + (x | 0)) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  };
  for (let a = 0; a < 3600; a++) {                       // 머리 외곽선
    const t = (a / 3600) * 2 * Math.PI;
    for (let w = 0; w < 4; w++) put(cx + (r - w) * Math.cos(t), cy + (r - w) * Math.sin(t), 0);
  }
  for (const ex of [cx - r * 0.35, cx + r * 0.35]) {     // 눈 두 개
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
      if (x * x + y * y <= 64) put(ex + x, cy - r * 0.15 + y, 0);
    }
  }
  return { width: size, height: size, data };
}

test("fitHead는 머리 원의 중심·반지름을 찾는다", () => {
  const head = fitHead(synth(), { top: 0.1, bottom: 0.9 });
  assert.ok(Math.abs(head.cx - 200) <= 2, `cx=${head.cx}`);
  assert.ok(Math.abs(head.cy - 200) <= 2, `cy=${head.cy}`);
  assert.ok(Math.abs(head.radius - 100) <= 3, `r=${head.radius}`);
  assert.ok(Math.abs(head.top - 100) <= 4, `top=${head.top}`);
});

test("빈 이미지는 명확한 에러로 실패한다", () => {
  const blank = { width: 40, height: 40, data: new Uint8Array(40 * 40 * 4).fill(255) };
  assert.throws(() => fitHead(blank), /머리 원을 찾지 못했습니다/);
});

test("nodGuide는 얼굴 하강 비율을 실제로 올린다 (실제 레퍼런스)", () => {
  const ref = loadPng(readFileSync(REF));
  const before = faceDropRatio(ref);
  assert.ok(before > 0.3 && before < 0.45, `기준선이 예상 밖: ${before}`);
  let prev = before;
  for (const drop of [0.14, 0.26, 0.38]) {
    const after = faceDropRatio(nodGuide(ref, { drop }).image);
    assert.ok(after > prev, `drop=${drop}에서 더 내려가야 함 (${prev} → ${after})`);
    prev = after;
  }
});

test("머리 외곽선과 귀는 손대지 않는다", () => {
  // 실패 이력: 창을 넓게 잡아 귀뿌리 선과 머리·몸 경계선이 딸려 내려가
  // 이마에 유령 아크가 생겼다. 창 위쪽(귀 영역)은 바이트 단위로 같아야 한다.
  const ref = loadPng(readFileSync(REF));
  const { image, head } = nodGuide(ref, { drop: 0.26 });
  const guardBottom = Math.round(head.cy - head.radius * 0.45) - 1;
  for (let y = 0; y <= guardBottom; y++) {
    for (let x = 0; x < ref.width; x++) {
      const i = (y * ref.width + x) * 4;
      if (ref.data[i] !== image.data[i] || ref.data[i + 3] !== image.data[i + 3]) {
        assert.fail(`귀 영역이 변경됨: (${x}, ${y})`);
      }
    }
  }
});

test("합성은 결정론적이다", () => {
  const ref = loadPng(readFileSync(REF));
  const a = encodePng(nodGuide(ref, { drop: 0.26 }).image);
  const b = encodePng(nodGuide(ref, { drop: 0.26 }).image);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test("호(bow)는 중앙을 가장자리보다 더 내린다", () => {
  const ref = loadPng(readFileSync(REF));
  const flat = nodGuide(ref, { drop: 0.26, bow: 0 }).image;
  const bowed = nodGuide(ref, { drop: 0.26, bow: 0.5 }).image;
  // 곡률을 주면 가장자리(볼)가 덜 내려가므로 두 결과가 달라야 한다
  assert.notDeepEqual(Buffer.from(encodePng(flat)), Buffer.from(encodePng(bowed)));
});
