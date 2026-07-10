import { db, ref, set, onValue, onDisconnect, get } from '../firebase.js';

export class PlayerService {
  static _disconnectRefs = new Map();

  static setupPresence(roomCode, playerId) {
    const presenceRef = ref(db, `rooms/${roomCode}/players/${playerId}/online`);

    // 연결 해제 시 offline으로 설정
    const disconnectRef = onDisconnect(presenceRef);
    disconnectRef.set(false);
    set(presenceRef, true);

    // 나중에 cancel할 수 있도록 저장
    this._disconnectRefs.set(`${roomCode}_${playerId}`, disconnectRef);
  }

  static async cancelPresence(roomCode, playerId) {
    const key = `${roomCode}_${playerId}`;
    const disconnectRef = this._disconnectRefs.get(key);
    if (disconnectRef) {
      await disconnectRef.cancel();
      this._disconnectRefs.delete(key);
    }
  }

  static onPrivateDataChange(roomCode, playerId, callback) {
    return onValue(ref(db, `privateData/${roomCode}/${playerId}`), (snapshot) => {
      callback(snapshot.val());
    });
  }

  static async getPrivateData(roomCode, playerId) {
    const snapshot = await get(ref(db, `privateData/${roomCode}/${playerId}`));
    return snapshot.exists() ? snapshot.val() : null;
  }

  static async submitVote(roomCode, playerId, vote) {
    await set(ref(db, `rooms/${roomCode}/actions/votes/${playerId}`), {
      vote,
      submittedAt: Date.now(),
    });
  }

  static async submitMissionCard(roomCode, playerId, card) {
    await set(ref(db, `rooms/${roomCode}/actions/missionCards/${playerId}`), {
      card,
      submittedAt: Date.now(),
    });
  }

  static async submitReady(roomCode, playerId) {
    await set(ref(db, `rooms/${roomCode}/actions/readyPlayers/${playerId}`), true);
  }

  static async submitAssassination(roomCode, targetId) {
    await set(ref(db, `rooms/${roomCode}/actions/assassination/targetId`), targetId);
  }
}
