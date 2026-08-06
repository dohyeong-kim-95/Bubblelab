// 배경화면 원샷 등록기.
// 이미지 하나를 받아 기기별 규격으로 잘라 넣고(_assets/wallpaper/<id>/),
// 미리보기·metadata.json·_assets/wallpaper/README.md 표까지 한 번에 갱신한다.
// 세션에 이미지를 올린 뒤 그 경로를 그대로 넘기면 된다. 외부 의존성 없음
// (PNG는 자체 코덱, JPEG는 sticker-pack과 같은 jpeg-js 경로를 함께 쓴다).
//
//   node _infra/wallpaper.mjs <이미지.png|.jpg> <id> --title "제목" \
//     [--sizes mobile,desktop] [--focus center|top|bottom|left|right] \
//     [--format jpg|png] [--desc "설명"] [--tags "태그,태그"] [--quality 90] [--force]
//
// 규격(--sizes)은 아래 PRESETS의 키를 쉼표로 나열한다. 잘라내기는 항상
// "채우기(cover)" — 대상 비율로 가운데(--focus로 조정) 잘라낸 뒤 축소한다.
// **확대는 하지 않는다**: 원본이 규격보다 작으면 비율만 맞춘 원본 해상도로
// 저장하고 라벨에 실제 크기를 적는다(있지도 않은 해상도를 광고하지 않는다).
// 출력은 항상 재인코딩되므로 EXIF(촬영 위치·기기)는 자동으로 사라진다.
// --format: 사진은 jpg(기본), 어두운 그라데이션·가는 선·작은 글씨가 있는
// 그래픽(util/stars 같은 생성 이미지)은 png. JPEG는 넓은 어두운 면에서
// 띠(banding)가 보일 수 있고, PNG는 무손실이지만 3–4배 크다.
// 미리보기는 카탈로그 페이지 무게 때문에 --format 과 무관하게 항상 JPEG다.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.mjs";
import { coverCrop } from "../_shared/crop.js";
import { decodeSheet as decodeImage } from "./sticker-pack.mjs";
import { readAssetMetadata } from "./assets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const PREVIEW_MAX = 800;
const PREVIEW_QUALITY = 78;
const DEFAULT_QUALITY = 90;
const DEFAULT_SIZES = "mobile,desktop";
const FORMATS = new Set(["jpg", "png"]);
// 투명 배경은 배경화면으로 쓸 수 없다(JPEG에 알파가 없다) — 흰색으로 합성한다.
const FLATTEN_COLOR = [255, 255, 255];

// 규격 프리셋. width/height 가 null 이면 원본 비율 유지(긴 변만 max로 제한).
export const PRESETS = {
  mobile: { label: "모바일", width: 1290, height: 2796 },
  tablet: { label: "태블릿", width: 2048, height: 2732 },
  desktop: { label: "PC", width: 2560, height: 1440 },
  wide: { label: "울트라와이드", width: 3440, height: 1440 },
  square: { label: "정사각", width: 2048, height: 2048 },
  original: { label: "원본 비율", width: null, height: null, max: 4096 },
};

const FOCUS = new Set(["center", "top", "bottom", "left", "right"]);

export function parseSizes(text) {
  const names = String(text).split(",").map((name) => name.trim()).filter(Boolean);
  if (!names.length) throw new Error("--sizes 에 규격을 하나 이상 적어주세요");
  for (const name of names) {
    if (!PRESETS[name]) {
      throw new Error(`알 수 없는 규격입니다: ${name} (가능: ${Object.keys(PRESETS).join(", ")})`);
    }
  }
  return [...new Set(names)];
}

// 파일명에서 id 후보를 만든다 (영소문자·숫자·하이픈만 남김).
export function slugify(name) {
  return basename(String(name), extname(String(name)))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// 잘라내기 계산은 `_shared/crop.js` 하나만 쓴다 — 클라이언트의
// "내 기기에 맞게 저장"이 같은 결과를 내야 한다.
export { coverCrop };

export function crop(image, { x, y, width, height }) {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const src = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(src, src + width * 4), row * width * 4);
  }
  return { width, height, data };
}

// 정확한 크기로 축소(박스 평균). 확대 요청은 원본을 그대로 돌려준다.
export function resizeTo(image, width, height) {
  if (width >= image.width && height >= image.height) return image;
  const data = new Uint8Array(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) * scaleX)));
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

// 반투명 픽셀을 배경색 위에 합성해 완전 불투명하게 만든다.
export function flatten(image, color = FLATTEN_COLOR) {
  const data = new Uint8Array(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 255) continue;
    const ratio = alpha / 255;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * ratio + color[c] * (1 - ratio));
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

