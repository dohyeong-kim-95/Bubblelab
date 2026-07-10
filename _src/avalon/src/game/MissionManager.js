import { db, ref, remove, onValue } from '../firebase.js';
import { judgeMissionCards } from './missionState.js';

export class MissionManager {
  /**
   * 미션 카드 초기화
   */
  static async clearMissionCards(roomCode) {
    await remove(ref(db, `rooms/${roomCode}/actions/missionCards`));
  }

  /**
   * 미션 카드 수신 감시
   */
  static onMissionCardsChange(roomCode, teamMemberIds, callback) {
    return onValue(ref(db, `rooms/${roomCode}/actions/missionCards`), (snapshot) => {
      const cards = snapshot.val() || {};
      const allSubmitted = teamMemberIds.every(id => cards[id]);
      callback(cards, allSubmitted);
    });
  }

  /**
   * 미션 결과 판정
   * @param {object} cards - { playerId: { card: 'success' | 'fail' } }
   * @param {number} playerCount - 전체 플레이어 수
   * @param {number} missionIndex - 0-based 미션 인덱스
   * @returns { success: boolean, successCount, failCount }
   */
  static judgeMission(cards, playerCount, missionIndex) {
    return judgeMissionCards(cards, playerCount, missionIndex);
  }
}
