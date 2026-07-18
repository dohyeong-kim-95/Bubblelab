import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import {
  buildLabels,
  buildStickerPack,
  contentBounds,
  downscale,
  parseGrid,
  sliceGrid,
  trimCell,
  withChatPack,
  withReadmeRow,
} from "./sticker-pack.mjs";
import { CHAT_STICKER_PACKS } from "./chat.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 단색 캔버스에 사각형 몇 개를 찍는 테스트용 이미지 헬퍼
function makeImage(width, height, fill = [255, 255, 255, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

function paintRect(image, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      image.data.set(color, ((y + dy) * image.width + (x + dx)) * 4);
    }
  }
}

test("png codec: RGBA roundtrip preserves every pixel", () => {
  const image = makeImage(13, 7, [0, 0, 0, 0]);
  // 결정적 패턴 (테스트마다 같은 결과)
  for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 37 + 11) % 256;
  const decoded = decodePng(encodePng(image));
  assert.equal(decoded.width, 13);
  assert.equal(decoded.height, 7);
  assert.deepEqual([...decoded.data], [...image.data]);
});

test("png codec: opaque images are stored as RGB and decoded back", () => {
  const image = makeImage(5, 4, [10, 200, 30, 255]);
  paintRect(image, 1, 1, 2, 2, [250, 5, 120, 255]);
  const bytes = encodePng(image);
  assert.equal(bytes[8 + 8 + 9], 2); // IHDR color type = RGB
  assert.deepEqual([...decodePng(bytes).data], [...image.data]);
});

test("png codec: decoder handles all scanline filters", () => {
  const image = makeImage(9, 9, [0, 0, 0, 0]);
  for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 61 + 5) % 256;
  for (const filterType of [0, 1, 2, 3, 4]) {
    const decoded = decodePng(encodePng(image, { filterType }));
    assert.deepEqual([...decoded.data], [...image.data], `filter ${filterType}`);
  }
});

test("png codec: rejects non-png input with a clear message", () => {
  assert.throws(() => decodePng(Buffer.from("JFIF definitely not a png, padded...")), /PNG 파일이/);
});

test("parseGrid accepts CxR and rejects nonsense", () => {
  assert.deepEqual(parseGrid("4x4"), { cols: 4, rows: 4 });
  assert.deepEqual(parseGrid("2x3"), { cols: 2, rows: 3 });
  assert.throws(() => parseGrid("4×4"), /--grid/);
  assert.throws(() => parseGrid("0x4"), /--grid/);
  assert.throws(() => parseGrid("10x10"), /--grid/);
});

test("sliceGrid cuts row-major cells that cover the sheet exactly", () => {
  const sheet = makeImage(10, 6);
  paintRect(sheet, 0, 0, 5, 3, [255, 0, 0, 255]);   // 좌상
  paintRect(sheet, 5, 3, 5, 3, [0, 0, 255, 255]);   // 우하
  const cells = sliceGrid(sheet, 2, 2);
  assert.equal(cells.length, 4);
  assert.deepEqual(cells.map((c) => [c.width, c.height]), [[5, 3], [5, 3], [5, 3], [5, 3]]);
  assert.deepEqual([...cells[0].data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...cells[3].data.slice(-4)], [0, 0, 255, 255]);
});

test("trimCell drops white/transparent margins but keeps padding", () => {
  const cell = makeImage(60, 40); // 흰 배경
  paintRect(cell, 20, 10, 12, 8, [40, 40, 40, 255]);
  assert.deepEqual(contentBounds(cell), { left: 20, top: 10, right: 31, bottom: 17 });
  const trimmed = trimCell(cell);
  assert.equal(trimmed.width, 12 + 8);  // 내용 12 + 좌우 패딩 4씩
  assert.equal(trimmed.height, 8 + 8);
  assert.equal(trimCell(makeImage(8, 8)), null); // 전부 배경이면 빈 셀
});

test("downscale box-averages and caps the width", () => {
  const image = makeImage(100, 50, [100, 150, 200, 255]);
  const small = downscale(image, 25);
  assert.equal(small.width, 25);
  assert.equal(small.height, 13);
  assert.deepEqual([...small.data.slice(0, 4)], [100, 150, 200, 255]);
  assert.equal(downscale(image, 200), image); // 이미 작으면 그대로
});

test("buildLabels formats NN. prefixes and validates the line count", () => {
  assert.deepEqual(buildLabels(null, 2), ["01", "02"]);
  assert.deepEqual(buildLabels("안녕\n02. 잘가\n", 2), ["01. 안녕", "02. 잘가"]);
  assert.throws(() => buildLabels("한 줄", 16), /16줄/);
});

test("withChatPack inserts sorted, updates in place, and is idempotent", () => {
  const source = 'x\nexport const CHAT_STICKER_PACKS = new Map([\n  ["b-pack", 16],\n]);\ny';
  const added = withChatPack(source, "a-pack", 9);
  assert.match(added, /\[\n  \["a-pack", 9\],\n  \["b-pack", 16\],\n\]\);/);
  assert.equal(withChatPack(added, "a-pack", 9), added);
  assert.match(withChatPack(added, "b-pack", 4), /\["b-pack", 4\]/);
  assert.throws(() => withChatPack("no map here", "a", 1), /CHAT_STICKER_PACKS/);
});

