import { TEAM_COMPOSITION, ROLES, ROLE_INFO } from '../config/gameConfig.js';

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class RoleManager {
  /**
   * 역할 배정
   * @param {string[]} playerIds - 플레이어 ID 배열
   * @param {object} roleConfig - { merlin, percival, morgana, mordred, oberon }
   * @returns {object} { [playerId]: { role, team, visibleInfo } }
   */
  static assignRoles(playerIds, roleConfig) {
    const count = playerIds.length;
    const { good: goodCount, evil: evilCount } = TEAM_COMPOSITION[count];

    // 악의 세력 역할 배정
    const evilRoles = [];
    if (roleConfig.merlin) {
      evilRoles.push(ROLES.ASSASSIN);
    }
    if (roleConfig.morgana) {
      evilRoles.push(ROLES.MORGANA);
    }
    if (roleConfig.mordred) {
      evilRoles.push(ROLES.MORDRED);
    }
    if (roleConfig.oberon) {
      evilRoles.push(ROLES.OBERON);
    }
    // 특수 악 역할이 슬롯보다 많으면 초과분 제거 (우선순위: 암살자 > 모르가나 > 모드레드 > 오베론)
    if (evilRoles.length > evilCount) {
      evilRoles.length = evilCount;
    }
    // 남은 악 슬롯을 일반 하수인으로 채움
    while (evilRoles.length < evilCount) {
      evilRoles.push(ROLES.MINION);
    }

    // 선의 세력 역할 배정
    const goodRoles = [];
    if (roleConfig.merlin) {
      goodRoles.push(ROLES.MERLIN);
    }
    if (roleConfig.percival && roleConfig.merlin) {
      goodRoles.push(ROLES.PERCIVAL);
    }
    // 남은 선 슬롯을 충성 기사로 채움
    while (goodRoles.length < goodCount) {
      goodRoles.push(ROLES.LOYAL_SERVANT);
    }

    // 역할 셔플 및 플레이어 매핑
    const allRoles = shuffle([...goodRoles, ...evilRoles]);
    const shuffledPlayerIds = shuffle(playerIds);

    const assignments = {};
    shuffledPlayerIds.forEach((id, index) => {
      assignments[id] = {
        role: allRoles[index],
        team: ROLE_INFO[allRoles[index]].team,
      };
    });

    // 가시성 정보 생성
    return RoleManager.generateVisibleInfo(assignments);
  }

  /**
   * 역할별 공개 정보 생성
   */
  static generateVisibleInfo(assignments) {
    const entries = Object.entries(assignments);

    // 악의 세력 목록 (ID)
    const allEvil = entries.filter(([, a]) => a.team === 'evil').map(([id]) => id);
    // 오베론 제외 악의 세력
    const evilWithoutOberon = entries.filter(([, a]) => a.team === 'evil' && a.role !== ROLES.OBERON).map(([id]) => id);
    // 모드레드 제외 악의 세력 (멀린이 볼 수 있는 목록)
    const evilWithoutMordred = entries.filter(([, a]) => a.team === 'evil' && a.role !== ROLES.MORDRED).map(([id]) => id);

    // 멀린 ID
    const merlinEntry = entries.find(([, a]) => a.role === ROLES.MERLIN);
    // 모르가나 ID
    const morganaEntry = entries.find(([, a]) => a.role === ROLES.MORGANA);

    for (const [id, assignment] of entries) {
      switch (assignment.role) {
        case ROLES.MERLIN:
          // 멀린: 모드레드를 제외한 악의 세력 전원
          assignment.visibleInfo = evilWithoutMordred.map(eid => ({ id: eid, label: 'evil' }));
          break;

        case ROLES.PERCIVAL:
          // 퍼시벌: 멀린 + 모르가나 (구분 불가)
          assignment.visibleInfo = [];
          if (merlinEntry) assignment.visibleInfo.push({ id: merlinEntry[0], label: 'merlin_or_morgana' });
          if (morganaEntry) assignment.visibleInfo.push({ id: morganaEntry[0], label: 'merlin_or_morgana' });
          // 셔플해서 순서로 유추 불가하게
          assignment.visibleInfo = shuffle(assignment.visibleInfo);
          break;

        case ROLES.OBERON:
          // 오베론: 다른 악 모름
          assignment.visibleInfo = [];
          break;

        case ROLES.ASSASSIN:
        case ROLES.MORGANA:
        case ROLES.MORDRED:
        case ROLES.MINION:
          // 악의 세력 (오베론 제외): 오베론을 제외한 악의 동료
          assignment.visibleInfo = evilWithoutOberon
            .filter(eid => eid !== id)
            .map(eid => ({ id: eid, label: 'evil_ally' }));
          break;

        case ROLES.LOYAL_SERVANT:
        default:
          // 충성 기사: 없음
          assignment.visibleInfo = [];
          break;
      }
    }

    return assignments;
  }
}
