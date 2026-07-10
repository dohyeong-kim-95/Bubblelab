import { router } from '../router.js';
import { appState } from '../main.js';
import { db, ref, update, remove } from '../firebase.js';
import { RoomService } from '../services/RoomService.js';
import { PlayerService } from '../services/PlayerService.js';
import { PlayerList } from '../components/PlayerList.js';
import { MissionTrack } from '../components/MissionTrack.js';
import { ROLE_INFO } from '../config/gameConfig.js';
import { BotService } from '../services/BotService.js';
import { getResultRouteDecision } from '../result/resultState.js';
import '../styles/result.css';
import '../styles/game.css';

export class ResultView {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.container = document.getElementById('app');
    this.unsubscribers = [];
    this.expandedVoteHistory = new Set([1]);
  }

  render() {
    this.container.innerHTML = `
      <div class="view result-view fade-in">
        <div id="result-content">
          <div class="flex-center"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    this.subscribe();
  }

  subscribe() {
    const unsub = RoomService.onRoomChange(this.roomCode, (data) => {
      const decision = getResultRouteDecision(data);
      if (decision.route === '/') {
        router.navigate('/');
        return;
      }
      if (decision.route === 'lobby') {
        router.navigate('/lobby/' + this.roomCode);
        return;
      }
      this.renderResult(data);
    });
    this.unsubscribers.push(unsub);
  }

  renderVoteHistorySection(voteHistory, playerOrder, players) {
    if (!voteHistory || voteHistory.length === 0) return '';

    // 미션별로 그룹화
    const missionGroups = {};
    for (const entry of voteHistory) {
      const m = entry.mission;
      if (!missionGroups[m]) missionGroups[m] = [];
      missionGroups[m].push(entry);
    }

    let tablesHtml = '';
    for (const [mission, entries] of Object.entries(missionGroups)) {
      const missionNumber = Number(mission) + 1;
      const isOpen = this.expandedVoteHistory.has(missionNumber);
      tablesHtml += `<section class="vote-history-mission-group ${isOpen ? 'is-open' : ''}" data-mission-group="${missionNumber}">`;
      tablesHtml += `
        <button class="vote-history-mission-title" type="button" data-mission-toggle="${missionNumber}" aria-expanded="${isOpen ? 'true' : 'false'}">
          <span>미션 ${missionNumber}</span>
          <span class="vote-history-toggle-icon">${isOpen ? '-' : '+'}</span>
        </button>
      `;
      tablesHtml += `<div class="vote-history-table-wrap" style="display:${isOpen ? 'block' : 'none'}"><table class="vote-history-table">`;
      tablesHtml += `<thead><tr><th class="vote-history-name-col"></th>`;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const leaderName = players[e.leaderId]?.name || '???';
        tablesHtml += `<th class="vote-history-round-col ${e.approved ? 'vh-approved' : 'vh-rejected'}">
          <div class="vh-round-num">${i + 1}차</div>
          <div class="vh-leader">${PlayerList.escapeHtml(leaderName)}</div>
          <div class="vh-team">${(e.teamMembers || []).map(id => PlayerList.escapeHtml(players[id]?.name || '?')).join(', ')}</div>
        </th>`;
      }
      tablesHtml += `</tr></thead><tbody>`;

      for (const pid of playerOrder) {
        const name = players[pid]?.name || '???';
        tablesHtml += `<tr><td class="vote-history-name-col">${PlayerList.escapeHtml(name)}</td>`;
        for (const e of entries) {
          const vote = e.playerVotes?.[pid];
          if (vote === 'approve') {
            tablesHtml += `<td class="vh-vote vh-vote-approve">O</td>`;
          } else if (vote === 'reject') {
            tablesHtml += `<td class="vh-vote vh-vote-reject">X</td>`;
          } else {
            tablesHtml += `<td class="vh-vote">-</td>`;
          }
        }
        tablesHtml += `</tr>`;
      }
      tablesHtml += `</tbody></table></div></section>`;
    }

    return `
      <div class="result-vote-history card">
        <h3 class="text-center mb-md" style="color:var(--color-gold)">투표 기록</h3>
        ${tablesHtml}
      </div>
    `;
  }

  renderResult(data) {
    const state = data.gameState;
    const players = data.players || {};
    const { winner, winReason, roleReveal, missionResults, playerOrder } = state;

    const isGoodWin = winner === 'good';
    const winnerText = isGoodWin ? '선의 세력 승리' : '악의 세력 승리';
    const winnerClass = isGoodWin ? 'text-good' : 'text-evil';
    const isHost = data.meta?.hostId === appState.playerId;

    const playerCount = playerOrder?.length || Object.keys(players).length;
    const missionTrack = MissionTrack.render(playerCount, missionResults || [], 5);

    // 역할 공개 목록
    let roleList = '';
    if (roleReveal && playerOrder) {
      roleList = `
        <div class="result-roles card">
          <h3 class="text-center mb-md">전체 역할 공개</h3>
          <ul class="result-role-list">
            ${playerOrder.map(id => {
              const player = players[id];
              const revealed = roleReveal[id];
              if (!player || !revealed) return '';

              const info = ROLE_INFO[revealed.role];
              const teamClass = revealed.team === 'good' ? 'badge-good' : 'badge-evil';

              return `
                <li class="result-role-item">
                  <span class="result-player-name">${PlayerList.escapeHtml(player.name)}</span>
                  <span class="badge ${teamClass}">${info?.name || revealed.role}</span>
                </li>
              `;
            }).join('')}
          </ul>
        </div>
      `;
    }

    // 투표 히스토리
    const voteHistorySection = this.renderVoteHistorySection(
      state.voteHistory, playerOrder || [], players
    );

    const content = document.getElementById('result-content');
    content.innerHTML = `
      <div class="result-hero ${isGoodWin ? 'result-good' : 'result-evil'}">
        <h1 class="${winnerClass}">${winnerText}</h1>
        <p class="result-reason">${winReason || ''}</p>
      </div>
      ${missionTrack}
      ${roleList}
      ${voteHistorySection}
      <div class="result-actions mt-xl">
        <button class="btn btn-primary btn-full" id="btn-replay">${isHost ? '다시 하기' : '로비로 이동'}</button>
        <button class="btn btn-outline btn-full" id="btn-home">홈으로</button>
      </div>
    `;

    // 이벤트
    document.getElementById('btn-replay')?.addEventListener('click', async () => {
      // 방장이면 방 상태를 waiting으로 되돌리기
      if (data.meta.hostId === appState.playerId) {
        await BotService.removeAllBotsFromPlayers(this.roomCode, data.players || {});
        await update(ref(db, `rooms/${this.roomCode}/meta`), { status: 'waiting' });
        await remove(ref(db, `rooms/${this.roomCode}/gameState`));
        await remove(ref(db, `privateData/${this.roomCode}`));
        await remove(ref(db, `rooms/${this.roomCode}/actions`));
        await remove(ref(db, `rooms/${this.roomCode}/readyStatus`));
        await remove(ref(db, `rooms/${this.roomCode}/chat`));
      }
      router.navigate('/lobby/' + this.roomCode);
    });

    document.getElementById('btn-home')?.addEventListener('click', async () => {
      await PlayerService.cancelPresence(this.roomCode, appState.playerId);
      await RoomService.leaveRoom(this.roomCode, appState.playerId);
      appState.roomCode = null;
      router.navigate('/');
    });

    content.querySelectorAll('[data-mission-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const missionNumber = Number(button.dataset.missionToggle);
        if (!missionNumber) return;

        if (this.expandedVoteHistory.has(missionNumber)) {
          this.expandedVoteHistory.delete(missionNumber);
        } else {
          this.expandedVoteHistory.add(missionNumber);
        }

        this.renderResult(data);
      });
    });
  }

  destroy() {
    this.unsubscribers.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
  }
}
