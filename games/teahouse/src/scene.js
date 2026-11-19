// 찻집 장면을 160×144 논리 해상도로 그린다. CSS 가 정수배로 키운다 (image-rendering: pixelated).
import {
  bake, PALETTE, GUEST_FACES, FACES, ITEM_ICONS, ITEM_MUG, itemIcon, MOTHER, MOTHER_SITTING,
  CAT, CAT_BLINK, CAT_EAR, CAT_PURR, CAT_LOOK, CAT_LOOK_BLINK, CAT_LOAF, CAT_GROOM1, CAT_GROOM2, CAT_STRETCH,
  CAT_SNEEZE_UP, CAT_PAW_UP, CAT_PAW_DOWN, CAT_SIT, FATHER,
} from './sprites.js';

export const W = 160;
export const H = 144;
/**
 * 위쪽 천장 띠 높이. 장면 속 물건 좌표는 "내용 좌표"(0 = 천장 띠 바로 아래, 카운터 윗면 92)로 적고,
 * 그릴 때 TOP 만큼 내린다. 밖에서 쓰는 좌표(hitCat, CAT_HOME)는 화면 좌표(160×144).
 */
export const TOP = 12;

const C = {
  night: '#141a33', night2: '#1d2547', star: '#f6efc8', moon: '#f7e7b0', moonShade: '#e2c98a',
  wall: '#3b2a30', wall2: '#33242a', plank: '#2c1f24',
  frame: '#6b4a3a', frameHi: '#8d6650',
  shelf: '#7a5440', shelfHi: '#9a6e52',
  counterTop: '#b07a4e', counterHi: '#c99062', counter: '#7a4f34', counterDark: '#5e3b27',
  lampCord: '#2a1e24', lampShade: '#d9894a', lampHi: '#f2b06a', bulb: '#fff2c4',
  glow: '#ffcf7a', pot: '#d8d0c4', potShade: '#a99f94', cupRim: '#f4efe6', cupShade: '#cfc6ba',
  steam: '#f4ece0', z: '#c9d6ff', spark: '#ffe08a',
  // 기억 장면 (세피아)
  memWall: '#e9c99a', memWall2: '#dcb784', memWin: '#4a5578', snow: '#fff1d2',
  memGlow: '#ffe0a0', memLamp: '#e8a45a', memShade: '#2e1c14',
  table: '#a0704a', tableHi: '#b8845a', stove: '#8a8a92', stoveHi: '#a6a6ae', jar: '#f2c230',
};

// ── 고양이 ────────────────────────────────────────────────────
// 프레임: [스프라이트, 그릴 x (바닥은 늘 y=92), 꼬리 뿌리 (x, y) | null]
const CAT_X = 126;
/** 장면 속 고양이 자리 (화면 160×144 좌표). y = 발 바닥선(카운터 윗면). 장면 고양이는 왼쪽을 본다 */
export const CAT_HOME = { x: CAT_X, y: 92 + TOP, w: 14, h: 7, facing: 'left' };
const CAT_FRAMES = {
  lie: [CAT, CAT_X, [13, 4]], blink: [CAT_BLINK, CAT_X, [13, 4]], ear: [CAT_EAR, CAT_X, [13, 4]],
  purr: [CAT_PURR, CAT_X, [13, 4]],
  look: [CAT_LOOK, CAT_X, [13, 6]], lookBlink: [CAT_LOOK_BLINK, CAT_X, [13, 6]],
  loaf: [CAT_LOAF, CAT_X + 2, null],
  groom1: [CAT_GROOM1, CAT_X - 1, [14, 5]], groom2: [CAT_GROOM2, CAT_X - 1, [14, 5]],
  stretch: [CAT_STRETCH, CAT_X - 4, [17, 2]],
  sneezeUp: [CAT_SNEEZE_UP, CAT_X, [13, 6]], achoo: [CAT_BLINK, CAT_X - 1, [14, 4]],
  pawUp: [CAT_PAW_UP, CAT_X - 2, [15, 4]], pawDown: [CAT_PAW_DOWN, CAT_X - 2, [15, 4]],
};
// 동작: [[프레임, 초, 꼬리 방식, 시작할 때 효과], ...]. 꼬리: 'sway'(기본) | 'thump'(탁) | 'up'(곧추) | 'slow'
// 효과: 'achoo'(코에서 퍼지는 작은 입김) | 'tap'(앞발 밑에 먼지 톡)
const GROOM = [['groom1', 0.3], ['groom2', 0.3]];
export const CAT_ACTS = {
  blink: [['blink', 0.14]],
  ear: [['ear', 0.22], ['lie', 0.14], ['ear', 0.18]],
  tail: [['lie', 1.5, 'thump']],
  look: [['look', 1.3], ['lookBlink', 0.14], ['look', 1.5], ['lookBlink', 0.14], ['look', 0.6]],
  groom: [...GROOM, ...GROOM, ...GROOM, ['lie', 0.2]],
  stretch: [['blink', 0.2], ['stretch', 1.8, 'slow'], ['lie', 0.2], ['blink', 0.3]],
  loaf: [['loaf', 4.5], ['lie', 0.15], ['blink', 0.15]],
  purr: [['purr', 2.8, 'slow']],
  sneeze: [['sneezeUp', 0.35], ['lie', 0.1], ['sneezeUp', 0.45], ['achoo', 0.2, 'thump', 'achoo'], ['blink', 0.35], ['lie', 0.3]],
  paw: [['pawUp', 0.25], ['pawDown', 0.22, 'sway', 'tap'], ['pawUp', 0.2], ['pawDown', 0.25, 'sway', 'tap'], ['lie', 0.2]],
};
// 가만히 있을 때 고르는 비율
const CAT_IDLE = [['blink', 4], ['ear', 2], ['tail', 2], ['look', 2], ['groom', 1.5], ['stretch', 1], ['loaf', 1]];

const CLOCK = [127, 10];   // 벽시계 중심

const SHELF_GLOW = 0.35;   // shelfGlow 에 값이 없을 때의 기본 빛 세기

const JARS = ['#f2c230', '#e0b070', '#f0a830', '#f4e04a', '#9a5a32', '#f4efe6', '#f0e0a0', '#9ad6a0'];

// 4×4 베이어 행렬 — 조명을 점묘(디더링)로 그려 픽셀 느낌을 살린다
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

// ── 잠든 도시 (창밖 야경 · 밤 끝 테라스) ─────────────────────
/** 잠 못 드는 창(불빛) 수. state.lights 는 0 ~ LIGHTS_MAX */
export const LIGHTS_MAX = 24;
/** 찻집 창 안쪽 (내용 좌표) */
const WIN = { x: 7, y: 5, w: 58, h: 52 };
const hash = (n) => {
  n = Math.imul(n | 0, 2654435761) >>> 0; n ^= n >>> 15; n = Math.imul(n, 2246822519) >>> 0; n ^= n >>> 13;
  return (n >>> 0) / 4294967296;
};
const isReduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * 언덕 위에서 내려다본 잠든 도시를 w×h 로 굽는다.
 * → { sky, land, stars: [[x,y,p]], lights: [[x,y]] (고정 순서, 최대 LIGHTS_MAX) }
 * sky = 하늘·달무리, land = 산등성이·건물(꺼진 창)·가로등 길·언덕 (위는 투명). 불빛·별은 매 프레임 그린다.
 */
