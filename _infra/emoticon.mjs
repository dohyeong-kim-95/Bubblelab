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
import { applyRig, faceDropRatio } from "./emoticon-rig.mjs";
import { RABBIT_PARTS, inspectParts } from "./emoticon-vision.mjs";
import { DEFAULT_VISION_MODEL, bytesToBase64, geminiAsk } from "./emoticon-gen.js";
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

// keys 모드 — 변화 먼저, 불변 나중 (work/emoticon/prompting.md §3).
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
  if (!Array.isArray(keys) || keys.length < 2 || keys.length > 6 || keys.some((k) => !k?.pose?.trim())) {
    throw new Error("keys는 pose 문장을 가진 2~6개의 키 포즈여야 합니다");
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
  const input = { motion, fps, keys, breakdowns, assembly, invariants, poseConstants, breakdownNote, repeat };
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
      const keyed = keys[i].rig ? rigKey(await toRgba(bytes), keys[i].rig, i + 1) : drawn;
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
    if (!Array.isArray(keys) || keys.length < 2 || keys.length > 6 || keys.some((key) => !key?.pose?.trim())) {
      throw new Error("keys는 pose 문장을 가진 2~6개의 키 포즈여야 합니다");
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
    const input = { motion, fps, keys, breakdowns, assembly, invariants, poseConstants, breakdownNote, repeat };
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
async function cmdRedo(workdir, cutId, frameArg) {
  const cutDir = join(workdir, "cuts", cutId);
  const metaPath = join(cutDir, "cut.json");
  if (!existsSync(metaPath)) throw new Error(`컷이 없습니다: ${cutDir}`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.mode !== "keys" || !Array.isArray(meta.sequence)) {
    throw new Error("redo는 keys 모드 컷만 지원합니다 (cut --keys로 생성한 컷)");
  }
  assertCurrentReference(meta, workdir);
  const n = Number(frameArg);
  if (!Number.isInteger(n) || n < 1 || n > meta.sequence.length) {
    throw new Error(`프레임 번호는 1~${meta.sequence.length} 입니다`);
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
  const keyed = autoCutout(await toRgba(bytes));
  const ratio = transparencyRatio(keyed);
  if (ratio < 0.05) {
    throw new Error(`${label} 누끼 실패 (투명 ${Math.round(ratio * 100)}%) — frames-raw/${rawName} 확인 후 다시 redo`);
  }
  atomicWriteFile(join(cutDir, "frames", `${pad2(n)}.png`), encodePng(keyed));
  console.log(`✓ 프레임 ${pad2(n)} (${label}) 재생성 (${provider.name})`);
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
  const frames = files.map((f) => decodePng(readFileSync(join(framesDir, f))));

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
  const flags = new Set(["force", "resume", "line", "chroma", "grid", "json"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && flags.has(arg.slice(2))) options[arg.slice(2)] = true;
    else if (arg.startsWith("--")) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${arg} 값이 필요합니다`);
      options[arg.slice(2)] = argv[++i];
    }
    else positional.push(arg);
  }
  return { positional, options };
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
  const model = process.env.EMOTICON_VISION_MODEL || DEFAULT_VISION_MODEL;
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
  '  redo   <작업폴더> <컷id> <프레임번호>   ← keys 컷에서 튄 프레임만 재생성 ($0.04)\n' +
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
    if (!command || !workdir) throw new Error(USAGE);
    if (command === "sheet") await cmdSheet(workdir, options);
    else if (command === "plan") await cmdPlan(workdir, rest[0], options);
    else if (command === "cut") await cmdCut(workdir, rest[0], options);
    else if (command === "import") await cmdImport(workdir, rest[0], rest[1], options);
    else if (command === "build") await cmdBuild(workdir, rest[0], options);
    else if (command === "redo") await cmdRedo(workdir, rest[0], rest[1]);
    else if (command === "parts") await cmdParts(workdir, rest[0], options);
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
