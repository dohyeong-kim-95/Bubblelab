import { db, ref, set, update, remove, onValue, get } from '../firebase.js';
import { RoleManager } from './RoleManager.js';
import { VoteManager } from './VoteManager.js';
import { MissionManager } from './MissionManager.js';
import { AssassinManager } from './AssassinManager.js';
import {
  MISSION_TEAM_SIZE, PHASES, MAX_TEAM_REJECTS, MISSIONS_TO_WIN, TOTAL_MISSIONS, ROLES,
  getPhaseTimeLimit,
} from '../config/gameConfig.js';

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * GameEngine은 방장 클라이언트에서만 실행됩니다.
 * Firebase 리스너로 플레이어 액션을 감지하고, 게임 규칙에 따라 상태를 전이합니다.
 */
export class GameEngine {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.unsubscribers = [];
    this.assignments = null; // 역할 배정 결과
    this.playerOrder = [];
    this.playerCount = 0;
    this.timeLimitSeconds = 0; // 전체 시간제한 (초)
    this._phaseTimer = null;
  }

  /**
   * 게임 시작: 역할 배정 → gameState 초기화 → phase: role_reveal
   */
  async startGame(players, roleConfig, timeLimitSeconds = 0) {
    const playerIds = Object.keys(players);
    this.playerCount = playerIds.length;
    this.playerOrder = shuffle(playerIds);
    this.timeLimitSeconds = timeLimitSeconds || 0;

    // 역할 배정
    this.assignments = RoleManager.assignRoles(this.playerOrder, roleConfig);

    // privateData에 각 플레이어 역할 정보 저장 (room 외부 경로)
    const privateDataUpdates = {};
    for (const [id, assignment] of Object.entries(this.assignments)) {
      privateDataUpdates[`privateData/${this.roomCode}/${id}`] = {
        role: assignment.role,
        team: assignment.team,
        visibleInfo: assignment.visibleInfo,
      };
    }

    // 다수의 경로를 한번에 업데이트
    const updates = { ...privateDataUpdates };

    // gameState 초기화
    const phaseTime = getPhaseTimeLimit(this.timeLimitSeconds, PHASES.ROLE_REVEAL);
    const gameState = {
      phase: PHASES.ROLE_REVEAL,
      currentMission: 0, // 0-indexed
      missionResults: ['pending', 'pending', 'pending', 'pending', 'pending'],
      currentLeaderIndex: 0,
      playerOrder: this.playerOrder,
      totalRejects: 0,
      teamProposal: null,
      voteResult: null,
      missionResult: null,
      winner: null,
      winReason: null,
      timeLimitSeconds: this.timeLimitSeconds,
      phaseDeadline: phaseTime ? Date.now() + phaseTime * 1000 : 0,
    };
    updates[`rooms/${this.roomCode}/gameState`] = gameState;
    updates[`rooms/${this.roomCode}/meta/status`] = 'playing';

    // actions 초기화
    updates[`rooms/${this.roomCode}/actions`] = {
      votes: null,
      missionCards: null,
      assassination: null,
      readyPlayers: null,
    };
    updates[`rooms/${this.roomCode}/readyStatus`] = null;

    await update(ref(db), updates);

    // 리스너 등록
    this.listenForReady(PHASES.ROLE_REVEAL);
  }

  /**
   * 방장 복귀 시 게임 엔진 재시작
   */
  async resume() {
    // 현재 상태 로드
    const snapshot = await get(ref(db, `rooms/${this.roomCode}`));
    if (!snapshot.exists()) return;

    const data = snapshot.val();
    const gameState = data.gameState;
    if (!gameState) return;

    this.playerOrder = gameState.playerOrder;
    this.playerCount = this.playerOrder.length;
    this.timeLimitSeconds = gameState.timeLimitSeconds || 0;

    // privateData에서 assignments 복원 (room 외부 경로)
    const privateSnap = await get(ref(db, `privateData/${this.roomCode}`));
    const allPrivateData = privateSnap.val() || {};
    this.assignments = {};
    for (const id of this.playerOrder) {
      const pd = allPrivateData[id];
      if (pd) {
        this.assignments[id] = {
          role: pd.role,
          team: pd.team,
          visibleInfo: pd.visibleInfo,
        };
      }
    }

    // 현재 phase에 맞는 리스너 등록
    switch (gameState.phase) {
      case PHASES.ROLE_REVEAL:
        this.listenForReady(PHASES.ROLE_REVEAL, gameState.phaseDeadline || 0);
        break;
      case PHASES.TEAM_PROPOSAL:
        this.listenForTeamProposal(gameState.phaseDeadline || 0);
        break;
      case PHASES.VOTING:
        this.listenForVotes(gameState.phaseDeadline || 0);
        break;
      case PHASES.MISSION:
        this.listenForMissionCards(gameState.teamProposal.members, gameState.phaseDeadline || 0);
        break;
      case PHASES.ASSASSINATION:
        this.listenForAssassination(gameState.phaseDeadline || 0);
        break;
      case PHASES.VOTE_RESULT:
        this.listenForReady(PHASES.VOTE_RESULT, gameState.phaseDeadline || 0);
        break;
      case PHASES.MISSION_RESULT:
        this.listenForReady(PHASES.MISSION_RESULT, gameState.phaseDeadline || 0);
        break;
    }
  }

  // --- 타이머 ---

  _clearPhaseTimer() {
    if (this._phaseTimer) {
      clearTimeout(this._phaseTimer);
      this._phaseTimer = null;
    }
  }

  _startPhaseTimer(phase, autoAction, existingDeadline = 0) {
    this._clearPhaseTimer();
    const seconds = getPhaseTimeLimit(this.timeLimitSeconds, phase);
    const timeoutMs = existingDeadline
      ? Math.max(0, existingDeadline - Date.now())
      : seconds * 1000;
    if (!seconds && !existingDeadline) return;

    this._phaseTimer = setTimeout(async () => {
      try {
        await autoAction();
      } catch (e) {
        console.error('[GameEngine] 타이머 자동 처리 오류:', e);
      }
    }, timeoutMs);
  }

  async _setPhaseDeadline(phase) {
    const seconds = getPhaseTimeLimit(this.timeLimitSeconds, phase);
    const deadline = seconds ? Date.now() + seconds * 1000 : 0;
    await update(ref(db, `rooms/${this.roomCode}/gameState`), { phaseDeadline: deadline });
  }

  // --- 리스너 ---

  listenForReady(currentPhase, existingDeadline = 0) {
    this.clearListeners();
    const unsub = onValue(ref(db, `rooms/${this.roomCode}/actions/readyPlayers`), async (snapshot) => {
      const ready = snapshot.val() || {};
      const allReady = this.playerOrder.every(id => ready[id]);
      if (allReady) {
        this._clearPhaseTimer();
        await this.onAllPlayersReady();
      }
    });
    this.unsubscribers.push(unsub);

    // 시간 초과 시 미제출 플레이어 자동 ready 처리
    if (currentPhase) {
      this._startPhaseTimer(currentPhase, async () => {
        const snap = await get(ref(db, `rooms/${this.roomCode}/actions/readyPlayers`));
        const ready = snap.val() || {};
        const updates = {};
        for (const id of this.playerOrder) {
          if (!ready[id]) {
            updates[`rooms/${this.roomCode}/actions/readyPlayers/${id}`] = true;
          }
        }
        if (Object.keys(updates).length > 0) {
          await update(ref(db), updates);
        }
      }, existingDeadline);
    }
  }

  listenForVotes(existingDeadline = 0) {
    this.clearListeners();
    const unsub = VoteManager.onVotesChange(this.roomCode, this.playerOrder, async (votes, allVoted) => {
      if (allVoted) {
        this._clearPhaseTimer();
        await this.onAllVotesReceived(votes);
      }
    });
    this.unsubscribers.push(unsub);

    // 시간 초과 시 미투표 플레이어 자동 reject 처리
    this._startPhaseTimer(PHASES.VOTING, async () => {
      const snap = await get(ref(db, `rooms/${this.roomCode}/actions/votes`));
      const votes = snap.val() || {};
      const updates = {};
      for (const id of this.playerOrder) {
        if (!votes[id]) {
          updates[`rooms/${this.roomCode}/actions/votes/${id}`] = { vote: 'reject', submittedAt: Date.now() };
        }
      }
      if (Object.keys(updates).length > 0) {
        await update(ref(db), updates);
      }
    }, existingDeadline);
  }

  listenForMissionCards(teamMembers, existingDeadline = 0) {
    this.clearListeners();
    const unsub = MissionManager.onMissionCardsChange(this.roomCode, teamMembers, async (cards, allSubmitted) => {
      if (allSubmitted) {
        this._clearPhaseTimer();
        await this.onAllMissionCardsReceived(cards);
      }
    });
    this.unsubscribers.push(unsub);

    // 시간 초과 시 미제출 팀원 자동 success 카드 처리
    this._startPhaseTimer(PHASES.MISSION, async () => {
      const snap = await get(ref(db, `rooms/${this.roomCode}/actions/missionCards`));
      const cards = snap.val() || {};
      const updates = {};
      for (const id of teamMembers) {
        if (!cards[id]) {
          updates[`rooms/${this.roomCode}/actions/missionCards/${id}`] = { card: 'success', submittedAt: Date.now() };
        }
      }
      if (Object.keys(updates).length > 0) {
        await update(ref(db), updates);
      }
    }, existingDeadline);
  }

  listenForAssassination(existingDeadline = 0) {
    this.clearListeners();
    const unsub = AssassinManager.onAssassinationChange(this.roomCode, async (data) => {
      if (data && data.targetId) {
        this._clearPhaseTimer();
        await this.onAssassinationTarget(data.targetId);
      }
    });
    this.unsubscribers.push(unsub);

    // 시간 초과 시 랜덤 타겟 선택
    this._startPhaseTimer(PHASES.ASSASSINATION, async () => {
      const assassinId = Object.entries(this.assignments)
        .find(([, a]) => a.role === ROLES.ASSASSIN)?.[0];
      if (!assassinId) return;
      const privateSnap = await get(ref(db, `privateData/${this.roomCode}/${assassinId}`));
      const pd = privateSnap.val();
      const targets = pd?.assassinTargets || [];
      if (targets.length === 0) return;
      const randomTarget = targets[Math.floor(Math.random() * targets.length)];
      await set(ref(db, `rooms/${this.roomCode}/actions/assassination/targetId`), randomTarget);
    }, existingDeadline);
  }

  clearListeners() {
    this.unsubscribers.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this.unsubscribers = [];
  }

  // --- 상태 전이 핸들러 ---

  async onAllPlayersReady() {
    const stateSnap = await get(ref(db, `rooms/${this.roomCode}/gameState`));
    const state = stateSnap.val();
    if (!state) return;

    // ready 초기화
    await remove(ref(db, `rooms/${this.roomCode}/actions/readyPlayers`));

    switch (state.phase) {
      case PHASES.ROLE_REVEAL:
        // 팀 제안 단계로
        await this.transitionToTeamProposal();
        break;
      case PHASES.VOTE_RESULT:
        if (state.voteResult?.approved) {
          await this.transitionToMission();
        } else {
          // 거부 시 리더 교체 후 다음 팀 제안으로
          const newLeaderIndex = (state.currentLeaderIndex + 1) % this.playerOrder.length;
          await this.transitionToTeamProposal(newLeaderIndex);
        }
        break;
      case PHASES.MISSION_RESULT:
        await this.checkMissionEnd();
        break;
    }
  }

  async transitionToTeamProposal(newLeaderIndex = null) {
    await VoteManager.clearVotes(this.roomCode);
    // 이전 팀 제안 액션 정리
    await remove(ref(db, `rooms/${this.roomCode}/actions/teamProposal`));
    const phaseTime = getPhaseTimeLimit(this.timeLimitSeconds, PHASES.TEAM_PROPOSAL);
    const stateUpdate = {
      phase: PHASES.TEAM_PROPOSAL,
      teamProposal: null,
      voteResult: null,
      missionResult: null,
      phaseDeadline: phaseTime ? Date.now() + phaseTime * 1000 : 0,
    };
    if (newLeaderIndex !== null) {
      stateUpdate.currentLeaderIndex = newLeaderIndex;
    }
    await update(ref(db, `rooms/${this.roomCode}/gameState`), stateUpdate);
    this.listenForTeamProposal();
  }

  listenForTeamProposal(existingDeadline = 0) {
    this.clearListeners();
    // 리더가 actions/teamProposal에 제출 → 엔진이 gameState로 복사 후 투표 전이
    const unsub = onValue(ref(db, `rooms/${this.roomCode}/actions/teamProposal`), async (snapshot) => {
      const proposal = snapshot.val();
      if (proposal && proposal.members && proposal.members.length > 0) {
        const stateSnap = await get(ref(db, `rooms/${this.roomCode}/gameState`));
        const state = stateSnap.val();
        if (!state) return;

        const expectedLeaderId = state.playerOrder[state.currentLeaderIndex];
        const requiredSize = MISSION_TEAM_SIZE[state.playerOrder.length][state.currentMission];
        const members = Array.isArray(proposal.members) ? proposal.members : [];
        const uniqueMembers = new Set(members);
        const allMembersValid = members.every((id) => state.playerOrder.includes(id));

        if (
          proposal.leaderId !== expectedLeaderId ||
          members.length !== requiredSize ||
          uniqueMembers.size !== members.length ||
          !allMembersValid
        ) {
          return;
        }

        this._clearPhaseTimer();
        // gameState에 반영 (다른 뷰에서 읽을 수 있도록)
        await update(ref(db, `rooms/${this.roomCode}/gameState`), {
          teamProposal: proposal,
        });
        await this.transitionToVoting();
      }
    });
    this.unsubscribers.push(unsub);

    // 시간 초과 시 랜덤 팀 자동 제안
    this._startPhaseTimer(PHASES.TEAM_PROPOSAL, async () => {
      const stateSnap = await get(ref(db, `rooms/${this.roomCode}/gameState`));
      const state = stateSnap.val();
      if (!state) return;
      const leaderId = state.playerOrder[state.currentLeaderIndex];
      const requiredSize = MISSION_TEAM_SIZE[state.playerOrder.length][state.currentMission];
      const shuffled = shuffle(state.playerOrder);
      const members = shuffled.slice(0, requiredSize);
      await set(ref(db, `rooms/${this.roomCode}/actions/teamProposal`), {
        leaderId,
        members,
      });
    }, existingDeadline);
  }

  async transitionToVoting() {
    await VoteManager.clearVotes(this.roomCode);
    const phaseTime = getPhaseTimeLimit(this.timeLimitSeconds, PHASES.VOTING);
    await update(ref(db, `rooms/${this.roomCode}/gameState`), {
      phase: PHASES.VOTING,
      phaseDeadline: phaseTime ? Date.now() + phaseTime * 1000 : 0,
    });
    this.listenForVotes();
  }

  async onAllVotesReceived(votes) {
    const result = VoteManager.tallyVotes(votes);

    const stateSnap = await get(ref(db, `rooms/${this.roomCode}/gameState`));
    const state = stateSnap.val();

    // 실명투표 모드일 때 개별 투표 내역을 결과에 포함
    const metaSnap2 = await get(ref(db, `rooms/${this.roomCode}/meta`));
    const metaVal = metaSnap2.val() || {};
    if (metaVal.voteMode === 'public') {
      const playerVoteDetails = {};
      for (const [id, data] of Object.entries(votes)) {
        playerVoteDetails[id] = data.vote;
      }
      result.playerVotes = playerVoteDetails;
    }

    // 투표 히스토리 저장 (설정이 켜져 있을 때만)
    const voteHistoryEnabled = metaVal.voteHistoryEnabled !== false;
    let voteHistory = state.voteHistory || [];

    if (voteHistoryEnabled) {
      const playerVotes = {};
      for (const [id, data] of Object.entries(votes)) {
        playerVotes[id] = data.vote;
      }

      voteHistory = [...voteHistory, {
        mission: state.currentMission,
        leaderId: state.teamProposal?.leaderId || null,
        teamMembers: state.teamProposal?.members || [],
        approved: result.approved,
        approveCount: result.approveCount,
        rejectCount: result.rejectCount,
        playerVotes,
      }];
    }

    if (result.approved) {
      // 팀 승인
      const stateUpdate = { phase: PHASES.VOTE_RESULT, voteResult: result };
      if (voteHistoryEnabled) stateUpdate.voteHistory = voteHistory;
      await update(ref(db, `rooms/${this.roomCode}/gameState`), stateUpdate);
    } else {
      // 팀 거부
      const newRejects = (state.totalRejects || 0) + 1;

      if (newRejects >= MAX_TEAM_REJECTS) {
        // 누적 5회 팀 거부 → 악 승리
        if (voteHistoryEnabled) {
          await update(ref(db, `rooms/${this.roomCode}/gameState`), { voteHistory });
        }
        await this.endGame('evil', '팀 구성 누적 5회 실패');
        return;
      }

      // 리더 인덱스는 VOTE_RESULT에서 변경하지 않음 (제안한 리더를 표시하기 위해)
      // 다음 TEAM_PROPOSAL 전이 시점에서 교체
      const stateUpdate = {
        phase: PHASES.VOTE_RESULT,
        voteResult: result,
        totalRejects: newRejects,
      };
      if (voteHistoryEnabled) stateUpdate.voteHistory = voteHistory;
      await update(ref(db, `rooms/${this.roomCode}/gameState`), stateUpdate);
    }

    // vote_result → ready 대기
    await this._setPhaseDeadline(PHASES.VOTE_RESULT);
    this.listenForReady(PHASES.VOTE_RESULT);
  }

  async transitionToMission() {
    const stateSnap = await get(ref(db, `rooms/${this.roomCode}/gameState`));
    const state = stateSnap.val();

    await MissionManager.clearMissionCards(this.roomCode);
    const phaseTime = getPhaseTimeLimit(this.timeLimitSeconds, PHASES.MISSION);
    await update(ref(db, `rooms/${this.roomCode}/gameState`), {
      phase: PHASES.MISSION,
      phaseDeadline: phaseTime ? Date.now() + phaseTime * 1000 : 0,
    });

    this.listenForMissionCards(state.teamProposal.members);
  }

  async onAllMissionCardsReceived(cards) {
    const stateSnap = await get(ref(db, `rooms/${this.roomCode}/gameState`));
    const state = stateSnap.val();

    const result = MissionManager.judgeMission(cards, this.playerCount, state.currentMission);

    // 미션 결과 기록
    const newResults = [...(state.missionResults || ['pending', 'pending', 'pending', 'pending', 'pending'])];
    newResults[state.currentMission] = result.success ? 'success' : 'fail';

    // 리더 교체, 다음 미션
    const newLeaderIndex = (state.currentLeaderIndex + 1) % this.playerOrder.length;

    const phaseTime = getPhaseTimeLimit(this.timeLimitSeconds, PHASES.MISSION_RESULT);
    await update(ref(db, `rooms/${this.roomCode}/gameState`), {
      phase: PHASES.MISSION_RESULT,
      missionResults: newResults,
      missionResult: result,
      currentLeaderIndex: newLeaderIndex,
      currentMission: state.currentMission + 1,
      phaseDeadline: phaseTime ? Date.now() + phaseTime * 1000 : 0,
    });

    this.listenForReady(PHASES.MISSION_RESULT);
  }

  async checkMissionEnd() {
    const stateSnap = await get(ref(db, `rooms/${this.roomCode}/gameState`));
    const state = stateSnap.val();

    const results = state.missionResults || [];
    const successCount = results.filter(r => r === 'success').length;
    const failCount = results.filter(r => r === 'fail').length;

    if (successCount >= MISSIONS_TO_WIN) {
      // 선 3승 → 암살 단계 (멀린이 있을 때만)
      const hasMerlin = Object.values(this.assignments).some(a => a.role === ROLES.MERLIN);
      if (hasMerlin) {
        await AssassinManager.clearAssassination(this.roomCode);
        // 암살자의 privateData에 실제 선의 세력 목록 저장 (오베론이 후보에 포함되는 문제 방지)
        const goodPlayerIds = Object.entries(this.assignments)
          .filter(([, a]) => a.team === 'good')
          .map(([id]) => id);
        const assassinId = Object.entries(this.assignments)
          .find(([, a]) => a.role === ROLES.ASSASSIN)?.[0];
        if (assassinId) {
          await update(ref(db, `privateData/${this.roomCode}/${assassinId}`), {
            assassinTargets: goodPlayerIds,
          });
        }
        const assPhaseTime = getPhaseTimeLimit(this.timeLimitSeconds, PHASES.ASSASSINATION);
        await update(ref(db, `rooms/${this.roomCode}/gameState`), {
          phase: PHASES.ASSASSINATION,
          phaseDeadline: assPhaseTime ? Date.now() + assPhaseTime * 1000 : 0,
        });
        this.listenForAssassination();
      } else {
        await this.endGame('good', '미션 3회 성공');
      }
    } else if (failCount >= MISSIONS_TO_WIN) {
      await this.endGame('evil', '미션 3회 실패');
    } else {
      // 게임 계속
      await this.transitionToTeamProposal();
    }
  }

  async onAssassinationTarget(targetId) {
    const result = AssassinManager.judgeAssassination(targetId, this.assignments);
    if (!result.validTarget) {
      return;
    }

    if (result.merlinKilled) {
      await this.endGame('evil', '멀린 암살 성공');
    } else {
      await this.endGame('good', '멀린 암살 실패 — 선의 세력 최종 승리');
    }
  }

  async endGame(winner, winReason) {
    this.clearListeners();

    // 전체 역할 공개 정보 생성
    const roleReveal = {};
    for (const [id, assignment] of Object.entries(this.assignments)) {
      roleReveal[id] = {
        role: assignment.role,
        team: assignment.team,
      };
    }

    await update(ref(db, `rooms/${this.roomCode}/gameState`), {
      phase: PHASES.RESULT,
      winner,
      winReason,
      roleReveal,
    });

    await update(ref(db, `rooms/${this.roomCode}/meta`), {
      status: 'finished',
    });

    // 30분 후 방 데이터 자동 삭제 예약
    this.scheduleCleanup();
  }

  scheduleCleanup() {
    setTimeout(async () => {
      try {
        const snapshot = await get(ref(db, `rooms/${this.roomCode}/meta/status`));
        if (snapshot.exists() && snapshot.val() === 'finished') {
          await remove(ref(db, `rooms/${this.roomCode}`));
          await remove(ref(db, `privateData/${this.roomCode}`));
        }
      } catch (e) {
        // 정리 실패 무시 — 다음 접속 시 정리됨
      }
    }, 30 * 60 * 1000);
  }

  destroy() {
    this._clearPhaseTimer();
    this.clearListeners();
  }
}
