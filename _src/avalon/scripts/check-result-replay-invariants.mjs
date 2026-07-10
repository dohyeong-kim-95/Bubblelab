import assert from 'node:assert/strict';
import { getResultRouteDecision } from '../src/result/resultState.js';

function testMissingRoomGoesHome() {
  assert.deepEqual(getResultRouteDecision(null), { route: '/' });
}

function testFinishedRoomStaysOnResult() {
  const roomData = {
    meta: { status: 'finished' },
    gameState: { phase: 'result' },
  };

  assert.deepEqual(getResultRouteDecision(roomData), { route: 'result' });
}

function testReplayWaitingRoomReturnsToLobbyEvenWithoutGameState() {
  const roomData = {
    meta: { status: 'waiting' },
    players: {
      host: { name: 'Host' },
      guest: { name: 'Guest' },
    },
  };

  assert.deepEqual(getResultRouteDecision(roomData), { route: 'lobby' });
}

function testBrokenNonWaitingRoomWithoutGameStateGoesHome() {
  const roomData = {
    meta: { status: 'finished' },
    players: {
      host: { name: 'Host' },
    },
  };

  assert.deepEqual(getResultRouteDecision(roomData), { route: '/' });
}

function run() {
  const tests = [
    testMissingRoomGoesHome,
    testFinishedRoomStaysOnResult,
    testReplayWaitingRoomReturnsToLobbyEvenWithoutGameState,
    testBrokenNonWaitingRoomWithoutGameStateGoesHome,
  ];

  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }
}

run();
