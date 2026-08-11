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

test("레인을 만드는 서브도메인 목록이 빌드의 사이트 목록과 같다", () => {
  // 스크립트가 제외 목록을 따로 들고 있으면 언젠가 어긋나서 서브도메인이 아닌
  // 폴더(scripts/ 등)에 레인이 생기거나, 새 서브도메인이 레인을 못 받는다.
  const fromScript = execFileSync("bash", [join(ROOT, "_infra/agent-worktree.sh"), "subdomains"], {
    encoding: "utf8",
  }).trim().split("\n");

  const build = readFileSync(join(ROOT, "_infra/build.mjs"), "utf8");
  const skip = new Set(
    build.match(/const SKIP = new Set\(\[([^\]]*)\]\)/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1)),
  );
  const fromBuild = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith(".") && !skip.has(d.name))
    .map((d) => d.name)
    .sort();

  assert.deepEqual(fromScript, fromBuild);
});

// --- 훅 실기동 -------------------------------------------------------------

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * 훅이 걸린 임시 리포를 만들고, 주어진 파일들을 스테이지한 뒤 커밋을 시도한다.
 * files 를 객체로 주면 내용까지 지정한다(린트 검사를 태우려면 필요).
 * npmTest 를 주면 가짜 node_modules + package.json 을 깔아 테스트 단계를 켠다.
 */
const commitWith = (branch, files, { npmTest, skipHooks } = {}) => {
  const paths = Array.isArray(files) ? files : Object.keys(files);
  const bodyOf = (path) => (Array.isArray(files) ? "x" : files[path]);
  const dir = mkdtempSync(join(tmpdir(), "agent-hook-"));
  try {
    git(dir, "init", "--quiet", "-b", "main");
    git(dir, "config", "user.email", "t@t");
    git(dir, "config", "user.name", "t");
    mkdirSync(join(dir, "_infra/agent-hooks"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(join(ROOT, "_infra/agent-hooks/pre-commit"), join(dir, "_infra/agent-hooks/pre-commit"));
    cpSync(join(ROOT, "_infra/agent-scope.conf"), join(dir, "_infra/agent-scope.conf"));
    cpSync(join(ROOT, "scripts/lint.sh"), join(dir, "scripts/lint.sh"));
    if (npmTest) {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ private: true, scripts: { test: npmTest } }),
      );
    }
    git(dir, "config", "core.hooksPath", "_infra/agent-hooks");
    writeFileSync(join(dir, "seed"), "x");
    git(dir, "add", "seed");
    git(dir, "-c", "core.hooksPath=", "commit", "--quiet", "-m", "seed");
    git(dir, "checkout", "--quiet", "-b", branch);
    for (const path of paths) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), bodyOf(path));
    }
    git(dir, "add", ...paths);
    // 성공해도 훅의 경고(stderr)를 봐야 해서 spawnSync로 받는다
    const done = spawnSync("git", ["commit", "--quiet", "-m", "t"], {
      cwd: dir,
      encoding: "utf8",
      env: skipHooks ? { ...process.env, SKIP_HOOKS: "1" } : process.env,
    });
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

// 린트·테스트는 모든 브랜치에서 돈다. 소유 범위만 agent/… 브랜치 전용이다.
test("agent 브랜치가 아니면 소유 범위를 검사하지 않는다", () => {
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

// --- 린트·테스트 게이트 ----------------------------------------------------

test("문법이 깨진 파일은 커밋되지 않는다", () => {
  const result = commitWith("agent/slop/toy", { "slop/toy/game.js": "const x = ;\n" });
  assert.equal(result.ok, false, "문법 오류가 커밋을 통과했다");
  assert.match(result.stderr, /문법 오류/);
});

test("코드가 스테이지되면 테스트가 돌고, 실패하면 커밋이 거부된다", () => {
  const result = commitWith("main-ish", { "slop/toy/game.js": "export const x = 1;\n" }, {
    npmTest: "exit 1",
  });
  assert.equal(result.ok, false, "테스트가 실패했는데 커밋이 통과했다");
  assert.match(result.stderr, /테스트가 실패한다/);
});

test("테스트가 통과하면 커밋된다", () => {
  const result = commitWith("main-ish", { "slop/toy/game.js": "export const x = 1;\n" }, {
    npmTest: "echo '# pass 1'",
  });
  assert.equal(result.ok, true, result.stderr);
});

test("문서만 바뀐 커밋에는 테스트를 돌리지 않는다", () => {
  // 11초가 매번 붙으면 사람들이 훅을 꺼 버린다 — .md 만이면 건너뛴다
  const result = commitWith("main-ish", { "docs/decisions.md": "# 기록\n" }, { npmTest: "exit 1" });
  assert.equal(result.ok, true, result.stderr);
});

test("SKIP_HOOKS=1 이면 전부 우회한다", () => {
  const result = commitWith("agent/slop/x", { "estate/index.html": "<p>남의 것" }, {
    npmTest: "exit 1",
    skipHooks: true,
  });
  assert.equal(result.ok, true, result.stderr);
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
