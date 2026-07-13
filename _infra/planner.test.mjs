import test from "node:test";
import assert from "node:assert/strict";
import { PlannerDO, prunePlannerData } from "./planner.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
}

test("keeps only the selected month and global planner fields", () => {
  const data = prunePlannerData({
    _globalNotes: "note",
    _ddays: [],
    "2026-07-01": { plan: [], real: [], todo: [] },
    "2026-06-30": { plan: [1], real: [], todo: [] },
    junk: true,
  }, "2026-07");
  assert.deepEqual(Object.keys(data).sort(), ["2026-07-01", "_ddays", "_globalNotes"]);
});

test("stores and returns planner data", async () => {
  const planner = new PlannerDO({ storage: new MemoryStorage() });
  const payload = { data: { "2026-07-13": { plan: [], real: [], todo: [{ id: "1", title: "Test", done: false }] } } };
  let response = await planner.fetch(new Request("https://planner.internal/", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  assert.equal(response.status, 200);
  response = await planner.fetch(new Request("https://planner.internal/"));
  assert.equal((await response.json()).data["2026-07-13"].todo[0].title, "Test");
});

test("rejects invalid planner writes", async () => {
  const planner = new PlannerDO({ storage: new MemoryStorage() });
  assert.equal((await planner.fetch(new Request("https://planner.internal/", { method: "PUT", body: "nope" }))).status, 400);
  assert.equal((await planner.fetch(new Request("https://planner.internal/", { method: "DELETE" }))).status, 405);
});
