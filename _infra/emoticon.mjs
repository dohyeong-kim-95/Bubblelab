// 움직이는 이모티콘 제작 CLI (work/emoticon 툴 — 방법론은 work/emoticon/SKILL.md).
// AI로 프레임을 생성/가져와서 투명 배경 APNG로 굽는다. 외부 의존성 없음
// (AI 호출은 _infra/emoticon-ai.mjs, PNG/APNG는 자체 코덱).
//
//   node _infra/emoticon.mjs sheet  <작업폴더> --prompt "캐릭터 설명"
//   node _infra/emoticon.mjs cut    <작업폴더> <컷id> --motion "동작 설명" [--frames 12] [--fps 12]
//   node _infra/emoticon.mjs import <작업폴더> <컷id> <프레임폴더> [--fps 12] [--chroma]
//   node _infra/emoticon.mjs build  <작업폴더> <컷id> [--size 360] [--line]
//
// sheet:  캐릭터 시트 1장을 생성해 <작업폴더>/sheet.png 저장. 이후 모든 생성의
//         레퍼런스가 된다 (일관성의 축 — goal.md 판정 기준 1).
// cut:    시트를 레퍼런스로 초록(#00FF00) 배경 프레임을 순차 생성하고 크로마키로
//         투명화해 cuts/<컷id>/frames/NN.png 저장 (원본은 frames-raw/에 보존).
// import: 외부에서 만든 프레임(예: I2V 영상을 ffmpeg로 추출)을 같은 구조로 가져온다.
//         ffmpeg -i clip.mp4 -vf fps=12 f/%02d.png  →  import <작업폴더> <컷id> f --chroma
// build:  프레임 전체의 공통 경계로 잘라(프레임별 트리밍 금지 — 떨림 방지) 정사각
//         캔버스에 맞추고 APNG로 굽는다. out/<컷id>.png (기본 360² — 카카오·duri),
//         --line이면 out/<컷id>-line.png (270², 5~20프레임·300KB 검증 — LINE 규격).
//
// 작업폴더는 배포·커밋에서 제외되는 _src/emoticon/<캐릭터명>/ 을 쓴다.
// API 키는 GEMINI_API_KEY env로만 전달한다 (리포는 public — 커밋 금지).
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import { encodeApng, inspectApng } from "./apng.mjs";
import { encodeGif } from "./gif.mjs";
import { imageProvider } from "./emoticon-ai.mjs";
import { cutoutBackground, decodeSheet, sliceGrid } from "./sticker-pack.mjs";
import { renderGrid, renderPose } from "./skeleton.mjs";
import { PROFILES, buildReport, formatJudgement, judgeReport } from "./emoticon-gate.mjs";
import { breakdownPrompt, canonBlock, keyPrompt, sheetPrompt } from "./emoticon-prompt.mjs";
import { applyRig, faceDropRatio, liftFrame } from "./emoticon-rig.mjs";
import { RABBIT_PARTS, inspectParts } from "./emoticon-vision.mjs";
import { bytesToBase64, geminiAsk, resolveVisionModel } from "./emoticon-gen.js";
import { loadSequence } from "./skeleton-cli.mjs";
import {
  IMAGE_COST_USD,
  assertPlannedBudget,
  assertResumeCompatible,
  atomicWriteFile,
  atomicWriteJson,
  budgetedProvider,
  finishCutRun,
  planCost,
  prepareCutRun,
  readJson,
  sha256,
  specHash,
} from "./emoticon-run.mjs";

const CUT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_FRAMES = 24;        // 카카오 납품 상한
// 키 상한. 사람 검수가 "프레임이 적다"를 반복 지적했고 "편도 8프레임으로 가능"
// 이라는 구체적 요구가 있었다 (lesson_learned §39). 비용은 --max-calls로 막는다.
const MAX_KEYS = 12;
const LINE_FRAMES = [5, 20];  // LINE 애니메이션 스티커 프레임 범위
const LINE_SIZE = 270;        // 320x270 이내 + 한 변 ≥270 → 정사각 270
const LINE_MAX_BYTES = 300 * 1024;
const TRIM_PADDING = 8;
const pad2 = (n) => String(n).padStart(2, "0");

// ── 픽셀 유틸 ───────────────────────────────────────────────────────────

// 초록(#00FF00 계열) 단색 배경 크로마키. keyness = G - max(R,B) 기준으로
// full 이상 완전 투명, soft–full 구간은 반투명 + 초록 번짐 제거(despill).
export function chromaKeyGreen(image, { full = 120, soft = 48 } = {}) {
  const data = new Uint8Array(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const spill = Math.max(data[i], data[i + 2]);
    const keyness = data[i + 1] - spill;
    if (keyness <= soft) continue;
    data[i + 3] = keyness >= full ? 0 : Math.round((1 - (keyness - soft) / (full - soft)) * data[i + 3]);
    data[i + 1] = spill; // 경계 초록 잔광 제거
  }
  return { width: image.width, height: image.height, data };
}

// 배경 자동 판별 누끼: 모서리 표본이 초록이면 크로마키, 아니면 흰 배경
// 플러드필(sticker-pack의 cutoutBackground — 기존 팩들로 검증된 경로).
// AI가 배경 지시를 어기고 흰 배경으로 생성해도 파이프라인이 계속 간다.
export function autoCutout(image) {
  const { width, height, data } = image;
  let r = 0, g = 0, b = 0;
  const corners = [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4];
  for (const i of corners) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const greenish = g / 4 - Math.max(r / 4, b / 4) > 60;
  return greenish ? chromaKeyGreen(image) : cutoutBackground(image);
}

// 박스 평균 리샘플 (알파 가중 — 반투명 경계에서 배경색이 번지지 않게)
// 캐릭터에서 떨어져 나온 잉크를 지운다 — 바닥선·그림자·부스러기.
//
// 왜: 모델이 지시하지 않은 바닥선을 그린다(bounce2는 6장 전부). 스티커는 배경이
// 투명해야 하고, 게다가 점프로 프레임을 올리면 "바닥"까지 같이 올라가 우스워진다.
// 누끼된 프레임에서 캐릭터는 하나의 연결 덩어리이므로 가장 큰 덩어리만 남긴다.
//
// **효과 기호(하트·땀방울)를 쓰는 컷에서는 꺼야 한다** — 그것들도 떨어진
// 덩어리라 같이 지워진다. cut.json의 strays:"keep".
// 모델이 지시하지 않고 그려 넣는 **바닥선**을 지운다.
//
// 방법: **열별 두께**를 본다. 바닥에서 위로 이어지는 불투명 길이를 열마다 재면
// 바닥선만 있는 열은 전부 같은 값이고(실측 bounce2: 11px가 203열로 압도적),
// 몸·발이 위에 얹힌 열은 훨씬 크다. 그 최빈 두께가 곧 선의 두께다.
//
// 폭 비율로 잡던 이전 방식은 임계값에 의존했고(1.35에서 한 프레임을 놓쳐
// 1.30으로 낮춰야 했다) 두께는 선 자체를 직접 재므로 임계값이 필요 없다.
// 발이 땅에 붙어 있어도 잡힌다 — 발 아래 선만 걷어내고 발 외곽선은 남는다
// (확대 검증 완료).
export function dropGroundLine(image, { maxThicknessRatio = 0.06, minSpan = 0.7, minColumns = 20 } = {}) {
  const { width, height, data } = image;
  const opaque = (x, y) => data[(y * width + x) * 4 + 3] > 16;
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y)) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return { image, removed: 0 };
  const characterHeight = bottom - top + 1;
  const maxThickness = Math.round(characterHeight * maxThicknessRatio);

  // 열별 바닥 두께 → 얇은 열들의 최빈값이 선의 두께
  const runs = new Int32Array(right - left + 1);
  const tally = new Map();
  for (let x = left; x <= right; x++) {
    let n = 0;
    for (let y = bottom; y >= 0 && opaque(x, y); y--) n++;
    runs[x - left] = n;
    if (n > 0 && n <= maxThickness) tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  let thickness = 0;
  let best = 0;
  for (const [value, count] of tally) if (count > best) { best = count; thickness = value; }
  if (!thickness) return { image, removed: 0 };
  // 선이라면 **가로로 걸쳐 있어야** 한다. 개수로 보면 안 된다 — 발이 넓게
  // 깔리면 순수 선 열이 확 줄기 때문이다(실측: 웅크린 프레임에서 203열 → 80열).
  // 걸친 범위로 보면 웅크림 99%·공중 75%다(공중에서는 팔이 선보다 넓게 벌어져
  // 분모가 커진다). 0.7이면 6/6을 잡고 기존 60프레임에서 오탐 0건 —
  // 0.5까지 내려도 오탐은 없었지만 여유를 남긴다.
  let first = -1;
  let last = -1;
  for (let x = left; x <= right; x++) {
    if (runs[x - left] !== thickness) continue;
    if (first < 0) first = x;
    last = x;
  }
  if (best < minColumns || last - first + 1 < (right - left + 1) * minSpan) {
    return { image, removed: 0 };
  }

  const out = new Uint8Array(data);
  let removed = 0;
  for (let x = left; x <= right; x++) {
    if (!runs[x - left]) continue;
    for (let y = bottom; y > bottom - thickness; y--) {
      const i = (y * width + x) * 4 + 3;
      if (out[i] > 0) { out[i] = 0; removed++; }
    }
  }
  return { image: { width, height, data: out }, removed, bandHeight: thickness };
}

export function dropStrays(image) {
  const { width, height, data } = image;
  const label = new Int32Array(width * height).fill(-1);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < width * height; start++) {
    if (label[start] >= 0 || data[start * 4 + 3] <= 16) continue;
    const id = sizes.length;
    let count = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      count++;
      const x = p % width;
      const y = (p / width) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && label[q] < 0 && data[q * 4 + 3] > 16) { label[q] = id; stack.push(q); }
      }
    }
    sizes.push(count);
  }
  if (sizes.length <= 1) return image;
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
  const out = new Uint8Array(data);
  let removed = 0;
  for (let p = 0; p < width * height; p++) {
    if (label[p] >= 0 && label[p] !== main) { out[p * 4 + 3] = 0; removed++; }
  }
  return { image: { width, height, data: out }, removed };
}

export function resize(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const data = new Uint8Array(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * image.width + px) * 4;
          const alpha = image.data[i + 3];
          r += image.data[i] * alpha;
          g += image.data[i + 1] * alpha;
          b += image.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const out = (y * width + x) * 4;
      data[out] = a ? Math.round(r / a) : 0;
      data[out + 1] = a ? Math.round(g / a) : 0;
      data[out + 2] = a ? Math.round(b / a) : 0;
      data[out + 3] = Math.round(a / n);
    }
  }
  return { width, height, data };
}

// 모든 프레임을 관통하는 내용(알파>0) 경계 상자 — 프레임별로 따로 자르면
// 컷 안에서 캐릭터가 떨리므로 반드시 공통 경계 하나로 자른다.
export function unionBounds(frames) {
  let left = Infinity, top = Infinity, right = -1, bottom = -1;
  for (const { width, height, data } of frames) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === 0) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

function cropAll(frames, { left, top, right, bottom }) {
  const x = Math.max(0, left - TRIM_PADDING);
  const y = Math.max(0, top - TRIM_PADDING);
  const w = Math.min(frames[0].width - 1, right + TRIM_PADDING) - x + 1;
  const h = Math.min(frames[0].height - 1, bottom + TRIM_PADDING) - y + 1;
  return frames.map((f) => {
    const data = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) {
      const src = ((y + row) * f.width + x) * 4;
      data.set(f.data.subarray(src, src + w * 4), row * w * 4);
    }
    return { width: w, height: h, data };
  });
}

// 공통 경계로 자른 프레임들을 size² 투명 캔버스에 비율 유지로 맞춰 중앙 배치
// 몸 기준점 — 발 바닥선과 하체 가로 중심. 팔을 들면 실루엣 폭이 바뀌므로
// 전체 bbox는 기준이 될 수 없고, **동작과 무관하게 고정되어야 하는 부위**로
// 잡아야 한다. 하체(아래 22%)는 우리 포즈 규약상 항상 제자리다.
export function bodyAnchor(image) {
  const { width, height, data } = image;
  let bottom = -1;
  let top = height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 128) { if (y > bottom) bottom = y; if (y < top) top = y; break; }
    }
  }
  if (bottom < 0) return null;
  const from = Math.round(bottom - (bottom - top) * 0.22);
  let sum = 0;
  let count = 0;
  for (let y = Math.max(0, from); y <= bottom; y++) {
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 128) { sum += x; count++; }
  }
  return count ? { x: sum / count, y: bottom } : null;
}

