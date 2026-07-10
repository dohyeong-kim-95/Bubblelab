import { router } from '../router.js';
import { appState } from '../main.js';
import { db, ref, set, remove, onValue } from '../firebase.js';
import { RoomService } from '../services/RoomService.js';
import { PlayerService } from '../services/PlayerService.js';
import { TEAM_COMPOSITION, MIN_PLAYERS, MAX_PLAYERS, TIME_LIMIT_PRESETS } from '../config/gameConfig.js';
import { GameEngine } from '../game/GameEngine.js';
import { BotService } from '../services/BotService.js';
import { getActivePlayerIds, getLobbyReadiness } from '../lobby/lobbyState.js';
import { getMaxSelectedEvilSpecials, getSelectedEvilSpecialCount, normalizeRoleConfig } from '../lobby/roleConfigState.js';
import { getLobbyStartButtonLabel } from '../ui/labelState.js';
import '../styles/lobby.css';

export class LobbyView {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.container = document.getElementById('app');
    this.unsubscribers = [];
    this.players = {};
    this.meta = null;
    this.isHost = false;
    this.botIds = [];
    this.readyPlayers = {};
    this.isReady = false;
    this.pendingKickPlayer = null;
    this.longPressTimer = null;
    this.hasExitedLobby = false;
  }

  render() {
    this.container.innerHTML = `
      <div class="view lobby-view fade-in">
        <div class="view-header">
          <h1 class="view-title">대기실</h1>
          <div class="room-code-display">
            <span class="room-code-label">방 코드</span>
            <span class="room-code" id="room-code">${this.roomCode}</span>
            <button class="btn-copy" id="btn-copy" title="복사">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="lobby-players card" id="player-list">
          <div class="flex-center"><div class="spinner"></div></div>
        </div>

        <div class="modal-overlay" id="kick-modal" style="display:none">
          <div class="modal">
            <h2 class="modal-title">강제 퇴장</h2>
            <p class="text-muted" id="kick-modal-message">이 참가자를 강제 퇴장시키시겠습니까?</p>
            <div class="modal-actions">
              <button class="btn btn-evil btn-full" id="btn-kick-confirm">강제 퇴장</button>
              <button class="btn btn-outline btn-full" id="btn-kick-cancel">취소</button>
            </div>
          </div>
        </div>

        <div class="lobby-config card" id="role-config" style="display:none">
          <h3 class="config-title">역할 구성</h3>
          <div id="role-toggles"></div>
        </div>

        <div class="lobby-time-config card" id="time-config" style="display:none">
          <h3 class="config-title">시간 제한</h3>
          <div class="time-preset-buttons" id="time-preset-buttons"></div>
        </div>

        <div class="lobby-option-config card" id="vote-mode-config" style="display:none">
          <label class="toggle-item">
            <span class="toggle-label">실명 투표</span>
            <input type="checkbox" class="toggle-input" id="vote-mode-toggle" />
            <span class="toggle-slider"></span>
          </label>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:4px">
            투표 결과에서 각 플레이어의 찬성/반대를 공개합니다
          </p>
        </div>

        <div class="lobby-option-config card" id="vote-history-config" style="display:none">
          <label class="toggle-item">
            <span class="toggle-label">투표 기록 열람</span>
            <input type="checkbox" class="toggle-input" id="vote-history-toggle" checked />
            <span class="toggle-slider"></span>
          </label>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:4px">
            게임 중 과거 라운드의 투표 내역을 확인할 수 있습니다
          </p>
        </div>

        <div class="lobby-actions" id="lobby-actions">
          <button class="btn btn-good btn-full" id="btn-ready">준비 완료</button>
          <button class="btn btn-primary btn-full" id="btn-start" style="display:none" disabled>
            게임 시작
          </button>
          <button class="btn btn-outline btn-full" id="btn-leave">나가기</button>
        </div>
      </div>
    `;

    this.bindEvents();
    this.subscribe();
  }

  bindEvents() {
    document.getElementById('btn-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(this.roomCode).then(() => {
        const btn = document.getElementById('btn-copy');
        btn.innerHTML = '<span style="font-size:12px">OK</span>';
        setTimeout(() => {
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    });

    document.getElementById('vote-mode-toggle')?.addEventListener('change', async (e) => {
      await RoomService.updateVoteMode(this.roomCode, e.target.checked ? 'public' : 'anonymous');
    });

    document.getElementById('vote-history-toggle')?.addEventListener('change', async (e) => {
      await RoomService.updateVoteHistoryEnabled(this.roomCode, e.target.checked);
    });

    document.getElementById('btn-ready')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-ready');
      if (!btn) return;
      const nextReady = !this.isReady;
      btn.disabled = true;

      const readyRef = `rooms/${this.roomCode}/readyStatus/${appState.playerId}`;
      try {
        if (nextReady) {
          await set(ref(db, readyRef), true);
          this.isReady = true;
          btn.textContent = '준비 취소';
          btn.className = 'btn btn-outline btn-full';
        } else {
          await remove(ref(db, readyRef));
          this.isReady = false;
          btn.textContent = '준비 완료';
          btn.className = 'btn btn-good btn-full';
        }
      } catch (error) {
        console.error('레디 상태 변경 실패:', error);
      }
      btn.disabled = false;
    });

    document.getElementById('btn-leave').addEventListener('click', async () => {
      // 레디 상태 제거
      await remove(ref(db, `rooms/${this.roomCode}/readyStatus/${appState.playerId}`));
      // onDisconnect 핸들러를 먼저 취소하여 나간 뒤 유령 데이터 재생성 방지
      await PlayerService.cancelPresence(this.roomCode, appState.playerId);
      await RoomService.leaveRoom(this.roomCode, appState.playerId);
      appState.roomCode = null;
      router.navigate('/');
    });

    document.getElementById('btn-kick-cancel')?.addEventListener('click', () => {
      this.hideKickModal();
    });

    document.getElementById('btn-kick-confirm')?.addEventListener('click', async () => {
      if (!this.pendingKickPlayer) return;
      const confirmBtn = document.getElementById('btn-kick-confirm');
      if (confirmBtn) confirmBtn.disabled = true;

      try {
        await RoomService.kickPlayer(this.roomCode, appState.playerId, this.pendingKickPlayer.id);
        this.hideKickModal();
      } catch (error) {
        console.error('강제 퇴장 실패:', error);
        if (confirmBtn) confirmBtn.disabled = false;
      }
    });

    document.getElementById('kick-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        this.hideKickModal();
      }
    });
  }

  subscribe() {
    // Presence 설정
    PlayerService.setupPresence(this.roomCode, appState.playerId);

    const exitLobby = async () => {
      if (this.hasExitedLobby) return;
      this.hasExitedLobby = true;
      this.hideKickModal();
      await PlayerService.cancelPresence(this.roomCode, appState.playerId).catch(() => {});
      appState.roomCode = null;
      router.navigate('/');
    };

    // 방 상태 감시
    const unsubRoom = RoomService.onRoomChange(this.roomCode, (data) => {
      if (!data) {
        exitLobby();
        return;
      }

      this.meta = data.meta;
      this.players = data.players || {};
      this.isHost = data.meta.hostId === appState.playerId;

      if (!this.players[appState.playerId]) {
        exitLobby();
        return;
      }

      this.botIds = BotService.getBotIdsFromPlayers(this.players);
      BotService.syncBotIds(this.botIds);

      // 게임이 시작되었으면 게임 화면으로 이동
      if (data.meta.status === 'playing') {
        router.navigate('/game/' + this.roomCode);
        return;
      }

      this.updatePlayerList();
      this.updateRoleConfig();
      this.updateTimeLimitConfig();
      this.updateVoteModeConfig();
      this.updateVoteHistoryConfig();
      this.updateStartButton();
    });

    const unsubSelf = onValue(ref(db, `rooms/${this.roomCode}/players/${appState.playerId}`), (snapshot) => {
      if (!snapshot.exists()) {
        exitLobby();
      }
    });

    // 레디 상태 감시
    const unsubReady = onValue(ref(db, `rooms/${this.roomCode}/readyStatus`), (snapshot) => {
      this.readyPlayers = snapshot.val() || {};
      this.isReady = !!this.readyPlayers[appState.playerId];
      const btn = document.getElementById('btn-ready');
      if (btn) {
        if (this.isHost) {
          btn.style.display = 'none';
        } else {
          btn.style.display = 'block';
          btn.textContent = this.isReady ? '준비 취소' : '준비 완료';
          btn.className = this.isReady ? 'btn btn-outline btn-full' : 'btn btn-good btn-full';
        }
      }
      this.updatePlayerList();
      this.updateStartButton();
    });

    this.unsubscribers.push(unsubRoom, unsubReady, unsubSelf);
  }

  updatePlayerList() {
    const list = document.getElementById('player-list');
    const entries = Object.entries(this.players).sort((a, b) => a[1].order - b[1].order);
    const count = entries.length;
    const botManager = this.isHost && count < MAX_PLAYERS ? `
      <div class="bot-add-zone">
        <span class="bot-add-title">봇 추가 영역</span>
        <button class="btn btn-outline btn-bot-add" id="btn-add-bot" type="button">봇 추가</button>
      </div>
    ` : '';

    list.innerHTML = `
      <div class="player-count">
        <span>참가자</span>
        <span class="${count >= MIN_PLAYERS ? 'text-good' : 'text-evil'}">${count}명</span>
        <span class="text-muted">/ ${MIN_PLAYERS}~${MAX_PLAYERS}명</span>
      </div>
      <ul class="player-list">
        ${entries.map(([id, player]) => `
          <li class="player-item ${!player.online ? 'player-offline' : ''} ${this.canForceKick(id) ? 'player-kickable' : ''}" data-player-id="${id}">
            <div class="player-head">
              <span class="player-name ${id === this.meta.hostId ? 'player-name-host' : ''}">${this.escapeHtml(player.name)}</span>
              <div class="player-head-badges">
                ${id.startsWith('bot_') ? '<span class="badge badge-bot">BOT</span>' : ''}
                ${(id === this.meta.hostId || this.readyPlayers[id]) ? '<span class="badge badge-good">READY</span>' : ''}
              </div>
            </div>
            <div class="player-badges">
              ${!player.online ? '<span class="badge" style="opacity:0.5">오프라인</span>' : ''}
              ${this.isHost && id.startsWith('bot_') ? `<button class="btn btn-outline btn-bot-remove" type="button" data-bot-id="${id}">삭제</button>` : ''}
            </div>
          </li>
        `).join('')}
      </ul>
      ${botManager}
    `;

    list.querySelector('#btn-add-bot')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-add-bot');
      if (!btn) return;
      btn.disabled = true;
      try {
        const currentCount = Object.keys(this.players).length;
        if (currentCount >= MAX_PLAYERS) return;
        const addedBotIds = await BotService.addBots(this.roomCode, 1);
        this.botIds = [...this.botIds, ...addedBotIds];
        BotService.syncBotIds(this.botIds);
      } catch (error) {
        console.error('봇 추가 실패:', error);
      } finally {
        btn.disabled = false;
      }
    });

    list.querySelectorAll('.btn-bot-remove').forEach((button) => {
      if (button.disabled) return;
      button.addEventListener('click', async () => {
        const botId = button.dataset.botId;
        if (!botId) return;
        button.disabled = true;
        try {
          await BotService.removeBots(this.roomCode, [botId]);
          this.botIds = this.botIds.filter(id => id !== botId);
          BotService.syncBotIds(this.botIds);
        } catch (error) {
          console.error('봇 제거 실패:', error);
          button.disabled = false;
        }
      });
    });

    this.bindKickTriggers(list);
  }

  updateRoleConfig() {
    const configSection = document.getElementById('role-config');
    configSection.style.display = 'block';
    const playerCount = Object.keys(this.players).length;
    const config = normalizeRoleConfig(playerCount, this.meta.roleConfig || { merlin: true });
    const goodSlots = TEAM_COMPOSITION[playerCount]?.good || 3;

    // 악 슬롯 수 계산 (인원 부족 시 기본 2)
    const evilSlots = TEAM_COMPOSITION[playerCount]?.evil || 2;
    // 멀린과 암살자는 기본 포함
    const normalizedConfig = normalizeRoleConfig(playerCount, config);
    const evilSpecialCount = 1
      + (config.morgana ? 1 : 0)
      + (config.mordred ? 1 : 0)
      + (config.oberon ? 1 : 0);
    const selectedOptionalEvilSpecials = getSelectedEvilSpecialCount(config);
    const maxOptionalEvilSpecials = getMaxSelectedEvilSpecials(playerCount);
    const evilSlotsFull = selectedOptionalEvilSpecials >= maxOptionalEvilSpecials;
    const goodSpecialCount = 1 + (config.percival ? 1 : 0);
    const loyalServantCount = Math.max(0, goodSlots - goodSpecialCount);
    const minionCount = Math.max(0, evilSlots - evilSpecialCount);

    const toggles = document.getElementById('role-toggles');
    const roleCards = [
      {
        key: 'merlin',
        team: 'good',
        label: '멀린',
        count: 1,
        fixed: true,
      },
      {
        key: 'percival',
        team: 'good',
        label: '퍼시벌',
        count: config.percival ? 1 : 0,
        checked: !!config.percival,
      },
      {
        key: 'loyal_servant',
        team: 'good',
        label: '충성 기사',
        count: loyalServantCount,
        fixed: true,
      },
      {
        key: 'assassin',
        team: 'evil',
        label: '암살자',
        count: 1,
        fixed: true,
      },
      {
        key: 'morgana',
        team: 'evil',
        label: '모르가나',
        count: config.morgana ? 1 : 0,
        checked: !!config.morgana,
        disabled: !config.morgana && evilSlotsFull,
      },
      {
        key: 'mordred',
        team: 'evil',
        label: '모드레드',
        count: config.mordred ? 1 : 0,
        checked: !!config.mordred,
        disabled: !config.mordred && evilSlotsFull,
      },
      {
        key: 'oberon',
        team: 'evil',
        label: '오베론',
        count: config.oberon ? 1 : 0,
        checked: !!config.oberon,
        disabled: !config.oberon && evilSlotsFull,
      },
      {
        key: 'minion',
        team: 'evil',
        label: '하수인',
        count: minionCount,
        fixed: true,
      },
    ];

    const renderTeamSection = (team, title, subtitle) => {
      const cards = roleCards.filter(card => card.team === team);
      return `
        <div class="role-team-section role-team-${team}">
          <div class="role-team-header">
            <span class="role-team-title">${title}</span>
            <span class="text-muted">${subtitle}</span>
          </div>
          <div class="role-card-grid">
            ${cards.map(card => {
              const active = card.fixed ? card.count > 0 : !!card.checked;
              const disabled = !!card.disabled;
              const cardClass = [
                'role-config-card',
                `role-config-card-${team}`,
                active ? 'role-config-card-active' : 'role-config-card-inactive',
                disabled ? 'role-config-card-disabled' : '',
                card.fixed ? 'role-config-card-fixed' : 'role-config-card-toggle',
              ].filter(Boolean).join(' ');
              const rightLabel = card.fixed
                ? '<span class="role-config-fixed">고정</span>'
                : `<span class="role-config-toggle-text">${active ? '사용' : '제외'}</span>`;
              return `
                <label class="${cardClass}">
                  <div class="role-config-main">
                    <span class="role-config-name">${card.label}</span>
                    <span class="role-config-count-badge">${card.count}명</span>
                  </div>
                  <div class="role-config-meta">
                    ${rightLabel}
                  </div>
                  ${card.fixed ? '' : `
                    <input type="checkbox" class="role-config-input" data-role="${card.key}"
                      ${card.checked ? 'checked' : ''} ${disabled || !this.isHost ? 'disabled' : ''} />
                  `}
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
    };

    toggles.innerHTML = `
      ${renderTeamSection('good', '선의 세력', `총 ${goodSlots}명`)}
      ${renderTeamSection('evil', '악의 세력', `총 ${evilSlots}명`)}
      ${this.isHost ? '' : '<p class="text-muted" style="margin-top:12px;font-size:var(--font-size-xs)">역할 구성 변경은 방장만 할 수 있습니다</p>'}
    `;

    // 토글 이벤트
    toggles.querySelectorAll('.role-config-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const role = e.target.dataset.role;
        const newConfig = normalizeRoleConfig(playerCount, {
          ...normalizedConfig,
          [role]: e.target.checked,
          merlin: true,
        });
        await RoomService.updateRoleConfig(this.roomCode, newConfig);
      });
    });
  }

  updateTimeLimitConfig() {
    const section = document.getElementById('time-config');
    if (!this.isHost) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    const container = document.getElementById('time-preset-buttons');
    const currentLimit = this.meta.timeLimitSeconds || 0;

    container.innerHTML = TIME_LIMIT_PRESETS.map(preset => `
      <button class="btn ${preset.value === currentLimit ? 'btn-primary' : 'btn-outline'} btn-time-preset"
              data-time="${preset.value}">${preset.label}</button>
    `).join('');

    container.querySelectorAll('.btn-time-preset').forEach(btn => {
      btn.addEventListener('click', async () => {
        const val = parseInt(btn.dataset.time);
        await RoomService.updateTimeLimit(this.roomCode, val);
      });
    });
  }

  updateVoteModeConfig() {
    const section = document.getElementById('vote-mode-config');
    if (!section) return;
    section.style.display = 'block';
    const toggle = document.getElementById('vote-mode-toggle');
    if (toggle) {
      toggle.checked = this.meta.voteMode === 'public';
      toggle.disabled = !this.isHost;
    }
    const label = section.querySelector('.toggle-item');
    if (label) {
      label.classList.toggle('toggle-disabled', !this.isHost);
    }
  }

  updateVoteHistoryConfig() {
    const section = document.getElementById('vote-history-config');
    if (!section) return;
    if (!this.isHost) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    const toggle = document.getElementById('vote-history-toggle');
    if (toggle) {
      const enabled = this.meta.voteHistoryEnabled !== false;
      toggle.checked = enabled;
    }
  }

  updateStartButton() {
    const btn = document.getElementById('btn-start');
    const readyBtn = document.getElementById('btn-ready');

    if (!this.isHost) {
      btn.style.display = 'none';
      if (readyBtn) readyBtn.style.display = 'block';
      return;
    }

    btn.style.display = 'block';
    if (readyBtn) readyBtn.style.display = 'none';

    const readiness = getLobbyReadiness({
      players: this.players,
      readyPlayers: this.readyPlayers,
      hostId: this.meta.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    });
    const { count, hasEnoughPlayers, nonHostPlayers, readyCount, allReady, canStart } = readiness;
    btn.disabled = !canStart;

    btn.textContent = getLobbyStartButtonLabel({
      hasEnoughPlayers,
      count,
      minPlayers: MIN_PLAYERS,
      allReady,
      readyCount,
      requiredReadyCount: nonHostPlayers.length,
    });

    // 기존 이벤트 제거 후 재등록
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '시작 중...';
      try {
        const engine = new GameEngine(this.roomCode);
        const activePlayerIds = getActivePlayerIds(this.players);
        const activePlayers = Object.fromEntries(
          activePlayerIds.map((id) => [id, this.players[id]])
        );
        const normalizedRoleConfig = normalizeRoleConfig(activePlayerIds.length, this.meta.roleConfig || { merlin: true });
        await engine.startGame(activePlayers, normalizedRoleConfig, this.meta.timeLimitSeconds || 0);
      } catch (error) {
        console.error('게임 시작 실패:', error);
        btn.disabled = false;
        btn.textContent = getLobbyStartButtonLabel({
          hasEnoughPlayers,
          count,
          minPlayers: MIN_PLAYERS,
          allReady,
          readyCount,
          requiredReadyCount: nonHostPlayers.length,
        });
      }
    };
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  canForceKick(playerId) {
    return this.isHost
      && playerId !== appState.playerId
      && playerId !== this.meta?.hostId
      && !playerId.startsWith('bot_');
  }

  bindKickTriggers(container) {
    container.querySelectorAll('.player-item[data-player-id]').forEach((item) => {
      const playerId = item.dataset.playerId;
      if (!playerId || !this.canForceKick(playerId)) return;

      item.addEventListener('dblclick', () => {
        this.openKickModal(playerId);
      });

      item.addEventListener('touchstart', () => {
        this.clearLongPressTimer();
        this.longPressTimer = setTimeout(() => {
          this.openKickModal(playerId);
        }, 550);
      }, { passive: true });

      item.addEventListener('touchend', () => this.clearLongPressTimer(), { passive: true });
      item.addEventListener('touchcancel', () => this.clearLongPressTimer(), { passive: true });
      item.addEventListener('touchmove', () => this.clearLongPressTimer(), { passive: true });
    });
  }

  clearLongPressTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  openKickModal(playerId) {
    const player = this.players[playerId];
    if (!player || !this.canForceKick(playerId)) return;

    this.pendingKickPlayer = { id: playerId, name: player.name };
    const modal = document.getElementById('kick-modal');
    const message = document.getElementById('kick-modal-message');
    const confirmBtn = document.getElementById('btn-kick-confirm');

    if (message) {
      message.textContent = `${player.name} 참가자를 강제 퇴장시키시겠습니까?`;
    }
    if (confirmBtn) {
      confirmBtn.disabled = false;
    }
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  hideKickModal() {
    this.pendingKickPlayer = null;
    this.clearLongPressTimer();
    const modal = document.getElementById('kick-modal');
    const confirmBtn = document.getElementById('btn-kick-confirm');
    if (confirmBtn) confirmBtn.disabled = false;
    if (modal) modal.style.display = 'none';
  }

  destroy() {
    this.clearLongPressTimer();
    this.unsubscribers.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
  }
}
