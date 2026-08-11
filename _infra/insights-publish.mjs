#!/usr/bin/env node
// `/insights`(Claude Code 사용 리포트) 결과를 lab/claude-insights 에 일자별로 싣는다.
//
//   node _infra/insights-publish.mjs <payload.json> [--force]
//
// payload.json 은 에이전트가 만든다(.claude/commands/insights-publish.md 참고):
//   { date, generated_at, range, stats, source, ko: {...}, en: {...} }
// en 은 /insights 가 준 원문 그대로, ko 는 같은 구조를 유지한 한국어 번역이다.
// 구조가 어긋나면(항목 누락·번역 빠짐) 여기서 걸러 낸다 — 화면은 두 벌을 같은
// 렌더러로 그리기 때문에 모양이 다르면 원문 토글에서 티가 난다.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = join(ROOT, "lab", "claude-insights", "data");

// /insights 리포트의 최상위 섹션. 화면(index.html)이 이 순서로 그린다.
export const SECTIONS = [
  "at_a_glance",
  "project_areas",
  "interaction_style",
  "what_works",
  "suggestions",
  "on_the_horizon",
  "fun_ending",
];

// 붙여넣어 쓰는 코드는 번역하지 않는다 — 한글 포함 검사에서 뺀다.
const RAW_KEYS = new Set(["example_code"]);

const STAT_KEYS = [
  "sessions_total",
  "sessions_analyzed",
  "messages",
  "hours",
  "commits",
];

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasHangul = (s) => /[가-힣]/.test(s);

// ko/en 두 트리의 "모양"이 같은지 본다. 배열 길이·객체 키·잎의 타입까지 —
// 번역하다 항목 하나를 통째로 빠뜨리는 게 가장 흔한 사고다.
function diffShape(ko, en, path, out) {
  if (Array.isArray(en)) {
    if (!Array.isArray(ko)) return out.push(`${path}: 원문은 배열인데 번역은 아니다`);
    if (ko.length !== en.length) {
      return out.push(`${path}: 항목 수가 다르다 (번역 ${ko.length} · 원문 ${en.length})`);
    }
    en.forEach((v, i) => diffShape(ko[i], v, `${path}[${i}]`, out));
    return;
  }
  if (isPlain(en)) {
    if (!isPlain(ko)) return out.push(`${path}: 원문은 객체인데 번역은 아니다`);
    const missing = Object.keys(en).filter((k) => !(k in ko));
    const extra = Object.keys(ko).filter((k) => !(k in en));
    if (missing.length) out.push(`${path}: 번역에 없는 키 ${missing.join(", ")}`);
    if (extra.length) out.push(`${path}: 원문에 없는 키 ${extra.join(", ")}`);
    for (const k of Object.keys(en)) {
      if (k in ko) diffShape(ko[k], en[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  if (typeof ko !== typeof en) {
    out.push(`${path}: 타입이 다르다 (번역 ${typeof ko} · 원문 ${typeof en})`);
  }
}

// 긴 문장이 영어 그대로 남아 있으면 번역을 빼먹은 것이다. 짧은 라벨·고유명사
// (Hooks, CLAUDE.md 같은)는 그대로 두는 게 맞으니 길이로 거른다.
function findUntranslated(ko, path, out, key = "") {
  if (typeof ko === "string") {
    if (!RAW_KEYS.has(key) && ko.length > 40 && !hasHangul(ko)) {
      out.push(`${path}: 한국어가 없다 — 번역을 빠뜨린 것 같다 ("${ko.slice(0, 40)}…")`);
    }
    return;
  }
  if (Array.isArray(ko)) return ko.forEach((v, i) => findUntranslated(v, `${path}[${i}]`, out, key));
  if (isPlain(ko)) {
    for (const [k, v] of Object.entries(ko)) {
      findUntranslated(v, path ? `${path}.${k}` : k, out, k);
    }
  }
}

export function validatePayload(payload) {
  const errors = [];
  if (!isPlain(payload)) return ["payload가 객체가 아니다"];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date ?? "")) {
    errors.push("date가 YYYY-MM-DD 형식이 아니다");
  }
  if (payload.generated_at && Number.isNaN(Date.parse(payload.generated_at))) {
    errors.push("generated_at을 날짜로 읽을 수 없다");
  }
  for (const end of ["from", "to"]) {
    const v = payload.range?.[end];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? "")) errors.push(`range.${end}가 YYYY-MM-DD가 아니다`);
  }
  for (const k of STAT_KEYS) {
    const v = payload.stats?.[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      errors.push(`stats.${k}가 0 이상의 숫자가 아니다`);
    }
  }
  for (const lang of ["ko", "en"]) {
    if (!isPlain(payload[lang])) {
      errors.push(`${lang} 섹션이 없다`);
      continue;
    }
    const missing = SECTIONS.filter((s) => !(s in payload[lang]));
    if (missing.length) errors.push(`${lang}에 없는 섹션: ${missing.join(", ")}`);
  }
  if (isPlain(payload.ko) && isPlain(payload.en)) {
    diffShape(payload.ko, payload.en, "", errors);
    findUntranslated(payload.ko, "ko", errors);
  }
  // 원문 리포트를 함께 실었다면 파일 이름이 날짜와 묶여 있어야 한다.
  const file = payload.source?.report_file;
  if (file != null && file !== `${payload.date}.report.html`) {
    errors.push(`source.report_file은 "${payload.date}.report.html" 이어야 한다`);
  }
  return errors;
}

