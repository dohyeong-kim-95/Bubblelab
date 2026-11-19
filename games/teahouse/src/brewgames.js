// 차 종류별 미니게임 (사용자 2026-11-18, A안). 따르기(pour.js) 말고 셋을 더 둔다.
//
//   차갑게           → ice   얼음 넣기: 보이는 얼음 크기를 보고 떨어뜨리거나 바꾼다. 선에 맞추기
//   우유가 들어가면  → milk  우유 붓기: 섞이는 데 시간이 걸려 색이 늦게 따라온다. 기억 속 색에 맞추기
//   녹차·홍차        → steep 찻잎 우리기: 색이 진해지는 동안 기다렸다가 딱 맞을 때 건지기
//   그 밖            → pour  따르기 (pour.js)
//
// 결과는 모두 'perfect' | 'good' | 'under' | 'over' — 손님 반응 한마디에만 쓰인다 (막히는 일 없음).
// ease(0~2): 연달아 빗나가면 판정 폭이 넓어진다 (×1, ×1.5, ×2).
// Sim 은 순수 로직 — tests/brewgames.test.mjs. 그림은 art 탭 (sprites.js bakeBrewSprites).

import { PourSim, playPour } from './pour.js';
import { bakeBrewSprites } from './sprites.js';

export const MILK = '#f4efe4';

/** 어떤 미니게임인지: brew = { base, temp, additions } */
export function pickGame(brew) {
  if (brew.temp === 'cold') return 'ice';
  if (brew.additions?.includes('milk')) return 'milk';
  if (brew.base === 'green' || brew.base === 'black') return 'steep';
  return 'pour';
}

const widen = (ease) => 1 + 0.5 * Math.max(0, Math.min(2, ease || 0));
const judgeBand = (v, target, perfect, good, overLimit = false) => {
  if (overLimit) return 'over';
  const d = v - target;
  if (Math.abs(d) <= perfect) return 'perfect';
  if (Math.abs(d) <= good) return 'good';
  return d < 0 ? 'under' : 'over';
};

// ── 얼음 ───────────────────────────────────────────────────────
export const ICE = { start: 0.5, target: 0.82, perfect: 0.025, good: 0.06, sizes: [0.04, 0.07, 0.1] };

export class IceSim {
  constructor(opts = {}, rng = Math.random) {
    this.o = { ...ICE, ...opts };
    this.rng = rng;
    this.level = this.o.start;
    this.cubes = [];          // 떨어뜨린 얼음 크기들
    this.spilled = false;
    this.next = this.#roll();
  }
  #roll(not = -1) {
    const n = this.o.sizes.length;
    let i = Math.floor(this.rng() * n) % n;
    if (i === not) i = (i + 1 + Math.floor(this.rng() * (n - 1))) % n;   // 바꾸면 반드시 다른 크기
    return i;
  }
  /** 보이는 얼음을 떨어뜨린다 → 크기만큼 차오른다 */
  drop() {
    if (this.spilled) return;
    const size = this.o.sizes[this.next];
    this.cubes.push(this.next);
    this.level += size;
    if (this.level > 1) { this.level = 1; this.spilled = true; }
    this.next = this.#roll();
  }
  /** 다른 얼음으로 바꾼다 */
  swap() { if (!this.spilled) this.next = this.#roll(this.next); }
  get settled() { return this.cubes.length > 0; }
  get result() { return judgeBand(this.level, this.o.target, this.o.perfect, this.o.good, this.spilled); }
}

// ── 우유 ───────────────────────────────────────────────────────
// 붓는 손맛은 따르기와 같고(누르는 동안, 떼도 조금 더), 색이 늦게 섞여 보이는 게 난관.
export const MILK_GAME = { target: 0.4, perfect: 0.045, good: 0.09, rate: 0.16, mix: 1.4 };

export class MilkSim extends PourSim {
  constructor(opts = {}) {
    const o = { ...MILK_GAME, ...opts };
    super({ rate: o.rate, target: o.target, perfect: o.perfect, good: o.good });
    this.m = o;
    this.shown = 0;           // 눈에 보이는 섞인 정도 (level 을 늦게 따라온다)
  }
  step(dt) {
    super.step(dt);
    this.shown += (this.level - this.shown) * Math.min(1, dt * this.m.mix);
  }
  get settled() { return super.settled && Math.abs(this.level - this.shown) < 0.01; }
}

