// 제4의 벽을 넘는 고양이.
// 평소엔 픽셀 찻집 안에 있다가, 대본이 부르면(사장 손에 머리를 비빈다 등) 틀 밖으로 뛰어나와
// 대화창 위에서 재롱을 떨고 돌아간다. 틀 밖에서도 찻집 그림과 같은 픽셀 배율의 픽셀 스프라이트다.
//
//   await ui.cat.visit({ act: 'paw', stay: 4000 })   // 나왔다가 돌아올 때까지
//   ui.cat.out('sit'); …; ui.cat.home()              // 대본이 직접 붙잡아 둘 때
//
// 장면 안 고양이는 scene.state.catOut = true 동안 그리지 않는다 (scene.js).
import * as S from './sprites.js';
import { CAT_HOME } from './scene.js';

const pick = (...names) => names.map((n) => S[n]).find(Boolean);

// 동작 → 번갈아 쓸 프레임 (art 가 그린 틀 밖 전용 프레임이 있으면 그것, 없으면 장면 고양이 프레임으로 대신)
const ACTS = {
  sit: [[pick('CAT_SIT', 'CAT_LOAF'), 2200], [pick('CAT_SIT_BLINK', 'CAT_BLINK'), 160]],
  paw: [[pick('CAT_PAWTEXT1', 'CAT_PAW_UP'), 260], [pick('CAT_PAWTEXT2', 'CAT_PAW_DOWN'), 260]],
  roll: [[pick('CAT_ROLL1', 'CAT_STRETCH'), 420], [pick('CAT_ROLL2', 'CAT'), 420]],
  yawn: [[pick('CAT_YAWN', 'CAT_LOOK'), 900], [pick('CAT_SIT', 'CAT_LOAF'), 1600]],
  walk: [[pick('CAT_WALK1', 'CAT'), 140], [pick('CAT_WALK2', 'CAT_EAR'), 140], [pick('CAT_WALK3', 'CAT'), 140], [pick('CAT_WALK4', 'CAT_EAR'), 140]],
  purr: [[S.CAT_PURR, 400]],
};
let JUMP = pick('CAT_JUMP', 'CAT_STRETCH');
let LAND = pick('CAT_LAND', 'CAT_LOAF');

