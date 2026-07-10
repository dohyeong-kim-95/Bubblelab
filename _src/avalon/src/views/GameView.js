import { router } from '../router.js';
import { appState } from '../main.js';
import { db, ref, update, get, set, onValue } from '../firebase.js';
import { RoomService } from '../services/RoomService.js';
import { PlayerService } from '../services/PlayerService.js';
import { GameEngine } from '../game/GameEngine.js';
import { MissionTrack } from '../components/MissionTrack.js';
import { PlayerList } from '../components/PlayerList.js';
import { VoteResult } from '../components/VoteResult.js';
import { ChatService } from '../services/ChatService.js';
import { AudioService } from '../services/AudioService.js';
import { BotService } from '../services/BotService.js';
import { getNextHostCandidate } from '../game/hostMigrationState.js';
import {
  PHASES, MISSION_TEAM_SIZE, ROLE_INFO, ROLES, MAX_TEAM_REJECTS,
  getRequiredFails,
} from '../config/gameConfig.js';
import { getOptimisticReadyProgress, getReadyProgress } from '../game/gamePhaseState.js';
import {
  getMissionActionLabels,
  getMissionResultButtonLabel,
  getRoleRevealButtonLabel,
  getTeamProposalButtonLabel,
  getVoteCompleteButtonLabel,
  getVoteResultButtonLabel,
  getVoteStatusMessage,
  getWaitingForOthersButtonLabel,
} from '../ui/labelState.js';
import '../styles/game.css';