// 프레임을 공통 몸 기준점으로 평행이동한다.
//
// 왜: 모델은 프레임마다 캐릭터를 새로 그리므로 몸이 몇 px씩 움직인다. 실측
// (wave2) 하체 중심 502~517px — 재생하면 "몸이 갑자기 translation"하고
// "다른 그림을 붙여놓은" 느낌이 난다는 검수 지적으로 드러났다. 이 축도 좌우
// 방향처럼 텍스트로 통제할 수 없으니 코드로 잡는다. 무손실 평행이동이다.
//
// 통통튀기처럼 **몸이 실제로 움직여야 하는 컷은 끄고 쓴다**(anchor: "none").
export function alignFrames(frames) {
  const anchors = frames.map(bodyAnchor);
  if (anchors.some((a) => !a)) return frames;
  const mid = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
  const target = { x: mid(anchors.map((a) => a.x)), y: mid(anchors.map((a) => a.y)) };
  return frames.map((frame, i) => {
    const dx = Math.round(target.x - anchors[i].x);
    const dy = Math.round(target.y - anchors[i].y);
    if (!dx && !dy) return frame;
    const { width, height, data } = frame;
    const out = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= height) continue;
      for (let x = 0; x < width; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= width) continue;
        const to = (y * width + x) * 4;
        const src = (sy * width + sx) * 4;
        for (let c = 0; c < 4; c++) out[to + c] = data[src + c];
      }
    }
    return { width, height, data: out };
  });
}

export function fitFrames(frames, size) {
  const bounds = unionBounds(frames);
  if (!bounds) throw new Error("모든 프레임이 비어 있습니다 — 크로마키 결과를 확인하세요");
  const cropped = cropAll(frames, bounds);
  const scale = Math.min(size / cropped[0].width, size / cropped[0].height);
  const w = Math.max(1, Math.round(cropped[0].width * scale));
  const h = Math.max(1, Math.round(cropped[0].height * scale));
  const ox = (size - w) >> 1;
  const oy = (size - h) >> 1;
  return cropped.map((frame) => {
    const scaled = resize(frame, w, h);
    const data = new Uint8Array(size * size * 4);
    for (let row = 0; row < h; row++) {
      data.set(scaled.data.subarray(row * w * 4, (row + 1) * w * 4), ((oy + row) * size + ox) * 4);
    }
    return { width: size, height: size, data };
  });
}

// 프레임별 캐릭터 경계 상자 → 크기·위치 드리프트 측정.
// 픽셀 diff는 "의도한 움직임"과 "원치 않는 드리프트"를 구분하지 못한다.
// 캐릭터 높이가 프레임마다 출렁이면 재생 시 펄스처럼 보이는데, 그건
// 동작이 아니라 결함이다 — 이 지표가 둘을 갈라준다.
export function frameBounds({ width, height, data }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return {
    height: bottom - top + 1,
    width: right - left + 1,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

// 프레임 시퀀스의 크기 드리프트: 캐릭터 높이의 (최대-최소)/중앙값.
// 0.15(15%)를 넘으면 재생 시 캐릭터가 커졌다 작아졌다 하는 게 보인다.
export function scaleDrift(frames) {
  const heights = frames.map(frameBounds).filter(Boolean).map((b) => b.height);
  if (heights.length < 2) return 0;
  const sorted = [...heights].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  return median ? (sorted[sorted.length - 1] - sorted[0]) / median : 0;
}

// 정렬 후 움직임량: 각 프레임을 자기 경계 상자로 잘라 같은 크기로 맞춘 뒤
// 인접 프레임 차이를 잰다. 크기·위치 드리프트가 제거되므로 남는 것은
// **실제 자세 변화**뿐이다.
//
// 이 지표가 없으면 "거의 정지한 컷"이 드리프트·인접 diff 모두 좋게 나와
// 최고 품질로 오판된다 (heart 사례). 좋은 컷 = 움직임 크고 드리프트 작음.
export function alignedMotion(frames, size = 96) {
  const norm = frames.map((frame) => {
    const b = frameBounds(frame);
    if (!b) return null;
    const left = Math.max(0, Math.round(b.centerX - b.width / 2));
    const top = Math.max(0, Math.round(b.centerY - b.height / 2));
    const data = new Uint8Array(b.width * b.height * 4);
    for (let y = 0; y < b.height; y++) {
      const src = ((top + y) * frame.width + left) * 4;
      data.set(frame.data.subarray(src, src + b.width * 4), y * b.width * 4);
    }
    return resize({ width: b.width, height: b.height, data }, size, size);
  }).filter(Boolean);
  if (norm.length < 2) return { mean: 0, max: 0 };
  const diffs = [];
  for (let i = 1; i < norm.length; i++) diffs.push(loopDiff(norm[i - 1], norm[i]));
  return {
    mean: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    max: Math.max(...diffs),
  };
}

export function transparencyRatio({ width, height, data }) {
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
  return transparent / (width * height);
}

// 루프 품질: 첫/끝 프레임의 평균 픽셀 차이 (0=완벽한 루프, 1=완전 상이).
// 둘 중 한쪽이라도 내용이 있는 픽셀만 센다.
export function loopDiff(a, b) {
  let sum = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] === 0 && b.data[i + 3] === 0) continue;
    n++;
    for (let c = 0; c < 4; c++) sum += Math.abs(a.data[i + c] - b.data[i + c]);
  }
  return n ? sum / (n * 4 * 255) : 0;
}

// ── 프롬프트 (실측하며 다듬는 지점 — SKILL.md §1·§2) ────────────────────
// 지시 골격은 영어(이미지 모델의 지시 추종이 더 정확), 사용자가 쓴 캐릭터
// 설명·포즈 문장은 받은 언어 그대로 삽입한다. 수정 시 페이지(index.html)와 동기화.

const SHEET_PROMPT = (desc) => sheetPrompt(desc);

// 순차 생성(구식) 프롬프트. keys 모드가 표준이라 여기는 유지만 한다.
const FRAME_PROMPT = (motion, index, total, pose = "") =>
  keyPrompt({ motion, index, total, pose: pose || `frame ${index} of the motion`, canon: canonBlock() });

// keys 모드 — 변화 먼저, 불변 나중 (work/emoticon/doc/prompting.md §3).
// invariants는 "부품 인벤토리"로 쓴다: 있는 것을 개수와 함께 열거하면
// 부정어 없이 여분의 귀·발바닥 패드를 함께 막을 수 있다 (§2).
// poseConstants는 부품 목록(invariants)과 다르다. invariants는 "무엇이 몇 개
// 있는가"(CANON), poseConstants는 "그것들이 매 프레임 어디에 어떤 모양으로
// 있는가"(POSE)다. 개수는 CANON이 지키지만 위치·형태는 POSE에서 말해야 한다
// (prompting.md §4-1 ③).
const KEY_PROMPT = (motion, index, total, pose, invariants = "", constants = "") =>
  keyPrompt({ motion, index, total, pose, constants, canon: canonBlock({ parts: invariants }) });


const BREAKDOWN_PROMPT = (motion, poseA, poseB, invariants = "", constants = "", percent = 50, note = "") =>
  breakdownPrompt({ motion, poseA, poseB, constants, note, percent, canon: canonBlock({ parts: invariants }) });

// ── 명령 구현 ───────────────────────────────────────────────────────────

