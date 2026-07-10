import { db, ref, push, onValue, serverTimestamp } from '../firebase.js';

export class ChatService {
  /**
   * 채팅 메시지 전송
   */
  static async sendMessage(roomCode, playerId, playerName, text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 200) return;

    await push(ref(db, `rooms/${roomCode}/chat`), {
      playerId,
      playerName,
      text: trimmed,
      timestamp: Date.now(),
    });
  }

  /**
   * 채팅 메시지 실시간 감시
   * @returns unsubscribe function
   */
  static onChatChange(roomCode, callback) {
    return onValue(ref(db, `rooms/${roomCode}/chat`), (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        callback([]);
        return;
      }
      const messages = Object.values(data).sort((a, b) => a.timestamp - b.timestamp);
      callback(messages);
    });
  }
}
