// 리그 — 생성된 작화에 기하를 입히는 변형 계층.
//
// 왜 필요한가: 아홉 번의 실측(nod2~nod9)에서 이 모델은 **얼굴 부위의 세로
// 위치를 레퍼런스에서 떼어내지 못했다.** 표정(눈 모양·입 열림)은 매번 정확히
// 그렸지만 좌표는 항상 원래 자리로 되돌렸다 — 텍스트로 지시해도, 배치도를
// 이미지로 보여줘도 마찬가지였다 (work/emoticon/nod-anatomy.md §5).
//
// 그래서 역할을 나눈다: **표정은 모델이, 기하는 리그가.** 모델이 그린 프레임을
// 받아 얼굴 부위를 계측하고 목표 위치로 변형한다. 전통적인 리깅과 같은 구조다 —
// 아트는 사람(여기서는 모델)이 그리고, 움직임은 리그가 만든다.
//
// 순수 함수라 비용이 없고 결정론적이며, 테스트로 검증된다.
import { decodePng, encodePng } from "./png.mjs";

// 임계값이 두 개인 이유: 머리 원 피팅은 **구조**(굵은 외곽선)를 봐야 하므로
// 느슨하게 잡으면 안티에일리어싱 가장자리까지 머리로 세어 원이 틀어진다.
// 반면 얼굴 마스크는 **부드러운 그라디언트**(볼 홍조)의 옅은 꼬리까지 잡아야
// 하고, 250으로 두면 251~254인 꼬리가 원위치에 유령으로 남아 띠 자국이 된다.
const STRUCT_BG = 250;
const FACE_BG = 254;
// 얼굴 부위만 담는 창. 넓게 잡으면 귀뿌리 선과 머리·몸 경계선까지 딸려
// 내려간다(1차 시도에서 이마에 유령 아크가 생겼다). 실측 기준:
// 머리 중심 대비 눈 −0.17R · 볼 +0.2R · 입 +0.16R, 귀뿌리 −0.8R,
// 머리·몸 경계 +0.37R. 그 사이를 넉넉히 비켜 잡는다.
const FACE_WINDOW = { up: 0.45, down: 0.42, side: 0.92, inner: 0.82 };

function isInk(data, i, threshold = STRUCT_BG) {
  return data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold;
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
      if (isInk(data, i, FACE_BG)) pixels.push({ x, y, i });
    }
  }
  return pixels;
}

// 끄덕임 리그: 얼굴 부위를 머리 반지름의 drop배만큼 아래로 옮긴다.
// 부위는 직선이 아니라 아래로 볼록한 호를 그린다(nod-anatomy.md §3) —
// 중앙일수록 더 내려가고 가장자리는 덜 내려간다. bow가 그 곡률이다.
// squash는 눈-입 간격을 cosθ만큼 좁히는 전단축(foreshortening)이다.
export function nodRig(image, { drop = 0.33, bow = 0.25, squash = 0.94 } = {}) {
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

// 목표 비율에 맞춰 drop을 역산한다. 생성된 프레임마다 얼굴 위치가 조금씩
// 다르므로(모델이 정규화하는 정도가 프레임마다 다르다) 고정 오프셋을 쓰면
// 프레임 간 간격이 들쭉날쭉해진다. 측정 → 보정을 반복해 목표에 맞춘다.
// 순수 계산이라 비용이 없다.
export function rigToRatio(image, target, { tolerance = 0.002, maxSteps = 12, ...options } = {}) {
  const current = faceDropRatio(image);
  if (current === null) throw new Error("얼굴 하강 비율을 잴 수 없습니다 — 눈을 찾지 못했습니다");
  if (target <= current) return { image, head: fitHead(image), moved: 0, dropPx: 0, drop: 0, ratio: current };
  // 초기 추정: 비율 차이 × 머리 지름 = 필요한 픽셀 이동량, drop은 반지름 기준
  let drop = (target - current) * 2;
  let best = null;
  for (let step = 0; step < maxSteps; step++) {
    const result = nodRig(image, { ...options, drop });
    const ratio = faceDropRatio(result.image);
    best = { ...result, drop, ratio };
    const error = target - ratio;
    if (Math.abs(error) <= tolerance) break;
    drop += error * 2;                     // 같은 선형 관계로 보정
    if (drop <= 0) break;
  }
  return best;
}

export function encodeRig(result) {
  return encodePng(result.image);
}

// 리그 스펙 → 변형된 이미지. 현재 type은 "nod" 하나이며, 눈깜빡임처럼
// 기하 변형이 없는 동작은 리그 없이(표정만으로) 간다.
export function applyRig(image, rig) {
  const type = rig?.type ?? "nod";
  if (type !== "nod") throw new Error(`알 수 없는 rig.type: ${type} (현재 "nod"만 지원)`);
  const { ratio, drop, bow, squash } = rig;
  const options = {
    ...(bow === undefined ? {} : { bow: Number(bow) }),
    ...(squash === undefined ? {} : { squash: Number(squash) }),
  };
  if (ratio !== undefined) return rigToRatio(image, Number(ratio), options);
  return nodRig(image, { ...options, ...(drop === undefined ? {} : { drop: Number(drop) }) });
}

export function loadPng(bytes) {
  return decodePng(bytes);
}
