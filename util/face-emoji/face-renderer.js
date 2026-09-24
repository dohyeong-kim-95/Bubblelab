import {
  averagePoint,
  featurePoint,
  landmarkBounds,
} from "./face-quality.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);

function relative(point, bounds) {
  return {
    x: (point.x - bounds.centerX) / bounds.width,
    y: (point.y - bounds.centerY) / bounds.height,
  };
}

function mapPoint(landmarks, index, bounds, box) {
  const p = featurePoint(landmarks, index);
  if (!p) return null;
  const r = relative(p, bounds);
  return { x: box.cx + r.x * box.w * 0.86, y: box.cy + r.y * box.h * 0.86 };
}

function mapAverage(landmarks, indices, bounds, box) {
  const p = averagePoint(landmarks, indices);
  if (!p) return null;
  const r = relative(p, bounds);
  return { x: box.cx + r.x * box.w * 0.86, y: box.cy + r.y * box.h * 0.86 };
}

function drawLine(ctx, points, width, color) {
  const usable = points.filter(Boolean);
  if (usable.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(usable[0].x, usable[0].y);
  for (const p of usable.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

function drawEye(ctx, center, width, height, iris, tilt = 0) {
  if (!center) return;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(tilt);
  ctx.fillStyle = "#fffaf3";
  ctx.beginPath();
  ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.ellipse(0, height * 0.03, height * 0.34, height * 0.43, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#201c22";
  ctx.beginPath();
  ctx.arc(0, height * 0.04, height * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-height * 0.1, -height * 0.12, height * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#533a38";
  ctx.lineWidth = Math.max(3, height * 0.08);
  ctx.beginPath();
  ctx.ellipse(0, 0, width / 2, height / 2, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
}

function drawHair(ctx, box, color) {
  const { cx, cy, w, h } = box;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.56, cy + h * 0.22);
  ctx.bezierCurveTo(cx - w * 0.64, cy - h * 0.48, cx - w * 0.38, cy - h * 0.7,
    cx, cy - h * 0.69);
  ctx.bezierCurveTo(cx + w * 0.42, cy - h * 0.7, cx + w * 0.64, cy - h * 0.4,
    cx + w * 0.57, cy + h * 0.22);
  ctx.bezierCurveTo(cx + w * 0.43, cy + h * 0.02, cx + w * 0.35, cy - h * 0.15,
    cx + w * 0.26, cy - h * 0.28);
  ctx.bezierCurveTo(cx + w * 0.08, cy - h * 0.09, cx - w * 0.16, cy - h * 0.02,
    cx - w * 0.42, cy + h * 0.08);
  ctx.bezierCurveTo(cx - w * 0.46, cy + h * 0.2, cx - w * 0.5, cy + h * 0.25,
    cx - w * 0.56, cy + h * 0.22);
  ctx.fill();
  ctx.restore();
}

function drawMouth(ctx, left, right, top, bottom, color) {
  if (!left || !right) return;
  const centerX = (left.x + right.x) / 2;
  const centerY = ((top?.y || left.y) + (bottom?.y || left.y)) / 2;
  const width = Math.max(18, Math.abs(right.x - left.x));
  const open = bottom && top ? clamp(Math.abs(bottom.y - top.y), 0, 90) : 8;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#743f4c";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left.x, centerY);
  ctx.quadraticCurveTo(centerX, centerY + open * 0.9, right.x, centerY);
  ctx.quadraticCurveTo(centerX, centerY - open * 0.55, left.x, centerY);
  ctx.fill();
  ctx.stroke();
  if (open > 18) {
    ctx.fillStyle = "#fff8f4";
    ctx.beginPath();
    ctx.moveTo(left.x + width * 0.13, centerY - open * 0.12);
    ctx.quadraticCurveTo(centerX, centerY - open * 0.3, right.x - width * 0.13, centerY - open * 0.12);
    ctx.lineTo(right.x - width * 0.13, centerY + open * 0.02);
    ctx.quadraticCurveTo(centerX, centerY + open * 0.12, left.x + width * 0.13, centerY + open * 0.02);
    ctx.fill();
  }
  ctx.restore();
}

function samplePalette(sourceCanvas, landmarks, bounds) {
  if (!sourceCanvas || !sourceCanvas.getContext) return {};
  const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return {};
  const image = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const samples = [];
  const positions = [
    [bounds.centerX - bounds.width * 0.22, bounds.centerY + bounds.height * 0.12],
    [bounds.centerX + bounds.width * 0.22, bounds.centerY + bounds.height * 0.12],
  ];
  for (const [x, y] of positions) {
    const px = clamp(Math.round(x * sourceCanvas.width), 0, sourceCanvas.width - 1);
    const py = clamp(Math.round(y * sourceCanvas.height), 0, sourceCanvas.height - 1);
    const offset = (py * sourceCanvas.width + px) * 4;
    if (image.data[offset + 3] > 0) samples.push(image.data.slice(offset, offset + 3));
  }
  if (!samples.length) return {};
  const rgb = samples.reduce((acc, sample) => acc.map((v, i) => v + sample[i]), [0, 0, 0])
    .map((v) => Math.round(v / samples.length));
  const skin = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
  return { skin };
}

export function renderFaceEmoji(canvas, landmarks, options = {}) {
  const bounds = landmarkBounds(landmarks);
  if (!bounds) throw new Error("얼굴 랜드마크가 없습니다.");
  const size = options.size || 768;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas를 사용할 수 없습니다.");

  const palette = {
    background: "#f6d7df",
    skin: "#f2b18b",
    hair: "#3d2b25",
    iris: "#4c7890",
    shirt: "#6576b9",
    ...samplePalette(options.sourceCanvas, landmarks, bounds),
    ...(options.palette || {}),
  };
  const box = {
    cx: size / 2,
    cy: size * 0.49,
    w: clamp(size * (bounds.width / Math.max(bounds.height, 0.01)) * 0.82, size * 0.44, size * 0.72),
    h: size * 0.57,
  };

  const background = ctx.createLinearGradient(0, 0, size, size);
  background.addColorStop(0, palette.background);
  background.addColorStop(1, "#fff6e9");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = palette.shirt;
  ctx.beginPath();
  ctx.ellipse(box.cx, size * 0.99, size * 0.34, size * 0.22, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.skin;
  ctx.fillRect(box.cx - size * 0.09, box.cy + box.h * 0.34, size * 0.18, size * 0.18);

  drawHair(ctx, box, palette.hair);
  ctx.fillStyle = palette.skin;
  ctx.beginPath();
  ctx.ellipse(box.cx, box.cy, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const leftEar = { x: box.cx - box.w * 0.49, y: box.cy + box.h * 0.02 };
  const rightEar = { x: box.cx + box.w * 0.49, y: box.cy + box.h * 0.02 };
  ctx.fillStyle = palette.skin;
  ctx.beginPath(); ctx.ellipse(leftEar.x, leftEar.y, box.w * 0.1, box.h * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(rightEar.x, rightEar.y, box.w * 0.1, box.h * 0.13, 0, 0, Math.PI * 2); ctx.fill();

  const eyeLeft = mapAverage(landmarks, [33, 133, 159, 145], bounds, box);
  const eyeRight = mapAverage(landmarks, [362, 263, 386, 374], bounds, box);
  const eyeReference = distance(featurePoint(landmarks, 33), featurePoint(landmarks, 133));
  const eyeWidth = clamp(box.w * (eyeReference / Math.max(bounds.width, 0.01)) * 1.45, box.w * 0.13, box.w * 0.23);
  const eyeHeight = box.h * 0.105;
  const eyeTilt = Math.atan2(
    (eyeRight?.y || 0) - (eyeLeft?.y || 0),
    (eyeRight?.x || 1) - (eyeLeft?.x || 0),
  );
  drawEye(ctx, eyeLeft, eyeWidth, eyeHeight, palette.iris, eyeTilt);
  drawEye(ctx, eyeRight, eyeWidth, eyeHeight, palette.iris, eyeTilt);

  const browLeft = [70, 63, 105].map((index) => mapPoint(landmarks, index, bounds, box));
  const browRight = [300, 293, 334].map((index) => mapPoint(landmarks, index, bounds, box));
  drawLine(ctx, browLeft, Math.max(5, box.w * 0.027), palette.hair);
  drawLine(ctx, browRight, Math.max(5, box.w * 0.027), palette.hair);

  const noseTip = mapPoint(landmarks, 1, bounds, box);
  const noseBase = mapPoint(landmarks, 2, bounds, box);
  if (noseTip && noseBase) {
    drawLine(ctx, [noseTip, { x: noseTip.x, y: noseBase.y }, noseBase], Math.max(3, box.w * 0.018), "#bf765f");
  }

  const mouthLeft = mapPoint(landmarks, 61, bounds, box);
  const mouthRight = mapPoint(landmarks, 291, bounds, box);
  const mouthTop = mapPoint(landmarks, 13, bounds, box);
  const mouthBottom = mapPoint(landmarks, 14, bounds, box);
  drawMouth(ctx, mouthLeft, mouthRight, mouthTop, mouthBottom, "#d96f7d");

  ctx.fillStyle = "#ee8f9c66";
  ctx.beginPath(); ctx.ellipse(box.cx - box.w * 0.29, box.cy + box.h * 0.2, box.w * 0.1, box.h * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(box.cx + box.w * 0.29, box.cy + box.h * 0.2, box.w * 0.1, box.h * 0.045, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#ffffffb8";
  ctx.beginPath(); ctx.arc(size * 0.16, size * 0.16, size * 0.045, 0, Math.PI * 2); ctx.fill();
  return { bounds, palette };
}

