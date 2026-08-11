import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATA_DIR,
  ROOT,
  SECTIONS,
  buildManifest,
  publish,
  validatePayload,
} from "./insights-publish.mjs";

// 최소 형태의 payload. 섹션 내용은 검사 대상이 아니라 "구조가 짝이 맞는가"만 본다.
const sample = () => ({
  date: "2026-01-02",
  generated_at: "2026-01-02T03:04:05+09:00",
  range: { from: "2025-12-01", to: "2026-01-01" },
  stats: { sessions_total: 3, sessions_analyzed: 2, messages: 40, hours: 5, commits: 7 },
  ko: {
    at_a_glance: { whats_working: "이번 기간에는 배포까지 한 번에 끝낸 세션이 많았습니다." },
    project_areas: { areas: [{ name: "가", description: "설명이 여기에 들어갑니다." }] },
    interaction_style: { key_pattern: "목표만 주고 끝까지 맡깁니다." },
    what_works: { intro: "잘 된 것" },
    suggestions: { features_to_try: [{ feature: "Hooks", example_code: "npm test" }] },
    on_the_horizon: { intro: "앞으로" },
    fun_ending: { headline: "재미있는 마무리" },
  },
  en: {
    at_a_glance: { whats_working: "Many sessions this period went all the way to deploy." },
    project_areas: { areas: [{ name: "A", description: "Description goes here." }] },
    interaction_style: { key_pattern: "You hand over a goal and let it run." },
    what_works: { intro: "What works" },
    suggestions: { features_to_try: [{ feature: "Hooks", example_code: "npm test" }] },
    on_the_horizon: { intro: "Horizon" },
    fun_ending: { headline: "Fun ending" },
  },
});

test("정상 payload는 통과한다", () => {
  assert.deepEqual(validatePayload(sample()), []);
});

test("섹션이 빠지면 잡는다", () => {
  const p = sample();
  delete p.ko.fun_ending;
  delete p.en.fun_ending;
  const errors = validatePayload(p);
  assert.ok(errors.some((e) => e.includes("ko에 없는 섹션")), errors.join("\n"));
});

test("번역에서 항목을 빠뜨리면 잡는다", () => {
  const p = sample();
  p.en.project_areas.areas.push({ name: "B", description: "Second area." });
  const errors = validatePayload(p);
  assert.ok(errors.some((e) => e.includes("항목 수가 다르다")), errors.join("\n"));
});

test("번역 안 된 긴 문장을 잡는다", () => {
  const p = sample();
  p.ko.what_works.intro = "This sentence was never translated into Korean at all.";
  const errors = validatePayload(p);
  assert.ok(errors.some((e) => e.includes("한국어가 없다")), errors.join("\n"));
});

test("붙여넣기용 코드(example_code)는 영어로 남아도 된다", () => {
  const p = sample();
  const code = "npx wrangler deploy && curl -s -o /dev/null -w '%{http_code}' https://bubblelab.dev";
  p.ko.suggestions.features_to_try[0].example_code = code;
  p.en.suggestions.features_to_try[0].example_code = code;
  assert.deepEqual(validatePayload(p), []);
});

test("날짜·통계 형식을 검사한다", () => {
  const p = sample();
  p.date = "2026/01/02";
  p.stats.commits = -1;
  const errors = validatePayload(p);
  assert.ok(errors.some((e) => e.includes("date")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("stats.commits")), errors.join("\n"));
});

