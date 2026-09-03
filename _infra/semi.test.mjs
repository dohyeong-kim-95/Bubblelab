// life/semi — DRAM 카드의 규칙. 저장·복습 순서·출처 검사만 본다(화면은 e2e 몫).
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  BOX_DAYS, CARD_MAX, MAX_BOX, TOPICS, addCard, byTopic, dueAt, editCard, emptyState,
  gradeCard, isDue, makeCard, nextDueAt, normalizeSource, parseState, removeCard,
  reviewQueue, stats, topicOf,
} = await import("../life/semi/store.js");

const T0 = new Date("2026-09-01T00:00:00Z");
const later = (days) => new Date(T0.getTime() + days * 86_400_000);
const seed = (fields = {}) => addCard(emptyState(), { title: "센스앰프가 하는 일", body: "비트라인의 작은 차이를 키운다", ...fields }, T0);

test("제목과 이해한 내용이 없으면 저장되지 않는다", () => {
  assert.throws(() => makeCard({ title: "", body: "무언가" }), /제목/);
  assert.throws(() => makeCard({ title: "tRCD", body: "  " }), /한 줄/);
});

test("모르는 주제는 첫 주제로 떨어진다", () => {
  assert.equal(makeCard({ topic: "공정", title: "a", body: "b" }, T0).topic, TOPICS[0].id);
  assert.equal(topicOf("없는주제").id, TOPICS[TOPICS.length - 1].id);
});

test("출처는 http(s) 만 통과한다", () => {
  assert.equal(normalizeSource("https://ko.wikipedia.org/wiki/DRAM"), "https://ko.wikipedia.org/wiki/DRAM");
  // 화면에서 누를 수 있는 링크가 되므로 이것들이 새어 들어오면 안 된다.
  assert.equal(normalizeSource("javascript:alert(1)"), "");
  assert.equal(normalizeSource("data:text/html,x"), "");
  assert.equal(normalizeSource("그냥 메모"), "");
  assert.equal(makeCard({ title: "a", body: "b", source: "javascript:alert(1)" }, T0).source, "");
});

test("주제별로 묶이고, 카드가 없는 주제도 자리를 지킨다", () => {
  const state = addCard(seed({ topic: "sense" }), { topic: "refresh", title: "tREFI", body: "64ms" }, T0);
  const groups = byTopic(state.cards);
  assert.equal(groups.length, TOPICS.length);
  assert.deepEqual(groups.map((group) => group.cards.length).reduce((a, b) => a + b), 2);
  assert.equal(groups.find((group) => group.topic.id === "sense").cards.length, 1);
});

/* ── 복습 ───────────────────────────────────────────────────────── */

test("새 카드는 곧바로 복습에 나온다", () => {
  const state = seed();
  assert.equal(dueAt(state.cards[0]), 0);
  assert.equal(reviewQueue(state.cards, T0).length, 1);
});

test("맞히면 칸이 올라가고 그만큼 늦게 돌아온다", () => {
  let state = seed();
  const id = state.cards[0].id;
  state = gradeCard(state, id, true, T0);
  assert.equal(state.cards[0].box, 1);
  assert.equal(reviewQueue(state.cards, T0).length, 0, "오늘은 다시 나오지 않는다");
  assert.equal(reviewQueue(state.cards, later(BOX_DAYS[1])).length, 1);

  state = gradeCard(state, id, true, later(1));
  assert.equal(state.cards[0].box, 2);
  assert.equal(isDue(state.cards[0], later(1 + BOX_DAYS[2] - 0.1)), false);
  assert.equal(isDue(state.cards[0], later(1 + BOX_DAYS[2])), true);
});

test("못 하면 0 칸으로 떨어져 그 자리에서 다시 나온다", () => {
  let state = seed();
  const id = state.cards[0].id;
  state = gradeCard(state, id, true, T0);
  state = gradeCard(state, id, true, later(1));
  state = gradeCard(state, id, false, later(5));
  assert.equal(state.cards[0].box, 0);
  assert.equal(reviewQueue(state.cards, later(5)).length, 1);
});

