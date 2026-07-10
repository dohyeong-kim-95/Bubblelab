import { db, ref, set, get, update, remove, onValue, serverTimestamp } from '../firebase.js';
import { MAX_PLAYERS } from '../config/gameConfig.js';
import { normalizeRoleConfig } from '../lobby/roleConfigState.js';

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function normalizePlayerName(name) {
  return (name || '').trim().toLowerCase();
}

export class RoomService {
  // 방 생성 전 2시간 이상 오래된 방 정리 (누적 방 문제 방지)
  static async _cleanupStaleRooms() {
    try {
      const snapshot = await get(ref(db, 'rooms'));
      if (!snapshot.exists()) return;
      const rooms = snapshot.val();
      const now = Date.now();
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      const updates = {};
      for (const [code, room] of Object.entries(rooms)) {
        const createdAt = room.meta?.createdAt || 0;
        const status = room.meta?.status;
        // 2시간 이상 된 방이거나, 끝난 방 중 30분 이상 된 방 삭제
        if (now - createdAt > TWO_HOURS || (status === 'finished' && now - createdAt > 30 * 60 * 1000)) {
          updates[`rooms/${code}`] = null;
          updates[`privateData/${code}`] = null;
        }
      }
      if (Object.keys(updates).length > 0) {
        await update(ref(db), updates);
      }
    } catch (e) {
      // 정리 실패 무시
    }
  }

  static async createRoom(hostId, hostName) {
    // 오래된 방 정리
    await this._cleanupStaleRooms();

    let roomCode;
    let attempts = 0;

    // 중복 확인 후 방 코드 생성
    do {
      roomCode = generateRoomCode();
      const snapshot = await get(ref(db, `rooms/${roomCode}`));
      if (!snapshot.exists()) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      throw new Error('방 코드 생성에 실패했습니다.');
    }

    const roomData = {
      meta: {
        hostId,
        createdAt: Date.now(),
        status: 'waiting',
        timeLimitSeconds: 30 * 60, // 기본 30분
        voteHistoryEnabled: true,
        voteMode: 'anonymous', // 'anonymous' | 'public'
        roleConfig: {
          merlin: true,
          percival: true,
          morgana: true,
          mordred: false,
          oberon: false,
        },
      },
      players: {
        [hostId]: {
          name: hostName,
          joinedAt: Date.now(),
          online: true,
          order: 0,
        },
      },
    };

    await set(ref(db, `rooms/${roomCode}`), roomData);
    return roomCode;
  }

  static async joinRoom(roomCode, playerId, playerName) {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
      throw new Error('존재하지 않는 방 코드입니다.');
    }

    const roomData = snapshot.val();

    if (roomData.meta.status !== 'waiting') {
      throw new Error('이미 게임이 시작된 방입니다.');
    }

    const players = roomData.players || {};
    const playerCount = Object.keys(players).length;
    const normalizedNewName = normalizePlayerName(playerName);

    const duplicateNameExists = Object.entries(players).some(([id, player]) => (
      id !== playerId && normalizePlayerName(player?.name) === normalizedNewName
    ));
    if (duplicateNameExists) {
      throw new Error('이미 사용 중인 닉네임입니다.');
    }

    // 이미 참가한 플레이어인지 확인
    if (players[playerId]) {
      // 이름 업데이트 후 재입장
      await update(ref(db, `rooms/${roomCode}/players/${playerId}`), {
        name: playerName,
        online: true,
      });
      return;
    }

    if (playerCount >= MAX_PLAYERS) {
      throw new Error('방이 가득 찼습니다. (최대 10명)');
    }

    await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
      name: playerName,
      joinedAt: Date.now(),
      online: true,
      order: playerCount,
    });
  }

  static async leaveRoom(roomCode, playerId) {
    // 자신을 삭제하기 전에 필요한 데이터를 먼저 읽음
    const roomSnap = await get(ref(db, `rooms/${roomCode}`));
    if (!roomSnap.exists()) return;

    const roomData = roomSnap.val();
    const players = roomData.players || {};
    const playerCount = Object.keys(players).length;
    const isHost = roomData.meta?.hostId === playerId;

    if (playerCount <= 1) {
      // 마지막 플레이어 — 방과 privateData 삭제
      if (isHost) {
        await remove(ref(db, `rooms/${roomCode}`));
        await remove(ref(db, `privateData/${roomCode}`));
      } else {
        // 비방장인데 혼자 남은 경우(드묾) — 자기 데이터만 삭제
        await remove(ref(db, `rooms/${roomCode}/players/${playerId}`));
      }
      return;
    }

    // 방장이면 호스트 이전과 플레이어 삭제를 원자적으로 수행
    if (isHost) {
      const remainingIds = Object.keys(players).filter(id => id !== playerId);
      const nextHost = remainingIds[0];
      await update(ref(db), {
        [`rooms/${roomCode}/players/${playerId}`]: null,
        [`rooms/${roomCode}/meta/hostId`]: nextHost,
      });
    } else {
      await remove(ref(db, `rooms/${roomCode}/players/${playerId}`));
    }
  }

  static async updateRoleConfig(roomCode, roleConfig) {
    const room = await this.getRoomData(roomCode);
    const playerCount = Object.keys(room?.players || {}).length;
    await update(ref(db, `rooms/${roomCode}/meta`), {
      roleConfig: normalizeRoleConfig(playerCount, roleConfig),
    });
  }

  static async kickPlayer(roomCode, hostId, playerId) {
    const room = await this.getRoomData(roomCode);
    if (!room) return;
    if (room.meta?.hostId !== hostId) {
      throw new Error('방장만 강제 퇴장시킬 수 있습니다.');
    }
    if (playerId === hostId) {
      throw new Error('방장은 자신을 강제 퇴장시킬 수 없습니다.');
    }
    if (room.meta?.status !== 'waiting') {
      throw new Error('강제 퇴장은 대기실에서만 가능합니다.');
    }

    await update(ref(db), {
      [`rooms/${roomCode}/players/${playerId}`]: null,
      [`rooms/${roomCode}/readyStatus/${playerId}`]: null,
    });
  }

  static async updateTimeLimit(roomCode, timeLimitSeconds) {
    await update(ref(db, `rooms/${roomCode}/meta`), { timeLimitSeconds });
  }

  static async updateVoteHistoryEnabled(roomCode, enabled) {
    await update(ref(db, `rooms/${roomCode}/meta`), { voteHistoryEnabled: enabled });
  }

  static async updateVoteMode(roomCode, voteMode) {
    await update(ref(db, `rooms/${roomCode}/meta`), { voteMode });
  }

  static async getRoomData(roomCode) {
    const snapshot = await get(ref(db, `rooms/${roomCode}`));
    return snapshot.exists() ? snapshot.val() : null;
  }

  static onRoomChange(roomCode, callback) {
    return onValue(ref(db, `rooms/${roomCode}`), (snapshot) => {
      callback(snapshot.val());
    });
  }

  static onPlayersChange(roomCode, callback) {
    return onValue(ref(db, `rooms/${roomCode}/players`), (snapshot) => {
      callback(snapshot.val() || {});
    });
  }

  static onGameStateChange(roomCode, callback) {
    return onValue(ref(db, `rooms/${roomCode}/gameState`), (snapshot) => {
      callback(snapshot.val());
    });
  }

  static async deleteRoom(roomCode) {
    await remove(ref(db, `rooms/${roomCode}`));
    await remove(ref(db, `privateData/${roomCode}`));
  }
}
