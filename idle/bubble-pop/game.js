import {
  BUBBLE_TIERS, GENERATORS, addBubbles, clickUpgradeCost, clickValue, elapsedDay,
  endsAt, flowUpgradeCost, formatNumber, freshState, generatorCost,
  generatorProduction, pickBubbleTier, productionPerSecond, remainingText,
  seasonBounds, settleOffline,
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

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!parsed || parsed.version !== 1 || parsed.season !== seasonBounds().key || !Number.isFinite(parsed.startedAt) ||
        !Number.isFinite(parsed.bubbles) || !Number.isFinite(parsed.lifetime)) return null;
    parsed.generators ||= {};
    for (const { id } of GENERATORS) parsed.generators[id] = Math.max(0, Math.floor(parsed.generators[id] || 0));
    if (!parsed.starterGranted) {
      parsed.generators.wand = Math.max(1, parsed.generators.wand);
      parsed.starterGranted = true;
    }
    parsed.clickLevel = Math.max(0, Math.floor(parsed.clickLevel || 0));
    parsed.flowLevel = Math.max(0, Math.floor(parsed.flowLevel || 0));
    return parsed;
  } catch { return null; }
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
$("#new-season-button").addEventListener("click", () => {
  localStorage.removeItem(SAVE_KEY); location.reload();
});

function resume() {
  const previous = state.lastSeenAt || state.startedAt;
  const result = settleOffline(state);
  gameEl.hidden = false;
  startModal.hidden = true;
  resetScene();
  if (result.elapsed >= 60_000 && result.earned > 0 && !state.finished) {
    $("#offline-earned").textContent = `+${formatNumber(result.earned)}`;
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

function buildShop() {
  upgradesEl.innerHTML = `
    <button type="button" data-upgrade="click"><b>👆 터치 파워 · Lv.<span class="level"></span></b>
      <span>직접 터뜨리는 버블 ×2</span><em class="cost"></em></button>
    <button type="button" data-upgrade="flow"><b>💨 안정된 흐름 · Lv.<span class="level"></span></b>
      <span>모든 자동 생산 ×1.6</span><em class="cost"></em></button>`;
  upgradesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-upgrade]");
    if (!button || state.finished) return;
    if (button.dataset.upgrade === "click") buyUpgrade("clickLevel", clickUpgradeCost(state.clickLevel));
    else buyUpgrade("flowLevel", flowUpgradeCost(state.flowLevel));
  });

  for (const generator of GENERATORS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "generator";
    button.dataset.id = generator.id;
    button.innerHTML = `<span class="emoji">${generator.icon}</span><span class="info">
      <b class="name">${generator.name}</b><span class="desc"></span></span>
      <span class="buy"><b class="owned"></b><span class="cost"></span></span>`;
    button.addEventListener("click", () => buyGenerator(generator));
    generatorsEl.appendChild(button);
    generatorButtons.set(generator.id, button);
  }
}

function buyUpgrade(key, cost) {
  if (state.bubbles < cost) { toast("버블이 조금 더 필요해요"); return; }
  state.bubbles -= cost;
  state[key]++;
  saveState();
  render(true);
}

function buyGenerator(generator) {
  if (state.lifetime < generator.unlockAt) {
    toast(`누적 ${formatNumber(generator.unlockAt)} 버블에 열립니다`); return;
  }
  const owned = state.generators[generator.id];
  const cost = generatorCost(generator, owned);
  if (state.bubbles < cost) { toast("버블이 조금 더 필요해요"); return; }
  state.bubbles -= cost;
  state.generators[generator.id] = owned + 1;
  const next = state.generators[generator.id];
  if ([25, 50, 100].includes(next)) toast(`${generator.name} ${next}개! 생산량이 2배가 됐어요`);
  saveState();
  render(true);
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
  const nextUnlock = [...GENERATORS.slice(1), ...BUBBLE_TIERS.slice(1)]
    .filter((item) => item.unlockAt > state.lifetime)
    .sort((a, b) => a.unlockAt - b.unlockAt)[0];
  $("#tap-hint").textContent = nextUnlock
    ? `다음 해금: ${nextUnlock.name} · ${formatNumber(nextUnlock.unlockAt - state.lifetime)} 버블`
    : "모든 버블과 자동화를 해금했습니다";

  const clickButton = upgradesEl.querySelector('[data-upgrade="click"]');
  clickButton.querySelector(".level").textContent = state.clickLevel;
  clickButton.querySelector(".cost").textContent = `🫧 ${formatNumber(clickUpgradeCost(state.clickLevel))}`;
  clickButton.disabled = state.finished || state.bubbles < clickUpgradeCost(state.clickLevel);
  const flowButton = upgradesEl.querySelector('[data-upgrade="flow"]');
  flowButton.querySelector(".level").textContent = state.flowLevel;
  flowButton.querySelector(".cost").textContent = `🫧 ${formatNumber(flowUpgradeCost(state.flowLevel))}`;
  flowButton.disabled = state.finished || state.bubbles < flowUpgradeCost(state.flowLevel);

  for (const generator of GENERATORS) {
    const button = generatorButtons.get(generator.id);
    const owned = state.generators[generator.id];
    const cost = generatorCost(generator, owned);
    const locked = state.lifetime < generator.unlockAt;
    const nextMark = [25, 50, 100].find((mark) => owned < mark);
    const currentRate = generatorProduction(generator, owned, state.flowLevel);
    const nextRate = generatorProduction(generator, owned + 1, state.flowLevel);
    button.classList.toggle("locked", locked);
    button.disabled = state.finished || locked || state.bubbles < cost;
    button.querySelector(".owned").textContent = locked ? "🔒" : owned;
    button.querySelector(".cost").textContent = locked ? "잠김" : `🫧 ${formatNumber(cost)}`;
    button.querySelector(".desc").textContent = locked
      ? `누적 ${formatNumber(generator.unlockAt)} 버블에 해금`
      : `구매 시 +${formatNumber(nextRate - currentRate)}/초${nextMark ? ` · ${nextMark}개에서 ×2` : " · MAX 보너스"}`;
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
    if (!state.finished && activeUntil > from) addBubbles(state, productionPerSecond(state) * (activeUntil - from) / 1000);
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
      toast(`${bubble.tier.name} · +${formatNumber(earned)}`);
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