// ── 우리기 ─────────────────────────────────────────────────────
export const STEEP = { target: 0.6, perfect: 0.05, good: 0.1, rate: 0.11 };

export class SteepSim {
  constructor(opts = {}) {
    this.o = { ...STEEP, ...opts };
    this.strength = 0;
    this.steeping = false;
    this.lifted = false;
  }
  dip() { if (!this.lifted) this.steeping = true; }
  lift() { if (this.steeping) { this.steeping = false; this.lifted = true; } }
  step(dt) {
    if (!this.steeping) return;
    this.strength = Math.min(1, this.strength + this.o.rate * dt);
    if (this.strength >= 1) this.lift();          // 너무 오래 두면 저절로 — 떫다
  }
  get settled() { return this.lifted; }
  get result() { return judgeBand(this.strength, this.o.target, this.o.perfect, this.o.good); }
}

// ── 화면 ───────────────────────────────────────────────────────
const W = 120, H = 96;
const C = { bg: '#241a24', table: '#7a4f34', tableHi: '#b07a4e', glass: '#cfe3ea', glassHi: '#ffffff',
  line: '#f2b06a', ink: '#2a1e24', cup: '#f4efe6', cupShade: '#cfc6ba', leaf: '#6f8a3a', metal: '#b8b2a8' };

export function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('');
}

/**
 * brew 에 맞는 미니게임을 root 에 열고 결과를 돌려준다.
 * @param {{base:string,temp:string,additions:string[], color:string, baseColor?:string, teaColor?:string}} brew
 * @returns {Promise<{result:string, level:number, game:string}>}
 */
export async function playBrewGame(root, brew, { audio, reducedMotion = false, ease = 0 } = {}) {
  const game = pickGame(brew);
  const k = widen(ease);
  let r;
  if (game === 'ice') r = await playIce(root, brew, { audio, reducedMotion, k });
  else if (game === 'milk') r = await playMilk(root, brew, { audio, reducedMotion, k });
  else if (game === 'steep') r = await playSteep(root, brew, { audio, reducedMotion, k });
  else r = await playPour(root, { color: brew.color, audio, reducedMotion, ease });
  return { ...r, game };
}

/** 공용 판: 캔버스 + 안내 + 버튼들. frame(dt,t) 를 매 프레임 부른다 */
function board(root, { label, hintText, extra = [] }) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.className = 'pour-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-label', label);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const hint = document.createElement('p');
  hint.className = 'pour-hint';
  hint.textContent = hintText;
  const serve = document.createElement('button');
  serve.className = 'primary pour-serve';
  serve.textContent = '🍵 내기';
  serve.disabled = true;
  const row = document.createElement('div');
  row.className = 'brew-actions';
  row.append(...extra, serve);
  root.replaceChildren(canvas, hint, row);
  requestAnimationFrame(() => canvas.focus({ preventScroll: true }));
  const run = (frame, done) => new Promise((resolve) => {
    let prev = performance.now(), t = 0, raf = 0;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now; t += dt;
      frame(dt, t);
      raf = requestAnimationFrame(tick);
    };
    serve.addEventListener('click', () => { cancelAnimationFrame(raf); resolve(done()); });
    raf = requestAnimationFrame(tick);
  });
  return { canvas, g, hint, serve, run };
}

