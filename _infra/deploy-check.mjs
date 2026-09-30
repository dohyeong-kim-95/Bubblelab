// Local and Actions validation consume the same reviewed change plan.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkCommands(plan, phase) {
  if (!["unit", "e2e"].includes(phase)) throw new Error(`Unknown validation phase: ${phase}`);
  if (plan.mode === "none") return [];
  if (!plan.tests.includes("_infra/home-button.test.mjs") || plan.e2e.length === 0) {
    throw new Error("Deployment must include build contract and browser checks");
  }
  if (phase === "unit") {
    const files = plan.files.filter(file => existsSync(file));
    return [
      // No arguments means all tracked files to lint.sh.
      ...(plan.mode === "full" ? [["bash", "scripts/lint.sh"]]
        : files.length ? [["bash", "scripts/lint.sh", ...files]] : []),
      [process.execPath, "--test", ...plan.tests],
      // home-button.test.mjs creates and verifies the complete dist once.
    ];
  }
  if (phase === "e2e") return [[process.execPath, "node_modules/@playwright/test/cli.js", "test", ...plan.e2e]];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [planFile, phase] = process.argv.slice(2);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const env = { ...process.env, BL_DEPLOY_PLAN: resolve(planFile) };
  for (const [command, ...args] of checkCommands(plan, phase)) {
    const result = spawnSync(command, args, { stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
