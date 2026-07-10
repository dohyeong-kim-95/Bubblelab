import { db, ref, onValue, remove } from '../firebase.js';
import { ROLES } from '../config/gameConfig.js';

export class AssassinManager {
  /**
   * 암살 단계 초기화
   */
  static async clearAssassination(roomCode) {
    await remove(ref(db, `rooms/${roomCode}/actions/assassination`));
  }

  /**
   * 암살 대상 감시
   */
  static onAssassinationChange(roomCode, callback) {
    return onValue(ref(db, `rooms/${roomCode}/actions/assassination`), (snapshot) => {
      const data = snapshot.val();
      callback(data);
    });
  }

  /**
   * 암살 결과 판정
   * @param {string} targetId - 지목된 플레이어 ID
   * @param {object} assignments - { playerId: { role, team } }
   * @returns { merlinKilled: boolean }
   */
  static judgeAssassination(targetId, assignments) {
    const target = assignments[targetId];
    return {
      validTarget: !!target && target.team === 'good',
      merlinKilled: !!target && target.team === 'good' && target.role === ROLES.MERLIN,
    };
  }
}
