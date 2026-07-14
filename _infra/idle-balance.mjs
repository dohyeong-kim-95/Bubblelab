import {
  FLOW_MULTIPLIER, GENERATORS, PRESSURE_BASE_PRODUCTION, PRESSURE_RATE, PRESSURE_UPGRADES, REVIVAL_RULES, RUN_MS, flowUpgradeCost, freshState,
  generatorCost, generatorProduction, pressurePerSecond, pressureUpgradeCost, productionPerSecond, projectedRevivalCost,
} from "../idle/bubble-pop/game-core.js";
export { REVIVAL_RULES } from "../idle/bubble-pop/game-core.js";

export const EXHAUSTION_RULES = Object.freeze({
  meaningfulWaitSeconds: 12 * 60 * 60,
  meaningfulGain: .10,
});

const PRESSURE_VALUES = Object.freeze({ flow: .35, pop: .20, storage: .25, compression: .30 });
const niceMultiplier = (value) => {
  if (value <= 1) return 1;
  const scale = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.ceil(value / scale) * scale;
};

const revivalMultiplier = (state, generatorId) => state.revivalMultipliers?.[generatorId] || 1;

function simulatedGeneratorProduction(state, generator) {
  return generatorProduction(generator, state.generators[generator.id] || 0, state.flowLevel) *
    revivalMultiplier(state, generator.id);
}

function simulatedProductionPerSecond(state) {
  const base = GENERATORS.reduce((sum, generator) =>
    sum + simulatedGeneratorProduction(state, generator), 0);
  return base * 1.35 ** (state.pressureUpgrades?.flow || 0);
}

function simulatedPressurePerSecond(state) {
  if (!GENERATORS.every(({ id }) => (state.generators[id] || 0) > 0)) return 0;
  return Math.sqrt(simulatedProductionPerSecond(state) / PRESSURE_BASE_PRODUCTION) *
    PRESSURE_RATE * 1.6 ** (state.pressureUpgrades?.compression || 0);
}

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
        const gain = (generatorProduction(generator, owned + 1, state.flowLevel) -
          generatorProduction(generator, owned, state.flowLevel)) * revivalMultiplier(state, generator.id);
        const pressureFlow = 1.35 ** state.pressureUpgrades.flow;
        return { type: "generator", generator, cost, payback: cost / (gain * pressureFlow) };
      });
    const flowCost = flowUpgradeCost(state.flowLevel);
    const flowGain = simulatedProductionPerSecond(state) * (FLOW_MULTIPLIER - 1);
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

function generatorRatios(state) {
  const production = Object.fromEntries(GENERATORS.map((generator) =>
    [generator.id, simulatedGeneratorProduction(state, generator)]));
  const best = Math.max(...Object.values(production));
  return Object.fromEntries(GENERATORS.map(({ id }) => [id, best / production[id]]));
}

function discoverRevivalCandidates(state, revival) {
  const ratios = generatorRatios(state);
  for (const { id } of GENERATORS) {
    const tier = revival.purchased[id] + 1;
    const key = `${id}:${tier}`;
    if (!revival.eligible.has(key) && ratios[id] >= REVIVAL_RULES.unlockRatio) {
      revival.eligible.set(key, { id, tier, ratio: ratios[id], eligibleAt: revival.now });
    }
  }
  if (!revival.offer) {
    const queued = [...revival.eligible.values()]
      .filter(({ id, tier }) => revival.purchased[id] < tier)
      .sort((left, right) => left.ratio - right.ratio);
    const candidate = queued[0];
    if (candidate) {
      revival.offer = {
        ...candidate,
        multiplier: niceMultiplier(candidate.ratio / REVIVAL_RULES.targetRatio),
        cost: projectedRevivalCost(state),
        offeredAt: revival.now,
      };
    }
  }
}

