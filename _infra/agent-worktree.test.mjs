// 병렬 에이전트 워크플로의 두 가지 안전장치를 고정한다.
//   1) docs/ 는 서브도메인이 아니다 — 배포에 섞이면 안 된다
//   2) agent/<서브도메인>/… 브랜치는 남의 서브도메인 파일을 커밋할 수 없다
// (2)는 실제 임시 리포를 만들어 훅을 그대로 돌린다 — 훅은 셸이라 단위 테스트로
// 흉내 내면 정작 문법 오류를 못 잡는다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("docs/ 는 빌드 SKIP 목록에 있다 (서브도메인으로 배포되지 않는다)", () => {
  const build = readFileSync(join(ROOT, "_infra/build.mjs"), "utf8");
  const skip = build.match(/const SKIP = new Set\(\[([^\]]*)\]\)/);
  assert.ok(skip, "build.mjs의 SKIP 선언을 찾지 못했다");
  assert.match(skip[1], /"docs"/);
});

// --- 훅 실기동 -------------------------------------------------------------

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** 훅이 걸린 임시 리포를 만들고, 주어진 파일들을 스테이지한 뒤 커밋을 시도한다. */
const commitWith = (branch, paths) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-hook-"));
  try {
    git(dir, "init", "--quiet", "-b", "main");
    git(dir, "config", "user.email", "t@t");
    git(dir, "config", "user.name", "t");
    mkdirSync(join(dir, "_infra/agent-hooks"), { recursive: true });
    cpSync(join(ROOT, "_infra/agent-hooks/pre-commit"), join(dir, "_infra/agent-hooks/pre-commit"));
    cpSync(join(ROOT, "_infra/agent-scope.conf"), join(dir, "_infra/agent-scope.conf"));
    git(dir, "config", "core.hooksPath", "_infra/agent-hooks");
    writeFileSync(join(dir, "seed"), "x");
    git(dir, "add", "seed");
    git(dir, "-c", "core.hooksPath=", "commit", "--quiet", "-m", "seed");
    git(dir, "checkout", "--quiet", "-b", branch);
    for (const path of paths) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), "x");
    }
    git(dir, "add", ...paths);
    // 성공해도 훅의 경고(stderr)를 봐야 해서 spawnSync로 받는다
    const done = spawnSync("git", ["commit", "--quiet", "-m", "t"], { cwd: dir, encoding: "utf8" });
    return { ok: done.status === 0, stderr: done.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("자기 서브도메인과 딸린 파일은 통과한다", () => {
  const result = commitWith("agent/duri/calendar", [
    "duri/index.html",
    "_infra/duri.js",
    "_infra/duri.test.mjs",
    "_src/duri-sink/index.mjs",
  ]);
  assert.equal(result.ok, true, result.stderr);
});

test("남의 서브도메인 파일은 거부된다", () => {
  const result = commitWith("agent/duri/calendar", ["duri/index.html", "estate/index.html"]);
  assert.equal(result.ok, false, "estate/ 가 섞였는데 커밋이 통과했다");
  assert.match(result.stderr, /estate\/index\.html/);
});

test("이름이 겹쳐 보이는 남의 인프라 파일도 거부된다", () => {
  // _infra/duri.js 는 duri 것이지만 _infra/durian.js 는 아니다
  const result = commitWith("agent/duri/x", ["_infra/durian.js"]);
  assert.equal(result.ok, false);
});

test("공용 등록 파일은 허용하되 경고를 남긴다", () => {
  const result = commitWith("agent/slop/toy", ["slop/toy/index.html", "www/index.html"]);
  assert.equal(result.ok, true, result.stderr);
  assert.match(result.stderr, /공용 파일/);
});

test("main 브랜치에서는 훅이 아무것도 막지 않는다", () => {
  const result = commitWith("main-ish", ["estate/index.html", "duri/index.html"]);
  assert.equal(result.ok, true, result.stderr);
});

test("agent-scope.conf 에 적힌 소유 파일은 통과한다", () => {
  // 이름이 서브도메인과 다른 파일들 — conf가 없으면 전부 거부된다
  assert.equal(commitWith("agent/util/brief", ["_infra/brief.js"]).ok, true);
  assert.equal(commitWith("agent/work/emoticon", ["_infra/emoticon-gate.mjs"]).ok, true);
  assert.equal(commitWith("agent/assets/wall", ["_infra/wallpaper.mjs"]).ok, true);
});

test("남의 conf 소유 파일은 거부된다", () => {
  assert.equal(commitWith("agent/slop/x", ["_infra/brief.js"]).ok, false);
  assert.equal(commitWith("agent/util/x", ["_infra/wallpaper.mjs"]).ok, false);
});

test("아무에게도 속하지 않는 공용 인프라는 거부된다", () => {
  // security.js/webpush.js/realtime.js 는 오케스트레이터 몫이다
  assert.equal(commitWith("agent/duri/x", ["_infra/security.js"]).ok, false);
  assert.equal(commitWith("agent/games/x", ["_infra/realtime.js"]).ok, false);
});

// --- conf 자체가 썩지 않게 --------------------------------------------------

const parseConf = () => {
  const text = readFileSync(join(ROOT, "_infra/agent-scope.conf"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [key, rest] = line.split(/:\s*/);
      return [key, rest.trim().split(/\s+/)];
    });
};

test("agent-scope.conf 의 키는 실재하는 서브도메인이다", () => {
  for (const [key] of parseConf()) {
    if (key === "*shared*") continue;
    assert.ok(existsSync(join(ROOT, key)), `서브도메인 폴더가 없다: ${key}/`);
  }
});

test("agent-scope.conf 의 경로는 실재한다 (파일이 사라지면 알려준다)", () => {
  for (const [key, patterns] of parseConf()) {
    for (const pattern of patterns) {
      // 글롭은 하나라도 맞는 게 있으면 된다
      const [dir, base] = [dirname(pattern), pattern.slice(dirname(pattern).length + 1)];
      const found = pattern.includes("*")
        ? readdirSync(join(ROOT, dir)).some((name) =>
            new RegExp(`^${base.replace(/[.]/g, "\\.").replace(/\*/g, ".*")}$`).test(name))
        : existsSync(join(ROOT, pattern));
      assert.ok(found, `${key}: 없는 경로 — ${pattern}`);
    }
  }
});
