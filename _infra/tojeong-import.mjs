#!/usr/bin/env node
// 토정비결 본문을 util/fortune/tojeong/<괘>.json 144개로 써 낸다.
//
//   node _infra/tojeong-import.mjs --raw 원문.json --ko 번역.json --titles 괘명.json \
//     [--fixes 교정.json] [--source 출처.json]
//
// 원문(raw)은 조사에서 모은 괘별 한문·독음, 번역(ko)은 한문 한 구 → 우리 번역의 표다.
// 번역을 구 단위 키로 두는 이유: 판본을 바꿔도 같은 구의 번역은 그대로 쓰고 달라진
// 구만 다시 옮기면 된다. 교정(fixes)은 {괘: {"summary.3" | "months.5.2": "한문"}} 으로
// 원문 오기를 바로잡는다 — 어느 줄을 왜 고쳤는지 파일에 그대로 남는다.
// 번역이 빠진 구가 하나라도 있으면 아무것도 쓰지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "util", "fortune", "tojeong");

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]]);
  return pairs;
}, []));
for (const need of ["raw", "ko", "titles"]) {
  if (!args[need]) {
    console.error(`--${need} 가 필요하다 (사용법은 파일 머리 주석)`);
    process.exit(1);
  }
}

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const raw = read(args.raw);
const koList = read(args.ko);
const titles = Object.fromEntries(read(args.titles).map((t) => [t.code, t]));
const fixes = args.fixes ? read(args.fixes) : {};
const ko = new Map(koList.map((item) => [item.hanja, item]));

const missing = [];
function line(code, where, source) {
  const fixed = fixes[code]?.[where];
  const hanja = fixed?.hanja ?? source.text;
  const reading = fixed?.reading ?? source.reading;
  const tr = ko.get(hanja);
  if (!tr?.ko) missing.push(`${code} ${where} ${hanja}`);
  const out = { hanja, reading, ko: tr?.ko ?? "" };
  if (fixed) out.fix = { from: source.text, why: fixed.why };
  if (tr?.note) out.note = tr.note;
  if (tr?.unsure) out.unsure = true;
  return out;
}

const codes = Object.keys(raw.hexagrams).sort();
if (codes.length !== 144) throw new Error(`괘가 ${codes.length}개다 — 144개여야 한다`);
const files = codes.map((code) => {
  const h = raw.hexagrams[code];
  const t = titles[code];
  if (!t?.ko) missing.push(`${code} 괘명`);
  return [code, {
    code,
    title: { hanja: h.title.text, reading: t?.reading ?? "", ko: t?.ko ?? "" },
    summary: h.summary.lines.map((l, i) => line(code, `summary.${i}`, l)),
    months: h.months.map((m) => m.lines.map((l, i) => line(code, `months.${m.month - 1}.${i}`, l))),
  }];
});

if (missing.length) {
  console.error(`번역이 빠진 구 ${missing.length}개 — 아무것도 쓰지 않았다`);
  for (const m of missing.slice(0, 20)) console.error("  " + m);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
for (const [code, data] of files) writeFileSync(join(OUT, `${code}.json`), JSON.stringify(data) + "\n");
const source = args.source ? read(args.source) : {};
writeFileSync(join(OUT, "sources.json"), JSON.stringify({
  ...source,
  lines: files.reduce((n, [, d]) => n + d.summary.length + d.months.flat().length, 0),
  fixes: Object.values(fixes).reduce((n, f) => n + Object.keys(f).length, 0),
}, null, 2) + "\n");
console.log(`${files.length}괘를 ${OUT} 에 썼다`);
