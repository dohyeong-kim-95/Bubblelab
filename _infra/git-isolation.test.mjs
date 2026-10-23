// 훅 안에서 npm test 가 돌 때 물려받는 GIT_DIR 이 진짜 리포를 망가뜨리지 않는지 본다.
// 실제 사고: worktree 에서 커밋하자 테스트가 띄운 git 이 진짜 리포에 core.bare=true,
// user.name=t, "seed"/"base"/"head" 커밋, agent/duri/calendar 브랜치를 남겼다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedGitEnv } from "./git-isolation.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("isolatedGitEnv 는 GIT_* 를 전부 지우고 신원은 환경으로 준다", () => {
  const saved = { ...process.env };
  process.env.GIT_DIR = "/somewhere/.git";
  process.env.GIT_INDEX_FILE = "/somewhere/.git/index";
  process.env.GIT_WORK_TREE = "/somewhere";
  process.env.GIT_PREFIX = "sub/";
  try {
    const env = isolatedGitEnv({ EXTRA: "1" });
    for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX"]) {
      assert.equal(name in env, false, name);
    }
    assert.equal(env.GIT_AUTHOR_NAME, "Test");
    assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.equal(env.EXTRA, "1");
    assert.equal(env.PATH, process.env.PATH);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  }
});

// 임시 리포를 만드는 테스트 파일들을 GIT_DIR 이 센티널 리포를 가리키는 채로 돌린다.
const GIT_SPAWNING_TESTS = ["_infra/agent-worktree.test.mjs", "_infra/deploy-scope.test.mjs"];

function sentinelState(sentinel) {
  const git = (...args) => execFileSync("git", ["-C", sentinel, ...args], {
    encoding: "utf8", env: isolatedGitEnv(),
  });
  return {
    refs: git("for-each-ref", "--format=%(refname) %(objectname)"),
    config: git("config", "--local", "--list"),
    head: git("rev-parse", "HEAD"),
    status: git("status", "--porcelain"),
  };
}

test("GIT_DIR 을 물려받아도 git 을 띄우는 테스트가 바깥 리포를 건드리지 않는다", () => {
  const sentinel = mkdtempSync(join(tmpdir(), "git-sentinel-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", sentinel, ...args], {
      encoding: "utf8", env: isolatedGitEnv(),
    });
    git("init", "--quiet", "-b", "main");
    writeFileSync(join(sentinel, "keep"), "x");
    git("add", "keep");
    git("commit", "--quiet", "-m", "sentinel");
    const before = sentinelState(sentinel);

    // NODE_TEST_CONTEXT 가 남아 있으면 안쪽 node --test 가 부모 러너에 붙어 버려
    // 파일을 제대로 돌리지 않는다 — 지워야 실제로 실행된다.
    const env = {
      ...process.env,
      GIT_DIR: join(sentinel, ".git"),
      GIT_WORK_TREE: sentinel,
      GIT_INDEX_FILE: join(sentinel, ".git", "index"),
    };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", ...GIT_SPAWNING_TESTS], {
      cwd: ROOT, encoding: "utf8", env,
    });
    assert.equal(result.status, 0, result.stdout.slice(-3000) + result.stderr.slice(-2000));
    assert.match(result.stdout, /^# pass [1-9]/m, "안쪽 테스트가 실제로 돌지 않았다");

    const after = sentinelState(sentinel);
    assert.deepEqual(after, before, "센티널 리포의 브랜치·설정·HEAD·작업 트리가 바뀌었다");
    assert.doesNotMatch(after.config, /core\.bare=true/);
  } finally {
    rmSync(sentinel, { recursive: true, force: true });
  }
});
