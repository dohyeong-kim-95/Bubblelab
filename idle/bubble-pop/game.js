import {
  BUBBLE_TIERS, GENERATORS, PRESSURE_UPGRADES, RUN_MS, SAVE_VERSION, actualGeneratorProduction, addBubbles, addPressure,
  clickUpgradeCost, clickValue, elapsedDay,
  endsAt, flowUpgradeCost, formatNumber, freshState, generatorBulkCost, generatorCost,
  maxAffordableGenerators, migrateState, milestoneProgress, pickBubbleTier, purchaseRevivalOffer,
  pressurePerSecond, pressureUnlocked, pressureUpgradeCost, productionPerSecond, remainingText,
  seasonBounds, settleOffline,
  updateRevivalOffer,
} from "./game-core.js";

const SAVE_KEY = "bl-bubble-pop-idle-v1";
const $ = (selector) => document.querySelector(selector);
const gameEl = $("#game");
const canvas = $("#bubble-canvas");
const ctx = canvas.getContext("2d");
const countEl = $("#bubble-count");
const rateEl = $("#rate");
const dayEl = $("#day-label");
const remainingEl = $("#remaining");
const generatorsEl = $("#generators");
const upgradesEl = $("#upgrades");
const buyModesEl = $("#buy-modes");
const pressureResourceEl = $("#pressure-resource");
const pressureCountEl = $("#pressure-count");
const compressionSection = $("#compression-section");
const pressureUpgradesEl = $("#pressure-upgrades");
const revivalItemEl = $("#revival-item");
const startModal = $("#start-modal");
const offlineModal = $("#offline-modal");
const finishModal = $("#finish-modal");
const toastEl = $("#toast");

let state = loadState();
let lastTick = Date.now();
let lastRender = 0;
let lastSave = 0;
let finishShown = false;
let lastSyncAt = 0;
let buyMode = localStorage.getItem("bl-bubble-pop-buy-mode") || "1";
if (!["1", "10", "100", "max"].includes(buyMode)) buyMode = "1";
let holdDelay = 0;
let holdRepeat = 0;
let suppressGeneratorClick = false;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!parsed || !Number.isInteger(parsed.version) || parsed.version < 1 || parsed.version > SAVE_VERSION || parsed.season !== seasonBounds().key || !Number.isFinite(parsed.startedAt) ||
        !Number.isFinite(parsed.bubbles) || !Number.isFinite(parsed.lifetime)) return null;
    return migrateState(parsed);
  } catch { return null; }
}

function formatPressure(value) {
  if (value < 10) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return formatNumber(value);
}

function formatPressureRate(value) {
  if (value < .01) return value.toFixed(3);
  if (value < 1) return value.toFixed(2);
  return formatNumber(value);
}