test("withReadmeRow appends to the pack table once", () => {
  const source = "# t\n\n| ID | 제목 | 파일 |\n| --- | --- | --- |\n| `old` | 옛날 팩 | `01.png`–`16.png` |\n\n뒷문단";
  const added = withReadmeRow(source, "new-pack", "새 팩", 9);
  assert.match(added, /\| `old` \|.*\n\| `new-pack` \| 새 팩 \| `01\.png`–`09\.png` \|/);
  assert.equal(withReadmeRow(added, "new-pack", "새 팩", 9), added);
});

test("buildStickerPack: sheet → sliced pack + metadata + chat registration", () => {
  const root = mkdtempSync(join(tmpdir(), "bl-sticker-"));
  try {
    // 가짜 리포 뼈대
    mkdirSync(join(root, "_assets", "sticker"), { recursive: true });
    mkdirSync(join(root, "_infra"), { recursive: true });
    writeFileSync(
      join(root, "_infra", "chat.js"),
      'export const CHAT_STICKER_PACKS = new Map([\n  ["zebra", 16],\n]);\n',
    );
    writeFileSync(
      join(root, "_assets", "sticker", "README.md"),
      "| ID | 제목 | 파일 |\n| --- | --- | --- |\n| `zebra` | 얼룩말 | `01.png`–`16.png` |\n",
    );
    // 2x2 시트: 각 셀 중앙에 색 블롭
    const sheet = makeImage(80, 80);
    const colors = [[200, 30, 30, 255], [30, 200, 30, 255], [30, 30, 200, 255], [90, 60, 30, 255]];
    colors.forEach((color, i) => {
      paintRect(sheet, (i % 2) * 40 + 12, Math.floor(i / 2) * 40 + 12, 16, 16, color);
    });
    const sheetPath = join(root, "sheet.png");
    writeFileSync(sheetPath, encodePng(sheet));

    const result = buildStickerPack({
      imagePath: sheetPath,
      id: "test-pack",
      title: "테스트 팩 4종",
      grid: "2x2",
      labelsText: "하나\n둘\n셋\n넷",
      chatTitle: "테스트",
      tags: ["테스트"],
      createdAt: "2026-07-18",
      root,
    });

    assert.equal(result.count, 4);
    const packDir = join(root, "_assets", "sticker", "test-pack");
    const files = readdirSync(packDir).sort();
    assert.deepEqual(files, ["01.png", "02.png", "03.png", "04.png", "metadata.json", "preview.png"]);
    const first = decodePng(readFileSync(join(packDir, "01.png")));
    assert.equal(first.width, 16 + 8); // 블롭 16px + 패딩 4px 양쪽
    assert.deepEqual([...first.data.slice((4 * first.width + 4) * 4, (4 * first.width + 4) * 4 + 4)], colors[0]);

    const metadata = JSON.parse(readFileSync(join(packDir, "metadata.json"), "utf8"));
    assert.equal(metadata.title, "테스트 팩 4종");
    assert.deepEqual(metadata.chat, { title: "테스트" });
    assert.equal(metadata.createdAt, "2026-07-18");
    assert.deepEqual(metadata.downloads.map((d) => d.label), ["01. 하나", "02. 둘", "03. 셋", "04. 넷"]);

    const chatSource = readFileSync(join(root, "_infra", "chat.js"), "utf8");
    assert.match(chatSource, /\["test-pack", 4\],\n  \["zebra", 16\]/);
    assert.match(readFileSync(join(root, "_assets", "sticker", "README.md"), "utf8"), /`test-pack`/);

    // 같은 id 재실행은 --force 없이는 거부
    assert.throws(() => buildStickerPack({
      imagePath: sheetPath, id: "test-pack", title: "x", grid: "2x2", root,
    }), /--force/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 리포 동기화 검사: 서버 등록 ↔ 에셋 폴더 ↔ metadata.chat ──────────────
// 팩을 손으로 추가하다 한 곳을 빠뜨리면 여기서 잡힌다.

test("every CHAT_STICKER_PACKS entry has matching asset files and chat metadata", () => {
  for (const [pack, count] of CHAT_STICKER_PACKS) {
    const dir = join(ROOT, "_assets", "sticker", pack);
    assert.ok(existsSync(dir), `${pack}: _assets/sticker/${pack}/ 폴더가 없습니다`);
    for (let n = 1; n <= count; n++) {
      const file = `${String(n).padStart(2, "0")}.png`;
      assert.ok(existsSync(join(dir, file)), `${pack}: ${file}이 없습니다`);
    }
    const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
    assert.equal(metadata.downloads?.length, count,
      `${pack}: metadata downloads 수(${metadata.downloads?.length})와 등록 장수(${count})가 다릅니다`);
    assert.ok(metadata.chat?.title?.trim(),
      `${pack}: metadata.json에 chat.title이 없습니다 — util/chat 서랍 제목으로 필요합니다`);
  }
});

test("every sticker metadata with a chat field is registered in CHAT_STICKER_PACKS", () => {
  const stickerRoot = join(ROOT, "_assets", "sticker");
  for (const entry of readdirSync(stickerRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metadataPath = join(stickerRoot, entry.name, "metadata.json");
    if (!existsSync(metadataPath)) continue;
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (!metadata.chat) continue;
    assert.equal(CHAT_STICKER_PACKS.get(entry.name), metadata.downloads?.length,
      `${entry.name}: chat 팩인데 _infra/chat.js CHAT_STICKER_PACKS 등록이 없거나 장수가 다릅니다 ` +
      "(node _infra/sticker-pack.mjs가 자동 등록합니다)");
  }
});
