export function getActivePlayerIds(players) {
  return Object.entries(players || {})
    .filter(([id, player]) => id.startsWith('bot_') || player?.online !== false)
    .sort((a, b) => (a[1]?.order || 0) - (b[1]?.order || 0))
    .map(([id]) => id);
}

export function getLobbyReadiness({ players, readyPlayers, hostId, minPlayers, maxPlayers }) {
  const activePlayerIds = getActivePlayerIds(players);
  const count = activePlayerIds.length;
  const hasEnoughPlayers = count >= minPlayers && count <= maxPlayers;
  const nonHostPlayers = activePlayerIds.filter(id => id !== hostId);
  const readyCount = nonHostPlayers.filter(id => id.startsWith('bot_') || readyPlayers?.[id]).length;
  const allReady = nonHostPlayers.every(id => id.startsWith('bot_') || readyPlayers?.[id]);

  return {
    activePlayerIds,
    count,
    hasEnoughPlayers,
    nonHostPlayers,
    readyCount,
    allReady,
    canStart: hasEnoughPlayers && allReady,
  };
}

export function cloneLobbyState(state) {
  return {
    players: structuredClone(state.players || {}),
    readyPlayers: structuredClone(state.readyPlayers || {}),
    hostId: state.hostId,
  };
}

export function applyLobbyEvent(state, event) {
  const next = cloneLobbyState(state);

  switch (event.type) {
    case 'player_ready':
      next.readyPlayers[event.playerId] = true;
      return next;
    case 'player_unready':
      delete next.readyPlayers[event.playerId];
      return next;
    case 'presence_changed':
      if (!next.players[event.playerId]) {
        next.players[event.playerId] = {
          name: event.playerId,
          order: Object.keys(next.players).length,
          online: event.online,
        };
      } else {
        next.players[event.playerId].online = event.online;
      }
      return next;
    case 'room_patch':
      next.players = {
        ...next.players,
        ...(event.players || {}),
      };
      next.readyPlayers = event.readyPlayers
        ? { ...next.readyPlayers, ...event.readyPlayers }
        : next.readyPlayers;
      if (event.hostId) next.hostId = event.hostId;
      return next;
    case 'host_changed':
      next.hostId = event.hostId;
      return next;
    case 'kick_player':
      delete next.players[event.playerId];
      delete next.readyPlayers[event.playerId];
      return next;
    default:
      throw new Error(`Unknown lobby event type: ${event.type}`);
  }
}
