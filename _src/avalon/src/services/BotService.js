import { db, ref, set, get, onValue, remove } from '../firebase.js';
import { MISSION_TEAM_SIZE } from '../config/gameConfig.js';

const BOT_NAMES = ['기사 아서', '란슬롯', '가웨인', '트리스탄', '갈라해드', '케이', '보스', '엘레인', '모건'];

/**
 * 봇 플레이어 서비스
 *
 * 호스트 클라이언트에서 실행되며, 방에 추가된 bot_* 플레이어의 행동을 자동으로 수행합니다.
 */
export class BotService {
  static _botIds = [];
  static _unsubscriber = null;
  static _lastStateKey = null;

  // 전략 메모리: 미션별 결과와 참여자 기록
  static _memory = {
    missionHistory: [],  // [{ members: [...], success: bool, failCount: number }]
    suspicion: {},       // { playerId: number } — 의심 점수 (양수=의심, 음수=신뢰)
    voteHistory: [],     // [{ proposal: [...], votes: { playerId: 'approve'|'reject' } }]
  };

  static getBotIdsFromPlayers(players) {
    return Object.keys(players || {}).filter(id => id.startsWith('bot_'));
  }

  static _pickBotNames(players, count) {
    const usedNames = new Set(
      Object.values(players || {})
        .map(player => player?.name)
        .filter(Boolean)
    );
    const selectedNames = [];

    for (const baseName of BOT_NAMES) {
      if (selectedNames.length >= count) break;
      if (!usedNames.has(baseName)) {
        selectedNames.push(baseName);
        usedNames.add(baseName);
      }
    }

    let suffix = 1;
    while (selectedNames.length < count) {
      const candidate = `봇 ${suffix}`;
      if (!usedNames.has(candidate)) {
        selectedNames.push(candidate);
        usedNames.add(candidate);
      }
      suffix += 1;
    }

    return selectedNames;
  }

  /** 봇 플레이어 추가 */
  static async addBots(roomCode, count = 1) {
    const roomSnap = await get(ref(db, `rooms/${roomCode}/players`));
    const players = roomSnap.exists() ? roomSnap.val() : {};
    const selectedNames = this._pickBotNames(players, count);
    const botIds = [];

    for (let i = 0; i < count; i++) {
      const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      botIds.push(botId);
      await set(ref(db, `rooms/${roomCode}/players/${botId}`), {
        name: selectedNames[i],
        online: true,
        joinedAt: Date.now() + i,
        order: 100 + i,
      });
    }

    this._botIds = [...this._botIds, ...botIds];
    return botIds;
  }

  /** 봇 플레이어 제거 */
  static async removeBots(roomCode, botIds = this._botIds) {
    for (const botId of botIds) {
      await remove(ref(db, `rooms/${roomCode}/players/${botId}`));
    }
    this._botIds = this._botIds.filter(id => !botIds.includes(id));
  }

  static async removeAllBotsFromPlayers(roomCode, players) {
    const botIds = this.getBotIdsFromPlayers(players);
    if (botIds.length === 0) return;
    await this.removeBots(roomCode, botIds);
  }

  /** 게임 시작 후 봇 행동 감시 시작 */
  static startListening(roomCode, botIds) {
    this.stopListening();
    this._botIds = botIds;
    this._lastStateKey = null;
    this._memory = { missionHistory: [], suspicion: {}, voteHistory: [] };

    this._unsubscriber = onValue(ref(db, `rooms/${roomCode}/gameState`), (snapshot) => {
      const state = snapshot.val();
      if (!state || !state.phase) return;

      const stateKey = `${state.phase}_m${state.currentMission}_l${state.currentLeaderIndex}`;
      if (stateKey === this._lastStateKey) return;
      this._lastStateKey = stateKey;

      this._act(roomCode, state).catch(e => {
        console.error('[BotService] 봇 행동 오류:', e);
      });
    });
  }

  static stopListening() {
    if (this._unsubscriber) {
      this._unsubscriber();
      this._unsubscriber = null;
    }
    this._lastStateKey = null;
  }