test("칸은 마지막을 넘지 않는다", () => {
  let state = seed();
  const id = state.cards[0].id;
  for (let i = 0; i < MAX_BOX + 3; i += 1) state = gradeCard(state, id, true, later(i * 30));
  assert.equal(state.cards[0].box, MAX_BOX);
});

test("덜 익은 것부터, 같은 칸이면 오래 안 본 것부터 나온다", () => {
  let state = emptyState();
  state = addCard(state, { title: "익은 것", body: "b" }, T0);
  state = addCard(state, { title: "안 본 것", body: "b" }, T0);
  state = gradeCard(state, state.cards[0].id, true, T0);
  const queue = reviewQueue(state.cards, later(30));
  assert.deepEqual(queue.map((card) => card.title), ["안 본 것", "익은 것"]);
});

test("볼 것이 없으면 다음 시각을 알려 준다", () => {
  assert.equal(nextDueAt([]), null);
  const state = seed();
  const graded = gradeCard(state, state.cards[0].id, true, T0);
  assert.equal(nextDueAt(graded.cards), T0.getTime() + BOX_DAYS[1] * 86_400_000);
});

test("셈은 익은 것과 지금 볼 것을 나눠 센다", () => {
  let state = seed();
  state = addCard(state, { title: "두 번째", body: "b" }, T0);
  const counts = stats(state.cards, T0);
  assert.deepEqual(counts, { total: 2, due: 2, learned: 0 });
});

/* ── 저장 ───────────────────────────────────────────────────────── */

test("고치면 내용만 바뀌고 복습 진행은 남는다", () => {
  let state = seed();
  const id = state.cards[0].id;
  state = gradeCard(state, id, true, T0);
  state = editCard(state, id, { topic: "sense", title: "고친 제목", body: "고친 설명" }, later(1));
  assert.equal(state.cards[0].title, "고친 제목");
  assert.equal(state.cards[0].box, 1, "복습 진행까지 초기화되면 고치기가 벌이 된다");
  assert.equal(state.cards[0].createdAt, T0.toISOString());
});

test("지우면 사라진다", () => {
  const state = seed();
  assert.equal(removeCard(state, state.cards[0].id).cards.length, 0);
  assert.equal(removeCard(state, "없는id").cards.length, 1);
});

test("저장된 것을 다시 읽으면 그대로다", () => {
  const state = seed({ source: "https://example.com/dram" });
  const round = parseState(JSON.stringify(gradeCard(state, state.cards[0].id, true, T0)));
  assert.equal(round.cards.length, 1);
  assert.equal(round.cards[0].source, "https://example.com/dram");
});

test("깨진 저장은 조용히 버린다 — 카드 한 장 때문에 화면이 비지 않는다", () => {
  assert.equal(parseState("{"), null);
  assert.equal(parseState(JSON.stringify({ v: 9, cards: [] })), null);
  const messy = JSON.stringify({
    v: 1,
    cards: [
      { id: "a", topic: "sense", title: "성한 것", body: "b", box: 99, reviewedAt: "언제" },
      { id: "b", topic: "sense", title: "", body: "제목이 없다" },
      null,
    ],
  });
  const parsed = parseState(messy);
  assert.deepEqual(parsed.cards.map((card) => card.title), ["성한 것"]);
  assert.equal(parsed.cards[0].box, MAX_BOX, "상한을 넘은 칸은 상한으로");
  assert.equal(parsed.cards[0].reviewedAt, null, "읽을 수 없는 시각은 안 본 것으로");
});

test("카드 수에는 상한이 있다", () => {
  let state = emptyState();
  state = { ...state, cards: Array.from({ length: CARD_MAX }, (_, i) => makeCard({ title: `q${i}`, body: "b" }, T0)) };
  assert.throws(() => addCard(state, { title: "하나 더", body: "b" }, T0), /500/);
});
