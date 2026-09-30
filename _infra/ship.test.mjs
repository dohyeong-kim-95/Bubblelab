import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIP = join(ROOT, "scripts/ship.sh");
const SHA = "a".repeat(40);
const REMOTE = "b".repeat(40);
const LIVE = "c".repeat(40);

function executable(path, source) {
  writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${source}\n`);
  chmodSync(path, 0o755);
}

function fixture(scenario) {
  const root = mkdtempSync(join(tmpdir(), "bubblelab-ship-"));
  const bin = join(root, "bin");
  const scripts = join(root, "scripts");
  mkdirSync(bin);
  mkdirSync(scripts);
  copyFileSync(SHIP, join(scripts, "ship.sh"));
  const log = join(root, "calls.log");

  executable(join(bin, "git"), String.raw`
printf 'git %s\n' "$*" >> "$SHIP_TEST_LOG"
if [[ "$*" == "rev-parse --abbrev-ref HEAD" ]]; then printf 'main\n'; exit 0; fi
if [[ "$*" == "rev-parse HEAD" ]]; then printf '%s\n' "$SHIP_TEST_SHA"; exit 0; fi
if [[ "$*" == "rev-parse origin/main" ]]; then
  if [[ "$SHIP_TEST_SCENARIO" == remote-* ]]; then printf '%s\n' "$SHIP_TEST_SHA"; else printf '%s\n' "$SHIP_TEST_REMOTE"; fi
  exit 0
fi
if [[ "$*" == "log --oneline origin/main..HEAD" ]]; then printf 'abc feature\n'; exit 0; fi
if [[ "$*" == "diff --name-status origin/main..HEAD" ]]; then printf 'M\tlife/index.html\n'; exit 0; fi
exit 0`);

  executable(join(bin, "gh"), String.raw`
printf 'gh %s\n' "$*" >> "$SHIP_TEST_LOG"
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "workflow run" ]]; then exit 0; fi
if [[ "$1 $2" == "run list" ]]; then
  case "$SHIP_TEST_SCENARIO" in
    push-success|push-failed) printf '101\tin_progress\t\n' ;;
    remote-live) printf '201\tin_progress\t\n' ;;
    remote-mismatch) printf '205\tcompleted\tsuccess\n' ;;
    remote-failed)
      if grep -q '^gh workflow run' "$SHIP_TEST_LOG"; then printf '203\tin_progress\t\n'; else printf '202\tcompleted\tfailure\n'; fi ;;
    remote-docs) printf '204\tcompleted\tsuccess\n' ;;
    remote-missing)
      if grep -q '^gh workflow run' "$SHIP_TEST_LOG"; then printf '206\tin_progress\t\n'; fi ;;
  esac
  exit 0
fi
if [[ "$1 $2" == "run watch" ]]; then
  [[ "$SHIP_TEST_SCENARIO" == push-failed ]] && exit 1
  exit 0
fi
if [[ "$1 $2" == "run view" ]]; then
  if [[ "$*" == *"--log-failed"* ]]; then printf 'remote failure\n'; exit 0; fi
  if [[ "$*" == *"--json status,conclusion"* ]]; then
    if [[ "$SHIP_TEST_SCENARIO" == push-failed ]]; then
      printf 'completed\tfailure\n'
    else
      printf 'completed\tsuccess\n'
    fi
    exit 0
  fi
  if [[ "$SHIP_TEST_SCENARIO" == remote-docs ]]; then
    [[ "$*" == *'.jobs[].steps[]'* ]] || exit 3
    printf 'Plan changes since the live deployment\tsuccess\nPublish, verify live commit, restore previous version on failure\tskipped\n'
  fi
  exit 0
fi
exit 2`);

executable(join(bin, "curl"), String.raw`
printf 'curl %s\n' "$*" >> "$SHIP_TEST_LOG"
if [[ "$SHIP_TEST_SCENARIO" == remote-live ]]; then
  printf '{"commit":"%s"}\n' "$SHIP_TEST_SHA"
