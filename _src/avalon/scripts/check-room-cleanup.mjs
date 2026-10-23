import assert from 'node:assert/strict';
import { isStaleRoom, staleRoomUpdates, hasHumanOnline } from '../src/lobby/roomCleanupState.js';

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function room(ageMs, status, players = {}) {
  return { meta: { createdAt: NOW - ageMs, status }, players };
}

// 끝난 방은 30분, 나머지는 2시간
assert.equal(isStaleRoom(room(31 * MINUTE, 'finished'), NOW), true);
assert.equal(isStaleRoom(room(29 * MINUTE, 'finished'), NOW), false);
assert.equal(isStaleRoom(room(119 * MINUTE, 'playing'), NOW), false);
assert.equal(isStaleRoom(room(121 * MINUTE, 'playing'), NOW), true);

// 2시간 넘게 진행 중이어도 사람이 접속해 있으면 남긴다(봇은 세지 않는다)
const longGame = room(5 * HOUR, 'playing', {
  human: { online: true },
  bot_1: { online: true },
});
assert.equal(hasHumanOnline(longGame), true);
assert.equal(isStaleRoom(longGame, NOW), false);
const botsOnly = room(5 * HOUR, 'playing', {
  human: { online: false },
  bot_1: { online: true },
});
assert.equal(isStaleRoom(botsOnly, NOW), true);

// 묶음마다 경로 64개 이하(서버 MAX_UPDATE_ENTRIES)
const rooms = {};
for (let index = 0; index < 70; index += 1) rooms[`R${index}`] = room(3 * HOUR, 'playing');
rooms.FRESH = room(MINUTE, 'waiting');
const batches = staleRoomUpdates(rooms, NOW);
assert.equal(batches.length, 3);
let removedRooms = 0;
for (const batch of batches) {
  assert.ok(Object.keys(batch).length <= 64);
  for (const path of Object.keys(batch)) if (path.startsWith('rooms/')) removedRooms += 1;
}
assert.equal(removedRooms, 70);
assert.equal(batches.flatMap((batch) => Object.keys(batch)).includes('rooms/FRESH'), false);
assert.deepEqual(staleRoomUpdates(null, NOW), []);

console.log('room cleanup invariants: ok');
