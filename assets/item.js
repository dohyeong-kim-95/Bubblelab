// 배경화면 상세페이지. 빌드가 심어 둔 항목 데이터로 세 가지를 한다.
//  ① 원본을 크게 보기
//  ② 내 화면 해상도에 맞춰 잘라서 저장 (캔버스, 서버 왕복 없음)
//  ③ 폰 케이스 목업 미리보기
// 잘라내기 계산은 등록 CLI(_infra/wallpaper.mjs)와 같은 /_shared/crop.js 를 쓴다.
import { coverCrop } from "/_shared/crop.js";

const item = JSON.parse(document.getElementById("item-data").textContent);
const stage = document.getElementById("stage");
const viewImage = document.getElementById("view-image");
const thumbs = document.getElementById("thumbs");
const caseThumb = document.getElementById("case-thumb");
const viewNote = document.getElementById("view-note");
const fitNote = document.getElementById("fit-note");
const fitResult = document.getElementById("fit-result");
const widthInput = document.getElementById("fit-width");
const heightInput = document.getElementById("fit-height");
const saveButton = document.getElementById("fit-save");
const cropArea = document.getElementById("crop");
const cropImage = document.getElementById("crop-image");
const cropBox = document.getElementById("crop-box");
const cropNote = document.getElementById("crop-note");
const caseCanvas = document.getElementById("case-canvas");
const caseSave = document.getElementById("case-save");

// 화면에 띄우고 잘라낼 원본: 가장 픽셀이 많은 규격. 크기를 모르는 항목(손으로
// 쓴 metadata)은 맨 앞을 쓴다.
const source = [...item.downloads].sort(
  (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0),
)[0];
const isPng = /\.png$/i.test(source?.file || "");
let sourceImage = null;
// 잘라낼 영역: 원본 픽셀 기준 상자. 크기는 목표 비율에서 원본 안에 들어가는
// 최대치로 고정하고(확대하지 않으니 더 키울 수도, 줄일 이유도 없다) 위치만
// 사용자가 끌어서 정한다.
let crop = null;

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

// ── ① 미리보기 갤러리 (원본 | 케이스 목업) ──────────────────────────────
// 쇼핑몰 상품 이미지처럼 아래 썸네일을 누르거나 큰 그림을 좌우로 밀어 넘긴다.
const VIEWS = [
  { id: "image", note: "" },
  { id: "case", note: "이 배경화면을 폰 케이스에 얹으면 어떻게 보이는지 그려 봅니다. 인쇄용 파일이 아니라 미리보기입니다." },
];
let view = 0;

function showView(index) {
  view = (index + VIEWS.length) % VIEWS.length;
  const current = VIEWS[view];
  viewImage.hidden = current.id !== "image";
  caseCanvas.hidden = current.id !== "case";
  caseSave.hidden = current.id !== "case";
  viewNote.textContent = current.note;
  for (const tab of thumbs.querySelectorAll("[data-view]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === current.id));
  }
}

// 좌우로 밀어서 넘기기. 세로로 더 많이 움직였으면 페이지 스크롤이므로 무시한다.
function swipe(element) {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  element.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
  });
  element.addEventListener("pointerup", (event) => {
    if (!tracking) return;
    tracking = false;
    const dx = event.clientX - startX;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(event.clientY - startY)) return;
    showView(view + (dx < 0 ? 1 : -1));
  });
  element.addEventListener("pointercancel", () => { tracking = false; });
}

