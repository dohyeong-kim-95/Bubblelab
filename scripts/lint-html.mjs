// HTML 안의 인라인 <script> 문법 검사 — scripts/lint.sh 가 부른다.
//
// 토이 대부분은 로직이 index.html 의 <script> 안에 있어서, .js 만 보는 검사로는
// 오타 하나가 그대로 빈 화면으로 배포됐다. 실행하지 않고 파싱만 한다.
//   · 보통 스크립트  → vm.Script 로 컴파일만
//   · type="module" → 임시 .mjs 로 써서 node --check
//   · JSON(application/json·ld+json·importmap) → JSON.parse
//   · src 가 있는 것과 그 밖의 type(템플릿 등)은 건너뛴다(.js 파일은 lint.sh 가 따로 본다)
// 에러 줄 번호가 HTML 의 줄과 맞도록 스크립트 앞을 빈 줄로 채워서 검사한다.
//
//   node scripts/lint-html.mjs a.html b.html
// 마지막 줄에 "checked <N>" (인라인 스크립트가 있던 파일 수)을 찍는다. 실패하면 exit 1.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Script } from "node:vm";

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const JSON_TYPES = new Set(["application/json", "application/ld+json", "importmap"]);
const CLASSIC_TYPES = new Set(["", "text/javascript", "application/javascript"]);

function attribute(attributes, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attributes);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3];
}

function hasAttribute(attributes, name) {
  return new RegExp(`(^|\\s)${name}(\\s|=|$)`, "i").test(attributes);
}

function lineOf(text, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (text.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

/**
 * HTML 한 파일의 인라인 스크립트를 뽑는다.
 *
 * Args:
 *   html: 파일 내용
 * Returns:
 *   [{ kind: "classic"|"module"|"json", code, line }] — line 은 스크립트 본문이 시작하는 HTML 줄
 */
export function inlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attributes = match[1];
    const code = match[2];
    if (hasAttribute(attributes, "src")) continue;
    if (code.trim() === "") continue;
    const type = (attribute(attributes, "type") ?? "").trim().toLowerCase();
    let kind = null;
    if (CLASSIC_TYPES.has(type)) kind = "classic";
    if (type === "module") kind = "module";
    if (JSON_TYPES.has(type)) kind = "json";
    if (kind === null) continue;
    const bodyStart = match.index + match[0].indexOf(">") + 1;
    scripts.push({ kind, code, line: lineOf(html, bodyStart) });
  }
  return scripts;
}

/**
 * 스크립트 하나를 파싱해 본다.
 *
 * Returns:
 *   문법이 맞으면 null, 틀리면 사람이 읽을 메시지
 */
export function checkScript(script, scratchDir) {
  // 앞을 빈 줄로 채워 에러의 줄 번호가 HTML 줄 번호가 되게 한다.
  const padded = "\n".repeat(script.line - 1) + script.code;
  if (script.kind === "json") {
    try {
      JSON.parse(script.code);
      return null;
    } catch (error) {
      return `JSON 파싱 실패 (${script.line}행부터): ${error.message}`;
    }
  }
  if (script.kind === "classic") {
    try {
      new Script(padded, { filename: "inline" });
      return null;
    } catch (error) {
      const where = /inline:(\d+)/.exec(error.stack ?? "");
      return `${where ? `${where[1]}행: ` : ""}${error.message}`;
    }
  }
  const file = join(scratchDir, "inline.mjs");
  writeFileSync(file, padded);
  const run = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (run.status === 0) return null;
  const where = /inline\.mjs:(\d+)/.exec(run.stderr);
  const message = run.stderr.split("\n").find((line) => /Error/.test(line)) ?? run.stderr.trim();
  return `${where ? `${where[1]}행: ` : ""}${message}`;
}

function main(files) {
  const scratchDir = mkdtempSync(join(tmpdir(), "bl-lint-html-"));
  let checked = 0;
  let failed = 0;
  try {
    for (const file of files) {
      const scripts = inlineScripts(readFileSync(file, "utf8"));
      if (scripts.length === 0) continue;
      checked += 1;
      for (const script of scripts) {
        const problem = checkScript(script, scratchDir);
        if (problem === null) continue;
        failed += 1;
        process.stderr.write(`\x1b[31m✗ ${file} — 인라인 스크립트 문법 오류\x1b[0m\n  ${problem}\n`);
      }
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
  console.log(`checked ${checked}`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
