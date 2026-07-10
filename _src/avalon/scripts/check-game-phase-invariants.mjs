import assert from 'node:assert/strict';
import { getOptimisticReadyProgress, getReadyProgress } from '../src/game/gamePhaseState.js';

function testReadyProgressCountsOnlyKnownPlayers() {
  const playerOrder = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const readyPlayers = { p1: true, p3: true, stranger: true };
  const result = getReadyProgress(playerOrder, readyPlayers);

  assert.equal(result.total, 5);
  assert.equal(result.readyCount, 2);
  assert.equal(result.allReady, false);
}

function testReadyProgressDetectsAllReady() {
  const playerOrder = ['p1', 'p2', 'p3'];
  const readyPlayers = { p1: true, p2: true, p3: true };
  const result = getReadyProgress(playerOrder, readyPlayers);

  assert.equal(result.readyCount, 3);
  assert.equal(result.allReady, true);
}

function testEmptyReadyStateIsStable() {
  const result = getReadyProgress([], {});

  assert.equal(result.total, 0);
  assert.equal(result.readyCount, 0);
  assert.equal(result.allReady, false);
}

function testOptimisticReadyProgressIncludesLocalSubmission() {
  const playerOrder = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const result = getOptimisticReadyProgress(playerOrder, {}, 'p1', true);

  assert.equal(result.total, 5);
  assert.equal(result.readyCount, 1);
  assert.equal(result.allReady, false);
}

function run() {
  const tests = [
    testReadyProgressCountsOnlyKnownPlayers,
    testReadyProgressDetectsAllReady,
    testEmptyReadyStateIsStable,
    testOptimisticReadyProgressIncludesLocalSubmission,
  ];

  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }
}

run();
