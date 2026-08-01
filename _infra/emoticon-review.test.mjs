import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewItem, REVIEW_VERDICTS } from "./emoticon-review.js";

const NOW = "2026-08-01T00:00:00.000Z";
const ok = { character: "rabbit", cut: "nod11", verdict: "revise", note: "귀가 세 개" };

test("정상 입력은 id·시각이 붙은 항목이 된다", () => {
  const item = buildReviewItem(ok, NOW);
  assert.equal(item.character, "rabbit");
  assert.equal(item.cut, "nod11");
  assert.equal(item.verdict, "revise");
  assert.equal(item.note, "귀가 세 개");
  assert.equal(item.at, NOW);
  assert.match(item.id, /^[0-9a-f-]{36}$/);
});

test("컷·캐릭터 id는 영소문자·숫자·하이픈만", () => {
  for (const bad of [
    { ...ok, cut: "../etc" }, { ...ok, cut: "" }, { ...ok, character: "Rabbit" },
    { ...ok, character: "a".repeat(65) },
  ]) {
    assert.throws(() => buildReviewItem(bad, NOW), /invalid (cut|character)/);
  }
});

test("판정값은 허용 목록만", () => {
  assert.throws(() => buildReviewItem({ ...ok, verdict: "awesome" }, NOW), /invalid verdict/);
  for (const verdict of REVIEW_VERDICTS) {
    assert.doesNotThrow(() => buildReviewItem({ ...ok, verdict }, NOW));
  }
});

test("판정만 남기는 건 되지만 메모는 내용이 있어야 한다", () => {
  assert.equal(buildReviewItem({ ...ok, verdict: "good", note: "" }, NOW).note, "");
  assert.throws(() => buildReviewItem({ ...ok, verdict: "note", note: "  " }, NOW), /empty note/);
});

test("2000자를 넘는 메모는 거절한다", () => {
  assert.doesNotThrow(() => buildReviewItem({ ...ok, note: "가".repeat(2000) }, NOW));
  assert.throws(() => buildReviewItem({ ...ok, note: "가".repeat(2001) }, NOW), /note too long/);
});
