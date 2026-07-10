import assert from 'node:assert/strict';
import { applyLobbyEvent, getActivePlayerIds, getLobbyReadiness } from '../src/lobby/lobbyState.js';
import { normalizeRoleConfig } from '../src/lobby/roleConfigState.js';
import { getNextHostCandidate } from '../src/game/hostMigrationState.js';

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

function createLobbyState() {
  return {
    hostId: 'host',
    players: {
      host: { name: 'Host', order: 0, online: true },
      guest_1: { name: 'Guest 1', order: 1, online: true },
      guest_2: { name: 'Guest 2', order: 2, online: true },
      guest_3: { name: 'Guest 3', order: 3, online: true },
      guest_4: { name: 'Guest 4', order: 4, online: true },
    },
    readyPlayers: {},
  };
}

function compute(state) {
  return getLobbyReadiness({
    players: state.players,
    readyPlayers: state.readyPlayers,
    hostId: state.hostId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
  });
}

function testReadyPersistsAcrossPresenceChanges() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_1' });

  assert.equal(state.readyPlayers.guest_1, true, 'guest_1 should become ready');

  state = applyLobbyEvent(state, { type: 'presence_changed', playerId: 'guest_1', online: false });
  assert.equal(state.readyPlayers.guest_1, true, 'guest_1 ready should survive offline transition');

  state = applyLobbyEvent(state, { type: 'presence_changed', playerId: 'guest_1', online: true });
  assert.equal(state.readyPlayers.guest_1, true, 'guest_1 ready should survive reconnect');
}

function testUnrelatedRoomPatchDoesNotClearReady() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_2' });
  state = applyLobbyEvent(state, {
    type: 'room_patch',
    players: {
      guest_3: { ...state.players.guest_3, online: true, name: 'Guest 3 renamed' },
    },
  });

  assert.equal(state.readyPlayers.guest_2, true, 'room patches must not wipe readyPlayers');
}

function testHostIsExcludedFromReadyRequirement() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_1' });
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_2' });
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_3' });
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_4' });

  const result = compute(state);
  assert.equal(result.allReady, true, 'all non-host players should be ready');
  assert.equal(result.canStart, true, 'host readiness should not be required');
}

function testOfflineGuestStopsBlockingStart() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_1' });
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_2' });
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_3' });

  let result = compute(state);
  assert.equal(result.canStart, false, 'unready online guest should block start');

  state = applyLobbyEvent(state, { type: 'presence_changed', playerId: 'guest_4', online: false });
  result = compute(state);
  assert.equal(result.canStart, false, 'falling below min players should still block start');

  state = applyLobbyEvent(state, {
    type: 'room_patch',
    players: {
      bot_1: { name: 'Bot 1', order: 100, online: true },
    },
  });
  result = compute(state);
  assert.equal(result.canStart, true, 'bot should count as active and auto-ready');
}

function testHostMigrationRecomputesRequirement() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_2' });
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_3' });
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_4' });
  state = applyLobbyEvent(state, { type: 'host_changed', hostId: 'guest_1' });

  const result = compute(state);
  assert.equal(result.nonHostPlayers.includes('host'), true, 'former host should now require ready');
  assert.equal(result.canStart, false, 'host migration should recompute ready requirements');

  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'host' });
  assert.equal(compute(state).canStart, true, 'start should unlock once new non-host set is ready');
}

function testReplayStyleBotResetDoesNotAccumulateBots() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, {
    type: 'room_patch',
    players: {
      bot_1: { name: 'Bot 1', order: 100, online: true },
      bot_2: { name: 'Bot 2', order: 101, online: true },
      bot_3: { name: 'Bot 3', order: 102, online: true },
      bot_4: { name: 'Bot 4', order: 103, online: true },
    },
  });

  assert.equal(compute(state).count, 9, 'existing replay bots should be visible exactly once');

  delete state.players.bot_1;
  delete state.players.bot_2;
  delete state.players.bot_3;
  delete state.players.bot_4;

  assert.equal(compute(state).count, 5, 'reset flow should remove old bots before the next lobby round');
}

function testBotRemovalReturnsLobbyToHumanPlayersOnly() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, {
    type: 'room_patch',
    players: {
      bot_1: { name: 'Bot 1', order: 100, online: true },
    },
  });

  assert.equal(compute(state).count, 6, 'added bot should increase lobby size');

  delete state.players.bot_1;
  assert.equal(compute(state).count, 5, 'removing a bot should restore the human-only lobby count');
}

function testFivePlayerRoleConfigCapsEvilSpecialRoles() {
  const normalized = normalizeRoleConfig(5, {
    merlin: true,
    percival: true,
    morgana: true,
    mordred: true,
    oberon: true,
  });

  const selectedEvilSpecials = [normalized.morgana, normalized.mordred, normalized.oberon]
    .filter(Boolean)
    .length;

  assert.equal(selectedEvilSpecials, 1, '5-player setup should allow only one optional evil special role');
  assert.equal(normalized.merlin, true, 'merlin should stay required');
}

function testStartUsesOnlyActivePlayers() {
  const state = createLobbyState();
  state.players.guest_4.online = false;

  const activeIds = getActivePlayerIds(state.players);

  assert.deepEqual(activeIds, ['host', 'guest_1', 'guest_2', 'guest_3'], 'offline players should be excluded from active start roster');
}

function testKickPlayerRemovesPlayerAndReadyState() {
  let state = createLobbyState();
  state = applyLobbyEvent(state, { type: 'player_ready', playerId: 'guest_2' });
  state = applyLobbyEvent(state, { type: 'kick_player', playerId: 'guest_2' });

  assert.equal(state.players.guest_2, undefined, 'kicked player should be removed from players');
  assert.equal(state.readyPlayers.guest_2, undefined, 'kicked player ready state should also be removed');
}

function testHostMigrationCandidateSkipsOfflinePlayers() {
  const state = createLobbyState();
  state.players.host.online = false;
  state.players.guest_1.online = false;

  const candidate = getNextHostCandidate(state.players, ['host', 'guest_1', 'guest_2', 'guest_3', 'guest_4'], 'host');

  assert.equal(candidate, 'guest_2', 'host migration should choose the next online player in player order');
}

function run() {
  const tests = [
    testReadyPersistsAcrossPresenceChanges,
    testUnrelatedRoomPatchDoesNotClearReady,
    testHostIsExcludedFromReadyRequirement,
    testOfflineGuestStopsBlockingStart,
    testHostMigrationRecomputesRequirement,
    testReplayStyleBotResetDoesNotAccumulateBots,
    testBotRemovalReturnsLobbyToHumanPlayersOnly,
    testFivePlayerRoleConfigCapsEvilSpecialRoles,
    testStartUsesOnlyActivePlayers,
    testKickPlayerRemovesPlayerAndReadyState,
    testHostMigrationCandidateSkipsOfflinePlayers,
  ];

  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }
}

run();
