import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { planDeployment } from "./deploy-scope.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "_infra/deploy-scope.mjs");
const SMOKE = "_infra/e2e/smoke.spec.mjs";
const BUILD_CONTRACT = "_infra/home-button.test.mjs";

function expectScoped(file, site, tests, e2e = []) {
  const plan = planDeployment([file]);
  assert.equal(plan.mode, "scoped");
  assert.deepEqual(plan.sites, [site]);
  assert.deepEqual(plan.tests, [BUILD_CONTRACT, ...tests].sort());
  assert.deepEqual(plan.e2e, [SMOKE, ...e2e].sort());
  assert.equal(plan.avalon, site === "games");
  assert.deepEqual(plan.files, [file]);
}

test("life 변경은 sink를 포함한 life 전체 기능 테스트와 e2e를 고른다", () => {
  expectScoped("life/budget/store.js", "life", [
    "_infra/backup-slim.test.mjs", "_infra/backup.test.mjs",
    "_infra/budget-sms.test.mjs", "_infra/budget.test.mjs",
    "_infra/discord.test.mjs", "_infra/dram.test.mjs", "_infra/espanol.test.mjs",
    "_infra/kcal.test.mjs", "_infra/library.test.mjs", "_infra/life.test.mjs",
    "_infra/papers.test.mjs", "_infra/pops.test.mjs", "_infra/pushup.test.mjs",
    "_infra/review.test.mjs", "_infra/tts.test.mjs", "_src/life-sink/store.test.mjs",
  ], [
    "_infra/e2e/backup.spec.mjs", "_infra/e2e/budget.spec.mjs",
    "_infra/e2e/espanol.spec.mjs", "_infra/e2e/kcal.spec.mjs",
    "_infra/e2e/library.spec.mjs", "_infra/e2e/life.spec.mjs",
    "_infra/e2e/pushup.spec.mjs", "_infra/e2e/review.spec.mjs",
  ]);
});

test("duri 변경은 sink와 duri 화면 전체를 고른다", () => {
  expectScoped("duri/map.js", "duri", [
    "_infra/duri-world.test.mjs", "_infra/duri.test.mjs", "_src/duri-sink/store.test.mjs",
  ], [
    "_infra/e2e/duri-fit.spec.mjs", "_infra/e2e/duri-map.spec.mjs",
    "_infra/e2e/duri-picker.spec.mjs", "_infra/e2e/duri-timelapse.spec.mjs",
  ]);
});

test("util 변경은 도메인 전체 단위 테스트와 smoke를 고른다", () => {
  expectScoped("util/stars/index.html", "util", [
    "_infra/brief.test.mjs", "_infra/chat.test.mjs", "_infra/fortune.test.mjs",
    "_infra/planner.test.mjs", "_infra/proofread.test.mjs", "_infra/saju-detail.test.mjs",
    "_infra/stars-skyline.test.mjs", "_infra/stars.test.mjs", "_infra/tojeong.test.mjs",
  ]);
});

test("assets 변경은 카탈로그와 생성기 전체 테스트를 고른다", () => {
  expectScoped("assets/catalog.json", "assets", [
    "_infra/asset-flags.test.mjs", "_infra/assets-store.test.mjs", "_infra/assets.test.mjs",
    "_infra/devices.test.mjs", "_infra/downloads.test.mjs", "_infra/gif.test.mjs",
    "_infra/sticker-pack.test.mjs", "_infra/wallpaper.test.mjs",
  ]);
});

test("games 변경은 멀티플레이와 Avalon 검증까지 고른다", () => {
  expectScoped("games/avalon/index.html", "games", [
    "_infra/check-avalon-sync.test.mjs", "_infra/liargame.test.mjs",
    "_infra/realtime.test.mjs", "_infra/stepcam.test.mjs",
  ]);
});

test("work 변경은 생성·리뷰·문의 기능 전체 테스트를 고른다", () => {
  expectScoped("work/index.html", "work", [
    "_infra/emoticon-gate.test.mjs", "_infra/emoticon-prompt.test.mjs",
    "_infra/emoticon-review.test.mjs", "_infra/emoticon-rig.test.mjs",
    "_infra/emoticon-vision.test.mjs", "_infra/emoticon.test.mjs",
    "_infra/reviews.test.mjs", "_infra/skeleton.test.mjs", "_infra/workqna.test.mjs",
  ]);
});

test("공용 랜딩인 www/index.html 변경은 전체 검증한다", () => {
  assert.equal(planDeployment(["www/index.html"]).mode, "full");
});

test("공용 www를 제외한 현재 배포 루트는 scoped 분류된다", () => {
  const sites = [
    "admin", "assets", "duri", "espanol", "estate", "games", "idle", "invest", "lab",
    "life", "mindfulness", "podcast", "puzzle", "sktest", "slop", "test",
    "trip", "util", "work",
  ];
  for (const site of sites) {
    const plan = planDeployment([`${site}/index.html`]);
    assert.equal(plan.mode, "scoped", site);
    assert.deepEqual(plan.sites, [site], site);
  }
});

test("배포에서 제외한 pops_generator는 알 수 없는 경로로 full 분류한다", () => {
  const plan = planDeployment(["pops_generator/index.html"]);
  assert.equal(plan.mode, "full");
  assert.ok(!plan.sites.includes("pops_generator"));
});

test("앱 안 README는 실제 서빙 파일일 수 있어 scoped다", () => {
  assert.equal(planDeployment(["life/budget/README.md"]).mode, "scoped");
});

test("배포되지 않는 문서만 바뀌면 실행할 일이 없다", () => {
  const files = ["README.md", "docs/ops.md", ".omx/notepad.md", ".codex/config.md", ".agents/notes.md"];
  assert.deepEqual(planDeployment(files), {
    mode: "none", sites: [], tests: [], e2e: [], avalon: false, files: [...files].sort(),
  });
});

