// _shared/multiplayer-room.js — 방 정리·나가기·방장 이전. 서버(_infra/realtime.js)
// 대신 같은 경로 규칙과 update 상한(64)을 흉내 내는 메모리 트리를 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import { createMultiplayerRooms } from "../../_shared/multiplayer-room.js";

const MAX_UPDATE_ENTRIES = 64; // _infra/realtime.js 와 같은 값

function splitPath(path) {
  return path.split("/").filter((part) => part !== "");
}

function readPath(tree, path) {
  let node = tree;
  for (const part of splitPath(path)) {
    if (node === null || typeof node !== "object") return null;
    node = node[part];
    if (node === undefined) return null;
  }
  return node;
}

function writePath(tree, path, value) {
  const parts = splitPath(path);
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === undefined || node[part] === null || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  const last = parts[parts.length - 1];
  if (value === null) delete node[last];
  else node[last] = structuredClone(value);
}

function fakeRealtime(initial = {}) {
  const tree = structuredClone(initial);
  const updateSizes = [];
  return {
    tree,
    updateSizes,
    async get(path) { return structuredClone(readPath(tree, path)); },
    async set(path, value) { writePath(tree, path, value); },
    async remove(path) { writePath(tree, path, null); },
    async update(base, values) {
      const entries = Object.entries(values);
      if (entries.length > MAX_UPDATE_ENTRIES) throw new Error("update too large");
      updateSizes.push(entries.length);
      for (const [path, value] of entries) writePath(tree, base ? `${base}/${path}` : path, value);
    },
    async onDisconnect() { return async () => {}; },
    subscribe() { return () => {}; },
  };
}

const HOUR = 60 * 60_000;

function staleRooms(count, now) {
  const rooms = {};
  for (let index = 0; index < count; index += 1) {
    rooms[`OLD${String(index).padStart(3, "0")}`] = { meta: { createdAt: now - 5 * HOUR, updatedAt: now - 5 * HOUR, status: "playing" } };
  }
  return rooms;
}

test("cleanupStaleRooms: 오래된 방이 많아도 64항목 이하로 나눠 지운다", async () => {
  const now = Date.now();
  const rooms = staleRooms(40, now);
  rooms.LIVE = { meta: { createdAt: now - 5 * HOUR, updatedAt: now - 60_000, status: "playing" } };
  const realtime = fakeRealtime({ rooms, privateData: { OLD000: { a: 1 } } });
  const lobby = createMultiplayerRooms({ realtime, gameId: "test" });
  await lobby.cleanupStaleRooms(now);
  assert.deepEqual(Object.keys(realtime.tree.rooms), ["LIVE"], "updatedAt 이 최근이면 오래 진행 중이어도 남긴다");
  assert.equal(realtime.tree.privateData.OLD000, undefined);
  assert.ok(realtime.updateSizes.every((size) => size <= MAX_UPDATE_ENTRIES), String(realtime.updateSizes));
  assert.equal(realtime.updateSizes.length, 3);
});

test("cleanupStaleRooms: 끝난 방은 30분, 진행 중인 방은 3시간이 지나야 지운다", async () => {
  const now = Date.now();
  const realtime = fakeRealtime({ rooms: {
    DONE: { meta: { updatedAt: now - 31 * 60_000, status: "finished" } },
    PLAY: { meta: { updatedAt: now - 2 * HOUR, status: "playing" } },
  } });
  await createMultiplayerRooms({ realtime, gameId: "test" }).cleanupStaleRooms(now);
  assert.deepEqual(Object.keys(realtime.tree.rooms), ["PLAY"]);
});

test("createRoom: 정리가 실패해도 방은 만들어진다", async () => {
  const realtime = fakeRealtime({ rooms: staleRooms(3, Date.now()) });
  realtime.update = async () => { throw new Error("update too large"); };
  const lobby = createMultiplayerRooms({ realtime, gameId: "test" });
  const code = await lobby.createRoom("p1", "  하나  ");
  assert.match(code, /^[A-Z]{6}$/);
  assert.equal(realtime.tree.rooms[code].meta.hostId, "p1");
  assert.equal(realtime.tree.rooms[code].players.p1.name, "하나");
});

test("leaveRoom: 방장이 나가면 남은 사람 중 먼저 온 온라인 플레이어가 방장이 된다", async () => {
  const realtime = fakeRealtime({ rooms: { ROOM: {
    meta: { hostId: "host", status: "waiting" },
    players: {
      host: { order: 0, online: true },
      offline: { order: 1, online: false },
      second: { order: 2, online: true },
      third: { order: 3, online: true },
    },
  } } });
  const lobby = createMultiplayerRooms({ realtime, gameId: "test" });
  await lobby.leaveRoom("ROOM", "host");
  assert.equal(realtime.tree.rooms.ROOM.meta.hostId, "second");
  assert.equal(realtime.tree.rooms.ROOM.players.host, undefined);
});

test("leaveRoom: 마지막 사람이 나가면 방과 딸린 경로를 모두 지운다", async () => {
  const realtime = fakeRealtime({
    rooms: { ROOM: { meta: { hostId: "solo" }, players: { solo: { order: 0 } } } },
    privateData: { ROOM: { solo: 1 } }, secrets: { ROOM: 1 }, actions: { ROOM: 1 },
  });
  await createMultiplayerRooms({ realtime, gameId: "test" }).leaveRoom("ROOM", "solo");
  assert.equal(realtime.tree.rooms.ROOM, undefined);
  assert.equal(realtime.tree.privateData.ROOM, undefined);
  assert.equal(realtime.tree.secrets.ROOM, undefined);
  assert.equal(realtime.tree.actions.ROOM, undefined);
});

test("watchHostMigration: 방장이 오프라인이면 다음 차례만 3초 뒤 방장을 넘겨받는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = {
    meta: { hostId: "host" },
    players: { host: { order: 0, online: false }, next: { order: 1, online: true }, later: { order: 2, online: true } },
  };
  const realtime = fakeRealtime({ rooms: { ROOM: room } });
  const lobby = createMultiplayerRooms({ realtime, gameId: "test" });
  lobby.watchHostMigration("ROOM", "later", room);
  lobby.watchHostMigration("ROOM", "next", room);
  lobby.watchHostMigration("ROOM", "next", room); // 같은 사람의 두 번째 호출은 타이머를 늘리지 않는다
  t.mock.timers.tick(3000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(realtime.tree.rooms.ROOM.meta.hostId, "next");
});

test("watchHostMigration: 3초 안에 방장이 돌아오면 넘기지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = {
    meta: { hostId: "host" },
    players: { host: { order: 0, online: false }, next: { order: 1, online: true } },
  };
  const realtime = fakeRealtime({ rooms: { ROOM: room } });
  const lobby = createMultiplayerRooms({ realtime, gameId: "test" });
  lobby.watchHostMigration("ROOM", "next", room);
  realtime.tree.rooms.ROOM.players.host.online = true;
  t.mock.timers.tick(3000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(realtime.tree.rooms.ROOM.meta.hostId, "host");
});
