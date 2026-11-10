import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { planDeployment } from "./deploy-scope.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE = "_infra/e2e/smoke.spec.mjs";
const ALL_SPECS = readdirSync(join(ROOT, "_infra/e2e"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.mjs"))
  .map((entry) => `_infra/e2e/${entry.name}`).sort();

function expectScoped(file, site, e2e = []) {
  const plan = planDeployment([file]);
  assert.equal(plan.mode, "scoped");
  assert.deepEqual(plan.sites, [site]);
  assert.deepEqual(plan.e2e, [SMOKE, ...e2e].sort());
  assert.deepEqual(plan.files, [file]);
}

test("서브도메인 하나만 바뀌면 스모크와 그 서브도메인의 spec 만 고른다", () => {
  expectScoped("life/budget/store.js", "life", [
    "_infra/e2e/backup.spec.mjs", "_infra/e2e/budget.spec.mjs", "_infra/e2e/kcal.spec.mjs",
    "_infra/e2e/library.spec.mjs", "_infra/e2e/life.spec.mjs",
    "_infra/e2e/pushup.spec.mjs", "_infra/e2e/review.spec.mjs",
  ]);
  expectScoped("duri/map.js", "duri", [
    "_infra/e2e/duri-fit.spec.mjs", "_infra/e2e/duri-map.spec.mjs",
    "_infra/e2e/duri-picker.spec.mjs", "_infra/e2e/duri-timelapse.spec.mjs",
  ]);
  expectScoped("util/stars/index.html", "util", ["_infra/e2e/yaksok.spec.mjs"]);
  expectScoped("games/stepcam/index.html", "games");
});

test("공용 www를 제외한 현재 배포 루트는 scoped 분류된다", () => {
  const sites = [
    "admin", "assets", "dageudangs", "duri", "estate", "games", "idle", "interior", "lab",
    "life", "mindfulness", "opic", "podcast", "slop", "test",
    "util", "work",
  ];
  for (const site of sites) {
    const plan = planDeployment([`${site}/index.html`]);
    assert.equal(plan.mode, "scoped", site);
    assert.deepEqual(plan.sites, [site], site);
  }
});

test("앱 안 README는 실제 서빙 파일일 수 있어 scoped다", () => {
  assert.equal(planDeployment(["life/budget/README.md"]).mode, "scoped");
});

test("배포되지 않는 문서만 바뀌면 실행할 일이 없다", () => {
  const files = ["README.md", "docs/ops.md", ".omx/notepad.md", ".codex/config.md", ".agents/notes.md"];
  assert.deepEqual(planDeployment(files), { mode: "none", sites: [], e2e: [], files: [...files].sort() });
});

test("공용·런타임·모르는 경로가 하나라도 끼면 full 이고 spec 을 전부 돌린다", () => {
  for (const file of [
    "www/index.html", "_shared/share.js", "_assets/wallpaper/x.png", "_infra/worker.js",
    "scripts/lint.sh", "package-lock.json", ".github/workflows/ci.yml", "newsite/index.html",
    "pops_generator/index.html", "_infra/life.test.mjs", "_infra/e2e/life.spec.mjs",
  ]) {
    const plan = planDeployment(["life/index.html", file]);
    assert.equal(plan.mode, "full", file);
    assert.deepEqual(plan.e2e, ALL_SPECS, file);
  }
  assert.equal(planDeployment(["life/index.html"], { full: true }).mode, "full");
});

test("SITE_E2E 에 없는 새 spec 은 범위와 상관없이 언제나 돈다", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-scope-specs-"));
  try {
    mkdirSync(join(root, "_infra/e2e"), { recursive: true });
    for (const name of ["smoke", "life", "estate", "surprise"]) {
      writeFileSync(join(root, `_infra/e2e/${name}.spec.mjs`), "");
    }
    const plan = planDeployment(["life/index.html"], { root });
    assert.equal(plan.mode, "scoped");
    assert.deepEqual(plan.e2e, [
      "_infra/e2e/life.spec.mjs", SMOKE, "_infra/e2e/surprise.spec.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("삭제된 파일과 두 사이트 사이 rename도 존재 여부와 무관하게 분류한다", () => {
  const plan = planDeployment(["life/old.js", "util/new.js", "duri/deleted.js"]);
  assert.equal(plan.mode, "scoped");
  assert.deepEqual(plan.sites, ["duri", "life", "util"]);
  assert.ok(plan.e2e.includes("_infra/e2e/duri-map.spec.mjs"));
  assert.ok(plan.e2e.includes("_infra/e2e/yaksok.spec.mjs"));
  assert.ok(!plan.e2e.includes("_infra/e2e/estate.spec.mjs"));
});

test("agent-scope.conf 가 한 서브도메인 소유로 적은 _infra 파일은 그 범위로, 공용 파일은 전체로", () => {
  const util = planDeployment(["_infra/yaksok.js", "_infra/yaksok.test.mjs", "_infra/e2e/yaksok.spec.mjs"]);
  assert.equal(util.mode, "scoped");
  assert.deepEqual(util.sites, ["util"]);
  assert.ok(util.e2e.includes("_infra/e2e/yaksok.spec.mjs"));

  // 와일드카드 소유(_src/emoticon/*)도 따른다
  const wild = planDeployment(["_src/emoticon/dageudangs/tokens.json"]);
  assert.deepEqual([wild.mode, wild.sites], ["scoped", ["work"]]);

  // *shared* 줄은 소유가 아니다 — 공용이 하나라도 끼면 전체
  for (const shared of ["_infra/worker.js", "_infra/build.mjs", "_infra/e2e/smoke.spec.mjs", "wrangler.jsonc"]) {
    assert.equal(planDeployment(["_infra/yaksok.js", shared]).mode, "full", shared);
  }
  // 두 서브도메인 소유가 섞이면 둘 다
  assert.deepEqual(planDeployment(["_infra/yaksok.js", "_infra/analytics.js"]).sites, ["admin", "util"]);
});
