// work/emoticon 히스토리 내보내기 — 배포 제외 폴더(_src/emoticon)의 생성
// 산출물(시트·컷 APNG·메타)을 dist/work/emoticon/history/로 복사하고
// manifest.json을 만든다. 프레임들은 개별 복사 대신 리뷰용 그리드 한 장으로
// 합성해 용량을 잡는다. work 게이트 뒤(/emoticon/history)에서만 보인다.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodePng } from "./png.mjs";
import { resize } from "./emoticon.mjs";

const GRID_CELL = 192;
const GRID_COLS = 4;

// 투명 프레임들을 흰 배경 격자 한 장으로 합성 (리뷰용)
export function composeFrameGrid(frames, cell = GRID_CELL, cols = GRID_COLS) {
  const rows = Math.ceil(frames.length / cols) || 1;
  const width = cols * cell;
  const height = rows * cell;
  const data = new Uint8Array(width * height * 4).fill(255);
  frames.forEach((frame, index) => {
    const scale = Math.min(cell / frame.width, cell / frame.height);
    const w = Math.max(1, Math.round(frame.width * scale));
    const h = Math.max(1, Math.round(frame.height * scale));
    const small = resize(frame, w, h);
    const gx = (index % cols) * cell + ((cell - w) >> 1);
    const gy = ((index / cols) | 0) * cell + ((cell - h) >> 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const d = ((gy + y) * width + gx + x) * 4;
        const a = small.data[s + 3] / 255;
        for (let c = 0; c < 3; c++) {
          data[d + c] = Math.round(small.data[s + c] * a + data[d + c] * (1 - a));
        }
      }
    }
  });
  return { width, height, data };
}

export function emitEmoticonHistory(root, dist) {
  const src = join(root, "_src", "emoticon");
  if (!existsSync(src)) return null;
  const outRoot = join(dist, "work", "emoticon", "history");
  const characters = [];
  let cutCount = 0;

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const charDir = join(src, id);
    const dataDir = join(outRoot, "data", id);
    mkdirSync(dataDir, { recursive: true });
    const character = { id, cuts: [] };

    if (existsSync(join(charDir, "sheet.png"))) {
      copyFileSync(join(charDir, "sheet.png"), join(dataDir, "sheet.png"));
      character.sheet = `data/${id}/sheet.png`;
    }
    if (existsSync(join(charDir, "sheet-prompt.txt"))) {
      character.sheetPrompt = readFileSync(join(charDir, "sheet-prompt.txt"), "utf8").trim();
    }

    const cutsDir = join(charDir, "cuts");
    if (existsSync(cutsDir)) {
      for (const cut of readdirSync(cutsDir, { withFileTypes: true })) {
        if (!cut.isDirectory()) continue;
        const cutDir = join(cutsDir, cut.name);
        let meta = {};
        try { meta = JSON.parse(readFileSync(join(cutDir, "cut.json"), "utf8")); } catch { /* 메타 없이도 노출 */ }
        const item = { id: cut.name, ...meta };

        for (const [key, file] of [["apng", `${cut.name}.png`], ["line", `${cut.name}-line.png`]]) {
          const path = join(charDir, "out", file);
          if (existsSync(path)) {
            copyFileSync(path, join(dataDir, file));
            item[key] = `data/${id}/${file}`;
          }
        }

        const framesDir = join(cutDir, "frames");
        if (existsSync(framesDir)) {
          const files = readdirSync(framesDir).filter((f) => /^\d{2}\.png$/.test(f)).sort();
          if (files.length) {
            const grid = composeFrameGrid(files.map((f) => decodePng(readFileSync(join(framesDir, f)))));
            writeFileSync(join(dataDir, `${cut.name}-grid.png`), encodePng(grid));
            item.grid = `data/${id}/${cut.name}-grid.png`;
            item.frameCount = files.length;
          }
        }
        character.cuts.push(item);
        cutCount++;
      }
    }
    characters.push(character);
  }

  mkdirSync(outRoot, { recursive: true });
  writeFileSync(join(outRoot, "manifest.json"), JSON.stringify({ version: 1, characters }, null, 2));
  return { characters: characters.length, cuts: cutCount };
}
