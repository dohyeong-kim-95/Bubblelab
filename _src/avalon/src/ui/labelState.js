export function getLobbyStartButtonLabel({ hasEnoughPlayers, count, minPlayers, allReady, readyCount, requiredReadyCount }) {
  if (!hasEnoughPlayers) {
    return `최소 ${minPlayers}명이 필요합니다 (현재 ${count}명)`;
  }

  if (!allReady) {
    return `준비 대기 중 (${readyCount}/${requiredReadyCount})`;
  }

  return '게임 시작';
}

export function getTeamProposalButtonLabel(selectedCount, requiredSize) {
  return `팀 제안 (${selectedCount}/${requiredSize})`;
}

export function getRoleRevealButtonLabel(hasConfirmed = false) {
  return hasConfirmed ? '다른 플레이어를 기다리는 중....' : '확인';
}

export function getVoteCompleteButtonLabel() {
  return '투표 완료';
}

export function getVoteResultButtonLabel() {
  return '다음';
}

export function getWaitingForOthersButtonLabel() {
  return '다른 플레이어를 기다리는 중....';
}

export function getMissionActionLabels() {
  return {
    success: '성공',
    fail: '실패',
  };
}

export function getMissionResultButtonLabel(hasConfirmedNext) {
  return hasConfirmedNext ? getWaitingForOthersButtonLabel() : '다음';
}

export function getVoteStatusMessage(submittedVote) {
  if (!submittedVote) {
    return '투표 완료. 결과 대기 중...';
  }

  const voteLabel = submittedVote === 'approve' ? '찬성' : '반대';
  return `투표가 완료되었습니다!\n당신의 선택은 ${voteLabel}입니다.`;
}
