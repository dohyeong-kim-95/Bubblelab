import { Scene, LIGHTS_MAX } from './scene.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import * as story from './story.js';
import { setupInstall } from './install.js';
import { Progress } from './save.js';
import { bakePortrait } from './sprites.js';
import * as illust from './illust.js';
import { RoamingCat } from './roam.js';
import { setupMenu } from './menu.js';
import { shareScene } from './snapshot.js';
import { CAT_GIFTS, CAT_GIFT_NIGHTS } from './data.js';
import { Settings } from './settings.js';

// 밤 목록은 story.js 가 정한다 (NIGHTS 가 없으면 밤 1 만)
const NIGHTS = story.NIGHTS ?? [story.nightOne];

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const audio = new Audio();
const scene = new Scene($('#scene'));
const progress = new Progress();
const ui = new UI(audio, progress);
ui.cat = new RoamingCat({ scene, audio });   // 제4의 벽을 넘는 고양이 — 대본이 ui.cat.visit() 로 부른다
setupInstall({ toast: (t) => ui.toast(t) });

// 소리 설정은 이 기기에만 기억한다
try { audio.on = localStorage.getItem('teahouse.sound') !== 'off'; } catch { /* 저장소 없음 */ }
const soundBtn = $('#sound');
const paintSound = () => { soundBtn.textContent = audio.on ? '♪ 소리 켜짐' : '♪ 소리 꺼짐'; };
paintSound();
soundBtn.addEventListener('click', () => {
  audio.setOn(!audio.on);
  paintSound();
  try { localStorage.setItem('teahouse.sound', audio.on ? 'on' : 'off'); } catch { /* 무시 */ }
});

// 렌더 루프
let prev = performance.now();
const loop = (now) => {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  scene.frame(dt);
  requestAnimationFrame(loop);
};
scene.state.fade = 1;
requestAnimationFrame(loop);

// ── 대화창 초상화 ── 화자 이름 → 그림. 한 번 구운 건 다시 쓴다.
// 사장은 그림을 붙이지 않는다 (D-019).
const portraitCache = new Map();
illust.loadIllust();
const portrait = (id, face, opts = {}) => {
  // Codex 가 그린 얼굴 그래픽이 있으면 그것, 없으면 코드 픽셀 초상화
  const png = !opts.sepia && illust.img('face', id, face);
  if (png) return png;
  const key = `${id}/${face}/${opts.sepia ? 's' : ''}`;
  if (!portraitCache.has(key)) portraitCache.set(key, bakePortrait(id, face, 2, opts));
  return portraitCache.get(key);
};
ui.portraitFor = (name) => {
  if (name === '하린') return portrait('harin', scene.face?.() ?? scene.state.guestFace ?? 'normal');
  if (name === '엄마') return portrait('mother', 'normal', { sepia: scene.state.mode === 'memory' });
  return null;
};

// 말하는 사람 → 스탠딩 일러스트 (Codex 그림이 있는 인물만; 없으면 작은 초상화)
ui.standFor = (name) => {
  if (name === '하린') return { id: 'harin', face: scene.face?.() ?? scene.state.guestFace ?? 'normal' };
  if (name === '엄마') return { id: 'mother', face: 'normal' };
  return null;
};

// ── 고양이 쓰다듬기 ── 찻집 화면의 고양이를 누르면 골골 (대사는 넘기지 않는다)
$('#stage').addEventListener('click', (e) => {
  const r = $('#scene').getBoundingClientRect();
  const x = ((e.clientX - r.left) * $('#scene').width) / r.width;
  const y = ((e.clientY - r.top) * $('#scene').height) / r.height;
  if (scene.hitCat?.(x, y)) {
    e.stopPropagation();
    audio.sfx('purr');
  }
}, true);

