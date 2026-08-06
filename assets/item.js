// 배경화면 상세페이지. 빌드가 심어 둔 항목 데이터로 세 가지를 한다.
//  ① 원본을 크게 보기
//  ② 내 화면 해상도에 맞춰 잘라서 저장 (캔버스, 서버 왕복 없음)
//  ③ 폰 케이스 목업 미리보기
// 잘라내기 계산은 등록 CLI(_infra/wallpaper.mjs)와 같은 /_shared/crop.js 를 쓴다.
import { coverCrop } from "/_shared/crop.js";

const item = JSON.parse(document.getElementById("item-data").textContent);
const stage = document.getElementById("stage-image");
const fitNote = document.getElementById("fit-note");
const fitResult = document.getElementById("fit-result");
const widthInput = document.getElementById("fit-width");
const heightInput = document.getElementById("fit-height");
const saveButton = document.getElementById("fit-save");
const caseCanvas = document.getElementById("case-canvas");
const caseSave = document.getElementById("case-save");

// 화면에 띄우고 잘라낼 원본: 가장 픽셀이 많은 규격. 크기를 모르는 항목(손으로
// 쓴 metadata)은 맨 앞을 쓴다.
const source = [...item.downloads].sort(
  (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0),
)[0];
const isPng = /\.png$/i.test(source?.file || "");
let focus = "center";
let sourceImage = null;

// iOS 사파리는 blob 다운로드에서 download 속성을 무시하고 그냥 열어 버린다.
// 그 경우엔 새 탭으로 띄우고 "길게 눌러 저장"을 안내한다.
const isIos = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(src));
    image.src = src;
  });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  if (isIos) {
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "새 탭에서 열었습니다 — 이미지를 길게 눌러 사진에 저장하세요.";
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "";
}

const toBlob = (canvas) => new Promise((resolve) =>
  canvas.toBlob(resolve, isPng ? "image/png" : "image/jpeg", 0.92));

// ── ① 원본 보기 ─────────────────────────────────────────────────────────
async function showSource() {
  if (!source) return;
  try {
    sourceImage = await loadImage(source.url);
    stage.src = source.url;
  } catch {
    /* 미리보기가 이미 떠 있으므로 원본 로드 실패는 조용히 넘어간다 */
  }
}

// ── ② 내 기기에 맞게 잘라서 저장 ────────────────────────────────────────
function detectScreen() {
  const ratio = window.devicePixelRatio || 1;
  return {
    width: Math.round(screen.width * ratio),
    height: Math.round(screen.height * ratio),
  };
}

function fillDetected() {
  const { width, height } = detectScreen();
  widthInput.value = width;
  heightInput.value = height;
  fitNote.textContent =
    `이 화면은 ${width}×${height}으로 보입니다. 다른 기기에 쓰려면 숫자를 고쳐도 됩니다.`;
}

function targetSize() {
  const width = Math.round(Number(widthInput.value));
  const height = Math.round(Number(heightInput.value));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 120 || height < 120) return null;
  return { width: Math.min(8000, width), height: Math.min(8000, height) };
}

async function saveFitted() {
  const target = targetSize();
  if (!target) {
    fitResult.textContent = "가로·세로를 120 이상 숫자로 적어주세요.";
    return;
  }
  if (!sourceImage) {
    try {
      sourceImage = await loadImage(source.url);
    } catch {
      fitResult.textContent = "원본을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      return;
    }
  }
  saveButton.disabled = true;
  saveButton.textContent = "만드는 중…";
  try {
    const box = coverCrop(sourceImage.naturalWidth, sourceImage.naturalHeight, target.width, target.height, focus);
    // 확대는 하지 않는다 — 원본이 작으면 비율만 맞춘 원본 해상도로 낸다.
    const scale = Math.min(1, target.width / box.width, target.height / box.height);
    const outWidth = scale >= 1 ? box.width : target.width;
    const outHeight = scale >= 1 ? box.height : target.height;
    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(sourceImage, box.x, box.y, box.width, box.height, 0, 0, outWidth, outHeight);
    const blob = await toBlob(canvas);
    if (!blob) throw new Error("encode");
    const hint = saveBlob(blob, `${item.id}-${outWidth}x${outHeight}.${isPng ? "png" : "jpg"}`);
    const short = outWidth < target.width || outHeight < target.height;
    fitResult.textContent = [
      `${outWidth}×${outHeight}으로 저장했습니다.`,
      short ? `원본이 ${target.width}×${target.height}보다 작아 비율만 맞췄습니다(확대하지 않습니다).` : "",
      hint,
    ].filter(Boolean).join(" ");
  } catch {
    fitResult.textContent = "이미지를 만들지 못했습니다. 규격별 원본 받기를 이용해주세요.";
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "↓ 잘라서 저장";
  }
}

