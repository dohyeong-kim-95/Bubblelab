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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import { encodeApng, inspectApng } from "./apng.mjs";
import { imageProvider } from "./emoticon-ai.mjs";
import { cutoutBackground, decodeSheet } from "./sticker-pack.mjs";

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

const SHEET_PROMPT = (desc) =>
  `이모티콘 캐릭터 레퍼런스 시트를 그려줘. 캐릭터: ${desc}\n` +
  "구성: 정면 전신 크게 1개 + 측면·뒷면 작게 + 대표 표정(기쁨/슬픔/화남/놀람) 4개.\n" +
  "스타일: 두꺼운 깔끔한 외곽선의 플랫 스티커 일러스트, 순수한 흰색 배경, 텍스트 없음.\n" +
  "이 시트는 이후 모든 프레임 생성의 레퍼런스이므로 색·비율·장식이 명확해야 한다.";

const FRAME_PROMPT = (motion, index, total, pose = "") =>
  `첨부 이미지는 이 캐릭터의 레퍼런스 시트(첫 장)와 직전 프레임들이다. ` +
  `정확히 같은 캐릭터(색·비율·장식 동일)로, "${motion}" 동작의 ${total}프레임 루프 애니메이션 중 ` +
  `프레임 ${index}/${total}을 그려줘.\n` +
  (pose ? `이 프레임의 포즈(정확히 따를 것): ${pose}\n` : "") +
  "규칙: 마지막 프레임은 첫 프레임으로 자연스럽게 이어지는 루프여야 한다. " +
  "캐릭터는 캔버스 중앙, 프레임 간 크기와 위치를 유지하고 직전 프레임에서 조금만 움직인다. " +
  "배경은 순수한 흰색 단색, 캐릭터의 외곽선은 끊김 없이 닫혀 있어야 한다. " +
  "그림자·소품·텍스트 등 캐릭터 외 요소 금지.";

// pose-to-pose 모드 프롬프트 (animation-techniques.md §1·§7)
const KEY_PROMPT = (motion, index, total, pose) =>
  `첨부 이미지는 이 캐릭터의 레퍼런스 시트(첫 장)${index > 1 ? "와 이 동작의 앞선 키 포즈" : ""}다. ` +
  `정확히 같은 캐릭터(색·비율·장식 동일)로, "${motion}" 동작의 키 포즈 ${index}/${total}을 그려줘.\n` +
  `이 키 포즈(정확히 따를 것): ${pose}\n` +
  "규칙: 동작의 극단을 과장되게, 한눈에 읽히는 실루엣으로. 캐릭터는 캔버스 중앙, 크기 동일. " +
  "배경은 순수한 흰색 단색, 외곽선은 끊김 없이 닫혀 있어야 한다. 그림자·소품·텍스트 금지.";

const BREAKDOWN_PROMPT = (motion, poseA, poseB) =>
  `첨부 이미지는 캐릭터 시트, 그리고 "${motion}" 동작의 연속된 두 키 포즈 A·B다. ` +
  `정확히 같은 캐릭터로, A에서 B로 넘어가는 정확히 중간 자세(브레이크다운) 한 장을 그려줘.\n` +
  `A: ${poseA}\nB: ${poseB}\n` +
  "규칙: 손·머리의 이동 경로는 직선이 아니라 자연스러운 호를 따른다. " +
  "캐릭터의 크기·위치는 두 키 포즈와 동일. 배경은 순수한 흰색 단색, " +
  "외곽선은 닫혀 있게. 그림자·소품·텍스트 금지.";

// ── 명령 구현 ───────────────────────────────────────────────────────────

