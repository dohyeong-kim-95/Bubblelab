export function getResultRouteDecision(roomData) {
  if (!roomData) {
    return { route: '/' };
  }

  if (roomData.meta?.status === 'waiting') {
    return { route: 'lobby' };
  }

  if (!roomData.gameState) {
    return { route: '/' };
  }

  return { route: 'result' };
}
