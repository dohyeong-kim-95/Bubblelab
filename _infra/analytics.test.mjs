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
  async transaction(callback) { return callback(this); }
}

test("counts asset downloads by file and aggregates each card", async () => {
  const analytics = new AnalyticsDO({ storage: new MemoryStorage() });
  const record = (file) => analytics.fetch(new Request("https://analytics.internal/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "music", id: "upward-drift", file }),
  }));

  assert.equal((await record("upward_drift.mp3")).status, 200);
  await record("upward_drift.mp3");
  await record("upward_drift.webp");
  const response = await analytics.fetch(new Request("https://analytics.internal/downloads"));
  assert.deepEqual(await response.json(), {
    files: {
      "music/upward-drift/upward_drift.mp3": 2,
      "music/upward-drift/upward_drift.webp": 1,
    },
    items: { "music/upward-drift": 3 },
    total: 3,
  });
});

test("rejects malformed asset download events", async () => {
  const analytics = new AnalyticsDO({ storage: new MemoryStorage() });
  const response = await analytics.fetch(new Request("https://analytics.internal/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "music", id: "../private", file: "secret" }),
  }));
  assert.equal(response.status, 400);
});

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
      body: JSON.stringify({ visitorId, date: "2026-07-10", page: "slop/circle" }),
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
    top: [{ page: "slop/circle", users: 1 }],
    engagementDays: 30,
    engagement: [],
    generatedAt: "<timestamp>",
  });
  assert.equal(Number.isNaN(Date.parse(stats.generatedAt)), false);
  assert.equal([...storage.data.keys()].filter((key) => key === `seen:2026-07-10:${visitorId}`).length, 1);
});

test("ranks monthly top pages by unique visitors, excluding site homes", async () => {
  const vid = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  const storage = new MemoryStorage([
    // slop/circle: 3명 (한 명은 이틀 방문 — 중복 아님)
    ["pv:2026-07-10:slop/circle:" + vid(1), true],
    ["pv:2026-07-09:slop/circle:" + vid(1), true],
    ["pv:2026-07-09:slop/circle:" + vid(2), true],
    ["pv:2026-06-15:slop/circle:" + vid(3), true],
    // games/avalon: 2명
    ["pv:2026-07-08:games/avalon:" + vid(1), true],
    ["pv:2026-07-08:games/avalon:" + vid(4), true],
    // slop/lotto: 1명, slop/yacht: 1명 (4위는 잘림)
    ["pv:2026-07-07:slop/lotto:" + vid(5), true],
    ["pv:2026-07-07:slop/yacht:" + vid(6), true],
    // 사이트 홈과 30일 밖 방문은 제외
    ["pv:2026-07-10:www:" + vid(1), true],
    ["pv:2026-05-01:slop/trader:" + vid(1), true],
  ]);
  const analytics = new AnalyticsDO({ storage });

  const response = await analytics.fetch(
    new Request("https://analytics.internal/stats?date=2026-07-10"),
  );
  const { top } = await response.json();
  assert.deepEqual(top, [
    { page: "slop/circle", users: 3 },
    { page: "games/avalon", users: 2 },
    { page: "slop/lotto", users: 1 },
  ]);
});

test("serves per-page weekly visitor counts for card sorting", async () => {
  const vid = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  const storage = new MemoryStorage([
    ["pv:2026-07-10:slop/circle:" + vid(1), true],
    ["pv:2026-07-09:slop/circle:" + vid(2), true],
    ["pv:2026-07-07:slop/lotto:" + vid(3), true],
    ["pv:2026-07-10:slop:" + vid(1), true],          // 홈도 그대로 포함
    ["pv:2026-07-01:slop/trader:" + vid(1), true],   // 7일 밖은 제외
  ]);
  const analytics = new AnalyticsDO({ storage });
  const response = await analytics.fetch(
    new Request("https://analytics.internal/pages?date=2026-07-10&days=7"),
  );
  const { pages } = await response.json();
  assert.deepEqual(pages, { "slop/circle": 2, "slop/lotto": 1, "slop": 1 });
});

test("ignores invalid page but still counts the visitor", async () => {
  const storage = new MemoryStorage();
  const analytics = new AnalyticsDO({ storage });
  const visitorId = "00000000-0000-4000-8000-000000000001";
  const response = await analytics.fetch(new Request("https://analytics.internal/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId, date: "2026-07-10", page: "../evil:path" }),
  }));
  assert.equal(response.status, 204);
  const keys = [...storage.data.keys()];
  assert.ok(keys.includes(`seen:2026-07-10:${visitorId}`));
  assert.equal(keys.some((k) => k.startsWith("pv:")), false);
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

test("aggregates active card time without double-counting periodic session reports", async () => {
  const storage = new MemoryStorage();
  const analytics = new AnalyticsDO({ storage });
  const engage = (visitorId, sessionId, activeMs, date = "2026-07-10") =>
    analytics.fetch(new Request("https://analytics.internal/engage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId, date, page: "slop/fruitmerge", sessionId, activeMs }),
    }));

  await engage(
    "00000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000001",
    10_000,
  );
  await engage( // 같은 세션의 최신 누적값으로 덮어쓴다
    "00000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000001",
    15_000,
  );
  await engage(
    "00000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000002",
    25_000,
  );
  await engage( // 선택한 7일 범위 밖
    "00000000-0000-4000-8000-000000000003",
    "30000000-0000-4000-8000-000000000003",
    90_000,
    "2026-07-01",
  );

  const response = await analytics.fetch(
    new Request("https://analytics.internal/stats?date=2026-07-10&days=7"),
  );
  const stats = await response.json();
  assert.equal(stats.engagementDays, 7);
  assert.deepEqual(stats.engagement, [{
    page: "slop/fruitmerge",
    visitors: 2,
    sessions: 2,
    totalMs: 40_000,
    medianMs: 20_000,
    engagedRate: 100,
  }]);
});

test("rejects engagement for a site home or malformed session", async () => {
  const analytics = new AnalyticsDO({ storage: new MemoryStorage() });
  const response = await analytics.fetch(new Request("https://analytics.internal/engage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visitorId: "00000000-0000-4000-8000-000000000001",
      date: "2026-07-10", page: "slop", sessionId: "bad", activeMs: 10_000,
    }),
  }));
  assert.equal(response.status, 400);
});

test("tracks a browser's consecutive Slop visit days", async () => {
  const storage = new MemoryStorage();
  const analytics = new AnalyticsDO({ storage });
  const visitorId = "00000000-0000-4000-8000-000000000001";
  const visit = (date, page = "slop") => analytics.fetch(new Request("https://analytics.internal/track", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId, date, page }),
  }));
  const streak = (date) => analytics.fetch(new Request("https://analytics.internal/streak", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId, date }),
  })).then((response) => response.json());

  await visit("2026-07-08");
  await visit("2026-07-08", "slop/circle"); // 같은 날 중복은 증가하지 않는다
  assert.equal((await streak("2026-07-08")).streak, 1);
  await visit("2026-07-09", "games/avalon"); // Slop 외 방문은 증가시키지 않는다
  assert.equal((await streak("2026-07-09")).streak, 2); // 홈 조회 자체가 오늘 방문을 확정
  assert.equal((await streak("2026-07-09")).streak, 2);
  assert.equal((await streak("2026-07-11")).streak, 1); // 하루를 건너뛰면 다시 1일
  assert.equal(storage.data.has(`streak:${visitorId}`), true); // 날짜 버킷 정리에서 보존
});