function bakeCity(w, h, { horizon = 0.4, hill = 0.9, moon = null, seed = 1, rain = false, avoid = () => false } = {}) {
  const sky = new OffscreenCanvas(w, h), land = new OffscreenCanvas(w, h);
  const gs = sky.getContext('2d'), gl = land.getContext('2d');
  const dot = (g, c, x, y, ww = 1, hh = 1) => { g.fillStyle = c; g.fillRect(x, y, ww, hh); };
  const hy = Math.round(h * horizon);
  // 하늘: 위는 깊은 남색, 지평선으로 갈수록 보랏빛 (띠 사이는 베이어 점묘로 부드럽게)
  const band = rain ? ['#0b0e20', '#11162c', '#191e36', '#22243e'] : ['#100d2a', '#1a1844', '#2a2258', '#46306a'];
  for (let y = 0; y < h; y++) {
    const pos = Math.min(0.999, y / (hy + 10)) * (band.length - 1);
    const i = Math.floor(pos), f = pos - i;
    for (let x = 0; x < w; x++) dot(gs, f > BAYER[(y & 3) * 4 + (x & 3)] ? band[i + 1] : band[i], x, y);
  }
  const stars = [];
  if (rain) {
    for (let x = 0; x < w; x += 2) dot(gs, '#1a2038', x, Math.round(h * 0.08) + ((x * 7) % 3), 2, 1);   // 낮은 비구름
    for (let x = 0; x < w; x += 3) dot(gs, '#161b32', x, Math.round(h * 0.2) + ((x * 5) % 4), 3, 1);
  } else {
    const [mx, my] = moon ? [Math.round(w * moon[0]), Math.round(h * moon[1])] : [-99, -99];
    if (moon) {
      // 달무리: 라벤더 빛 고리가 점묘로 번진다
      gs.fillStyle = '#b8a8e8';
      for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) {
        const d = Math.hypot(x, y);
        const lv = d < 6 ? 0 : 0.55 * Math.max(0, 1 - (d - 6) / 10) * (d < 8 ? 1 : 0.8);
        if (lv > BAYER[((my + y) & 3) * 4 + ((mx + x) & 3)]) { gs.globalAlpha = 0.35; gs.fillRect(mx + x, my + y, 1, 1); }
      }
      gs.globalAlpha = 1;
      for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
        if (x * x + y * y <= 25) dot(gs, (x + 2) ** 2 + (y - 1) ** 2 > 21 ? '#e8d4a0' : '#fbf0c8', mx + x, my + y);
      }
    }
    for (let i = 0; i < (w * h) / 420; i++) {
      const sx = Math.floor(hash(i * 3 + seed * 1000) * w), sy = Math.floor(hash(i * 5 + 9 + seed * 1000) * (hy - 12));
      if (Math.hypot(sx - mx, sy - my) > 10) stars.push([sx, sy, hash(i + 77 + seed) * 6.28]);
    }
  }
  // 먼 산등성이
  for (let x = 0; x < w; x++) {
    const top = hy - 4 - Math.round(3 * Math.sin((x + seed * 9) * 0.07) + 2 * Math.sin(x * 0.19));
    dot(gl, rain ? '#181a30' : '#211d46', x, top, 1, hy - top + 2);
  }
  // 건물 (먼 줄 → 가까운 줄). 대부분은 꺼진 창, 가끔 "잠 못 드는 창" 후보
  const cand = [];
  const layers = [
    { base: hy + 2, minH: 3, maxH: 9, col: '#28254e', win: '#423a5e', bw: [3, 6] },
    { base: hy + 8, minH: 4, maxH: 13, col: '#1e1b3e', win: '#45384e', bw: [4, 8] },
  ];
  const near = Math.round(h * (hill - 0.02));
  if (near - hy > 30) layers.push({ base: near, minH: Math.round((near - hy) * 0.45), maxH: Math.round((near - hy) * 0.75), col: '#17152f', win: '#40324a', bw: [6, 12] });
  layers.forEach((L, li) => {
    let x = -2, i = 0;
    while (x < w) {
      const bw = L.bw[0] + Math.floor(hash(i * 13 + li * 101 + seed) * (L.bw[1] - L.bw[0]));
      const bh = L.minH + Math.floor(hash(i * 17 + li * 53 + seed) * (L.maxH - L.minH));
      const top = L.base - bh;
      dot(gl, L.col, x, top, bw, h - top);
      if (hash(i * 19 + li + seed) < 0.2) dot(gl, L.col, x + 1, top - 2, 1, 2);    // 안테나
      for (let wy = top + 2; wy < Math.min(L.base + 6, h); wy += 2) for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
        if (wx < 2 || wx >= w - 3) continue;
        const v = hash(wx * 7 + wy * 131 + li * 977 + seed);
        if (v < 0.22) dot(gl, L.win, wx, wy);
        else if (v > 0.8 && wy > 3 && wy < h * (hill - 0.04) && !avoid(wx, wy)) cand.push([wx, wy]);
      }
      x += bw + (hash(i * 23 + seed) < 0.3 ? 1 : 0); i++;
    }
  });
  // 굽은 길 + 가로등
  for (let x = 0; x < w; x++) {
    const y = Math.round(hy + 14 + 4 * Math.sin(x * 0.045 + 1));
    if (y < h) { dot(gl, '#141228', x, y, 1, 2); if (x % 7 === 0) dot(gl, '#c88a4a', x, y - 1); }
  }
  // 언덕 앞자락 (찻집이 앉은 곳)
  for (let x = 0; x < w; x++) {
    const top = Math.round(h * hill + 2 * Math.sin(x * 0.09) + x * 0.04);
    dot(gl, '#0d0b1c', x, top, 1, h - top);
    if (hash(x * 5 + seed) < 0.3) dot(gl, '#0d0b1c', x, top - 1);                   // 풀
  }
  // 불빛 자리: 고정 순서로 섞고 서로 떨어진 것만 → 앞에서부터 state.lights 개가 켜진다
  const key = (a) => hash(((a[0] * 7919) ^ (a[1] * 104729)) + 12345 + seed);
  cand.sort((a, b) => key(a) - key(b));
  const lights = [];
  const gap = Math.max(5, w / 14);
  for (const a of cand) {
    if (lights.length >= LIGHTS_MAX) break;
    if (lights.every((b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > gap)) lights.push(a);
  }
  return { sky, land, stars, lights };
}

/** 떠다니는 빛가루 (반딧불처럼 아주 천천히 오르며 흔들린다) */
function makeMotes(n, rect, cols, seed = 1) {
  return Array.from({ length: n }, (_, i) => ({
    x: rect.x + hash(i * 3 + seed) * rect.w, y: rect.y + hash(i * 7 + seed) * rect.h,
    v: 1.5 + hash(i * 11 + seed) * 2.5, p: hash(i * 13 + seed) * 6.28, c: cols[i % cols.length],
  }));
}

