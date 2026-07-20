import test from "node:test";
import assert from "node:assert/strict";
import { WorkReviewsDO, fetchStoreReviews } from "./reviews.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
}

test("mock 프로바이더가 리뷰와 문의를 네이버 출처 표시와 함께 반환한다", async () => {
  const result = await fetchStoreReviews({}, "daonfit");
  assert.equal(result.source, "mock");
  assert.ok(result.items.length > 0);
  assert.ok(result.questions.length > 0);

  // 리뷰: 상품 slug·별점·본문 + 네이버 출처
  for (const review of result.items) {
    assert.match(review.product, /^[a-z-]+$/);
    assert.ok(review.rating >= 1 && review.rating <= 5);
    assert.ok(review.text.length > 0);
    assert.equal(review.source, "naver");
  }
  // 문의: 질문·답변 + 네이버 출처
  for (const qna of result.questions) {
    assert.match(qna.product, /^[a-z-]+$/);
    assert.ok(qna.question.length > 0);
    assert.equal(qna.source, "naver");
  }
  assert.ok(result.items.some((r) => r.product === "keybox"));
  assert.ok(result.questions.some((q) => q.product === "keybox"));
});

test("알 수 없는 프로젝트는 빈 리뷰·문의", async () => {
  const result = await fetchStoreReviews({}, "nonexistent");
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.questions, []);
});

test("DO가 리뷰·문의 동기화 결과를 저장하고 그대로 돌려준다", async () => {
  const reviews = new WorkReviewsDO({ storage: new MemoryStorage() });

  let data = await (await reviews.fetch(new Request("https://workreviews.internal/"))).json();
  assert.deepEqual(data.items, []);
  assert.deepEqual(data.questions, []);

  const synced = await fetchStoreReviews({}, "daonfit");
  const put = await reviews.fetch(new Request("https://workreviews.internal/sync", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(synced),
  }));
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.equal(saved.reviews, synced.items.length);
  assert.equal(saved.questions, synced.questions.length);

  data = await (await reviews.fetch(new Request("https://workreviews.internal/"))).json();
  assert.equal(data.items.length, synced.items.length);
  assert.equal(data.questions.length, synced.questions.length);
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
