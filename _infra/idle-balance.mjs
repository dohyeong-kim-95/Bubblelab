import {
  FLOW_MULTIPLIER, GENERATORS, PRESSURE_UPGRADES, RUN_MS, flowUpgradeCost, freshState,
  generatorCost, generatorProduction, pressurePerSecond, pressureUpgradeCost, productionPerSecond,
} from "../idle/bubble-pop/game-core.js";

export const EXHAUSTION_RULES = Object.freeze({
  meaningfulWaitSeconds: 12 * 60 * 60,
  meaningfulGain: .10,
});

const PRESSURE_VALUES = Object.freeze({ flow: .35, pop: .20, storage: .25, compression: .30 });

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
    const flowGain = productionPerSecond(state) * (FLOW_MULTIPLIER - 1);
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

function buyBubbleInvestments(state, limit = 200) {
  let purchases = 0;
  while (purchases < limit) {
    const choices = GENERATORS
      .filter((generator) => state.lifetime >= generator.unlockAt)
      .map((generator) => {
        const owned = state.generators[generator.id];
        const cost = generatorCost(generator, owned);
        const gain = generatorProduction(generator, owned + 1, state.flowLevel) -
          generatorProduction(generator, owned, state.flowLevel);
        const pressureFlow = 1.35 ** state.pressureUpgrades.flow;
        return { type: "generator", generator, cost, payback: cost / (gain * pressureFlow) };
      });
    const flowCost = flowUpgradeCost(state.flowLevel);
    const flowGain = productionPerSecond(state) * (FLOW_MULTIPLIER - 1);
    choices.push({ type: "flow", cost: flowCost, payback: flowGain ? flowCost / flowGain : Infinity });
    choices.sort((left, right) => left.payback - right.payback);
    const purchase = choices.find(({ cost }) => cost <= state.bubbles);
    if (!purchase) break;
    state.bubbles -= purchase.cost;
    if (purchase.type === "flow") state.flowLevel++;
    else state.generators[purchase.generator.id]++;
    purchases++;
  }
  return purchases;
}

function nextPressureInvestment(state) {
  const choices = PRESSURE_UPGRADES.map((upgrade) => {
    const level = state.pressureUpgrades[upgrade.id];
    const cost = pressureUpgradeCost(upgrade, level);
    const untried = level === 0;
    return { upgrade, cost, untried, value: PRESSURE_VALUES[upgrade.id] };
  });
  const untried = choices.filter((choice) => choice.untried);
  const pool = untried.length ? untried : choices;
  pool.sort((left, right) => {
    if (left.cost !== right.cost) return left.cost - right.cost;
    return right.value - left.value;
  });
  if (!untried.length) pool.sort((left, right) =>
    right.value / right.cost - left.value / left.cost);
  return pool[0];
}

const formatDuration = (seconds) => {
  if (seconds === null || !Number.isFinite(seconds)) return "도달하지 않음";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}일 ${hours}시간` : hours ? `${hours}시간 ${minutes}분` : `${minutes}분`;
};

export function simulateSeason({
  durationSeconds = RUN_MS / 1000,
  stepSeconds = 10,
  meaningfulWaitSeconds = EXHAUSTION_RULES.meaningfulWaitSeconds,
  meaningfulGain = EXHAUSTION_RULES.meaningfulGain,
} = {}) {
  const firstLayer = simulateFirstLayer();
  const state = firstLayer.state;
  let seconds = firstLayer.seconds;
  const pressureFirstPurchases = {};
  let allMechanicsTriedAt = null;
  let repetitionOnlyAt = null;
  let waitWallAt = null;
  let contentExhaustedAt = null;

  while (seconds < durationSeconds) {
    const elapsed = Math.min(stepSeconds, durationSeconds - seconds);
    const bubbles = productionPerSecond(state) * elapsed;
    const pressure = pressurePerSecond(state) * elapsed;
    state.bubbles += bubbles;
    state.lifetime += bubbles;
    state.pressure += pressure;
    state.pressureLifetime += pressure;
    seconds += elapsed;
    buyBubbleInvestments(state);

    let pressureChoice = nextPressureInvestment(state);
    let pressurePurchases = 0;
    while (pressureChoice && pressureChoice.cost <= state.pressure && pressurePurchases < 50) {
      state.pressure -= pressureChoice.cost;
      state.pressureUpgrades[pressureChoice.upgrade.id]++;
      pressureFirstPurchases[pressureChoice.upgrade.id] ??= seconds;
      pressurePurchases++;
      pressureChoice = nextPressureInvestment(state);
    }

    if (allMechanicsTriedAt === null && PRESSURE_UPGRADES.every(({ id }) => pressureFirstPurchases[id])) {
      allMechanicsTriedAt = seconds;
      repetitionOnlyAt = seconds;
    }

    if (allMechanicsTriedAt !== null && pressureChoice) {
      const rate = pressurePerSecond(state);
      const eta = rate > 0 ? Math.max(0, pressureChoice.cost - state.pressure) / rate : Infinity;
      const waitWall = eta >= meaningfulWaitSeconds;
      const weakReward = pressureChoice.value < meaningfulGain;
      if (waitWallAt === null && waitWall) waitWallAt = seconds;
      if (contentExhaustedAt === null && (waitWall || weakReward)) contentExhaustedAt = seconds;
    }
  }

  return {
    durationSeconds,
    firstLayerCompletedAt: firstLayer.seconds,
    pressureFirstPurchases,
    allMechanicsTriedAt,
    repetitionOnlyAt,
    waitWallAt,
    contentExhaustedAt,
    gapAfterExhaustion: contentExhaustedAt === null ? null : durationSeconds - contentExhaustedAt,
    final: {
      bubbles: state.lifetime,
      pressure: state.pressureLifetime,
      pressureUpgrades: { ...state.pressureUpgrades },
      generators: { ...state.generators },
      flowLevel: state.flowLevel,
    },
  };
}

if (process.argv[1]?.endsWith("idle-balance.mjs")) {
  const firstLayer = simulateFirstLayer();
  console.table(Object.entries(firstLayer.unlockTimes).map(([generator, seconds]) => ({
    generator,
    seconds: Math.round(seconds),
    minutes: (seconds / 60).toFixed(1),
  })));
  console.log(`first layer lower bound: ${(firstLayer.seconds / 60).toFixed(1)} minutes`);
  const season = simulateSeason();
  console.table([
    ["기본 계층 완료", season.firstLayerCompletedAt],
    ["네 압력 경로 모두 체험", season.allMechanicsTriedAt],
    ["반복만 남은 시점", season.repetitionOnlyAt],
    ["12시간 대기벽", season.waitWallAt],
    ["콘텐츠 소진 추정", season.contentExhaustedAt],
    ["소진 후 시즌 공백", season.gapAfterExhaustion],
  ].map(([metric, value]) => ({ metric, at: formatDuration(value) })));
  console.log("pressure levels:", season.final.pressureUpgrades);
}
