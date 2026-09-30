import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planDeployment } from "./deploy-scope.mjs";

const git = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
async function readHealth() {
  const response = await fetch("https://bubblelab.dev/_health", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`health HTTP ${response.status}`);
  return response.json();
}

// push.before can omit failed/skipped commits. Diff against the actual live SHA.
// Unavailable live history widens validation, and records the reason in the plan.
export async function prepareDeployment({ head, forceFull = false }, io = { git, readHealth }) {
  const startedAt = new Date().toISOString();
  const checkout = io.git(["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/.test(head) || checkout !== head) throw new Error("Checkout does not match requested deployment SHA");
  let base = "";
  let reason = "";
  let files = [];
  try {
    base = (await io.readHealth()).commit;
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("health has no valid commit");
    try {
      io.git(["cat-file", "-e", `${base}^{commit}`]);
    } catch {
      io.git(["fetch", "--no-tags", "--depth=1", "origin", base]);
    }
    files = io.git(["diff", "--no-renames", "--name-only", "-z", base, "HEAD"]).split("\0").filter(Boolean);
  } catch (error) {
    reason = `Full validation: cannot establish deployed baseline (${error.message})`;
  }
  const plan = planDeployment(reason || forceFull ? [".github/workflows/deploy.yml"] : files);
  return { ...plan, base, reason, head, startedAt };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const plan = await prepareDeployment({ head: process.env.GITHUB_SHA, forceFull: process.env.DEPLOY_FORCE_FULL === "true" });
  writeFileSync(".deploy-plan.json", JSON.stringify(plan, null, 2) + "\n");
  if (plan.reason) console.warn(plan.reason);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\navalon=${plan.avalon}\n`);
  console.log(`Deployment scope: ${plan.mode}; sites: ${plan.sites.join(", ") || "all/none"}; tests: ${plan.tests.length}; browser specs: ${plan.e2e.length}`);
}
