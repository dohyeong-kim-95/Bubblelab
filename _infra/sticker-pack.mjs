// 스티커 팩 원샷 생성기.
// 4x4(기본) 그리드 시트 이미지 하나를 받아 개별 스티커로 자르고, 팩 폴더와
// metadata.json, 카탈로그 미리보기, util/chat 서버 등록(CHAT_STICKER_PACKS),
// _assets/sticker/README.md 표까지 한 번에 갱신한다. 외부 의존성 없음.
//
//   node _infra/sticker-pack.mjs <시트이미지.png|.jpg> <팩id> --title "제목" \
//     [--grid 4x4] [--labels labels.txt] [--chat "짧은제목"] [--chat-no-cutout] \
//     [--desc "설명"] [--tags "태그,태그"] [--force]
//
// --labels: 셀 순서(좌→우, 위→아래)대로 한 줄에 하나씩 적은 텍스트 파일.
//           "NN. 라벨" 형태로 저장된다. 없으면 "01"–"NN" 플레이스홀더.
// --chat:   지정하면 익명 채팅 스티커 서랍에도 등록된다 (metadata.json의
//           chat.title + _infra/chat.js의 CHAT_STICKER_PACKS 자동 패치).
//           util/chat 클라이언트는 catalog.json에서 팩을 읽으므로 손댈 곳 없음.
//           --chat-no-cutout: 채팅 클라이언트의 흰 배경 누끼를 생략
//           (흰 캐릭터가 같이 지워지는 팩, 이미 투명한 팩용).
// 입력 시트는 PNG(자체 코덱) 또는 JPEG(jpeg-js) — 매직 바이트로 자동 판별.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import { readAssetMetadata } from "./assets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const PREVIEW_MAX_WIDTH = 512;
// 셀 트리밍 시 배경 판정: 거의 투명하거나 거의 흰색
const TRIM_ALPHA_MAX = 16;
const TRIM_WHITE_MIN = 246;
const TRIM_PADDING = 4;

// PNG는 자체 코덱, JPEG는 jpeg-js(순수 JS)로 디코드해 RGBA로 통일한다.
export async function decodeSheet(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return decodePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let jpeg;
    try {
      ({ default: jpeg } = await import("jpeg-js"));
    } catch {
      throw new Error("JPEG 디코더(jpeg-js)가 없습니다 — 리포 루트에서 npm ci 후 다시 실행하세요");
    }
    const { width, height, data } = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 1024 });
    return { width, height, data };
  }
  throw new Error("지원하지 않는 이미지 형식입니다 — PNG 또는 JPEG 시트를 주세요");
}

export function parseGrid(text) {
  const match = /^(\d+)x(\d+)$/.exec(String(text).trim());
  const cols = match && Number(match[1]);
  const rows = match && Number(match[2]);
  if (!match || cols < 1 || rows < 1 || cols * rows > 99) {
    throw new Error(`--grid 형식은 "4x4"처럼 열x행이어야 합니다 (최대 99장): ${text}`);
  }
  return { cols, rows };
}

export function crop(image, x, y, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const src = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(src, src + width * 4), row * width * 4);
  }
  return { width, height, data };
}

// 시트를 cols x rows 셀로 균등 분할 (좌→우, 위→아래)
export function sliceGrid(image, cols, rows) {
  if (image.width < cols || image.height < rows) {
    throw new Error(`이미지(${image.width}x${image.height})가 ${cols}x${rows} 그리드보다 작습니다`);
  }
  const cells = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x = Math.round((gx * image.width) / cols);
      const y = Math.round((gy * image.height) / rows);
      const right = Math.round(((gx + 1) * image.width) / cols);
      const bottom = Math.round(((gy + 1) * image.height) / rows);
      cells.push(crop(image, x, y, right - x, bottom - y));
    }
  }
  return cells;
}

function isBackground(data, i) {
  if (data[i + 3] < TRIM_ALPHA_MAX) return true;
  return Math.min(data[i], data[i + 1], data[i + 2]) >= TRIM_WHITE_MIN;
}