function saveState() {
  if (!state) return;
  state.lastSeenAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function begin() {
  const nick = $("#start-nickname").value.trim();
  if (!/^[가-힣a-zA-Z0-9]{1,6}$/.test(nick)) {
    $("#start-message").textContent = "한글·영문·숫자 6자 이내로 입력해주세요.";
    return;
  }
  state = freshState();
  state.nick = nick;
  state.lastSubmitted = 0;
  localStorage.setItem("bl-nick", nick);
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  startModal.hidden = true;
  gameEl.hidden = false;
  resetScene();
  lastTick = Date.now();
  render(true);
}

$("#start-button").addEventListener("click", begin);
$("#start-nickname").value = localStorage.getItem("bl-nick") || "";
$("#offline-close").addEventListener("click", () => { offlineModal.hidden = true; });
$("#reset-button").addEventListener("click", () => {
  const confirmed = confirm(
    "이 버튼은 환생 버튼이 아니라 완전 초기화 버튼입니다.\n진행 상황은 복구할 수 없습니다.\n\n그래도 진행하시겠습니까?",
  );
  if (!confirmed) return;
  state = null;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});
$("#new-season-button").addEventListener("click", () => {
  state = null;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});

function resume() {
  const previous = state.lastSeenAt || state.startedAt;
  const result = settleOffline(state);
  gameEl.hidden = false;
  startModal.hidden = true;
  resetScene();
  if (result.elapsed >= 60_000 && result.earned > 0 && !state.finished) {
    $("#offline-earned").textContent = `+${formatNumber(result.earned)}`;
    const offlinePressureEl = $("#offline-pressure");
    offlinePressureEl.hidden = !(result.pressureEarned > 0);
    offlinePressureEl.textContent = `+${formatPressure(result.pressureEarned)} PRESSURE`;
    $("#offline-detail").textContent = `${remainingText(result.elapsed)} 동안 자동으로 터뜨렸어요.${result.capped ? " 최대 24시간까지만 계산됐습니다." : ""}`;
    offlineModal.hidden = false;
  }
  if (Date.now() - previous > RUN_MS && result.capped) {
    toast("오프라인 보상은 마지막 접속부터 최대 24시간이에요");
  }
  saveState();
  render(true);
}

const generatorButtons = new Map();

function stopGeneratorHold() {
  clearTimeout(holdDelay);
  clearInterval(holdRepeat);
  holdDelay = 0;
  holdRepeat = 0;
}

function selectedPurchase(generator) {
  const owned = state.generators[generator.id];
  const count = buyMode === "max"
    ? maxAffordableGenerators(generator, owned, state.bubbles)
    : Number(buyMode);
  return { count, cost: generatorBulkCost(generator, owned, count) };
}

function showMilestoneReward(button, count) {
  const visibleCount = Math.min(count, 4);
  button.classList.add("milestone-active");
  clearTimeout(button._milestoneTimer);
  button._milestoneTimer = setTimeout(
    () => button.classList.remove("milestone-active"),
    (visibleCount - 1) * 180 + 1100,
  );
  for (let index = 0; index < visibleCount; index++) {
    setTimeout(() => {
      if (!button.isConnected) return;
      const reward = document.createElement("span");
      reward.className = "milestone-reward";
      reward.textContent = "×2";
      reward.setAttribute("aria-hidden", "true");
      reward.addEventListener("animationend", () => reward.remove(), { once: true });
      button.appendChild(reward);
    }, index * 180);
  }
}

function buildShop() {
  upgradesEl.innerHTML = `
    <button type="button" data-upgrade="click"><b>👆 터치 파워 · Lv.<span class="level"></span></b>
      <span>직접 터뜨리는 버블 ×2</span><em class="cost"></em></button>
    <button type="button" data-upgrade="flow"><b>💨 안정된 흐름 · Lv.<span class="level"></span></b>
      <span>모든 자동 생산 ×1.45</span><em class="cost"></em></button>`;
  upgradesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-upgrade]");
    if (!button || state.finished) return;
    if (button.dataset.upgrade === "click") buyUpgrade("clickLevel", clickUpgradeCost(state.clickLevel));
    else buyUpgrade("flowLevel", flowUpgradeCost(state.flowLevel));
  });

  pressureUpgradesEl.innerHTML = PRESSURE_UPGRADES.map((upgrade) => `
    <button type="button" data-pressure-upgrade="${upgrade.id}">
      <b>${upgrade.icon} ${upgrade.name} · Lv.<span class="level">0</span></b>
      <span class="effect"></span><em class="cost"></em>
    </button>`).join("");
  pressureUpgradesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-pressure-upgrade]");
    if (!button || state.finished) return;
    const upgrade = PRESSURE_UPGRADES.find(({ id }) => id === button.dataset.pressureUpgrade);
    if (upgrade) buyPressureUpgrade(upgrade);
  });
  revivalItemEl.addEventListener("click", () => {
    if (!state.revivalOffer || state.finished) return;
    if (state.pressure < state.revivalOffer.cost) { toast("압력이 조금 더 필요해요"); return; }
    const offer = purchaseRevivalOffer(state);
    if (!offer) return;
    const generator = GENERATORS.find(({ id }) => id === offer.id);
    toast(`${generator.name} 생산이 ×${formatNumber(offer.multiplier)} 증폭됐어요`);
    updateRevivalOffer(state);
    saveState();
    render(true);
  });

  for (const generator of GENERATORS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "generator";
    button.dataset.id = generator.id;
    button.innerHTML = `<span class="emoji">${generator.icon}</span><span class="info">
      <b class="name">${generator.name}</b><span class="desc"></span></span>
      <span class="buy"><b class="owned"></b><span class="cost"></span></span>
      <span class="next-double"></span>`;
    button.addEventListener("click", () => {
      if (suppressGeneratorClick) { suppressGeneratorClick = false; return; }
      buyGenerator(generator);
    });
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || button.disabled) return;
      suppressGeneratorClick = false;
      stopGeneratorHold();
      holdDelay = setTimeout(() => {
        suppressGeneratorClick = true;
        if (!buyGenerator(generator)) return;
        holdRepeat = setInterval(() => {
          if (!buyGenerator(generator, true)) stopGeneratorHold();
        }, 110);
      }, 360);
    });
    for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
      button.addEventListener(eventName, stopGeneratorHold);
    }
    generatorsEl.appendChild(button);
    generatorButtons.set(generator.id, button);
  }
}

buyModesEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-buy-mode]");
  if (!button) return;
  buyMode = button.dataset.buyMode;
  localStorage.setItem("bl-bubble-pop-buy-mode", buyMode);
  render(true);
});

function buyUpgrade(key, cost) {
  if (state.bubbles < cost) { toast("버블이 조금 더 필요해요"); return; }
  state.bubbles = Math.max(0, state.bubbles - cost);
  state[key]++;
  saveState();
  render(true);
}

function buyPressureUpgrade(upgrade) {
  if (!pressureUnlocked(state)) return;
  const level = state.pressureUpgrades[upgrade.id];
  const cost = pressureUpgradeCost(upgrade, level);
  if (state.pressure < cost) { toast("압력이 조금 더 필요해요"); return; }
  state.pressure = Math.max(0, state.pressure - cost);
  state.pressureUpgrades[upgrade.id]++;
  saveState();
  render(true);
}

function buyGenerator(generator, quiet = false) {
  if (state.lifetime < generator.unlockAt) {
    if (!quiet) toast(`누적 ${formatNumber(generator.unlockAt)} 버블에 열립니다`); return false;
  }
  const owned = state.generators[generator.id];
  const { count, cost } = selectedPurchase(generator);
  if (!count || state.bubbles < cost) {
    if (!quiet) toast("버블이 조금 더 필요해요");
    return false;
  }
  state.bubbles = Math.max(0, state.bubbles - cost);
  state.generators[generator.id] = owned + count;
  const next = state.generators[generator.id];
  const crossedMilestones = Math.floor(next / 25) - Math.floor(owned / 25);
  if (crossedMilestones > 0) showMilestoneReward(generatorButtons.get(generator.id), crossedMilestones);
  saveState();
  render(true);
  return true;
}

function pressureEffectText(id) {
  if (id === "flow") return "모든 자동 생산 ×1.35";
  if (id === "pop") return "직접·희귀 버블 보상 ×1.75";
  if (id === "storage") return "오프라인 생산 효율 +25%p";
  return "압력 생산 ×1.6";
}

