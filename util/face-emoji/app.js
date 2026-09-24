import { FaceLandmarker, FilesetResolver } from "./vendor/vision_bundle.mjs";
import { assessFaceResult, landmarkBounds } from "./face-quality.js";
import { renderFaceEmoji } from "./face-renderer.js";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1600;

const fileInput = document.querySelector("#photoInput");
const chooseButton = document.querySelector("#choosePhoto");
const resetButton = document.querySelector("#reset");
const downloadButton = document.querySelector("#download");
const outputCanvas = document.querySelector("#output");
const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");
const engineEl = document.querySelector("#engineStatus");
const resultPanel = document.querySelector("#resultPanel");

let faceLandmarker = null;
let lastBlob = null;
let busy = false;

const setStatus = (message) => { statusEl.textContent = message || ""; };
const setError = (message) => { errorEl.textContent = message || ""; errorEl.hidden = !message; };
const setBusy = (value) => {
  busy = value;
  chooseButton.disabled = value || !faceLandmarker;
  fileInput.disabled = value || !faceLandmarker;
  resetButton.disabled = value;
  if (value) downloadButton.disabled = true;
};

function clearResult() {
  lastBlob = null;
  resultPanel.hidden = true;
  downloadButton.disabled = true;
  outputCanvas.width = 1;
  outputCanvas.height = 1;
  outputCanvas.hidden = true;
  window.blShareFiles = null;
}

function resetScreen() {
  if (busy) return;
  fileInput.value = "";
  clearResult();
  setError("");
  setStatus("사진을 고르면 이 브라우저에서만 얼굴을 읽어요.");
}

function localPath(path) {
  return new URL(path, import.meta.url).href;
}

async function prepareLandmarker() {
  engineEl.textContent = "얼굴 엔진을 준비하고 있어요…";
  try {
    const vision = await FilesetResolver.forVisionTasks(localPath("./vendor/wasm/"));
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: localPath("./vendor/face_landmarker.task"),
      },
      runningMode: "IMAGE",
      // 첫 결과는 한 명만 허용하지만, 두 명까지 탐지해야 여러 얼굴을 거부할 수 있다.
      numFaces: 2,
      minFaceDetectionConfidence: 0.65,
      minFacePresenceConfidence: 0.65,
      minTrackingConfidence: 0.65,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    engineEl.textContent = "얼굴 엔진 준비 완료 · 사진은 전송하지 않아요";
    chooseButton.disabled = false;
    fileInput.disabled = false;
  } catch (error) {
    console.error("face engine initialization failed", error);
    engineEl.textContent = "얼굴 엔진을 준비하지 못했어요.";
    setError("잠시 후 다시 열어주세요. 모델 파일을 불러오지 못했어요.");
    chooseButton.disabled = true;
    fileInput.disabled = true;
  }
}

async function decodeBitmap(file) {
  if (typeof createImageBitmap === "function") {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return resizeBitmap(bitmap);
    } catch {
      // 일부 모바일 브라우저는 File 옵션을 지원하지 않아 <img> 경로로 내려간다.
      if (bitmap && typeof bitmap.close === "function") bitmap.close();
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("이미지를 열 수 없습니다."));
      element.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return resizeBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function resizeBitmap(bitmap) {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_EDGE) return bitmap;
  const scale = MAX_EDGE / longest;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  if (typeof createImageBitmap === "function") {
    const resized = await createImageBitmap(canvas);
    if (typeof bitmap.close === "function") bitmap.close();
    return resized;
  }
  if (typeof bitmap.width === "number") {
    bitmap.width = 1;
    bitmap.height = 1;
  }
  return canvas;
}

function makeSourceCanvas(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function averageBrightness(canvas, bounds = null) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(1, Math.floor(Math.sqrt((canvas.width * canvas.height) / 10000)));
  const left = bounds ? Math.max(0, Math.floor(bounds.left * canvas.width)) : 0;
  const right = bounds ? Math.min(canvas.width, Math.ceil(bounds.right * canvas.width)) : canvas.width;
  const top = bounds ? Math.max(0, Math.floor(bounds.top * canvas.height)) : 0;
  const bottom = bounds ? Math.min(canvas.height, Math.ceil(bounds.bottom * canvas.height)) : canvas.height;
  let total = 0;
  let count = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const offset = (y * canvas.width + x) * 4;
      total += image.data[offset] * 0.2126
        + image.data[offset + 1] * 0.7152
        + image.data[offset + 2] * 0.0722;
      count++;
    }
  }
  return count ? total / count : 128;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG를 만들 수 없습니다.")), "image/png");
  });
}

async function processFile(file) {
  if (!file || busy) return;
  if (!faceLandmarker) {
    setError("얼굴 엔진이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.");
    return;
  }
  setError("");
  clearResult();
  if (!file.type.startsWith("image/")) {
    setError("이미지 파일만 골라주세요.");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setError("12MB보다 작은 사진을 골라주세요.");
    return;
  }

  setBusy(true);
  setStatus("사진은 브라우저 안에서만 읽고 있어요…");
  let bitmap = null;
  let sourceCanvas = null;
  try {
    bitmap = await decodeBitmap(file);
    sourceCanvas = makeSourceCanvas(bitmap);
    const result = faceLandmarker.detect(bitmap);
    const bounds = result.faceLandmarks?.[0] ? landmarkBounds(result.faceLandmarks[0]) : null;
    const quality = assessFaceResult(result, {
      brightness: averageBrightness(sourceCanvas, bounds),
    });
    if (!quality.ok) {
      setError(quality.message);
      setStatus("사진을 다시 골라주세요.");
      return;
    }

    setStatus("얼굴 특징으로 캐릭터를 그리고 있어요…");
    renderFaceEmoji(outputCanvas, result.faceLandmarks[0], { sourceCanvas });
    lastBlob = await canvasBlob(outputCanvas);
    outputCanvas.hidden = false;
    resultPanel.hidden = false;
    downloadButton.disabled = false;
    window.blShareFiles = async () => [new File([lastBlob], "face-emoji.png", { type: "image/png" })];
    setStatus("완성했어요. 결과 PNG만 기기에 저장할 수 있어요.");
  } catch (error) {
    console.error("face emoji processing failed", error);
    setError("이 사진은 처리하지 못했어요. 다른 사진을 골라주세요.");
    setStatus("");
  } finally {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
    else if (bitmap && typeof bitmap.width === "number") {
      bitmap.width = 1;
      bitmap.height = 1;
    }
    if (sourceCanvas) {
      sourceCanvas.width = 1;
      sourceCanvas.height = 1;
    }
    fileInput.value = "";
    setBusy(false);
  }
}

async function downloadResult() {
  if (!lastBlob) return;
  const url = URL.createObjectURL(lastBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "face-emoji.png";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

chooseButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => processFile(fileInput.files?.[0]));
resetButton.addEventListener("click", resetScreen);
downloadButton.addEventListener("click", downloadResult);
window.blShareText = () => "내 얼굴을 SD 캐릭터로 만들어봤어요";

setStatus("얼굴 엔진을 준비하는 중이에요.");
prepareLandmarker();