else
  printf '{"commit":"%s"}\n' "$SHIP_TEST_LIVE"
fi`);
  for (const forbidden of ["node", "npm", "npx"]) {
    executable(join(bin, forbidden), String.raw`
printf '%s invoked\n' "$0" >> "$SHIP_TEST_LOG"
exit 97`);
  }

  const result = spawnSync("bash", [join(scripts, "ship.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      SHIP_TEST_LOG: log,
      SHIP_TEST_SCENARIO: scenario,
      SHIP_TEST_SHA: SHA,
      SHIP_TEST_REMOTE: REMOTE,
      SHIP_TEST_LIVE: LIVE,
      SHIP_DEPLOY_TIMEOUT: "5",
      SHIP_RUN_DISCOVERY_TIMEOUT: "2",
      SHIP_POLL_INTERVAL: "0",
    },
  });
  const calls = readFileSync(log, "utf8");
  return { root, result, calls };
}

function run(scenario, check) {
  const value = fixture(scenario);
  try {
    check(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}

test("push 뒤 정확한 SHA의 Deploy run을 찾아 기다리며 로컬 Node 도구를 실행하지 않는다", () => {
  run("push-success", ({ result, calls }) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(calls, /git push origin main/);
    assert.match(calls, /gh run list .*deploy\.yml/);
    assert.match(calls, /gh run view 101 --json status,conclusion/);
    assert.doesNotMatch(calls, /(?:node|npm|npx) invoked/);
  });
});

test("새 push의 Actions 실패는 로컬 revert 없이 실패로 끝난다", () => {
  run("push-failed", ({ result, calls }) => {
    assert.notEqual(result.status, 0);
    assert.match(calls, /gh run view 101 --log-failed/);
    assert.doesNotMatch(calls, /git revert|git commit/);
    assert.doesNotMatch(calls, /gh workflow run/);
  });
});

test("이미 원격에 있는 SHA의 최근 run이 실패했으면 저장소 workflow를 다시 실행한다", () => {
  run("remote-failed", ({ result, calls }) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(calls, /gh workflow run deploy\.yml --ref main/);
    assert.match(calls, /gh run view 203 --json status,conclusion/);
    assert.doesNotMatch(calls, /git push|git revert/);
  });
});

test("이미 원격에 있는 SHA의 run이 없으면 저장소 workflow를 실행하고 새 run을 기다린다", () => {
  run("remote-missing", ({ result, calls }) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(calls, /gh workflow run deploy\.yml --ref main/);
    assert.match(calls, /gh run view 206 --json status,conclusion/);
    assert.doesNotMatch(calls, /git push|git revert/);
  });
});

test("성공한 문서 전용 run은 plan 성공과 publish skip을 확인해 이전 live SHA를 허용한다", () => {
  run("remote-docs", ({ result, calls }) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(calls, /curl .*bubblelab\.dev\/_health/);
    assert.match(calls, /gh run view 204 --json jobs/);
    assert.doesNotMatch(calls, /gh workflow run|git push|git revert/);
  });
});

test("이미 진행 중인 run을 기다린 뒤 라이브 SHA가 정확히 같아야 성공한다", () => {
  run("remote-live", ({ result, calls }) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(calls, /gh run view 201 --json status,conclusion/);
    assert.match(calls, /curl .*bubblelab\.dev\/_health/);
    assert.doesNotMatch(calls, /gh workflow run|git push/);
  });
});

test("성공 run이라도 라이브 SHA가 다르고 문서 전용이 아니면 실패한다", () => {
  run("remote-mismatch", ({ result, calls }) => {
    assert.notEqual(result.status, 0);
    assert.match(calls, /curl .*bubblelab\.dev\/_health/);
    assert.match(calls, /gh run view 205 --json jobs/);
    assert.doesNotMatch(calls, /gh workflow run|git push|git revert/);
  });
});
