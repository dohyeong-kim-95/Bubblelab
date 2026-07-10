import { getRequiredFails } from '../config/gameConfig.js';

export function judgeMissionCards(cards, playerCount, missionIndex) {
  let successCount = 0;
  let failCount = 0;

  for (const data of Object.values(cards || {})) {
    if (data.card === 'success') {
      successCount++;
    } else {
      failCount++;
    }
  }

  const requiredFails = getRequiredFails(playerCount, missionIndex);
  const success = failCount < requiredFails;

  return { success, successCount, failCount };
}