async function toRgba(bytes) {
  return decodeSheet(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}

async function reusableRaw(path) {
  if (!existsSync(path)) return null;
  try {
    const bytes = readFileSync(path);
    const keyed = autoCutout(await toRgba(bytes));
    return transparencyRatio(keyed) >= 0.05 ? { bytes, keyed } : null;
  } catch {
    return null;
  }
}

async function reusableGridRaw(path, cols, rows, count) {
  if (!existsSync(path)) return null;
  try {
    const bytes = readFileSync(path);
    const cells = sliceGrid(await toRgba(bytes), cols, rows).slice(0, count);
    if (cells.length !== count || cells.some((cell) => transparencyRatio(autoCutout(cell)) < 0.05)) return null;
    return bytes;
  } catch {
    return null;
  }
}

// 브레이크다운 파일명. N=1은 옛 이름(bd-1-2.png)을 유지해 기존 컷의
// resume·redo가 그대로 돈다. N>1이면 슬롯 번호를 붙인다.
function bdName(a, b, slot, total) {
  return total === 1 ? `bd-${a + 1}-${b + 1}.png` : `bd-${a + 1}-${b + 1}-${slot + 1}.png`;
}

// 슬롯 k(0-based)가 두 키 사이 몇 %에 놓이는가. N=1→50, N=2→33·67, N=3→25·50·75.
function bdPercent(slot, total) {
  return Math.round(((slot + 1) / (total + 1)) * 100);
}

function keyTiming(keys, pairs, breakdowns, assembly, fps, repeat = 1) {
  const delays = [];
  for (let i = 0; i < keys.length; i++) {
    delays.push(Math.max(1, Number(keys[i].hold ?? 1)));
    if (pairs.some(([a, b]) => a === i && b === i + 1)) for (let k = 0; k < breakdowns; k++) delays.push(1);
  }
  if (assembly === "loop") for (let k = 0; k < breakdowns; k++) delays.push(1);
  const cycle = assembly === "pingpong" ? [...delays, ...delays.slice(1, -1).reverse()] : delays;
  const timeline = Array.from({ length: repeat }, () => cycle).flat();
  return {
    uniqueFrames: delays.length,
    timelineFrames: timeline.length,
    durationSeconds: timeline.reduce((sum, delay) => sum + delay, 0) / fps,
  };
}

function provenance(mode, input, referenceBytes) {
  const referenceHashes = referenceBytes.map(sha256);
  return {
    mode,
    specHash: specHash(input),
    sheetHash: referenceHashes[0],
    referenceHashes,
  };
}

// 캐릭터 레퍼런스: --ref로 단일 정면 컷을 줄 수 있다.
// 여러 컷이 든 시트를 주면 모델이 "시트를 복제하라"로 해석하는 사고가 있었고,
// 단일 컷으로 바꾸자 크기 드리프트가 74.2%→0.6%로 떨어졌다 (lesson_learned §23).
function characterReferencePath(workdir, options = {}) {
  const path = options.ref ?? join(workdir, "sheet.png");
  if (!existsSync(path)) {
    throw new Error(options.ref
      ? `캐릭터 레퍼런스가 없습니다: ${path}`
      : `캐릭터 시트가 없습니다 — 먼저: emoticon.mjs sheet ${workdir} --prompt "..."`);
  }
  return path;
}

function assertCurrentReference(meta, workdir) {
  if (!meta.sheetHash || meta.mode === "import") return;
  const path = meta.characterRef && meta.characterRef !== "sheet.png"
    ? meta.characterRef
    : join(workdir, "sheet.png");
  if (!existsSync(path) || sha256(readFileSync(path)) !== meta.sheetHash) {
    throw new Error(`컷의 캐릭터 레퍼런스가 현재 파일과 다릅니다: ${path} — 원래 레퍼런스를 복원하거나 컷을 --force로 재생성하세요`);
  }
}

function checkPlanTarget(cutDir, options, base) {
  if (options.force && options.resume) throw new Error("--force와 --resume은 함께 사용할 수 없습니다");
  if (existsSync(cutDir) && !options.force && !options.resume) {
    throw new Error(`이미 존재하는 컷입니다: ${cutDir} (이어하려면 --resume, 교체하려면 --force)`);
  }
  if (options.resume) {
    const metaPath = join(cutDir, "cut.json");
    if (!existsSync(metaPath)) throw new Error(`--resume 메타가 없습니다: ${metaPath} — --force로 새로 생성하세요`);
    assertResumeCompatible(readJson(metaPath), base);
  }
}

function printPlan(plan, options) {
  assertPlannedBudget(plan, options);
  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(`모드: ${plan.mode}, 프로바이더: ${plan.provider}`);
  console.log(`호출: ${plan.remainingCalls}/${plan.totalCalls}회 (재사용 ${plan.reusedCalls}회)`);
  if (plan.possibleRetryCalls) console.log(`추가 재시도 가능: 최대 ${plan.possibleRetryCalls}회 (런타임 상한 적용)`);
  console.log(`예상 비용: $${plan.estimatedCostUsd.toFixed(3)} (호출당 $${IMAGE_COST_USD})`);
  console.log(`출력: ${plan.frames}프레임, ${plan.durationSeconds.toFixed(2)}초`);
}

async function cmdSheet(workdir, options) {
  if (!options.prompt?.trim()) throw new Error("--prompt (캐릭터 설명)은 필수입니다");
  const path = join(workdir, "sheet.png");
  if (existsSync(path) && !options.force) {
    throw new Error(`이미 시트가 있습니다: ${path} (덮어쓰려면 --force — 시트를 바꾸면 기존 컷과 일관성이 깨진다)`);
  }
  const provider = imageProvider();
  const bytes = await provider.generate({ prompt: SHEET_PROMPT(options.prompt.trim()) });
  mkdirSync(workdir, { recursive: true });
  atomicWriteFile(path, encodePng(await toRgba(bytes)));
  atomicWriteFile(join(workdir, "sheet-prompt.txt"), options.prompt.trim() + "\n");
  console.log(`✓ 캐릭터 시트 저장 (${provider.name}) → ${path}`);
  console.log("시트가 마음에 들 때까지 --force로 다시 뽑은 뒤 cut을 시작하세요.");
}

async function cmdCut(workdir, cutId, options) {
  if (options.skeletons) return cmdCutSkeleton(workdir, cutId, options);
  if (options.keys) return cmdCutKeys(workdir, cutId, options);
  if (!CUT_ID_RE.test(cutId ?? "")) throw new Error(`컷 id는 영소문자·숫자·하이픈만 가능합니다: ${cutId}`);
  if (!options.motion?.trim()) throw new Error("--motion (동작 설명)은 필수입니다");
  const total = Number(options.frames ?? 12);
  const fps = Number(options.fps ?? 12);
  if (!Number.isInteger(total) || total < 2 || total > MAX_FRAMES) {
    throw new Error(`--frames 는 2~${MAX_FRAMES} 정수여야 합니다 (카카오 상한 24)`);
  }
  const sheetPath = join(workdir, "sheet.png");
  if (!existsSync(sheetPath)) throw new Error(`캐릭터 시트가 없습니다 — 먼저: emoticon.mjs sheet ${workdir} --prompt "..."`);
  const cutDir = join(workdir, "cuts", cutId);
  // 포즈 스크립트(선택): 줄당 1개 = 프레임당 1개. 프레임 간 튐(보일링)을
  // 줄이는 핵심 수단 — 동작 진행을 프레임 번호가 아니라 포즈 문장으로 고정한다.
  let poses = null;
  if (options.poses) {
    poses = readFileSync(options.poses, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    if (poses.length !== total) {
      throw new Error(`포즈 스크립트는 프레임 수와 같아야 합니다 (포즈 ${poses.length}줄 ≠ ${total}프레임)`);
    }
  }

  const sheet = readFileSync(sheetPath);
  const provider = imageProvider();
  const input = { motion: options.motion.trim(), frames: total, fps, poses };
  const base = provenance("sequential", input, [sheet]);
  checkPlanTarget(cutDir, options, base);
  let reusable = 0;
  if (options.resume) {
    for (let i = 1; i <= total; i++) if (await reusableRaw(join(cutDir, "frames-raw", `${pad2(i)}.png`))) reusable++;
  }
  const plan = {
    mode: "sequential", provider: provider.name, totalCalls: total,
    remainingCalls: total - reusable, reusedCalls: reusable, possibleRetryCalls: 0,
    estimatedCostUsd: planCost(total - reusable), frames: total, durationSeconds: total / fps,
  };
  assertPlannedBudget(plan, options);
  const state = prepareCutRun({ cutDir, options, base, provider: provider.name });
  const metered = budgetedProvider(provider, options, plan, state);
  mkdirSync(join(cutDir, "frames"), { recursive: true });
  mkdirSync(join(cutDir, "frames-raw"), { recursive: true });

  try {
    const rawFrames = [];
    for (let i = 1; i <= total; i++) {
      const rawPath = join(cutDir, "frames-raw", `${pad2(i)}.png`);
      let item = options.resume ? await reusableRaw(rawPath) : null;
      const reused = Boolean(item);
      if (!item) {
        const references = [sheet, ...(rawFrames.length ? [rawFrames[0]] : []), ...(rawFrames.length > 1 ? [rawFrames[rawFrames.length - 1]] : [])];
        const bytes = await metered.generate({
          prompt: FRAME_PROMPT(options.motion.trim(), i, total, poses?.[i - 1] ?? ""),
          references,
        });
        atomicWriteFile(rawPath, Buffer.from(bytes));
        item = await reusableRaw(rawPath);
        if (!item) throw new Error(`프레임 ${pad2(i)} 누끼 실패 — frames-raw/${pad2(i)}.png 확인 후 --resume으로 재시도`);
      }
      rawFrames.push(item.bytes);
      const ratio = transparencyRatio(item.keyed);
      atomicWriteFile(join(cutDir, "frames", `${pad2(i)}.png`), encodePng(item.keyed));
      console.log(`  프레임 ${pad2(i)}/${pad2(total)} (투명 ${Math.round(ratio * 100)}%${reused ? ", raw 재사용" : ""})`);
    }
    finishCutRun(state, "complete", null, { ...input, ...base });
  } catch (error) {
    finishCutRun(state, "failed", error);
    throw error;
  }
  console.log(`✓ ${cutId} 컷 생성 (${total}프레임) → ${cutDir}`);
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

// pose-to-pose 모드: 키 포즈(극단) 먼저 생성 → 키 쌍 양쪽을 레퍼런스로
// 브레이크다운 생성 → 핑퐁/홀드/프레임별 delay로 조립 타임라인 작성.
// 순차 생성(1→N)의 드리프트 누적을 구조적으로 피한다.
// spec(JSON): { motion?, keys: [{pose, hold?}], breakdowns?: 0|1,
//               assembly?: "pingpong"|"loop", fps? }
async function cmdCutKeys(workdir, cutId, options) {
  if (!CUT_ID_RE.test(cutId ?? "")) throw new Error(`컷 id는 영소문자·숫자·하이픈만 가능합니다: ${cutId}`);
  const spec = JSON.parse(readFileSync(options.keys, "utf8"));
  const motion = String(options.motion ?? spec.motion ?? "").trim();
  if (!motion) throw new Error("동작 설명이 필요합니다 (--motion 또는 spec.motion)");
  const keys = spec.keys;
  if (!Array.isArray(keys) || keys.length < 2 || keys.length > MAX_KEYS || keys.some((k) => !k?.pose?.trim())) {
    throw new Error(`keys는 pose 문장을 가진 2~${MAX_KEYS}개의 키 포즈여야 합니다`);
  }
  const breakdowns = Number(spec.breakdowns ?? 1);
  if (![0, 1, 2, 3].includes(breakdowns)) throw new Error("breakdowns는 0~3만 지원합니다");
  const assembly = spec.assembly ?? "pingpong";
  if (!["pingpong", "loop"].includes(assembly)) throw new Error('assembly는 "pingpong" 또는 "loop"');
  const invariants = String(spec.invariants ?? "").trim();
  const poseConstants = String(spec.poseConstants ?? "").trim();
  const breakdownNote = String(spec.breakdownNote ?? "").trim();
  // repeat: 같은 타임라인을 N번 반복한다. 생성 비용은 그대로 두고 길이만 늘리는
  // 리미티드 애니메이션식 재사용 — 2초 안에 여러 번 끄덕이려면 필요하다.
  const repeat = Number(spec.repeat ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 8) throw new Error("repeat은 1~8 정수여야 합니다");
  const fps = Number(options.fps ?? spec.fps ?? 12);
  const sheetPath = characterReferencePath(workdir, options);
  const cutDir = join(workdir, "cuts", cutId);
  const sheet = readFileSync(sheetPath);
  const provider = imageProvider();
  const pairs = [];
  for (let i = 0; i < keys.length - 1; i++) pairs.push([i, i + 1]);
  if (assembly === "loop") pairs.push([keys.length - 1, 0]);
  const totalCalls = keys.length + breakdowns * pairs.length;
  // lift·rig는 생성 뒤에 적용하는 후처리라 **모델에게 보내는 것을 바꾸지 않는다.**
  // 해시에 넣으면 값을 조금 손볼 때마다 이미 뽑은 raw를 버리게 된다(실측: lift가
  // 캔버스를 넘어 멈췄을 때 6장을 다시 뽑을 뻔했다). 저장은 하되 해시에서는 뺀다.
  const generationKeys = keys.map(({ lift, rig, ...rest }) => rest);
  const input = { motion, fps, keys: generationKeys, breakdowns, assembly, invariants, poseConstants, breakdownNote, repeat };
  const base = provenance("keys", input, [sheet]);
  checkPlanTarget(cutDir, options, base);
  const rawNames = [
    ...keys.map((_, i) => `key-${i + 1}.png`),
    ...pairs.flatMap(([a, b]) => Array.from({ length: breakdowns }, (_, k) => bdName(a, b, k, breakdowns))),
  ];
  let reusable = 0;
  if (options.resume) for (const name of rawNames) if (await reusableRaw(join(cutDir, "frames-raw", name))) reusable++;
  const timing = keyTiming(keys, pairs, breakdowns, assembly, fps, repeat);
  const plan = {
    mode: "keys", characterRef: options.ref ?? "sheet.png",
    provider: provider.name, totalCalls, remainingCalls: totalCalls - reusable,
    reusedCalls: reusable, possibleRetryCalls: breakdowns * pairs.length,
    estimatedCostUsd: planCost(totalCalls - reusable), frames: timing.uniqueFrames,
    timelineFrames: timing.timelineFrames, durationSeconds: timing.durationSeconds,
  };
  assertPlannedBudget(plan, options);
  const state = prepareCutRun({ cutDir, options, base, provider: provider.name });
  const metered = budgetedProvider(provider, options, plan, state);
  mkdirSync(join(cutDir, "frames"), { recursive: true });
  mkdirSync(join(cutDir, "frames-raw"), { recursive: true });

  const generateKeyed = async (prompt, references, label, rawName, allowReuse = true) => {
    const rawPath = join(cutDir, "frames-raw", rawName);
    const cached = options.resume && allowReuse ? await reusableRaw(rawPath) : null;
    if (cached) return { ...cached, reused: true };
    const bytes = await metered.generate({ prompt, references });
    atomicWriteFile(rawPath, Buffer.from(bytes));
    const item = await reusableRaw(rawPath);
    if (!item) {
      throw new Error(`${label} 누끼 실패 — frames-raw/${rawName} 확인 후 --resume으로 재시도`);
    }
    return { ...item, reused: false };
  };
  const sameSize = (x, y) => x.width === y.width && x.height === y.height;
  const meta0 = { strays: spec.strays };
  // 모델이 지시하지 않고 그려 넣는 바닥선·부스러기를 지운다. 효과 기호를 쓰는
  // 컷은 스펙에 strays:"keep"을 넣어 끈다(하트·땀방울도 떨어진 덩어리다).
  const tidy = (image, label, options = {}) => {
    if (options.strays === "keep") return image;
    const line = dropGroundLine(image);
    if (line.removed) console.log(`  ${label}: 바닥선 ${line.bandHeight}줄 제거`);
    const strays = dropStrays(line.image);
    if (strays.removed) console.log(`  ${label}: 떨어진 잉크 ${strays.removed}px 제거`);
    return strays.image ?? line.image;
  };
  // 리그 적용 + 실측 로그. 목표를 못 맞추면 조용히 넘어가지 않고 남긴다.
  const rigKey = (image, rig, index) => {
    const before = faceDropRatio(image);
    const result = applyRig(image, rig);
    const after = faceDropRatio(result.image);
    console.log(`  키 ${index} 리그: 얼굴 ${before?.toFixed(3)} → ${after?.toFixed(3)}`
      + (rig.ratio === undefined ? "" : ` (목표 ${Number(rig.ratio).toFixed(3)})`)
      + `, ${result.dropPx}px`);
    return autoCutout(result.image);
  };

  try {
    // ① 키 포즈 — 시트(+앞선 키)를 레퍼런스로 극단만 생성
    const keyRaw = [];
    const keyImages = [];
    for (let i = 0; i < keys.length; i++) {
      const references = [sheet, ...(keyRaw.length ? [keyRaw[0]] : []), ...(keyRaw.length > 1 ? [keyRaw[keyRaw.length - 1]] : [])];
      const { bytes, keyed: drawn } = await generateKeyed(
        KEY_PROMPT(motion, i + 1, keys.length, keys[i].pose.trim(), invariants, poseConstants), references,
        `키 ${i + 1}`, `key-${i + 1}.png`,
      );
      // 리그: 모델이 그린 표정에 기하를 입힌다. 누끼 전 원본(흰 배경)에 적용해야
      // 머리 원 피팅이 맞는다 — 투명 배경에서는 RGB가 0이라 계측이 깨진다.
      let keyed = keys[i].rig ? rigKey(await toRgba(bytes), keys[i].rig, i + 1) : drawn;
      keyed = tidy(keyed, `키 ${i + 1}`, meta0);
      // lift: 점프 높이는 코드가 만든다. 모델은 표정·스쿼시만 그린다.
      if (keys[i].lift) {
        keyed = liftFrame(keyed, Number(keys[i].lift));
        console.log(`  키 ${i + 1} 들어올림: 캐릭터 높이의 ${(Number(keys[i].lift) * 100).toFixed(0)}%`);
      }
      keyRaw.push(bytes);
      keyImages.push(keyed);
      console.log(`  키 포즈 ${i + 1}/${keys.length}`);
    }

    // ② 브레이크다운 — 키 쌍의 양쪽 이미지를 함께 레퍼런스로.
    const bdImages = new Map();
    for (const [a, b] of pairs) for (let k = 0; k < breakdowns; k++) {
      const percent = bdPercent(k, breakdowns);
      const label = `브레이크다운 ${a + 1}→${b + 1} (${percent}%)`;
      const rawName = bdName(a, b, k, breakdowns);
      const gen = (allowReuse = true) => generateKeyed(
        BREAKDOWN_PROMPT(motion, keys[a].pose.trim(), keys[b].pose.trim(), invariants, poseConstants, percent, breakdownNote),
        [sheet, keyRaw[a], keyRaw[b]], label, rawName, allowReuse,
      );
      const midDiff = ({ keyed }) =>
        sameSize(keyed, keyImages[a]) && sameSize(keyed, keyImages[b])
          ? Math.max(loopDiff(keyImages[a], keyed), loopDiff(keyed, keyImages[b]))
          : null;
      let best = await gen();
      const dAB = sameSize(keyImages[a], keyImages[b]) ? loopDiff(keyImages[a], keyImages[b]) : null;
      const d1 = midDiff(best);
      if (!best.reused && dAB !== null && d1 !== null && d1 > dAB) {
        console.log(`  ${label} 튐 (중간 diff ${(d1 * 100).toFixed(1)}% > 키 간 ${(dAB * 100).toFixed(1)}%) — 1회 재생성`);
        try {
          const retry = await gen(false);
          const d2 = midDiff(retry);
          if (d2 !== null && d2 < d1) best = retry;
          else atomicWriteFile(join(cutDir, "frames-raw", rawName), Buffer.from(best.bytes));
        } catch (error) {
          if (!/--max-(calls|cost)/.test(String(error.message))) throw error;
          console.log(`  ${label} 재시도 생략 (${error.message})`);
        }
      }
      bdImages.set(`${a}-${b}-${k}`, best.keyed);
      console.log(`  ${label}`);
    }

    // ③ 조립 — 유니크 프레임 나열 + 타임라인
    const unique = [];
    const sequenceMeta = [];
    for (let i = 0; i < keys.length; i++) {
      unique.push({ image: keyImages[i], delayFrames: Math.max(1, Number(keys[i].hold ?? 1)) });
      sequenceMeta.push({ type: "key", key: i });
      for (let k = 0; k < breakdowns; k++) {
        const image = bdImages.get(`${i}-${i + 1}-${k}`);
        if (!image) continue;
        unique.push({ image, delayFrames: 1 });
        sequenceMeta.push({ type: "bd", pair: [i, i + 1], slot: k, of: breakdowns });
      }
    }
    if (assembly === "loop") for (let k = 0; k < breakdowns; k++) {
      const image = bdImages.get(`${keys.length - 1}-0-${k}`);
      if (!image) continue;
      unique.push({ image, delayFrames: 1 });
      sequenceMeta.push({ type: "bd", pair: [keys.length - 1, 0], slot: k, of: breakdowns });
    }
    const frameDelay = 1000 / fps;
    const timeline = unique.map((u, index) => ({ frame: index, delayMs: Math.round(u.delayFrames * frameDelay) }));
    if (assembly === "pingpong") for (let i = unique.length - 2; i >= 1; i--) {
      timeline.push({ frame: i, delayMs: Math.round(unique[i].delayFrames * frameDelay) });
    }
    if (repeat > 1) {
      const cycle = [...timeline];
      for (let r = 1; r < repeat; r++) timeline.push(...cycle.map((t) => ({ ...t })));
    }
    unique.forEach((u, i) => atomicWriteFile(join(cutDir, "frames", `${pad2(i + 1)}.png`), encodePng(u.image)));
    finishCutRun(state, "complete", null, {
      ...input, ...base, characterRef: options.ref ?? "sheet.png",
      // 해시에는 뺐지만 메타에는 원본 keys를 남긴다 — redo가 lift·rig를 다시
      // 적용하려면 필요하다.
      keys,
      // 몸이 실제로 움직이는 컷은 build의 몸 정렬이 그 움직임을 지운다.
      ...(keys.some((k) => k.lift) ? { anchor: "none" } : {}),
      ...(spec.strays ? { strays: spec.strays } : {}),
      frames: unique.length, sequence: sequenceMeta, timeline,
    });
    console.log(`✓ ${cutId} 컷 생성 (유니크 ${unique.length}장 → 타임라인 ${timeline.length}프레임, ${assembly})`);
  } catch (error) {
    finishCutRun(state, "failed", error);
    throw error;
  }
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

// 스켈레톤 조건화 모드: 재사용 포즈 시퀀스(_src/emoticon/poses/*.json)를
// 스켈레톤 이미지로 렌더해 프레임별(또는 그리드 1회) 조건으로 준다.
// 텍스트로 못 잡던 좌우·각도를 픽셀 기하로 지시한다 — pose-conditioning.md.
async function cmdCutSkeleton(workdir, cutId, options) {
  if (!CUT_ID_RE.test(cutId ?? "")) throw new Error(`컷 id는 영소문자·숫자·하이픈만 가능합니다: ${cutId}`);
  // 캐릭터 레퍼런스: 기본은 시트지만, 여러 컷이 든 시트는 모델이 "시트를
  // 복제하라"로 해석해 스켈레톤을 무시하는 사고가 있었다(lesson_learned §23).
  // --ref로 단일 정면 컷을 주는 쪽이 안전하다.
  const refPath = options.ref ?? join(workdir, "sheet.png");
  if (!existsSync(refPath)) throw new Error(`캐릭터 레퍼런스가 없습니다: ${refPath}`);
  const cutDir = join(workdir, "cuts", cutId);

  const { spec, frames: poses } = loadSequence(options.skeletons);
  const motion = String(options.motion ?? spec.description ?? spec.name).trim();
  const fps = Number(options.fps ?? spec.fps ?? 12);
  const cell = Number(options.cell ?? 512);
  const cols = Math.min(4, poses.length);
  const rows = Math.ceil(poses.length / cols);
  if (poses.length > MAX_FRAMES) throw new Error(`프레임 ${poses.length}장 — 상한 ${MAX_FRAMES}장`);

  const characterRef = readFileSync(refPath);
  const provider = imageProvider();
  const input = {
    motion, fps, sequence: spec.name, sequenceSpec: spec, grid: Boolean(options.grid),
    characterRef: options.ref ?? "sheet.png", frames: poses.length, cell,
  };
  const base = provenance("skeleton", input, [characterRef]);
  checkPlanTarget(cutDir, options, base);
  const rawPaths = options.grid
    ? [join(cutDir, "frames-raw", "grid.png")]
    : poses.map((_, i) => join(cutDir, "frames-raw", `${pad2(i + 1)}.png`));
  let reusable = 0;
  if (options.resume) {
    if (options.grid) reusable = await reusableGridRaw(rawPaths[0], cols, rows, poses.length) ? 1 : 0;
    else for (const path of rawPaths) if (await reusableRaw(path)) reusable++;
  }
  const totalCalls = options.grid ? 1 : poses.length;
  const plan = {
    mode: "skeleton", provider: provider.name, totalCalls, remainingCalls: totalCalls - reusable,
    reusedCalls: reusable, possibleRetryCalls: 0, estimatedCostUsd: planCost(totalCalls - reusable),
    frames: poses.length, durationSeconds: poses.length / fps,
  };
  assertPlannedBudget(plan, options);
  const state = prepareCutRun({ cutDir, options, base, provider: provider.name });
  const metered = budgetedProvider(provider, options, plan, state);
  mkdirSync(join(cutDir, "frames"), { recursive: true });
  mkdirSync(join(cutDir, "frames-raw"), { recursive: true });
  mkdirSync(join(cutDir, "skeletons"), { recursive: true });

  const keep = async (rgba, index) => {
    const keyed = autoCutout(rgba);
    const ratio = transparencyRatio(keyed);
    if (ratio < 0.05) {
      throw new Error(`프레임 ${pad2(index)} 누끼 실패 (투명 ${Math.round(ratio * 100)}%) — frames-raw 확인 후 --force로 재시도`);
    }
    atomicWriteFile(join(cutDir, "frames", `${pad2(index)}.png`), encodePng(keyed));
  };

  try {
    if (options.grid) {
      // 그리드 단일 호출 — 모든 프레임이 한 번의 샘플링을 공유한다 (FramePrompt)
      const grid = encodePng(renderGrid(poses, { cols, cell }));
      atomicWriteFile(join(cutDir, "skeletons", "grid.png"), grid);
      const rawPath = join(cutDir, "frames-raw", "grid.png");
      let bytes = options.resume ? await reusableGridRaw(rawPath, cols, rows, poses.length) : null;
      if (!bytes) {
        bytes = await metered.generate({ prompt: SKELETON_GRID_PROMPT(motion, cols, rows), references: [characterRef, grid] });
        atomicWriteFile(rawPath, Buffer.from(bytes));
      }
      const sheetImage = await toRgba(bytes);
      const cells = sliceGrid(sheetImage, cols, rows).slice(0, poses.length);
      for (const [i, cellImage] of cells.entries()) await keep(cellImage, i + 1);
      console.log(`  그리드 1회 호출 → ${cells.length}프레임 슬라이스`);
    } else {
      for (const [i, pose] of poses.entries()) {
        const skeleton = encodePng(renderPose(pose, { width: cell, height: cell }));
        atomicWriteFile(join(cutDir, "skeletons", `${pad2(i + 1)}.png`), skeleton);
        const rawPath = join(cutDir, "frames-raw", `${pad2(i + 1)}.png`);
        let bytes = options.resume ? (await reusableRaw(rawPath))?.bytes ?? null : null;
        if (!bytes) {
          bytes = await metered.generate({ prompt: SKELETON_FRAME_PROMPT(motion, i + 1, poses.length), references: [characterRef, skeleton] });
          atomicWriteFile(rawPath, Buffer.from(bytes));
        }
        await keep(await toRgba(bytes), i + 1);
        console.log(`  프레임 ${pad2(i + 1)}/${pad2(poses.length)}`);
      }
    }
    finishCutRun(state, "complete", null, { ...input, ...base });
  } catch (error) {
    finishCutRun(state, "failed", error);
    throw error;
  }
  console.log(`✓ ${cutId} 컷 생성 (${poses.length}프레임, 스켈레톤 조건화) → ${cutDir}`);
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

// 실제 파일이나 API를 건드리지 않고 호출 수·비용·출력 규모와 resume 호환성을 계산한다.
async function cmdPlan(workdir, cutId, options) {
  if (!CUT_ID_RE.test(cutId ?? "")) throw new Error(`컷 id는 영소문자·숫자·하이픈만 가능합니다: ${cutId}`);
  const provider = imageProvider();
  const cutDir = join(workdir, "cuts", cutId);

  if (options.keys) {
    const spec = readJson(options.keys);
    const motion = String(options.motion ?? spec.motion ?? "").trim();
    const keys = spec.keys;
    if (!motion) throw new Error("동작 설명이 필요합니다 (--motion 또는 spec.motion)");
    if (!Array.isArray(keys) || keys.length < 2 || keys.length > MAX_KEYS || keys.some((key) => !key?.pose?.trim())) {
      throw new Error(`keys는 pose 문장을 가진 2~${MAX_KEYS}개의 키 포즈여야 합니다`);
    }
    const breakdowns = Number(spec.breakdowns ?? 1);
    const assembly = spec.assembly ?? "pingpong";
    if (![0, 1, 2, 3].includes(breakdowns)) throw new Error("breakdowns는 0~3만 지원합니다");
    if (!["pingpong", "loop"].includes(assembly)) throw new Error('assembly는 "pingpong" 또는 "loop"');
    const invariants = String(spec.invariants ?? "").trim();
    const poseConstants = String(spec.poseConstants ?? "").trim();
    const breakdownNote = String(spec.breakdownNote ?? "").trim();
    const repeat = Number(spec.repeat ?? 1);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 8) throw new Error("repeat은 1~8 정수여야 합니다");
    const fps = Number(options.fps ?? spec.fps ?? 12);
    const sheetPath = characterReferencePath(workdir, options);
    const sheet = readFileSync(sheetPath);
    const pairs = [];
    for (let i = 0; i < keys.length - 1; i++) pairs.push([i, i + 1]);
    if (assembly === "loop") pairs.push([keys.length - 1, 0]);
    const names = [
      ...keys.map((_, i) => `key-${i + 1}.png`),
      ...pairs.flatMap(([a, b]) => Array.from({ length: breakdowns }, (_, k) => bdName(a, b, k, breakdowns))),
    ];
    // lift·rig는 생성 뒤에 적용하는 후처리라 **모델에게 보내는 것을 바꾸지 않는다.**
  // 해시에 넣으면 값을 조금 손볼 때마다 이미 뽑은 raw를 버리게 된다(실측: lift가
  // 캔버스를 넘어 멈췄을 때 6장을 다시 뽑을 뻔했다). 저장은 하되 해시에서는 뺀다.
  const generationKeys = keys.map(({ lift, rig, ...rest }) => rest);
  const input = { motion, fps, keys: generationKeys, breakdowns, assembly, invariants, poseConstants, breakdownNote, repeat };
    const base = provenance("keys", input, [sheet]);
    checkPlanTarget(cutDir, options, base);
    let reusable = 0;
    if (options.resume) for (const name of names) if (await reusableRaw(join(cutDir, "frames-raw", name))) reusable++;
    const timing = keyTiming(keys, pairs, breakdowns, assembly, fps, repeat);
    return printPlan({
      mode: "keys", provider: provider.name, totalCalls: names.length,
      remainingCalls: names.length - reusable, reusedCalls: reusable,
      possibleRetryCalls: breakdowns * pairs.length,
      estimatedCostUsd: planCost(names.length - reusable), frames: timing.uniqueFrames,
      timelineFrames: timing.timelineFrames, durationSeconds: timing.durationSeconds,
    }, options);
  }

  if (options.skeletons) {
    const refPath = options.ref ?? join(workdir, "sheet.png");
    if (!existsSync(refPath)) throw new Error(`캐릭터 레퍼런스가 없습니다: ${refPath}`);
    const { spec, frames: poses } = loadSequence(options.skeletons);
    const motion = String(options.motion ?? spec.description ?? spec.name).trim();
    const fps = Number(options.fps ?? spec.fps ?? 12);
    const cell = Number(options.cell ?? 512);
    const characterRef = readFileSync(refPath);
    const input = {
      motion, fps, sequence: spec.name, sequenceSpec: spec, grid: Boolean(options.grid),
      characterRef: options.ref ?? "sheet.png", frames: poses.length, cell,
    };
    const base = provenance("skeleton", input, [characterRef]);
    checkPlanTarget(cutDir, options, base);
    const paths = options.grid
      ? [join(cutDir, "frames-raw", "grid.png")]
      : poses.map((_, i) => join(cutDir, "frames-raw", `${pad2(i + 1)}.png`));
    let reusable = 0;
    const cols = Math.min(4, poses.length);
    const rows = Math.ceil(poses.length / cols);
    if (options.resume) {
      if (options.grid) reusable = await reusableGridRaw(paths[0], cols, rows, poses.length) ? 1 : 0;
      else for (const path of paths) if (await reusableRaw(path)) reusable++;
    }
    return printPlan({
      mode: "skeleton", provider: provider.name, totalCalls: paths.length,
      remainingCalls: paths.length - reusable, reusedCalls: reusable, possibleRetryCalls: 0,
      estimatedCostUsd: planCost(paths.length - reusable), frames: poses.length,
      durationSeconds: poses.length / fps,
    }, options);
  }

  if (!options.motion?.trim()) throw new Error("--motion (동작 설명)은 필수입니다");
  const total = Number(options.frames ?? 12);
  const fps = Number(options.fps ?? 12);
  if (!Number.isInteger(total) || total < 2 || total > MAX_FRAMES) throw new Error(`--frames 는 2~${MAX_FRAMES} 정수여야 합니다`);
  const sheetPath = join(workdir, "sheet.png");
  if (!existsSync(sheetPath)) throw new Error(`캐릭터 시트가 없습니다: ${sheetPath}`);
  let poses = null;
  if (options.poses) {
    poses = readFileSync(options.poses, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
    if (poses.length !== total) throw new Error(`포즈 ${poses.length}줄 ≠ ${total}프레임`);
  }
  const sheet = readFileSync(sheetPath);
  const input = { motion: options.motion.trim(), frames: total, fps, poses };
  const base = provenance("sequential", input, [sheet]);
  checkPlanTarget(cutDir, options, base);
  let reusable = 0;
  if (options.resume) for (let i = 1; i <= total; i++) {
    if (await reusableRaw(join(cutDir, "frames-raw", `${pad2(i)}.png`))) reusable++;
  }
  printPlan({
    mode: "sequential", provider: provider.name, totalCalls: total,
    remainingCalls: total - reusable, reusedCalls: reusable, possibleRetryCalls: 0,
    estimatedCostUsd: planCost(total - reusable), frames: total, durationSeconds: total / fps,
  }, options);
}

// 선별 재작업: keys 모드 컷의 특정 유니크 프레임 하나만 같은 프롬프트·
// 레퍼런스로 재생성한다 (프레임당 ≈$0.04 — 전체 재생성 대신 튄 것만).
// build 출력의 인접 diff로 튄 프레임을 찾고, redo 후 build를 다시 돌린다.
// 프레임당 재작업 상한. 같은 프레임을 계속 다시 뽑는 건 프롬프트가 틀렸다는
// 신호이지 운이 나쁜 게 아니다 — 두 번 실패하면 멈추고 포즈 문장을 고쳐야 한다.
// (blink1 프레임 3: 1차 눈꺼풀 덩어리 → 2차 윙크 → 문장을 고치자 한 번에 해결)
const MAX_REDO_PER_FRAME = 2;

// 여러 프레임을 한 번에 다시 뽑는다 — 사람 검수가 "2프레임·3프레임이 불량,
// 나머진 괜찮다"처럼 짚어주므로 그 장만 골라 재작업하는 게 기본 경로다.
async function cmdRedo(workdir, cutId, frameArg, options = {}) {
  const numbers = String(frameArg ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  if (!numbers.length) throw new Error("재생성할 프레임 번호가 필요합니다 (예: 2 또는 \"2,3\")");
  if (options["force-redo"]) resetRedoCounts(workdir, cutId, numbers);
  for (const n of numbers) await redoFrame(workdir, cutId, n);
}

// 포즈 문장을 고친 뒤에는 상한을 다시 연다 — 상한의 목적은 "같은 프롬프트로
// 반복해서 긁지 마라"이지 "그 프레임을 영원히 포기하라"가 아니다.
function resetRedoCounts(workdir, cutId, numbers) {
  const metaPath = join(workdir, "cuts", cutId, "cut.json");
  if (!existsSync(metaPath)) return;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (!meta.redoCounts) return;
  for (const n of numbers) delete meta.redoCounts[String(n)];
  atomicWriteFile(metaPath, Buffer.from(JSON.stringify(meta, null, 2) + "\n"));
}

async function redoFrame(workdir, cutId, frameNumber) {
  const cutDir = join(workdir, "cuts", cutId);
  const metaPath = join(cutDir, "cut.json");
  if (!existsSync(metaPath)) throw new Error(`컷이 없습니다: ${cutDir}`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.mode !== "keys" || !Array.isArray(meta.sequence)) {
    throw new Error("redo는 keys 모드 컷만 지원합니다 (cut --keys로 생성한 컷)");
  }
  assertCurrentReference(meta, workdir);
  const n = frameNumber;
  if (!Number.isInteger(n) || n < 1 || n > meta.sequence.length) {
    throw new Error(`프레임 번호는 1~${meta.sequence.length} 입니다`);
  }
  const attempts = meta.redoCounts?.[String(n)] ?? 0;
  if (attempts >= MAX_REDO_PER_FRAME) {
    throw new Error(
      `프레임 ${n}은 이미 ${attempts}번 재작업했습니다 (상한 ${MAX_REDO_PER_FRAME}). ` +
      "같은 프레임이 계속 실패하면 운이 아니라 포즈 문장이 틀린 것입니다 — " +
      "cut.json의 keys[].pose를 고치고 --force-redo로 다시 시도하세요 " +
      "(work/emoticon/doc/prompting.md §10 §0)",
    );
  }
  const el = meta.sequence[n - 1];
  const sheet = readFileSync(meta.characterRef && meta.characterRef !== "sheet.png"
    ? meta.characterRef
    : join(workdir, "sheet.png"));
  const rawOf = (name) => readFileSync(join(cutDir, "frames-raw", name));

  let prompt, references, rawName, label;
  if (el.type === "key") {
    label = `키 ${el.key + 1}`;
    rawName = `key-${el.key + 1}.png`;
    prompt = KEY_PROMPT(meta.motion, el.key + 1, meta.keys.length, meta.keys[el.key].pose, meta.invariants ?? "", meta.poseConstants ?? "");
    references = [sheet, ...(el.key > 0 ? [rawOf("key-1.png")] : [])];
  } else {
    const [a, b] = el.pair;
    const slot = el.slot ?? 0;
    const of = el.of ?? 1;
    const percent = bdPercent(slot, of);
    label = `브레이크다운 ${a + 1}→${b + 1} (${percent}%)`;
    rawName = bdName(a, b, slot, of);
    prompt = BREAKDOWN_PROMPT(meta.motion, meta.keys[a].pose, meta.keys[b].pose, meta.invariants ?? "", meta.poseConstants ?? "", percent, meta.breakdownNote ?? "");
    references = [sheet, rawOf(`key-${a + 1}.png`), rawOf(`key-${b + 1}.png`)];
  }

  const provider = imageProvider();
  const bytes = await provider.generate({ prompt, references });
  atomicWriteFile(join(cutDir, "frames-raw", rawName), Buffer.from(bytes));
  // 원래 컷에 걸려 있던 리그·들어올림을 그대로 다시 적용한다. 빠뜨리면 그
  // 프레임만 점프가 사라져 컷 전체가 튄다.
  const spec = el.type === "key" ? (meta.keys?.[el.key] ?? {}) : {};
  let keyed = spec.rig
    ? applyRig(await toRgba(bytes), spec.rig).image
    : await toRgba(bytes);
  keyed = autoCutout(keyed);
  keyed = ((image) => {
    if (meta.strays === "keep") return image;
    const line = dropGroundLine(image);
    if (line.removed) console.log(`  바닥선 ${line.bandHeight}줄 제거`);
    const strays = dropStrays(line.image);
    if (strays.removed) console.log(`  떨어진 잉크 ${strays.removed}px 제거`);
    return strays.image ?? line.image;
  })(keyed);
  if (spec.lift) {
    keyed = liftFrame(keyed, Number(spec.lift));
    console.log(`  들어올림 재적용: ${(Number(spec.lift) * 100).toFixed(0)}%`);
  }
  const ratio = transparencyRatio(keyed);
  if (ratio < 0.05) {
    throw new Error(`${label} 누끼 실패 (투명 ${Math.round(ratio * 100)}%) — frames-raw/${rawName} 확인 후 다시 redo`);
  }
  atomicWriteFile(join(cutDir, "frames", `${pad2(n)}.png`), encodePng(keyed));
  // 재작업 횟수를 컷 메타에 남긴다 — 상한이 세션 기억이 아니라 파일에 있어야
  // 다음 실행·다른 사람도 같은 규칙을 받는다.
  meta.redoCounts = { ...(meta.redoCounts ?? {}), [String(n)]: attempts + 1 };
  // erase는 그 그림의 특정 좌표를 지운 일회성 편집이다. 다시 구우면 그림이
  // 달라져 좌표가 무의미해지므로 기록을 지운다 — 남겨두면 "이미 지웠다"고
  // 착각해서 새로 생긴 군더더기를 놓친다.
  if (meta.erased?.[String(n)]) {
    delete meta.erased[String(n)];
    if (!Object.keys(meta.erased).length) delete meta.erased;
    console.log(`  이전 erase 기록 삭제 — 새 그림이므로 다시 확인하세요`);
  }
  atomicWriteFile(metaPath, Buffer.from(JSON.stringify(meta, null, 2) + "\n"));
  console.log(`✓ 프레임 ${pad2(n)} (${label}) 재생성 ${attempts + 1}/${MAX_REDO_PER_FRAME} (${provider.name})`);
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

async function cmdImport(workdir, cutId, srcDir, options) {
  if (!CUT_ID_RE.test(cutId ?? "")) throw new Error(`컷 id는 영소문자·숫자·하이픈만 가능합니다: ${cutId}`);
  if (!srcDir || !existsSync(srcDir)) throw new Error(`프레임 폴더가 없습니다: ${srcDir}`);
  const files = readdirSync(srcDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
  if (files.length < 2) throw new Error(`프레임이 2장 미만입니다: ${srcDir}`);
  if (files.length > MAX_FRAMES) {
    throw new Error(`프레임 ${files.length}장 — 상한 ${MAX_FRAMES}장. ffmpeg -vf fps=... 로 줄여서 다시 추출하세요`);
  }
  const fps = Number(options.fps ?? 12);
  const cutDir = join(workdir, "cuts", cutId);
  const sourceBytes = files.map((file) => readFileSync(join(srcDir, file)));
  const input = { motion: options.motion?.trim() || `import:${srcDir}`, frames: files.length, fps, chroma: Boolean(options.chroma) };
  const base = {
    mode: "import",
    specHash: specHash(input),
    sheetHash: null,
    referenceHashes: sourceBytes.map(sha256),
  };
  const state = prepareCutRun({ cutDir, options, base, provider: "import" });
  mkdirSync(join(cutDir, "frames"), { recursive: true });

  try {
    for (const [i, file] of files.entries()) {
      let rgba = await toRgba(sourceBytes[i]);
      if (options.chroma) rgba = chromaKeyGreen(rgba);
      const ratio = transparencyRatio(rgba);
      if (ratio < 0.05) {
        throw new Error(
          `프레임 ${file} 이 불투명합니다 (투명 ${Math.round(ratio * 100)}%) — ` +
          "초록 배경 영상이면 --chroma, 이미 투명한 프레임이면 원본을 확인하세요",
        );
      }
      atomicWriteFile(join(cutDir, "frames", `${pad2(i + 1)}.png`), encodePng(rgba));
    }
    finishCutRun(state, "complete", null, { ...input, ...base });
  } catch (error) {
    finishCutRun(state, "failed", error);
    throw error;
  }
  console.log(`✓ ${cutId} 컷 가져옴 (${files.length}프레임) → ${cutDir}`);
}

async function cmdBuild(workdir, cutId, options) {
  const cutDir = join(workdir, "cuts", cutId);
  const framesDir = join(cutDir, "frames");
  if (!existsSync(framesDir)) throw new Error(`컷이 없습니다: ${cutDir} — 먼저 cut 또는 import를 실행하세요`);
  const meta = JSON.parse(readFileSync(join(cutDir, "cut.json"), "utf8"));
  assertCurrentReference(meta, workdir);
  const fps = Number(options.fps ?? meta.fps ?? 12);
  const size = Number(options.size ?? 360);
  const files = readdirSync(framesDir).filter((f) => /^\d{2}\.png$/.test(f)).sort();
  if (files.length < 2) throw new Error(`프레임이 2장 미만입니다: ${framesDir}`);
  const raw = files.map((f) => decodePng(readFileSync(join(framesDir, f))));
  // 몸 정렬이 기본이다 — 모델이 프레임마다 몸을 몇 px씩 옮겨 그려서 재생하면
  // 튄다. 몸이 실제로 움직여야 하는 컷만 cut.json에 anchor:"none"을 둔다.
  const frames = meta.anchor === "none" ? raw : alignFrames(raw);
  if (meta.anchor !== "none") {
    const before = raw.map(bodyAnchor).filter(Boolean);
    if (before.length === raw.length) {
      const spread = (get) => Math.max(...before.map(get)) - Math.min(...before.map(get));
      console.log(`  몸 정렬: 가로 ${spread((a) => a.x).toFixed(0)}px · 세로 ${spread((a) => a.y).toFixed(0)}px 흔들림 보정`);
    }
  }

  const outDir = join(workdir, "out");
  mkdirSync(outDir, { recursive: true });
  // keys 모드는 타임라인(프레임 재사용 + 프레임별 delay)으로 전개한다
  const timeline = Array.isArray(meta.timeline) && meta.timeline.length ? meta.timeline : null;
  const expand = (fitted) => timeline ? timeline.map((t) => fitted[t.frame]) : fitted;
  const delaysMs = timeline ? timeline.map((t) => t.delayMs) : null;

  const fitted = fitFrames(frames, size);
  const sequence = expand(fitted);
  const apng = encodeApng(sequence, { fps, delaysMs });
  const outPath = join(outDir, `${cutId}.png`);
  atomicWriteFile(outPath, apng);

  const diff = loopDiff(sequence[0], sequence[sequence.length - 1]);
  const adjacentDiffs = [];
  for (let i = 1; i < sequence.length; i++) adjacentDiffs.push(loopDiff(sequence[i - 1], sequence[i]));
  const adjacent = adjacentDiffs.length ? Math.max(...adjacentDiffs) : 0;
  const duration = delaysMs ? delaysMs.reduce((a, b) => a + b, 0) / 1000 : files.length / fps;
  console.log(
    `✓ ${outPath} — ${size}², 유니크 ${files.length}장/타임라인 ${sequence.length}프레임 ` +
    `(${duration.toFixed(2)}초), ${(apng.length / 1024).toFixed(0)}KB`,
  );
  console.log(`  루프 diff ${(diff * 100).toFixed(1)}% ${diff > 0.12 ? "⚠ 루프가 튈 수 있습니다 — 첫/끝 프레임을 확인하세요" : "(양호)"}`);
  console.log(`  인접 diff 최대 ${(adjacent * 100).toFixed(1)}% ${adjacent > 0.2 ? "⚠ 프레임 간 점프가 큽니다" : "(양호)"}`);
  const drift = scaleDrift(frames);
  console.log(
    `  크기 드리프트 ${(drift * 100).toFixed(1)}% ` +
    `${drift > 0.15 ? "⚠ 프레임마다 캐릭터 크기가 달라 재생 시 펄스처럼 보입니다" : "(양호)"}`,
  );
  const motion = alignedMotion(frames);
  console.log(
    `  움직임(정렬 후) 평균 ${(motion.mean * 100).toFixed(1)}% / 최대 ${(motion.max * 100).toFixed(1)}% ` +
    `${motion.mean < 0.03 ? "⚠ 거의 정지 — 애니메이션으로 읽히지 않습니다" : "(있음)"}`,
  );
  if (duration > 4) console.log("  ⚠ 4초 초과 — LINE 재생시간 상한(4초)을 넘습니다");

  // GIF: 메신저 공유가 실제로 되는 형식이자 카카오 제안 규격(흰 배경 애니 GIF)
  let gifBytes = null;
  if (options.gif !== false) {
    const gif = encodeGif(sequence, { fps, delaysMs });
    const gifPath = join(outDir, `${cutId}.gif`);
    atomicWriteFile(gifPath, gif);
    gifBytes = gif.length;
    console.log(`✓ ${gifPath} — ${(gif.length / 1024).toFixed(0)}KB (공유·카카오 제안용, 흰 배경)`);
  }

  let lineBytes = null;
  if (options.line) {
    if (sequence.length < LINE_FRAMES[0] || sequence.length > LINE_FRAMES[1]) {
      throw new Error(`LINE 변환은 ${LINE_FRAMES[0]}~${LINE_FRAMES[1]}프레임이어야 합니다 (현재 ${sequence.length})`);
    }
    const lineApng = encodeApng(expand(fitFrames(frames, LINE_SIZE)), { fps, delaysMs, loops: 4 });
    const linePath = join(outDir, `${cutId}-line.png`);
    atomicWriteFile(linePath, lineApng);
    lineBytes = lineApng.length;
    const ok = lineApng.length <= LINE_MAX_BYTES;
    console.log(`✓ ${linePath} — ${LINE_SIZE}², ${(lineApng.length / 1024).toFixed(0)}KB ${ok ? "(≤300KB)" : ""}`);
    if (!ok) {
      throw new Error(
        `LINE 300KB 초과 (${(lineApng.length / 1024).toFixed(0)}KB) — ` +
        "프레임 수를 줄이거나(build --fps 유지한 채 프레임 삭제) 동작 폭을 줄여 다시 생성하세요",
      );
    }
  }

  // 판정에 필요한 원자료를 남긴다 — check가 이걸 읽어 프로필 기준으로 실패시킨다
  const report = buildReport({
    cutId, mode: meta.mode, size,
    uniqueFrames: files.length, timelineFrames: sequence.length, fps,
    durationSec: duration, bytes: apng.length, lineBytes,
    frameDelays: delaysMs ? delaysMs.map((ms) => ms / 1000) : sequence.map(() => 1 / fps),
    loopDiff: diff, adjacentDiffs, scaleDrift: drift, motion,
    transparency: frames.map(transparencyRatio),
  });
  atomicWriteJson(join(cutDir, "report.json"), report);
  console.log(`  report.json 저장 — 판정: node _infra/emoticon.mjs check ${workdir} ${cutId} --profile master-2s`);
  return { outPath, frames: sequence.length, fps, diff, adjacent, report };
}

// 판정 게이트. FAIL이면 exit 1 — 불량 산출물이 Actions "성공"으로 커밋되는 것을 막는다.
function cmdCheck(workdir, cutId, options = {}) {
  const outPath = join(workdir, "out", `${cutId}.png`);
  if (!existsSync(outPath)) throw new Error(`산출물이 없습니다: ${outPath} — 먼저 build를 실행하세요`);
  for (const path of [outPath, join(workdir, "out", `${cutId}-line.png`)]) {
    if (!existsSync(path)) continue;
    const info = inspectApng(readFileSync(path));
    const bytes = readFileSync(path).length;
    console.log(
      `${path}: ${info.width}x${info.height}, ${info.frames}프레임, ` +
      `${(info.delays.reduce((a, b) => a + b, 0)).toFixed(2)}초, 루프 ${info.loops || "무한"}, ${(bytes / 1024).toFixed(0)}KB ` +
      `${info.animated ? "" : "⚠ 애니메이션 청크 없음"}`,
    );
  }

  const profileName = options.profile ?? "draft";
  const reportPath = join(workdir, "cuts", cutId, "report.json");
  if (!existsSync(reportPath)) {
    throw new Error(`report.json이 없습니다: ${reportPath} — 먼저 build를 다시 실행하세요`);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const profileFile = PROFILES[profileName]?.file === "line" ? `${cutId}-line.png` : `${cutId}.png`;
  const judgedPath = join(workdir, "out", profileFile);
  const info = existsSync(judgedPath) ? inspectApng(readFileSync(judgedPath)) : null;
  const judgement = judgeReport(report, profileName, info);

  if (options.json) console.log(JSON.stringify({ ...judgement, report }, null, 2));
  else console.log(formatJudgement(judgement, `${workdir} ${cutId}`));
  return judgement;
}

// ── CLI ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const options = {};
  const flags = new Set(["force", "resume", "line", "chroma", "grid", "json", "force-redo"]);
  // 여러 번 줄 수 있는 옵션 — 마지막 값으로 덮어쓰지 않고 배열로 모은다.
  const repeatable = new Set(["blob"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && flags.has(arg.slice(2))) options[arg.slice(2)] = true;
    else if (arg.startsWith("--")) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${arg} 값이 필요합니다`);
      const key = arg.slice(2);
      if (repeatable.has(key)) (options[key] ??= []).push(argv[++i]);
      else options[key] = argv[++i];
    }
    else positional.push(arg);
  }
  return { positional, options };
}

// 동작 카탈로그 조회 — 새 컷을 시작할 때 **읽을 문서만** 알려준다.
//
// 왜: work/emoticon 문서가 열두 개까지 늘었다. 동작 하나 만들려고 전부 읽는 건
// 컨텍스트 낭비이고, 정작 그 동작의 실패 이력은 한 파일에만 있다. 카탈로그가
// 동작 → 문서를 매핑해서 필요한 것만 열게 한다.
const CATALOG_PATH = "work/emoticon/doc/movement_catalog.json";

export function findMovement(catalog, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return null;
  return catalog.movements.find((m) =>
    m.id === needle || m.ko.some((k) => k.toLowerCase() === needle)) ?? null;
}

function cmdGuide(query) {
  if (!existsSync(CATALOG_PATH)) throw new Error(`카탈로그가 없습니다: ${CATALOG_PATH}`);
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const found = findMovement(catalog, query);
  const always = [
    "work/emoticon/README.md            (인수인계·현재 상태)",
    "work/emoticon/doc/prompting.md     (프롬프트 규약 + 부위별 문장)",
  ];
  if (!found) {
    console.log(`카탈로그에 "${query}"가 없습니다 — 새 동작입니다.`);
    console.log("\n읽을 문서:");
    for (const line of always) console.log(`  ${line}`);
    console.log("  work/emoticon/doc/animation-craft.md  (감정 채널·타이밍)");
    console.log(`\n등록된 동작: ${catalog.movements.map((m) => `${m.id}(${m.ko[0]})`).join(" · ")}`);
    console.log(`작업을 마치면 ${CATALOG_PATH}에 한 줄 추가할 것.`);
    return null;
  }
  const label = { done: "✓ 통과", revise: "△ 수정 요청", failed: "✗ 실패 확정", todo: "· 미착수" };
  console.log(`${found.id} (${found.ko.join("·")}) — ${label[found.status] ?? found.status}`);
  console.log(`  감정 칸: ${found.emotionSlot} · 채널: ${found.channel} (${catalog.channels[found.channel]})`);
  if (found.cuts?.length) console.log(`  기존 컷: ${found.cuts.join(" ")}`);
  if (found.verdict) console.log(`  사람 판정: ${found.verdict}`);
  if (found.shipped) console.log(`  납품됨: ${found.shipped}`);
  console.log("\n읽을 문서:");
  if (found.guide) console.log(`  ${found.guide}   ← 이 동작 전용. 먼저 읽는다`);
  for (const line of always) console.log(`  ${line}`);
  if (found.channel === "rig") console.log("  work/emoticon/doc/archive/skeleton-rigs.md  (rig 채널이라 참고)");
  return found;
}

// 좌우 반전 — 든 팔이 프레임마다 좌우로 뛰는 문제를 공짜로 고친다.
//
// 이 캐릭터군은 정면 뷰에서 **좌우 대칭**이라(귀·볼·얼굴 모두 중앙 정렬)
// 프레임을 통째로 뒤집으면 든 팔의 방향만 바뀌고 나머지는 그대로다.
// 텍스트로 좌우를 못 박는 건 열 번 넘게 실패했다(lesson_learned §9·§12·§22) —
// 통제되지 않는 축은 프롬프트가 아니라 코드로 잡는다. 재생성비 0원, 결정론적.
export function mirrorImage({ width, height, data }) {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = (y * width + (width - 1 - x)) * 4;
      for (let c = 0; c < 4; c++) out[to + c] = data[from + c];
    }
  }
  return { width, height, data: out };
}

// ── 몸통 안 군더더기 획 지우기 ────────────────────────────
// 모델이 실루엣 **안쪽**에 그려 넣은 여분의 획(bounce2 2번의 "안쪽 손" 한 쌍)은
// 외곽선과 닿지 않는 독립 잉크 덩어리다 — 좌표로 집어 지우고 주변 몸통 색으로
// 메우면 된다. 재생성비 0원, 결정론적. 포즈 문장으로 없애려는 시도는 실패했다
// (lesson_learned §55·§57) — 통제 안 되는 축은 코드로 잡는 §22 원칙 그대로다.
//
// 재생성하면 그림 자체가 바뀌어 좌표가 무의미해지므로, 이 편집은 그 프레임의
// **일회성**이다. redo가 그 프레임을 다시 구우면 기록을 지운다.
const isInkPixel = (data, i, threshold) => data[i + 3] > 128 && Math.max(data[i], data[i + 1], data[i + 2]) < threshold;

export function inkBlobAt(image, seedX, seedY, { threshold = 110 } = {}) {
  const { width, height, data } = image;
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) {
    throw new Error(`좌표가 캔버스 밖입니다: (${seedX},${seedY}) / ${width}x${height}`);
  }
  const start = seedY * width + seedX;
  if (!isInkPixel(data, start * 4, threshold)) {
    throw new Error(`(${seedX},${seedY})는 잉크가 아닙니다 — 지울 획 위의 좌표를 주세요`);
  }
  const seen = new Set([start]);
  const stack = [start];
  let touchesBorder = false;
  while (stack.length) {
    const p = stack.pop();
    const px = p % width, py = (p / width) | 0;
    if (px === 0 || py === 0 || px === width - 1 || py === height - 1) touchesBorder = true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (seen.has(q) || !isInkPixel(data, q * 4, threshold)) continue;
        seen.add(q); stack.push(q);
      }
    }
  }
  return { pixels: seen, touchesBorder };
}

// 지운 자리는 "주변 몸통 색"으로 메운다 — 바깥에서 안쪽으로 한 겹씩 좁혀 들어가며
// 잉크가 아닌 불투명 이웃의 평균을 쓴다. 획이 얇고 주변이 평평한 흰 면이라 몇 겹이면 끝난다.
// halo: 획의 안티에일리어싱 테두리(잉크 문턱보다는 밝지만 몸통 흰색보다는 어두운
// 픽셀)까지 함께 지운다. 코어만 지우면 회색 잔상이 유령처럼 남는다 — 실제로 처음
// 구현이 그랬다. 평평한 흰 면에서 멈추도록 haloThreshold를 높게(245) 두고,
// 그늘진 영역에서 폭주하지 않게 haloRadius로 번지는 겹 수를 묶는다.
export function eraseInkBlobs(image, seeds, {
  threshold = 110, maxInkRatio = 0.15, haloThreshold = 245, haloRadius = 4,
} = {}) {
  const { width, height, data } = image;
  let totalInk = 0;
  for (let p = 0; p < width * height; p++) if (isInkPixel(data, p * 4, threshold)) totalInk++;

  const remove = new Set();
  const report = [];
  for (const [sx, sy] of seeds) {
    const { pixels, touchesBorder } = inkBlobAt(image, sx, sy, { threshold });
    if (touchesBorder) throw new Error(`(${sx},${sy}) 덩어리가 캔버스 가장자리에 닿습니다 — 외곽선일 수 있어 거부합니다`);
    const ratio = pixels.size / (totalInk || 1);
    if (ratio > maxInkRatio) {
      throw new Error(`(${sx},${sy}) 덩어리가 전체 잉크의 ${(ratio * 100).toFixed(0)}%입니다 — 외곽선을 지울 위험이 있어 거부합니다`);
    }
    for (const p of pixels) remove.add(p);
    report.push({ x: sx, y: sy, px: pixels.size });
  }

  let frontier = new Set(remove);
  for (let ring = 0; ring < haloRadius && frontier.size; ring++) {
    const next = new Set();
    for (const p of frontier) {
      const px = p % width, py = (p / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (remove.has(q) || data[q * 4 + 3] === 0) continue;
          if (Math.max(data[q * 4], data[q * 4 + 1], data[q * 4 + 2]) >= haloThreshold) continue;
          remove.add(q); next.add(q);
        }
      }
    }
    frontier = next;
  }

  const out = new Uint8Array(data);
  let pending = new Set(remove);
  while (pending.size) {
    const filled = [];
    for (const p of pending) {
      const px = p % width, py = (p / width) | 0;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          // 메울 색은 "아직 안 지운 · 불투명 · 잉크가 아닌" 이웃에서만 가져온다.
          // 잉크를 재료로 쓰면 검정이 번져 획이 흐릿하게 남는다.
          if (pending.has(q) || out[q * 4 + 3] === 0 || isInkPixel(out, q * 4, threshold)) continue;
          r += out[q * 4]; g += out[q * 4 + 1]; b += out[q * 4 + 2]; a += out[q * 4 + 3]; n++;
        }
      }
      if (!n) continue;
      out[p * 4] = Math.round(r / n); out[p * 4 + 1] = Math.round(g / n);
      out[p * 4 + 2] = Math.round(b / n); out[p * 4 + 3] = Math.round(a / n);
      filled.push(p);
    }
    if (!filled.length) break; // 사방이 전부 잉크·투명 — 더 좁힐 수 없다
    for (const p of filled) pending.delete(p);
  }
  return { image: { width, height, data: out }, erased: report };
}

// ── 외곽선 바깥의 드롭섀도 제거 ──────────────────────────
// 모델이 "떠 있는 캐릭터"를 그릴 때 발밑에 회색 타원 그림자를 얹는 경우가 있다.
// bounce3에서 여덟 장 중 3·4번에만 생겼고 재생성해도 같은 자리에 다시 나왔다 —
// 운이 아니라 그 포즈의 관용구다. 프레임마다 있다 없다 하니 재생 중에 깜빡인다.
//
// 그림자는 발과 이어져 있어 연결요소로는 못 뗀다. 대신 **닫힌 검은 외곽선의
// 바깥**에 있다는 성질을 쓴다: 캔버스 가장자리에서 잉크를 넘지 않고 흘러 닿는
// 영역이 바깥이고, 그 중 무채색 중간 밝기 픽셀이 그림자다. 몸통 안쪽 회색
// (외곽선 안티에일리어싱)은 바깥에서 닿지 않으므로 안전하고, 외곽선 바로 바깥의
// 안티에일리어싱은 protectRadius로 지킨다(안 지키면 선이 계단처럼 딱딱해진다).
export function dropOutsideShadow(image, {
  inkThreshold = 110, grayTolerance = 14, minValue = 130, maxValue = 242, protectRadius = 2,
} = {}) {
  const { width, height, data } = image;
  const ink = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) if (isInkPixel(data, p * 4, inkThreshold)) ink[p] = 1;

  // 가장자리에서 잉크를 넘지 않고 흘러 닿는 곳 = 캐릭터 바깥
  const outside = new Uint8Array(width * height);
  const stack = [];
  const push = (p) => { if (!outside[p] && !ink[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (stack.length) {
    const p = stack.pop();
    const px = p % width, py = (p / width) | 0;
    if (px > 0) push(p - 1);
    if (px < width - 1) push(p + 1);
    if (py > 0) push(p - width);
    if (py < height - 1) push(p + width);
  }

  // 외곽선 둘레 protectRadius 안은 건드리지 않는다
  const protectedPx = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (!ink[p]) continue;
    const px = p % width, py = (p / width) | 0;
    for (let dy = -protectRadius; dy <= protectRadius; dy++) {
      for (let dx = -protectRadius; dx <= protectRadius; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        protectedPx[ny * width + nx] = 1;
      }
    }
  }

  const out = new Uint8Array(data);
  let removed = 0;
  for (let p = 0; p < width * height; p++) {
    if (!outside[p] || protectedPx[p]) continue;
    const i = p * 4;
    if (out[i + 3] === 0) continue;
    const mx = Math.max(out[i], out[i + 1], out[i + 2]);
    const mn = Math.min(out[i], out[i + 1], out[i + 2]);
    if (mx - mn > grayTolerance || mx < minValue || mx > maxValue) continue;
    out[i + 3] = 0;
    removed++;
  }
  return { image: { width, height, data: out }, removed };
}

// ── 한 프레임만 커진 것을 이웃 크기에 맞춘다 ─────────────
// 모델은 매 호출 피사체를 다시 배치·정규화하므로 같은 "normal proportions"를
// 줘도 한 장만 몇 % 크게 나오는 일이 있다. bounce3 3번이 실루엣 높이 582px로
// 이웃 546px보다 7% 컸고, 사람 눈에는 "얼굴 위치가 튄다"로 보였다.
// 배율은 프롬프트로 통제되지 않는 축이므로(§22) 코드가 리샘플링해서 맞춘다.
export function fitFrameHeight(image, targetHeight) {
  const { width, height, data } = image;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 16) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) throw new Error("빈 프레임입니다");
  const bh = y1 - y0 + 1;
  const scale = targetHeight / bh;
  if (Math.abs(scale - 1) > 0.25) {
    throw new Error(`배율 ${scale.toFixed(2)}는 너무 큽니다 — 프레임을 잘못 지목했는지 확인하세요`);
  }
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const out = new Uint8Array(width * height * 4);
  // 실루엣 중심을 고정한 채 축소·확대한다 — lift가 잡아 놓은 세로 위치를 지킨다.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sxf = cx + (x + 0.5 - cx) / scale, syf = cy + (y + 0.5 - cy) / scale;
      const sx = Math.floor(sxf), sy = Math.floor(syf);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const si = (sy * width + sx) * 4, di = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[di + c] = data[si + c];
    }
  }
  return { image: { width, height, data: out }, scale, from: bh, to: targetHeight };
}

const silhouetteHeight = (image) => {
  const { width, height, data } = image;
  let y0 = height, y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 16) continue;
      if (y < y0) y0 = y; if (y > y1) y1 = y; break;
    }
  }
  return y1 >= y0 ? y1 - y0 + 1 : 0;
};

async function cmdFit(workdir, cutId, frameArg) {
  const numbers = String(frameArg ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  if (!numbers.length) throw new Error('크기를 맞출 프레임 번호가 필요합니다 (예: 3)');
  const framesDir = join(workdir, "cuts", cutId, "frames");
  if (!existsSync(framesDir)) throw new Error(`프레임이 없습니다: ${framesDir}`);
  const files = readdirSync(framesDir).filter((f) => /^\d{2}\.png$/.test(f)).sort();

  // 목표는 **나머지 프레임의 중앙값** — 내가 숫자를 고르지 않는다.
  const others = files
    .map((f, i) => ({ f, n: i + 1 }))
    .filter(({ n }) => !numbers.includes(n))
    .map(({ f }) => silhouetteHeight(decodePng(readFileSync(join(framesDir, f)))))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!others.length) throw new Error("기준으로 삼을 다른 프레임이 없습니다");
  const target = others[Math.floor(others.length / 2)];

  for (const n of numbers) {
    const path = join(framesDir, `${pad2(n)}.png`);
    if (!existsSync(path)) throw new Error(`프레임이 없습니다: ${path}`);
    const r = fitFrameHeight(decodePng(readFileSync(path)), target);
    atomicWriteFile(path, Buffer.from(encodePng(r.image)));
    console.log(`✓ 프레임 ${pad2(n)} 실루엣 높이 ${r.from}px → ${r.to}px (배율 ${r.scale.toFixed(3)})`);
  }
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

async function cmdUnshadow(workdir, cutId, frameArg) {
  const numbers = String(frameArg ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  if (!numbers.length) throw new Error('그림자를 지울 프레임 번호가 필요합니다 (예: "3,4")');
  const framesDir = join(workdir, "cuts", cutId, "frames");
  if (!existsSync(framesDir)) throw new Error(`프레임이 없습니다: ${framesDir}`);
  for (const n of numbers) {
    const path = join(framesDir, `${pad2(n)}.png`);
    if (!existsSync(path)) throw new Error(`프레임이 없습니다: ${path}`);
    const { image, removed } = dropOutsideShadow(decodePng(readFileSync(path)));
    atomicWriteFile(path, Buffer.from(encodePng(image)));
    console.log(`✓ 프레임 ${pad2(n)} 바깥 그림자 ${removed}px 제거`);
  }
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

async function cmdErase(workdir, cutId, frameArg, options = {}) {
  const n = Number(frameArg);
  if (!Number.isInteger(n) || n < 1) throw new Error("지울 프레임 번호가 필요합니다 (예: 2)");
  const seeds = [].concat(options.blob ?? []).map((s) => {
    const [x, y] = String(s).split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`--blob 형식은 x,y 입니다: ${s}`);
    return [Math.round(x), Math.round(y)];
  });
  if (!seeds.length) throw new Error('지울 획 위의 좌표가 필요합니다 (예: --blob 450,700 --blob 565,700)');

  const cutDir = join(workdir, "cuts", cutId);
  const path = join(cutDir, "frames", `${pad2(n)}.png`);
  if (!existsSync(path)) throw new Error(`프레임이 없습니다: ${path}`);
  const { image, erased } = eraseInkBlobs(decodePng(readFileSync(path)), seeds);
  atomicWriteFile(path, Buffer.from(encodePng(image)));
  for (const e of erased) console.log(`✓ 프레임 ${pad2(n)} (${e.x},${e.y}) 획 ${e.px}px 지움`);

  // 어떤 프레임을 손댔는지 남긴다 — 재생성하면 좌표가 무의미해지므로 redo가 지운다.
  const cutPath = join(cutDir, "cut.json");
  if (existsSync(cutPath)) {
    const cut = JSON.parse(readFileSync(cutPath, "utf8"));
    cut.erased = { ...(cut.erased ?? {}), [n]: [...(cut.erased?.[n] ?? []), ...erased] };
    atomicWriteFile(cutPath, JSON.stringify(cut, null, 2) + "\n");
  }
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

async function cmdMirror(workdir, cutId, frameArg) {
  const numbers = String(frameArg ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  if (!numbers.length) throw new Error('반전할 프레임 번호가 필요합니다 (예: 2 또는 "2,8")');
  const framesDir = join(workdir, "cuts", cutId, "frames");
  if (!existsSync(framesDir)) throw new Error(`프레임이 없습니다: ${framesDir}`);
  for (const n of numbers) {
    const path = join(framesDir, `${pad2(n)}.png`);
    if (!existsSync(path)) throw new Error(`프레임이 없습니다: ${path}`);
    atomicWriteFile(path, Buffer.from(encodePng(mirrorImage(decodePng(readFileSync(path))))));
    console.log(`✓ 프레임 ${pad2(n)} 좌우 반전`);
  }
  console.log(`다음 단계: node _infra/emoticon.mjs build ${workdir} ${cutId}`);
}

// 비전 부품 검사 — 프레임마다 "귀가 몇 개인가"를 모델에게 묻고 report.json에
// 기록한다. 이미지 생성이 아니라 텍스트 응답이라 컷 하나에 몇 원 수준이다.
// 기하 검출이 두 설계 모두 실패해서 온 경로다 (lesson_learned §42~44).
async function cmdParts(workdir, cutId, options = {}) {
  const cutDir = join(workdir, "cuts", cutId);
  const framesDir = join(cutDir, "frames");
  if (!existsSync(framesDir)) throw new Error(`프레임이 없습니다: ${framesDir}`);
  const files = readdirSync(framesDir).filter((f) => /^\d{2}\.png$/.test(f)).sort();
  if (!files.length) throw new Error(`프레임이 없습니다: ${framesDir}`);

  let parts = RABBIT_PARTS;
  if (options.expect) {
    const expect = JSON.parse(options.expect);
    parts = RABBIT_PARTS.map((p) => (p.key in expect ? { ...p, expected: expect[p.key] } : p))
      .filter((p) => !(p.key in expect) || expect[p.key] !== null);
  }

  const apiKey = process.env.EMOTICON_IMAGE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 필요합니다 (비전 검사는 엣지 프록시를 쓰지 않습니다)");
  const model = await resolveVisionModel(apiKey, process.env.EMOTICON_VISION_MODEL || "");
  console.log(`  비전 모델: ${model}`);
  const ask = (imageB64, prompt) => geminiAsk({ apiKey, model, prompt, imagesB64: [imageB64] });

  const framesB64 = files.map((f) => bytesToBase64(readFileSync(join(framesDir, f))));
  const result = await inspectParts({ framesB64, parts, ask });
  result.counts.forEach((counts, i) => {
    console.log(`  ${files[i]}  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  });

  const reportPath = join(cutDir, "report.json");
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    report.parts = { model, expected: Object.fromEntries(parts.map((p) => [p.key, p.expected ?? null])), ...result };
    atomicWriteFile(reportPath, Buffer.from(JSON.stringify(report, null, 2) + "\n"));
  }
  if (result.violations.length) {
    for (const v of result.violations) console.log(`✗ 프레임 ${v.frame}: ${v.part} ${v.found}개 (기대 ${v.expected}개)`);
  } else {
    console.log("✓ 부품 개수 이상 없음");
  }
  return result;
}

const USAGE =
  'usage: node _infra/emoticon.mjs <명령> <작업폴더> ...\n' +
  '  guide  <동작>   ← 그 동작에서 읽을 문서만 알려준다 (컨텍스트 절약, 작업 시작점)\n' +
  '  sheet  <작업폴더> --prompt "캐릭터 설명" [--force]\n' +
  '  plan   <작업폴더> <컷id> <cut과 같은 옵션> [--resume] [--max-calls N] [--max-cost USD] [--json]\n' +
  '  cut    <작업폴더> <컷id> --motion "동작 설명" [--frames 12] [--fps 12] [--poses 파일] [--force|--resume]\n' +
  '         (--poses: 줄당 포즈 1개 = 프레임당 1개 — 프레임 간 튐을 줄이는 옵션)\n' +
  '  cut    <작업폴더> <컷id> --keys <spec.json> [--fps 12] [--force|--resume]  ← pose-to-pose\n' +
  '         spec: {"motion":"...","keys":[{"pose":"...","hold":2},...],"breakdowns":1,"assembly":"pingpong|loop"}\n' +
  '  cut    <작업폴더> <컷id> --skeletons <포즈시퀀스.json> [--grid] [--cell 512] [--force|--resume]\n' +
  '         스켈레톤 조건화 — _src/emoticon/poses/*.json 재사용. --grid는 단일 호출\n' +
  '  import <작업폴더> <컷id> <프레임폴더> [--fps 12] [--chroma] [--force]\n' +
  '  build  <작업폴더> <컷id> [--size 360] [--fps N] [--line]\n' +
  '  redo   <작업폴더> <컷id> "<프레임번호…>" [--force-redo]  ← 불량 프레임만 재생성\n' +
  '         장당 $0.04, "2,3" 가능. 프레임당 2회까지 — 넘으면 포즈 문장을 고치고 --force-redo\n' +
  '  mirror <작업폴더> <컷id> "<프레임번호…>"  ← 좌우 반전 (든 팔 방향 정렬, 무료)\n' +
  '  erase  <작업폴더> <컷id> <프레임> --blob x,y [--blob x,y …]  ← 몸통 안 군더더기 획 제거 (무료)\n' +
  '         외곽선과 떨어진 독립 잉크 덩어리만 지운다. 가장자리에 닿거나 너무 크면 거부\n' +
  '  unshadow <작업폴더> <컷id> "<프레임번호…>"  ← 외곽선 바깥 드롭섀도 제거 (무료)\n' +
  '  fit    <작업폴더> <컷id> "<프레임번호…>"  ← 혼자 커진 프레임을 나머지 중앙값 크기로 (무료)\n' +
  '  parts  <작업폴더> <컷id> [--expect \'{"ears":2}\']   ← 비전 부품 검사, report.json에 기록\n' +
  '  check  <작업폴더> <컷id> [--profile draft|master-2s|line] [--json]  ← FAIL이면 exit 1\n' +
  '작업폴더 권장 위치: _src/emoticon/<캐릭터명> (배포·커밋 제외)\n' +
  'env: EMOTICON_IMAGE_PROVIDER=edge(기본)|gemini|mock\n' +
  '  edge:   EMOTICON_EDGE_TOKEN=<work 마스터 비밀번호> (키는 GEMINI_STICKER_KEY Worker secret)\n' +
  '  gemini: GEMINI_API_KEY 또는 EMOTICON_IMAGE_API_KEY (로컬 직접 호출)';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { positional, options } = parseArgs(process.argv.slice(2));
    const [command, workdir, ...rest] = positional;
    if (command === "guide") { cmdGuide(workdir); process.exit(0); }
    if (!command || !workdir) throw new Error(USAGE);
    if (command === "sheet") await cmdSheet(workdir, options);
    else if (command === "plan") await cmdPlan(workdir, rest[0], options);
    else if (command === "cut") await cmdCut(workdir, rest[0], options);
    else if (command === "import") await cmdImport(workdir, rest[0], rest[1], options);
    else if (command === "build") await cmdBuild(workdir, rest[0], options);
    else if (command === "redo") await cmdRedo(workdir, rest[0], rest[1], options);
    else if (command === "parts") await cmdParts(workdir, rest[0], options);
    else if (command === "mirror") await cmdMirror(workdir, rest[0], rest[1]);
    else if (command === "erase") await cmdErase(workdir, rest[0], rest[1], options);
    else if (command === "unshadow") await cmdUnshadow(workdir, rest[0], rest[1]);
    else if (command === "fit") await cmdFit(workdir, rest[0], rest[1]);
    else if (command === "check") {
      const judgement = cmdCheck(workdir, rest[0], options);
      if (judgement.verdict === "fail") process.exit(1);
    }
    else throw new Error(`알 수 없는 명령: ${command}\n${USAGE}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