const R = (g) => (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const table = (r) => { r(C.bg, 0, 0, W, H); r(C.table, 0, 84, W, 12); r(C.tableHi, 0, 84, W, 1); };

/** 목표 색 견본 ("기억 속 색") — 왼쪽 위 */
function swatch(g, color, label = '기억 속 색') {
  const r = R(g);
  r(C.ink, 4, 4, 18, 14); r(color, 5, 5, 16, 12);
  g.fillStyle = '#e8d8c8'; g.font = '7px Galmuri11, monospace'; g.textBaseline = 'top';
  g.fillText(label, 25, 7);
}

// 얼음
function playIce(root, brew, { audio, reducedMotion, k }) {
  const sim = new IceSim({ perfect: ICE.perfect * k, good: ICE.good * k });
  const swapBtn = document.createElement('button');
  swapBtn.className = 'ghost ice-swap';
  swapBtn.textContent = '🔄 다른 얼음';
  const b = board(root, { label: '누르면 얼음을 넣습니다', hintText: '잔을 누르면 보이는 얼음이 들어가요. 크기를 보고 골라 선에 맞춰 보세요.', extra: [swapBtn] });
  const falling = [];   // { size, y, v }
  const drop = (e) => {
    if (e?.type === 'pointerdown' && e.button !== 0) return;
    e?.preventDefault?.();
    if (sim.spilled) return;
    const size = sim.next;
    sim.drop();
    falling.push({ size, y: 10, v: 0 });
    audio?.sfx?.('ice', { size: size / 2 });
  };
  b.canvas.addEventListener('pointerdown', drop);
  b.canvas.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') drop(e); });
  swapBtn.addEventListener('click', () => { sim.swap(); audio?.sfx?.('tap'); });
  const color = brew.color;
  return b.run((dt, t) => {
    for (const f of falling) { f.v += 400 * dt; f.y += f.v * dt; }
    drawIce(b.g, sim, color, falling, t, reducedMotion);
    b.serve.disabled = !sim.settled;
    swapBtn.disabled = sim.spilled;
    if (sim.spilled) b.hint.textContent = '앗, 넘쳤어요! 그래도 괜찮아요.';
  }, () => ({ result: sim.result, level: Math.round(sim.level * 100) / 100 }));
}

const K = 2;   // 미니게임 그림 배율 (art: bakeBrewSprites, 논리 픽셀 ×2)
const art = {};
const sprites = (kind) => (art[kind] ??= bakeBrewSprites(kind, K));

/** 논리 칸 목록을 표면(픽셀 y) 아래만 칠한다 — 잔 모양을 따른다 */
function fillCells(g, cells, ox, oy, surface, color) {
  g.fillStyle = color;
  for (const [x, y] of cells) {
    const y0 = Math.max(oy + y * K, surface), y1 = oy + (y + 1) * K;
    if (y1 > y0) g.fillRect(ox + x * K, y0, K, y1 - y0);
  }
}

function drawIce(g, sim, color, falling, t, still) {
  const r = R(g), A = sprites('ice');
  table(r);
  // 유리잔 18×34 → 36×68, 탁자 위 가운데
  const gx = 42, gy = 84 - A.glass.height;
  const top = gy + 2 * K, bottom = gy + A.floor * K;
  const surface = bottom - Math.round(sim.level * (bottom - top));
  g.drawImage(A.glass, gx, gy);
  fillCells(g, A.cells, gx, gy, surface, color);
  // 떠 있는 얼음: 표면 근처에 차곡차곡
  let x = gx + 3 * K, y = surface - 3;
  sim.cubes.forEach((s, i) => {
    const c = A.ice[s];
    if (x + c.width > gx + 16 * K) { x = gx + 3 * K; y += 6; }
    const bob = still ? 0 : Math.round(Math.sin(t * 2 + i) * 0.6);
    g.drawImage(c, x, Math.min(bottom - c.height, y + bob));
    x += c.width - 2;
  });
  r('#ffffff55', gx + 2 * K, surface, 14 * K, 1);
  g.drawImage(A.front, gx, gy);
  if (sim.spilled) { r(color, gx - 6, 84, A.glass.width + 12, 2); r(color, gx, gy + 4, 2, 30); }
  // 목표선
  const ly = bottom - Math.round(sim.o.target * (bottom - top));
  for (let lx = gx + 4; lx < gx + A.glass.width - 2; lx += 4) r(C.line, lx, ly, 2, 1);
  r(C.line, gx - 5, ly - 2, 4, 5);
  // 다음 얼음: 오른쪽 접시 위 + 이름
  const nx = A.ice[sim.next];
  r(C.metal, 88, 40, 24, 2);
  g.drawImage(nx, 100 - nx.width / 2, 40 - nx.height);
  g.fillStyle = '#e8d8c8'; g.font = '7px Galmuri11, monospace'; g.textBaseline = 'top';
  g.fillText(['작은 얼음', '보통 얼음', '큰 얼음'][sim.next], 86, 45);
  // 떨어지는 중
  for (const f of falling) {
    const c = A.ice[f.size];
    if (f.y < surface - c.height) g.drawImage(c, gx + A.glass.width / 2 - c.width / 2, f.y);
  }
}

// 우유
function playMilk(root, brew, { audio, reducedMotion, k }) {
  const sim = new MilkSim({ perfect: MILK_GAME.perfect * k, good: MILK_GAME.good * k });
  const b = board(root, { label: '누르고 있으면 우유를 붓습니다', hintText: '꾹 누르면 우유가 들어가요. 섞이는 데 조금 걸려요 — 기억 속 색에 맞춰 보세요.' });
  let sound = null;
  const press = (e) => {
    if (e.type === 'pointerdown' && e.button !== 0) return;
    e.preventDefault();
    if (sim.spilled) return;
    sim.press();
    sound ??= audio?.pour?.({ thick: true }) ?? null;
  };
  const release = () => sim.release();
  b.canvas.addEventListener('pointerdown', press);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) b.canvas.addEventListener(ev, release);
  b.canvas.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) press(e); });
  b.canvas.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release(); });
  const tea = brew.teaColor ?? brew.baseColor ?? brew.color;
  const goal = mix(tea, MILK, MILK_GAME.target);
  return b.run((dt, t) => {
    sim.step(dt);
    sound?.setFlow?.(sim.flow);
    drawMilk(b.g, sim, tea, goal, t, reducedMotion);
    b.serve.disabled = !sim.settled;
    if (sim.spilled) { b.hint.textContent = '우유가 너무 많이 들어갔어요. 그래도 괜찮아요.'; b.serve.disabled = false; }
  }, () => { sound?.stop?.(); return { result: sim.result, level: Math.round(sim.level * 100) / 100 }; });
}