  static syncBotIds(botIds) {
    this._botIds = [...botIds];
  }

  // ======================
  // 페이즈별 행동
  // ======================

  static async _act(roomCode, state) {
    const botPrivateData = {};
    for (const botId of this._botIds) {
      const snap = await get(ref(db, `privateData/${roomCode}/${botId}`));
      if (snap.exists()) botPrivateData[botId] = snap.val();
    }

    switch (state.phase) {
      case 'role_reveal':
        await this._submitReadyAll(roomCode);
        break;
      case 'team_proposal':
        await this._handleTeamProposal(roomCode, state, botPrivateData);
        break;
      case 'voting':
        await this._handleVoting(roomCode, state, botPrivateData);
        break;
      case 'vote_result':
        // 투표 기록 저장 후 ready
        await this._recordVoteResult(roomCode, state);
        await this._submitReadyAll(roomCode);
        break;
      case 'mission':
        await this._handleMission(roomCode, state, botPrivateData);
        break;
      case 'mission_result':
        this._recordMissionResult(state);
        await this._submitReadyAll(roomCode);
        break;
      case 'assassination':
        await this._handleAssassination(roomCode, state, botPrivateData);
        break;
    }
  }

  // ======================
  // 전략적 팀 제안
  // ======================

  static async _handleTeamProposal(roomCode, state, botPrivateData) {
    const leaderId = state.playerOrder[state.currentLeaderIndex];
    if (!this._botIds.includes(leaderId)) return;

    await this._delay(1200, 2500);

    const pd = botPrivateData[leaderId];
    const playerCount = state.playerOrder.length;
    const missionIndex = state.currentMission;
    const requiredSize = MISSION_TEAM_SIZE[playerCount][missionIndex];

    let team;
    if (pd?.team === 'evil') {
      team = this._proposeAsEvil(leaderId, pd, state, requiredSize);
    } else {
      team = this._proposeAsGood(leaderId, state, requiredSize);
    }

    await set(ref(db, `rooms/${roomCode}/actions/teamProposal`), {
      leaderId,
      members: team,
    });
  }

  /** 선 봇의 팀 제안: 의심 점수가 낮은(신뢰하는) 플레이어 우선 */
  static _proposeAsGood(leaderId, state, requiredSize) {
    const team = [leaderId];
    const candidates = state.playerOrder
      .filter(id => id !== leaderId)
      .map(id => ({ id, suspicion: this._memory.suspicion[id] || 0 }))
      .sort((a, b) => a.suspicion - b.suspicion); // 의심 낮은 순

    for (const c of candidates) {
      if (team.length >= requiredSize) break;
      team.push(c.id);
    }
    return team;
  }

  /** 악 봇의 팀 제안: 아군 1명 포함 + 나머지 랜덤 */
  static _proposeAsEvil(leaderId, pd, state, requiredSize) {
    const team = [leaderId];
    const evilAllies = (pd.visibleInfo || [])
      .filter(v => v.label === 'evil_ally')
      .map(v => v.id);

    // 아군 1명 포함 (너무 많으면 의심받음)
    const shuffledAllies = this._shuffle(evilAllies);
    if (shuffledAllies.length > 0 && team.length < requiredSize) {
      team.push(shuffledAllies[0]);
    }

    // 나머지 랜덤 채우기
    const remaining = this._shuffle(
      state.playerOrder.filter(id => !team.includes(id))
    );
    for (const id of remaining) {
      if (team.length >= requiredSize) break;
      team.push(id);
    }
    return team;
  }

  // ======================
  // 전략적 투표
  // ======================

  static async _handleVoting(roomCode, state, botPrivateData) {
    await this._delay(800, 2000);
    const proposal = state.teamProposal;
    const members = proposal?.members || [];

    for (const botId of this._botIds) {
      const pd = botPrivateData[botId];
      let vote;

      if (pd?.team === 'evil') {
        vote = this._voteAsEvil(botId, pd, members, state);
      } else {
        vote = this._voteAsGood(botId, members, state);
      }

      await set(ref(db, `rooms/${roomCode}/actions/votes/${botId}`), {
        vote,
        submittedAt: Date.now(),
      });
      await this._delay(200, 600);
    }
  }

