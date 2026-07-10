import { MISSION_TEAM_SIZE, getRequiredFails } from '../config/gameConfig.js';

export class MissionTrack {
  /**
   * @param {number} playerCount
   * @param {Array} missionResults - [null|'success'|'fail', ...]
   * @param {number} currentMission - 0-indexed
   */
  static render(playerCount, missionResults, currentMission) {
    const sizes = MISSION_TEAM_SIZE[playerCount] || MISSION_TEAM_SIZE[5];
    const results = missionResults || [];

    return `
      <div class="mission-track">
        ${sizes.map((size, i) => {
          const result = results[i];
          const isCurrent = i === currentMission && result !== 'success' && result !== 'fail';
          const requiresTwoFails = getRequiredFails(playerCount, i) === 2;

          let statusClass = '';
          let statusIcon = '';
          if (result === 'success') {
            statusClass = 'mission-success';
            statusIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
          } else if (result === 'fail') {
            statusClass = 'mission-fail';
            statusIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
          } else {
            statusIcon = `<span class="mission-num">${size}</span>`;
          }

          return `
            <div class="mission-slot ${statusClass} ${isCurrent ? 'mission-current' : ''}">
              ${statusIcon}
              ${requiresTwoFails ? '<span class="mission-two-fails">2F</span>' : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}
