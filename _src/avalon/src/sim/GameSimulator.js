import {
  MISSION_TEAM_SIZE,
  PHASES,
  ROLES,
  TEAM_COMPOSITION,
  getRequiredFails,
} from '../config/gameConfig.js';
import { RoleManager } from '../game/RoleManager.js';
import { normalizeRoleConfig } from '../lobby/roleConfigState.js';

const DEFAULT_ROLE_CONFIG = {
  merlin: true,
  percival: true,
  morgana: true,
  mordred: false,
  oberon: false,
};

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithRng(array, random) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class GameSimulator {
  constructor({
    playerCount,
    roleConfig = DEFAULT_ROLE_CONFIG,
    seed = Date.now(),
    maxTurns = 200,
  }) {
    this.playerCount = playerCount;
    this.roleConfig = normalizeRoleConfig(playerCount, { ...DEFAULT_ROLE_CONFIG, ...roleConfig });
    this.random = createRng(seed);
    this.maxTurns = maxTurns;
    this.players = Array.from({ length: playerCount }, (_, index) => `player_${index + 1}`);
    this.memory = {
      missionHistory: [],
      suspicion: {},
      voteHistory: [],
    };
    this.turns = 0;
  }

  run() {
    const assignments = this._assignRoles();
    const playerOrder = shuffleWithRng(this.players, this.random);
    const state = {
      phase: PHASES.TEAM_PROPOSAL,
      currentMission: 0,
      missionResults: ['pending', 'pending', 'pending', 'pending', 'pending'],
      currentLeaderIndex: 0,
      playerOrder,
      totalRejects: 0,
      teamProposal: null,
      voteResult: null,
      missionResult: null,
      winner: null,
      winReason: null,
    };

    while (!state.winner && this.turns < this.maxTurns) {
      this.turns += 1;

      switch (state.phase) {
        case PHASES.TEAM_PROPOSAL:
          state.teamProposal = this._proposeTeam(state, assignments);
          this._validateTeamProposal(state.teamProposal, state);
          state.phase = PHASES.VOTING;
          break;
        case PHASES.VOTING:
          this._runVoting(state, assignments);
          break;
        case PHASES.MISSION:
          this._runMission(state, assignments);
          break;
        case PHASES.ASSASSINATION:
          this._runAssassination(state, assignments);
          break;
        default:
          throw new Error(`Unsupported phase in simulator: ${state.phase}`);
      }
    }

    if (!state.winner) {
      throw new Error(`Simulation exceeded ${this.maxTurns} turns for ${this.playerCount} players`);
    }

    this._validateFinishedState(state, assignments);

    return {
      playerCount: this.playerCount,
      turns: this.turns,
      winner: state.winner,
      winReason: state.winReason,
      missionResults: [...state.missionResults],
      totalRejects: state.totalRejects,
      roleSummary: this._summarizeRoles(assignments),
      assassinationOccurred: state.winReason.includes('암살'),
    };
  }

  _assignRoles() {
    const { good: goodCount, evil: evilCount } = TEAM_COMPOSITION[this.playerCount];
    const evilRoles = [];

    if (this.roleConfig.merlin) evilRoles.push(ROLES.ASSASSIN);
    if (this.roleConfig.morgana) evilRoles.push(ROLES.MORGANA);
    if (this.roleConfig.mordred) evilRoles.push(ROLES.MORDRED);
    if (this.roleConfig.oberon) evilRoles.push(ROLES.OBERON);

    while (evilRoles.length < evilCount) {
      evilRoles.push(ROLES.MINION);
    }
    evilRoles.length = evilCount;

    const goodRoles = [];
    if (this.roleConfig.merlin) goodRoles.push(ROLES.MERLIN);
    if (this.roleConfig.percival && this.roleConfig.merlin) goodRoles.push(ROLES.PERCIVAL);

    while (goodRoles.length < goodCount) {
      goodRoles.push(ROLES.LOYAL_SERVANT);
    }

    const roleBag = shuffleWithRng([...goodRoles, ...evilRoles], this.random);
    const playerBag = shuffleWithRng(this.players, this.random);
    const baseAssignments = {};

    playerBag.forEach((playerId, index) => {
      const role = roleBag[index];
      baseAssignments[playerId] = {
        role,
        team: role === ROLES.ASSASSIN
          || role === ROLES.MORGANA
          || role === ROLES.MORDRED
          || role === ROLES.OBERON
          || role === ROLES.MINION ? 'evil' : 'good',
      };
    });

    return RoleManager.generateVisibleInfo(baseAssignments);
  }

  _proposeTeam(state, assignments) {
    const leaderId = state.playerOrder[state.currentLeaderIndex];
    const leaderAssignment = assignments[leaderId];
    const requiredSize = MISSION_TEAM_SIZE[this.playerCount][state.currentMission];

    const members = leaderAssignment.team === 'evil'
      ? this._proposeAsEvil(leaderId, leaderAssignment, state, requiredSize)
      : this._proposeAsGood(leaderId, state, requiredSize);

    return { leaderId, members };
  }

  _proposeAsGood(leaderId, state, requiredSize) {
    const members = [leaderId];
    const rankedPlayers = state.playerOrder
      .filter(id => id !== leaderId)
      .map(id => ({ id, suspicion: this.memory.suspicion[id] || 0 }))
      .sort((a, b) => a.suspicion - b.suspicion);

    for (const player of rankedPlayers) {
      if (members.length >= requiredSize) break;
      members.push(player.id);
    }

    return members;
  }

  _proposeAsEvil(leaderId, assignment, state, requiredSize) {
    const members = [leaderId];
    const evilAllies = (assignment.visibleInfo || [])
      .filter(info => info.label === 'evil_ally')
      .map(info => info.id);
    const shuffledAllies = shuffleWithRng(evilAllies, this.random);

    if (shuffledAllies.length > 0 && members.length < requiredSize) {
      members.push(shuffledAllies[0]);
    }

    const remaining = shuffleWithRng(
      state.playerOrder.filter(id => !members.includes(id)),
      this.random
    );

    for (const playerId of remaining) {
      if (members.length >= requiredSize) break;
      members.push(playerId);
    }

    return members;
  }

  _runVoting(state, assignments) {
    const votes = {};
    for (const playerId of state.playerOrder) {
      const assignment = assignments[playerId];
      const vote = assignment.team === 'evil'
        ? this._voteAsEvil(playerId, assignment, state.teamProposal.members, state)
        : this._voteAsGood(playerId, state.teamProposal.members, state);
      votes[playerId] = { vote };
    }

    const approveCount = Object.values(votes).filter(({ vote }) => vote === 'approve').length;
    const rejectCount = state.playerOrder.length - approveCount;
    const approved = approveCount > rejectCount;

    this.memory.voteHistory.push({
      proposal: [...state.teamProposal.members],
      votes: Object.fromEntries(
        Object.entries(votes).map(([playerId, data]) => [playerId, data.vote])
      ),
    });

    state.voteResult = { approved, approveCount, rejectCount };

    if (approved) {
      state.phase = PHASES.MISSION;
      return;
    }

    state.totalRejects += 1;
    if (state.totalRejects >= 5) {
      state.winner = 'evil';
      state.winReason = '팀 구성 누적 5회 실패';
      return;
    }

    state.currentLeaderIndex = (state.currentLeaderIndex + 1) % state.playerOrder.length;
    state.phase = PHASES.TEAM_PROPOSAL;
  }

  _voteAsGood(playerId, members, state) {
    let approveChance = 0.5;

    if (members.includes(playerId)) approveChance += 0.25;

    const suspiciousOnTeam = members.filter(
      id => (this.memory.suspicion[id] || 0) >= 2
    ).length;
    approveChance -= suspiciousOnTeam * 0.2;

    if ((state.totalRejects || 0) >= 3) approveChance += 0.35;

    return this.random() < clamp(approveChance, 0.1, 0.95) ? 'approve' : 'reject';
  }

  _voteAsEvil(playerId, assignment, members, state) {
    const evilAllies = (assignment.visibleInfo || [])
      .filter(info => info.label === 'evil_ally')
      .map(info => info.id);
    const allEvil = [playerId, ...evilAllies];
    const evilOnTeam = members.filter(id => allEvil.includes(id)).length;
    let approveChance = 0.4;

    if (evilOnTeam > 0) approveChance += 0.35;
    if (evilOnTeam === 0) approveChance -= 0.25;
    if ((state.totalRejects || 0) >= 3) approveChance += 0.2;

    return this.random() < clamp(approveChance, 0.1, 0.9) ? 'approve' : 'reject';
  }

  _runMission(state, assignments) {
    const cards = {};
    for (const playerId of state.teamProposal.members) {
      const assignment = assignments[playerId];
      cards[playerId] = {
        card: assignment.team === 'evil'
          ? this._missionCardAsEvil(state)
          : 'success',
      };
    }

    const failCount = Object.values(cards).filter(({ card }) => card === 'fail').length;
    const successCount = Object.values(cards).length - failCount;
    const requiredFails = getRequiredFails(this.playerCount, state.currentMission);
    const success = failCount < requiredFails;

    state.missionResult = { success, successCount, failCount };
    state.missionResults[state.currentMission] = success ? 'success' : 'fail';

    this.memory.missionHistory.push({
      members: [...state.teamProposal.members],
      success,
      failCount,
    });
    this._updateSuspicion(state.teamProposal.members, success);

    state.currentLeaderIndex = (state.currentLeaderIndex + 1) % state.playerOrder.length;
    state.currentMission += 1;
    state.totalRejects = 0;

    const completedSuccesses = state.missionResults.filter(result => result === 'success').length;
    const completedFails = state.missionResults.filter(result => result === 'fail').length;

    if (completedSuccesses >= 3) {
      if (Object.values(assignments).some(assignment => assignment.role === ROLES.MERLIN)) {
        state.phase = PHASES.ASSASSINATION;
        return;
      }
      state.winner = 'good';
      state.winReason = '미션 3회 성공';
      return;
    }

    if (completedFails >= 3) {
      state.winner = 'evil';
      state.winReason = '미션 3회 실패';
      return;
    }

    state.phase = PHASES.TEAM_PROPOSAL;
  }

  _missionCardAsEvil(state) {
    const missionIndex = state.currentMission;
    const successCount = state.missionResults.filter(result => result === 'success').length;
    const failCount = state.missionResults.filter(result => result === 'fail').length;

    if (missionIndex === 0) return 'success';
    if (successCount >= 2) return 'fail';
    if (failCount >= 2) return this.random() < 0.6 ? 'success' : 'fail';

    return this.random() < 0.75 ? 'fail' : 'success';
  }

  _runAssassination(state, assignments) {
    const assassinId = Object.entries(assignments)
      .find(([, assignment]) => assignment.role === ROLES.ASSASSIN)?.[0];

    if (!assassinId) {
      state.winner = 'good';
      state.winReason = '미션 3회 성공';
      return;
    }

    const goodTargets = Object.entries(assignments)
      .filter(([, assignment]) => assignment.team === 'good')
      .map(([playerId]) => playerId);
    const targetId = this._deduceMerlin(assassinId, assignments[assassinId], goodTargets);
    const target = assignments[targetId];

    if (target?.role === ROLES.MERLIN) {
      state.winner = 'evil';
      state.winReason = '멀린 암살 성공';
    } else {
      state.winner = 'good';
      state.winReason = '멀린 암살 실패 — 선의 세력 최종 승리';
    }
  }

  _deduceMerlin(assassinId, assignment, goodTargets) {
    const evilAllies = (assignment.visibleInfo || [])
      .filter(info => info.label === 'evil_ally')
      .map(info => info.id);
    const allEvil = [assassinId, ...evilAllies];

    const rankedTargets = goodTargets.map(playerId => {
      let evilTeamVotes = 0;
      let evilTeamRejects = 0;

      for (const voteRecord of this.memory.voteHistory) {
        const hasEvil = voteRecord.proposal.some(id => allEvil.includes(id));
        if (!hasEvil) continue;

        const vote = voteRecord.votes[playerId];
        if (!vote) continue;

        evilTeamVotes += 1;
        if (vote === 'reject') evilTeamRejects += 1;
      }

      return {
        id: playerId,
        ratio: evilTeamVotes > 0 ? evilTeamRejects / evilTeamVotes : 0,
      };
    }).sort((a, b) => b.ratio - a.ratio);

    if (rankedTargets.length === 0) {
      throw new Error('Assassination target list is empty');
    }

    if (rankedTargets[0].ratio > 0) {
      const topRatio = rankedTargets[0].ratio;
      const topCandidates = rankedTargets.filter(target => target.ratio === topRatio);
      return topCandidates[Math.floor(this.random() * topCandidates.length)].id;
    }

    return goodTargets[Math.floor(this.random() * goodTargets.length)];
  }

  _updateSuspicion(teamMembers, missionSucceeded) {
    for (const playerId of teamMembers) {
      const current = this.memory.suspicion[playerId] || 0;
      this.memory.suspicion[playerId] = missionSucceeded ? current - 0.5 : current + 2;
    }
  }

  _validateTeamProposal(teamProposal, state) {
    const expectedSize = MISSION_TEAM_SIZE[this.playerCount][state.currentMission];
    if (teamProposal.members.length !== expectedSize) {
      throw new Error(`Expected ${expectedSize} team members, got ${teamProposal.members.length}`);
    }

    const uniqueMembers = new Set(teamProposal.members);
    if (uniqueMembers.size !== teamProposal.members.length) {
      throw new Error('Team proposal contains duplicate members');
    }

    if (!teamProposal.members.every(member => state.playerOrder.includes(member))) {
      throw new Error('Team proposal contains invalid player IDs');
    }
  }

  _validateFinishedState(state, assignments) {
    const successCount = state.missionResults.filter(result => result === 'success').length;
    const failCount = state.missionResults.filter(result => result === 'fail').length;
    const totalAssignedPlayers = Object.keys(assignments).length;
    const teamCounts = Object.values(assignments).reduce((acc, assignment) => {
      acc[assignment.team] += 1;
      return acc;
    }, { good: 0, evil: 0 });
    const expectedTeams = TEAM_COMPOSITION[this.playerCount];

    if (totalAssignedPlayers !== this.playerCount) {
      throw new Error(`Expected ${this.playerCount} assignments, got ${totalAssignedPlayers}`);
    }
    if (teamCounts.good !== expectedTeams.good || teamCounts.evil !== expectedTeams.evil) {
      throw new Error(`Invalid team composition: ${JSON.stringify(teamCounts)}`);
    }
    if (state.currentMission > 5) {
      throw new Error(`Mission index overflow: ${state.currentMission}`);
    }
    if (state.totalRejects > 5) {
      throw new Error(`Reject count overflow: ${state.totalRejects}`);
    }
    if (!['good', 'evil'].includes(state.winner)) {
      throw new Error(`Invalid winner: ${state.winner}`);
    }
    if (!state.winReason) {
      throw new Error('Missing win reason');
    }
    if (successCount >= 3 && failCount >= 3) {
      throw new Error('Both teams cannot have three mission results');
    }
  }

  _summarizeRoles(assignments) {
    return Object.values(assignments).reduce((summary, assignment) => {
      summary[assignment.role] = (summary[assignment.role] || 0) + 1;
      return summary;
    }, {});
  }
}

export function runSimulationSeries({
  playerCounts = [5, 6, 7, 8, 9, 10],
  iterations = 100,
  baseSeed = 20260308,
  roleConfig = DEFAULT_ROLE_CONFIG,
} = {}) {
  return playerCounts.map((playerCount, offset) => {
    const games = [];
    for (let index = 0; index < iterations; index++) {
      const seed = baseSeed + playerCount * 1000 + offset * 100 + index;
      const simulator = new GameSimulator({ playerCount, roleConfig, seed });
      games.push(simulator.run());
    }

    const summary = games.reduce((acc, game) => {
      acc.totalGames += 1;
      acc.winners[game.winner] += 1;
      acc.winReasons[game.winReason] = (acc.winReasons[game.winReason] || 0) + 1;
      acc.totalTurns += game.turns;
      acc.assassinationGames += game.assassinationOccurred ? 1 : 0;
      return acc;
    }, {
      playerCount,
      totalGames: 0,
      winners: { good: 0, evil: 0 },
      winReasons: {},
      totalTurns: 0,
      assassinationGames: 0,
    });

    summary.averageTurns = Number((summary.totalTurns / summary.totalGames).toFixed(2));
    return summary;
  });
}

export { DEFAULT_ROLE_CONFIG };
