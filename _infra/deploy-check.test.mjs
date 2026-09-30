import test from "node:test";
import assert from "node:assert/strict";
import { checkCommands } from "./deploy-check.mjs";

const plan = {
  mode: "scoped", files: ["life/index.html", "life/already-deleted.js"],
  tests: ["_infra/home-button.test.mjs", "_infra/life.test.mjs"],
  e2e: ["_infra/e2e/smoke.spec.mjs", "_infra/e2e/life.spec.mjs"],
};
test("scoped validation runs exact selected tests and builds only through the build contract", () => {
  assert.deepEqual(checkCommands(plan, "unit"), [
    ["bash", "scripts/lint.sh", "life/index.html"],
    [process.execPath, "--test", ...plan.tests],
  ]);
  assert.deepEqual(checkCommands(plan, "e2e"), [[process.execPath, "node_modules/@playwright/test/cli.js", "test", ...plan.e2e]]);
});
test("deletions still run unit/build checks without accidentally requesting full lint", () => {
  assert.deepEqual(checkCommands({ ...plan, files: ["life/already-deleted.js"] }, "unit"), [
    [process.execPath, "--test", ...plan.tests],
  ]);
});
test("empty validation plans cannot publish an unbuilt tree", () => {
  assert.throws(() => checkCommands({ ...plan, tests: [] }, "unit"), /build contract/);
  assert.throws(() => checkCommands({ ...plan, e2e: [] }, "e2e"), /browser checks/);
  assert.deepEqual(checkCommands({ mode: "none" }, "unit"), []);
  assert.throws(() => checkCommands({ mode: "none" }, "typo"), /Unknown/);
});
