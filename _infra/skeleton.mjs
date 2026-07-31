// OpenPose 스타일 2D 스켈레톤 렌더러 + 포즈 보간 (work/emoticon).
// 의존성 없음 — _infra/png.mjs 픽셀 버퍼에 선분·원을 직접 래스터화한다.
// 근거와 설계 배경은 work/emoticon/pose-conditioning.md.
//
// 포즈는 **관절 각도**로만 저장한다. 뼈 길이(비율)는 캐릭터 쪽 자산이라
// 분리되어 있고, 그래서 하나의 포즈 시퀀스를 **어떤 캐릭터에도 재사용**할 수
// 있다 ("각도 = 모션, 길이 = 정체성" — Kling-MotionControl의 identity-agnostic
// motion learning을 코드로 옮긴 것). 8등신 모캡을 치비에 그대로 씌우면
// 캐릭터가 늘어나는 문제(MusePose의 pose-align)가 구조적으로 생기지 않는다.
//
// 각도는 **월드 각도(도)**: 0 = 화면 오른쪽, 90 = 아래, -90 = 위.
// 화면 기준이므로 "캐릭터의 오른팔"(=화면 왼쪽)은 R 접미사 뼈가 담당하고,
// 렌더링 색으로도 좌우가 구분된다 — 텍스트로 좌우를 지시할 때 생기던
// 모호성(lesson_learned §9·§12)이 여기서 사라진다.

// COCO-18 키포인트 (OpenPose 표준 순서)
export const KEYPOINTS = [
  "nose", "neck", "shoulderR", "elbowR", "wristR", "shoulderL", "elbowL", "wristL",
  "hipR", "kneeR", "ankleR", "hipL", "kneeL", "ankleL", "eyeR", "eyeL", "earR", "earL",
];

// 그리는 순서대로의 뼈 연결 (controlnet_aux draw_bodypose와 동일)
const LIMBS = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9],
  [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];

// ControlNet 공식 COCO 색 규약. 모델이 학습 때 본 것과 같은 규약을 써야
// 인식률이 오른다 — 임의로 바꾸지 말 것.
// 앞쪽(빨강·주황 계열) = 캐릭터의 오른쪽, 뒤쪽(파랑·보라 계열) = 왼쪽.
const COLORS = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0],
  [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255],
  [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85],
];

// 치비(2~3등신) 기본 비율. 캔버스 높이를 1로 본 상대 길이 — 캐릭터마다
// 이 값만 갈아끼우면 같은 포즈 시퀀스가 그 캐릭터 비율로 다시 그려진다.
export const CHIBI = {
  spine: 0.13, neck: 0.05, head: 0.10,
  shoulderWidth: 0.075, hipWidth: 0.045,
  upperArm: 0.085, foreArm: 0.075,
  thigh: 0.075, shin: 0.065,
  eye: 0.028, ear: 0.045,
};

// 기본 자세(차렷): 팔은 몸 옆으로 살짝 벌리고, 다리는 곧게.
export const REST_ANGLES = {
  spine: -90, neck: -90, head: -90,
  upperArmR: 100, foreArmR: 95, upperArmL: 80, foreArmL: 85,
  thighR: 95, shinR: 92, thighL: 85, shinL: 88,
};

const rad = (deg) => (deg * Math.PI) / 180;
const step = (x, y, angleDeg, length) => [x + Math.cos(rad(angleDeg)) * length, y + Math.sin(rad(angleDeg)) * length];

// 포즈(각도) + 비율 → 픽셀 좌표 18개. FK(전방 운동학)로 관절을 이어 붙인다.
export function solvePose(pose, { proportions = CHIBI, width = 512, height = 512 } = {}) {
  const a = { ...REST_ANGLES, ...(pose.angles ?? {}) };
  const p = { ...CHIBI, ...proportions };
  const unit = height;                       // 길이는 캔버스 높이 기준 상대값
  const [rx, ry] = pose.root ?? [0.5, 0.62];
  const hip = [rx * width, ry * height];

  const neck = step(hip[0], hip[1], a.spine, p.spine * unit);
  const headBase = step(neck[0], neck[1], a.neck, p.neck * unit);
  const nose = step(headBase[0], headBase[1], a.head, p.head * unit);

  const shoulderR = [neck[0] - p.shoulderWidth * unit, neck[1]];
  const shoulderL = [neck[0] + p.shoulderWidth * unit, neck[1]];
  const elbowR = step(shoulderR[0], shoulderR[1], a.upperArmR, p.upperArm * unit);
  const elbowL = step(shoulderL[0], shoulderL[1], a.upperArmL, p.upperArm * unit);
  const wristR = step(elbowR[0], elbowR[1], a.foreArmR, p.foreArm * unit);
  const wristL = step(elbowL[0], elbowL[1], a.foreArmL, p.foreArm * unit);

  const hipR = [hip[0] - p.hipWidth * unit, hip[1]];
  const hipL = [hip[0] + p.hipWidth * unit, hip[1]];
  const kneeR = step(hipR[0], hipR[1], a.thighR, p.thigh * unit);
  const kneeL = step(hipL[0], hipL[1], a.thighL, p.thigh * unit);
  const ankleR = step(kneeR[0], kneeR[1], a.shinR, p.shin * unit);
  const ankleL = step(kneeL[0], kneeL[1], a.shinL, p.shin * unit);

  // 눈·귀는 머리 방향에 붙어 따라 돈다 (고개를 숙이면 같이 숙여진다)
  const side = (dist, offsetDeg) => step(nose[0], nose[1], a.head + offsetDeg, dist * unit);
  const eyeR = side(p.eye, 120);
  const eyeL = side(p.eye, -120);
  const earR = side(p.ear, 150);
  const earL = side(p.ear, -150);

  return [nose, neck, shoulderR, elbowR, wristR, shoulderL, elbowL, wristL,
    hipR, kneeR, ankleR, hipL, kneeL, ankleL, eyeR, eyeL, earR, earL];
}

