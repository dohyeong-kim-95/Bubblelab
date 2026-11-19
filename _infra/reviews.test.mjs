import test from "node:test";
import assert from "node:assert/strict";
import { WorkReviewsDO, fetchStoreReviews } from "./reviews.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
}

test("mock 프로바이더가 리뷰·문의를 네이버/다온핏 출처 혼합으로 반환한다", async () => {
  const result = await fetchStoreReviews({}, "daonfit");
  assert.equal(result.source, "mock");
  assert.equal(result.version, 2);
  assert.ok(result.items.length > 0);
  assert.ok(result.questions.length > 0);

  // 리뷰: 상품 slug·별점·본문 + 출처(naver/own)
  for (const review of result.items) {
    assert.match(review.product, /^[a-z-]+$/);
    assert.ok(review.rating >= 1 && review.rating <= 5);
    assert.ok(review.text.length > 0);
    assert.ok(["naver", "own"].includes(review.source));
  }
  for (const qna of result.questions) {
    assert.match(qna.product, /^[a-z-]+$/);
    assert.ok(qna.question.length > 0);
    assert.ok(["naver", "own"].includes(qna.source));
  }
  // 네이버 마크 있는 것/없는 것이 섞여 있어야 한다
  assert.ok(result.items.some((r) => r.source === "naver"));
  assert.ok(result.items.some((r) => r.source === "own"));
  assert.ok(result.questions.some((q) => q.source === "naver"));
  assert.ok(result.questions.some((q) => q.source === "own"));
  assert.ok(result.items.some((r) => r.product === "keybox"));
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

test("사용자 후기 작성을 저장하고 동기화에도 보존한다", async () => {
  const reviews = new WorkReviewsDO({ storage: new MemoryStorage() });
  const submit = (payload) => reviews.fetch(new Request("https://workreviews.internal/submit", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));

  let response = await submit({ product: "keybox", nick: "새손님", rating: 4, text: "직접 써보니 좋네요" });
  assert.equal(response.status, 200);
  const item = (await response.json()).item;
  assert.equal(item.product, "keybox");
  assert.equal(item.rating, 4);
  assert.equal(item.source, "own");

  // GET에 submitted로 들어와야 한다
  let data = await (await reviews.fetch(new Request("https://workreviews.internal/"))).json();
  assert.equal(data.submitted.length, 1);
  assert.equal(data.submitted[0].nick, "새손님");

  // 동기화(sync)를 해도 사용자 후기는 보존된다
  const synced = await fetchStoreReviews({}, "daonfit");
  await reviews.fetch(new Request("https://workreviews.internal/sync", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(synced),
  }));
  data = await (await reviews.fetch(new Request("https://workreviews.internal/"))).json();
  assert.equal(data.submitted.length, 1);
  assert.equal(data.items.length, synced.items.length);
});

test("잘못된 후기·payload·메서드를 거부한다", async () => {
  const reviews = new WorkReviewsDO({ storage: new MemoryStorage() });
  const submit = (payload) => reviews.fetch(new Request("https://workreviews.internal/submit", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  assert.equal((await submit({ product: "keybox", nick: "", rating: 5, text: "hi" })).status, 400);
  assert.equal((await submit({ product: "keybox", nick: "a", rating: 5, text: "" })).status, 400);
  assert.equal((await submit({ product: "keybox", nick: "a", rating: 9, text: "hi" })).status, 400);
  assert.equal((await submit({ product: "bad slug!", nick: "a", rating: 5, text: "hi" })).status, 400);

  const bad = await reviews.fetch(new Request("https://workreviews.internal/sync", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(bad.status, 400);
  assert.equal((await reviews.fetch(new Request("https://workreviews.internal/", { method: "DELETE" }))).status, 405);
});
