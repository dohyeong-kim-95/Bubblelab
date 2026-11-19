// 차 따르기 미니게임.
//
// 누르고 있는 동안 주전자가 점점 기울어 물줄기가 굵어지고, 손을 떼도 주전자가 바로 서지 못해
// 잠깐 더 흐른다 — 이게 이 게임의 난관이다 (맥주의 거품 대신). 여러 번 나눠 따를 수 있다.
// 결과는 손님의 한마디만 바꾼다. 실패해서 막히는 일은 없다 (힐링 게임).
//
// PourSim 은 순수 로직(시간만 받는다) — tests/pour.test.mjs. PourView 가 그림·입력을 맡는다.

import { bakePourSprites, POUR_CUP } from './sprites.js';

export const POUR = {
  target: 0.78,     // 찻잔 선 (잔 높이 대비)
  perfect: 0.05,    // 선 ±5% 면 "딱"  (누름 시간으로 약 0.3초 폭)
  good: 0.1,        // 선 ±10% 면 "좋음" (약 0.6초 폭)
  rise: 2.4,        // 누르는 동안 물줄기가 굵어지는 빠르기 (1/초)
  fall: 3.0,        // 손을 뗀 뒤 물줄기가 가늘어지는 빠르기 (1/초) — 작을수록 더 오래 흐른다
  rate: 0.32,       // 물줄기 최대일 때 초당 차오르는 양
};

export class PourSim {
  constructor(opts = {}) {
    this.o = { ...POUR, ...opts };
    this.level = 0;     // 0~1 (1 = 넘침)
    this.flow = 0;      // 0~1 물줄기 굵기
    this.holding = false;
    this.spilled = false;
    this.started = false;
  }

  press() { if (!this.spilled) { this.holding = true; this.started = true; } }
  release() { this.holding = false; }

  /** 한 프레임 진행 */
  step(dt) {
    if (this.spilled) { this.flow = Math.max(0, this.flow - this.o.fall * dt); return; }
    if (this.holding) this.flow += (1 - this.flow) * Math.min(1, this.o.rise * dt);
    else this.flow = Math.max(0, this.flow - this.o.fall * dt * (0.4 + this.flow));
    if (this.flow < 0.01 && !this.holding) this.flow = 0;
    this.level += this.flow * this.o.rate * dt;
    if (this.level >= 1) { this.level = 1; this.spilled = true; this.holding = false; }
  }

  /** 물줄기가 멎었고 한 번이라도 따랐다 → 낼 수 있다 */
  get settled() { return this.started && !this.holding && this.flow === 0; }

  /** 'perfect' | 'good' | 'under' | 'over' */
  get result() {
    if (this.spilled) return 'over';
    const d = this.level - this.o.target;
    if (Math.abs(d) <= this.o.perfect) return 'perfect';
    if (Math.abs(d) <= this.o.good) return 'good';
    return d < 0 ? 'under' : 'over';
  }
}

// ── 화면 ───────────────────────────────────────────────────────
const W = 120, H = 96;
const C = {
  bg: '#241a24', table: '#7a4f34', tableHi: '#b07a4e',
  cup: '#f4efe6', cupShade: '#cfc6ba', rim: '#ffffff',
  pot: '#d8d0c4', potShade: '#a99f94', line: '#f2b06a', ink: '#2a1e24',
};

/**
 * 따르기 판을 root 에 그리고, 결과가 나오면 resolve.
 * @returns {Promise<{result:string, level:number}>}
 */