  /** 선 봇 투표 전략 */
  static _voteAsGood(botId, members, state) {
    let approveChance = 0.5;

    // 자신이 팀에 포함되면 찬성 경향 증가
    if (members.includes(botId)) {
      approveChance += 0.25;
    }

    // 의심 플레이어가 팀에 있으면 반대 경향
    const suspiciousOnTeam = members.filter(
      id => (this._memory.suspicion[id] || 0) >= 2
    ).length;
    approveChance -= suspiciousOnTeam * 0.2;

    // 누적 거부 임박 시(4번째) 찬성 경향 급증 (게임 패배 방지)
    if ((state.totalRejects || 0) >= 3) {
      approveChance += 0.35;
    }

    return Math.random() < Math.max(0.1, Math.min(0.95, approveChance)) ? 'approve' : 'reject';
  }

  /** 악 봇 투표 전략 */
  static _voteAsEvil(botId, pd, members, state) {
    const evilAllies = (pd.visibleInfo || [])
      .filter(v => v.label === 'evil_ally')
      .map(v => v.id);
    const allEvil = [botId, ...evilAllies];

    let approveChance = 0.4;

    // 악 세력이 팀에 포함되면 찬성
    const evilOnTeam = members.filter(id => allEvil.includes(id)).length;
    if (evilOnTeam > 0) {
      approveChance += 0.35;
    }

    // 악 세력이 하나도 없으면 반대
    if (evilOnTeam === 0) {
      approveChance -= 0.25;
    }

    // 누적 거부 임박 시 — 악이라도 승인 (단, 선이 이기는 걸 막으려면 신중)
    if ((state.totalRejects || 0) >= 3) {
      approveChance += 0.2;
    }

    return Math.random() < Math.max(0.1, Math.min(0.9, approveChance)) ? 'approve' : 'reject';
  }

  // ======================
  // 전략적 미션
  // ======================

  static async _handleMission(roomCode, state, botPrivateData) {
    const teamMembers = state.teamProposal?.members || [];
    const botTeamMembers = teamMembers.filter(id => this._botIds.includes(id));
    if (botTeamMembers.length === 0) return;

    await this._delay(1000, 2500);

    for (const botId of botTeamMembers) {
      const pd = botPrivateData[botId];
      let card;

      if (pd?.team === 'good') {
        card = 'success'; // 선은 항상 성공
      } else {
        card = this._missionCardAsEvil(botId, pd, state, teamMembers);
      }

      await set(ref(db, `rooms/${roomCode}/actions/missionCards/${botId}`), {
        card,
        submittedAt: Date.now(),
      });
      await this._delay(200, 500);
    }
  }

  /** 악 봇 미션 카드 전략 (각 봇이 독립적으로 판단) */
  static _missionCardAsEvil(botId, pd, state, teamMembers) {
    const missionIndex = state.currentMission;
    const results = state.missionResults || [];
    const successCount = results.filter(r => r === 'success').length;
    const failCount = results.filter(r => r === 'fail').length;

    // 첫 미션은 성공으로 신뢰 구축
    if (missionIndex === 0) {
      return 'success';
    }

    // 선이 2승이면 반드시 fail (패배 직전)
    if (successCount >= 2) {
      return 'fail';
    }

    // 악이 2승이면 여유 — 성공으로 위장해도 됨
    if (failCount >= 2) {
      return Math.random() < 0.6 ? 'success' : 'fail';
    }

    // 기본: 75% 확률로 fail
    return Math.random() < 0.75 ? 'fail' : 'success';
  }

  // ======================
  // 전략적 암살
  // ======================