function blend(image, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = ((y | 0) * image.width + (x | 0)) * 4;
  for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(color[c] * alpha + image.data[i + c] * (1 - alpha));
  image.data[i + 3] = 255;
}

function fillCircle(image, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) blend(image, x, y, color);
    }
  }
}

// 선분을 두께 있는 막대로 (점-선분 거리 판정)
function fillLimb(image, [x1, y1], [x2, y2], thickness, color, alpha = 0.75) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  const r = thickness / 2;
  const minX = Math.floor(Math.min(x1, x2) - r);
  const maxX = Math.ceil(Math.max(x1, x2) + r);
  const minY = Math.floor(Math.min(y1, y2) - r);
  const maxY = Math.ceil(Math.max(y1, y2) + r);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      if ((x - px) ** 2 + (y - py) ** 2 <= r * r) blend(image, x, y, color, alpha);
    }
  }
}

// 키포인트 → 검은 배경 + 컬러 스켈레톤 이미지
export function drawSkeleton(keypoints, { width = 512, height = 512, canvas = null, offsetX = 0, offsetY = 0 } = {}) {
  const image = canvas ?? {
    width, height,
    data: (() => { const d = new Uint8Array(width * height * 4); for (let i = 3; i < d.length; i += 4) d[i] = 255; return d; })(),
  };
  const scale = Math.min(width, height);
  const limbThickness = Math.max(3, scale * 0.022);
  const jointRadius = Math.max(2, scale * 0.014);
  const at = (i) => [keypoints[i][0] + offsetX, keypoints[i][1] + offsetY];

  LIMBS.forEach(([a, b], i) => fillLimb(image, at(a), at(b), limbThickness, COLORS[i % COLORS.length]));
  keypoints.forEach((_, i) => {
    const [x, y] = at(i);
    fillCircle(image, x, y, jointRadius, COLORS[i % COLORS.length]);
  });
  return image;
}

export function renderPose(pose, opts = {}) {
  const { width = 512, height = 512 } = opts;
  return drawSkeleton(solvePose(pose, opts), { width, height });
}

// 포즈 여러 개를 한 장의 격자로 (그리드 단일 호출 전략 — pose-conditioning.md §6).
// 셀 순서는 좌→우, 위→아래로 sticker-pack.mjs의 슬라이스 규약과 같다.
export function renderGrid(poses, { cols = 4, cell = 512, proportions = CHIBI } = {}) {
  const rows = Math.ceil(poses.length / cols);
  const width = cols * cell;
  const height = rows * cell;
  const data = new Uint8Array(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const canvas = { width, height, data };
  poses.forEach((pose, i) => {
    const keypoints = solvePose(pose, { proportions, width: cell, height: cell });
    drawSkeleton(keypoints, {
      canvas, width, height,
      offsetX: (i % cols) * cell,
      offsetY: ((i / cols) | 0) * cell,
    });
  });
  return canvas;
}

// ── 보간 (각도 공간) ────────────────────────────────────────────────────
// 픽셀 좌표를 LERP하면 두 각도 사이 직선 경로가 원호를 가로질러 팔다리가
// 짧아진다. 반드시 각도에서 보간할 것 (pose-conditioning.md §7).

export function lerpAngle(a, b, t) {
  let delta = ((b - a) % 360 + 540) % 360 - 180; // 최단 회전
  return a + delta * t;
}

const easeInOut = (t) => (1 - Math.cos(Math.PI * t)) / 2;

export function lerpPose(a, b, t) {
  const angles = {};
  const names = new Set([...Object.keys(a.angles ?? {}), ...Object.keys(b.angles ?? {})]);
  for (const name of names) {
    const from = a.angles?.[name] ?? REST_ANGLES[name] ?? 0;
    const to = b.angles?.[name] ?? REST_ANGLES[name] ?? 0;
    angles[name] = lerpAngle(from, to, t);
  }
  const rootA = a.root ?? [0.5, 0.62];
  const rootB = b.root ?? [0.5, 0.62];
  return { root: [rootA[0] + (rootB[0] - rootA[0]) * t, rootA[1] + (rootB[1] - rootA[1]) * t], angles };
}

// 키 포즈 목록 → 프레임 포즈 목록.
//   loop "pingpong": 끝까지 갔다가 되돌아온다 (편도만 저작하면 된다)
//   loop "cycle":    마지막 → 첫 구간도 보간해 순환을 닫는다
//   loop "none":     키 사이만 보간
// steps는 구간당 추가 프레임 수(키 제외). ease면 sine ease-in-out.
export function expandSequence(keys, { steps = 2, loop = "pingpong", ease = true } = {}) {
  if (!Array.isArray(keys) || keys.length < 2) throw new Error("키 포즈는 2개 이상이어야 합니다");
  const segments = [];
  for (let i = 0; i < keys.length - 1; i++) segments.push([keys[i], keys[i + 1]]);
  if (loop === "cycle") segments.push([keys[keys.length - 1], keys[0]]);

  const frames = [];
  segments.forEach(([from, to]) => {
    frames.push(from); // 구간의 시작 = 키 포즈 (다음 구간이 그 다음 키를 넣는다)
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      frames.push(lerpPose(from, to, ease ? easeInOut(t) : t));
    }
  });
  const last = segments[segments.length - 1][1];
  if (loop !== "cycle") frames.push(last);

  if (loop === "pingpong") {
    for (let i = frames.length - 2; i >= 1; i--) frames.push(frames[i]);
  }
  return frames;
}
