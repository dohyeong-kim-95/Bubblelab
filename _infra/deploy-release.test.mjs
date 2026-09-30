import test from "node:test";
import assert from "node:assert/strict";
import { release } from "./deploy-release.mjs";

const oldVersion = "11111111-1111-1111-1111-111111111111";
const newVersion = "22222222-2222-2222-2222-222222222222";
function fixture(results) {
  const commands = [];
  const verifies = [];
  return {
    commands, verifies,
    command(args) {
      commands.push(args);
      return args[0] === "deployments" ? JSON.stringify({ versions: [{ version_id: oldVersion, percentage: 100 }] }) : "";
    },
    async verify(args) { verifies.push(args); return results.shift(); },
  };
}
test("publish verifies the exact commit before declaring success", async () => {
  const f = fixture([0]);
  await release({ head: "a".repeat(40), base: "b".repeat(40) }, f);
  assert.deepEqual(f.commands.map(c => c[0]), ["deployments", "deploy"]);
  assert.ok(f.verifies[0].includes("a".repeat(40)));
});
test("failed verification restores the captured version and verifies the previous SHA", async () => {
  const f = fixture([1, 0]);
  await assert.rejects(release({ head: "a".repeat(40), base: "b".repeat(40) }, f), /restored/);
  assert.equal(f.commands[2][0], "rollback");
  assert.equal(f.commands[2][1], oldVersion);
  assert.ok(f.verifies[1].includes("b".repeat(40)));
});
test("an unrecognized production deployment cannot be overwritten", async () => {
  const f = fixture([0]);
  f.command = () => JSON.stringify({ versions: [] });
  await assert.rejects(release({ head: "a".repeat(40) }, f), /100%/);
});
test("a deploy command failure does not claim success or start live verification", async () => {
  const f = fixture([0]);
  const command = f.command;
  f.command = args => { if (args[0] === "deploy") throw new Error("upload failed"); return command(args); };
  await assert.rejects(release({ head: "a".repeat(40) }, f), /upload failed/);
  assert.deepEqual(f.commands.map(c => c[0]), ["deployments", "deployments"]);
  assert.equal(f.verifies.length, 0);
});

test("a partial deployment is rolled back when deploy reports failure", async () => {
  const f = fixture([0]);
  let statusCalls = 0;
  const command = f.command;
  f.command = args => {
    if (args[0] === "deploy") throw new Error("upload failed after publish");
    if (args[0] === "deployments" && statusCalls++ === 1) {
      f.commands.push(args);
      return JSON.stringify({ versions: [{ version_id: newVersion, percentage: 100 }] });
    }
    return command(args);
  };
  await assert.rejects(
    release({ head: "a".repeat(40), base: "b".repeat(40) }, f),
    /upload failed after publish; previous version restored and health verified/,
  );
  assert.equal(f.commands.at(-1)[0], "rollback");
  assert.ok(f.verifies[0].includes("b".repeat(40)));
});

test("a failed deploy reports uncertain live state when status cannot be queried", async () => {
  const f = fixture([]);
  let statusCalls = 0;
  const command = f.command;
  f.command = args => {
    if (args[0] === "deploy") throw new Error("upload failed");
    if (args[0] === "deployments" && statusCalls++ === 1) throw new Error("status offline");
    return command(args);
  };
  await assert.rejects(release({ head: "a".repeat(40) }, f), /upload failed;.*live state is uncertain: status offline/);
  assert.equal(f.verifies.length, 0);
});

test("verification failure reports both the original and rollback failures", async () => {
  const f = fixture([1]);
  const command = f.command;
  f.command = args => {
    if (args[0] === "rollback") throw new Error("rollback offline");
    return command(args);
  };
  await assert.rejects(
    release({ head: "a".repeat(40), base: "b".repeat(40) }, f),
    /Production verification failed; rollback failed: rollback offline/,
  );
});

test("a failed prior-version health check retains the deployment failure", async () => {
  const f = fixture([1, 1]);
  await assert.rejects(
    release({ head: "a".repeat(40), base: "b".repeat(40) }, f),
    /Production verification failed; previous version restored, but rollback health verification failed/,
  );
});
