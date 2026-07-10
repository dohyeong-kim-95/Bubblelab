import test from "node:test";
import assert from "node:assert/strict";
import { AnalyticsDO } from "./analytics.js";

class MemoryStorage {
  constructor(entries = []) { this.data = new Map(entries); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key);
  }
  async list({ prefix } = {}) {
    return new Map([...this.data].filter(([key]) => !prefix || key.startsWith(prefix)));
  }
}

test("tracks one browser once per day and calculates rolling uniques", async () => {
  const storage = new MemoryStorage([
    ["seen:2026-07-09:00000000-0000-4000-8000-000000000001", true],
    ["seen:2026-07-04:00000000-0000-4000-8000-000000000002", true],
    ["seen:2026-06-20:00000000-0000-4000-8000-000000000003", true],
  ]);
  const analytics = new AnalyticsDO({ storage });
  const visitorId = "00000000-0000-4000-8000-000000000001";

  for (let i = 0; i < 2; i++) {
    const response = await analytics.fetch(new Request("https://analytics.internal/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId, date: "2026-07-10" }),
    }));
    assert.equal(response.status, 204);
  }

  const response = await analytics.fetch(
    new Request("https://analytics.internal/stats?date=2026-07-10"),
  );
  const stats = await response.json();
  assert.deepEqual({ ...stats, generatedAt: "<timestamp>" }, {
    date: "2026-07-10",
    daily: 1,
    weekly: 2,
    monthly: 3,
    generatedAt: "<timestamp>",
  });
  assert.equal(Number.isNaN(Date.parse(stats.generatedAt)), false);
  assert.equal([...storage.data.keys()].filter((key) => key === `seen:2026-07-10:${visitorId}`).length, 1);
});

test("rejects malformed visitor events", async () => {
  const analytics = new AnalyticsDO({ storage: new MemoryStorage() });
  const response = await analytics.fetch(new Request("https://analytics.internal/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId: "not-an-id", date: "2026-07-10" }),
  }));
  assert.equal(response.status, 400);
});
