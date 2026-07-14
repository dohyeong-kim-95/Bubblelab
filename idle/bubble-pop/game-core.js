export const RUN_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_CAP_MS = 24 * 60 * 60 * 1000;
export const SAVE_VERSION = 1;

export const GENERATORS = Object.freeze([
  { id: "wand", day: 1, icon: "🪄", name: "버블 막대", baseCost: 25, growth: 1.16, rate: 0.4 },
  { id: "needle", day: 2, icon: "📌", name: "자동 바늘", baseCost: 240, growth: 1.17, rate: 4 },
  { id: "fan", day: 3, icon: "🌀", name: "거품 선풍기", baseCost: 2600, growth: 1.18, rate: 42 },
  { id: "lab", day: 4, icon: "🧪", name: "버블 연구소", baseCost: 32000, growth: 1.19, rate: 480 },
  { id: "cloud", day: 5, icon: "☁️", name: "비눗방울 구름", baseCost: 420000, growth: 1.20, rate: 5600 },
  { id: "reactor", day: 6, icon: "⚛️", name: "거품 반응로", baseCost: 6800000, growth: 1.21, rate: 72000 },
  { id: "ocean", day: 7, icon: "🌊", name: "버블 바다", baseCost: 120000000, growth: 1.22, rate: 1000000 },
]);

export const BUBBLE_TIERS = Object.freeze([
  { id: "clear", day: 1, name: "맑은 버블", multiplier: 1, chance: 1, hue: 198 },
  { id: "pearl", day: 3, name: "진주 버블", multiplier: 5, chance: .12, hue: 282 },
  { id: "gold", day: 5, name: "황금 버블", multiplier: 25, chance: .07, hue: 43 },
  { id: "aurora", day: 7, name: "오로라 버블", multiplier: 100, chance: .03, hue: 148 },
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
    generators: Object.fromEntries(GENERATORS.map(({ id }) => [id, 0])),
    finished: false, submitted: false,
  };
}

export const elapsedDay = (state, now = Date.now()) =>
  Math.min(7, Math.max(1, Math.floor((now - state.startedAt) / 86400000) + 1));

export const endsAt = (state) => state.startedAt + RUN_MS;

export function pickBubbleTier(day, random = Math.random) {
  const available = BUBBLE_TIERS.filter((tier) => tier.day <= day).reverse();
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
  return 2 ** [10, 25, 50].filter((mark) => owned >= mark).length;
}

export function generatorCost(generator, owned) {
  return generator.baseCost * generator.growth ** owned;
}

export function clickValue(state) {
  return 1 * 2 ** state.clickLevel;
}

export function productionPerSecond(state) {
  const base = GENERATORS.reduce((sum, generator) => {
    const owned = state.generators[generator.id] || 0;
    return sum + owned * generator.rate * milestoneMultiplier(owned);
  }, 0);
  return base * 1.6 ** state.flowLevel;
}

export const clickUpgradeCost = (level) => 80 * 7 ** level;
export const flowUpgradeCost = (level) => 350 * 9 ** level;

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