// ── ③ 폰 케이스 목업 ────────────────────────────────────────────────────
// 실제 케이스 사진에 합성하는 게 아니라, 케이스 실루엣(둥근 모서리 + 카메라
// 구멍)에 배경화면을 채워 "이 그림이 케이스에 어떻게 앉는지"만 보여준다.
// 값은 모두 케이스 몸통 폭 대비 비율. 카메라 섬은 거의 정사각이라 한 변만 둔다.
const CASE = {
  radius: 0.13,
  camera: { x: 0.06, y: 0.028, size: 0.36, radius: 0.09 },
};

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function drawCase(image) {
  const context = caseCanvas.getContext("2d");
  const { width, height } = caseCanvas;
  const pad = Math.round(width * 0.04);
  const bodyWidth = width - pad * 2;
  const bodyHeight = height - pad * 2;
  const radius = bodyWidth * CASE.radius;

  context.clearRect(0, 0, width, height);
  context.save();
  // 케이스 그림자
  context.shadowColor = "#0000004d";
  context.shadowBlur = pad * 1.6;
  context.shadowOffsetY = pad * 0.5;
  roundedRect(context, pad, pad, bodyWidth, bodyHeight, radius);
  context.fillStyle = "#111";
  context.fill();
  context.restore();

  // 배경화면을 케이스 안쪽에 채우기(cover)로 앉힌다
  context.save();
  roundedRect(context, pad, pad, bodyWidth, bodyHeight, radius);
  context.clip();
  const box = coverCrop(image.naturalWidth, image.naturalHeight, bodyWidth, bodyHeight);
  context.drawImage(image, box.x, box.y, box.width, box.height, pad, pad, bodyWidth, bodyHeight);
  context.restore();

  // 카메라 구멍 — 케이스는 여기가 뚫려 있어서 그림이 잘린다
  const side = bodyWidth * CASE.camera.size;
  const camera = {
    x: pad + bodyWidth * CASE.camera.x,
    y: pad + bodyWidth * CASE.camera.y,
    width: side,
    height: side,
    radius: bodyWidth * CASE.camera.radius,
  };
  context.save();
  roundedRect(context, camera.x, camera.y, camera.width, camera.height, camera.radius);
  context.fillStyle = "#0b0b0c";
  context.fill();
  context.lineWidth = Math.max(2, bodyWidth * 0.006);
  context.strokeStyle = "#ffffff26";
  context.stroke();
  context.restore();

  // 렌즈 세 개
  const lens = camera.width * 0.26;
  for (const [cx, cy] of [[0.3, 0.28], [0.7, 0.28], [0.3, 0.72]]) {
    context.beginPath();
    context.arc(camera.x + camera.width * cx, camera.y + camera.height * cy, lens / 2, 0, Math.PI * 2);
    context.fillStyle = "#1c1e22";
    context.fill();
    context.lineWidth = Math.max(1, bodyWidth * 0.004);
    context.strokeStyle = "#ffffff1f";
    context.stroke();
  }

  // 가장자리 하이라이트 (케이스 두께 느낌)
  context.save();
  roundedRect(context, pad, pad, bodyWidth, bodyHeight, radius);
  context.lineWidth = Math.max(2, bodyWidth * 0.012);
  context.strokeStyle = "#ffffff2e";
  context.stroke();
  context.restore();
}

async function renderCase() {
  const image = sourceImage || await loadImage(source ? source.url : item.preview).catch(() => null);
  if (!image) return;
  drawCase(image);
  caseSave.disabled = false;
}

async function saveCase() {
  caseSave.disabled = true;
  const previous = caseSave.textContent;
  caseSave.textContent = "만드는 중…";
  try {
    const blob = await new Promise((resolve) => caseCanvas.toBlob(resolve, "image/png"));
    if (blob) saveBlob(blob, `${item.id}-case-mockup.png`);
  } finally {
    caseSave.textContent = previous;
    caseSave.disabled = false;
  }
}

// ── 시작 ────────────────────────────────────────────────────────────────
for (const chip of document.querySelectorAll("[data-focus]")) {
  chip.addEventListener("click", () => {
    focus = chip.dataset.focus;
    for (const other of document.querySelectorAll("[data-focus]")) {
      other.setAttribute("aria-pressed", String(other === chip));
    }
  });
}
saveButton.addEventListener("click", saveFitted);
caseSave.addEventListener("click", saveCase);
caseSave.disabled = true;

fillDetected();
await showSource();
await renderCase();
