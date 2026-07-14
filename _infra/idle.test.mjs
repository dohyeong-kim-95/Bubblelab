import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATORS, OFFLINE_CAP_MS, clickValue, elapsedDay, freshState,
  generatorCost, milestoneMultiplier, pickBubbleTier, productionPerSecond,
  seasonBounds, settleOffline,
} from "../idle/bubble-pop/game-core.js";
import { RecordsDO } from "./records.js";

class MemoryStorage {
  constructor(entries = []) { this.data = new Map(entries); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key); }
  async list({ prefix } = {}) {
    return new Map([...this.data].filter(([key]) => !prefix || key.startsWith(prefix)));
  }
}

const postRecord = (records, body) => records.fetch(new Request("https://records.internal/", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

test("bubble idle shares the Monday 09:00 KST weekly season", () => {
  const start = Date.UTC(2026, 6, 13); // 월요일 09:00 KST
  const state = freshState(start);
  assert.equal(elapsedDay(state, start), 1);
  assert.equal(elapsedDay(state, start + 6 * 86400000), 7);
  assert.equal(elapsedDay(state, start + 20 * 86400000), 7);
  assert.equal(seasonBounds(Date.parse("2026-07-19T23:59:59Z")).key, "2026-07-13");
  assert.equal(seasonBounds(Date.parse("2026-07-20T00:00:00Z")).key, "2026-07-20");
});

test("valuable bubbles unlock on later days", () => {
  assert.equal(pickBubbleTier(2, () => 0).id, "clear");
  assert.equal(pickBubbleTier(3, () => 0).id, "pearl");
  assert.equal(pickBubbleTier(5, () => 0).id, "gold");
  assert.equal(pickBubbleTier(7, () => 0).id, "aurora");
  assert.equal(pickBubbleTier(7, () => .99).id, "clear");
});

test("generator cost grows and ownership milestones double production", () => {
  const generator = GENERATORS[0];
  assert.ok(generatorCost(generator, 1) > generatorCost(generator, 0));
  assert.equal(milestoneMultiplier(9), 1);
  assert.equal(milestoneMultiplier(10), 2);
  assert.equal(milestoneMultiplier(25), 4);
  assert.equal(milestoneMultiplier(50), 8);
});

test("active and idle upgrades visibly increase growth", () => {
  const state = freshState();
  state.generators.wand = 10;
  const base = productionPerSecond(state);
  state.flowLevel = 1;
  assert.equal(productionPerSecond(state), base * 1.6);
  assert.equal(clickValue(state), 1);
  state.clickLevel = 3;
  assert.equal(clickValue(state), 8);
});

test("offline earnings are capped at 24 hours", () => {
  const start = Date.UTC(2026, 6, 14);
  const state = freshState(start);
  state.generators.wand = 1;
  const result = settleOffline(state, start + 3 * 86400000);
  assert.equal(result.elapsed, OFFLINE_CAP_MS);
  assert.equal(result.capped, true);
  assert.equal(state.lifetime, productionPerSecond(state) * 86400);
});

test("finite idle hall keeps one champion for every weekly season", async () => {
  const storage = new MemoryStorage([
    ["rec:2026-06-29:bubble-pop-idle", { nick: "첫우승", score: 12345, text: "12.3K 버블", dir: "max", at: 1 }],
    ["idlehall:2026-06-22:bubble-pop-idle", { nick: "전설", score: 9999, text: "9.99K 버블", dir: "max", at: 0 }],
  ]);
  const records = new RecordsDO({ storage });
  let response = await records.fetch(new Request(
    "https://records.internal/?history=1&game=bubble-pop-idle",
  ));
  let history = (await response.json()).records;
  assert.deepEqual(history.map((record) => record.week), ["2026-06-29", "2026-06-22"]);
  assert.equal(history[0].nick, "첫우승");

  await postRecord(records, { game: "bubble-pop-idle", nick: "이번주", score: 1, text: "1 버블" });
  assert.equal(storage.data.has("idlehall:2026-06-29:bubble-pop-idle"), true);
  response = await records.fetch(new Request(
    "https://records.internal/?history=1&game=bubble-pop-idle",
  ));
  history = (await response.json()).records;
  assert.equal(history.some((record) => record.nick === "첫우승"), true);
});