function drawMilk(g, sim, tea, goal, t, still) {
  const r = R(g), A = sprites('milk');
  table(r);
  swatch(g, goal);
  // 찻잔 (POUR_CUP ×2) — 차는 이미 7할쯤 차 있고, 우유가 섞이는 만큼 색이 바뀐다
  const cx = 52, cy = 85 - A.cup.height;
  const top = cy + 3 * K, bottom = cy + 15 * K;
  const surface = bottom - Math.round((0.6 + 0.2 * Math.min(1, sim.level)) * (bottom - top));
  g.drawImage(A.cup, cx, cy);
  const now = mix(tea, MILK, sim.shown);
  fillCells(g, A.cupCells, cx, cy, surface, now);
  // 아직 덜 섞인 우유 소용돌이 (level 과 shown 차이만큼)
  const swirl = Math.max(0, sim.level - sim.shown);
  if (swirl > 0.01) {
    g.globalAlpha = Math.min(0.85, swirl * 4);
    for (let i = 0; i < 10; i++) {
      const a = (still ? 0 : t * 3) + i * 0.63;
      r(MILK, Math.round(cx + 21 + Math.cos(a) * (4 + i)), Math.round(surface + 4 + Math.sin(a) * 2), 2, 1);
    }
    g.globalAlpha = 1;
  }
  r('#ffffff66', cx + 5 * K, surface, 11 * K, 1);
  // 우유 주전자: 손잡이 축으로 기운다 (0~40도, 주둥이가 잔 쪽 = 오른쪽 아래로)
  const ang = sim.flow * 40 * Math.PI / 180;
  const P = [30, 38];                       // 견본(왼쪽 위)과 겹치지 않게
  const pv = [A.pivot.x * K, A.pivot.y * K];
  g.save(); g.translate(P[0], P[1]); g.rotate(ang); g.drawImage(A.jug, -pv[0], -pv[1]); g.restore();
  const vx = A.spout.x * K - pv[0], vy = A.spout.y * K - pv[1];
  const sx = Math.round(P[0] + vx * Math.cos(ang) - vy * Math.sin(ang));
  const sy = Math.round(P[1] + vx * Math.sin(ang) + vy * Math.cos(ang));
  if (sim.flow > 0.02) {
    const wdt = Math.max(1, Math.round(sim.flow * 2));
    for (let y = sy; y < surface; y++) {
      const wav = still ? 0 : Math.round(Math.sin(y * 0.5 + t * 18) * 0.5);
      r(MILK, sx + Math.round((y - sy) * 0.15) + wav, y, wdt, 1);
    }
  }
  if (sim.spilled) r(MILK, cx - 4, 85, A.cup.width + 4, 2);
}

