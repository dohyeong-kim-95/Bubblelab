import test from "node:test";
import assert from "node:assert/strict";
import { WorkReviewsDO, fetchStoreReviews } from "./reviews.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
}

test("mock 프로바이더가 daonfit 리뷰를 상품 slug와 함께 반환한다", async () => {
  const result = await fetchStoreReviews({}, "daonfit");
  assert.equal(result.source, "mock");
  assert.ok(result.items.length > 0);
  // 모든 항목이 상세페이지 slug와 별점을 갖춰야 한다
  for (const review of result.items) {
    assert.match(review.product, /^[a-z-]+$/);
    assert.ok(review.rating >= 1 && review.rating <= 5);
    assert.ok(review.text.length > 0);
  }
  // 상세페이지가 필터할 수 있도록 알려진 상품이 포함되어야 한다
  assert.ok(result.items.some((r) => r.product === "keybox"));
});

test("알 수 없는 프로젝트는 빈 목록", async () => {
  const result = await fetchStoreReviews({}, "nonexistent");
  assert.deepEqual(result.items, []);
});

test("DO가 동기화 결과를 저장하고 그대로 돌려준다", async () => {
  const reviews = new WorkReviewsDO({ storage: new MemoryStorage() });

  // 최초 GET은 빈 캐시
  let data = await (await reviews.fetch(new Request("https://workreviews.internal/"))).json();
  assert.deepEqual(data.items, []);

  const synced = await fetchStoreReviews({}, "daonfit");
  const put = await reviews.fetch(new Request("https://workreviews.internal/sync", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(synced),
  }));
  assert.equal(put.status, 200);
  assert.equal((await put.json()).count, synced.items.length);

  data = await (await reviews.fetch(new Request("https://workreviews.internal/"))).json();
  assert.equal(data.items.length, synced.items.length);
  assert.equal(data.source, "mock");
});

test("잘못된 payload와 메서드를 거부한다", async () => {
  const reviews = new WorkReviewsDO({ storage: new MemoryStorage() });
  const bad = await reviews.fetch(new Request("https://workreviews.internal/sync", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(bad.status, 400);
  assert.equal((await reviews.fetch(new Request("https://workreviews.internal/", { method: "POST" }))).status, 405);
});
