export class VoteResult {
  static render(voteResult, players) {
    if (!voteResult) return '';

    const { approved, approveCount, rejectCount, details } = voteResult;

    return `
      <div class="vote-result-panel ${approved ? 'vote-approved' : 'vote-rejected'}">
        <div class="vote-result-title">
          ${approved ? '팀 구성 승인' : '팀 구성 거부'}
        </div>
        <div class="vote-result-count">
          <span class="text-good">찬성 ${approveCount}</span>
          <span class="text-muted">/</span>
          <span class="text-evil">반대 ${rejectCount}</span>
        </div>
      </div>
    `;
  }
}