async function showSource() {
  if (!source) return;
  try {
    sourceImage = await loadImage(source.url);
    viewImage.src = source.url;
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

// 잘라낼 상자를 목표 비율에 맞춰 다시 잡는다. 이미 고른 위치가 있으면
// 가운데를 최대한 유지하고, 없으면 가운데에서 시작한다.
function resetCrop() {
  const target = targetSize();
  if (!sourceImage || !target) return;
  const previous = crop;
  const box = coverCrop(sourceImage.naturalWidth, sourceImage.naturalHeight, target.width, target.height);
  if (previous) {
    box.x = previous.x + previous.width / 2 - box.width / 2;
    box.y = previous.y + previous.height / 2 - box.height / 2;
  }
  crop = box;
  clampCrop();
  drawCrop();
}

function clampCrop() {
  crop.x = Math.round(Math.min(sourceImage.naturalWidth - crop.width, Math.max(0, crop.x)));
  crop.y = Math.round(Math.min(sourceImage.naturalHeight - crop.height, Math.max(0, crop.y)));
}

// 화면에 그려진 이미지 1px 이 원본 몇 px 인지
function displayScale() {
  const rect = cropImage.getBoundingClientRect();
  return rect.width ? sourceImage.naturalWidth / rect.width : 1;
}

function drawCrop() {
  if (!crop || !cropImage.getBoundingClientRect().width) return;
  const scale = displayScale();
  cropBox.style.left = `${crop.x / scale}px`;
  cropBox.style.top = `${crop.y / scale}px`;
  cropBox.style.width = `${crop.width / scale}px`;
  cropBox.style.height = `${crop.height / scale}px`;
  const freeX = sourceImage.naturalWidth - crop.width;
  const freeY = sourceImage.naturalHeight - crop.height;
  const movable = freeX > 1 || freeY > 1;
  cropArea.classList.toggle("crop--fixed", !movable);
  cropNote.textContent = movable
    ? `상자를 끌어서 남길 부분을 고르세요 (방향키로도 됩니다). 원본 ${sourceImage.naturalWidth}×${sourceImage.naturalHeight} 중 ${crop.width}×${crop.height}을 씁니다.`
    : "이 비율은 원본을 거의 그대로 쓰기 때문에 옮길 여지가 없습니다.";
  cropBox.setAttribute("aria-label",
    `잘라낼 영역 — 가로 ${Math.round(freeX ? (crop.x / freeX) * 100 : 50)}%, 세로 ${Math.round(freeY ? (crop.y / freeY) * 100 : 50)}% 위치`);
}

function startDrag(event) {
  if (!crop) return;
  const scale = displayScale();
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = crop.x;
  const originY = crop.y;
  cropBox.setPointerCapture(event.pointerId);
  cropArea.classList.add("crop--dragging");
  const move = (moveEvent) => {
    crop.x = originX + (moveEvent.clientX - startX) * scale;
    crop.y = originY + (moveEvent.clientY - startY) * scale;
    clampCrop();
    drawCrop();
  };
  const end = () => {
    cropArea.classList.remove("crop--dragging");
    cropBox.removeEventListener("pointermove", move);
    cropBox.removeEventListener("pointerup", end);
    cropBox.removeEventListener("pointercancel", end);
  };
  cropBox.addEventListener("pointermove", move);
  cropBox.addEventListener("pointerup", end);
  cropBox.addEventListener("pointercancel", end);
  event.preventDefault();
}

function nudge(event) {
  const steps = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  }[event.key];
  if (!steps || !crop) return;
  const step = (event.shiftKey ? 0.1 : 0.02);
  crop.x += steps[0] * sourceImage.naturalWidth * step;
  crop.y += steps[1] * sourceImage.naturalHeight * step;
  clampCrop();
  drawCrop();
  event.preventDefault();
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
    const box = crop || coverCrop(sourceImage.naturalWidth, sourceImage.naturalHeight, target.width, target.height);
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
  caseThumb.src = caseCanvas.toDataURL("image/png");
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
for (const tab of thumbs.querySelectorAll("[data-view]")) {
  tab.addEventListener("click", () => showView(VIEWS.findIndex((entry) => entry.id === tab.dataset.view)));
}
thumbs.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  showView(view + (event.key === "ArrowRight" ? 1 : -1));
  thumbs.querySelector('[aria-selected="true"]').focus();
  event.preventDefault();
});
swipe(stage);
showView(0);
cropBox.addEventListener("pointerdown", startDrag);
cropBox.addEventListener("keydown", nudge);
for (const input of [widthInput, heightInput]) input.addEventListener("input", resetCrop);
addEventListener("resize", drawCrop);
saveButton.addEventListener("click", saveFitted);
caseSave.addEventListener("click", saveCase);
caseSave.disabled = true;

fillDetected();
await showSource();
if (sourceImage) {
  cropImage.src = sourceImage.src;
  // 이미지가 실제로 배치된 뒤라야 화면 크기를 잴 수 있다
  if (!cropImage.complete) await new Promise((resolve) => { cropImage.onload = resolve; });
  resetCrop();
}
await renderCase();
