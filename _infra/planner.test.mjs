import test from "node:test";
import assert from "node:assert/strict";
import { PlannerDO, prunePlannerData, validPlannerCode } from "./planner.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
  async delete(key) { this.data.delete(key); }
}
const TEST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

test("accepts the six-digit and two-letter planner code format", () => {
  assert.equal(validPlannerCode("123456AB"), true);
  assert.equal(validPlannerCode("12345AB"), false);
  assert.equal(validPlannerCode("123456A1"), false);
  assert.equal(validPlannerCode("123456ab"), false);
});

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
  const payload = { data: { [TEST_DATE]: { plan: [], real: [], todo: [{ id: "1", title: "Test", done: false }] } } };
  let response = await planner.fetch(new Request("https://planner.internal/", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  assert.equal(response.status, 200);
  response = await planner.fetch(new Request("https://planner.internal/"));
  assert.equal((await response.json()).data[TEST_DATE].todo[0].title, "Test");

  response = await planner.fetch(new Request("https://planner.internal/", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "toggle", date: TEST_DATE, id: "1", done: true }),
  }));
  assert.equal(response.status, 200);
  response = await planner.fetch(new Request("https://planner.internal/"));
  assert.equal((await response.json()).data[TEST_DATE].todo[0].done, true);

  response = await planner.fetch(new Request("https://planner.internal/", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", date: TEST_DATE, title: "  New   task  " }),
  }));
  const added = (await response.json()).item;
  assert.equal(added.title, "New task");
  response = await planner.fetch(new Request("https://planner.internal/", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", date: TEST_DATE, id: added.id }),
  }));
  assert.equal(response.status, 200);
  response = await planner.fetch(new Request("https://planner.internal/"));
  assert.equal((await response.json()).data[TEST_DATE].todo.length, 1);
});

test("rejects invalid planner writes", async () => {
  const planner = new PlannerDO({ storage: new MemoryStorage() });
  assert.equal((await planner.fetch(new Request("https://planner.internal/", { method: "PUT", body: "nope" }))).status, 400);
  assert.equal((await planner.fetch(new Request("https://planner.internal/", { method: "PATCH", body: "{}" }))).status, 400);
  assert.equal((await planner.fetch(new Request("https://planner.internal/", { method: "HEAD" }))).status, 405);
});

test("adds, updates, and deletes schedule blocks with validation", async () => {
  const planner = new PlannerDO({ storage: new MemoryStorage() });
  const patch = (payload) => planner.fetch(new Request("https://planner.internal/", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: TEST_DATE, ...payload }),
  }));

  let response = await patch({ action: "block-add", track: "plan", startTime: "09:00", endTime: "10:00", title: "  Deep   work " });
  assert.equal(response.status, 200);
  const block = (await response.json()).block;
  assert.equal(block.title, "Deep work");

  // 같은 트랙 겹침은 409, 다른 트랙은 허용
  assert.equal((await patch({ action: "block-add", track: "plan", startTime: "09:30", endTime: "10:30", title: "Clash" })).status, 409);
  assert.equal((await patch({ action: "block-add", track: "real", startTime: "09:30", endTime: "10:30", title: "Real" })).status, 200);

  // 범위·형식 검증 (07:00–21:00, 10분 단위, 시작<끝)
  assert.equal((await patch({ action: "block-add", track: "plan", startTime: "06:50", endTime: "08:00", title: "Early" })).status, 400);
  assert.equal((await patch({ action: "block-add", track: "plan", startTime: "20:30", endTime: "21:10", title: "Late" })).status, 400);
  assert.equal((await patch({ action: "block-add", track: "plan", startTime: "11:05", endTime: "12:00", title: "Odd" })).status, 400);
  assert.equal((await patch({ action: "block-add", track: "plan", startTime: "12:00", endTime: "12:00", title: "Empty" })).status, 400);
  assert.equal((await patch({ action: "block-add", track: "todo", startTime: "12:00", endTime: "13:00", title: "Bad track" })).status, 400);

  response = await patch({ action: "block-update", track: "plan", id: block.id, startTime: "10:00", endTime: "11:00", title: "Moved" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).block.startTime, "10:00");
  assert.equal((await patch({ action: "block-update", track: "plan", id: "missing", title: "x" })).status, 404);

  // 색상 변경: PC 팔레트 hex는 허용, 형식이 아니면 400
  response = await patch({ action: "block-update", track: "plan", id: block.id, color: "#BAE1FF" });
  assert.equal((await response.json()).block.color, "#BAE1FF");
  assert.equal((await patch({ action: "block-update", track: "plan", id: block.id, color: "red" })).status, 400);

  assert.equal((await patch({ action: "block-delete", track: "plan", id: block.id })).status, 200);
  const data = (await (await planner.fetch(new Request("https://planner.internal/"))).json()).data;
  assert.equal(data[TEST_DATE].plan.length, 0);
  assert.equal(data[TEST_DATE].real.length, 1);
});

test("deletes all planner data on request", async () => {
  const planner = new PlannerDO({ storage: new MemoryStorage() });
  await planner.fetch(new Request("https://planner.internal/", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { [TEST_DATE]: { plan: [], real: [], todo: [] } } }),
  }));
  const response = await planner.fetch(new Request("https://planner.internal/", { method: "DELETE" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
  const after = await planner.fetch(new Request("https://planner.internal/"));
  assert.deepEqual((await after.json()).data, {});
});