test("공용·런타임·알 수 없는 경로와 test/spec 변경은 full이다", () => {
  for (const file of [
    "_shared/share.js", "_assets/wallpaper/x.png", "_infra/worker.js", "_src/avalon/src/main.js",
    "scripts/lint.sh", "package-lock.json", ".github/workflows/ci.yml", "newsite/index.html",
    "_infra/life.test.mjs", "_infra/e2e/life.spec.mjs",
  ]) {
    assert.equal(planDeployment([file]).mode, "full", file);
  }
});

test("full 계획은 현재 unit 및 e2e 파일을 빠짐없이 열거한다", () => {
  const unit = [
    ...readdirSync(join(ROOT, "_infra"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
      .map((entry) => `_infra/${entry.name}`),
    ...["duri-sink", "life-sink"].flatMap((dir) =>
      readdirSync(join(ROOT, "_src", dir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
        .map((entry) => `_src/${dir}/${entry.name}`)),
  ].sort();
  const e2e = readdirSync(join(ROOT, "_infra/e2e"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.mjs"))
    .map((entry) => `_infra/e2e/${entry.name}`).sort();
  const plan = planDeployment(["_shared/share.js"]);
  assert.deepEqual(plan.tests, unit);
  assert.deepEqual(plan.e2e, e2e);
  assert.equal(plan.avalon, true);
});

test("npm test 또는 e2e 경로의 새 검사가 분류표에 없으면 앱 변경도 full로 넓힌다", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-scope-tests-"));
  try {
    mkdirSync(join(root, "_infra/e2e"), { recursive: true });
    writeFileSync(join(root, "_infra/surprise.test.mjs"), "");
    assert.equal(planDeployment(["life/index.html"], { root }).mode, "full");
    unlinkSync(join(root, "_infra/surprise.test.mjs"));
    writeFileSync(join(root, "_infra/e2e/surprise.spec.mjs"), "");
    assert.equal(planDeployment(["life/index.html"], { root }).mode, "full");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("npm test 밖의 source 테스트는 배포 범위를 넓히지 않는다", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-scope-source-tests-"));
  try {
    mkdirSync(join(root, "_src/avalon"), { recursive: true });
    writeFileSync(join(root, "_src/avalon/vitest.test.mjs"), "");
    const plan = planDeployment(["life/index.html"], { root });
    assert.equal(plan.mode, "scoped");
    assert.deepEqual(plan.sites, ["life"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("현재 checkout에 없는 선택적 util 테스트는 계획에 넣지 않는다", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-scope-old-base-"));
  try {
    mkdirSync(join(root, "_infra"), { recursive: true });
    writeFileSync(join(root, "_infra/brief.test.mjs"), "");
    const plan = planDeployment(["util/index.html"], { root });
    assert.equal(plan.mode, "scoped");
    assert.deepEqual(plan.tests, ["_infra/brief.test.mjs", BUILD_CONTRACT].sort());
    assert.ok(!plan.tests.includes("_infra/saju-detail.test.mjs"));
    assert.ok(!plan.tests.includes("_infra/tojeong.test.mjs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("삭제된 파일과 두 사이트 사이 rename도 존재 여부와 무관하게 분류한다", () => {
  const plan = planDeployment(["life/old.js", "util/new.js", "duri/deleted.js"]);
  assert.equal(plan.mode, "scoped");
  assert.deepEqual(plan.sites, ["duri", "life", "util"]);
  assert.ok(plan.tests.includes("_src/duri-sink/store.test.mjs"));
  assert.ok(plan.tests.includes("_src/life-sink/store.test.mjs"));
  assert.ok(plan.tests.includes("_infra/stars.test.mjs"));
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("CLI는 --no-renames diff로 rename 양쪽과 삭제 경로를 JSON에 쓴다", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-scope-git-"));
  try {
    git(root, ["init", "-q"]);
    mkdirSync(join(root, "life"));
    mkdirSync(join(root, "util"));
    mkdirSync(join(root, "duri"));
    writeFileSync(join(root, "life/old.js"), "same\n");
    writeFileSync(join(root, "duri/deleted.js"), "gone\n");
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base"]);
    const base = git(root, ["rev-parse", "HEAD"]);
    renameSync(join(root, "life/old.js"), join(root, "util/new.js"));
    unlinkSync(join(root, "duri/deleted.js"));
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "head"]);
    const head = git(root, ["rev-parse", "HEAD"]);
    const output = join(root, "plan.json");
    const result = spawnSync(process.execPath, [SCRIPT, "--base", base, "--head", head, "--output", output], {
      cwd: root, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(readFileSync(output, "utf8"));
    assert.deepEqual(plan.files, ["duri/deleted.js", "life/old.js", "util/new.js"]);
    assert.deepEqual(plan.sites, ["duri", "life", "util"]);

    const fullOutput = join(root, "full-plan.json");
    const fullResult = spawnSync(process.execPath, [
      SCRIPT, "--base", base, "--head", head, "--output", fullOutput, "--full",
    ], { cwd: root, encoding: "utf8" });
    assert.equal(fullResult.status, 0, fullResult.stderr);
    assert.equal(JSON.parse(readFileSync(fullOutput, "utf8")).mode, "full");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI는 유효하지 않은 commit을 실패로 드러내고 출력 파일을 만들지 않는다", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-scope-bad-git-"));
  try {
    git(root, ["init", "-q"]);
    const output = join(root, "plan.json");
    const result = spawnSync(process.execPath, [
      SCRIPT, "--base", "not-a-commit", "--head", "also-bad", "--output", output,
    ], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid --base commit/);
    assert.throws(() => readFileSync(output), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
