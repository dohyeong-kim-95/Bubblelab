const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

export function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
}

export function makeRoomCode(length = 6, random = Math.random) {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function chooseNextHost(players = {}, currentHostId = "") {
  return Object.entries(players)
    .filter(([id, player]) => id !== currentHostId && player?.online !== false)
    .sort((a, b) => (a[1]?.order ?? 0) - (b[1]?.order ?? 0))[0]?.[0] || null;
}

export class MultiplayerRooms {
  constructor({ realtime, gameId, maxPlayers = 10, minPlayers = 4, codeLength = 6 }) {
    this.rt = realtime;
    this.gameId = gameId;
    this.maxPlayers = maxPlayers;
    this.minPlayers = minPlayers;
    this.codeLength = codeLength;
    this.presenceCancels = new Map();
    this.hostTimers = new Map();
  }

  playerId() {
    const key = `${this.gameId}_player_id`;
    let id = localStorage.getItem(key);
    if (!id) {
      id = `u_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  playerName() { return localStorage.getItem(`${this.gameId}_player_name`) || ""; }
  savePlayerName(name) { localStorage.setItem(`${this.gameId}_player_name`, normalizeName(name)); }
  roomPath(code, tail = "") { return `rooms/${normalizeRoomCode(code)}${tail ? `/${tail}` : ""}`; }

  async cleanupStaleRooms(now = Date.now()) {
    const rooms = await this.rt.get("rooms").catch(() => null);
    if (!rooms) return;
    const updates = {};
    for (const [code, room] of Object.entries(rooms)) {
      const touched = room?.meta?.updatedAt || room?.meta?.createdAt || 0;
      const maxAge = room?.meta?.status === "finished" ? 30 * 60_000 : 3 * 60 * 60_000;
      if (now - touched > maxAge) {
        updates[`rooms/${code}`] = null;
        updates[`privateData/${code}`] = null;
        updates[`secrets/${code}`] = null;
        updates[`actions/${code}`] = null;
      }
    }
    if (Object.keys(updates).length) await this.rt.update("", updates);
  }

  async createRoom(playerId, name, config = {}) {
    await this.cleanupStaleRooms();
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = makeRoomCode(this.codeLength);
      if (await this.rt.get(this.roomPath(code))) continue;
      const now = Date.now();
      await this.rt.set(this.roomPath(code), {
        meta: { hostId: playerId, createdAt: now, updatedAt: now, status: "waiting", config },
        players: { [playerId]: { name: normalizeName(name), joinedAt: now, online: true, order: 0 } },
      });
      return code;
    }
    throw new Error("방 코드를 만들지 못했습니다.");
  }

  async joinRoom(code, playerId, name) {
    code = normalizeRoomCode(code);
    const room = await this.rt.get(this.roomPath(code));
    if (!room) throw new Error("존재하지 않는 방입니다.");
    const players = room.players || {}, normalized = normalizeName(name).toLowerCase();
    if (Object.entries(players).some(([id, player]) => id !== playerId && normalizeName(player?.name).toLowerCase() === normalized)) {
      throw new Error("이미 사용 중인 닉네임입니다.");
    }
    if (!players[playerId] && room.meta?.status !== "waiting") throw new Error("이미 게임이 시작된 방입니다.");
    if (!players[playerId] && Object.keys(players).length >= this.maxPlayers) throw new Error(`방이 가득 찼습니다. (최대 ${this.maxPlayers}명)`);
    const order = players[playerId]?.order ?? Object.keys(players).length;
    await this.rt.update(this.roomPath(code, `players/${playerId}`), {
      name: normalizeName(name), joinedAt: players[playerId]?.joinedAt || Date.now(), online: true, order,
    });
    await this.touch(code);
    return room;
  }

  async touch(code) { await this.rt.update(this.roomPath(code, "meta"), { updatedAt: Date.now() }); }
  getRoom(code) { return this.rt.get(this.roomPath(code)); }
  subscribeRoom(code, callback) { return this.rt.subscribe(this.roomPath(code), callback); }

  async setupPresence(code, playerId) {
    const key = `${code}:${playerId}`;
    await this.presenceCancels.get(key)?.();
    const path = this.roomPath(code, `players/${playerId}/online`);
    const cancel = await this.rt.onDisconnect(path, false);
    this.presenceCancels.set(key, cancel);
    await this.rt.set(path, true);
  }

  async cancelPresence(code, playerId) {
    const key = `${code}:${playerId}`, cancel = this.presenceCancels.get(key);
    if (cancel) { await cancel().catch(() => {}); this.presenceCancels.delete(key); }
  }

  async leaveRoom(code, playerId) {
    const room = await this.getRoom(code);
    if (!room) return;
    await this.cancelPresence(code, playerId);
    const players = room.players || {}, ids = Object.keys(players);
    if (ids.length <= 1) {
      await this.rt.update("", {
        [this.roomPath(code)]: null, [`privateData/${code}`]: null,
        [`secrets/${code}`]: null, [`actions/${code}`]: null,
      });
      return;
    }
    const updates = { [this.roomPath(code, `players/${playerId}`)]: null };
    if (room.meta?.hostId === playerId) updates[this.roomPath(code, "meta/hostId")] = chooseNextHost(players, playerId);
    await this.rt.update("", updates);
  }

  async kickPlayer(code, hostId, targetId) {
    const room = await this.getRoom(code);
    if (room?.meta?.hostId !== hostId) throw new Error("방장만 내보낼 수 있습니다.");
    if (room.meta?.status !== "waiting") throw new Error("대기실에서만 내보낼 수 있습니다.");
    if (hostId === targetId) throw new Error("방장은 자신을 내보낼 수 없습니다.");
    await this.rt.remove(this.roomPath(code, `players/${targetId}`));
    await this.touch(code);
  }

  watchHostMigration(code, playerId, room) {
    const key = `${code}:${playerId}`;
    const hostId = room?.meta?.hostId;
    if (!hostId || room?.players?.[hostId]?.online !== false || chooseNextHost(room.players, hostId) !== playerId) {
      clearTimeout(this.hostTimers.get(key)); this.hostTimers.delete(key); return;
    }
    if (this.hostTimers.has(key)) return;
    this.hostTimers.set(key, setTimeout(async () => {
      try {
        const latest = await this.getRoom(code);
        const oldHost = latest?.meta?.hostId;
        if (latest?.players?.[oldHost]?.online === false && chooseNextHost(latest.players, oldHost) === playerId) {
          await this.rt.set(this.roomPath(code, "meta/hostId"), playerId);
        }
      } finally { this.hostTimers.delete(key); }
    }, 3000));
  }
}

export const createMultiplayerRooms = (options) => new MultiplayerRooms(options);