export function playPour(root, { color, audio, reducedMotion = false, ease = 0 }) {
  const k = 1 + 0.5 * Math.max(0, Math.min(2, ease));   // 연달아 빗나가면 판정 폭을 넓힌다
  const sim = new PourSim({ perfect: POUR.perfect * k, good: POUR.good * k });
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.className = 'pour-canvas';
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  const hint = document.createElement('p');
  hint.className = 'pour-hint';
  hint.textContent = '꾹 누르고 있으면 따라져요. 손을 떼도 조금 더 흘러요 — 선에 맞춰 보세요.';
  const serve = document.createElement('button');
  serve.className = 'primary pour-serve';
  serve.textContent = '🍵 내기';
  serve.disabled = true;
  root.replaceChildren(canvas, hint, serve);

  let sound = null;
  canvas.tabIndex = 0;   // 키보드로도: 스페이스·엔터를 누르고 있는 동안 따른다
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-label', '누르고 있으면 차를 따릅니다');
  const press = (e) => {
    if (e.type === 'pointerdown' && e.button !== 0) return;   // 오른쪽 클릭 무시 (메뉴가 pointerup 을 삼킨다)
    e.preventDefault();
    if (sim.spilled) return;
    sim.press();
    sound ??= audio.pour?.() ?? null;
  };
  const release = () => sim.release();
  canvas.addEventListener('pointerdown', press);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) canvas.addEventListener(ev, release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const isPourKey = (e) => e.key === ' ' || e.key === 'Enter';
  canvas.addEventListener('keydown', (e) => { if (isPourKey(e) && !e.repeat) press(e); else if (isPourKey(e)) e.preventDefault(); });
  canvas.addEventListener('keyup', (e) => { if (isPourKey(e)) release(); });
  requestAnimationFrame(() => canvas.focus({ preventScroll: true }));

  return new Promise((resolve) => {
    let prev = performance.now();
    let raf = 0;
    let t = 0;
    const finish = () => {
      cancelAnimationFrame(raf);
      sound?.stop?.();
      resolve({ result: sim.result, level: Math.round(sim.level * 100) / 100 });
    };
    serve.addEventListener('click', finish);

    const frame = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now; t += dt;
      sim.step(dt);
      sound?.setFlow?.(sim.flow);
      sound?.setLevel?.(sim.level);
      draw(g, sim, color, t, reducedMotion);
      serve.disabled = !sim.settled;
      if (sim.spilled && sim.flow === 0) {
        hint.textContent = '앗, 넘쳤어요! 그래도 괜찮아요.';
        serve.disabled = false;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}

function draw(g, sim, color, t, still) {
  // 그림: art 탭 (bakePourSprites). 주전자·잔 모두 ×2.
  const K = 2;
  draw.art ??= (() => {
    const sp = bakePourSprites(K);
    // 차가 보일 칸: 잔 몸통(입구 3행 ~ 14행, 3~18열) 중 그림이 있는 칸
    const cells = [];
    POUR_CUP.forEach((row, y) => [...row].forEach((ch, x) => {
      if (y >= 3 && y <= 14 && x >= 3 && x <= 18 && 'uUv'.includes(ch)) cells.push([x, y]);
    }));
    const mouth = [];
    POUR_CUP.forEach((row, y) => [...row].forEach((ch, x) => { if (y <= 4 && ch === 'U') mouth.push([x, y]); }));
    return { ...sp, cells, mouth };
  })();
  const A = draw.art;
  const r = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  r(C.bg, 0, 0, W, H);
  r(C.table, 0, 84, W, 12); r(C.tableHi, 0, 84, W, 1);

  // 찻잔 자리와 차오르는 높이 (잔 안쪽 3행~14행 → 24px)
  const cx = 60, cy = 85 - A.cup.height;
  const top = cy + 3 * K, bottom = cy + 15 * K;
  const fillPx = Math.round(sim.level * (bottom - top));
  const surface = bottom - fillPx;

  // 주전자: 손잡이 쪽을 축으로 물줄기만큼 기운다 (0~35도)
  const ang = sim.flow * 35 * Math.PI / 180;
  const piv = [8 * K, 14 * K];               // 주전자 그림 안의 축 (손잡이)
  const P = [12, 16];                        // 화면의 축
  g.save();
  g.translate(P[0], P[1]); g.rotate(ang);
  g.drawImage(A.pot, -piv[0], -piv[1]);
  g.restore();
  const vx = A.spout.x - piv[0], vy = A.spout.y - piv[1];
  const sx = Math.round(P[0] + vx * Math.cos(ang) - vy * Math.sin(ang));
  const sy = Math.round(P[1] + vx * Math.sin(ang) + vy * Math.cos(ang));

  // 찻잔 + 안에 찬 차 (잔 몸통 칸만 칠해서 모양을 따른다)
  g.drawImage(A.cup, cx, cy);
  if (fillPx > 0) {
    g.fillStyle = color;
    for (const [x, y] of A.cells) {
      const y0 = Math.max(cy + y * K, surface), y1 = cy + (y + 1) * K;
      if (y1 > y0) g.fillRect(cx + x * K, y0, K, y1 - y0);
    }
    g.globalAlpha = 0.35;                    // 잔의 계피색 띠가 차 너머로 비친다
    for (const [x, y] of A.cells) if (POUR_CUP[y][x] === 'v' && cy + y * K >= surface) r('#c8805a', cx + x * K, cy + y * K, K, K);
    g.globalAlpha = 1;
    const wobble = still ? 0 : Math.round(Math.sin(t * 9) * sim.flow);
    g.fillStyle = '#ffffff66';
    g.fillRect(cx + 5 * K, Math.min(bottom - 1, surface + wobble), 11 * K, 1);
    if (sim.level > 0.9) {                   // 거의 찼으면 입구에도 차가 보인다
      g.fillStyle = color;
      for (const [x, y] of A.mouth) g.fillRect(cx + x * K, cy + y * K, K, K);
    }
  }
  // 목표선 (점선) + 왼쪽 표시
  const ly = bottom - Math.round(POUR.target * (bottom - top));
  for (let x = cx + 2; x < cx + 42; x += 4) r(C.line, x, ly, 2, 1);
  r(C.line, cx - 4, ly - 2, 4, 5);

  // 물줄기: 주둥이 끝에서 찻물 표면까지
  if (sim.flow > 0.02) {
    const wdt = Math.max(1, Math.round(sim.flow * 3));
    const end = Math.max(surface, top);
    for (let y = sy; y < end; y++) {
      const wav = still ? 0 : Math.round(Math.sin(y * 0.5 + t * 20) * 0.6);
      r(color, sx + Math.round((y - sy) * 0.12) + wav, y, wdt, 1);
    }
  }
  // 넘침: 잔 옆으로 흘러 받침·탁자에 고인다
  if (sim.spilled) {
    r(color, cx - 6, 85, A.cup.width + 4, 2);
    r(color, cx + 2, top - 1, 2, 12); r(color, cx + 39, top - 1, 2, 16);   // 잔 바깥으로 흐른 줄기
  }
}
