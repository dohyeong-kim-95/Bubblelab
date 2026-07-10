// 인원수별 선/악 비율
export const TEAM_COMPOSITION = {
  5:  { good: 3, evil: 2 },
  6:  { good: 4, evil: 2 },
  7:  { good: 4, evil: 3 },
  8:  { good: 5, evil: 3 },
  9:  { good: 6, evil: 3 },
  10: { good: 6, evil: 4 },
};

// 인원수별 미션 팀 인원 (라운드별)
export const MISSION_TEAM_SIZE = {
  5:  [2, 3, 2, 3, 3],
  6:  [2, 3, 4, 3, 4],
  7:  [2, 3, 3, 4, 4],
  8:  [3, 4, 4, 5, 5],
  9:  [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

// 4번째 미션 예외 규칙: 7인 이상에서 실패 2장 필요
export function getRequiredFails(playerCount, missionIndex) {
  if (missionIndex === 3 && playerCount >= 7) return 2;
  return 1;
}

// 역할 정의
export const ROLES = {
  // 선의 세력
  LOYAL_SERVANT: 'loyal_servant',
  MERLIN: 'merlin',
  PERCIVAL: 'percival',
  // 악의 세력
  MINION: 'minion',
  ASSASSIN: 'assassin',
  MORGANA: 'morgana',
  MORDRED: 'mordred',
  OBERON: 'oberon',
};

export const ROLE_INFO = {
  [ROLES.LOYAL_SERVANT]: { name: '충성스러운 기사', team: 'good', description: '특수 능력 없음. 토론과 추론으로 플레이' },
  [ROLES.MERLIN]:        { name: '멀린', team: 'good', description: '악의 세력 전원을 앎 (모드레드 제외). 들키면 암살당함' },
  [ROLES.PERCIVAL]:      { name: '퍼시벌', team: 'good', description: '멀린과 모르가나를 알지만 구분 불가' },
  [ROLES.MINION]:        { name: '모드레드의 하수인', team: 'evil', description: '악의 세력 동료를 앎' },
  [ROLES.ASSASSIN]:      { name: '암살자', team: 'evil', description: '선 진영 3승 시 멀린을 지목할 권한' },
  [ROLES.MORGANA]:       { name: '모르가나', team: 'evil', description: '퍼시벌에게 멀린처럼 보임' },
  [ROLES.MORDRED]:       { name: '모드레드', team: 'evil', description: '멀린에게 보이지 않음' },
  [ROLES.OBERON]:        { name: '오베론', team: 'evil', description: '다른 악의 세력과 서로 모름. 완전한 고립' },
};

// 권장 역할 구성
export const RECOMMENDED_ROLES = {
  5:  { good: [ROLES.MERLIN, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT], evil: [ROLES.ASSASSIN, ROLES.MORGANA] },
  6:  { good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT], evil: [ROLES.ASSASSIN, ROLES.MORGANA] },
  7:  { good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT], evil: [ROLES.ASSASSIN, ROLES.MORGANA, ROLES.MORDRED] },
  8:  { good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT], evil: [ROLES.ASSASSIN, ROLES.MORGANA, ROLES.MORDRED] },
  9:  { good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT], evil: [ROLES.ASSASSIN, ROLES.MORGANA, ROLES.MORDRED] },
  10: { good: [ROLES.MERLIN, ROLES.PERCIVAL, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT, ROLES.LOYAL_SERVANT], evil: [ROLES.ASSASSIN, ROLES.MORGANA, ROLES.MORDRED, ROLES.OBERON] },
};

// 게임 상수
export const MAX_TEAM_REJECTS = 5;
export const MISSIONS_TO_WIN = 3;
export const TOTAL_MISSIONS = 5;
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

// 시간제한 프리셋 (초 단위) — 방장이 선택
export const TIME_LIMIT_PRESETS = [
  { label: '없음', value: 0 },
  { label: '20분', value: 20 * 60 },
  { label: '30분', value: 30 * 60 },
  { label: '40분', value: 40 * 60 },
];

// 페이즈별 시간 배분 비율 (전체 시간에서 각 페이즈가 차지하는 비중)
// 5개 미션 × (팀제안 + 투표 + 미션) + 역할확인 + 암살 기준
// totalSeconds를 기반으로 페이즈별 초를 계산
export function getPhaseTimeLimit(totalSeconds, phase) {
  if (!totalSeconds) return 0;
  switch (phase) {
    case PHASES.ROLE_REVEAL:     return Math.max(15, Math.round(totalSeconds * 0.05));
    case PHASES.TEAM_PROPOSAL:   return Math.max(20, Math.round(totalSeconds * 0.08));
    case PHASES.VOTING:          return Math.max(15, Math.round(totalSeconds * 0.04));
    case PHASES.VOTE_RESULT:     return Math.max(8,  Math.round(totalSeconds * 0.02));
    case PHASES.MISSION:         return Math.max(10, Math.round(totalSeconds * 0.03));
    case PHASES.MISSION_RESULT:  return Math.max(8,  Math.round(totalSeconds * 0.02));
    case PHASES.ASSASSINATION:   return Math.max(30, Math.round(totalSeconds * 0.06));
    default: return 0;
  }
}

// 게임 페이즈
export const PHASES = {
  WAITING: 'waiting',
  ROLE_REVEAL: 'role_reveal',
  TEAM_PROPOSAL: 'team_proposal',
  VOTING: 'voting',
  VOTE_RESULT: 'vote_result',
  MISSION: 'mission',
  MISSION_RESULT: 'mission_result',
  ASSASSINATION: 'assassination',
  RESULT: 'result',
};
