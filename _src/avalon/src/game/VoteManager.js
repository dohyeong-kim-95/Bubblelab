import { db, ref, set, remove, onValue, get } from '../firebase.js';

export class VoteManager {
  /**
   * 투표 시작: votes 초기화
   */
  static async clearVotes(roomCode) {
    await remove(ref(db, `rooms/${roomCode}/actions/votes`));
  }

  /**
   * 투표 수신 감시
   * @returns unsubscribe function
   */
  static onVotesChange(roomCode, playerIds, callback) {
    return onValue(ref(db, `rooms/${roomCode}/actions/votes`), (snapshot) => {
      const votes = snapshot.val() || {};
      const allVoted = playerIds.every(id => votes[id]);
      callback(votes, allVoted);
    });
  }

  /**
   * 투표 집계
   * @param {object} votes - { playerId: { vote: 'approve' | 'reject' } }
   * @returns { approved: boolean, approveCount, rejectCount, details }
   */
  static tallyVotes(votes) {
    let approveCount = 0;
    let rejectCount = 0;

    for (const [, data] of Object.entries(votes)) {
      if (data.vote === 'approve') {
        approveCount++;
      } else {
        rejectCount++;
      }
    }

    return {
      approved: approveCount > rejectCount,
      approveCount,
      rejectCount,
    };
  }
}
