export const RUN_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_CAP_MS = 24 * 60 * 60 * 1000;
export const SAVE_VERSION = 1;

export const GENERATORS = Object.freeze([
  { id: "wand", unlockAt: 0, icon: "🪄", name: "버블 막대", baseCost: 4, growth: 1.30, rate: 1.5 },
  { id: "needle", unlockAt: 100, icon: "📌", name: "자동 바늘", baseCost: 180, growth: 1.28, rate: 14 },
  { id: "fan", unlockAt: 2500, icon: "🌀", name: "거품 선풍기", baseCost: 3200, growth: 1.26, rate: 180 },
  { id: "lab", unlockAt: 50000, icon: "🧪", name: "버블 연구소", baseCost: 65000, growth: 1.24, rate: 3400 },
  { id: "cloud", unlockAt: 1000000, icon: "☁️", name: "비눗방울 구름", baseCost: 1400000, growth: 1.22, rate: 70000 },
  { id: "reactor", unlockAt: 25000000, icon: "⚛️", name: "거품 반응로", baseCost: 38000000, growth: 1.20, rate: 1900000 },
  { id: "ocean", unlockAt: 750000000, icon: "🌊", name: "버블 바다", baseCost: 1100000000, growth: 1.18, rate: 58000000 },
]);

export const BUBBLE_TIERS = Object.freeze([
  { id: "clear", unlockAt: 0, name: "맑은 버블", multiplier: 1, chance: 1, hue: 198 },
  { id: "pearl", unlockAt: 500, name: "진주 버블", multiplier: 5, chance: .12, hue: 282 },
  { id: "gold", unlockAt: 50000, name: "황금 버블", multiplier: 25, chance: .07, hue: 43 },
  { id: "aurora", unlockAt: 5000000, name: "오로라 버블", multiplier: 100, chance: .03, hue: 148 },
]);

export function seasonBounds(now = Date.now()) {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const monday = start - ((date.getUTCDay() + 6) % 7) * 86400000;
  return { key: new Date(monday).toISOString().slice(0, 10), start: monday, end: monday + RUN_MS };
}

export function freshState(now = Date.now()) {
  const season = seasonBounds(now);
  return {
    version: SAVE_VERSION, season: season.key, startedAt: season.start, lastSeenAt: now, bubbles: 0,
    lifetime: 0, clickLevel: 0, flowLevel: 0,
    generators: Object.fromEntries(GENERATORS.map(({ id }) => [id, id === "wand" ? 1 : 0])),
    starterGranted: true, finished: false, submitted: false,
  };
}

export const elapsedDay = (state, now = Date.now()) =>
  Math.min(7, Math.max(1, Math.floor((now - state.startedAt) / 86400000) + 1));

export const endsAt = (state) => state.startedAt + RUN_MS;

export function pickBubbleTier(lifetime, random = Math.random) {
  const available = BUBBLE_TIERS.filter((tier) => tier.unlockAt <= lifetime).reverse();
  const roll = random();
  let threshold = 0;
  for (const tier of available) {
    if (tier.id === "clear") return tier;
    threshold += tier.chance;
    if (roll < threshold) return tier;
  }
  return BUBBLE_TIERS[0];
}

export function milestoneMultiplier(owned) {
  return 2 ** Math.floor(owned / 25);
}

export const milestoneProgress = (owned) => (owned % 25) / 25;

export const ownershipEfficiency = (owned) => owned > 0 ? 1.02 ** (owned - 1) : 1;

export function generatorCost(generator, owned) {
  return generator.baseCost * generator.growth ** owned;
}

export function generatorBulkCost(generator, owned, count) {
  count = Math.max(0, Math.floor(count));
  if (!count) return 0;
  const firstCost = generatorCost(generator, owned);
  return firstCost * (generator.growth ** count - 1) / (generator.growth - 1);
}

export function maxAffordableGenerators(generator, owned, bubbles) {
  const firstCost = generatorCost(generator, owned);
  if (!Number.isFinite(bubbles) || bubbles < firstCost) return 0;
  let count = Math.max(1, Math.floor(
    Math.log1p(bubbles * (generator.growth - 1) / firstCost) / Math.log(generator.growth),
  ));
  while (count > 0 && generatorBulkCost(generator, owned, count) > bubbles) count--;
  while (generatorBulkCost(generator, owned, count + 1) <= bubbles) count++;
  return count;
}

export function clickValue(state) {
  return 1 * 2 ** state.clickLevel;
}

export function generatorProduction(generator, owned, flowLevel = 0) {
  return owned * generator.rate * ownershipEfficiency(owned) *
    milestoneMultiplier(owned) * 1.6 ** flowLevel;
}

export function productionPerSecond(state) {
  return GENERATORS.reduce((sum, generator) => {
    const owned = state.generators[generator.id] || 0;
    return sum + generatorProduction(generator, owned, state.flowLevel);
  }, 0);
}

export const clickUpgradeCost = (level) => 25 * 4 ** level;
export const flowUpgradeCost = (level) => 150 * 6 ** level;

export function addBubbles(state, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  state.bubbles += amount;
  state.lifetime += amount;
  return amount;
}

export function settleOffline(state, now = Date.now()) {
  const until = Math.min(now, endsAt(state));
  const from = Math.min(Math.max(state.lastSeenAt || state.startedAt, state.startedAt), until);
  const elapsed = Math.min(Math.max(0, until - from), OFFLINE_CAP_MS);
  const earned = productionPerSecond(state) * elapsed / 1000;
  addBubbles(state, earned);
  state.lastSeenAt = now;
  if (now >= endsAt(state)) state.finished = true;
  return { earned, elapsed, capped: until - from > OFFLINE_CAP_MS };
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "∞";
  if (value < 1000) return Math.floor(value).toLocaleString("ko-KR");
  const units = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No"];
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)}${units[unit]}`;
}

export function remainingText(ms) {
  ms = Math.max(0, ms);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms % 86400000 / 3600000);
  const minutes = Math.floor(ms % 3600000 / 60000);
  const seconds = Math.floor(ms % 60000 / 1000);
  return days ? `${days}일 ${hours}시간` : hours ? `${hours}시간 ${minutes}분` : `${minutes}분 ${seconds}초`;
}
