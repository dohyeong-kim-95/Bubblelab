import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import jpeg from "jpeg-js";
import {
  buildLabels,
  buildStickerPack,
  contentBounds,
  cutoutBackground,
  decodeSheet,
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

function countColor(image, color) {
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (color.every((v, k) => image.data[i + k] === v)) n++;
  }
  return n;
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
  const sheet = makeImage(40, 24);
  paintRect(sheet, 2, 2, 16, 8, [255, 0, 0, 255]);    // 좌상 셀 내용
  paintRect(sheet, 24, 14, 14, 8, [0, 0, 255, 255]);  // 우하 셀 내용
  const cells = sliceGrid(sheet, 2, 2);
  assert.equal(cells.length, 4);
  // 행 높이는 행 전체가 공유하고, 각 행의 열 폭 합 = 시트 폭 (겹침·누락 없음)
  assert.equal(cells[0].height, cells[1].height);
  assert.equal(cells[0].width + cells[1].width, 40);
  assert.equal(cells[2].width + cells[3].width, 40);
  assert.equal(cells[0].height + cells[2].height, 24);
  // 내용은 통째로 자기 셀 안에 들어간다
  assert.equal(countColor(cells[0], [255, 0, 0, 255]), 16 * 8);
  assert.equal(countColor(cells[3], [0, 0, 255, 255]), 14 * 8);
});

test("sliceGrid shifts cuts per row so art crossing the uniform gridline stays whole", () => {
  const sheet = makeImage(60, 60);
  // 1행: 정상적으로 셀 안에 든 두 블롭
  paintRect(sheet, 8, 8, 14, 14, [200, 0, 0, 255]);
  paintRect(sheet, 38, 8, 14, 14, [0, 200, 0, 255]);
  // 2행: 왼쪽 셀 그림(공)이 균등 격자선(x=30)을 넘어 오른쪽으로 튀어나온 상황
  paintRect(sheet, 20, 40, 16, 12, [0, 0, 200, 255]); // x 20–35, 격자선 침범
  paintRect(sheet, 46, 40, 10, 12, [90, 60, 0, 255]);
  const cells = sliceGrid(sheet, 2, 2);
  // 침범한 공은 쪼개지지 않고 통째로 3번 셀(2행 1열)에 들어간다
  assert.equal(countColor(cells[2], [0, 0, 200, 255]), 16 * 12);
  assert.equal(countColor(cells[3], [0, 0, 200, 255]), 0);
  // 그러기 위해 2행의 열 절단 위치는 1행과 다르다
  assert.notEqual(cells[0].width, cells[2].width);
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

test("cutoutBackground clears white bg but keeps outline-protected interior white", () => {
  const cell = makeImage(20, 20); // 전부 흰색
  // 진한 외곽선 사각 링 (5..14), 내부는 흰색 유지
  for (let i = 5; i <= 14; i++) {
    for (const [x, y] of [[i, 5], [i, 14], [5, i], [14, i]]) {
      cell.data.set([80, 80, 80, 255], (y * 20 + x) * 4);
    }
  }
  const cut = cutoutBackground(cell);
  assert.equal(cut.data[3], 0, "테두리 흰 배경은 투명");
  assert.equal(cut.data[(10 * 20 + 10) * 4 + 3], 255, "외곽선 안쪽 흰색은 보존");
  assert.equal(cut.data[(5 * 20 + 5) * 4 + 3], 255, "외곽선 자체는 불투명");
  // soft(235)–full(248) 사이 밝기의 배경 연결 픽셀은 반투명 (안티앨리어싱)
  const soft = makeImage(4, 1);
  soft.data.set([240, 240, 240, 255], 4);
  const softCut = cutoutBackground(soft);
  assert.ok(softCut.data[7] > 0 && softCut.data[7] < 255, `alpha=${softCut.data[7]}`);
  // 클라이언트 사고 재현 방지: 밝은 회색(220) 외곽선은 soft보다 어두워 뚫리지 않는다
  assert.equal(cutoutBackground((() => {
    const c = makeImage(3, 1);
    c.data.set([220, 220, 220, 255], 4);
    return c;
  })()).data[7], 255);
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

test("decodeSheet detects JPEG by magic bytes and decodes to RGBA", async () => {
  const image = makeImage(32, 16, [200, 60, 30, 255]);
  const encoded = jpeg.encode({ width: 32, height: 16, data: Buffer.from(image.data) }, 95);
  const decoded = await decodeSheet(new Uint8Array(encoded.data));
  assert.equal(decoded.width, 32);
  assert.equal(decoded.height, 16);
  // JPEG는 손실 압축 — 색이 근사치로 돌아오는지만 확인
  assert.ok(Math.abs(decoded.data[0] - 200) < 12, `r=${decoded.data[0]}`);
  assert.equal(decoded.data[3], 255);
  const png = await decodeSheet(encodePng(image));
  assert.deepEqual([...png.data], [...image.data]);
  await assert.rejects(() => decodeSheet(Buffer.from("GIF89a...")), /지원하지 않는 이미지/);
});

test("buildStickerPack: sheet → sliced pack + metadata + chat registration", async () => {
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

    const result = await buildStickerPack({
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
    assert.equal(first.data[3], 0, "생성 시점 누끼 — 흰 배경 모서리가 투명");

    const metadata = JSON.parse(readFileSync(join(packDir, "metadata.json"), "utf8"));
    assert.equal(metadata.title, "테스트 팩 4종");
    assert.deepEqual(metadata.chat, { title: "테스트" });
    assert.equal(metadata.createdAt, "2026-07-18");
    assert.deepEqual(metadata.downloads.map((d) => d.label), ["01. 하나", "02. 둘", "03. 셋", "04. 넷"]);

    const chatSource = readFileSync(join(root, "_infra", "chat.js"), "utf8");
    assert.match(chatSource, /\["test-pack", 4\],\n  \["zebra", 16\]/);
    assert.match(readFileSync(join(root, "_assets", "sticker", "README.md"), "utf8"), /`test-pack`/);

    // 같은 id 재실행은 --force 없이는 거부
    await assert.rejects(() => buildStickerPack({
      imagePath: sheetPath, id: "test-pack", title: "x", grid: "2x2", root,
    }), /--force/);

    // JPEG 시트도 같은 파이프라인으로 통과한다
    const jpegPath = join(root, "sheet.jpg");
    writeFileSync(jpegPath, jpeg.encode({ width: sheet.width, height: sheet.height, data: Buffer.from(sheet.data) }, 95).data);
    const fromJpeg = await buildStickerPack({
      imagePath: jpegPath, id: "test-jpeg", title: "JPEG 팩 4종", grid: "2x2",
      chatTitle: "제이펙", chatCutout: false, createdAt: "2026-07-18", root,
    });
    assert.equal(fromJpeg.count, 4);
    // --chat-no-cutout → 클라이언트 누끼 생략 플래그가 metadata에 남는다
    const jpegMeta = JSON.parse(readFileSync(join(root, "_assets", "sticker", "test-jpeg", "metadata.json"), "utf8"));
    assert.deepEqual(jpegMeta.chat, { title: "제이펙", cutout: false });
    const jpegCell = decodePng(readFileSync(join(root, "_assets", "sticker", "test-jpeg", "01.png")));
    // 손실 압축 노이즈가 있어도 트리밍이 블롭 근처(16px + 패딩 ±여유)로 잘라야 한다
    assert.ok(jpegCell.width >= 16 && jpegCell.width <= 40, `width=${jpegCell.width}`);
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
