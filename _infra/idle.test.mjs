import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOW_MULTIPLIER, GENERATORS, OFFLINE_CAP_MS, PRESSURE_UPGRADES, SAVE_VERSION, clickValue, elapsedDay, freshState,
  generatorBulkCost, generatorCost, maxAffordableGenerators, milestoneMultiplier, milestoneProgress, pickBubbleTier, productionPerSecond,
  migrateState, pressurePerSecond, pressureUnlocked, pressureUpgradeCost, seasonBounds, settleOffline,
} from "../idle/bubble-pop/game-core.js";
import { EXHAUSTION_RULES, simulateFirstLayer, simulateSeason } from "./idle-balance.mjs";
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

test("valuable bubbles unlock at lifetime bubble milestones", () => {
  assert.equal(pickBubbleTier(499, () => 0).id, "clear");
  assert.equal(pickBubbleTier(500, () => 0).id, "pearl");
  assert.equal(pickBubbleTier(50000, () => 0).id, "gold");
  assert.equal(pickBubbleTier(5000000, () => 0).id, "aurora");
  assert.equal(pickBubbleTier(5000000, () => .99).id, "clear");
});

test("generator cost grows and ownership milestones double production", () => {
  const generator = GENERATORS[0];
  assert.ok(generatorCost(generator, 1) > generatorCost(generator, 0));
  assert.equal(milestoneMultiplier(24), 1);
  assert.equal(milestoneMultiplier(25), 2);
  assert.equal(milestoneMultiplier(50), 4);
  assert.equal(milestoneMultiplier(75), 8);
  assert.equal(milestoneMultiplier(80), 8);
  assert.equal(milestoneMultiplier(100), 16);
  assert.equal(milestoneProgress(80), 5 / 25);
});

test("generator bulk buying sums costs and finds the maximum affordable count", () => {
  const generator = GENERATORS[0];
  const owned = 7;
  const tenCost = generatorBulkCost(generator, owned, 10);
  const manualCost = Array.from({ length: 10 }, (_, index) => generatorCost(generator, owned + index))
    .reduce((sum, cost) => sum + cost, 0);
  assert.ok(Math.abs(tenCost - manualCost) < 1e-8);
  assert.equal(maxAffordableGenerators(generator, owned, tenCost - .001), 9);
  assert.equal(maxAffordableGenerators(generator, owned, tenCost), 10);
  assert.equal(maxAffordableGenerators(generator, owned, generatorCost(generator, owned) - .001), 0);
});

test("the free first generator makes the first purchase available within seconds", () => {
  const state = freshState();
  const wand = GENERATORS[0];
  assert.equal(state.generators.wand, 1);
  assert.ok(generatorCost(wand, 1) / productionPerSecond(state) < 4);
});

test("the tuned first layer has an optimized lower bound between 30 and 40 minutes", () => {
  const result = simulateFirstLayer();
  assert.equal(result.completed, true);
  assert.ok(result.seconds >= 30 * 60, `too fast: ${result.seconds}s`);
  assert.ok(result.seconds <= 40 * 60, `too slow: ${result.seconds}s`);
});

test("the season simulation reports novelty, repetition, wait wall, and exhaustion separately", () => {
  const result = simulateSeason();
  assert.equal(EXHAUSTION_RULES.meaningfulWaitSeconds, 12 * 60 * 60);
  assert.ok(result.allMechanicsTriedAt > result.firstLayerCompletedAt);
  assert.equal(result.repetitionOnlyAt, result.allMechanicsTriedAt);
  assert.ok(result.waitWallAt > result.repetitionOnlyAt);
  assert.ok(result.contentExhaustedAt >= result.waitWallAt);
  assert.ok(result.gapAfterExhaustion > 0);
  assert.ok(Object.values(result.final.pressureUpgrades).every((level) => level > 0));
});

test("version one saves migrate without losing weekly progress", () => {
  const old = freshState(Date.UTC(2026, 6, 14));
  old.version = 1;
  old.bubbles = 123;
  old.generators.ocean = 2;
  delete old.pressure;
  delete old.pressureLifetime;
  delete old.pressureUpgrades;
  const migrated = migrateState(old);
  assert.equal(migrated.version, SAVE_VERSION);
  assert.equal(migrated.bubbles, 123);
  assert.equal(migrated.generators.ocean, 2);
  assert.equal(migrated.pressure, 0);
  assert.deepEqual(Object.keys(migrated.pressureUpgrades), PRESSURE_UPGRADES.map(({ id }) => id));
});

test("owning every generator opens pressure and its four growth paths", () => {
  const state = freshState();
  assert.equal(pressureUnlocked(state), false);
  for (const generator of GENERATORS) state.generators[generator.id] = 1;
  assert.equal(pressureUnlocked(state), true);
  assert.ok(pressurePerSecond(state) > 0);
  const baseProduction = productionPerSecond(state);
  const baseClick = clickValue(state);
  const basePressure = pressurePerSecond(state);
  state.pressureUpgrades.flow = 1;
  assert.equal(productionPerSecond(state), baseProduction * 1.35);
  state.pressureUpgrades.pop = 1;
  assert.equal(clickValue(state), baseClick * 1.75);
  state.pressureUpgrades.compression = 1;
  assert.ok(pressurePerSecond(state) > basePressure * 1.6);
  assert.equal(pressureUpgradeCost(PRESSURE_UPGRADES[0], 2), 16);
});

test("active and idle upgrades visibly increase growth", () => {
  const state = freshState();
  state.generators.wand = 10;
  const base = productionPerSecond(state);
  state.flowLevel = 1;
  assert.equal(productionPerSecond(state), base * FLOW_MULTIPLIER);
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

test("the pressure storage path improves offline bubbles and pressure without extending the cap", () => {
  const start = Date.UTC(2026, 6, 14);
  const base = freshState(start);
  const stored = freshState(start);
  for (const generator of GENERATORS) {
    base.generators[generator.id] = 1;
    stored.generators[generator.id] = 1;
  }
  stored.pressureUpgrades.storage = 1;
  const baseResult = settleOffline(base, start + 3600000);
  const storedResult = settleOffline(stored, start + 3600000);
  assert.equal(storedResult.elapsed, baseResult.elapsed);
  assert.equal(storedResult.earned, baseResult.earned * 1.25);
  assert.equal(storedResult.pressureEarned, baseResult.pressureEarned * 1.25);
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
