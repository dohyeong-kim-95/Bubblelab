import test from "node:test";
import assert from "node:assert/strict";
import { prepareDeployment } from "./deploy-prepare.mjs";
const head = "a".repeat(40), base = "b".repeat(40);
function fixture({ missing = false, unavailable = false } = {}) {
  const commands = [];
  return {
    commands,
    readHealth: async () => ({ commit: base }),
    git(args) {
      commands.push(args);
      if (args[0] === "rev-parse") return head;
      if (args[0] === "cat-file" && missing) throw new Error("missing base");
      if (args[0] === "fetch" && unavailable) throw new Error("fetch failed");
      if (args[0] === "diff") return "life/old.js\0util/new.js\0";
      return "";
    },
  };
}
test("baseline is the live SHA, including both sides of renames", async () => {
  const io = fixture();
  const plan = await prepareDeployment({ head }, io);
  assert.deepEqual(plan.sites, ["life", "util"]);
  assert.deepEqual(io.commands.at(-1), ["diff", "--no-renames", "--name-only", "-z", base, "HEAD"]);
  assert.equal(plan.base, base);
});
test("shallow checkout retrieves only the deployed commit when needed", async () => {
  const io = fixture({ missing: true });
  const plan = await prepareDeployment({ head }, io);
  assert.equal(plan.mode, "scoped");
  assert.deepEqual(io.commands[2], ["fetch", "--no-tags", "--depth=1", "origin", base]);
});
test("unavailable baseline retains evidence and forces all tests", async () => {
  const plan = await prepareDeployment({ head }, fixture({ missing: true, unavailable: true }));
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /fetch failed/);
});
test("bad health SHA cannot become a git argument", async () => {
  const io = fixture();
  io.readHealth = async () => ({ commit: "--upload-pack=bad" });
  const plan = await prepareDeployment({ head }, io);
  assert.equal(plan.mode, "full");
  assert.equal(io.commands.length, 1);
});
test("manual redeploy performs full validation; wrong checkout cannot publish", async () => {
  assert.equal((await prepareDeployment({ head, forceFull: true }, fixture())).mode, "full");
  await assert.rejects(prepareDeployment({ head: base }, fixture()), /Checkout/);
});