// 내용이 있는 픽셀의 경계 상자. 전부 배경이면 null.
export function contentBounds(image) {
  const { width, height, data } = image;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBackground(data, (y * width + x) * 4)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

// 투명/흰 여백을 잘라내되 사방 TRIM_PADDING 픽셀은 남긴다.
// 내용이 전혀 없으면 null (빈 셀 감지용).
export function trimCell(image) {
  const bounds = contentBounds(image);
  if (!bounds) return null;
  const x = Math.max(0, bounds.left - TRIM_PADDING);
  const y = Math.max(0, bounds.top - TRIM_PADDING);
  const right = Math.min(image.width - 1, bounds.right + TRIM_PADDING);
  const bottom = Math.min(image.height - 1, bounds.bottom + TRIM_PADDING);
  return crop(image, x, y, right - x + 1, bottom - y + 1);
}

// 박스 평균 축소 (알파 가중 — 반투명 경계에서 배경색이 번지지 않게)
export function downscale(image, maxWidth) {
  if (image.width <= maxWidth) return image;
  const scale = maxWidth / image.width;
  const width = maxWidth;
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * image.width + sx) * 4;
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

const pad2 = (n) => String(n).padStart(2, "0");

// _infra/chat.js의 CHAT_STICKER_PACKS에 팩을 등록한 소스를 돌려준다.
// 이미 같은 값이면 그대로, 항목은 id 알파벳순으로 유지한다.
export function withChatPack(source, id, count) {
  const match = source.match(
    /(export const CHAT_STICKER_PACKS = new Map\(\[\n)([\s\S]*?)(\]\);)/,
  );
  if (!match) throw new Error("chat.js에서 CHAT_STICKER_PACKS 블록을 찾지 못했습니다");
  const entries = new Map(
    [...match[2].matchAll(/\["([^"]+)",\s*(\d+)\]/g)].map((m) => [m[1], Number(m[2])]),
  );
  entries.set(id, count);
  const body = [...entries.keys()]
    .sort()
    .map((pack) => `  ["${pack}", ${entries.get(pack)}],\n`)
    .join("");
  return source.replace(match[0], `${match[1]}${body}${match[3]}`);
}

// _assets/sticker/README.md의 팩 표에 행을 추가한 문서를 돌려준다.
export function withReadmeRow(source, id, title, count) {
  if (source.includes(`| \`${id}\` |`)) return source;
  const lines = source.split("\n");
  let lastRow = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\| `[^`]+` \|/.test(lines[i])) lastRow = i;
  }
  if (lastRow < 0) throw new Error("_assets/sticker/README.md에서 팩 표를 찾지 못했습니다");
  lines.splice(lastRow + 1, 0, `| \`${id}\` | ${title} | \`01.png\`–\`${pad2(count)}.png\` |`);
  return lines.join("\n");
}

export function buildLabels(labelsText, count) {
  if (labelsText == null) return Array.from({ length: count }, (_, i) => pad2(i + 1));
  const lines = labelsText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length !== count) {
    throw new Error(`라벨은 정확히 ${count}줄이어야 합니다 (현재 ${lines.length}줄)`);
  }
  return lines.map((line, i) => `${pad2(i + 1)}. ${line.replace(/^\d{2}\.\s*/, "")}`);
}

