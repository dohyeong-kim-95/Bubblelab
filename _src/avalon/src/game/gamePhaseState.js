export function getReadyProgress(playerOrder, readyPlayers) {
  const order = Array.isArray(playerOrder) ? playerOrder : [];
  const ready = readyPlayers || {};
  const readyCount = order.filter(playerId => ready[playerId]).length;

  return {
    total: order.length,
    readyCount,
    allReady: order.length > 0 && readyCount === order.length,
  };
}

export function getOptimisticReadyProgress(playerOrder, readyPlayers, playerId, hasLocalConfirmation = false) {
  const order = Array.isArray(playerOrder) ? playerOrder : [];
  const ready = { ...(readyPlayers || {}) };

  if (hasLocalConfirmation && playerId && order.includes(playerId)) {
    ready[playerId] = true;
  }

  return getReadyProgress(order, ready);
}

export function getReadyStatusLabel(playerOrder, readyPlayers, submittedByPlayerId = null) {
  const progress = getReadyProgress(playerOrder, readyPlayers);
  if (progress.total === 0) {
    return '대기 중 (0/0)';
  }

  if (submittedByPlayerId && readyPlayers?.[submittedByPlayerId]) {
    return `대기 중 (${progress.readyCount}/${progress.total})`;
  }

  return `확인 필요 (${progress.readyCount}/${progress.total})`;
}