async function toRgba(bytes) {
  return decodeSheet(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
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
  writeFileSync(path, encodePng(await toRgba(bytes)));
  writeFileSync(join(workdir, "sheet-prompt.txt"), options.prompt.trim() + "\n");
  console.log(`✓ 캐릭터 시트 저장 (${provider.name}) → ${path}`);
  console.log("시트가 마음에 들 때까지 --force로 다시 뽑은 뒤 cut을 시작하세요.");
}

async function cmdCut(workdir, cutId, options) {
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
  if (existsSync(cutDir) && !options.force) throw new Error(`이미 존재하는 컷입니다: ${cutDir} (덮어쓰려면 --force)`);
  // 포즈 스크립트(선택): 줄당 1개 = 프레임당 1개. 프레임 간 튐(보일링)을
  // 줄이는 핵심 수단 — 동작 진행을 프레임 번호가 아니라 포즈 문장으로 고정한다.
  let poses = null;
  if (options.poses) {
    poses = readFileSync(options.poses, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    if (poses.length !== total) {
      throw new Error(`포즈 스크립트는 프레임 수와 같아야 합니다 (포즈 ${poses.length}줄 ≠ ${total}프레임)`);
    }
  }

  const provider = imageProvider();
  const sheet = readFileSync(sheetPath);
  mkdirSync(join(cutDir, "frames"), { recursive: true });
  mkdirSync(join(cutDir, "frames-raw"), { recursive: true });

  const rawFrames = [];
  for (let i = 1; i <= total; i++) {
    const references = [sheet, ...(rawFrames.length ? [rawFrames[0]] : []), ...(rawFrames.length > 1 ? [rawFrames[rawFrames.length - 1]] : [])];
    const bytes = await provider.generate({
      prompt: FRAME_PROMPT(options.motion.trim(), i, total, poses?.[i - 1] ?? ""),
      references,
    });
    rawFrames.push(bytes);
    // 원본을 먼저 저장해 실패해도 디버깅 근거가 남게 한다
    writeFileSync(join(cutDir, "frames-raw", `${pad2(i)}.png`), Buffer.from(bytes));
    const keyed = autoCutout(await toRgba(bytes));
    const ratio = transparencyRatio(keyed);
    if (ratio < 0.05) {
      throw new Error(
        `프레임 ${pad2(i)} 누끼 실패 (투명 ${Math.round(ratio * 100)}%) — ` +
        `frames-raw/${pad2(i)}.png 확인 후 --force로 재시도`,
      );
    }
    writeFileSync(join(cutDir, "frames", `${pad2(i)}.png`), encodePng(keyed));
    console.log(`  프레임 ${pad2(i)}/${pad2(total)} (투명 ${Math.round(ratio * 100)}%)`);
  }
  writeFileSync(join(cutDir, "cut.json"), JSON.stringify({
    motion: options.motion.trim(), frames: total, fps,
    ...(poses ? { poses } : {}),
    provider: provider.name, createdAt: new Date().toISOString().slice(0, 10),
  }, null, 2) + "\n");
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
  if (![0, 1].includes(breakdowns)) throw new Error("breakdowns는 0 또는 1만 지원합니다 (v1)");
  const assembly = spec.assembly ?? "pingpong";
  if (!["pingpong", "loop"].includes(assembly)) throw new Error('assembly는 "pingpong" 또는 "loop"');
  const fps = Number(options.fps ?? spec.fps ?? 12);
  const sheetPath = join(workdir, "sheet.png");
  if (!existsSync(sheetPath)) throw new Error(`캐릭터 시트가 없습니다 — 먼저: emoticon.mjs sheet ${workdir} --prompt "..."`);
  const cutDir = join(workdir, "cuts", cutId);
  if (existsSync(cutDir) && !options.force) throw new Error(`이미 존재하는 컷입니다: ${cutDir} (덮어쓰려면 --force)`);

  const provider = imageProvider();
  const sheet = readFileSync(sheetPath);
  mkdirSync(join(cutDir, "frames"), { recursive: true });
  mkdirSync(join(cutDir, "frames-raw"), { recursive: true });

  const keyAndValidate = async (bytes, label, rawName) => {
    writeFileSync(join(cutDir, "frames-raw", rawName), Buffer.from(bytes));
    const keyed = autoCutout(await toRgba(bytes));
    const ratio = transparencyRatio(keyed);
    if (ratio < 0.05) {
      throw new Error(`${label} 누끼 실패 (투명 ${Math.round(ratio * 100)}%) — frames-raw/${rawName} 확인 후 --force로 재시도`);
    }
    return keyed;
  };

  // ① 키 포즈 — 시트(+앞선 키)를 레퍼런스로 극단만 생성
  const keyRaw = [];
  const keyImages = [];
  for (let i = 0; i < keys.length; i++) {
    const references = [sheet, ...(keyRaw.length ? [keyRaw[0]] : []), ...(keyRaw.length > 1 ? [keyRaw[keyRaw.length - 1]] : [])];
    const bytes = await provider.generate({ prompt: KEY_PROMPT(motion, i + 1, keys.length, keys[i].pose.trim()), references });
    keyRaw.push(bytes);
    keyImages.push(await keyAndValidate(bytes, `키 ${i + 1}`, `key-${i + 1}.png`));
    console.log(`  키 포즈 ${i + 1}/${keys.length}`);
  }

  // ② 브레이크다운 — 키 쌍의 양쪽 이미지를 함께 레퍼런스로
  const pairs = [];
  for (let i = 0; i < keys.length - 1; i++) pairs.push([i, i + 1]);
  if (assembly === "loop") pairs.push([keys.length - 1, 0]);
  const bdImages = new Map();
  if (breakdowns === 1) {
    for (const [a, b] of pairs) {
      const bytes = await provider.generate({
        prompt: BREAKDOWN_PROMPT(motion, keys[a].pose.trim(), keys[b].pose.trim()),
        references: [sheet, keyRaw[a], keyRaw[b]],
      });
      bdImages.set(`${a}-${b}`, await keyAndValidate(bytes, `브레이크다운 ${a + 1}→${b + 1}`, `bd-${a + 1}-${b + 1}.png`));
      console.log(`  브레이크다운 ${a + 1}→${b + 1}`);
    }
  }

  // ③ 조립 — 유니크 프레임 나열 + 타임라인(홀드는 delay로, 핑퐁은 역순 항목으로)
  const unique = [];   // { image, delayFrames }
  const keyIndex = []; // 키 i의 unique 위치 (핑퐁 역순 계산용)
  for (let i = 0; i < keys.length; i++) {
    keyIndex.push(unique.length);
    unique.push({ image: keyImages[i], delayFrames: Math.max(1, Number(keys[i].hold ?? 1)) });
    const pairKey = `${i}-${i + 1}`;
    if (bdImages.has(pairKey)) unique.push({ image: bdImages.get(pairKey), delayFrames: 1 });
  }
  if (assembly === "loop" && bdImages.has(`${keys.length - 1}-0`)) {
    unique.push({ image: bdImages.get(`${keys.length - 1}-0`), delayFrames: 1 });
  }
  const frameDelay = 1000 / fps;
  const timeline = unique.map((u, index) => ({ frame: index, delayMs: Math.round(u.delayFrames * frameDelay) }));
  if (assembly === "pingpong") {
    for (let i = unique.length - 2; i >= 1; i--) {
      timeline.push({ frame: i, delayMs: Math.round(unique[i].delayFrames * frameDelay) });
    }
  }

  unique.forEach((u, i) => writeFileSync(join(cutDir, "frames", `${pad2(i + 1)}.png`), encodePng(u.image)));
  writeFileSync(join(cutDir, "cut.json"), JSON.stringify({
    motion, fps, mode: "keys", keys, breakdowns, assembly,
    frames: unique.length, timeline,
    provider: provider.name, createdAt: new Date().toISOString().slice(0, 10),
  }, null, 2) + "\n");
  console.log(`✓ ${cutId} 컷 생성 (유니크 ${unique.length}장 → 타임라인 ${timeline.length}프레임, ${assembly})`);
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
  if (existsSync(cutDir) && !options.force) throw new Error(`이미 존재하는 컷입니다: ${cutDir} (덮어쓰려면 --force)`);
  mkdirSync(join(cutDir, "frames"), { recursive: true });

  for (const [i, file] of files.entries()) {
    let rgba = await toRgba(readFileSync(join(srcDir, file)));
    if (options.chroma) rgba = chromaKeyGreen(rgba);
    const ratio = transparencyRatio(rgba);
    if (ratio < 0.05) {
      throw new Error(
        `프레임 ${file} 이 불투명합니다 (투명 ${Math.round(ratio * 100)}%) — ` +
        "초록 배경 영상이면 --chroma, 이미 투명한 프레임이면 원본을 확인하세요",
      );
    }
    writeFileSync(join(cutDir, "frames", `${pad2(i + 1)}.png`), encodePng(rgba));
  }
  writeFileSync(join(cutDir, "cut.json"), JSON.stringify({
    motion: options.motion?.trim() || `import:${srcDir}`, frames: files.length, fps,
    provider: "import", createdAt: new Date().toISOString().slice(0, 10),
  }, null, 2) + "\n");
  console.log(`✓ ${cutId} 컷 가져옴 (${files.length}프레임) → ${cutDir}`);
}

async function cmdBuild(workdir, cutId, options) {
  const cutDir = join(workdir, "cuts", cutId);
  const framesDir = join(cutDir, "frames");
  if (!existsSync(framesDir)) throw new Error(`컷이 없습니다: ${cutDir} — 먼저 cut 또는 import를 실행하세요`);
  const meta = JSON.parse(readFileSync(join(cutDir, "cut.json"), "utf8"));
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
  writeFileSync(outPath, apng);

  const diff = loopDiff(sequence[0], sequence[sequence.length - 1]);
  let adjacent = 0;
  for (let i = 1; i < sequence.length; i++) adjacent = Math.max(adjacent, loopDiff(sequence[i - 1], sequence[i]));
  const duration = delaysMs ? delaysMs.reduce((a, b) => a + b, 0) / 1000 : files.length / fps;
  console.log(
    `✓ ${outPath} — ${size}², 유니크 ${files.length}장/타임라인 ${sequence.length}프레임 ` +
    `(${duration.toFixed(2)}초), ${(apng.length / 1024).toFixed(0)}KB`,
  );
  console.log(`  루프 diff ${(diff * 100).toFixed(1)}% ${diff > 0.12 ? "⚠ 루프가 튈 수 있습니다 — 첫/끝 프레임을 확인하세요" : "(양호)"}`);
  console.log(`  인접 diff 최대 ${(adjacent * 100).toFixed(1)}% ${adjacent > 0.2 ? "⚠ 프레임 간 점프가 큽니다" : "(양호)"}`);
  if (duration > 4) console.log("  ⚠ 4초 초과 — LINE 재생시간 상한(4초)을 넘습니다");

  if (options.line) {
    if (sequence.length < LINE_FRAMES[0] || sequence.length > LINE_FRAMES[1]) {
      throw new Error(`LINE 변환은 ${LINE_FRAMES[0]}~${LINE_FRAMES[1]}프레임이어야 합니다 (현재 ${sequence.length})`);
    }
    const lineApng = encodeApng(expand(fitFrames(frames, LINE_SIZE)), { fps, delaysMs, loops: 4 });
    const linePath = join(outDir, `${cutId}-line.png`);
    writeFileSync(linePath, lineApng);
    const ok = lineApng.length <= LINE_MAX_BYTES;
    console.log(`✓ ${linePath} — ${LINE_SIZE}², ${(lineApng.length / 1024).toFixed(0)}KB ${ok ? "(≤300KB)" : ""}`);
    if (!ok) {
      throw new Error(
        `LINE 300KB 초과 (${(lineApng.length / 1024).toFixed(0)}KB) — ` +
        "프레임 수를 줄이거나(build --fps 유지한 채 프레임 삭제) 동작 폭을 줄여 다시 생성하세요",
      );
    }
  }
  return { outPath, frames: sequence.length, fps, diff, adjacent };
}

function cmdCheck(workdir, cutId) {
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
}

// ── CLI ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const options = {};
  const flags = new Set(["force", "line", "chroma"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && flags.has(arg.slice(2))) options[arg.slice(2)] = true;
    else if (arg.startsWith("--")) options[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { positional, options };
}

const USAGE =
  'usage: node _infra/emoticon.mjs <명령> <작업폴더> ...\n' +
  '  sheet  <작업폴더> --prompt "캐릭터 설명" [--force]\n' +
  '  cut    <작업폴더> <컷id> --motion "동작 설명" [--frames 12] [--fps 12] [--poses 파일] [--force]\n' +
  '         (--poses: 줄당 포즈 1개 = 프레임당 1개 — 프레임 간 튐을 줄이는 옵션)\n' +
  '  cut    <작업폴더> <컷id> --keys <spec.json> [--fps 12] [--force]  ← 권장 (pose-to-pose)\n' +
  '         spec: {"motion":"...","keys":[{"pose":"...","hold":2},...],"breakdowns":1,"assembly":"pingpong|loop"}\n' +
  '  import <작업폴더> <컷id> <프레임폴더> [--fps 12] [--chroma] [--force]\n' +
  '  build  <작업폴더> <컷id> [--size 360] [--fps N] [--line]\n' +
  '  check  <작업폴더> <컷id>\n' +
  '작업폴더 권장 위치: _src/emoticon/<캐릭터명> (배포·커밋 제외)\n' +
  'env: EMOTICON_IMAGE_PROVIDER=edge(기본)|gemini|mock\n' +
  '  edge:   EMOTICON_EDGE_TOKEN=<work 마스터 비밀번호> (키는 GEMINI_STICKER_KEY Worker secret)\n' +
  '  gemini: GEMINI_API_KEY 또는 EMOTICON_IMAGE_API_KEY (로컬 직접 호출)';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [command, workdir, ...rest] = positional;
  try {
    if (!command || !workdir) throw new Error(USAGE);
    if (command === "sheet") await cmdSheet(workdir, options);
    else if (command === "cut") await cmdCut(workdir, rest[0], options);
    else if (command === "import") await cmdImport(workdir, rest[0], rest[1], options);
    else if (command === "build") await cmdBuild(workdir, rest[0], options);
    else if (command === "check") cmdCheck(workdir, rest[0]);
    else throw new Error(`알 수 없는 명령: ${command}\n${USAGE}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
