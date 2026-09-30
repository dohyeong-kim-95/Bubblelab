import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as verify } from "./verify-prod.mjs";

function command(args) {
  return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
    encoding: "utf8", stdio: args[0] === "deployments" ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

// wrangler 는 설정 경고(예: wrangler.jsonc 의 secrets.optional)를 만나면 "There is a newer
// version of Wrangler available…" 같은 안내를 --json 출력 앞에 stdout 으로 섞는다. 첫 배포가
// 이것 때문에 publish 전에 멈췄다. 줄 맨 앞의 "{" 부터 마지막 "}" 까지만 JSON 으로 읽는다.
export function parseWranglerJson(output) {
  const text = String(output);
  const start = text.startsWith("{") ? 0 : text.indexOf("\n{") + 1;
  const end = text.lastIndexOf("}");
  if (start <= 0 && !text.startsWith("{") || end < start) {
    throw new Error(`wrangler did not print JSON: ${text.slice(0, 120)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function productionVersion(io) {
  const current = parseWranglerJson(io.command(["deployments", "status", "--json"]));
  const version = current.versions?.length === 1 && current.versions[0];
  if (!version || version.percentage !== 100 || !/^[a-f0-9-]{36}$/.test(version.version_id)) {
    throw new Error("Expected one production version serving 100% before deployment");
  }
  return version;
}

async function restore(failure, version, plan, io) {
  try {
    io.command(["rollback", version.version_id, "--yes", "--message", `Verification failed for ${plan.head.slice(0, 12)}`]);
  } catch (error) {
    throw new Error(`${failure.message}; rollback failed: ${error.message}`);
  }
  if (!/^[a-f0-9]{40}$/.test(plan.base ?? "")) {
    throw new Error(`${failure.message}; previous version restored, but previous SHA is unavailable`);
  }
  try {
    const result = await io.verify(["--commit", plan.base, "--wait", "60", "--only", "health"]);
    if (result !== 0) throw new Error("health check returned failure");
  } catch (error) {
    throw new Error(`${failure.message}; previous version restored, but rollback health verification failed: ${error.message}`);
  }
  throw new Error(`${failure.message}; previous version restored and health verified`);
}

export async function release(plan, io = { command, verify }) {
  if (!/^[a-f0-9]{40}$/.test(plan.head)) throw new Error("A full deployment commit SHA is required");
  const version = productionVersion(io);
  try {
    io.command(["deploy"]);
  } catch (failure) {
    let current;
    try {
      current = productionVersion(io);
    } catch (statusError) {
      throw new Error(`${failure.message}; deployment status unavailable, live state is uncertain: ${statusError.message}`);
    }
    if (current.version_id === version.version_id) throw failure;
    return restore(failure, version, plan, io);
  }
  let failure;
  try {
    if (await io.verify(["--commit", plan.head, "--wait", "60"]) === 0) return;
    failure = new Error("Production verification failed");
  } catch (error) { failure = error; }
  return restore(failure, version, plan, io);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const plan = JSON.parse(readFileSync(process.argv[2] ?? ".deploy-plan.json", "utf8"));
  let outcome = "failed";
  try {
    await release(plan);
    outcome = "verified";
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    const seconds = Math.round((Date.now() - Date.parse(plan.startedAt)) / 1000);
    const summary = `Deployment ${outcome}: ${plan.head}\nScope: ${plan.mode} (${plan.sites.join(", ")})\nPreparation to live verification: ${seconds}s\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}
