// 오래된 방 정리 규칙 — 방 만들기 전에 RoomService 가 부른다.
// 순수 함수라 scripts/check-room-cleanup.mjs 가 그대로 검사한다.

const THIRTY_MINUTES = 30 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

// 실시간 서버는 update 한 번에 경로 64개까지만 받는다(_infra/realtime.js
// MAX_UPDATE_ENTRIES). 방 하나가 경로 2개(rooms·privateData)라 32개 방씩 나눈다.
// 한 번에 보내면 오래된 방이 33개를 넘는 순간 정리가 영영 실패한다.
export const ROOMS_PER_CLEANUP_UPDATE = 32;

function isBotId(playerId) {
  return playerId.startsWith('bot_');
}

// 사람(봇 제외)이 하나라도 접속해 있는가. 봇은 늘 online: true 라 세지 않는다.
export function hasHumanOnline(room) {
  const players = room?.players || {};
  for (const [playerId, player] of Object.entries(players)) {
    if (isBotId(playerId)) continue;
    if (player?.online) return true;
  }
  return false;
}

/**
 * 이 방을 지워도 되는가.
 *
 * Args:
 *   room: rooms/<코드> 아래 값
 *   now: 지금 시각(ms)
 * Returns:
 *   끝난 방은 만든 지 30분, 그 밖의 방은 2시간이 지났고 접속한 사람이 없으면 true.
 *   시간제한 없는 게임처럼 2시간 넘게 진행 중인 방을 남이 방을 만들 때 지우지 않는다.
 */
export function isStaleRoom(room, now) {
  const age = now - (room?.meta?.createdAt || 0);
  if (room?.meta?.status === 'finished') return age > THIRTY_MINUTES;
  if (age <= TWO_HOURS) return false;
  return !hasHumanOnline(room);
}

/**
 * 지울 방들을 update 묶음으로 나눈다.
 *
 * Returns:
 *   [{ 'rooms/<코드>': null, 'privateData/<코드>': null, ... }, ...] — 묶음마다 경로 64개 이하
 */
export function staleRoomUpdates(rooms, now) {
  const staleCodes = [];
  for (const [code, room] of Object.entries(rooms || {})) {
    if (isStaleRoom(room, now)) staleCodes.push(code);
  }
  const batches = [];
  for (let start = 0; start < staleCodes.length; start += ROOMS_PER_CLEANUP_UPDATE) {
    const updates = {};
    for (const code of staleCodes.slice(start, start + ROOMS_PER_CLEANUP_UPDATE)) {
      updates[`rooms/${code}`] = null;
      updates[`privateData/${code}`] = null;
    }
    batches.push(updates);
  }
  return batches;
}