// ── 찻집 시계 ── 매일 밤 새벽 2시에 열어서, 대사 한 줄마다 조금씩 가 3시 전에 끝난다.
// 3시를 넘긴 적은 없다 (피날레 전까지 — docs/story/bible.md). story 가 직접 써도 된다.
const CLOCK_START = 120;      // 2:00
const CLOCK_END_MIN = 150;    // 2:30
const CLOCK_MAX = 179;        // 2:59
scene.state.clock = CLOCK_START;
ui.onLine = () => {
  scene.state.clock = Math.min(CLOCK_MAX, scene.state.clock + 0.75);
  // 손님이 떠났으면 일러스트도 내린다
  if (scene.state.mode === 'shop' && !scene.state.guest) ui.unstand('harin');
  if (scene.state.mode !== 'memory') ui.unstand('mother');
};

// ── 화면 전환 ─────────────────────────────────────────────────
const screens = ['#title', '#between', '#ending'];
const only = (sel) => { for (const s of screens) $(s).hidden = s !== sel; };

const allDone = () => progress.night > NIGHTS.length;

function paintTitle() {
  const open = $('#open');
  const fresh = $('#fresh');
  fresh.dataset.armed = '';
  fresh.textContent = '처음부터';
  if (!progress.started) {
    open.textContent = '찻집 문 열기';
    fresh.hidden = true;
  } else if (allDone()) {
    open.textContent = '처음부터 다시 보기';
    fresh.hidden = true;
  } else {
    open.textContent = `이어하기 · ${['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'][progress.night - 1] ?? progress.night} 번째 밤`;
    fresh.hidden = false;
  }
}

function toTitle() {
  only('#title');
  scene.state.weather = 'clear';
  audio.weather?.(null);
  ui.unstand();
  ui.cat.home({ instant: true });
  ui.pourEase = 0;
  ui.show(null);
  paintTitle();
  Object.assign(scene.state, { guest: null, guestAsleep: false, guestFace: 'normal', cup: null });
  audio.mood('title');
  scene.fadeTo(0.55, 900);
}

/** 밤 n 을 열 때 남은 불빛 (밤마다 손님 하나가 잠들어 불빛 하나가 꺼진다) */
const lightsBefore = (n) => Math.max(0, LIGHTS_MAX - (n - 1));

/** 밤 끝 의식: 테라스로 나가 불빛 하나가 꺼지는 걸 고양이와 본다 (사용자 2026-11-18, 야경 A안) */
async function terrace(n) {
  ui.show(null);
  ui.unstand();
  ui.cat.home({ instant: true });
  await scene.fadeTo(1, 900);
  scene.state.mode = 'terrace';
  scene.state.lights = lightsBefore(n);
  scene.particles = [];
  await scene.fadeTo(0, 1100);
  await wait(700);
  await scene.dimLight();
  await wait(1200);
  await scene.fadeTo(1, 900);
  scene.state.mode = 'shop';
  scene.particles = [];
  await scene.fadeTo(0, 900);
}

/** 밤 n 을 연다. 끝나면 저장하고, 다음 밤이 있으면 쉬는 화면으로 */
async function play(n) {
  audio.start();
  only(null);
  ui.notebook(`night-${n}`);   // story 가 손님별 키로 바꿔 쓴다 (예: 'harin-1')
  Object.assign(scene.state, { mode: 'shop', guest: null, guestAsleep: false, guestFace: 'normal', cup: null, fade: 1, memory: 'harin-1', shelfGlow: {}, weather: 'clear' });
  ui.unstand();
  ui.cat.home({ instant: true });
  ui.pourEase = 0;
  scene.state.clock = CLOCK_START;
  scene.state.lights = lightsBefore(n);                  // 창밖 도시: 재운 손님 수만큼 불이 꺼져 있다
  scene.state.shelf = progress.items.map((i) => i.id);   // 지난 밤들의 꿈 조각이 선반에
  audio.mood('shop');
  await NIGHTS[n - 1]({ scene, ui, audio, progress, night: n });
  scene.state.clock = Math.max(scene.state.clock, CLOCK_END_MIN);   // 밤이 끝날 땐 적어도 2시 반
  audio.weather?.(null);
  scene.state.weather = 'clear';
  progress.finishNight(n);
  await terrace(n);
  // 가끔, 밤이 끝나면 고양이가 선물을 물어 온다 (다시 보기 때는 이미 받은 건 건너뛴다)
  const giftId = CAT_GIFT_NIGHTS[n];
  const gift = giftId && !progress.hasGift(giftId) && CAT_GIFTS.find((g) => g.id === giftId);
  if (gift) {
    scene.catDo?.('loaf');
    await ui.say('', '( 선반 옆에 뭔가가 놓여 있다. 고양이가 대단한 걸 가져온 얼굴을 하고 있다. )');
    await ui.gift(gift);
  }
  if (n >= NIGHTS.length) {
    ui.show(null);
    only('#ending');
    audio.mood('title');          // 타이틀 곡으로 돌아가 수미상관
    return;
  }
  const next = await ui.between(n);
  if (next === 'next') play(n + 1);
  else toTitle();
}

