import assert from 'node:assert/strict';
import { MIN_PLAYERS, MISSION_TEAM_SIZE } from '../src/config/gameConfig.js';
import { getLobbyStartButtonLabel } from '../src/ui/labelState.js';
import {
  getMissionActionLabels,
  getMissionResultButtonLabel,
  getRoleRevealButtonLabel,
  getTeamProposalButtonLabel,
  getVoteCompleteButtonLabel,
  getVoteResultButtonLabel,
  getVoteStatusMessage,
  getWaitingForOthersButtonLabel,
} from '../src/ui/labelState.js';

function testLobbyLabelsAcrossPlayerCounts() {
  for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
    const waitingLabel = getLobbyStartButtonLabel({
      hasEnoughPlayers: true,
      count: playerCount,
      minPlayers: MIN_PLAYERS,
      allReady: false,
      readyCount: playerCount - 2,
      requiredReadyCount: playerCount - 1,
    });
    assert.equal(waitingLabel, `준비 대기 중 (${playerCount - 2}/${playerCount - 1})`);

    const readyLabel = getLobbyStartButtonLabel({
      hasEnoughPlayers: true,
      count: playerCount,
      minPlayers: MIN_PLAYERS,
      allReady: true,
      readyCount: playerCount - 1,
      requiredReadyCount: playerCount - 1,
    });
    assert.equal(readyLabel, '게임 시작');
  }
}

function testLobbyMinimumPlayerLabel() {
  const label = getLobbyStartButtonLabel({
    hasEnoughPlayers: false,
    count: 4,
    minPlayers: MIN_PLAYERS,
    allReady: false,
    readyCount: 3,
    requiredReadyCount: 3,
  });

  assert.equal(label, '최소 5명이 필요합니다 (현재 4명)');
}

function testStaticStageLabels() {
  assert.equal(getRoleRevealButtonLabel(false), '확인');
  assert.equal(getRoleRevealButtonLabel(true), '다른 플레이어를 기다리는 중....');
  assert.equal(getVoteCompleteButtonLabel(), '투표 완료');
  assert.equal(getVoteResultButtonLabel(), '다음');
  assert.equal(getWaitingForOthersButtonLabel(), '다른 플레이어를 기다리는 중....');

  const missionLabels = getMissionActionLabels();
  assert.deepEqual(missionLabels, { success: '성공', fail: '실패' });
}

function testMissionResultLabels() {
  assert.equal(getMissionResultButtonLabel(false), '다음');
  assert.equal(getMissionResultButtonLabel(true), '다른 플레이어를 기다리는 중....');
}

function testVoteStatusMessages() {
  assert.equal(getVoteStatusMessage(null), '투표 완료. 결과 대기 중...');
  assert.equal(getVoteStatusMessage('approve'), '투표가 완료되었습니다!\n당신의 선택은 찬성입니다.');
  assert.equal(getVoteStatusMessage('reject'), '투표가 완료되었습니다!\n당신의 선택은 반대입니다.');
}

function testTeamProposalLabelsAcrossAllMissions() {
  for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
    const missionSizes = MISSION_TEAM_SIZE[playerCount];
    assert.equal(missionSizes.length, 5);

    missionSizes.forEach((requiredSize) => {
      assert.equal(getTeamProposalButtonLabel(0, requiredSize), `팀 제안 (0/${requiredSize})`);
      assert.equal(getTeamProposalButtonLabel(requiredSize, requiredSize), `팀 제안 (${requiredSize}/${requiredSize})`);
    });
  }
}

function run() {
  const tests = [
    testLobbyLabelsAcrossPlayerCounts,
    testLobbyMinimumPlayerLabel,
    testStaticStageLabels,
    testMissionResultLabels,
    testVoteStatusMessages,
    testTeamProposalLabelsAcrossAllMissions,
  ];

  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }
}

run();
