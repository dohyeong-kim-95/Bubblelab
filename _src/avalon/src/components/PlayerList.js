export class PlayerList {
  /**
   * @param {object} players - { id: { name, online } }
   * @param {string[]} playerOrder
   * @param {number} leaderIndex
   * @param {object} options - { selectedIds, selectableCount, onSelect, showVotes, votes, roleReveal }
   */
  static render(players, playerOrder, leaderIndex, options = {}) {
    const {
      selectedIds = [],
      selectableCount = 0,
      isSelectable = false,
      showVotes = false,
      votes = {},
      roleReveal = null,
      teamMembers = [],
    } = options;

    // Reorder players starting from the current leader
    const sortedOrder = [];
    for (let i = 0; i < playerOrder.length; i++) {
      sortedOrder.push(playerOrder[(leaderIndex + i) % playerOrder.length]);
    }

    return `
      <ul class="game-player-list">
        ${sortedOrder.map((id, index) => {
          const player = players[id];
          if (!player) return '';

          const isLeader = index === 0;
          const isSelected = selectedIds.includes(id);
          const isTeamMember = teamMembers.includes(id);
          const vote = votes[id];
          const revealed = roleReveal?.[id];

          let voteDisplay = '';
          if (showVotes && vote) {
            const isApprove = vote === 'approve';
            voteDisplay = `<span class="vote-badge ${isApprove ? 'vote-approve' : 'vote-reject'}">${isApprove ? '찬성' : '반대'}</span>`;
          }

          let roleDisplay = '';
          if (revealed) {
            const teamClass = revealed.team === 'good' ? 'text-good' : 'text-evil';
            roleDisplay = `<span class="badge ${revealed.team === 'good' ? 'badge-good' : 'badge-evil'}">${PlayerList.getRoleName(revealed.role)}</span>`;
          }

          return `
            <li class="game-player-item ${isSelected ? 'player-selected' : ''} ${isTeamMember ? 'player-team' : ''} ${!player.online ? 'player-offline' : ''}"
                ${isSelectable ? `data-player-id="${id}"` : ''}>
              <div class="game-player-info">
                <div class="game-player-head">
                  ${isLeader ? '<span class="leader-icon" title="리더">&#9813;</span>' : '<span class="leader-icon-placeholder"></span>'}
                  <span class="game-player-name">${PlayerList.escapeHtml(player.name)}</span>
                  <div class="game-player-head-badges">
                    ${isTeamMember ? '<span class="badge badge-leader">팀원</span>' : ''}
                  </div>
                </div>
              </div>
              <div class="game-player-badges">
                ${voteDisplay}
                ${roleDisplay}
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  static getRoleName(role) {
    const names = {
      merlin: '멀린',
      percival: '퍼시벌',
      loyal_servant: '충성 기사',
      assassin: '암살자',
      morgana: '모르가나',
      mordred: '모드레드',
      oberon: '오베론',
      minion: '하수인',
    };
    return names[role] || role;
  }

  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
