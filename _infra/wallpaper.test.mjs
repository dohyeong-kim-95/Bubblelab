import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.mjs";
import {
  PRESETS,
  buildWallpaper,
  coverCrop,
  flatten,
  parseSizes,
  renderVariant,
  resizeTo,
  slugify,
  withReadmeRow,
} from "./wallpaper.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 좌우가 다른 색으로 나뉜 그라데이션 이미지 (잘라내기 위치 검증용)
function makeImage(width, height, alpha = 255) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / Math.max(1, width - 1);
      data[i + 1] = (y * 255) / Math.max(1, height - 1);
      data[i + 2] = 40;
      data[i + 3] = alpha;
    }
  }
  return { width, height, data };
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "wallpaper-"));
  mkdirSync(join(root, "_assets", "wallpaper"), { recursive: true });
  writeFileSync(
    join(root, "_assets", "wallpaper", "README.md"),
    "# wallpaper\n\n현재 항목:\n\n| ID | 제목 | 파일 |\n| --- | --- | --- |\n\n## 항목 추가\n",
  );
  return root;
}

test("parseSizes accepts preset names and rejects unknown ones", () => {
  assert.deepEqual(parseSizes("mobile, desktop"), ["mobile", "desktop"]);
  assert.deepEqual(parseSizes("mobile,mobile"), ["mobile"], "중복은 한 번만");
  assert.throws(() => parseSizes("phone"), /알 수 없는 규격/);
  assert.throws(() => parseSizes(" , "), /하나 이상/);
});

test("slugify turns a file name into a safe id", () => {
  assert.equal(slugify("/tmp/Sunset Beach (2).PNG"), "sunset-beach-2");
  assert.equal(slugify("바다.jpg"), "");
});

test("coverCrop keeps the target aspect inside the source", () => {
  // 가로 원본을 세로 규격(9:19.5)으로 → 세로가 꽉 차고 가로가 잘린다
  const box = coverCrop(4000, 2000, 1290, 2796);
  assert.equal(box.height, 2000);
  assert.equal(box.width, Math.round((2000 * 1290) / 2796));
  assert.ok(box.width <= 4000 && box.height <= 2000);
  assert.equal(box.y, 0);
  assert.equal(box.x, Math.round((4000 - box.width) / 2), "기본은 가운데");
});

test("coverCrop honours the focus anchor on the cropped axis", () => {
  assert.equal(coverCrop(1000, 3000, 2560, 1440, "top").y, 0);
  assert.equal(coverCrop(1000, 3000, 2560, 1440, "bottom").y, 3000 - coverCrop(1000, 3000, 2560, 1440).height);
  assert.equal(coverCrop(4000, 1000, 1290, 2796, "left").x, 0);
  // 세로로 잘리는 상황에서 left/right 는 남는 축이 없으므로 0
  assert.equal(coverCrop(1000, 3000, 2560, 1440, "left").y, Math.round((3000 - coverCrop(1000, 3000, 2560, 1440).height) / 2));
});

test("resizeTo shrinks to the exact size and never upscales", () => {
  const image = makeImage(100, 50);
  const small = resizeTo(image, 20, 10);
  assert.equal(small.width, 20);
  assert.equal(small.height, 10);
  const same = resizeTo(image, 400, 200);
  assert.equal(same.width, 100, "확대 요청은 원본 그대로");
});

test("flatten composites transparency onto white", () => {
  const image = makeImage(4, 4, 0);
  const flat = flatten(image);
  for (let i = 0; i < flat.data.length; i += 4) {
    assert.equal(flat.data[i + 3], 255);
    assert.equal(flat.data[i], 255, "완전 투명 → 배경색(흰색)");
  }
});

test("renderVariant hits the preset size when the source is large enough", () => {
  const image = renderVariant(makeImage(4000, 4000), PRESETS.desktop);
  assert.equal(image.width, 2560);
  assert.equal(image.height, 1440);
});

test("renderVariant keeps the aspect but not the size for small sources", () => {
  const image = renderVariant(makeImage(1024, 1536), PRESETS.mobile);
  assert.ok(image.width < 1290 && image.height <= 1536, `${image.width}x${image.height}`);
  const ratio = image.width / image.height;
  assert.ok(Math.abs(ratio - 1290 / 2796) < 0.01, `비율 ${ratio}`);
});

test("renderVariant original preset only caps the long edge", () => {
  const image = renderVariant(makeImage(6000, 3000), PRESETS.original);
  assert.equal(image.width, 4096);
  assert.equal(image.height, 2048);
});

test("withReadmeRow inserts once and replaces on repeat", () => {
  const source = "| ID | 제목 | 파일 |\n| --- | --- | --- |\n";
  const once = withReadmeRow(source, "sunset", "노을", ["mobile.jpg"]);
  assert.match(once, /\| `sunset` \| 노을 \| `mobile\.jpg` \|/);
  const twice = withReadmeRow(once, "sunset", "새 제목", ["mobile.jpg", "desktop.jpg"]);
  assert.equal(twice.match(/\| `sunset` \|/g).length, 1, "행이 늘어나면 안 된다");
  assert.match(twice, /새 제목/);
  assert.throws(() => withReadmeRow("표 없음", "sunset", "노을", ["mobile.jpg"]), /표를 찾지 못했습니다/);
});