function render(force = false) {
  if (!state) return;
  const now = Date.now();
  if (!force && now - lastRender < 250) return;
  lastRender = now;
  const day = elapsedDay(state, now);
  countEl.textContent = formatNumber(state.bubbles);
  rateEl.textContent = formatNumber(productionPerSecond(state));
  dayEl.textContent = `DAY ${day} / 7`;
  remainingEl.textContent = state.finished ? "실험 종료" : `${remainingText(endsAt(state) - now)} 남음`;
  const compressionOpen = pressureUnlocked(state);
  if (compressionOpen && updateRevivalOffer(state, now)) saveState();
  const ownedGeneratorTypes = GENERATORS.filter(({ id }) => state.generators[id] > 0).length;
  const nextUnlock = [...GENERATORS.slice(1), ...BUBBLE_TIERS.slice(1)]
    .filter((item) => item.unlockAt > state.lifetime)
    .sort((a, b) => a.unlockAt - b.unlockAt)[0];
  $("#tap-hint").textContent = nextUnlock
    ? `다음 해금: ${nextUnlock.name} · ${formatNumber(nextUnlock.unlockAt - state.lifetime)} 버블`
    : compressionOpen ? "압력을 모아 이번 시즌의 성장 경로를 선택하세요"
      : `버블 압축 준비 · 자동화 ${ownedGeneratorTypes} / ${GENERATORS.length}`;

  pressureResourceEl.hidden = !compressionOpen;
  compressionSection.classList.toggle("locked", !compressionOpen);
  $("#compression-status").textContent = compressionOpen ? "OPEN" : `자동화 ${ownedGeneratorTypes} / ${GENERATORS.length}`;
  $("#compression-copy").textContent = compressionOpen
    ? "자동 생산이 압력을 만듭니다. 원하는 성장 경로부터 강화하세요."
    : "모든 자동 생산기를 해금하면 압력과 새로운 성장 경로가 열립니다.";
  $("#pressure-summary").hidden = !compressionOpen;
  pressureUpgradesEl.hidden = !compressionOpen;
  const revivalOffer = state.revivalOffer;
  revivalItemEl.hidden = !compressionOpen || !revivalOffer;
  if (revivalOffer) {
    const generator = GENERATORS.find(({ id }) => id === revivalOffer.id);
    revivalItemEl.querySelector(".revival-name").textContent =
      `♻️ ${generator.name} 역류 증폭 · Mk.${revivalOffer.tier}`;
    revivalItemEl.querySelector(".revival-gap").textContent =
      `최고 설비보다 ${formatNumber(revivalOffer.ratio)}배 느림`;
    revivalItemEl.querySelector(".revival-effect").textContent =
      `생산 ×${formatNumber(revivalOffer.multiplier)}`;
    revivalItemEl.querySelector(".revival-cost").textContent = `💠 ${formatPressure(revivalOffer.cost)}`;
    revivalItemEl.disabled = state.finished || state.pressure < revivalOffer.cost;
  }
  if (compressionOpen) {
    const pressureRate = pressurePerSecond(state);
    pressureCountEl.textContent = formatPressure(state.pressure);
    $("#pressure-panel-count").textContent = formatPressure(state.pressure);
    $("#pressure-rate").textContent = formatPressureRate(pressureRate);
    if (!state.compressionSeen) {
      state.compressionSeen = true;
      compressionSection.classList.add("just-unlocked");
      setTimeout(() => compressionSection.classList.remove("just-unlocked"), 800);
      saveState();
    }
  }

  for (const upgrade of PRESSURE_UPGRADES) {
    const button = pressureUpgradesEl.querySelector(`[data-pressure-upgrade="${upgrade.id}"]`);
    const level = state.pressureUpgrades[upgrade.id];
    const cost = pressureUpgradeCost(upgrade, level);
    button.querySelector(".level").textContent = level;
    button.querySelector(".effect").textContent = pressureEffectText(upgrade.id);
    button.querySelector(".cost").textContent = `💠 ${formatPressure(cost)}`;
    button.disabled = state.finished || !compressionOpen || state.pressure < cost;
  }

  const clickButton = upgradesEl.querySelector('[data-upgrade="click"]');
  clickButton.querySelector(".level").textContent = state.clickLevel;
  clickButton.querySelector(".cost").textContent = `🫧 ${formatNumber(clickUpgradeCost(state.clickLevel))}`;
  clickButton.disabled = state.finished || state.bubbles < clickUpgradeCost(state.clickLevel);
  const flowButton = upgradesEl.querySelector('[data-upgrade="flow"]');
  flowButton.querySelector(".level").textContent = state.flowLevel;
  flowButton.querySelector(".cost").textContent = `🫧 ${formatNumber(flowUpgradeCost(state.flowLevel))}`;
  flowButton.disabled = state.finished || state.bubbles < flowUpgradeCost(state.flowLevel);

  for (const modeButton of buyModesEl.querySelectorAll("button[data-buy-mode]")) {
    modeButton.setAttribute("aria-pressed", String(modeButton.dataset.buyMode === buyMode));
  }

  for (const generator of GENERATORS) {
    const button = generatorButtons.get(generator.id);
    const owned = state.generators[generator.id];
    const locked = state.lifetime < generator.unlockAt;
    const { count, cost } = locked ? { count: 0, cost: 0 } : selectedPurchase(generator);
    const nextMark = (Math.floor(owned / 25) + 1) * 25;
    const progress = locked ? 0 : milestoneProgress(owned);
    const currentRate = actualGeneratorProduction(state, generator, owned);
    const nextRate = actualGeneratorProduction(state, generator, owned + 1);
    const pressureFlow = 1.35 ** state.pressureUpgrades.flow;
    button.classList.toggle("locked", locked);
    button.style.setProperty("--progress", `${progress * 100}%`);
    button.disabled = state.finished || locked || count === 0 || state.bubbles < cost;
    button.querySelector(".owned").textContent = locked ? "🔒" : owned;
    button.querySelector(".cost").textContent = locked ? "잠김"
      : count ? `🫧 ${formatNumber(cost)} · ×${count}` : `🫧 ${formatNumber(generatorCost(generator, owned))}`;
    button.querySelector(".next-double").textContent = locked ? "" : `NEXT DOUBLE: ${nextMark}`;
    button.querySelector(".desc").textContent = locked
      ? `누적 ${formatNumber(generator.unlockAt)} 버블에 해금`
      : `+${formatNumber((nextRate - currentRate) * pressureFlow)}/초`;
  }
}

