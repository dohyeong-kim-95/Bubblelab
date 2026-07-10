import assert from 'node:assert/strict';
import { MISSION_TEAM_SIZE, getRequiredFails } from '../src/config/gameConfig.js';
import { judgeMissionCards } from '../src/game/missionState.js';

function testMissionTeamSizesMatchExpectedTable() {
  const expected = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };

  for (const [playerCount, sizes] of Object.entries(expected)) {
    assert.deepEqual(
      MISSION_TEAM_SIZE[playerCount],
      sizes,
      `${playerCount}인 게임 미션 인원수가 기대값과 달라서는 안 됩니다`
    );
  }
}

function testRequiredFailsRule() {
  for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
    for (let missionIndex = 0; missionIndex < 5; missionIndex += 1) {
      const requiredFails = getRequiredFails(playerCount, missionIndex);
      const expected = missionIndex === 3 && playerCount >= 7 ? 2 : 1;
      assert.equal(
        requiredFails,
        expected,
        `${playerCount}인 ${missionIndex + 1}번째 미션 requiredFails 값이 잘못됐습니다`
      );
    }
  }
}

function testFourthMissionTwoFailsOnlyForSevenPlusPlayers() {
  const oneFailCards = {
    a: { card: 'success' },
    b: { card: 'success' },
    c: { card: 'fail' },
    d: { card: 'success' },
    e: { card: 'success' },
  };
  const twoFailCards = {
    a: { card: 'success' },
    b: { card: 'fail' },
    c: { card: 'fail' },
    d: { card: 'success' },
    e: { card: 'success' },
  };

  const sixPlayerFourthMission = judgeMissionCards(oneFailCards, 6, 3);
  assert.equal(sixPlayerFourthMission.success, false, '6인 4번째 미션은 실패 1장만 있어도 실패해야 합니다');

  const sevenPlayerFourthMissionOneFail = judgeMissionCards(oneFailCards, 7, 3);
  assert.equal(sevenPlayerFourthMissionOneFail.success, true, '7인 4번째 미션은 실패 1장만으로는 성공이어야 합니다');

  const sevenPlayerFourthMissionTwoFail = judgeMissionCards(twoFailCards, 7, 3);
  assert.equal(sevenPlayerFourthMissionTwoFail.success, false, '7인 4번째 미션은 실패 2장이면 실패해야 합니다');

  const tenPlayerFourthMissionOneFail = judgeMissionCards(oneFailCards, 10, 3);
  assert.equal(tenPlayerFourthMissionOneFail.success, true, '10인 4번째 미션은 실패 1장만으로는 성공이어야 합니다');

  const tenPlayerFourthMissionTwoFail = judgeMissionCards(twoFailCards, 10, 3);
  assert.equal(tenPlayerFourthMissionTwoFail.success, false, '10인 4번째 미션은 실패 2장이면 실패해야 합니다');
}

function run() {
  const tests = [
    testMissionTeamSizesMatchExpectedTable,
    testRequiredFailsRule,
    testFourthMissionTwoFailsOnlyForSevenPlusPlayers,
  ];

  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }
}

run();