// 시트 이미지 → 팩 폴더 생성 + 등록. CLI와 테스트가 함께 쓴다.
export async function buildStickerPack({
  imagePath,
  id,
  title,
  grid = "4x4",
  labelsText = null,
  chatTitle = null,
  chatCutout = true,
  description = "",
  tags = [],
  createdAt,
  force = false,
  root = ROOT,
}) {
  if (!PACK_ID_RE.test(id)) {
    throw new Error(`팩 id는 영소문자·숫자·하이픈만 가능합니다: ${id}`);
  }
  if (!title?.trim()) throw new Error("--title 은 필수입니다");
  const { cols, rows } = parseGrid(grid);
  const count = cols * rows;
  const labels = buildLabels(labelsText, count);

  const packDir = join(root, "_assets", "sticker", id);
  if (existsSync(packDir) && !force) {
    throw new Error(`이미 존재하는 팩입니다: ${packDir} (덮어쓰려면 --force)`);
  }

  const sheet = await decodeSheet(readFileSync(imagePath));
  const cells = sliceGrid(sheet, cols, rows);
  const trimmed = cells.map((cell, i) => {
    const result = trimCell(cell);
    if (!result) {
      throw new Error(`${i + 1}번째 셀(${pad2(i + 1)})이 비어 있습니다 — 그리드 수를 확인하세요`);
    }
    return result;
  });

  mkdirSync(packDir, { recursive: true });
  for (let i = 0; i < trimmed.length; i++) {
    writeFileSync(join(packDir, `${pad2(i + 1)}.png`), encodePng(trimmed[i]));
  }
  writeFileSync(join(packDir, "preview.png"), encodePng(downscale(sheet, PREVIEW_MAX_WIDTH)));

  const metadata = {
    title: title.trim(),
    description: String(description || "").trim(),
    preview: "preview.png",
    tags: tags.map((tag) => String(tag).trim()).filter(Boolean),
    createdAt: createdAt ?? new Date().toISOString().slice(0, 10),
    ...(chatTitle?.trim()
      ? { chat: { title: chatTitle.trim(), ...(chatCutout ? {} : { cutout: false }) } }
      : {}),
    downloads: labels.map((label, i) => ({ label, file: `${pad2(i + 1)}.png` })),
  };
  writeFileSync(join(packDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");

  // 빌드와 같은 검증을 즉시 돌려 커밋 전에 실패를 알린다
  readAssetMetadata(join(root, "_assets"), "sticker", packDir);

  const touched = [`_assets/sticker/${id}/ (${count}장 + preview.png + metadata.json)`];
  if (chatTitle?.trim()) {
    const chatPath = join(root, "_infra", "chat.js");
    writeFileSync(chatPath, withChatPack(readFileSync(chatPath, "utf8"), id, count));
    touched.push("_infra/chat.js (CHAT_STICKER_PACKS)");
  }
  const readmePath = join(root, "_assets", "sticker", "README.md");
  if (existsSync(readmePath)) {
    writeFileSync(readmePath, withReadmeRow(readFileSync(readmePath, "utf8"), id, title.trim(), count));
    touched.push("_assets/sticker/README.md");
  }
  return { id, count, packDir, touched };
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  const flags = new Set(["force", "chat-no-cutout"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && flags.has(arg.slice(2))) options[arg.slice(2)] = true;
    else if (arg.startsWith("--")) options[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { positional, options };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [imagePath, id] = positional;
  if (!imagePath || !id) {
    console.error(
      'usage: node _infra/sticker-pack.mjs <시트이미지.png|.jpg> <팩id> --title "제목"\n' +
      '       [--grid 4x4] [--labels labels.txt] [--chat "짧은제목"] [--chat-no-cutout]\n' +
      '       [--desc "설명"] [--tags "태그,태그"] [--force]',
    );
    process.exit(1);
  }
  try {
    const result = await buildStickerPack({
      imagePath,
      id,
      title: options.title,
      grid: options.grid ?? "4x4",
      labelsText: options.labels ? readFileSync(options.labels, "utf8") : null,
      chatTitle: options.chat ?? null,
      chatCutout: !options["chat-no-cutout"],
      description: options.desc ?? "",
      tags: options.tags ? options.tags.split(",") : [],
      force: options.force ?? false,
    });
    console.log(`✓ ${result.id} 팩 생성 (${result.count}장)`);
    for (const line of result.touched) console.log(`  - ${line}`);
    console.log("다음 단계: node --test _infra/*.test.mjs && node _infra/build.mjs");
    if (!options.labels) console.log("(라벨이 플레이스홀더입니다 — metadata.json의 label을 채워주세요)");
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