function finish() {
  if (finishShown) return;
  state.finished = true;
  saveState();
  finishShown = true;
  $("#final-score").textContent = formatNumber(state.lifetime);
  $("#form-message").textContent = "마지막 기록을 확인하고 있어요…";
  finishModal.hidden = false;
  render(true);
  syncRecord(true).then((sent) => {
    $("#form-message").textContent = sent
      ? "이번 주 마지막 기록이 저장됐습니다."
      : "마지막 자동 저장 기록으로 순위가 결정됩니다.";
  });
}

async function syncRecord(force = false) {
  if (!state?.nick || seasonBounds().key !== state.season || state.lifetime <= 0 ||
      (!force && state.lifetime <= (state.lastSubmitted || 0))) return false;
  const score = Math.min(state.lifetime, 1e100);
  try {
    const response = await fetch("/_records", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: "bubble-pop-idle", nick: state.nick, score, text: `${formatNumber(score)} 버블` }),
    });
    if (!response.ok) throw new Error("record rejected");
    state.lastSubmitted = score;
    saveState();
    return true;
  } catch { if (force) toast("기록 서버 연결에 실패했어요"); return false; }
}

function tick() {
  if (state) {
    const now = Date.now();
    const activeUntil = Math.min(now, endsAt(state));
    const from = Math.min(lastTick, activeUntil);
    if (!state.finished && activeUntil > from) {
      const elapsed = (activeUntil - from) / 1000;
      addBubbles(state, productionPerSecond(state) * elapsed);
      addPressure(state, pressurePerSecond(state) * elapsed);
    }
    lastTick = now;
    if (now >= endsAt(state)) finish();
    if (now - lastSave >= 5000) { saveState(); lastSave = now; }
    const syncInterval = endsAt(state) - now <= 5 * 60 * 1000 ? 5000 : 30000;
    if (now - lastSyncAt >= syncInterval) { syncRecord(); lastSyncAt = now; }
    render();
  }
  requestAnimationFrame(tick);
}

