// 가이드 프레임 합성 — 룰베이스로 Gemini를 돕는 장치.
//
// 왜 필요한가: 여덟 번의 실측(nod2~nod8)에서 이 모델은 **얼굴 부위의 세로
// 위치를 레퍼런스에서 떼어내지 못했다.** 표정(눈 모양·입 열림)과 귀 각도는
// 바꾸지만, 눈·코·입의 좌표는 레퍼런스 그대로 다시 그린다. "전체를 내려라"도
// "머리 안에서 낮게 그려라"도 통하지 않았다 (work/emoticon/nod-anatomy.md §5).
//
// 그래서 설득을 포기하고 **기하를 픽셀로 직접 만들어 보여준다.** 레퍼런스에서
// 얼굴 부위만 잘라 아래로 옮긴 거친 합성본을 만들고, 모델에게는 "이 배치대로
// 깔끔하게 다시 그려라"만 시킨다. 리터칭은 이미지 모델이 원래 잘하는 일이다.
//
// 순수 함수라 무료·결정론적이고, 테스트로 검증된다.
import { decodePng, encodePng } from "./png.mjs";

const BG = 250;      // 이 값 이상이면 배경(흰색)으로 본다
// 얼굴 부위만 담는 창. 넓게 잡으면 귀뿌리 선과 머리·몸 경계선까지 딸려
// 내려간다(1차 시도에서 이마에 유령 아크가 생겼다). 실측 기준:
// 머리 중심 대비 눈 −0.17R · 볼 +0.2R · 입 +0.16R, 귀뿌리 −0.8R,
// 머리·몸 경계 +0.37R. 그 사이를 넉넉히 비켜 잡는다.
const FACE_WINDOW = { up: 0.45, down: 0.28, side: 0.92, inner: 0.82 };

function isInk(data, i) {
  return data[i] < BG || data[i + 1] < BG || data[i + 2] < BG;
}

// 머리 원 피팅: 얼굴 영역에서 잉크 폭이 최대인 행을 지름으로 본다.
// 치비 캐릭터는 머리가 가장 넓은 원이라 이 단순한 방법이 안정적으로 맞는다
// (실측: 우리 토끼 C=(505,519) R=206, 여러 컷에서 R 편차 0).
export function fitHead(image, { top = 0.35, bottom = 0.75 } = {}) {
  const { width, height, data } = image;
  let best = { span: -1, y: -1, x0: 0, x1: 0 };
  for (let y = Math.round(height * top); y < Math.round(height * bottom); y++) {
    let x0 = -1; let x1 = -1;
    for (let x = 0; x < width; x++) {
      if (isInk(data, (y * width + x) * 4)) { if (x0 < 0) x0 = x; x1 = x; }
    }
    if (x1 - x0 > best.span) best = { span: x1 - x0, y, x0, x1 };
  }
  if (best.span <= 0) throw new Error("머리 원을 찾지 못했습니다 — 빈 이미지이거나 배경이 흰색이 아닙니다");
  const radius = best.span / 2;
  return { cx: best.x0 + radius, cy: best.y, radius, top: best.y - radius };
}

// 얼굴 부위(눈·코·입·볼) 마스크. 머리 원 안쪽에서 외곽선 여유를 뺀 영역 중
// 배경이 아닌 픽셀. 머리·몸 경계는 아래 한계로 잘라 제외한다.
function facePixels(image, head, window = FACE_WINDOW) {
  const { up: spanUp, down: spanDown, side: spanSide, inner: innerRatio } = { ...FACE_WINDOW, ...window };
  const { width, data } = image;
  const { cx, cy, radius } = head;
  const inner = radius * innerRatio;
  const pixels = [];
  const y0 = Math.round(cy - radius * spanUp);
  const y1 = Math.round(cy + radius * spanDown);
  const xr = radius * spanSide;
  for (let y = Math.max(0, y0); y <= Math.min(image.height - 1, y1); y++) {
    for (let x = Math.max(0, Math.round(cx - xr)); x <= Math.min(width - 1, Math.round(cx + xr)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > inner * inner) continue;  // 외곽선은 건드리지 않는다
      const i = (y * width + x) * 4;
      if (isInk(data, i)) pixels.push({ x, y, i });
    }
  }
  return pixels;
}

// 끄덕임 가이드: 얼굴 부위를 머리 반지름의 drop배만큼 아래로 옮긴다.
// 부위는 직선이 아니라 아래로 볼록한 호를 그린다(nod-anatomy.md §3) —
// 중앙일수록 더 내려가고 가장자리는 덜 내려간다. bow가 그 곡률이다.
// squash는 눈-입 간격을 cosθ만큼 좁히는 전단축(foreshortening)이다.
export function nodGuide(image, { drop = 0.33, bow = 0.25, squash = 0.94 } = {}) {
  const head = fitHead(image);
  const { width, height, data } = image;
  const face = facePixels(image, head);
  if (!face.length) throw new Error("얼굴 부위를 찾지 못했습니다 — 머리 안이 비어 있습니다");

  const out = new Uint8Array(width * height * 4);
  out.set(data);
  // ① 원래 자리를 흰색으로 지운다 (머리 안은 흰 면이다)
  for (const p of face) out.set([255, 255, 255, 255], p.i);

  // ② 옮겨 붙인다. 세로 이동량은 가로 위치에 따라 호를 그린다.
  const base = head.radius * drop;
  const xr = head.radius * 0.8;
  for (const p of face) {
    const t = Math.min(1, Math.abs(p.x - head.cx) / xr);          // 중앙 0 → 가장자리 1
    const dy = base * (1 - bow * t * t);                           // 중앙이 가장 많이 내려간다
    const sy = head.cy + (p.y - head.cy) * squash;                 // 세로 압축
    const ty = Math.round(sy + dy);
    if (ty < 0 || ty >= height) continue;
    const di = (ty * width + p.x) * 4;
    for (let c = 0; c < 4; c++) out[di + c] = data[p.i + c];
  }
  return { image: { width, height, data: out }, head, moved: face.length, dropPx: Math.round(base) };
}

// 합성 결과가 실제로 얼굴을 내렸는지 스스로 검증한다.
// nod-anatomy.md §6의 지표: (눈 y − 머리 위 끝 y) / 머리 지름.
export function faceDropRatio(image) {
  const head = fitHead(image);
  const { width, data } = image;
  const dark = [];
  const y0 = Math.round(head.cy - head.radius * 0.9);
  const y1 = Math.round(head.cy + head.radius * 0.7);
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) {
    for (let x = Math.round(head.cx - head.radius * 0.75); x < head.cx + head.radius * 0.75; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) dark.push({ x, y });
    }
  }
  const eyes = dark.filter((p) => Math.abs(p.x - head.cx) > head.radius * 0.25);
  if (!eyes.length) return null;
  const eyeY = eyes.reduce((sum, p) => sum + p.y, 0) / eyes.length;
  return (eyeY - head.top) / (2 * head.radius);
}

export function encodeGuide(result) {
  return encodePng(result.image);
}

export function loadPng(bytes) {
  return decodePng(bytes);
}