// 카탈로그 [모바일 | PC] 탭이 쓰는 분류. 규격 이름이 아니라 **출력 비율**로
// 정한다 — 세로면 폰, 가로면 PC, 정사각이면 null(양쪽 탭에 모두 보인다).
export const deviceOf = ({ width, height }) =>
  height > width ? "mobile" : width > height ? "desktop" : null;

// 프리셋 하나에 대한 출력 이미지. 확대는 하지 않으므로 실제 크기는
// 원본이 작을 때 프리셋보다 작아질 수 있다.
export function renderVariant(image, preset, focus = "center") {
  if (preset.width == null) {
    const max = preset.max ?? Math.max(image.width, image.height);
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    return resizeTo(image, Math.round(image.width * scale), Math.round(image.height * scale));
  }
  const box = coverCrop(image.width, image.height, preset.width, preset.height, focus);
  const cropped = crop(image, box);
  const scale = Math.min(1, preset.width / cropped.width, preset.height / cropped.height);
  if (scale >= 1) return cropped;
  return resizeTo(cropped, preset.width, preset.height);
}

async function encodeJpeg(image, quality) {
  let jpeg;
  try {
    ({ default: jpeg } = await import("jpeg-js"));
  } catch {
    throw new Error("JPEG 인코더(jpeg-js)가 없습니다 — 리포 루트에서 npm ci 후 다시 실행하세요");
  }
  const { data } = jpeg.encode(
    { width: image.width, height: image.height, data: Buffer.from(image.data) },
    quality,
  );
  return data;
}

const encodeVariant = (image, format, quality) =>
  format === "png" ? encodePng(image) : encodeJpeg(image, quality);

// _assets/wallpaper/README.md 표에 항목 행을 넣거나 갱신한 문서를 돌려준다.
// 같은 id 가 이미 있으면 그 행을 교체한다(--force 재실행이 표를 늘리지 않는다).
// 문서에 표가 여럿이라(항목 표 + 옵션 표) 기준은 **첫 번째 표**로 고정한다.
export function withReadmeRow(source, id, title, files) {
  const row = `| \`${id}\` | ${title} | ${files.map((file) => `\`${file}\``).join(", ")} |`;
  const lines = source.split("\n");
  const separator = lines.findIndex((line) => /^\| *-{3,} *\|/.test(line));
  if (separator < 0) throw new Error("_assets/wallpaper/README.md에서 항목 표를 찾지 못했습니다");
  let end = separator + 1;
  while (end < lines.length && lines[end].startsWith("|")) end++;
  const existing = lines.findIndex((line, i) => i > separator && i < end && line.startsWith(`| \`${id}\` |`));
  if (existing >= 0) lines[existing] = row;
  else lines.splice(end, 0, row);
  return lines.join("\n");
}