const visualBubbles = [];
const floatingRewards = [];
let canvasWidth = 0, canvasHeight = 0, lastSpawn = 0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvasWidth = rect.width; canvasHeight = rect.height;
}

function spawnBubble(initial = false) {
  const radius = 17 + Math.random() * 26;
  const tier = pickBubbleTier(state?.lifetime || 0);
  visualBubbles.push({
    x: radius + Math.random() * Math.max(1, canvasWidth - radius * 2),
    y: initial ? 70 + Math.random() * Math.max(1, canvasHeight - 100) : canvasHeight + radius,
    radius: radius * (tier.id === "aurora" ? 1.15 : 1), speed: .18 + Math.random() * .32,
    phase: Math.random() * Math.PI * 2, tier,
  });
}

function resetScene() {
  resizeCanvas();
  visualBubbles.length = 0;
  for (let i = 0; i < 10; i++) spawnBubble(true);
}

function drawScene(time) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  if (time - lastSpawn > 550 && visualBubbles.length < 18) { spawnBubble(); lastSpawn = time; }
  for (let index = visualBubbles.length - 1; index >= 0; index--) {
    const bubble = visualBubbles[index];
    bubble.y -= bubble.speed;
    bubble.x += Math.sin(time / 900 + bubble.phase) * .14;
    if (bubble.y < 45 - bubble.radius) { visualBubbles.splice(index, 1); continue; }
    const gradient = ctx.createRadialGradient(
      bubble.x - bubble.radius * .3, bubble.y - bubble.radius * .35, 1,
      bubble.x, bubble.y, bubble.radius,
    );
    gradient.addColorStop(0, "rgba(255,255,255,.85)");
    gradient.addColorStop(.25, `hsla(${bubble.tier.hue},90%,88%,.3)`);
    gradient.addColorStop(1, `hsla(${bubble.tier.hue},75%,55%,.22)`);
    ctx.beginPath(); ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient; ctx.fill();
    ctx.strokeStyle = `hsla(${bubble.tier.hue},75%,45%,.65)`; ctx.lineWidth = bubble.tier.id === "clear" ? 1.2 : 2; ctx.stroke();
  }
  for (let index = floatingRewards.length - 1; index >= 0; index--) {
    const reward = floatingRewards[index];
    const progress = (time - reward.startedAt) / 1100;
    if (progress >= 1) { floatingRewards.splice(index, 1); continue; }
    const eased = 1 - (1 - progress) ** 2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.fillStyle = `hsl(${reward.hue} 70% 38%)`;
    ctx.font = "700 15px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,255,255,.9)";
    ctx.shadowBlur = 5;
    ctx.fillText(reward.text, reward.x, reward.y - eased * 46);
    ctx.restore();
  }
  requestAnimationFrame(drawScene);
}

canvas.addEventListener("pointerdown", (event) => {
  if (!state || state.finished || !offlineModal.hidden) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  for (let index = visualBubbles.length - 1; index >= 0; index--) {
    const bubble = visualBubbles[index];
    if ((x - bubble.x) ** 2 + (y - bubble.y) ** 2 <= bubble.radius ** 2) {
      visualBubbles.splice(index, 1);
      const earned = clickValue(state) * bubble.tier.multiplier;
      addBubbles(state, earned);
      floatingRewards.push({
        x: bubble.x, y: bubble.y, hue: bubble.tier.hue,
        text: `+${formatNumber(earned)}`, startedAt: performance.now(),
      });
      render(true);
      return;
    }
  }
});

addEventListener("resize", resizeCanvas);
addEventListener("pagehide", () => { syncRecord(); saveState(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveState();
  else if (state && !state.finished) {
    const result = settleOffline(state);
    if (result.elapsed >= 60_000 && result.earned > 0) toast(`자리 비운 동안 +${formatNumber(result.earned)}`);
    lastTick = Date.now(); render(true);
  }
});

buildShop();
requestAnimationFrame(drawScene);
requestAnimationFrame(tick);
if (state) resume();