export class Scene {
  constructor(canvas) {
    this.g = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;
    this.g.imageSmoothingEnabled = false;
    this.sprites = {
      mother: bake(MOTHER), motherSitting: bake(MOTHER_SITTING), father: bake(FATHER),
    };
    this.catImg = Object.fromEntries(Object.entries(CAT_FRAMES).map(([k, [rows]]) => [k, bake(rows)]));
    this.cat = { steps: null, i: 0, tt: 0, done: null, wait: 3 };
    this.items = Object.fromEntries(Object.entries(ITEM_ICONS).map(([k, rows]) => [k, bake(rows)]));
    // 손님 표정: face → [기본 프레임, 보조 프레임(깜빡임·눈물 반짝)]
    this.faces = Object.fromEntries(Object.entries(GUEST_FACES).map(([id, set]) => [
      id, Object.fromEntries(Object.entries(set).map(([face, frames]) => [face, frames.map((rows) => bake(rows))])),
    ]));
    // 창밖 야경 (맑은 밤 / 비 오는 밤: 불빛 자리는 같다)
    const winOpt = { horizon: 0.4, hill: 0.9, moon: [0.24, 0.2], seed: 3 };
    this.city = bakeCity(WIN.w, WIN.h, winOpt);
    this.cityRain = bakeCity(WIN.w, WIN.h, { ...winOpt, rain: true });
    this.winMotes = makeMotes(7, WIN, ['#e8dcff', '#ffe2a0', '#c8d8ff'], 5);
    this.roomMotes = makeMotes(9, { x: 56, y: 22, w: 44, h: 52 }, ['#ffe2a0', '#ffd8a0'], 9);
    this.dimFx = null;
    this.room = this.#bakeRoom();
    this.roomRain = this.#bakeRoom('rain');
    this.windowFront = new OffscreenCanvas(W, H);
    this.#bakeWindowFront(this.windowFront.getContext('2d'));
    // 빗줄기(창밖)와 유리창 물방울
    this.rain = Array.from({ length: 48 }, () => ({ x: WIN.x + Math.random() * (WIN.w + 10), y: WIN.y + Math.random() * WIN.h, v: 70 + Math.random() * 40 }));
    this.drops = Array.from({ length: 10 }, () => this.#newDrop(true));
    // 램프 빛: 창 안(야경)에는 아주 약하게만 → 밤하늘이 탁해지지 않게
    this.glow = this.#bakeGlow(80, 26 + TOP, 64, C.glow, (x, y) => (x >= WIN.x - 1 && x < WIN.x + WIN.w + 1 && y >= WIN.y + TOP && y < WIN.y + WIN.h + TOP ? 0.25 : 1));
    // 기억 장면: id → { draw(굽기), glow 중심, 파티클 }. 처음 쓸 때 한 번 굽는다.
    this.memories = {
      'harin-1': { draw: (g, r) => this.#memHarin1(g, r), lamp: [70, 30], fx: (dt) => {
        if (Math.random() < dt * 6) this.emit('snow', 100 + Math.random() * 38, 14);
        if (Math.random() < dt * 3) this.emit('steam', 118, 64);
        if (Math.random() < dt * 2) this.emit('steam', 18, 49);
      } },
      'harin-2': { draw: (g, r) => this.#memHarin2(g, r), lamp: [86, 34], fx: (dt) => {
        if (Math.random() < dt * 4) this.emit('snow', 15 + Math.random() * 34, 15);
        // 엄마 잔은 식어 있다 → 김이 나지 않는다
      } },
      'taeo-1': { draw: (g, r) => this.#memTaeo1(g, r), lamp: [80, 32], fx: (dt) => {
        if (Math.random() < dt * 14) this.emit('rain', 16 + Math.random() * 128, 10);
        if (Math.random() < dt * 2.5) this.emit('steam', 62, 64);
        if (Math.random() < dt * 2.5) this.emit('steam', 95, 64);
      } },
      'dahui-1': { draw: (g, r) => this.#memDahui1(g, r), lamp: [84, 34], fx: (dt) => {
        if (Math.random() < dt * 3) this.emit('dust', 20 + Math.random() * 60, 40 + Math.random() * 40);   // 햇빛 속 먼지
        if (Math.random() < dt * 1.5) this.emit('steam', 136 + Math.random() * 8, 60);                     // 냉장고 냉기
      } },
      'sukyung-1': { draw: (g, r) => this.#memSukyung1(g, r), lamp: [110, 52], fx: (dt) => {
        if (Math.random() < dt * 3) this.emit('steam', 112, 46);                                            // 데우는 우유
      } },
    };
    this.baked = {};
    this.ceiling = this.#bakeCeiling();
    this.terrace = null;   // 처음 'terrace' 를 그릴 때 굽는다
    this.flashFx = null;
    this.particles = [];
    this.state = {
      mode: 'shop',          // 'shop' | 'memory' | 'terrace' (밤 끝, 문 밖 테라스에서 도시를 내려다본다)
      memory: 'harin-1',     // mode 'memory' 일 때 그릴 기억 (setMemory 로 바꾼다)
      shelf: [],             // 선반 위 꿈 조각 id 목록 (예: ['letter', 'mug'])
      clock: 120,            // 벽시계, 분 단위 (120 = 2:00, 150 = 2:30)
      weather: 'clear',      // 'clear' | 'rain'
      shelfGlow: {},         // id → 0~1 빛 세기 (없으면 0.35). 피날레에서 1 로 올리면 등불처럼 켜진다
      catOut: false,         // true 면 고양이가 틀 밖(roam.js)에 나가 있다 → 장면 안엔 안 그린다
      guest: null,           // null | 'harin' | 'taeo' (GUEST_FACES 에 있는 id)
      guestFace: 'normal',   // 'normal' | 'smile' | 'teary' | 'asleep' | 'asleep-smile'
      guestAsleep: false,    // (하위 호환) true 면 guestFace 와 상관없이 잠든 얼굴
      guestY: 0,             // 등장 애니메이션 (0 = 제자리, 양수 = 아래로 숨음)
      cup: null,             // null | '#rrggbb'
      fade: 0,               // 0 ~ 1 검은 막
      lights: LIGHTS_MAX,    // 도시에 남은 "잠 못 드는 창" 수 (0 ~ LIGHTS_MAX). 창밖과 테라스 둘 다
    };
    this.t = 0;
  }

  // ── 정적 레이어 ──────────────────────────────────────────────
  #bakeRoom(weather = 'clear') {
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    const r = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    this.#bakeShopCeiling(r);
    g.translate(0, TOP);

    // 벽: 세로 판자
    r(C.wall, 0, 0, W, 96);
    for (let x = 0; x < W; x += 12) r(C.wall2, x, 0, 6, 96);
    for (let x = 11; x < W; x += 12) r(C.plank, x, 0, 1, 96);

    // 큰 창: 언덕 아래 잠든 도시 (비 오는 밤엔 달·별 없이 어둡게)
    r(C.frame, WIN.x - 3, WIN.y - 3, WIN.w + 6, WIN.h + 6);
    const city = weather === 'rain' ? this.cityRain : this.city;
    g.drawImage(city.sky, WIN.x, WIN.y);
    g.drawImage(city.land, WIN.x, WIN.y);
    this.#bakeWindowFront(g);
    return this.#bakeRoomRest(c, g, r);
  }

  /** 천장 띠 (화면 좌표 0~TOP): 어두운 천장 판자, 나무 들보, 램프 줄 */
  #bakeShopCeiling(r) {
    r('#241a20', 0, 0, W, TOP);
    for (let x = 0; x < W; x += 16) r('#2c2026', x, 0, 8, TOP - 4);
    r('#5a3d2e', 0, TOP - 4, W, 4);                 // 들보
    r('#7a5440', 0, TOP - 4, W, 1);
    r('#3e2a20', 0, TOP - 1, W, 1);
    for (let x = 6; x < W; x += 38) { r('#3e2a20', x, TOP - 3, 1, 2); }   // 들보 이음
    r(C.lampCord, 80, 0, 1, TOP);                    // 램프 줄은 천장에서
  }

  /** 들보에 매단 마른 허브 다발 (내용 좌표, 들보 바로 아래) */
  #bakeHerbs(r) {
    for (const [x, len, col, dark] of [[95, 7, '#b08a5a', '#8a6a44'], [113, 8, '#8a9a5a', '#6a7a44'], [148, 10, '#a07a8a', '#7a5a6a']]) {
      r('#c9a86a', x, 0, 1, 2);                      // 끈
      r('#c9a86a', x - 1, 2, 3, 1);                  // 묶은 매듭
      for (let i = 0; i < len; i++) {                // 아래로 퍼지는 다발
        const w = 1 + Math.min(3, Math.floor(i / 2));
        r(i % 2 ? dark : col, x - Math.floor(w / 2), 3 + i, w, 1);
      }
      r(dark, x - 2, 3 + len, 1, 1); r(dark, x + 2, 2 + len, 1, 1);
    }
  }

  /** 창살·창틀·화분: 비 오는 밤엔 빗줄기 위에 다시 그려야 해서 따로 */
  #bakeWindowFront(g) {
    const r = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    // 창은 비워 둔다: 창틀 + 창턱만 (창살 없음)
    r(C.frameHi, WIN.x - 3, WIN.y - 3, WIN.w + 6, 1);
    r(C.frame, WIN.x - 5, WIN.y + WIN.h + 1, WIN.w + 10, 3);
    r(C.frameHi, WIN.x - 5, WIN.y + WIN.h + 1, WIN.w + 10, 1);
  }

  #bakeRoomRest(c, g, r) {
    // 벽시계 (바늘은 매 프레임 state.clock 으로)
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
      const d = x * x + y * y;
      if (d <= 42) r(d <= 26 ? '#efe2c4' : C.frame, CLOCK[0] + x, CLOCK[1] + y, 1, 1);
    }
    r(C.frameHi, CLOCK[0] - 2, CLOCK[1] - 7, 5, 1);
    for (const [dx, dy] of [[0, -4], [4, 0], [0, 4], [-4, 0]]) r('#a08a74', CLOCK[0] + dx, CLOCK[1] + dy, 1, 1);

    // 선반과 유리병
    for (const [y, start] of [[34, 0], [58, 4]]) {
      r(C.shelf, 100, y, 54, 3);
      r(C.shelfHi, 100, y, 54, 1);
      for (let i = 0; i < 4; i++) {
        const x = 104 + i * 13;
        const col = JARS[start + i];
        r('#e8e2d8', x, y - 12, 9, 12);       // 유리
        r(col, x + 1, y - 8, 7, 7);            // 내용물
        r('#ffffff', x + 1, y - 11, 1, 3);     // 반짝임
        r('#7a5440', x + 1, y - 14, 7, 2);     // 뚜껑
      }
    }

    // 꿈 조각 선반 (손님이 남기고 간 것들이 놓인다)
    r(C.shelf, 100, 80, 54, 2);
    r(C.shelfHi, 100, 80, 54, 1);
    r(C.frame, 103, 82, 2, 2); r(C.frame, 149, 82, 2, 2);   // 받침

    // 카운터
    r(C.counterTop, 0, 92, W, 6);
    r(C.counterHi, 0, 92, W, 1);
    r(C.counter, 0, 98, W, 46);
    for (let x = 0; x < W; x += 20) r(C.counterDark, x, 98, 1, 46);
    r(C.counterDark, 0, 98, W, 2);
    r(C.counterDark, 0, 120, W, 1);
    // 늘어난 아래쪽 (내용 좌표 121~131 이 화면 끝): 아래 패널 · 발걸이 놋쇠 봉 · 걸레받이와 바닥
    for (let x = 4; x < W; x += 20) { r('#6a432c', x, 121, 12, 3); r(C.counterDark, x + 1, 123, 11, 1); }
    r('#d4ac58', 0, 125, W, 1); r('#8a6a34', 0, 126, W, 1);        // 발걸이 봉
    for (let x = 10; x < W; x += 40) r('#5e4a2a', x, 124, 2, 4);  // 봉 받침
    r('#3a2620', 0, 128, W, 2);                                    // 걸레받이
    r('#4a3428', 0, 130, W, 2);
    for (let x = 0; x < W; x += 24) r('#3e2c22', x, 130, 1, 2);    // 바닥 판자

    // 찻주전자 (왼쪽)
    r(C.potShade, 22, 80, 18, 12);
    r(C.pot, 23, 80, 16, 10);
    r(C.pot, 25, 77, 12, 3);
    r(C.potShade, 29, 74, 4, 3);              // 꼭지
    r(C.pot, 16, 82, 6, 2); r(C.pot, 14, 80, 3, 2); // 주둥이
    r(C.potShade, 40, 81, 2, 7); r(C.potShade, 42, 82, 1, 5); // 손잡이
    r('#e3b7a0', 26, 84, 10, 2);              // 무늬
    this.#bakeHerbs(r);
    return c;
  }

  #bakeGlow(cx, cy, R, color = C.glow, mask = null) {
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = color;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.1) / R;
      const level = Math.max(0, 1 - d) * 0.9 * (mask ? mask(x, y) : 1);
      if (level > BAYER[(y % 4) * 4 + (x % 4)]) g.fillRect(x, y, 1, 1);
    }
    return c;
  }

  /** 기억 장면 하나를 굽는다: 장면 → 세피아 → 핵심 물건만 색 되살림 → 점묘 비네트 */
  #bakeMemory(id) {
    const m = this.memories[id];
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    const r = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    // 위쪽 띠: 벽이 천장 몰딩까지 이어지고, 천장 등 줄이 내려온다
    r(C.memWall, 0, 0, W, TOP); r('#c8a478', 0, 0, W, 3); r('#b8946a', 0, 3, W, 1);
    r('#5a4030', m.lamp[0], 0, 1, TOP);
    g.translate(0, TOP);
    const keep = m.draw(g, r);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.#sepia(g, 0.8, 0.82);   // 밤이니까 조금 어둡게 → 등불이 살아난다
    g.translate(0, TOP);
    keep?.();                    // 그 기억의 핵심 물건만 빛바래지 않는다
    g.setTransform(1, 0, 0, 1, 0, 0);
    // 가장자리를 점묘로 어둡게 → 오래된 사진처럼 아련하게
    g.fillStyle = C.memShade;
    const [cx] = m.lamp;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - cx) / 96, (y - 46 - TOP) / 80);
      if (Math.max(0, d - 0.74) * 1.3 > BAYER[(y % 4) * 4 + (x % 4)]) g.fillRect(x, y, 1, 1);
    }
    return { canvas: c, glow: this.#bakeGlow(m.lamp[0], m.lamp[1] + TOP, 52, C.memGlow) };
  }

  /** 기억 장면 바꾸기. id: 'harin-1' | 'harin-2' | 'taeo-1' | 'dahui-1' | 'sukyung-1' */
  setMemory(id) {
    if (!this.memories[id]) throw new Error(`unknown memory: ${id}`);
    this.state.memory = id;
    this.baked[id] ??= this.#bakeMemory(id);
  }

  /** 하린 밤 1: 열일곱, 겨울밤. 가스레인지 앞에서 유자차를 타는 엄마의 뒷모습 */
  #memHarin1(g, r) {
    const FLOOR = 92;
    r(C.memWall, 0, 0, W, FLOOR);
    for (let y = 0; y < FLOOR; y += 8) r(C.memWall2, 0, y, W, 1);
    r('#c9a77e', 0, FLOOR, W, H - FLOOR);
    r('#b8946a', 0, FLOOR, W, 1);
    // 눈 내리는 창
    r('#8a6a4a', 96, 10, 46, 36); r(C.memWin, 99, 13, 40, 30); r('#8a6a4a', 118, 13, 2, 30);
    // 가스레인지와 주전자
    r(C.stove, 6, 62, 44, FLOOR - 62); r(C.stoveHi, 6, 62, 44, 2);
    r('#6e6e76', 10, 70, 36, 1); r('#6e6e76', 10, 80, 36, 1);
    r('#3a3a40', 12, 58, 14, 4);
    r('#5a4a40', 13, 49, 14, 10); r('#d0cabe', 14, 50, 12, 8); r('#b0aa9e', 14, 56, 12, 2);   // 주전자
    r('#5a4a40', 26, 51, 4, 3); r('#d0cabe', 26, 52, 3, 1); r('#5a4a40', 17, 47, 6, 2);
    // 엄마 (뒷모습, 가스레인지 앞에 서서 차를 탄다) — 주전자는 왼쪽으로 보이게
    g.drawImage(this.sprites.mother, 32, FLOOR + 1 - MOTHER.length);
    // 식탁
    r(C.table, 78, 76, 82, 6); r(C.tableHi, 78, 76, 82, 1);
    r(C.table, 84, 82, 4, FLOOR - 82 + 6); r(C.table, 150, 82, 4, FLOOR - 82 + 6);
    // 머그잔
    r('#f4efe6', 112, 66, 12, 10); r('#e7b84a', 113, 67, 10, 3); r('#f4efe6', 124, 68, 3, 5);
    // 참고서 더미
    r('#6a86b0', 130, 70, 22, 3); r('#b06a6a', 132, 67, 18, 3); r('#e0d6c0', 130, 73, 22, 3);
    // 천장 등 (식탁과 엄마 사이)
    r('#5a4030', 70, 0, 1, 20);
    r(C.memLamp, 64, 20, 13, 4); r(C.memLamp, 62, 24, 17, 2); r('#f4c47a', 65, 20, 11, 1);
    r('#fff2c4', 68, 26, 5, 1);
    // 핵심 물건: 노란 병 — 하린이 기억하는 단 하나의 색
    return () => {
      r('#f6efe2', 92, 62, 10, 14); r(C.jar, 93, 66, 8, 9); r('#ffe27a', 94, 67, 2, 3); r('#8a5a3a', 93, 60, 8, 2);
    };
  }

  /** 하린 밤 2: 열 살, 겨울 새벽. 식탁에 앉아 계산기를 두드리는 엄마의 옆모습, 식은 머그잔 */
  #memHarin2(g, r) {
    const FLOOR = 92;
    r(C.memWall, 0, 0, W, FLOOR);
    for (let x = 0; x < W; x += 10) r(C.memWall2, x, 0, 1, FLOOR);   // 이번엔 세로 벽지
    r('#c9a77e', 0, FLOOR, W, H - FLOOR);
    r('#b8946a', 0, FLOOR, W, 1);
    for (let x = 6; x < W; x += 16) r('#b8946a', x, FLOOR + 1, 1, H - FLOOR);   // 장판 이음새
    // 새벽 창 (아직 어둡고, 아래쪽만 희미하게 밝아 온다)
    r('#8a6a4a', 12, 12, 38, 34); r('#2e3656', 15, 15, 32, 28);
    r('#3e4870', 15, 33, 32, 6); r('#5a6488', 15, 39, 32, 4); r('#8a6a4a', 30, 15, 2, 28);
    r('#8a6a4a', 10, 45, 42, 2);
    // 벽시계 (네 시 조금 넘어)
    r('#6a4a36', 98, 14, 11, 11); r('#f2e8d4', 99, 15, 9, 9);
    r('#3a2a24', 103, 16, 1, 4); r('#3a2a24', 104, 19, 2, 1); r('#3a2a24', 105, 20, 1, 1);
    // 냉장고
    r('#5a5a60', 130, 26, 26, FLOOR - 26); r('#d8d6d0', 131, 27, 24, 64); r('#b8b6b0', 131, 50, 24, 1);
    r('#8a8a90', 133, 34, 1, 10); r('#8a8a90', 133, 54, 1, 12);
    r('#d06a5a', 146, 32, 4, 4); r('#f2e4a0', 140, 58, 8, 6);   // 자석과 메모 (아이 그림)
    // 식탁 (다리 먼저)
    r(C.table, 54, 74, 70, 4); r(C.tableHi, 54, 74, 70, 1);
    r('#7a5236', 58, 78, 3, FLOOR - 78); r('#7a5236', 117, 78, 3, FLOOR - 78);
    // 계산기와 장부
    r('#3a3a40', 64, 69, 11, 5); r('#9ab09a', 65, 70, 9, 1);
    for (let x = 65; x < 74; x += 2) r('#c8c8cc', x, 72, 1, 1);
    r('#3a4a6a', 77, 70, 24, 4); r('#fbf4e2', 78, 70, 22, 3); r('#8a7a6a', 89, 70, 1, 3);   // 펼친 장부
    r('#6a5a4a', 80, 71, 7, 1); r('#6a5a4a', 91, 71, 6, 1); r('#6a5a4a', 80, 72, 5, 1); r('#6a5a4a', 91, 72, 7, 1);
    // 엄마 (옆모습, 의자에 앉아 식탁 위에 팔을 올렸다)
    g.drawImage(this.sprites.motherSitting, 32, FLOOR + 1 - MOTHER_SITTING.length);
    // 천장 등 (식탁 위)
    r('#5a4030', 86, 0, 1, 22);
    r(C.memLamp, 80, 22, 13, 4); r(C.memLamp, 78, 26, 17, 2); r('#f4c47a', 81, 22, 11, 1);
    r('#fff2c4', 84, 28, 5, 1);
    // 핵심 물건: 이 빠진 머그잔 (식어서 김이 나지 않는다)
    return () => g.drawImage(this.items.mug, 104, 74 - ITEM_MUG.length);
  }

  /** 태오: 6월 장마 첫날, 골목 카페 창가 2인석. 맞은편은 사람 대신 흐릿한 빛 (상대는 그리지 않는다) */
  #memTaeo1(g, r) {
    const FLOOR = 100;
    r(C.memWall, 0, 0, W, FLOOR);
    for (let x = 0; x < W; x += 8) r(C.memWall2, x, 0, 1, FLOOR);   // 나무 벽
    r('#9a7452', 0, FLOOR, W, H - FLOOR); r('#86603e', 0, FLOOR, W, 1);
    for (let x = 4; x < W; x += 12) r('#86603e', x, FLOOR + 1, 1, H - FLOOR);
    // 큰 창: 비 오는 골목 (흐린 하늘, 번진 가로등·간판 불빛)
    r('#6a4a34', 12, 6, 136, 58);
    r('#4a5468', 15, 9, 130, 52); r('#56607a', 15, 9, 130, 14);
    for (const [x, y, col] of [[30, 30, '#e8c070'], [46, 36, '#d08070'], [104, 28, '#e8c070'], [126, 40, '#e8d8a0'], [70, 44, '#c8d0e0']]) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {   // 번진 불빛 (점묘)
        const d = Math.hypot(dx, dy) / 3.4;
        if (d < 1 && (1 - d) > BAYER[((y + dy) & 3) * 4 + ((x + dx) & 3)]) r(col, x + dx, y + dy, 1, 1);
      }
    }
    r('#3e4658', 15, 50, 130, 11);                                   // 건너편 담
    for (let i = 0; i < 46; i++) r('#9aa6c0', 16 + (i * 37) % 128, 11 + (i * 23) % 48, 1, 1 + (i % 2));   // 유리의 빗방울
    r('#6a4a34', 79, 9, 3, 52); r('#6a4a34', 15, 34, 130, 2);      // 창살
    r('#7a5638', 8, 63, 144, 4); r('#9a7452', 8, 63, 144, 1);      // 창턱
    // 테이블 (외다리, 2인용)
    r(C.table, 50, 74, 60, 4); r(C.tableHi, 50, 74, 60, 1);
    r('#7a5236', 78, 78, 4, FLOOR - 80); r('#7a5236', 68, FLOOR - 2, 24, 2);
    // 의자 둘: 왼쪽엔 젖은 남색 코트가 걸려 있다(태오), 오른쪽은 그 사람의 자리
    for (const x of [30, 118]) {
      r('#6a4628', x, 60, 3, 40); r('#6a4628', x + 9, 78, 3, 22);   // 등받이·다리
      r('#7a5636', x, 78, 12, 3);                                    // 앉는 면
    }
    r('#2c3552', 28, 60, 7, 14); r('#1d2338', 28, 72, 7, 2); r('#2c3552', 27, 62, 1, 9);   // 걸쳐 둔 코트
    // 작은 꽃병, 영수증
    r('#d8d0c4', 77, 66, 4, 8); r('#9ab07a', 78, 62, 1, 4); r('#e8a8a0', 77, 60, 3, 2);
    r('#f2ece0', 98, 74, 7, 1); r('#d8cfc0', 98, 75, 7, 1);
    // 천장 등
    r('#5a4030', 80, 0, 1, 20);
    r(C.memLamp, 74, 20, 13, 4); r(C.memLamp, 72, 24, 17, 2); r('#f4c47a', 75, 20, 11, 1);
    r('#fff2c4', 78, 26, 5, 1);
    // 핵심: 시나몬 밀크티 두 잔은 빛바래지 않는다 + 맞은편의 흐릿한 빛
    return () => {
      const mug = (x, stick) => {
        r('#f4efe6', x, 66, 9, 8); r('#d9cfc2', x, 72, 9, 2);
        r('#c89a6a', x + 1, 66, 7, 2);                                 // 밀크티
        r('#f4efe6', x + 9, 68, 2, 1); r('#f4efe6', x + 10, 69, 1, 2); r('#f4efe6', x + 9, 71, 2, 1);   // 손잡이
        if (stick) { r('#8a4a24', x + 5, 61, 1, 6); r('#a85e30', x + 6, 62, 1, 4); }                     // 시나몬 스틱
      };
      mug(58, false);
      mug(91, true);
      // 그 사람: 얼굴도 몸도 없이, 자리에 남은 따뜻한 빛 (점묘)
      for (let y = 30; y < 100; y++) for (let x = 92; x < 146; x++) {
        if (y >= 74 && x < 111) continue;                             // 테이블 앞으로는 번지지 않게
        const head = Math.hypot((x - 120) / 8, (y - 47) / 9);
        const body = Math.hypot((x - 120) / 15, (y - 72) / 17);
        const level = Math.max(0, 1 - Math.min(head, body)) * 0.9;
        if (level > BAYER[(y & 3) * 4 + (x & 3)]) r(level > 0.45 ? '#fff4dc' : '#f6dcb0', x, y, 1, 1);
      }
    };
  }

  /** 다희: 여름방학 할머니 댁 오후. 낮은 상, 선풍기, 열린 냉장고 불빛, 매미 우는 마당. 땀 맺힌 유리 물병의 보리차만 색이 남는다 */
  #memDahui1(g, r) {
    const FLOOR = 94;
    r(C.memWall, 0, 0, W, FLOOR);
    r('#d8b88c', 0, 64, W, FLOOR - 64); r('#b8946a', 0, 64, W, 1);         // 벽 아래 나무 판
    for (let x = 0; x < W; x += 9) r('#c8a47a', x, 65, 1, FLOOR - 65);
    r('#c9a77e', 0, FLOOR, W, H - FLOOR); r('#b8946a', 0, FLOOR, W, 1);    // 마루
    for (let y = FLOOR + 6; y < H; y += 7) r('#b8946a', 0, y, W, 1);
    // 활짝 열린 창: 마당의 큰 나무와 쨍한 여름 하늘
    r('#8a6a4a', 6, 6, 82, 50);
    r('#f2e2b8', 9, 9, 76, 44);
    for (const [cx, cy, rad] of [[30, 26, 15], [52, 20, 13], [70, 30, 12], [42, 36, 12]]) {        // 나무 잎 (점묘)
      for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (x > 9 && x < 85 && y > 9 && y < 53 && d < 1 && 1 - d * 0.6 > BAYER[(y & 3) * 4 + (x & 3)]) r(d < 0.5 ? '#7a8a4a' : '#9aa660', x, y, 1, 1);
      }
    }
    r('#6a5034', 46, 40, 4, 13);                                           // 나무 줄기
    r('#b8a070', 9, 48, 76, 5);                                            // 담장
    r('#8a6a4a', 46, 9, 2, 44);                                            // 미닫이 창틀
    r('#8a6a4a', 4, 55, 86, 3);
    // 창으로 들어온 햇빛이 마루에 눕는다 (점묘 사다리꼴)
    for (let y = FLOOR; y < H - TOP; y++) for (let x = 0; x < W; x++) {
      const t = (y - FLOOR) / 30, x0 = 18 + t * 30, x1 = 92 + t * 38;
      if (x > x0 && x < x1 && 0.4 > BAYER[(y & 3) * 4 + (x & 3)]) r('#f6e4bc', x, y, 1, 1);
    }
    // 선풍기 (왼쪽 바닥, 고개를 돌리는 중)
    r('#b8b2a6', 14, 92, 14, 3); r('#9a948a', 20, 72, 3, 21);
    for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
      const d = Math.hypot(x, y);
      if (d <= 10 && (d > 8.6 || x === 0 || y === 0 || Math.abs(x) === Math.abs(y))) r('#d0cabe', 21 + x, 62 + y, 1, 1);
    }
    r('#9a948a', 19, 60, 5, 5); r('#e8e2d6', 20, 61, 3, 3);
    // 열린 냉장고 (오른쪽): 문 안쪽 칸과 새어 나오는 차가운 불빛
    r('#7a7a80', 128, 22, 28, FLOOR - 22); r('#e8e6e0', 130, 24, 24, FLOOR - 26);
    r('#fffbea', 132, 26, 20, 56);                                          // 안쪽 빛
    for (const y of [40, 54, 68]) r('#c8c6c0', 132, y, 20, 1);              // 선반
    r('#d8d4c4', 134, 58, 6, 9); r('#e0c890', 142, 44, 8, 9); r('#c0c8a0', 134, 30, 12, 9);    // 반찬통·김치통
    r('#c8c0a8', 133, 75, 6, 6);                                            // 맨 아래 칸: 물병 옆 작은 통
    r('#d8d6d0', 108, 24, 18, 64); r('#b8b6b0', 109, 26, 3, 60);            // 열린 문 (비스듬히)
    for (const y of [36, 54, 70]) r('#c8c6c0', 112, y, 13, 3);
    for (let y = 30; y < FLOOR + 12; y++) for (let x = 112; x < 158; x++) {   // 냉장고 불빛이 마루로
      const d = Math.hypot((x - 142) / 26, (y - 70) / 34);
      if (d < 1 && (x < 128 || y > FLOOR) && (1 - d) * 0.3 > BAYER[(y & 3) * 4 + (x & 3)]) r('#fff8e0', x, y, 1, 1);
    }
    // 낮은 상 (동그란 밥상) + 수박 접시, 부채
    r(C.table, 52, 82, 56, 5); r(C.tableHi, 52, 82, 56, 1);
    r('#7a5236', 58, 87, 4, FLOOR - 87); r('#7a5236', 98, 87, 4, FLOOR - 87);
    r('#f2ece0', 84, 78, 14, 4); r('#d06a5a', 86, 76, 4, 3); r('#d06a5a', 91, 76, 4, 3); r('#7a9a5a', 86, 79, 9, 1);
    // 할머니 부채 (둥근 부채, 상 위)
    for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) if ((x / 5) ** 2 + (y / 4) ** 2 <= 1) r((x + y) % 3 ? '#e8d8b0' : '#d0b888', 66 + x, 76 + y, 1, 1);
    r('#8a6a4a', 70, 79, 7, 2);
    r('#e8f2f2', 92, 74, 6, 8); r('#d8e4e4', 93, 76, 4, 5);                 // 빈 유리컵 하나 (보리차를 기다린다)
    // 매미 (나무 줄기에 붙어 있다)
    r('#5a4030', 48, 44, 2, 3); r('#c8b890', 47, 45, 1, 1); r('#c8b890', 50, 45, 1, 1);
    // 천장 등 줄 (낮이라 꺼져 있다)
    r('#5a4030', 46, 0, 1, 6);
    // 핵심: 냉장고 맨 아래 칸의 유리 물병 (금 간 빨간 뚜껑, 노란 고무줄, 보리차, 땀방울)
    return () => {
      r('#e8f2f2', 141, 67, 9, 14); r('#c8dcdc', 142, 64, 7, 3);                               // 병 · 목
      r('#d06a5a', 142, 60, 7, 4); r('#e8c040', 142, 61, 7, 1); r('#e8c040', 144, 62, 4, 1);   // 뚜껑 + 고무줄
      r('#7a3a30', 145, 60, 1, 2);                                                              // 뚜껑의 금
      r('#b8742e', 142, 69, 7, 11); r('#d8964a', 143, 70, 2, 9);                                // 보리차
      r('#ffffff', 142, 65, 1, 3);
      for (const [x, y] of [[141, 70], [149, 68], [141, 76], [149, 74], [146, 79]]) r('#ffffff', x, y, 1, 1);   // 물방울
      r('#5a4030', 143, 79, 5, 1);                                                              // 바닥 매직 글씨
    };
  }

  /** 수경: 어린 수경의 새벽 부엌. 작은 냄비에 우유를 데우는 아빠의 뒷모습. 캐모마일 봉지와 작은 컵만 색이 남는다 */
  #memSukyung1(g, r) {
    const FLOOR = 94;
    // 불 꺼진 부엌: 벽과 바닥이 어둡고, 빛은 가스 불 쪽에서만 온다
    r('#8a7058', 0, 0, W, FLOOR);
    for (let y = 30; y < 62; y += 6) for (let x = (y / 6) % 2 ? 0 : 6; x < W; x += 12) r('#7a6250', x, y, 1, 6);   // 타일 벽
    for (let y = 30; y <= 62; y += 6) r('#7a6250', 0, y, W, 1);
    r('#7a6048', 0, FLOOR, W, H - FLOOR); r('#6a5240', 0, FLOOR, W, 1);
    for (let x = 8; x < W; x += 20) r('#6a5240', x, FLOOR + 1, 1, H - FLOOR);
    // 밤 창 (밖은 아직 깜깜하다)
    r('#5a4634', 118, 8, 34, 30);
    r('#1e2440', 121, 11, 28, 24); r('#262c4a', 121, 27, 28, 8);
    r('#5a4634', 134, 11, 2, 24); r('#5a4634', 116, 37, 38, 2);
    // 가스 불빛이 둘레를 데운다 (점묘)
    for (let y = 20; y < FLOOR + 10; y++) for (let x = 60; x < 150; x++) {
      const d = Math.hypot((x - 110) / 40, (y - 58) / 30);
      if (d < 1 && (1 - d) * 0.6 > BAYER[(y & 3) * 4 + (x & 3)]) r('#c8a47a', x, y, 1, 1);
    }
    // 싱크대·가스레인지 (가운데~오른쪽)
    r('#a89a82', 70, 62, 90, FLOOR - 62); r('#8a7e68', 70, 62, 90, 2);
    for (const x of [92, 124]) r('#8a7e68', x, 66, 1, FLOOR - 66);
    r('#6a6a72', 86, 58, 36, 4); r('#86868e', 86, 58, 36, 1);                // 레인지
    // 아빠 (뒷모습, 레인지 앞)
    g.drawImage(this.sprites.father, 82, FLOOR + 1 - FATHER.length);
    // 식탁 (왼쪽, 아이 키 높이에서 본다)
    r(C.table, 0, 76, 64, 5); r(C.tableHi, 0, 76, 64, 1);
    r('#7a5236', 6, 81, 3, FLOOR - 81); r('#7a5236', 54, 81, 3, FLOOR - 81);
    r('#e8dcc0', 10, 72, 14, 4); r('#c8b898', 10, 75, 14, 1);                // 접힌 행주
    r('#f2e8cc', 30, 64, 12, 12); r('#d8c8a0', 30, 64, 12, 2);               // 캐모마일 봉지
    r('#f4b8b0', 54, 69, 8, 7); r('#f4b8b0', 62, 71, 2, 1); r('#f4b8b0', 63, 72, 1, 2);   // 기다리는 작은 컵
    // 냉장고에 붙은 그림 (왼쪽 벽 끝)
    r('#7a7a80', 0, 14, 14, 62); r('#e8e6e0', 0, 16, 12, 58);
    r('#fbf4e2', 2, 26, 9, 8); r('#d06a5a', 5, 24, 2, 2);
    // 천장 등은 꺼져 있다 (줄만)
    r('#4a3828', 92, 0, 1, 10);
    // 핵심: 파란 가스 불 + 작은 냄비, 데운 우유 위에 하얀 캐모마일이 동동
    return () => {
      for (let x = 107; x < 119; x++) { r('#3a6ad8', x, 57 - ((x * 3) % 2), 1, 1); if (x % 2) r('#9ab8ff', x, 56, 1, 1); }   // 가스 불
      r('#9a948a', 105, 50, 15, 6); r('#7a746a', 105, 55, 15, 1); r('#b8b2a6', 105, 50, 15, 1);   // 냄비
      r('#7a746a', 120, 51, 7, 1); r('#5a544a', 126, 51, 1, 2);                                  // 손잡이
      r('#fbf4e4', 106, 49, 13, 2);                                                               // 데운 우유 (위에서 살짝 보이는 면)
      for (const x of [107, 111, 115]) { r('#ffffff', x, 48, 2, 1); r('#f2c230', x, 49, 1, 1); r('#ffffff', x + 1, 49, 1, 1); }   // 꽃
    };
  }

  /** 병원 천장 (떡밥 플래시용): 누워서 올려다본 흰 천장 타일과 형광등 한 줄 */
  #bakeCeiling() {
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    const r = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    r('#eceee9', 0, 0, W, H);
    for (let x = 4; x < W; x += 26) r('#d4d8d2', x, 0, 1, H);
    for (let y = 10; y < H; y += 26) r('#d4d8d2', 0, y, W, 1);
    for (let i = 0; i < 90; i++) r('#dde0da', (i * 53) % W, (i * 29) % H, 1, 1);   // 타일 구멍
    r('#b8bdb8', 22, 64, 116, 8);   // 형광등 틀
    r('#9ea39e', 22, 71, 116, 1);
    return c;
  }

  /** 캔버스 전체를 세피아 쪽으로 amount 만큼 당기고 밝기를 bright 배로 (구울 때 한 번) */
  #sepia(g, amount, bright = 1) {
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r0, g0, b0] = [d[i], d[i + 1], d[i + 2]];
      const sr = Math.min(255, r0 * 0.393 + g0 * 0.769 + b0 * 0.189);
      const sg = Math.min(255, r0 * 0.349 + g0 * 0.686 + b0 * 0.168);
      const sb = Math.min(255, r0 * 0.272 + g0 * 0.534 + b0 * 0.131);
      d[i] = (r0 + (sr - r0) * amount) * bright;
      d[i + 1] = (g0 + (sg - g0) * amount) * bright * 0.93;   // 초록·파랑을 조금 더 빼서 호박빛으로
      d[i + 2] = (b0 + (sb - b0) * amount) * bright * 0.8;
    }
    g.putImageData(img, 0, 0);
  }

  /** 지금 그려야 할 손님 얼굴 이름 (guestAsleep 이 켜져 있으면 잠든 얼굴) */
  face() {
    const s = this.state;
    if (s.guestAsleep) return s.guestFace === 'asleep-smile' ? 'asleep-smile' : 'asleep';
    return FACES.includes(s.guestFace) ? s.guestFace : 'normal';
  }

  /** 손님 표정 바꾸기. face: 'normal' | 'smile' | 'teary' | 'asleep' | 'asleep-smile' */
  setFace(face) {
    if (!FACES.includes(face)) throw new Error(`unknown face: ${face}`);
    this.state.guestFace = face;
    if (!face.startsWith('asleep')) this.state.guestAsleep = false;
  }

  /**
   * 아주 짧은 컷을 화면 전체에 겹친다. kind: 'ceiling' (병원 천장, 0.5초).
   * prefers-reduced-motion 이면 깜빡임 없이 흰빛이 한 번 부드럽게 오르내린다.
   */
  flash(kind) {
    if (kind !== 'ceiling') throw new Error(`unknown flash: ${kind}`);
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const ms = reduced ? 900 : 500;
    return new Promise((done) => {
      this.flashFx = { kind, start: performance.now(), ms, reduced };
      setTimeout(() => { this.flashFx = null; done(); }, ms);
    });
  }

  // ── 연출 ─────────────────────────────────────────────────────
  emit(kind, x, y, n = 1) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind, x: x + (Math.random() - 0.5) * 4, y, life: 0,
        max: kind === 'spark' ? 0.9 : kind === 'z' ? 2.6 : kind === 'heart' ? 1.6 : kind === 'dust' ? 0.4 : kind === 'rain' ? 0.9 : 2 + Math.random(),
        vx: kind === 'spark' ? (Math.random() - 0.5) * 50 : (Math.random() - 0.5) * 3,
        vy: kind === 'spark' ? -20 - Math.random() * 30 : kind === 'z' || kind === 'heart' ? -7 : kind === 'dust' ? -3 : kind === 'rain' ? 70 : -9 - Math.random() * 5,
        seed: Math.random() * 6,
      });
    }
  }

  /** 검은 막을 alpha 까지 ms 동안 */
  fadeTo(alpha, ms = 600) {
    const from = this.state.fade;
    const start = performance.now();
    return new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - start) / ms);
        this.state.fade = from + (alpha - from) * k;
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }

  /** 손님이 아래에서 스르륵 올라온다 */
  enterGuest(id) {
    this.state.guest = id;
    this.state.guestY = 20;
    return new Promise((done) => {
      const tick = () => {
        this.state.guestY = Math.max(0, this.state.guestY - 0.6);
        if (this.state.guestY > 0) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }

  // ── 매 프레임 ────────────────────────────────────────────────
  frame(dt) {
    this.t += dt;
    const g = this.g;
    const s = this.state;

    if (s.mode === 'terrace') {
      this.#drawTerrace(dt);
    } else if (s.mode === 'memory') {
      const id = this.memories[s.memory] ? s.memory : 'harin-1';
      const mem = (this.baked[id] ??= this.#bakeMemory(id));
      g.drawImage(mem.canvas, 0, 0);
      this.memories[id].fx(dt);
      // 천장 등 불빛: 찻집 램프처럼 베이어 점묘, 아주 느리게 숨 쉰다
      g.globalAlpha = 0.24 + Math.sin(this.t * 1.1) * 0.03;
      g.drawImage(mem.glow, 0, 0);
      g.globalAlpha = 1;
      g.save(); g.translate(0, TOP);
      this.#particles(dt);
      g.restore();
    } else {
      g.save(); g.translate(0, TOP);   // 여기부터 내용 좌표
      const reduced = isReduced();
      g.drawImage(s.weather === 'rain' ? this.roomRain : this.room, 0, -TOP);
      g.save();
      g.beginPath(); g.rect(WIN.x, WIN.y, WIN.w, WIN.h); g.clip();
      if (s.weather === 'rain') {
        this.#drawLights(this.cityRain.lights, WIN.x, WIN.y, dt, reduced);
      } else {
        this.#drawStars(this.city.stars, WIN.x, WIN.y, reduced);
        this.#drawLights(this.city.lights, WIN.x, WIN.y, dt, reduced);
        this.#drawMotes(this.winMotes, WIN, dt, reduced, 0.55);
      }
      g.restore();
      if (s.weather === 'rain') this.#rain(dt);
      else g.drawImage(this.windowFront, 0, 0);
      this.#clockHands(s.clock);
      // 손님
      const face = this.face();
      const asleep = face.startsWith('asleep');
      if (s.guest) {
        const bob = asleep ? Math.round(Math.sin(this.t * 1.2)) : Math.round(Math.sin(this.t * 2) * 0.6);
        const frames = (this.faces[s.guest] ?? this.faces.harin)[face];
        let alt = false;
        if (face === 'normal') alt = this.t % 4.3 < 0.13;          // 가끔 깜빡
        if (face === 'teary') alt = this.t % 1.6 < 0.35;           // 눈물이 반짝
        const spr = frames[alt && frames[1] ? 1 : 0];
        g.save();
        g.beginPath(); g.rect(0, 0, W, 92); g.clip();   // 카운터 뒤로 가려진다
        g.drawImage(spr, 72, 73 + bob + Math.round(s.guestY) + (face === 'asleep' ? 2 : 0));
        g.restore();
      }
      this.#shelf();
      if (!s.catOut) this.#cat(dt);
      // 램프
      g.fillStyle = C.lampCord; g.fillRect(80, 0, 1, 18);   // (천장 띠 속 줄은 구워 둠)
      g.fillStyle = C.lampShade; g.fillRect(73, 18, 15, 5); g.fillRect(71, 23, 19, 2);
      g.fillStyle = C.lampHi; g.fillRect(74, 18, 13, 1);
      g.fillStyle = C.bulb; g.fillRect(78, 25, 5, 2);
      // 찻잔
      if (s.cup) {
        g.fillStyle = C.cupShade; g.fillRect(95, 86, 12, 6);
        g.fillStyle = C.cupRim; g.fillRect(95, 85, 12, 6);
        g.fillStyle = s.cup; g.fillRect(96, 85, 10, 2);
        g.fillStyle = C.cupRim; g.fillRect(107, 86, 2, 1); g.fillRect(108, 87, 1, 2); g.fillRect(107, 89, 2, 1);
        g.fillStyle = C.cupShade; g.fillRect(93, 91, 16, 1);
        if (Math.random() < dt * 5) this.emit('steam', 101, 82);
      }
      if (Math.random() < dt * 2) this.emit('steam', 15, 78);
      if (s.guest && asleep && Math.random() < dt * 0.8) this.emit('z', 88, 70);
      this.#drawMotes(this.roomMotes, { x: 56, y: 22, w: 44, h: 52 }, dt, reduced, 0.4);   // 램프 빛 속 먼지
      this.#particles(dt);
      g.restore();                     // 내용 좌표 끝
      // 조명 (깜빡임은 아주 약하게) — 천장까지 비추도록 화면 좌표로
      g.globalAlpha = 0.19 + Math.sin(this.t * 7) * 0.008 + Math.sin(this.t * 2.3) * 0.01;
      g.drawImage(this.glow, 0, 0);
      g.globalAlpha = 1;
    }

    if (s.fade > 0) {
      g.globalAlpha = s.fade; g.fillStyle = '#0b0910'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    }
    if (this.flashFx) this.#drawFlash();
  }

  /**
   * 고양이에게 동작을 시킨다. name: blink | ear | tail | look | groom | stretch | loaf | purr | sneeze | paw
   * 하던 동작은 끊고 바로 시작한다. 끝나면(또는 다른 동작에 끊기면) resolve.
   */
  catDo(name) {
    const steps = CAT_ACTS[name];
    if (!steps) throw new Error(`unknown cat action: ${name}`);
    this.cat.done?.();
    return new Promise((done) => {
      Object.assign(this.cat, { steps, name, i: 0, tt: 0, done });
      this.#catFx();
    });
  }

  /** 화면 좌표 (x, y: 160×144) 가 고양이 위면 골골(purr) 시키고 true. 손가락이라 2칸 넉넉하게 */
  hitCat(x, y0) {
    if (this.state.mode !== 'shop' || this.state.catOut) return false;
    const y = y0 - TOP;   // 내용 좌표로
    const [rows, fx] = CAT_FRAMES[this.#catFrame()[0]];
    const w = rows[0].length, h = rows.length;
    const hit = x >= fx - 2 && x <= fx + w + 6 && y >= 92 - h - 2 && y <= 93;
    if (hit) { this.catDo('purr'); this.emit('heart', fx + 3, 92 - h - 1); }
    return hit;
  }

  /** 동작 한 칸이 시작될 때의 작은 효과 */
  #catFx() {
    const fx = this.cat.steps?.[this.cat.i]?.[3];
    if (fx === 'achoo') this.emit('dust', CAT_X - 3, 89, 6);
    if (fx === 'tap') this.emit('dust', CAT_X - 1, 91, 2);
  }

  /** 지금 프레임 이름과 꼬리 방식 */
  #catFrame() {
    const c = this.cat;
    if (!c.steps) return ['lie', 'sway'];
    const [frame, , tail = 'sway'] = c.steps[c.i];
    return [frame, tail];
  }

  #cat(dt) {
    const g = this.g;
    const c = this.cat;
    // 동작 진행 / 가만히 있으면 가끔 아무 동작이나
    if (c.steps) {
      c.tt += dt;
      while (c.steps && c.tt >= c.steps[c.i][1]) {
        c.tt -= c.steps[c.i][1];
        if (++c.i >= c.steps.length) {
          const done = c.done;
          Object.assign(c, { steps: null, done: null, wait: 2.5 + Math.random() * 5 });
          done?.();
        } else this.#catFx();
      }
    } else if ((c.wait -= dt) <= 0) {
      let r = Math.random() * CAT_IDLE.reduce((a, [, w]) => a + w, 0);
      const pick = CAT_IDLE.find(([, w]) => (r -= w) < 0)?.[0] ?? 'blink';
      this.catDo(pick);
    }
    const [name, tailMode] = this.#catFrame();
    const [rows, fx, root] = CAT_FRAMES[name];
    const fy = 92 - rows.length;
    if (c.name === 'purr' && c.steps && Math.random() < dt * 1.6) this.emit('heart', fx + 2 + Math.random() * 6, fy - 1);
    // 꼬리
    if (root) {
      const ax = fx + root[0], ay = fy + root[1];
      g.fillStyle = PALETTE.O;
      if (tailMode === 'up') {
        const w = Math.round(Math.sin(this.t * 3) * 0.6);
        g.fillRect(ax, ay - 2, 2, 2); g.fillRect(ax + w, ay - 4, 2, 2); g.fillRect(ax + 1 + w, ay - 6, 2, 2);
      } else {
        let w;
        if (tailMode === 'thump') {
          // 천천히 들었다가 탁! (0.5초마다)
          const k = (c.tt % 0.5) / 0.5;
          w = k < 0.8 ? Math.round(k / 0.8 * 3) : -1;
        } else {
          w = Math.round(Math.sin(this.t * (tailMode === 'slow' ? 0.7 : 1.3)) * 1.5);
        }
        g.fillRect(ax, ay - w, 2, 2); g.fillRect(ax + 2, ay - 2 - w * 2, 2, 2);
        if (tailMode === 'thump' && w < 0 && Math.random() < 0.3) this.emit('dust', ax + 3, 91);
      }
    }
    g.drawImage(this.catImg[name], fx, fy);
  }

  /**
   * 남은 불빛 중 하나(state.lights - 1 번)가 깜빡이다 꺼진다. 끝나면 state.lights 가 하나 줄고 resolve.
   * 꺼진 창에서 작은 빛 한 올이 위로 올라간다. reduced-motion 이면 깜빡임 없이 천천히 사그라든다.
   * 'terrace' 에서 쓰라고 만들었지만 찻집 창에서도 똑같이 보인다.
   */
  dimLight() {
    const n = Math.max(0, Math.min(LIGHTS_MAX, Math.round(this.state.lights)));
    if (n === 0) return Promise.resolve();
    this.dimFx?.done();
    const reduced = isReduced();
    return new Promise((done) => {
      this.dimFx = { i: n - 1, k: 0, sec: reduced ? 1.6 : 2.6, reduced, done, wisp: false };
    });
  }

  /** 꺼지는 중인 불빛의 밝기 (0~1). 앞 절반은 그대로, 뒤로 갈수록 자주 깜빡이다 사그라든다 */
  #dimLevel(f) {
    if (f.reduced) return Math.max(0, 1 - f.k);
    if (f.k < 0.35) return 1;
    const k = (f.k - 0.35) / 0.65;
    const blink = Math.sin(k * k * 46) > 0.15 - k * 0.6 ? 1 : 0.25;   // 탁, 탁… 하고 끊긴다
    return Math.max(0, (1 - k * k) * blink);
  }

  /** 잠 못 드는 창들. 켜진 창은 따뜻한 빛이 1px 번지고 아주 느리게 숨 쉰다. 꺼진 창은 어두운 자국 */
  #drawLights(lights, ox, oy, dt, reduced) {
    const g = this.g;
    const n = Math.max(0, Math.min(LIGHTS_MAX, Math.round(this.state.lights)));
    const f = this.dimFx;
    if (f) f.k += dt / f.sec;
    lights.forEach(([lx, ly], i) => {
      const x = ox + lx, y = oy + ly;
      g.fillStyle = '#2e2742'; g.fillRect(x, y, 2, 2);                       // 꺼진 창 자국
      if (i >= n) return;
      let a = 1;
      if (f && f.i === i) {
        a = this.#dimLevel(f);
        if (!f.wisp && f.k > 0.85) { f.wisp = true; this.particles.push({ kind: 'wisp', x: x + 0.5, y: y - 1, life: 0, max: 2.8, vx: 0, vy: -5, seed: Math.random() * 6 }); }
      }
      const breath = reduced ? 1 : 0.8 + 0.2 * Math.sin(this.t * 0.9 + i * 1.7);
      g.fillStyle = '#ffb860';
      g.globalAlpha = 0.32 * a * breath;
      for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [1, -1], [0, 2], [1, 2]]) g.fillRect(x + dx, y + dy, 1, 1);
      g.globalAlpha = 0.14 * a * breath;
      for (const [dx, dy] of [[-2, 0], [3, 0], [-1, -1], [2, -1], [-1, 2], [2, 2], [0, -2], [1, 3]]) g.fillRect(x + dx, y + dy, 1, 1);
      g.globalAlpha = a;
      g.fillStyle = '#ffe6a8'; g.fillRect(x, y, 2, 1);
      g.fillStyle = '#ffc070'; g.fillRect(x, y + 1, 2, 1);
      g.globalAlpha = 1;
    });
    if (f && f.k >= 1) {
      this.state.lights = Math.min(this.state.lights, f.i);
      this.dimFx = null;
      f.done();
    }
  }

  /** 별: 아주 천천히 밝아졌다 흐려진다 (세 단계) */
  #drawStars(stars, ox, oy, reduced) {
    const g = this.g;
    for (const [x, y, p] of stars) {
      const v = reduced ? 0.4 : Math.sin(this.t * 0.7 + p);
      g.fillStyle = v > 0.6 ? '#fff6d8' : v > -0.2 ? '#9a96c8' : '#4a4878';
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  }

  /** 빛가루: 천천히 오르며 흔들리고, 숨 쉬듯 밝아졌다 사라진다 */
  #drawMotes(motes, rect, dt, reduced, alpha) {
    const g = this.g;
    for (const m of motes) {
      if (!reduced) {
        m.y -= m.v * dt;
        m.x += Math.sin(this.t * 0.6 + m.p) * 3 * dt;
        if (m.y < rect.y) { m.y = rect.y + rect.h; m.x = rect.x + Math.random() * rect.w; }
      }
      const tw = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.t * 1.1 + m.p * 3);
      g.globalAlpha = alpha * tw;
      g.fillStyle = m.c;
      g.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
      if (tw > 0.85) { g.globalAlpha = alpha * 0.3; g.fillRect(Math.round(m.x) - 1, Math.round(m.y), 3, 1); g.fillRect(Math.round(m.x), Math.round(m.y) - 1, 1, 3); }
    }
    g.globalAlpha = 1;
  }

  // ── 밤 끝 테라스 (화면 좌표 160×144 전체) ─────────────────────
  #bakeTerrace() {
    const RAIL = 108;
    const city = bakeCity(W, H, {
      horizon: 0.36, hill: 0.82, moon: [0.78, 0.14], seed: 4,
      avoid: (x, y) => y > RAIL - 6 || (x > 100 && x < 136 && y > RAIL - 22) || x < 14,   // 난간·고양이·문 뒤는 피한다
    });
    // 아주 느리게 흐르는 구름 (가로로 두 배 길게 굽고 감아 돌린다)
    const clouds = new OffscreenCanvas(W * 2, H);
    const gc = clouds.getContext('2d');
    gc.fillStyle = '#7a68b0';
    for (const [cx, cy, rx, ry] of [[40, 30, 34, 4], [120, 22, 26, 3], [200, 36, 40, 5], [280, 26, 30, 3], [300, 44, 22, 3]]) {
      for (let y = cy - ry - 2; y <= cy + ry + 2; y++) for (let x = cx - rx - 4; x <= cx + rx + 4; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        const lv = Math.max(0, 1 - d) * 0.9;
        const xx = ((x % (W * 2)) + W * 2) % (W * 2);
        if (lv > BAYER[(y & 3) * 4 + (xx & 3)]) gc.fillRect(xx, y, 1, 1);
      }
    }
    // 앞: 처마 · 등불 · 문틈 빛 · 난간 · 마루
    const front = new OffscreenCanvas(W, H);
    const g = front.getContext('2d');
    const r = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    r('#241a20', 0, 0, 56, 7); for (let x = 0; x < 56; x += 8) r('#2c2026', x, 0, 4, 5);
    r('#5a3d2e', 0, 7, 60, 3); r('#7a5440', 0, 7, 60, 1); r('#3e2a20', 58, 7, 2, 3);
    r('#3e2a20', 30, 10, 1, 8);                                                  // 등불 줄
    r('#7a5440', 26, 18, 9, 2); r('#ffd98a', 27, 20, 7, 7); r('#f0a860', 27, 25, 7, 2); r('#fff2c4', 29, 21, 3, 3);
    r('#7a5440', 26, 27, 9, 1); r('#7a5440', 30, 28, 1, 2);
    r('#3b2a30', 0, 10, 8, RAIL + 16 - 10); r('#6b4a3a', 7, 10, 2, RAIL + 16 - 10);   // 문설주
    for (let y = 26; y < RAIL + 16; y++) { g.globalAlpha = 0.55; r('#ffcf7a', 9, y, y % 3 ? 2 : 1, 1); }  // 문틈 빛
    g.globalAlpha = 1;
    r('#4a3428', 0, RAIL + 16, W, H - RAIL - 16);
    for (let y = RAIL + 18; y < H; y += 5) r('#3e2c22', 0, y, W, 1);
    g.globalAlpha = 0.35; r('#ffcf7a', 9, RAIL + 16, 40, 1); r('#ffcf7a', 9, RAIL + 21, 26, 1); g.globalAlpha = 1;   // 마루에 비친 문빛
    r('#5a3d2e', 0, RAIL, W, 4); r('#8d6650', 0, RAIL, W, 1);
    for (let x = 12; x < W; x += 12) { r('#4a3428', x, RAIL + 4, 3, 12); r('#6b4a3a', x, RAIL + 4, 1, 12); }
    r('#3e2a20', 0, RAIL + 14, W, 2);
    // 난간 위 찻잔
    r('#cfc6ba', 64, RAIL - 3, 7, 3); r('#f4efe6', 64, RAIL - 4, 7, 3); r('#c8803a', 65, RAIL - 4, 5, 1); r('#f4efe6', 71, RAIL - 3, 1, 2);
    const cat = bake(CAT_SIT);
    return {
      city, clouds, front, cat, rail: RAIL,
      lantern: this.#bakeGlow(30, 23, 34, C.glow),
      motes: makeMotes(16, { x: 0, y: 14, w: W, h: RAIL - 14 }, ['#e8dcff', '#ffe2a0', '#c8d8ff', '#ffd0e8'], 21),
    };
  }

  #drawTerrace(dt) {
    const g = this.g;
    const T = (this.terrace ??= this.#bakeTerrace());
    const reduced = isReduced();
    g.drawImage(T.city.sky, 0, 0);
    this.#drawStars(T.city.stars, 0, 0, reduced);
    const off = reduced ? 0 : Math.floor((this.t * 1.2) % (W * 2));                // 구름: 1.2px/초
    g.globalAlpha = 0.28;
    g.drawImage(T.clouds, -off, 0); g.drawImage(T.clouds, W * 2 - off, 0);
    g.globalAlpha = 1;
    g.drawImage(T.city.land, 0, 0);
    this.#drawLights(T.city.lights, 0, 0, dt, reduced);
    this.#drawMotes(T.motes, { x: 0, y: 14, w: W, h: T.rail - 14 }, dt, reduced, 0.6);
    g.drawImage(T.front, 0, 0);
    // 등불: 아주 느리게 숨 쉬는 점묘 빛
    g.globalAlpha = 0.2 + (reduced ? 0 : Math.sin(this.t * 1.3) * 0.025 + Math.sin(this.t * 4.1) * 0.01);
    g.drawImage(T.lantern, 0, 0);
    g.globalAlpha = 1;
    // 난간 위에서 도시를 내려다보는 고양이 (오른쪽을 본다)
    if (!this.state.catOut) {
      g.save(); g.translate(108 + T.cat.width, T.rail - T.cat.height + 1); g.scale(-1, 1); g.drawImage(T.cat, 0, 0); g.restore();
    }
    if (Math.random() < dt * 3) this.emit('steam', 67, T.rail - 6);
    this.#particles(dt);
  }

  /** 벽시계 바늘. minutes = 자정부터 분 (120 = 2:00) */
  #clockHands(minutes = 120) {
    const g = this.g;
    const m = Number.isFinite(minutes) ? minutes : 120;
    const hand = (turns, len) => {
      const a = turns * Math.PI * 2 - Math.PI / 2;
      for (let i = 1; i <= len; i++) g.fillRect(Math.round(CLOCK[0] + Math.cos(a) * i), Math.round(CLOCK[1] + Math.sin(a) * i), 1, 1);
    };
    g.fillStyle = '#3a2a24';
    hand(((m / 60) % 12) / 12, 3);
    g.fillStyle = '#2a1e24';
    hand((m % 60) / 60, 5);
    g.fillRect(CLOCK[0], CLOCK[1], 1, 1);
  }

  #newDrop(anywhere = false) {
    return { x: WIN.x + 1 + Math.floor(Math.random() * (WIN.w - 2)), y: anywhere ? WIN.y + 1 + Math.random() * (WIN.h - 6) : WIN.y, v: 0, stick: Math.random() * 3, glint: 0 };
  }

  /** 비 오는 밤: 창밖 빗줄기 → 유리에 맺혀 흐르는 물방울 → 창살·화분 */
  #rain(dt) {
    const g = this.g;
    g.save();
    g.beginPath(); g.rect(WIN.x, WIN.y, WIN.w, WIN.h); g.clip();
    g.fillStyle = '#4a5a88';
    for (const d of this.rain) {
      d.y += d.v * dt; d.x -= d.v * dt * 0.2;
      if (d.y > WIN.y + WIN.h + 1) { d.y = WIN.y - 3; d.x = WIN.x + Math.random() * (WIN.w + 10); }
      const x = Math.round(d.x), y = Math.round(d.y);
      g.fillRect(x, y, 1, 2); g.fillRect(x + 1, y - 2, 1, 2);
    }
    for (const d of this.drops) {
      if (d.stick > 0) d.stick -= dt;
      else d.v = Math.min(14, d.v + dt * 10);
      d.y += d.v * dt;
      if (d.v > 0 && Math.random() < dt * 0.8) { d.v = 0; d.stick = 0.5 + Math.random() * 1.5; }   // 멈칫
      if (d.y > WIN.y + WIN.h) Object.assign(d, this.#newDrop());
      if (d.glint <= 0 && Math.random() < dt * 0.25) d.glint = 0.3;
      d.glint -= dt;
      const x = d.x, y = Math.round(d.y);
      g.fillStyle = '#26304e'; g.fillRect(x, y - 3, 1, 3);                 // 흘러내린 자국
      g.fillStyle = d.glint > 0 ? '#ffffff' : '#8a9cc8'; g.fillRect(x, y, 1, 1);
      if (d.glint > 0.15) { g.fillStyle = '#c8d6ff'; g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); }
    }
    g.restore();
    g.drawImage(this.windowFront, 0, 0);
  }

  #drawFlash() {
    const g = this.g;
    const f = this.flashFx;
    const k = Math.min(1, (performance.now() - f.start) / f.ms);
    if (f.reduced) {
      // 부드럽게 한 번: 0 → 1 → 0
      g.globalAlpha = Math.sin(Math.PI * k) * 0.85;
      g.drawImage(this.ceiling, 0, 0);
      g.fillStyle = '#e8f0ff'; g.fillRect(22, 65, 116, 5);
      g.globalAlpha = 1;
      return;
    }
    g.drawImage(this.ceiling, 0, 0);
    // 형광등: 켜짐-꺼짐-켜짐 (지직)
    const on = k < 0.22 || (k > 0.34 && k < 0.42) || k > 0.5;
    g.fillStyle = on ? '#f8fbff' : '#c8ccc8'; g.fillRect(22, 65, 116, 5);
    if (on) { g.fillStyle = '#ffffff'; g.fillRect(24, 66, 112, 2); }
    // 처음 한 순간은 화면 전체가 하얗다
    if (k < 0.12) { g.globalAlpha = 1 - k / 0.12; g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  }

  /** 선반 위 꿈 조각: 아이콘 + 뒤에서 은은한 점묘 빛 (shelfGlow 로 세기 조절) */
  #shelf() {
    const g = this.g;
    const s = this.state;
    (s.shelf ?? []).slice(0, 4).forEach((id, i) => {
      const icon = this.items[itemIcon(id)];
      const x = 104 + i * 12 + Math.floor((10 - icon.width) / 2);
      const y = 80 - icon.height;
      const glow = Math.max(0, Math.min(1, s.shelfGlow?.[id] ?? SHELF_GLOW));
      if (glow > 0) {
        const cx = x + icon.width / 2, cy = y + icon.height / 2;
        const R = 4 + glow * 6;
        const pulse = 0.85 + Math.sin(this.t * 1.4 + i * 1.9) * 0.15;
        g.fillStyle = '#ffe3a0';
        for (let py = Math.floor(cy - R); py <= cy + R; py++) {
          for (let px = Math.floor(cx - R); px <= cx + R; px++) {
            if (py >= 80) continue;   // 선반 아래로는 새지 않게
            const level = glow * pulse * 0.85 * (1 - Math.hypot(px - cx, (py - cy) * 1.2) / R);
            if (level > BAYER[(py & 3) * 4 + (px & 3)]) g.fillRect(px, py, 1, 1);
          }
        }
        if (glow >= 0.8 && Math.random() < 0.02) this.emit('spark', cx, y, 1);
      }
      g.drawImage(icon, x, y);
    });
  }

  #particles(dt) {
    const g = this.g;
    this.particles = this.particles.filter((p) => (p.life += dt) < p.max);
    for (const p of this.particles) {
      if (p.kind === 'snow') { p.vy = 8; p.vx = Math.sin(this.t + p.seed) * 3; }
      if (p.kind === 'spark') p.vy += 40 * dt;
      p.x += (p.vx + (p.kind === 'steam' ? Math.sin(this.t * 2 + p.seed) * 3 : 0)) * dt;
      p.y += p.vy * dt;
      const k = 1 - p.life / p.max;
      if (p.kind === 'snow' && p.y > 42) continue;
      if (p.kind === 'wisp') {                     // 꺼진 창에서 오르는 빛 한 올 (잠든 사람)
        p.x += Math.sin(this.t * 2 + p.seed) * 4 * dt;
        g.globalAlpha = k * 0.8; g.fillStyle = '#ffe6a8';
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        g.globalAlpha = k * 0.3; g.fillRect(Math.round(p.x), Math.round(p.y) + 1, 1, 2);
        continue;
      }
      if (p.kind === 'rain') {                     // 창밖 빗줄기 (창 안쪽에서만)
        if (p.y > 58 || (p.x > 78 && p.x < 82)) continue;
        g.globalAlpha = 0.55; g.fillStyle = '#cfd8ea';
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 2);
        continue;
      }
      g.globalAlpha = p.kind === 'steam' ? k * 0.55 : k;
      g.fillStyle = p.kind === 'z' ? C.z : p.kind === 'spark' ? C.spark : p.kind === 'snow' ? C.snow : C.steam;
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.kind === 'z') {       // 3×3 픽셀 'z'
        g.fillRect(x, y, 3, 1); g.fillRect(x + 1, y + 1, 1, 1); g.fillRect(x, y + 2, 3, 1);
      } else if (p.kind === 'heart') {   // 3×3 하트
        g.fillStyle = '#f08a9a';
        g.fillRect(x, y, 1, 1); g.fillRect(x + 2, y, 1, 1); g.fillRect(x, y + 1, 3, 1); g.fillRect(x + 1, y + 2, 1, 1);
      } else {
        g.fillRect(x, y, 1, 1);
      }
    }
    g.globalAlpha = 1;
  }
}