function buyRevivalOffer(state, revival) {
  const offer = revival.offer;
  if (!offer || state.pressure < offer.cost) return false;
  state.pressure -= offer.cost;
  state.revivalMultipliers[offer.id] *= offer.multiplier;
  revival.purchased[offer.id] = offer.tier;
  revival.purchases.push({ ...offer, purchasedAt: revival.now });
  revival.offer = null;
  return true;
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
  revivalEnabled = true,
} = {}) {
  const firstLayer = simulateFirstLayer();
  const state = firstLayer.state;
  state.revivalMultipliers = Object.fromEntries(GENERATORS.map(({ id }) => [id, 1]));
  let seconds = firstLayer.seconds;
  const pressureFirstPurchases = {};
  let allMechanicsTriedAt = null;
  let repetitionOnlyAt = null;
  let waitWallAt = null;
  let contentExhaustedAt = null;
  const revival = {
    now: seconds,
    eligible: new Map(),
    offer: null,
    purchased: Object.fromEntries(GENERATORS.map(({ id }) => [id, 0])),
    purchases: [],
  };

  while (seconds < durationSeconds) {
    const elapsed = Math.min(stepSeconds, durationSeconds - seconds);
    const bubbles = simulatedProductionPerSecond(state) * elapsed;
    const pressure = simulatedPressurePerSecond(state) * elapsed;
    state.bubbles += bubbles;
    state.lifetime += bubbles;
    state.pressure += pressure;
    state.pressureLifetime += pressure;
    seconds += elapsed;
    revival.now = seconds;
    buyBubbleInvestments(state);
    if (revivalEnabled) discoverRevivalCandidates(state, revival);

    // 화면에 나온 보정 아이템을 위해 압력을 모은 뒤, 남는 압력만 반복 업그레이드에 쓴다.
    if (revivalEnabled && buyRevivalOffer(state, revival)) {
      repetitionOnlyAt = seconds;
      discoverRevivalCandidates(state, revival);
    }

    let pressureChoice = nextPressureInvestment(state);
    let pressurePurchases = 0;
    while (!revival.offer && pressureChoice && pressureChoice.cost <= state.pressure && pressurePurchases < 50) {
      state.pressure -= pressureChoice.cost;
      state.pressureUpgrades[pressureChoice.upgrade.id]++;
      pressureFirstPurchases[pressureChoice.upgrade.id] ??= seconds;
      pressurePurchases++;
      pressureChoice = nextPressureInvestment(state);
    }

    if (allMechanicsTriedAt === null && PRESSURE_UPGRADES.every(({ id }) => pressureFirstPurchases[id])) {
      allMechanicsTriedAt = seconds;
      repetitionOnlyAt ??= seconds;
    }

    if (allMechanicsTriedAt !== null && pressureChoice) {
      const rate = simulatedPressurePerSecond(state);
      const nextCost = revival.offer?.cost ?? pressureChoice.cost;
      const eta = rate > 0 ? Math.max(0, nextCost - state.pressure) / rate : Infinity;
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
    revivalPurchases: revival.purchases,
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
      revivalMultipliers: { ...state.revivalMultipliers },
      generatorProduction: Object.fromEntries(GENERATORS.map((generator) =>
        [generator.id, simulatedGeneratorProduction(state, generator)])),
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
  const baseline = simulateSeason({ revivalEnabled: false });
  console.table([
    ["기본 계층 완료", season.firstLayerCompletedAt],
    ["네 압력 경로 모두 체험", season.allMechanicsTriedAt],
    ["반복만 남은 시점", season.repetitionOnlyAt],
    ["12시간 대기벽", season.waitWallAt],
    ["콘텐츠 소진 추정", season.contentExhaustedAt],
    ["소진 후 시즌 공백", season.gapAfterExhaustion],
  ].map(([metric, value]) => ({ metric, at: formatDuration(value) })));
  console.log("pressure levels:", season.final.pressureUpgrades);
  console.table([
    { metric: "7일 누적 버블", baseline: baseline.final.bubbles.toExponential(3), revival: season.final.bubbles.toExponential(3), change: `${(season.final.bubbles / baseline.final.bubbles).toFixed(2)}x` },
    { metric: "7일 누적 압력", baseline: baseline.final.pressure.toExponential(3), revival: season.final.pressure.toExponential(3), change: `${(season.final.pressure / baseline.final.pressure).toFixed(2)}x` },
    { metric: "반복만 남은 시점", baseline: formatDuration(baseline.repetitionOnlyAt), revival: formatDuration(season.repetitionOnlyAt), change: "" },
    { metric: "콘텐츠 소진", baseline: formatDuration(baseline.contentExhaustedAt), revival: formatDuration(season.contentExhaustedAt), change: "" },
  ]);
  console.table(season.revivalPurchases.map((purchase) => ({
    generator: purchase.id,
    tier: purchase.tier,
    eligible: formatDuration(purchase.eligibleAt),
    purchased: formatDuration(purchase.purchasedAt),
    ratio: Math.round(purchase.ratio),
    multiplier: purchase.multiplier,
    pressureCost: purchase.cost.toExponential(3),
  })));
  const totalProduction = Object.values(season.final.generatorProduction).reduce((sum, value) => sum + value, 0);
  console.table(GENERATORS.map(({ id }) => ({
    generator: id,
    multiplier: season.final.revivalMultipliers[id],
    share: `${(season.final.generatorProduction[id] / totalProduction * 100).toFixed(2)}%`,
  })));
}