export const reportName = (date) => `${date}.report.html`;

// 목록 화면이 읽는 매니페스트. 데이터 파일이 진실이고 이건 항상 재생성한다.
export function buildManifest(dir = DATA_DIR) {
  const reports = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      const p = JSON.parse(readFileSync(join(dir, name), "utf8"));
      // 원문 HTML은 파일이 실제로 옆에 있을 때만 알린다 — 화면이 없는 링크를
      // 그리면 404를 누르게 된다.
      const report = p.source?.report_file;
      reports.push({
        date: p.date,
        generated_at: p.generated_at ?? null,
        range: p.range,
        stats: p.stats,
        summary: p.ko?.interaction_style?.key_pattern ?? "",
        report: report && existsSync(join(dir, report)) ? report : null,
      });
    }
  }
  reports.reverse(); // 최신이 위
  return { reports };
}

export function writeManifest(dir = DATA_DIR) {
  const manifest = buildManifest(dir);
  writeFileSync(join(dir, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

// 번역본은 /insights 가 준 JSON만 담는다 — 리포트 HTML에 있는 수치 패널(도구
// 사용량·응답시간 분포·마찰 유형…)은 그 JSON에 없고, 나중에 세션 기록에서
// 다시 계산하면 그 뒤에 쌓인 세션이 섞여 리포트와 다른 숫자가 나온다.
// 그래서 원문 HTML을 그대로 옆에 둔다 — 화면의 "원문 리포트" 버튼이 이걸 연다.
function attachReport(payload, reportHtml, dir) {
  const html = readFileSync(reportHtml);
  const name = reportName(payload.date);
  writeFileSync(join(dir, name), html);
  const sha = createHash("sha256").update(html).digest("hex");
  payload.source = { ...payload.source, report_file: name, report_bytes: html.length, report_sha256: sha };
  return name;
}

export function publish(payload, { force = false, dir = DATA_DIR, reportHtml = null } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${payload.date ?? "invalid"}.json`);
  if (existsSync(file) && !force) {
    throw new Error(`${payload.date} 리포트가 이미 있다 — 덮어쓰려면 --force`);
  }
  // 원문 첨부는 payload를 건드리므로 검증 전에 한다(파일명 규칙까지 같이 검사된다).
  if (reportHtml) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date ?? "")) throw new Error("date가 없어 원문을 붙일 수 없다");
    attachReport(payload, reportHtml, dir);
  }
  const errors = validatePayload(payload);
  if (errors.length) {
    if (reportHtml) rmSync(join(dir, reportName(payload.date)), { force: true });
    const err = new Error(`payload 검증 실패:\n  - ${errors.join("\n  - ")}`);
    err.errors = errors;
    throw err;
  }
  writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
  const manifest = writeManifest(dir);
  return { file, count: manifest.reports.length, report: payload.source?.report_file ?? null };
}

const invokedDirectly = process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const reportAt = args.indexOf("--report");
  const reportHtml = reportAt === -1 ? null : args[reportAt + 1];
  const input = args.filter((a, i) => !a.startsWith("--") && i !== reportAt + 1)[0];
  if (!input) {
    console.error("사용법: node _infra/insights-publish.mjs <payload.json> [--report <원문.html>] [--force]");
    process.exit(1);
  }
  try {
    const payload = JSON.parse(readFileSync(input, "utf8"));
    const { file, count, report } = publish(payload, { force, reportHtml });
    console.log(`published ${payload.date} → ${file.replace(ROOT + "/", "")} (총 ${count}개)`);
    if (report) console.log(`  원문 리포트 첨부: ${report}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