export class GameView {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.container = document.getElementById('app');
    this.unsubscribers = [];
    this.phaseUnsubscribers = [];
    this.gameState = null;
    this.players = {};
    this.meta = null;
    this.privateData = null;
    this.engine = null;
    this.selectedTeam = [];
    this.lastPhase = null;
    this.hasVoted = false;
    this.submittedVote = null;
    this.hasSubmittedCard = false;
    this.voteCount = 0;
    this.missionCardCount = 0;
    this.readyPhaseCount = 0;
    this.hasConfirmedNext = false;
    this.chatMessages = [];
    this._timerInterval = null;
    this._hostMigrationTimer = null;
  }

  render() {
    this.container.innerHTML = `
      <div class="view game-view fade-in">
        <div class="game-content" id="game-content">
          <div class="flex-center"><div class="spinner"></div></div>
        </div>
        <div class="role-peek-overlay" id="role-peek-overlay">
          <div class="role-peek-card" id="role-peek-card"></div>
        </div>
        <button class="role-peek-btn" id="role-peek-btn" title="역할 확인 (길게 누르기)">
          <svg viewBox="0 0 40 56" width="28" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="38" height="54" rx="4" stroke="currentColor" stroke-width="2" fill="var(--color-bg-card)"/>
            <rect x="5" y="5" width="30" height="46" rx="2" stroke="currentColor" stroke-width="1" stroke-opacity="0.4" fill="none"/>
            <path d="M20 14 L14 20 L20 26 L26 20 Z" fill="currentColor" fill-opacity="0.6"/>
            <circle cx="20" cy="35" r="6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-opacity="0.5"/>
            <circle cx="20" cy="35" r="2" fill="currentColor" fill-opacity="0.5"/>
          </svg>
        </button>
        <button class="audio-toggle-btn" id="audio-toggle-btn" title="사운드 ON/OFF">${AudioService.muted ? '&#128263;' : '&#128266;'}</button>
        <button class="vote-history-btn" id="vote-history-btn" title="투표 기록">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
        </button>
        <div class="vote-history-overlay" id="vote-history-overlay">
          <div class="vote-history-panel" id="vote-history-panel"></div>
        </div>
        <div class="floating-chat" id="floating-chat">
          <div class="floating-chat-bubbles" id="floating-chat-bubbles"></div>
          <form class="floating-chat-form" id="floating-chat-form">
            <input class="floating-chat-input" id="floating-chat-input" type="text" placeholder="메시지..." maxlength="200" autocomplete="off" />
            <button class="floating-chat-send" type="submit">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </form>
        </div>
      </div>
    `;

    this.subscribe();
    this.bindRolePeekEvents();
    this.bindChatEvents();
    this.bindAudioEvents();
    this.bindVoteHistoryEvents();
    AudioService.init();
    AudioService.startBGM();
  }

  bindRolePeekEvents() {
    const btn = document.getElementById('role-peek-btn');
    const overlay = document.getElementById('role-peek-overlay');
    const card = document.getElementById('role-peek-card');
    if (!btn || !overlay) return;

    let pressTimer = null;
    let isShowing = false;

    const showRole = () => {
      if (!this.privateData) return;
      const role = this.privateData.role;
      const team = this.privateData.team;
      const info = ROLE_INFO[role];
      if (!info) return;

      const teamName = team === 'good' ? '선의 세력' : '악의 세력';
      const visibleInfo = this.privateData.visibleInfo || [];

      let visibleSection = '';
      if (visibleInfo.length > 0) {
        const items = visibleInfo.map(v => {
          const player = this.players[v.id];
          const name = player ? PlayerList.escapeHtml(player.name) : '???';
          let labelText = '';
          if (v.label === 'evil') labelText = '악의 세력';
          else if (v.label === 'evil_ally') labelText = '악의 동료';
          else if (v.label === 'merlin_or_morgana') labelText = '멀린 또는 모르가나';
          return `<li class="visible-item"><span>${name}</span><span class="badge ${v.label.includes('evil') ? 'badge-evil' : 'badge-good'}">${labelText}</span></li>`;
        }).join('');
        visibleSection = `<ul class="visible-list mt-sm">${items}</ul>`;
      }

      card.innerHTML = `
        <div class="role-card ${team === 'good' ? 'role-card-good' : 'role-card-evil'}" style="max-width:100%">
          <div class="role-team-badge">
            <span class="badge ${team === 'good' ? 'badge-good' : 'badge-evil'}">${teamName}</span>
          </div>
          <h3 class="role-name ${team === 'good' ? 'text-good' : 'text-evil'}">${info.name}</h3>
          <p class="role-description">${info.description}</p>
          ${visibleSection}
        </div>
      `;
      overlay.classList.add('role-peek-visible');
      isShowing = true;
    };

    const hideRole = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (isShowing) {
        overlay.classList.remove('role-peek-visible');
        isShowing = false;
      }
    };

    // Long press: show after 300ms hold
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pressTimer = setTimeout(showRole, 300);
    });
    btn.addEventListener('mouseup', hideRole);
    btn.addEventListener('mouseleave', hideRole);

    // Touch events for mobile
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      pressTimer = setTimeout(showRole, 300);
    });
    btn.addEventListener('touchend', hideRole);
    btn.addEventListener('touchcancel', hideRole);
  }

  subscribe() {
    PlayerService.setupPresence(this.roomCode, appState.playerId);

    // 방 데이터 전체 감시
    const unsubRoom = RoomService.onRoomChange(this.roomCode, (data) => {
      if (!data) {
        router.navigate('/');
        return;
      }

      this.meta = data.meta;
      this.players = data.players || {};
      this.gameState = data.gameState;

      this.handleHostMigration(data);

      // 방장이면 게임 엔진 가동 (이전 방장 이탈 시 자동 인수)
      if (data.meta.hostId === appState.playerId && !this.engine) {
        this.engine = new GameEngine(this.roomCode);
        this.engine.resume();

        const botIds = BotService.getBotIdsFromPlayers(data.players || {});
        if (botIds.length > 0) {
          BotService.startListening(this.roomCode, botIds);
        }
      }

      // phase가 변경되었을 때만 UI 갱신 (불필요한 재렌더 방지)
      const currentPhase = data.gameState?.phase;
      if (currentPhase !== this.lastPhase) {
        this.lastPhase = currentPhase;
        this.hasVoted = false;
        this.submittedVote = null;
        this.hasSubmittedCard = false;
        this.hasConfirmedNext = false;
        this.selectedTeam = [];
        this.voteCount = 0;
        this.missionCardCount = 0;
        this.clearPhaseListeners();
        this.setupPhaseListeners(currentPhase);

        // 페이즈별 효과음
        if (currentPhase === PHASES.VOTE_RESULT) {
          AudioService.playVoteSound();
        } else if (currentPhase === PHASES.MISSION_RESULT) {
          const missionResult = data.gameState?.missionResult;
          if (missionResult?.success) {
            AudioService.playSuccessSound();
          } else {
            AudioService.playFailSound();
          }
        } else if (currentPhase) {
          AudioService.playPhaseTransition();
        }
      }

      this.updateUI();

      // 투표 히스토리 버튼 표시/숨김
      const historyBtn = document.getElementById('vote-history-btn');
      if (historyBtn) {
        historyBtn.style.display = data.meta?.voteHistoryEnabled !== false ? 'flex' : 'none';
      }
    });

    // privateData 감시
    const unsubPrivate = PlayerService.onPrivateDataChange(
      this.roomCode, appState.playerId, (data) => {
        this.privateData = data;
        this.updateUI();
      }
    );

    // 채팅 감시
    const unsubChat = ChatService.onChatChange(this.roomCode, (messages) => {
      // 새 메시지만 버블로 표시
      const newMessages = messages.slice(this.chatMessages.length);
      this.chatMessages = messages;
      for (const msg of newMessages) {
        this.addFloatingBubble(msg);
      }
    });

    this.unsubscribers.push(unsubRoom, unsubPrivate, unsubChat);
  }

  handleHostMigration(data) {
    const hostId = data.meta?.hostId;
    if (!hostId || !data.gameState) {
      this.clearHostMigrationTimer();
      return;
    }

    const hostOnline = data.players?.[hostId]?.online !== false;
    if (hostOnline) {
      this.clearHostMigrationTimer();
      return;
    }

    const candidateId = getNextHostCandidate(data.players || {}, data.gameState.playerOrder || [], hostId);
    if (candidateId !== appState.playerId) {
      this.clearHostMigrationTimer();
      return;
    }

    if (this._hostMigrationTimer) return;

    this._hostMigrationTimer = setTimeout(async () => {
      try {
        const room = await RoomService.getRoomData(this.roomCode);
        const latestHostId = room?.meta?.hostId;
        const latestHostOnline = room?.players?.[latestHostId]?.online !== false;
        const latestCandidate = getNextHostCandidate(room?.players || {}, room?.gameState?.playerOrder || [], latestHostId);

        if (!room?.gameState || latestHostOnline || latestCandidate !== appState.playerId) {
          return;
        }

        await update(ref(db, `rooms/${this.roomCode}/meta`), { hostId: appState.playerId });
      } catch (error) {
        console.error('호스트 승계 실패:', error);
      } finally {
        this.clearHostMigrationTimer();
      }
    }, 3000);
  }

  clearHostMigrationTimer() {
    if (this._hostMigrationTimer) {
      clearTimeout(this._hostMigrationTimer);
      this._hostMigrationTimer = null;
    }
  }

  clearPhaseListeners() {
    this.phaseUnsubscribers.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this.phaseUnsubscribers = [];
  }

  setupPhaseListeners(phase) {
    if (phase === PHASES.VOTING) {
      const unsub = onValue(ref(db, `rooms/${this.roomCode}/actions/votes`), (snapshot) => {
        const votes = snapshot.val() || {};
        this.voteCount = Object.keys(votes).length;
        const myVote = votes[appState.playerId]?.vote || null;
        if (myVote) {
          this.hasVoted = true;
          this.submittedVote = myVote;
        }
        const total = this.gameState?.playerOrder?.length || 0;
        const el = document.getElementById('vote-progress');
        if (el) el.textContent = `${this.voteCount} / ${total}`;
        const bar = document.getElementById('vote-progress-bar');
        if (bar && total > 0) bar.style.width = `${Math.round((this.voteCount / total) * 100)}%`;
        const buttons = document.getElementById('vote-buttons');
        const completeBtn = document.getElementById('vote-complete-btn');
        const status = document.getElementById('vote-status');
        if (buttons) buttons.style.display = this.hasVoted ? 'none' : 'grid';
        if (completeBtn) completeBtn.style.display = this.hasVoted ? 'flex' : 'none';
        if (status) {
          status.style.display = this.hasVoted ? 'block' : 'none';
          if (this.hasVoted) {
            const voteLabel = this.submittedVote === 'approve' ? '찬성' : '반대';
            status.innerHTML = `투표가 완료되었습니다!<br>당신의 선택은 <strong>${voteLabel}</strong>입니다.`;
          }
        }
      });
      this.phaseUnsubscribers.push(unsub);
    } else if (
      phase === PHASES.ROLE_REVEAL ||
      phase === PHASES.VOTE_RESULT ||
      phase === PHASES.MISSION_RESULT
    ) {
      const unsub = onValue(ref(db, `rooms/${this.roomCode}/actions/readyPlayers`), (snapshot) => {
        const readyPlayers = snapshot.val() || {};
        const progress = getOptimisticReadyProgress(
          this.gameState?.playerOrder || [],
          readyPlayers,
          appState.playerId,
          this.hasConfirmedNext
        );
        this.readyPhaseCount = progress.readyCount;
        this.hasConfirmedNext = !!readyPlayers[appState.playerId] || this.hasConfirmedNext;

        const btn = document.getElementById('btn-ready');
        if (btn) {
          btn.disabled = this.hasConfirmedNext;
          if (this.hasConfirmedNext) {
            if (this.gameState?.phase === PHASES.ROLE_REVEAL) {
              btn.textContent = getRoleRevealButtonLabel(true);
            } else if (this.gameState?.phase === PHASES.VOTE_RESULT) {
              btn.textContent = getWaitingForOthersButtonLabel();
            } else if (this.gameState?.phase === PHASES.MISSION_RESULT) {
              btn.textContent = getMissionResultButtonLabel(true);
            }
          }
        }

        const status = document.getElementById('ready-progress');
        if (status) {
          status.textContent = `대기 중 (${progress.readyCount}/${progress.total})`;
        }
      });
      this.phaseUnsubscribers.push(unsub);
    } else if (phase === PHASES.MISSION) {
      const unsub = onValue(ref(db, `rooms/${this.roomCode}/actions/missionCards`), (snapshot) => {
        const cards = snapshot.val() || {};
        this.missionCardCount = Object.keys(cards).length;
        const total = this.gameState?.teamProposal?.members?.length || 0;
        const el = document.getElementById('mission-progress');
        if (el) el.textContent = `${this.missionCardCount} / ${total}`;
        const bar = document.getElementById('mission-progress-bar');
        if (bar && total > 0) bar.style.width = `${Math.round((this.missionCardCount / total) * 100)}%`;
      });
      this.phaseUnsubscribers.push(unsub);
    }
  }

  updateUI() {
    if (!this.gameState || !this.privateData) return;

    const content = document.getElementById('game-content');
    if (!content) return;

    this._stopTimerDisplay();
    switch (this.gameState.phase) {
      case PHASES.ROLE_REVEAL:
        content.innerHTML = this.renderRoleReveal();
        this.bindRoleRevealEvents();
        this._startTimerDisplay();
        break;
      case PHASES.TEAM_PROPOSAL:
        content.innerHTML = this.renderTeamProposal();
        this.bindTeamProposalEvents();
        this._startTimerDisplay();
        break;
      case PHASES.VOTING:
        content.innerHTML = this.renderVoting();
        this.bindVotingEvents();
        this._startTimerDisplay();
        break;
      case PHASES.VOTE_RESULT:
        content.innerHTML = this.renderVoteResult();
        this.bindVoteResultEvents();
        this._startTimerDisplay();
        break;
      case PHASES.MISSION:
        content.innerHTML = this.renderMission();
        this.bindMissionEvents();
        this._startTimerDisplay();
        break;
      case PHASES.MISSION_RESULT:
        content.innerHTML = this.renderMissionResult();
        this.bindMissionResultEvents();
        this._startTimerDisplay();
        break;
      case PHASES.ASSASSINATION:
        content.innerHTML = this.renderAssassination();
        this.bindAssassinationEvents();
        this._startTimerDisplay();
        break;
      case PHASES.RESULT:
        router.navigate('/result/' + this.roomCode);
        break;
    }
  }

  // =====================
  // 역할 확인 화면
  // =====================
  renderRoleReveal() {
    const role = this.privateData.role;
    const team = this.privateData.team;
    const info = ROLE_INFO[role];
    const visibleInfo = this.privateData.visibleInfo || [];

    const teamClass = team === 'good' ? 'text-good' : 'text-evil';
    const teamName = team === 'good' ? '선의 세력' : '악의 세력';

    let visibleSection = '';
    if (visibleInfo.length > 0) {
      const items = visibleInfo.map(v => {
        const player = this.players[v.id];
        const name = player ? PlayerList.escapeHtml(player.name) : '???';
        let labelText = '';
        if (v.label === 'evil') labelText = '악의 세력';
        else if (v.label === 'evil_ally') labelText = '악의 동료';
        else if (v.label === 'merlin_or_morgana') labelText = '멀린 또는 모르가나';
        return `<li class="visible-item"><span>${name}</span><span class="badge ${v.label.includes('evil') ? 'badge-evil' : 'badge-good'}">${labelText}</span></li>`;
      }).join('');

      visibleSection = `
        <div class="role-visible-info card mt-lg">
          <h3 class="text-center mb-sm">당신이 알고 있는 정보</h3>
          <ul class="visible-list">${items}</ul>
        </div>
      `;
    }

    const readyProgress = getOptimisticReadyProgress(
      this.gameState?.playerOrder || [],
      this.gameState?.readyPlayers || {},
      appState.playerId,
      this.hasConfirmedNext
    );

    return `
      <div class="role-reveal fade-in">
        <h2 class="text-center mb-lg">당신의 역할 ${this._renderTimerHtml()}</h2>
        <div class="role-card ${team === 'good' ? 'role-card-good' : 'role-card-evil'}">
          <div class="role-team-badge">
            <span class="badge ${team === 'good' ? 'badge-good' : 'badge-evil'}">${teamName}</span>
          </div>
          <h3 class="role-name ${teamClass}">${info.name}</h3>
          <p class="role-description">${info.description}</p>
        </div>
        ${visibleSection}
        <p class="text-center text-muted mt-xl" id="ready-progress">대기 중 (${readyProgress.readyCount}/${readyProgress.total})</p>
        <button class="btn btn-primary btn-full mt-sm" id="btn-ready">${getRoleRevealButtonLabel(this.hasConfirmedNext)}</button>
      </div>
    `;
  }

  bindRoleRevealEvents() {
    const btn = document.getElementById('btn-ready');
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = getRoleRevealButtonLabel(true);
      this.hasConfirmedNext = true;
      const status = document.getElementById('ready-progress');
      const progress = getOptimisticReadyProgress(
        this.gameState?.playerOrder || [],
        this.gameState?.readyPlayers || {},
        appState.playerId,
        true
      );
      if (status) {
        status.textContent = `대기 중 (${progress.readyCount}/${progress.total})`;
      }
      await PlayerService.submitReady(this.roomCode, appState.playerId);
    });
  }

  // =====================
  // 팀 제안 화면
  // =====================
  renderTeamProposal() {
    const state = this.gameState;
    const playerOrder = state.playerOrder;
    const leaderIndex = state.currentLeaderIndex;
    const leaderId = playerOrder[leaderIndex];
    const isLeader = leaderId === appState.playerId;
    const leaderName = this.players[leaderId]?.name || '???';
    const currentMission = state.currentMission;
    const playerCount = playerOrder.length;
    const requiredSize = MISSION_TEAM_SIZE[playerCount][currentMission];
    const rejects = state.totalRejects || 0;

    const missionTrack = MissionTrack.render(playerCount, state.missionResults, currentMission);

    const playerList = PlayerList.render(this.players, playerOrder, leaderIndex, {
      selectedIds: this.selectedTeam,
      isSelectable: isLeader,
      teamMembers: [],
    });

    const rejectTrack = `
      <div class="reject-track">
        ${Array.from({ length: MAX_TEAM_REJECTS }, (_, i) => `
          <div class="reject-dot ${i < rejects ? 'reject-active' : ''}"></div>
        `).join('')}
        <span class="reject-label text-muted">누적 거부 ${rejects}/${MAX_TEAM_REJECTS}</span>
      </div>
    `;

    return `
      <div class="team-proposal fade-in">
        ${missionTrack}
        ${rejectTrack}
        <div class="phase-info">
          <h3>미션 ${currentMission + 1} — 팀 제안 ${this._renderTimerHtml()}</h3>
          <p class="text-muted">리더: <strong class="text-gold">${PlayerList.escapeHtml(leaderName)}</strong></p>
          <p class="text-muted">팀원 ${requiredSize}명을 선택하세요</p>
        </div>
        ${playerList}
        ${isLeader ? `
          <button class="btn btn-primary btn-full mt-lg" id="btn-propose" disabled>
            ${getTeamProposalButtonLabel(this.selectedTeam.length, requiredSize)}
          </button>
        ` : `
          <p class="text-center text-muted mt-lg">리더가 팀을 제안하는 중...</p>
        `}
      </div>
    `;
  }

  bindTeamProposalEvents() {
    const state = this.gameState;
    const leaderId = state.playerOrder[state.currentLeaderIndex];
    if (leaderId !== appState.playerId) return;

    const playerCount = state.playerOrder.length;
    const requiredSize = MISSION_TEAM_SIZE[playerCount][state.currentMission];

    // 플레이어 선택
    document.querySelectorAll('.game-player-item[data-player-id]').forEach(item => {
      item.addEventListener('click', () => {
        const playerId = item.dataset.playerId;
        const index = this.selectedTeam.indexOf(playerId);

        if (index >= 0) {
          this.selectedTeam.splice(index, 1);
          item.classList.remove('player-selected');
        } else if (this.selectedTeam.length < requiredSize) {
          this.selectedTeam.push(playerId);
          item.classList.add('player-selected');
        }

        const btn = document.getElementById('btn-propose');
        if (btn) {
          btn.textContent = getTeamProposalButtonLabel(this.selectedTeam.length, requiredSize);
          btn.disabled = this.selectedTeam.length !== requiredSize;
        }
      });
    });

    // 팀 제안 버튼 — actions/teamProposal에 기록 (비방장 리더도 쓸 수 있도록)
    document.getElementById('btn-propose')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-propose');
      btn.disabled = true;
      btn.textContent = '제안 중...';

      await set(ref(db, `rooms/${this.roomCode}/actions/teamProposal`), {
        leaderId: appState.playerId,
        members: [...this.selectedTeam],
      });
      this.selectedTeam = [];
    });
  }

  // =====================
  // 투표 화면
  // =====================
  renderVoting() {
    const state = this.gameState;
    const playerOrder = state.playerOrder;
    const leaderIndex = state.currentLeaderIndex;
    const proposal = state.teamProposal;
    const playerCount = playerOrder.length;
    const missionTrack = MissionTrack.render(playerCount, state.missionResults, state.currentMission);

    const playerList = PlayerList.render(this.players, playerOrder, leaderIndex, {
      teamMembers: proposal?.members || [],
    });

    const leaderName = this.players[proposal?.leaderId]?.name || '???';

    return `
      <div class="voting-phase fade-in">
        ${missionTrack}
        <div class="phase-info">
          <h3>미션 ${state.currentMission + 1} — 팀 투표 ${this._renderTimerHtml()}</h3>
          <p class="text-muted">리더 <strong class="text-gold">${PlayerList.escapeHtml(leaderName)}</strong>의 팀 제안</p>
        </div>
        ${playerList}
        <div class="vote-buttons mt-lg" id="vote-buttons" style="display:${this.hasVoted ? 'none' : 'grid'}">
          <button class="btn btn-good" id="btn-approve">찬성</button>
          <button class="btn btn-evil" id="btn-reject">반대</button>
        </div>
        <button class="btn btn-outline btn-full mt-lg vote-complete-btn" id="vote-complete-btn" style="display:${this.hasVoted ? 'flex' : 'none'}" disabled>
          ${getVoteCompleteButtonLabel()}
        </button>
        <p class="text-center text-muted mt-sm" id="vote-status" style="display:${this.hasVoted ? 'block' : 'none'}">
          ${this.hasVoted
            ? `투표가 완료되었습니다!<br>당신의 선택은 <strong>${this.submittedVote === 'approve' ? '찬성' : '반대'}</strong>입니다.`
            : getVoteStatusMessage(null)}
        </p>
        <div class="progress-indicator mt-md">
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" id="vote-progress-bar" style="width:${Math.round((this.voteCount / playerOrder.length) * 100)}%"></div>
          </div>
          <span class="progress-text" id="vote-progress">${this.voteCount} / ${playerOrder.length}</span>
        </div>
      </div>
    `;
  }

  bindVotingEvents() {
    if (this.hasVoted) return;

    const approveBtn = document.getElementById('btn-approve');
    const rejectBtn = document.getElementById('btn-reject');

    const submitVote = async (vote) => {
      if (this.hasVoted) return;
      this.hasVoted = true;
      this.submittedVote = vote;
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      const voteButtons = document.getElementById('vote-buttons');
      if (voteButtons) voteButtons.style.display = 'none';
      const completeBtn = document.getElementById('vote-complete-btn');
      if (completeBtn) completeBtn.style.display = 'flex';
      const status = document.getElementById('vote-status');
      if (status) {
        status.style.display = 'block';
        status.innerHTML = `투표가 완료되었습니다!<br>당신의 선택은 <strong>${vote === 'approve' ? '찬성' : '반대'}</strong>입니다.`;
      }
      await PlayerService.submitVote(this.roomCode, appState.playerId, vote);
    };

    approveBtn?.addEventListener('click', () => submitVote('approve'));
    rejectBtn?.addEventListener('click', () => submitVote('reject'));
  }

  // =====================
  // 투표 결과 화면
  // =====================
  renderVoteResult() {
    const state = this.gameState;
    const playerOrder = state.playerOrder;
    const leaderIndex = state.currentLeaderIndex;
    const voteResult = state.voteResult;
    const isPublicVote = !!(voteResult?.playerVotes);

    const playerList = PlayerList.render(this.players, playerOrder, leaderIndex, {
      showVotes: isPublicVote,
      votes: voteResult?.playerVotes || {},
      teamMembers: state.teamProposal?.members || [],
    });

    const votePanel = VoteResult.render(voteResult, this.players);

    return `
      <div class="vote-result-phase fade-in">
        <div class="phase-info">
          <h3>팀 구성 결과 ${this._renderTimerHtml()}</h3>
        </div>
        ${votePanel}
        ${playerList}
        <p class="text-center text-muted mt-xl" id="ready-progress">대기 중 (${this.readyPhaseCount}/${playerOrder.length})</p>
        <button class="btn btn-primary btn-full mt-sm" id="btn-ready">${this.hasConfirmedNext ? getWaitingForOthersButtonLabel() : getVoteResultButtonLabel()}</button>
      </div>
    `;
  }

  bindVoteResultEvents() {
    document.getElementById('btn-ready')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-ready');
      btn.disabled = true;
      btn.textContent = getWaitingForOthersButtonLabel();
      this.hasConfirmedNext = true;
      const status = document.getElementById('ready-progress');
      const progress = getOptimisticReadyProgress(
        this.gameState?.playerOrder || [],
        this.gameState?.readyPlayers || {},
        appState.playerId,
        true
      );
      if (status) {
        status.textContent = `대기 중 (${progress.readyCount}/${progress.total})`;
      }
      await PlayerService.submitReady(this.roomCode, appState.playerId);
    });
  }

  // =====================
  // 미션 수행 화면
  // =====================
  renderMission() {
    const state = this.gameState;
    const proposal = state.teamProposal;
    const isTeamMember = proposal?.members?.includes(appState.playerId);
    const team = this.privateData.team;
    const playerCount = state.playerOrder.length;
    // mission phase에서 currentMission은 아직 증가 전이므로 그대로 사용
    const missionIndex = state.currentMission;
    const requiredFails = getRequiredFails(playerCount, missionIndex);

    const missionTrack = MissionTrack.render(playerCount, state.missionResults, missionIndex);
    const missionLabels = getMissionActionLabels();

    const teamSize = proposal?.members?.length || 0;

    if (!isTeamMember) {
      return `
        <div class="mission-phase fade-in">
          ${missionTrack}
          <div class="phase-info">
            <h3>미션 ${missionIndex + 1} 수행 중 ${this._renderTimerHtml()}</h3>
            <p class="text-muted">팀원들이 미션을 수행하고 있습니다...</p>
          </div>
          <div class="flex-center mt-xl"><div class="spinner"></div></div>
          <div class="progress-indicator mt-md">
            <span class="text-muted">미션 카드 제출: </span>
            <span class="text-gold" id="mission-progress">${this.missionCardCount} / ${teamSize}</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="mission-phase fade-in">
        ${missionTrack}
        <div class="phase-info">
          <h3>미션 카드 제출 ${this._renderTimerHtml()}</h3>
          <p class="text-muted">성공 또는 실패 카드를 제출하세요</p>
          ${requiredFails > 1 ? `<p class="text-gold" style="font-size:var(--font-size-sm)">이 미션은 실패 ${requiredFails}장 이상이어야 실패합니다</p>` : ''}
        </div>
        <div class="mission-buttons" id="mission-buttons">
          <button class="btn btn-good mission-btn" id="btn-success">
            <span class="mission-btn-icon">&#10003;</span>
            <span>${missionLabels.success}</span>
          </button>
          <button class="btn btn-evil mission-btn" id="btn-fail" ${team === 'good' ? 'disabled title="선의 세력은 성공만 제출 가능"' : ''}>
            <span class="mission-btn-icon">&#10007;</span>
            <span>${missionLabels.fail}</span>
          </button>
        </div>
        ${team === 'good' ? '<p class="text-center text-muted mt-sm">선의 세력은 성공 카드만 제출할 수 있습니다.</p>' : ''}
        <p class="text-center text-muted mt-sm" id="mission-status" style="display:none">카드 제출 완료. 결과 대기 중...</p>
        <div class="progress-indicator mt-md">
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" id="mission-progress-bar" style="width:${teamSize > 0 ? Math.round((this.missionCardCount / teamSize) * 100) : 0}%"></div>
          </div>
          <span class="progress-text" id="mission-progress">${this.missionCardCount} / ${teamSize}</span>
        </div>
      </div>
    `;
  }

  bindMissionEvents() {
    if (this.hasSubmittedCard) return;

    const successBtn = document.getElementById('btn-success');
    const failBtn = document.getElementById('btn-fail');

    const submitCard = async (card) => {
      if (this.hasSubmittedCard) return;
      this.hasSubmittedCard = true;
      if (successBtn) successBtn.disabled = true;
      if (failBtn) failBtn.disabled = true;
      const btns = document.getElementById('mission-buttons');
      if (btns) btns.style.display = 'none';
      const status = document.getElementById('mission-status');
      if (status) status.style.display = 'block';
      await PlayerService.submitMissionCard(this.roomCode, appState.playerId, card);
    };

    successBtn?.addEventListener('click', () => submitCard('success'));
    failBtn?.addEventListener('click', () => submitCard('fail'));
  }

  // =====================
  // 미션 결과 화면
  // =====================
  renderMissionResult() {
    const state = this.gameState;
    const result = state.missionResult;
    const playerCount = state.playerOrder.length;
    const missionTrack = MissionTrack.render(playerCount, state.missionResults, state.currentMission);

    const success = result?.success;

    return `
      <div class="mission-result-phase fade-in">
        ${missionTrack}
        <div class="phase-info">
          <h3>미션 ${state.currentMission} 결과 ${this._renderTimerHtml()}</h3>
        </div>
        <div class="result-display ${success ? 'result-success' : 'result-fail'}">
          <h2>${success ? '미션 성공' : '미션 실패'}</h2>
          <div class="result-cards">
            <span class="text-good">성공 ${result?.successCount || 0}장</span>
            <span class="text-muted">/</span>
            <span class="text-evil">실패 ${result?.failCount || 0}장</span>
        </div>
        </div>
        <p class="text-center text-muted mt-xl" id="ready-progress">대기 중 (${this.readyPhaseCount}/${playerCount})</p>
        <button class="btn btn-primary btn-full mt-sm" id="btn-ready">${getMissionResultButtonLabel(this.hasConfirmedNext)}</button>
      </div>
    `;
  }

  bindMissionResultEvents() {
    document.getElementById('btn-ready')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-ready');
      btn.disabled = true;
      btn.textContent = getMissionResultButtonLabel(true);
      this.hasConfirmedNext = true;
      await PlayerService.submitReady(this.roomCode, appState.playerId);
    });
  }

  // =====================
  // 암살 단계
  // =====================
  renderAssassination() {
    const state = this.gameState;
    const isAssassin = this.privateData.role === ROLES.ASSASSIN;
    const playerOrder = state.playerOrder;

    // 엔진이 privateData에 저장한 실제 선의 세력 목록 사용 (오베론 오지목 방지)
    const goodCandidates = this.privateData.assassinTargets || [];

    if (!isAssassin) {
      return `
        <div class="assassination-phase fade-in">
          <div class="phase-info">
            <h2 class="text-gold">암살 단계</h2>
            <p class="text-muted mt-sm">선의 세력이 미션 3회에 성공했습니다.</p>
            <p class="text-muted">암살자가 멀린을 지목하는 중...</p>
          </div>
          <div class="flex-center mt-xl"><div class="spinner"></div></div>
        </div>
      `;
    }

    return `
      <div class="assassination-phase fade-in">
        <div class="phase-info">
          <h2 class="text-evil">멀린을 지목하세요 ${this._renderTimerHtml()}</h2>
          <p class="text-muted mt-sm">선의 세력 중 멀린이라고 생각되는 1명을 선택하세요</p>
        </div>
        <ul class="assassination-list">
          ${goodCandidates.map(id => {
            const player = this.players[id];
            return `
              <li class="assassination-target" data-target-id="${id}">
                ${PlayerList.escapeHtml(player?.name || '???')}
              </li>
            `;
          }).join('')}
        </ul>
        <button class="btn btn-evil btn-full mt-lg" id="btn-assassinate" disabled>
          암살 대상을 선택하세요
        </button>
      </div>
    `;
  }

  bindAssassinationEvents() {
    if (this.privateData?.role !== ROLES.ASSASSIN) return;

    let selectedTarget = null;

    document.querySelectorAll('.assassination-target').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.assassination-target').forEach(t => t.classList.remove('target-selected'));
        item.classList.add('target-selected');
        selectedTarget = item.dataset.targetId;

        const btn = document.getElementById('btn-assassinate');
        if (btn) {
          const name = this.players[selectedTarget]?.name || '???';
          btn.textContent = `${name}을(를) 암살`;
          btn.disabled = false;
        }
      });
    });

    document.getElementById('btn-assassinate')?.addEventListener('click', async () => {
      if (!selectedTarget) return;
      const btn = document.getElementById('btn-assassinate');
      btn.disabled = true;
      btn.textContent = '암살 중...';
      await PlayerService.submitAssassination(this.roomCode, selectedTarget);
    });
  }

  _startTimerDisplay() {
    this._stopTimerDisplay();
    this._updateTimerDisplay();
    this._timerInterval = setInterval(() => this._updateTimerDisplay(), 1000);
  }

  _stopTimerDisplay() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  _updateTimerDisplay() {
    const el = document.getElementById('phase-timer');
    if (!el || !this.gameState?.phaseDeadline) {
      if (el) el.style.display = 'none';
      return;
    }
    const remaining = Math.max(0, Math.ceil((this.gameState.phaseDeadline - Date.now()) / 1000));
    if (remaining <= 0) {
      el.textContent = '시간 초과';
      el.classList.add('timer-expired');
      return;
    }
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    el.textContent = min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}초`;
    el.style.display = 'inline-block';
    el.classList.toggle('timer-warning', remaining <= 10);
  }

  _renderTimerHtml() {
    if (!this.gameState?.phaseDeadline) return '';
    return '<span class="phase-timer" id="phase-timer"></span>';
  }

  bindChatEvents() {
    const form = document.getElementById('floating-chat-form');
    const input = document.getElementById('floating-chat-input');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input?.value;
      if (!text?.trim()) return;
      input.value = '';
      const playerName = this.players[appState.playerId]?.name || '???';
      await ChatService.sendMessage(this.roomCode, appState.playerId, playerName, text);
    });
  }

  addFloatingBubble(msg) {
    const container = document.getElementById('floating-chat-bubbles');
    if (!container) return;

    const isMe = msg.playerId === appState.playerId;
    const escapedName = PlayerList.escapeHtml(msg.playerName);
    const escapedText = PlayerList.escapeHtml(msg.text);

    const bubble = document.createElement('div');
    bubble.className = `floating-bubble ${isMe ? 'floating-bubble-me' : ''}`;
    bubble.innerHTML = `<span class="floating-bubble-name">${escapedName}</span> ${escapedText}`;
    container.appendChild(bubble);

    // 최대 6개 버블 유지
    while (container.children.length > 6) {
      container.removeChild(container.firstChild);
    }

    // 5초 후 페이드아웃 → 제거
    setTimeout(() => {
      bubble.classList.add('floating-bubble-fade');
      setTimeout(() => bubble.remove(), 1000);
    }, 5000);
  }

  bindAudioEvents() {
    document.getElementById('audio-toggle-btn')?.addEventListener('click', () => {
      const muted = AudioService.toggleMute();
      const btn = document.getElementById('audio-toggle-btn');
      if (btn) btn.innerHTML = muted ? '&#128263;' : '&#128266;';
      if (!muted) AudioService.startBGM();
    });
  }

  bindVoteHistoryEvents() {
    const btn = document.getElementById('vote-history-btn');
    const overlay = document.getElementById('vote-history-overlay');
    if (!btn || !overlay) return;

    btn.addEventListener('click', () => {
      this.updateVoteHistoryPanel();
      overlay.classList.add('vote-history-visible');
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('vote-history-visible');
      }
    });
  }

  updateVoteHistoryPanel() {
    const panel = document.getElementById('vote-history-panel');
    if (!panel) return;

    const history = this.gameState?.voteHistory || [];
    const playerOrder = this.gameState?.playerOrder || [];

    if (history.length === 0) {
      panel.innerHTML = `
        <div class="vote-history-header">
          <h3>투표 기록</h3>
        </div>
        <p class="text-center text-muted" style="padding:var(--spacing-xl)">아직 투표 기록이 없습니다.</p>
      `;
      return;
    }

    // 미션별로 그룹화
    const missionGroups = {};
    for (const entry of history) {
      const m = entry.mission;
      if (!missionGroups[m]) missionGroups[m] = [];
      missionGroups[m].push(entry);
    }

    let tableHtml = `
      <div class="vote-history-header">
        <h3>투표 기록</h3>
      </div>
      <div class="vote-history-scroll">
    `;

    for (const [mission, entries] of Object.entries(missionGroups)) {
      tableHtml += `<div class="vote-history-mission-group">`;
      tableHtml += `<div class="vote-history-mission-title">미션 ${Number(mission) + 1}</div>`;
      tableHtml += `<div class="vote-history-table-wrap"><table class="vote-history-table">`;
      tableHtml += `<thead><tr><th class="vote-history-name-col"></th>`;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const leaderName = this.players[e.leaderId]?.name || '???';
        tableHtml += `<th class="vote-history-round-col ${e.approved ? 'vh-approved' : 'vh-rejected'}">
          <div class="vh-round-num">${i + 1}차</div>
          <div class="vh-leader">${PlayerList.escapeHtml(leaderName)}</div>
          <div class="vh-team">${(e.teamMembers || []).map(id => PlayerList.escapeHtml(this.players[id]?.name || '?')).join(', ')}</div>
        </th>`;
      }
      tableHtml += `</tr></thead><tbody>`;

      for (const pid of playerOrder) {
        const name = this.players[pid]?.name || '???';
        tableHtml += `<tr><td class="vote-history-name-col">${PlayerList.escapeHtml(name)}</td>`;
        for (const e of entries) {
          const vote = e.playerVotes?.[pid];
          if (vote === 'approve') {
            tableHtml += `<td class="vh-vote vh-vote-approve">O</td>`;
          } else if (vote === 'reject') {
            tableHtml += `<td class="vh-vote vh-vote-reject">X</td>`;
          } else {
            tableHtml += `<td class="vh-vote">-</td>`;
          }
        }
        tableHtml += `</tr>`;
      }

      tableHtml += `</tbody></table></div></div>`;
    }

    tableHtml += `</div>`;
    panel.innerHTML = tableHtml;
  }

  destroy() {
    this._stopTimerDisplay();
    this.clearHostMigrationTimer();
    this.clearPhaseListeners();
    this.unsubscribers.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    if (this.engine) {
      this.engine.destroy();
    }
    AudioService.stopBGM();
    BotService.stopListening();
  }
}