// 이미지 → 배경화면 항목 생성 + 등록. CLI와 테스트가 함께 쓴다.
export async function buildWallpaper({
  imagePath,
  id,
  title,
  sizes = DEFAULT_SIZES,
  focus = "center",
  format = "jpg",
  description = "",
  tags = [],
  quality = DEFAULT_QUALITY,
  createdAt,
  force = false,
  root = ROOT,
}) {
  if (!ID_RE.test(String(id))) {
    throw new Error(`배경화면 id는 영소문자·숫자·하이픈만 가능합니다: ${id}`);
  }
  if (!title?.trim()) throw new Error("--title 은 필수입니다");
  if (!FOCUS.has(focus)) {
    throw new Error(`--focus 는 ${[...FOCUS].join(", ")} 중 하나여야 합니다: ${focus}`);
  }
  if (!FORMATS.has(format)) {
    throw new Error(`--format 은 ${[...FORMATS].join(", ")} 중 하나여야 합니다: ${format}`);
  }
  const jpegQuality = Number(quality);
  if (!Number.isFinite(jpegQuality) || jpegQuality < 40 || jpegQuality > 100) {
    throw new Error(`--quality 는 40–100 사이여야 합니다: ${quality}`);
  }
  const names = parseSizes(sizes);

  const itemDir = join(root, "_assets", "wallpaper", id);
  if (existsSync(itemDir) && !force) {
    throw new Error(`이미 존재하는 항목입니다: ${itemDir} (덮어쓰려면 --force)`);
  }

  const decoded = await decodeImage(readFileSync(imagePath));
  const source = flatten(decoded);

  const variants = names.map((name) => {
    const preset = PRESETS[name];
    const image = renderVariant(source, preset, focus);
    const short = preset.width != null && (image.width < preset.width || image.height < preset.height);
    return {
      name,
      file: `${name}.${format}`,
      label: `${preset.label} ${image.width}×${image.height}`,
      device: deviceOf(image),
      image,
      short,
      target: preset.width == null ? null : `${preset.width}×${preset.height}`,
    };
  });

  mkdirSync(itemDir, { recursive: true });
  // --force 재실행에서 규격·형식이 바뀌면 이전 파일이 남는다. metadata 에는
  // 없지만 dist 에는 그대로 실려 나가므로 여기서 지운다.
  const keep = new Set([...variants.map((variant) => variant.file), "preview.jpg", "metadata.json"]);
  for (const stale of readdirSync(itemDir)) {
    if (!keep.has(stale)) rmSync(join(itemDir, stale), { recursive: true, force: true });
  }
  for (const variant of variants) {
    writeFileSync(join(itemDir, variant.file), await encodeVariant(variant.image, format, jpegQuality));
  }
  const previewScale = Math.min(1, PREVIEW_MAX / Math.max(source.width, source.height));
  const preview = resizeTo(
    source,
    Math.max(1, Math.round(source.width * previewScale)),
    Math.max(1, Math.round(source.height * previewScale)),
  );
  writeFileSync(join(itemDir, "preview.jpg"), await encodeJpeg(preview, PREVIEW_QUALITY));

  const metadata = {
    title: title.trim(),
    description: String(description || "").trim(),
    preview: "preview.jpg",
    // 카탈로그 카드가 미리보기 칸을 원본 비율로 잡는 데 쓴다 — 세로 배경화면은
    // 세로 칸, 가로는 가로 칸. 없으면 카테고리 기본 비율로 떨어진다.
    previewSize: { width: preview.width, height: preview.height },
    tags: tags.map((tag) => String(tag).trim()).filter(Boolean),
    createdAt: createdAt ?? new Date().toISOString().slice(0, 10),
    // width/height 는 상세페이지가 "내 기기에 맞게 저장"의 원본으로 가장 큰
    // 규격을 고르는 데 쓴다 (라벨 문자열을 파싱하지 않게).
    downloads: variants.map(({ label, file, device, image }) => ({
      label,
      file,
      ...(device ? { device } : {}),
      width: image.width,
      height: image.height,
    })),
  };
  writeFileSync(join(itemDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");

  // 빌드와 같은 검증을 즉시 돌려 커밋 전에 실패를 알린다
  readAssetMetadata(join(root, "_assets"), "wallpaper", itemDir);

  const touched = [`_assets/wallpaper/${id}/ (${variants.length}종 + preview.jpg + metadata.json)`];
  const readmePath = join(root, "_assets", "wallpaper", "README.md");
  if (existsSync(readmePath)) {
    const files = variants.map((variant) => variant.file);
    writeFileSync(readmePath, withReadmeRow(readFileSync(readmePath, "utf8"), id, title.trim(), files));
    touched.push("_assets/wallpaper/README.md");
  }

  return {
    id,
    itemDir,
    format,
    source: { width: source.width, height: source.height },
    variants: variants.map(({ name, file, label, device, short, target, image }) => ({
      name,
      file,
      label,
      device,
      short,
      target,
      width: image.width,
      height: image.height,
      bytes: statSync(join(itemDir, file)).size,
    })),
    touched,
  };
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  const flags = new Set(["force"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && flags.has(arg.slice(2))) options[arg.slice(2)] = true;
    else if (arg.startsWith("--")) options[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { positional, options };
}

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [imagePath, rawId] = positional;
  const id = rawId || slugify(imagePath || "");
  if (!imagePath || !id) {
    console.error(
      'usage: node _infra/wallpaper.mjs <이미지.png|.jpg> [id] --title "제목"\n' +
      "       [--sizes mobile,desktop] [--focus center|top|bottom|left|right]\n" +
      '       [--format jpg|png] [--desc "설명"] [--tags "태그,태그"]\n' +
      "       [--quality 90] [--force]\n" +
      `       규격: ${Object.keys(PRESETS).join(", ")}`,
    );
    process.exit(1);
  }
  try {
    const result = await buildWallpaper({
      imagePath,
      id,
      title: options.title,
      sizes: options.sizes ?? DEFAULT_SIZES,
      focus: options.focus ?? "center",
      format: options.format ?? "jpg",
      description: options.desc ?? "",
      tags: options.tags ? options.tags.split(",") : [],
      quality: options.quality ?? DEFAULT_QUALITY,
      force: options.force ?? false,
    });
    console.log(
      `✓ ${result.id} 배경화면 등록 (원본 ${result.source.width}×${result.source.height}, ${result.format})`,
    );
    for (const variant of result.variants) {
      const note = variant.short ? ` ⚠ 원본이 작아 ${variant.target} 규격보다 작습니다` : "";
      console.log(`  - ${variant.file}: ${variant.width}×${variant.height} ${formatSize(variant.bytes)}${note}`);
    }
    for (const line of result.touched) console.log(`  · ${line}`);
    console.log("다음 단계: node --test _infra/*.test.mjs && node _infra/build.mjs");
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
