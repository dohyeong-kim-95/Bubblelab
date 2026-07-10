export function getNextHostCandidate(players, playerOrder = [], currentHostId) {
  const roster = Array.isArray(playerOrder) && playerOrder.length > 0
    ? playerOrder
    : Object.entries(players || {})
      .sort((a, b) => (a[1]?.order || 0) - (b[1]?.order || 0))
      .map(([id]) => id);

  return roster.find((playerId) => playerId !== currentHostId && players?.[playerId]?.online !== false) || null;
}