$('#open').addEventListener('click', () => {
  // 다 깬 뒤 다시 보기: 진행(꿈 조각·단서·도달한 밤)은 지우지 않는다 — 다음 볼륨이 나오면 이어서 해야 하니까
  play(allDone() ? 1 : progress.night);
});

// 처음부터: 진행이 지워지니 두 번 눌러야 한다 (브라우저 확인창 대신)
$('#fresh').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = '진행이 지워져요 · 한 번 더 누르면 처음부터';
    return;
  }
  progress.reset();
  play(1);
});

$('#again').addEventListener('click', () => play(1));   // 다시 보기 — 진행은 남는다
$('#ending [data-title]').addEventListener('click', toTitle);

// 게임 안 "이 장면 공유하기" (bubblelab 공용 dock 대신 — 사용자 요청)
const shareText = () => (progress.night > NIGHTS.length
  ? `새벽 두 시의 찻집에서 ${['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'][NIGHTS.length] ?? NIGHTS.length} 번의 밤을 함께 보냈어요 🍵`
  : '잠 못 드는 밤, 꿈속 찻집에서 그 맛을 찾아 주는 게임 🍵');
for (const b of document.querySelectorAll('[data-share]')) {
  b.addEventListener('click', async () => {
    const how = await shareScene($('#scene'), shareText());
    if (how === 'downloaded') ui.toast('📸 장면을 그림으로 저장했어요');
  });
}

setupMenu({ progress, ui, onChange: paintTitle, canImport: () => !$('#title').hidden });

// 설정: 대사 자동 넘기기 · 미니게임 (📓 기록 + 대화창의 "자동" 버튼)
const settings = new Settings();
ui.settings = settings;
const autoBtn = $('#dialog .auto-toggle');
const setAuto = $('#set-auto'), setGames = $('#set-minigames');
const paintSettings = () => {
  autoBtn.setAttribute('aria-pressed', String(settings.auto));
  autoBtn.textContent = settings.auto ? '자동 ■' : '자동 ▶';
  setAuto.checked = settings.auto;
  setGames.checked = settings.minigames;
};
autoBtn.addEventListener('click', () => { audio.sfx('tap'); settings.set('auto', !settings.auto); });
setAuto.addEventListener('change', () => settings.set('auto', setAuto.checked));
setGames.addEventListener('change', () => settings.set('minigames', setGames.checked));
settings.onChange((key) => { paintSettings(); if (key === 'auto') ui.autoKick?.(); });
paintSettings();

// 브라우저는 첫 탭 전에는 소리를 못 낸다 → 타이틀의 첫 터치에서 타이틀 곡을 시작
addEventListener('pointerdown', () => {
  if ($('#title').hidden) return;
  audio.start();
  audio.mood('title');
}, { once: true });

// 테스트용 손잡이: 주소에 ?debug 가 있을 때만
if (new URLSearchParams(location.search).has('debug')) window.__teahouse = { ui, scene, audio, progress };

// 타이틀 뒤로 찻집이 은은하게 보이도록
paintTitle();
scene.fadeTo(0.55, 1500);