test("publish는 파일을 쓰고 매니페스트를 최신순으로 다시 만든다", () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-publish-"));
  try {
    publish(sample(), { dir });
    const older = { ...sample(), date: "2025-12-31" };
    publish(older, { dir });

    const manifest = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    assert.deepEqual(manifest.reports.map((r) => r.date), ["2026-01-02", "2025-12-31"]);
    assert.equal(manifest.reports[0].summary, sample().ko.interaction_style.key_pattern);
    assert.ok(existsSync(join(dir, "2026-01-02.json")));

    assert.throws(() => publish(sample(), { dir }), /이미 있다/);
    publish({ ...sample(), stats: { ...sample().stats, commits: 9 } }, { dir, force: true });
    const again = JSON.parse(readFileSync(join(dir, "2026-01-02.json"), "utf8"));
    assert.equal(again.stats.commits, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("원문 HTML을 그대로 옆에 싣고 해시로 못 박는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-report-"));
  try {
    const src = join(dir, "report-original.html");
    const html = "<!doctype html><title>Insights</title><p>Top Tools Used Bash 986</p>";
    writeFileSync(src, html);
    const { report } = publish(sample(), { dir, reportHtml: src });

    assert.equal(report, "2026-01-02.report.html");
    assert.equal(readFileSync(join(dir, report), "utf8"), html, "원문이 바이트 그대로가 아니다");
    const saved = JSON.parse(readFileSync(join(dir, "2026-01-02.json"), "utf8"));
    assert.equal(saved.source.report_bytes, Buffer.byteLength(html));
    assert.match(saved.source.report_sha256, /^[0-9a-f]{64}$/);
    assert.equal(
      JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).reports[0].report,
      report,
      "매니페스트가 원문을 알리지 않는다",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("원문 파일이 없으면 매니페스트가 링크를 걸지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-report-"));
  try {
    const p = sample();
    p.source = { report_file: "2026-01-02.report.html" };
    publish(p, { dir }); // 파일은 붙이지 않았다
    assert.equal(JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).reports[0].report, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("검증에 걸린 payload는 파일을 남기지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-publish-"));
  try {
    const broken = sample();
    delete broken.ko.at_a_glance;
    assert.throws(() => publish(broken, { dir }), /검증 실패/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 커밋된 데이터가 스스로 성립하는지 — 손으로 파일만 넣고 매니페스트를 잊는 사고를 막는다.
test("커밋된 리포트는 모두 검증을 통과한다", () => {
  const files = readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.ok(files.length > 0, "리포트가 하나도 없다");
  for (const file of files) {
    const payload = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
    assert.equal(`${payload.date}.json`, file, `${file}: 파일명과 date가 다르다`);
    assert.deepEqual(validatePayload(payload), [], `${file} 검증 실패`);
    for (const section of SECTIONS) assert.ok(payload.ko[section], `${file}: ${section} 누락`);
  }
});

// 원문 HTML이 발행 이후에 바뀌지 않았는지 — 수치 패널은 여기에만 있다.
test("커밋된 원문 리포트가 해시와 일치한다", async () => {
  const { createHash } = await import("node:crypto");
  let checked = 0;
  for (const file of readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
    const p = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
    if (!p.source?.report_file) continue;
    const html = readFileSync(join(DATA_DIR, p.source.report_file));
    assert.equal(html.length, p.source.report_bytes, `${p.source.report_file}: 크기가 다르다`);
    assert.equal(
      createHash("sha256").update(html).digest("hex"),
      p.source.report_sha256,
      `${p.source.report_file}: 내용이 발행 시점과 다르다`,
    );
    checked++;
  }
  assert.ok(checked > 0, "원문이 붙은 리포트가 하나도 없다");
});

test("커밋된 매니페스트가 데이터 파일과 일치한다", () => {
  const onDisk = JSON.parse(readFileSync(join(DATA_DIR, "index.json"), "utf8"));
  assert.deepEqual(onDisk, buildManifest(), "index.json이 오래됐다 — insights-publish.mjs를 다시 돌려라");
});

// 화면이 읽는 필드 이름이 바뀌면 목록이 빈다. 렌더러와 매니페스트를 함께 묶어 둔다.
test("화면이 쓰는 필드가 매니페스트에 있다", () => {
  const page = readFileSync(join(DATA_DIR, "..", "index.html"), "utf8");
  assert.ok(page.includes("data/index.json"), "화면이 매니페스트를 읽지 않는다");
  const [first] = buildManifest().reports;
  for (const key of ["date", "range", "stats", "summary"]) {
    assert.ok(key in first, `매니페스트에 ${key}가 없다`);
  }
});

test("잘못된 payload를 CLI에 넘기면 0이 아닌 코드로 끝난다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-cli-"));
  try {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ date: "nope" }));
    const { execFileSync } = await import("node:child_process");
    assert.throws(() =>
      execFileSync("node", [join(ROOT, "_infra", "insights-publish.mjs"), file], {
        stdio: "pipe",
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
