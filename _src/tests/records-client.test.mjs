// _shared/records.js 의 클라이언트 순위 계산. 서버 쪽은 _infra/records.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const SOURCE = readFileSync(new URL("../../_shared/records.js", import.meta.url), "utf8");

// blWeekly 가 없으면 스크립트는 순위 함수만 내놓고 DOM 을 건드리지 않는다.
function loadRanking() {
  const window = {};
  runInNewContext(SOURCE, { window });
  return window.blWeeklyRanking;
}

const ranking = loadRanking();
const board = (...scores) => scores.map((score, index) => ({ nick: `p${index}`, score }));

test("records: beats 는 방향(min/max)을 따르고 비교 대상이 없으면 이긴다", () => {
  assert.equal(ranking.beats("min", 9.5, { score: 10 }), true);
  assert.equal(ranking.beats("min", 10, { score: 10 }), false);
  assert.equal(ranking.beats("max", 11, { score: 10 }), true);
  assert.equal(ranking.beats("max", 9, { score: 10 }), false);
  assert.equal(ranking.beats("max", 0, null), true);
});

test("records: 3위 안에 드는지 — 자리가 비었거나 3위보다 좋아야 한다(동점은 못 든다)", () => {
  assert.equal(ranking.inTop3("max", 1, board(100, 50)), true);
  assert.equal(ranking.inTop3("max", 51, board(100, 80, 50)), true);
  assert.equal(ranking.inTop3("max", 50, board(100, 80, 50)), false);
  assert.equal(ranking.inTop3("min", 3.2, board(3.0, 3.1, 3.3)), true);
});

test("records: 예상 순위는 서버 정렬과 같다(동점이면 먼저 낸 사람 뒤)", () => {
  assert.equal(ranking.expectedRank("max", 120, board(100, 80, 50)), 1);
  assert.equal(ranking.expectedRank("max", 90, board(100, 80, 50)), 2);
  assert.equal(ranking.expectedRank("max", 80, board(100, 80, 50)), 3);
  assert.equal(ranking.expectedRank("min", 2.0, board(3.0)), 1);
  assert.equal(ranking.expectedRank("min", 1.0, []), 1);
});

test("records: 대기 중인 기록은 더 좋은 점수로만 바뀐다(0점도 기록이다)", () => {
  assert.equal(ranking.replacesPending("max", 10, null), true);
  assert.equal(ranking.replacesPending("max", 5, 10), false);
  assert.equal(ranking.replacesPending("max", 11, 10), true);
  assert.equal(ranking.replacesPending("min", 0.5, 0), false);
});
