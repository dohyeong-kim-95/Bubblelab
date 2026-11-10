import test from "node:test";
import assert from "node:assert/strict";
import { checkCommands } from "./deploy-check.mjs";

const plan = {
  mode: "scoped", files: ["life/index.html", "life/already-deleted.js"],
  e2e: ["_infra/e2e/smoke.spec.mjs", "_infra/e2e/life.spec.mjs"],
};
const playwright = [process.execPath, "node_modules/@playwright/test/cli.js", "test"];

test("scoped validation lints the changed files, runs every unit test, and only the selected specs", () => {
  assert.deepEqual(checkCommands(plan, "unit"), [
    ["bash", "scripts/lint.sh", "life/index.html"],
    ["npm", "test"],
  ]);
  assert.deepEqual(checkCommands(plan, "e2e"), [[...playwright, ...plan.e2e]]);
});
test("full validation lints everything", () => {
  assert.deepEqual(checkCommands({ ...plan, mode: "full" }, "unit"), [["bash", "scripts/lint.sh"], ["npm", "test"]]);
});
test("deletions still run unit/build checks without accidentally requesting full lint", () => {
  assert.deepEqual(checkCommands({ ...plan, files: ["life/already-deleted.js"] }, "unit"), [["npm", "test"]]);
});
test("a plan without browser checks cannot publish; a docs-only plan runs nothing", () => {
  assert.throws(() => checkCommands({ ...plan, e2e: [] }, "unit"), /browser checks/);
  assert.throws(() => checkCommands({ ...plan, e2e: [] }, "e2e"), /browser checks/);
  assert.deepEqual(checkCommands({ mode: "none" }, "unit"), []);
  assert.throws(() => checkCommands({ mode: "none" }, "typo"), /Unknown/);
});
