#!/usr/bin/env node
// life/kcal 음식표에 한 줄 더한다. 손으로 foods.js 를 고치지 않는 이유는 형식이
// 어긋나면 화면이 아니라 테스트에서야 드러나기 때문이다 — 여기서 막는다.
//
//   node _infra/kcal-food.mjs --name "김치찌개" --unit "1인분" \
//     --kcal 240 --carb 12 --protein 18 --fat 13 [--brand "웰스토리"] [--force]
//
// --kcal 을 빼면 탄단지에서 4·4·9 로 되짚어 채운다. --brand 는 같은 이름의 제품이
// 회사마다 값이 달라서 둔다(검색에도 걸린다).
import { readFileSync, writeFileSync } from "node:fs";
import { GRAM_MAX, KCAL_MAX, NAME_MAX, kcalFromMacros } from "../life/kcal/store.js";

const FILE = new URL("../life/kcal/foods.js", import.meta.url);
const HEADER = readFileSync(FILE, "utf8").split("export const FOODS = [")[0];

// 값을 받지 않는 것들. 목록에서 빠지면 뒤 인자를 값으로 먹어 버린다.
const FLAGS = new Set(["--force", "--remove"]);

function parseArgs(argv) {
  const args = { force: false, remove: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    if (FLAGS.has(token)) { args[token.slice(2)] = true; continue; }
    args[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

const number = (value, max) => {
  const parsed = Math.round((Number(value) || 0) * 10) / 10;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`값이 범위를 벗어납니다: ${value}`);
  return parsed;
};

export function makeFood(args) {
  const name = String(args.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("--name 이 필요합니다");
  if (name.length > NAME_MAX) throw new Error(`이름은 ${NAME_MAX}자까지입니다`);
  const macros = {
    carb: number(args.carb, GRAM_MAX),
    protein: number(args.protein, GRAM_MAX),
    fat: number(args.fat, GRAM_MAX),
  };
  const kcal = args.kcal == null ? kcalFromMacros(macros) : Math.round(number(args.kcal, KCAL_MAX));
  if (!kcal) throw new Error("칼로리나 탄단지 중 하나는 있어야 합니다");
  const brand = String(args.brand ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return { name, ...(brand ? { brand } : {}), unit: String(args.unit ?? "1인분").trim() || "1인분", kcal, ...macros };
}

/** 이름순으로 다시 적는다 — 사람이 읽을 파일이라 순서가 흔들리면 diff 가 지저분해진다. */
export function render(foods) {
  const line = (food) => `  { name: ${JSON.stringify(food.name)}, `
    + (food.brand ? `brand: ${JSON.stringify(food.brand)}, ` : "")
    + `unit: ${JSON.stringify(food.unit)}, `
    + `kcal: ${food.kcal}, carb: ${food.carb}, protein: ${food.protein}, fat: ${food.fat} },`;
  const sorted = [...foods].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return `${HEADER}export const FOODS = [\n${sorted.map(line).join("\n")}\n];\n`;
}

const load = () => import(`${FILE.href}?t=${process.hrtime.bigint()}`).then((module) => module.FOODS);

/** 오타를 남기지 않으려면 지우는 길도 있어야 한다: --remove --name "..." [--brand "..."] */
export async function removeFood(argv) {
  const args = parseArgs(argv);
  const name = String(args.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("--name 이 필요합니다");
  const brand = String(args.brand ?? "").trim();
  const foods = await load();
  const next = foods.filter((one) => !(one.name === name && (one.brand ?? "") === brand));
  if (next.length === foods.length) throw new Error(`표에 없습니다: ${name}${brand ? ` (${brand})` : ""}`);
  writeFileSync(FILE, render(next));
  return { name, brand, total: next.length };
}

export async function addFood(argv) {
  const args = parseArgs(argv);
  const food = makeFood(args);
  const foods = await load();
  // 같은 이름이라도 회사가 다르면 다른 제품이다.
  const existing = foods.findIndex((one) => one.name === food.name && (one.brand ?? "") === (food.brand ?? ""));
  if (existing >= 0 && !args.force) throw new Error(`이미 있습니다: ${food.name} (--force 로 덮어씀)`);
  const next = existing >= 0 ? foods.map((one, index) => (index === existing ? food : one)) : [...foods, food];
  writeFileSync(FILE, render(next));
  return { food, total: next.length, replaced: existing >= 0 };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--remove")) {
      const { name, brand, total } = await removeFood(argv);
      console.log(`지움: ${name}${brand ? ` (${brand})` : ""} — 표에 ${total}개`);
      process.exit(0);
    }
    const { food, total, replaced } = await addFood(argv);
    console.log(`${replaced ? "고침" : "더함"}: ${food.name} (${food.unit}) `
      + `${food.kcal}kcal · 탄 ${food.carb} · 단 ${food.protein} · 지 ${food.fat} — 표에 ${total}개`);
  } catch (error) {
    console.error(`실패: ${error.message}`);
    process.exit(1);
  }
}
