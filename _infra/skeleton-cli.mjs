// 포즈 시퀀스 JSON → 스켈레톤 PNG (개별 프레임 + 그리드).
// 생성 없이 포즈만 눈으로 확인·저작할 때 쓴다.
//
//   node _infra/skeleton-cli.mjs <시퀀스.json> --out <폴더> [--grid] [--cell 512] [--cols 4]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.mjs";
import { expandSequence, renderGrid, renderPose } from "./skeleton.mjs";

export function loadSequence(path) {
  const spec = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(spec.keys) || spec.keys.length < 2) {
    throw new Error(`${path}: keys는 2개 이상이어야 합니다`);
  }
  const frames = expandSequence(spec.keys, {
    steps: Number(spec.steps ?? 2),
    loop: spec.loop ?? "pingpong",
    ease: spec.ease !== false,
  });
  return { spec, frames };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flags = new Set(["grid"]);
  const positional = [];
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && flags.has(args[i].slice(2))) options[args[i].slice(2)] = true;
    else if (args[i].startsWith("--")) options[args[i].slice(2)] = args[++i];
    else positional.push(args[i]);
  }
  const [specPath] = positional;
  if (!specPath) {
    console.error("usage: node _infra/skeleton-cli.mjs <시퀀스.json> --out <폴더> [--grid] [--cell 512] [--cols 4]");
    process.exit(1);
  }
  try {
    const cell = Number(options.cell ?? 512);
    const cols = Number(options.cols ?? 4);
    const outDir = options.out ?? "/tmp/skeleton";
    const { spec, frames } = loadSequence(specPath);
    mkdirSync(outDir, { recursive: true });
    if (options.grid) {
      writeFileSync(join(outDir, `${spec.name}-grid.png`), encodePng(renderGrid(frames, { cols, cell })));
      console.log(`✓ ${spec.name}-grid.png (${frames.length}포즈, ${cols}열)`);
    } else {
      frames.forEach((pose, i) => {
        writeFileSync(
          join(outDir, `${String(i + 1).padStart(2, "0")}.png`),
          encodePng(renderPose(pose, { width: cell, height: cell })),
        );
      });
      console.log(`✓ ${frames.length}개 스켈레톤 → ${outDir}`);
    }
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