// 틀 밖은 고해상도 (사용자: "픽셀 안에선 저해상도, 밖이면 고해상도 — 그 전환도 재밌을 듯").
// art 의 S.ROAM = { res, walk, sit, … } 이 있으면 그 프레임을 res 배 섬세하게 쓴다. 없으면 장면 프레임(res 1).
const ROAM = S.ROAM;
const RES = ROAM?.res ?? 1;
if (ROAM) {
  const seq = (frames, ms) => frames.map((f) => [f, ms]);
  Object.assign(ACTS, {
    sit: [[ROAM.sit, 2200], [ROAM.sitBlink ?? ROAM.sit, 160]],
    paw: seq(ROAM.paw, 260),
    roll: seq(ROAM.roll, 420),
    yawn: [[ROAM.yawn, 900], [ROAM.sit, 1600]],
    walk: seq(ROAM.walk, 140),
    purr: [[ROAM.purr ?? ROAM.sit, 400]],
  });
  JUMP = ROAM.jump; LAND = ROAM.land;
}
const PURR = ROAM?.purr ?? S.CAT_PURR;
// 틀을 넘는 순간의 픽셀 전환: 블록 크기(고해상도 픽셀 단위) 변화 — 장면 픽셀 → 와르르 굵어졌다 → 섬세하게
const MORPH_MS = 320;
const PEAK = Math.max(3, RES * 2.5);
const HOME = CAT_HOME ?? { x: 126, y: 92, w: 14, h: 7, facing: 'left' };

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class RoamingCat {
  constructor({ scene, audio }) {
    this.scene = scene;
    this.audio = audio;
    this.app = document.querySelector('#app');
    this.sceneCanvas = document.querySelector('#scene');
    this.el = document.createElement('canvas');
    this.el.className = 'roam-cat';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this.app.append(this.el);
    this.g = this.el.getContext('2d');
    this.baked = new Map();
    this.state = 'home';      // home | jumping | out
    this.act = 'sit';
    this.flip = false;
    this.pos = { x: 0, y: 0 };   // 발 바닥 가운데, #app 기준 px
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.el.addEventListener('click', (e) => { e.stopPropagation(); this.#pet(); });
    this.inFrame = true;          // 지금 찻집 틀 안에 있나 (픽셀 해상도를 정한다)
    this.morphAt = -1e9;          // 마지막으로 틀을 넘은 시각
    this.tmp = document.createElement('canvas');
    this.#loop();
  }

  /** 나와서 act 를 하다가 stay 뒤 돌아간다. 돌아오면 resolve */
  async visit({ act = 'paw', stay = 4000 } = {}) {
    await this.out(act);
    await wait(stay);
    await this.home();
  }

  /** 틀 밖으로 (이미 나와 있으면 동작만 바꾼다) */
  async out(act = 'sit') {
    this.act = ACTS[act] ? act : 'sit';
    if (this.state !== 'home') return;
    const from = this.#homePos();
    const to = this.#spot();
    this.flip = to.x < from.x;
    this.scene.state.catOut = true;
    this.pos = { ...from };       // 제자리(틀 안)에서 출발 — 첫 프레임에 엉뚱한 전환이 일어나지 않게
    this.inFrame = true;
    this.morphAt = -1e9;
    this.el.hidden = false;
    const token = (this.token = (this.token ?? 0) + 1);
    await this.#jump(from, to);
    if (token !== this.token) return;   // 점프 중에 제자리로 불려 갔다 (home instant) — 덮어쓰지 않는다
    this.state = 'out';
  }

  /** 찻집 안 제자리로 */
  async home({ instant = false } = {}) {
    if (this.state === 'home') return;
    if (instant || this.el.hidden) { this.#settle(); return; }
    this.state = 'jumping';
    const to = this.#homePos();
    this.flip = to.x < this.pos.x;
    await this.#jump({ ...this.pos }, to);
    this.#settle();
  }

  #settle() {
    this.token = (this.token ?? 0) + 1;
    this.state = 'home';
    this.el.hidden = true;
    this.scene.state.catOut = false;
  }

  // ── 위치 ──
  #scale() { return this.sceneCanvas.getBoundingClientRect().width / this.sceneCanvas.width; }

  #homePos() {
    const a = this.app.getBoundingClientRect();
    const r = this.sceneCanvas.getBoundingClientRect();
    const k = r.width / this.sceneCanvas.width;
    return { x: r.left - a.left + (HOME.x + HOME.w / 2) * k, y: r.top - a.top + HOME.y * k };
  }

  /** 대화창(또는 열려 있는 판)의 윗변 위, 이름표를 피해 가운데쯤 */
  #spot(x) {
    const a = this.app.getBoundingClientRect();
    const box = [...document.querySelectorAll('#dialog, #blend, #title, #between, #ending')]
      .find((el) => !el.hidden)?.getBoundingClientRect();
    const y = box ? box.top - a.top + 3 : a.height * 0.7;
    return { x: x ?? a.width * (0.56 + Math.random() * 0.14), y };   // 왼쪽 일러스트와 오른쪽 이름표 사이
  }

  async #jump(from, to) {
    this.state = 'jumping';
    if (this.reduced) { this.pos = { ...to }; return; }
    const dur = 620;
    const lift = Math.max(40, Math.abs(to.y - from.y) * 0.35);
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = ease(t);
        this.pos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * lift };
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    this.landedAt = performance.now();
  }

  /** 틀을 넘는 순간 반짝이 몇 개 */
  #sparkle() {
    if (this.reduced) return;
    for (let i = 0; i < 6; i++) {
      const sp = document.createElement('span');
      sp.className = 'roam-spark';
      sp.textContent = '✦';
      sp.style.setProperty('--x', `${Math.round(this.pos.x + (Math.random() - 0.5) * 40)}px`);
      sp.style.setProperty('--y', `${Math.round(this.pos.y - 10 - Math.random() * 20)}px`);
      sp.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 50)}px`);
      this.app.append(sp);
      setTimeout(() => sp.remove(), 700);
    }
  }

  #pet() {
    this.audio.sfx('purr');
    this.petUntil = performance.now() + 1200;
    const h = document.createElement('span');
    h.className = 'roam-heart';
    h.textContent = '♥';
    h.style.setProperty('--x', `${Math.round(this.pos.x)}px`);
    h.style.setProperty('--y', `${Math.round(this.pos.y - 30)}px`);
    this.app.append(h);
    setTimeout(() => h.remove(), 1200);
  }

  // ── 그리기 ──
  #frame(now) {
    if (this.state === 'jumping') return now - (this.landedAt ?? 0) < 0 ? LAND : JUMP;
    if (this.landedAt && now - this.landedAt < 160) return LAND;
    if (this.petUntil && now < this.petUntil) return PURR;
    const seq = ACTS[this.act];
    const total = seq.reduce((s, [, ms]) => s + ms, 0);
    let t = now % total;
    for (const [rows, ms] of seq) { if (t < ms) return rows; t -= ms; }
    return seq[0][0];
  }

  #bake(rows) {
    if (!this.baked.has(rows)) this.baked.set(rows, S.bake(rows));
    return this.baked.get(rows);
  }

  #loop() {
    const tick = (now) => {
      requestAnimationFrame(tick);
      if (this.el.hidden) return;
      // 나와 있는 동안 대화창이 움직이면(선택지·판 전환) 따라간다
      if (this.state === 'out') {
        const target = this.#spot(this.pos.x).y;
        this.pos.y += (target - this.pos.y) * 0.25;
        if (this.act === 'walk') {
          const a = this.app.getBoundingClientRect();
          this.pos.x += (this.flip ? -1 : 1) * 0.6 * this.#scale();
          if (this.pos.x > a.width * 0.74) this.flip = true;
          if (this.pos.x < a.width * 0.52) this.flip = false;
        }
      }
      const rows = this.#frame(now);
      const img = this.#bake(rows);
      const k = Math.max(1, Math.round(this.#scale() * 2) / 2);   // 장면 픽셀 하나의 화면 크기
      const w = img.width, h = img.height;
      // 틀 밖에서도 픽셀아트 (사용자): 픽셀 하나를 정수 화면 px 로, 한눈에 픽셀로 보일 만큼 크게.
      // 해상도(더 많은 픽셀 = 더 섬세함)만 올라가고, 픽셀 크기는 장면 픽셀의 약 0.8 배.
      const px = RES > 1 ? Math.max(2, Math.round(k * 0.8)) : k;

      // 틀 안/밖 판정 (발 위치가 찻집 그림 안이면 '안')
      const a = this.app.getBoundingClientRect();
      const st = this.sceneCanvas.getBoundingClientRect();
      const inside = this.pos.y <= st.bottom - a.top && this.pos.x >= st.left - a.left && this.pos.x <= st.right - a.left;
      if (inside !== this.inFrame) {
        this.inFrame = inside;
        this.morphAt = now;
        this.#sparkle();
      }
      // 블록 크기: 안 = RES(장면 픽셀), 밖 = 1(섬세). 넘는 순간엔 PEAK 까지 와르르 굵어졌다가 목표로
      const target = this.inFrame ? RES : 1;
      const t = (now - this.morphAt) / MORPH_MS;
      let b = target;
      if (t < 1 && !this.reduced) b = t < 0.35 ? RES + (PEAK - RES) * (t / 0.35) : PEAK + (target - PEAK) * ((t - 0.35) / 0.65);
      b = Math.max(1, b);

      if (this.el.width !== w || this.el.height !== h) { this.el.width = w; this.el.height = h; }
      const g = this.g;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, w, h);
      g.save();
      if (this.flip) { g.translate(w, 0); g.scale(-1, 1); }
      if (b <= 1.01) {
        g.drawImage(img, 0, 0);
      } else {
        // 모자이크: 작게 줄였다가(평균) 다시 키우기(최근접)
        const sw = Math.max(1, Math.round(w / b)), sh = Math.max(1, Math.round(h / b));
        this.tmp.width = sw; this.tmp.height = sh;
        const tg = this.tmp.getContext('2d');
        tg.imageSmoothingEnabled = true;
        tg.clearRect(0, 0, sw, sh);
        tg.drawImage(img, 0, 0, sw, sh);
        g.drawImage(this.tmp, 0, 0, w, h);
      }
      g.restore();
      this.el.style.setProperty('--w', `${w * px}px`);
      this.el.style.setProperty('--h', `${h * px}px`);
      this.el.style.setProperty('--x', `${Math.round(this.pos.x - (w * px) / 2)}px`);
      this.el.style.setProperty('--y', `${Math.round(this.pos.y - h * px)}px`);
    };
    requestAnimationFrame(tick);
  }
}