  static async _handleAssassination(roomCode, state, botPrivateData) {
    const assassinBot = this._botIds.find(id => botPrivateData[id]?.role === 'assassin');
    if (!assassinBot) return;

    const targets = botPrivateData[assassinBot]?.assassinTargets || [];
    if (targets.length === 0) return;

    await this._delay(2000, 4000);

    // 투표 패턴으로 멀린 추론
    const targetId = this._deduceMerlin(assassinBot, botPrivateData[assassinBot], targets);
    await set(ref(db, `rooms/${roomCode}/actions/assassination/targetId`), targetId);
  }

  /**
   * 멀린 추론: 악 세력이 포함된 팀에 반대한 횟수가 높은 플레이어
   * (멀린은 악을 알고 있으므로 악이 포함된 팀에 반대하는 경향)
   */
  static _deduceMerlin(assassinId, pd, goodTargets) {
    const evilAllies = (pd.visibleInfo || [])
      .filter(v => v.label === 'evil_ally')
      .map(v => v.id);
    const allEvil = [assassinId, ...evilAllies];

    // 투표 기록에서 악 세력이 포함된 팀에 대한 각 선 플레이어의 반대 비율 계산
    const rejectRatio = {};
    for (const targetId of goodTargets) {
      let evilTeamVotes = 0;
      let evilTeamRejects = 0;

      for (const record of this._memory.voteHistory) {
        const hasEvil = record.proposal.some(id => allEvil.includes(id));
        if (hasEvil && record.votes[targetId]) {
          evilTeamVotes++;
          if (record.votes[targetId] === 'reject') {
            evilTeamRejects++;
          }
        }
      }

      rejectRatio[targetId] = evilTeamVotes > 0
        ? evilTeamRejects / evilTeamVotes
        : 0;
    }

    // 반대 비율이 가장 높은 플레이어 = 멀린 후보
    const sorted = goodTargets
      .map(id => ({ id, ratio: rejectRatio[id] }))
      .sort((a, b) => b.ratio - a.ratio);

    // 가장 의심되는 플레이어 선택 (동점이면 랜덤)
    if (sorted.length > 0 && sorted[0].ratio > 0) {
      const topRatio = sorted[0].ratio;
      const topCandidates = sorted.filter(s => s.ratio === topRatio);
      return topCandidates[Math.floor(Math.random() * topCandidates.length)].id;
    }

    // 기록 없으면 랜덤
    return goodTargets[Math.floor(Math.random() * goodTargets.length)];
  }

  // ======================
  // 메모리 기록
  // ======================

  /** 투표 결과를 메모리에 저장 */
  static async _recordVoteResult(roomCode, state) {
    const voteResult = state.voteResult;
    if (!voteResult) return;

    const proposal = state.teamProposal?.members || [];

    // 개별 투표 데이터 로드
    const votesSnap = await get(ref(db, `rooms/${roomCode}/actions/votes`));
    const votes = {};
    if (votesSnap.exists()) {
      const raw = votesSnap.val();
      for (const [pid, v] of Object.entries(raw)) {
        votes[pid] = v.vote;
      }
    }

    this._memory.voteHistory.push({ proposal, votes });
  }

  /** 미션 결과를 메모리에 저장 + 의심 점수 업데이트 */
  static _recordMissionResult(state) {
    const result = state.missionResult;
    const teamMembers = state.teamProposal?.members || [];
    if (!result) return;

    this._memory.missionHistory.push({
      members: teamMembers,
      success: result.success,
      failCount: result.failCount || 0,
    });

    // 실패 미션 참여자의 의심 점수 증가
    if (!result.success) {
      for (const id of teamMembers) {
        this._memory.suspicion[id] = (this._memory.suspicion[id] || 0) + 2;
      }
    } else {
      // 성공 미션 참여자의 의심 점수 소폭 감소
      for (const id of teamMembers) {
        this._memory.suspicion[id] = (this._memory.suspicion[id] || 0) - 0.5;
      }
    }
  }

  // ======================
  // 유틸
  // ======================

  static async _submitReadyAll(roomCode) {
    await this._delay(500, 1200);
    for (const botId of this._botIds) {
      await set(ref(db, `rooms/${roomCode}/actions/readyPlayers/${botId}`), true);
      await this._delay(100, 300);
    }
  }

  static _delay(minMs, maxMs) {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
