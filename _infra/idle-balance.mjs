import {
  GENERATORS, flowUpgradeCost, freshState, generatorCost, generatorProduction,
  productionPerSecond,
} from "../idle/bubble-pop/game-core.js";

// 사람이 망설이지 않고 투자 회수 시간이 가장 짧은 항목을 계속 사는 이론적 하한선이다.
// 실제 플레이 테스트는 이 결과보다 약 2~4배 오래 걸렸다.
export function simulateFirstLayer({ stepSeconds = .1, maxSeconds = 24 * 60 * 60 } = {}) {
  const state = freshState(Date.UTC(2026, 6, 13));
  const unlockTimes = { wand: 0 };
  let seconds = 0;

  while (seconds < maxSeconds && !state.generators.ocean) {
    const earned = productionPerSecond(state) * stepSeconds;
    state.bubbles += earned;
    state.lifetime += earned;
    seconds += stepSeconds;

    for (const generator of GENERATORS) {
      if (unlockTimes[generator.id] === undefined && state.lifetime >= generator.unlockAt) {
        unlockTimes[generator.id] = seconds;
      }
    }

    const choices = GENERATORS
      .filter((generator) => state.lifetime >= generator.unlockAt)
      .map((generator) => {
        const owned = state.generators[generator.id];
        const cost = generatorCost(generator, owned);
        const gain = generatorProduction(generator, owned + 1, state.flowLevel) -
          generatorProduction(generator, owned, state.flowLevel);
        return { type: "generator", generator, cost, payback: cost / gain };
      });

    const flowCost = flowUpgradeCost(state.flowLevel);
    const flowGain = productionPerSecond(state) * .6;
    choices.push({ type: "flow", cost: flowCost, payback: flowGain ? flowCost / flowGain : Infinity });
    choices.sort((left, right) => left.payback - right.payback);

    const purchase = choices.find(({ cost }) => cost <= state.bubbles);
    if (!purchase) continue;
    state.bubbles -= purchase.cost;
    if (purchase.type === "flow") state.flowLevel++;
    else state.generators[purchase.generator.id]++;
  }

  return { seconds, unlockTimes, state, completed: state.generators.ocean > 0 };
}

if (process.argv[1]?.endsWith("idle-balance.mjs")) {
  const result = simulateFirstLayer();
  console.table(Object.entries(result.unlockTimes).map(([generator, seconds]) => ({
    generator,
    seconds: Math.round(seconds),
    minutes: (seconds / 60).toFixed(1),
  })));
  console.log(`first layer lower bound: ${(result.seconds / 60).toFixed(1)} minutes`);
}
