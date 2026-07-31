import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRIFT_LIMIT, MIN_MOTION, buildReport, judgeReport } from "./emoticon-gate.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "emoticon.mjs");

const baseReport = (overrides = {}) => buildReport({
  cutId: "x", mode: "keys", size: 360,
  uniqueFrames: 4, timelineFrames: 8, fps: 12, durationSec: 2.0,
  bytes: 100_000, loops: 0,
  loopDiff: 0.1, adjacentDiffs: [0.1, 0.1, 0.1], scaleDrift: 0.02,
  motion: { mean: 0.2, max: 0.3 }, transparency: [0.5, 0.5, 0.5, 0.5],
  ...overrides,
});

const info = (overrides = {}) => ({
  width: 360, height: 360, frames: 8, loops: 0, animated: true,
  delays: Array(8).fill(0.25), ...overrides,
});

test("buildReport: 인접 diff를 전부 보존하고 seamRatio를 계산한다", () => {
  // 최대값만 남기면 어느 구간이 튀었는지 되짚을 수 없다
  const report = baseReport({ adjacentDiffs: [0.1, 0.4, 0.2], loopDiff: 0.4 });
  assert.deepEqual(report.adjacentDiffs, [0.1, 0.4, 0.2]);
  assert.equal(report.adjacentMedian, 0.2);
  assert.equal(report.adjacentMax, 0.4);
  assert.equal(report.seamRatio, 2);   // 0.4 / 0.2
});

test("Hard: 크기 드리프트·빈 프레임은 자동 실패", () => {
  assert.equal(judgeReport(baseReport({ scaleDrift: DRIFT_LIMIT + 0.01 }), "draft").verdict, "fail");
  assert.equal(judgeReport(baseReport({ scaleDrift: DRIFT_LIMIT - 0.01 }), "draft").verdict, "pass");
  const empty = judgeReport(baseReport({ transparency: [0.5, 0.0, 0.5] }), "draft");
  assert.equal(empty.verdict, "fail");
  assert.match(empty.hard.join(), /누끼 실패 또는 빈 프레임/);
});

test("Hard: master-2s는 2초 규격을 강제한다", () => {
  const report = baseReport();
  assert.equal(judgeReport(report, "master-2s", info()).verdict, "pass");
  // 1초짜리는 실패
  const short = judgeReport(report, "master-2s", info({ delays: Array(8).fill(0.125) }));
  assert.equal(short.verdict, "fail");
  assert.match(short.hard.join(), /재생시간 1\.00초/);
  // 크기 위반
  assert.match(judgeReport(report, "master-2s", info({ width: 270 })).hard.join(), /크기 270px/);
  // 애니메이션 청크 없음
  assert.match(judgeReport(report, "master-2s", info({ animated: false })).hard.join(), /acTL/);
});

test("Hard: line 프로필은 프레임 수·루프·용량을 강제한다", () => {
  const report = baseReport({ lineBytes: 200_000 });
  const lineInfo = info({ width: 270, frames: 8, loops: 4, delays: Array(8).fill(0.125) });
  assert.equal(judgeReport(report, "line", lineInfo).verdict, "pass");
  assert.match(judgeReport(report, "line", info({ width: 270, frames: 24, loops: 4 })).hard.join(), /프레임 24장/);
  assert.match(judgeReport(report, "line", info({ width: 270, loops: 0 })).hard.join(), /루프/);
  const heavy = judgeReport(baseReport({ lineBytes: 400_000 }), "line", lineInfo);
  assert.match(heavy.hard.join(), /용량 391KB/);
  // --line 산출물이 아예 없으면 실패
  assert.match(judgeReport(baseReport(), "line", lineInfo).hard.join(), /산출물이 없습니다/);
});

test("Soft: 정지에 가까운 컷은 REVIEW (실패는 아님)", () => {
  const still = judgeReport(baseReport({ motion: { mean: MIN_MOTION - 0.01, max: 0.05 } }), "draft");
  assert.equal(still.verdict, "review");
  assert.match(still.soft.join(), /거의 정지/);
});

test("Soft: 큰 동작 자체는 실패시키지 않는다 (핑퐁 루프 오탐 방지)", () => {
  // nod 실측값: 인접 diff가 37%로 커도 그건 유니크 3장으로 끄덕임을 표현한
  // 결과일 뿐 결함이 아니다. 균일하게 크면 통과해야 한다.
  const bigButEven = judgeReport(
    baseReport({ loopDiff: 0.29, adjacentDiffs: [0.3, 0.37, 0.3], motion: { mean: 0.4, max: 0.5 } }),
    "draft",
  );
  assert.equal(bigButEven.verdict, "pass", `soft=${bigButEven.soft.join("|")}`);
});

test("Soft: 유독 튀는 구간만 골라 redo를 추천한다", () => {
  const spiky = judgeReport(baseReport({ adjacentDiffs: [0.1, 0.1, 0.5, 0.1] }), "draft");
  assert.equal(spiky.verdict, "review");
  assert.deepEqual(spiky.suggestions, [4]);   // 3→4 구간이 튄다 → 4번 프레임 재생성
  assert.match(spiky.soft.join(), /03→04 구간/);
});

test("CLI: check는 FAIL이면 exit 1, PASS면 exit 0", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-gate-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "t");
    run("cut", workdir, "b", "--motion", "m", "--frames", "8", "--fps", "8");
    run("build", workdir, "b");
    assert.ok(existsSync(join(workdir, "cuts", "b", "report.json")), "build가 report.json을 남긴다");
    const report = JSON.parse(readFileSync(join(workdir, "cuts", "b", "report.json"), "utf8"));
    assert.equal(report.timelineFrames, 8);
    assert.equal(report.adjacentDiffs.length, 7);

    run("check", workdir, "b");                                  // draft → exit 0
    // 1초짜리를 2초 프로필로 판정하면 exit 1
    assert.throws(() => run("check", workdir, "b", "--profile", "master-2s"), /Command failed/);
    // --json은 판정과 리포트를 함께 낸다
    const parsed = JSON.parse(run("check", workdir, "b", "--json").split("\n").slice(1).join("\n"));
    assert.equal(parsed.profile, "draft");
    assert.ok(Array.isArray(parsed.report.adjacentDiffs));
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("알 수 없는 프로필은 명확히 거부한다", () => {
  assert.throws(() => judgeReport(baseReport(), "nope"), /알 수 없는 프로필/);
});