// README에는 항목 표 말고 옵션 표도 있다 — 행이 엉뚱한 표로 들어가면 안 된다.
test("withReadmeRow targets the item table in the real README", () => {
  const readmePath = join(ROOT, "_assets", "wallpaper", "README.md");
  const patched = withReadmeRow(readFileSync(readmePath, "utf8"), "sunset", "노을", ["mobile.jpg"]);
  const lines = patched.split("\n");
  const row = lines.findIndex((line) => line.startsWith("| `sunset` |"));
  const optionHeader = lines.findIndex((line) => line.startsWith("| 옵션 |"));
  assert.ok(row > 0, "행이 들어가야 한다");
  assert.ok(optionHeader > 0 && row < optionHeader, "옵션 표보다 위(항목 표 안)여야 한다");
  assert.match(lines[row - 1], /^\| *-{3,} *\|/, "항목 표 구분선 바로 아래");
});

test("buildWallpaper writes variants, preview, metadata and the readme row", async () => {
  const root = makeRoot();
  try {
    writeFileSync(join(root, "source.png"), encodePng(makeImage(3000, 3000)));
    const result = await buildWallpaper({
      imagePath: join(root, "source.png"),
      id: "sunset-hill",
      title: "노을 언덕",
      description: "테스트 배경화면",
      tags: ["노을", "테스트"],
      createdAt: "2026-08-06",
      root,
    });
    assert.deepEqual(result.variants.map((v) => v.file), ["mobile.jpg", "desktop.jpg"]);
    assert.equal(result.variants[0].width, 1290);
    assert.equal(result.variants[1].height, 1440);
    assert.ok(result.variants.every((v) => !v.short), "3000px 원본은 두 규격을 채운다");

    const metadata = JSON.parse(readFileSync(join(result.itemDir, "metadata.json"), "utf8"));
    assert.equal(metadata.title, "노을 언덕");
    assert.equal(metadata.preview, "preview.jpg");
    assert.deepEqual(metadata.downloads.map((d) => d.file), ["mobile.jpg", "desktop.jpg"]);
    assert.match(metadata.downloads[0].label, /모바일 1290×2796/);

    const jpegs = ["mobile.jpg", "desktop.jpg", "preview.jpg"];
    for (const file of jpegs) {
      const bytes = readFileSync(join(result.itemDir, file));
      assert.equal(bytes[0], 0xff, `${file}: JPEG 매직 바이트`);
      assert.equal(bytes[1], 0xd8, `${file}: JPEG 매직 바이트`);
    }
    assert.match(readFileSync(join(root, "_assets", "wallpaper", "README.md"), "utf8"), /\| `sunset-hill` \|/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildWallpaper flags a source smaller than the preset", async () => {
  const root = makeRoot();
  try {
    writeFileSync(join(root, "small.png"), encodePng(makeImage(800, 1200)));
    const result = await buildWallpaper({
      imagePath: join(root, "small.png"),
      id: "small-one",
      title: "작은 원본",
      sizes: "mobile",
      root,
    });
    assert.equal(result.variants[0].short, true);
    assert.equal(result.variants[0].target, "1290×2796");
    assert.match(result.variants[0].label, /모바일 \d+×\d+/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildWallpaper validates inputs before touching the disk", async () => {
  const root = makeRoot();
  try {
    writeFileSync(join(root, "source.png"), encodePng(makeImage(400, 400)));
    const base = { imagePath: join(root, "source.png"), id: "ok-id", title: "제목", root };
    await assert.rejects(() => buildWallpaper({ ...base, id: "Bad_Id" }), /영소문자·숫자·하이픈/);
    await assert.rejects(() => buildWallpaper({ ...base, title: " " }), /--title/);
    await assert.rejects(() => buildWallpaper({ ...base, focus: "middle" }), /--focus/);
    await assert.rejects(() => buildWallpaper({ ...base, quality: 10 }), /--quality/);
    await assert.rejects(() => buildWallpaper({ ...base, sizes: "phone" }), /알 수 없는 규격/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildWallpaper refuses to overwrite without --force", async () => {
  const root = makeRoot();
  try {
    writeFileSync(join(root, "source.png"), encodePng(makeImage(1000, 1000)));
    const args = { imagePath: join(root, "source.png"), id: "dup", title: "중복", sizes: "square", root };
    await buildWallpaper(args);
    await assert.rejects(() => buildWallpaper(args), /이미 존재하는 항목/);
    const again = await buildWallpaper({ ...args, title: "덮어쓴 제목", force: true });
    assert.equal(again.id, "dup");
    const readme = readFileSync(join(root, "_assets", "wallpaper", "README.md"), "utf8");
    assert.equal(readme.match(/\| `dup` \|/g).length, 1);
    assert.match(readme, /덮어쓴 제목/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