// 우리기
function playSteep(root, brew, { audio, reducedMotion, k }) {
  const sim = new SteepSim({ perfect: STEEP.perfect * k, good: STEEP.good * k });
  const b = board(root, { label: '눌러서 찻잎을 넣고, 다시 눌러 건집니다', hintText: '눌러서 찻잎을 담가요. 색이 기억 속 색이 되면 다시 눌러 건지세요.' });
  const tap = (e) => {
    if (e.type === 'pointerdown' && e.button !== 0) return;
    e.preventDefault();
    if (!sim.steeping && !sim.lifted) { sim.dip(); audio?.sfx?.('water'); audio?.sfx?.('brew'); b.hint.textContent = '우러나는 중… 색을 보다가 눌러서 건지세요.'; }
    else if (sim.steeping) sim.lift();
  };
  let wasSteeping = false;
  b.canvas.addEventListener('pointerdown', tap);
  b.canvas.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') tap(e); });
  const water = '#d9e7f0';
  const full = brew.color;                       // 다 우러난 색 (재료까지 섞인 잔 색)
  const goal = mix(water, full, STEEP.target);
  let warned = false;
  return b.run((dt, t) => {
    sim.step(dt);
    if (wasSteeping && !sim.steeping) { audio?.stopSfx?.('brew', 0.6); audio?.sfx?.('lift'); }   // 눌러서든 저절로든 건졌을 때
    wasSteeping = sim.steeping;
    if (sim.lifted && sim.strength >= 1 && !warned) { warned = true; b.hint.textContent = '앗, 너무 오래 뒀어요. 조금 떫겠지만 괜찮아요.'; }
    drawSteep(b.g, sim, mix(water, full, sim.strength), goal, t, reducedMotion);
    b.serve.disabled = !sim.settled;
  }, () => ({ result: sim.result, level: Math.round(sim.strength * 100) / 100 }));
}

function drawSteep(g, sim, now, goal, t, still) {
  const r = R(g), A = sprites('steep');
  table(r);
  swatch(g, goal);
  // 유리 티포트 40×32 → 80×64, 왼쪽에. 바구니는 담그기 전·건진 뒤엔 오른쪽 탁자 위
  const px = 6, py = 84 - A.pot.height;
  g.drawImage(A.pot, px, py);
  fillCells(g, A.cells, px, py, 0, '#d9e7f0');
  g.globalAlpha = 0.25 + 0.75 * sim.strength;
  fillCells(g, A.cells, px, py, 0, now);
  g.globalAlpha = 1;
  const frame = A.basket[sim.strength < 0.3 ? 0 : sim.strength < 0.65 ? 1 : 2];
  if (sim.steeping) {
    const wob = still ? 0 : Math.round(Math.sin(t * 1.5));
    g.drawImage(frame, px + A.seat.x * K, py + A.seat.y * K + wob);
    if (!still) {                                // 바구니에서 번져 나오는 찻물
      g.globalAlpha = 0.5;
      for (let i = 0; i < 4; i++) r(now, px + A.seat.x * K + 6 + i * 6, py + 36 + ((t * 8 + i * 5) % 18), 1, 3);
      g.globalAlpha = 1;
    }
  }
  g.drawImage(A.front, px, py);
  if (!sim.steeping) {
    const b = sim.lifted ? A.lifted : A.basket[0];
    const bx = 120 - b.width - 2, by = 84 - b.height;
    g.drawImage(b, bx, by);
    if (sim.lifted && !still && Math.floor(t * 2) % 2 === 0) r('#bcd8e6', bx + A.drip.x * K, by + A.drip.y * K + 2, 1, 2);
  }
}
