// 대본: 하린의 세 밤, 태오, 다희, 수경. 밤 함수는 main.js 가 NIGHTS 순서대로 연다.
// 각 밤은 ({ scene, ui, audio, progress, night }) 를 받는다. 저장·밤 사이 화면·엔딩은 main 담당.
// 주의: 사장의 이름은 Vol.5 전까지 game/ 어디에도 쓰지 않는다 (docs/story/bible.md 1-6).
import { judge, assistFor, HARIN_N1_LINES as N1_BASE } from './blend.js';
import { BASES, ADDITIONS, HARIN_N1_RECIPE, HARIN_N2_RECIPE, TAEO_RECIPE, DAHUI_RECIPE, SUKYUNG_RECIPE } from './data.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ME = '사장';
const HARIN = '하린';
const TAEO = '태오';
const DAHUI = '다희';
const SUKYUNG = '수경';
const nameOf = (id) => ADDITIONS.find((a) => a.id === id)?.name ?? BASES.find((b) => b.id === id)?.name ?? id;
/** 받침 있으면 a, 없으면 b (예: 레몬은 / 민트는) */
const josa = (word, a, b) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (c >= 0 && c <= 11171 && c % 28 ? a : b);
};

// ── 공통 흐름 ─────────────────────────────────────────────────

/** 질문 메뉴. 고른 질문의 답을 듣고 수첩에 적는다. '차를 내려 볼게요'나 질문이 다 떨어지면 끝 */
async function askLoop(ui, guest, questions, asked) {
  for (;;) {
    const left = questions.filter((q) => !asked.has(q.id));
    if (!left.length) return;
    const opts = left.map((q) => ({ label: `💬 ${q.label}`, value: q.id }));
    if (asked.size > 0) opts.push({ label: '🫖 차를 내려 볼게요', value: 'brew', primary: true });
    const pick = await ui.choose('무엇을 물어볼까?', opts);
    if (pick === 'brew') return;
    const q = questions.find((x) => x.id === pick);
    asked.add(q.id);
    await ui.say(ME, q.label);
    await ui.say(guest, q.answer);
    ui.addClue(q.clue);
  }
}

/**
 * 따르기 반응 한마디. lines.pour[result] 는 문자열이나 배열 — 배열이면 같은 결과가 나올 때마다
 * 다음 줄로 넘어가고, 끝까지 가면 처음으로 돈다 (같은 농담 반복 방지).
 */
function pourLine(lines, { result, game = 'pour' }, seen) {
  // 미니게임별 대사(ice·milk·steep)가 없으면 따르기 대사로 (lead 2026-11-18)
  const v = lines?.[game]?.[result] ?? lines?.pour?.[result];
  if (!v) return null;
  if (!Array.isArray(v)) return v;
  const key = `${lines?.[game]?.[result] ? game : 'pour'}:${result}`;
  const n = seen[key] ?? 0;
  seen[key] = n + 1;
  return v[n % v.length];
}

/**
 * 블렌딩 → (ui 가 따르기 미니게임) → 따른 양 반응 → 판정 반복.
 * 따르기 결과는 반응 한마디에만 쓰고, 판정은 레시피로만 한다. 맞히면 끝난다.
 * onMiss(r, brew, tries) 는 손님 반응을 직접 맡는다 (없으면 r.line 을 말함).
 * afterMiss(brew, tries) 는 반응 뒤 고양이 힌트 등.
 */
async function brewLoop({ scene, ui, audio }, { guest, recipe, lines, questions, asked, onMiss, afterMiss }) {
  let tries = 0;
  let last = null;
  const seen = {};
  for (;;) {
    const canAsk = !!questions && asked.size < questions.length;
    const res = await ui.blend({ canAsk, last, hint: assistFor(recipe, tries) });   // 틀릴수록 쉬워진다
    if (res.action === 'ask') { await askLoop(ui, guest, questions, asked); continue; }
    const { brew } = res;
    last = brew;
    ui.show(null);
    scene.state.cup = brew.color;
    const said = brew.pour && pourLine(lines, brew.pour, seen);
    if (said) await ui.say(guest, said);
    const r = judge(brew, recipe, lines);
    tries++;
    if (r.ok) return { tries, line: r.line };
    audio.sfx('miss');
    scene.setFace('normal');
    if (onMiss) await onMiss(r, brew, tries);
    else await ui.say(guest, r.line);
    scene.state.cup = null;
    if (afterMiss) await afterMiss(brew, tries);
  }
}

/** 기억 장면으로 들어갔다가 찻집으로 돌아온다. id: 기억 그림이자 음악 모티프 이름 ('harin-1' 등) */
async function memory(scene, audio, id, play) {
  audio.mood('memory', { motif: id });
  await scene.fadeTo(1, 900);
  try { scene.setMemory(id); } catch { /* 그림이 아직 없으면 기본 기억 그림으로 */ }
  scene.state.mode = 'memory';
  scene.particles = [];
  await scene.fadeTo(0, 1200);
  await play();
  audio.mood('shop');
  await scene.fadeTo(1, 900);
  scene.state.mode = 'shop';
  scene.particles = [];
  await scene.fadeTo(0, 900);
}

/** 잠든 손님이 사라지고 빈 찻집이 된다 */
async function guestLeaves(scene, audio) {
  await scene.fadeTo(1, 1200);
  scene.state.guest = null;
  scene.state.guestAsleep = false;
  scene.state.guestFace = 'normal';
  scene.state.cup = null;
  audio.mood('shop');
  await scene.fadeTo(0, 900);
}

function fallAsleep(scene, audio, face = 'asleep') {
  audio.mood('sleep');
  scene.setFace(face);
  scene.state.guestAsleep = true;
}

// ── 밤 1: 노란 병 ─────────────────────────────────────────────

const N1_QUESTIONS = [
  {
    id: 'taste', label: '어떤 맛이었어요?',
    answer: '따뜻하고 달콤했어요. 근데 끝에 살짝 새콤했어요. 과일 껍질 같은 향도 났고요.',
    clue: '달콤하고 끝이 살짝 새콤. 과일 껍질 향.',
  },
  {
    id: 'who', label: '누가 만들어 줬어요?',
    answer: '엄마요. 시험 전날 밤이면 꼭 타 줬어요. 목 아프면 시험 망한다고. 그건 좀 과학적이지 않은데.',
    clue: '엄마가 시험 전날 타 줌. 목에 좋은 것.',
  },
  {
    id: 'feel', label: '마시면 어땠어요?',
    answer: '목이 화끈… 아니, 알싸했나? 몸이 확 데워졌어요. 그러면 신기하게 잠이 왔어요.',
    clue: '알싸하고 몸이 확 데워짐.',
  },
  {
    id: 'where', label: '어디서 꺼내서 넣었어요?',
    answer: '냉장고에 있던 노란 병이요! 숟가락으로 푹 떠서 넣었어요. 겨울마다 엄마가 담갔던 거. 저는 몰래 퍼먹다 혼났고요.',
    clue: '냉장고의 노란 병에서 떠 넣음.',
  },
];

// 찻잎 우리기 반응 (공용) — 데모에서 정답으로는 안 나오지만, 녹차·홍차를 고르면 나온다
const STEEP = {
  perfect: ['색이 딱 예쁘게 우러났네요.', '잘 우러났어요.'],
  good: ['적당히 우러났어요.', '이 정도면 좋아요.'],
  under: ['음… 좀 연하네요. 찻잎이 아직 덜 깼나 봐요.', '물에 찻잎 냄새만 살짝 뱄어요.'],
  over: ['으, 떫어요. 찻잎이 너무 오래 놀았네요.', '혀가 오그라들어요. 진하다 못해 떫어요.'],
};

const HARIN_N1 = {
  ...N1_BASE,
  pour: {
    perfect: ['와, 딱 엄마가 따라 주던 만큼이에요.', '오, 이번에도 딱이에요.'],
    good: ['적당해요. 손에 쥐기 딱 좋은 만큼.', '음, 이 정도면 좋아요.'],
    under: ['어… 반 잔이네요. 아껴 마시라는 거죠?', '오늘 찻잎이 귀한가 봐요.'],
    over: ['앗, 넘친다! 괜찮아요, 엄마도 맨날 넘치게 줬어요. 사랑이 넘쳐서래요.', '또 넘쳤다! 사장님 오늘 인심 좋으시네.'],
  },
  steep: STEEP,
};

export async function nightOne(ctx) {
  const { scene, ui, audio } = ctx;
  ui.notebook('harin-1');
  const asked = new Set();

  await scene.fadeTo(0, 1200);
  await ui.say('', '새벽 두 시.');
  await ui.say('', '이 찻집은 잠들지 못한 사람의 꿈속에만 문을 연다.');
  await ui.say('', '…나는 언제부터 여기서 차를 끓이고 있었을까. 기억나지 않는다.');
  scene.catDo?.('stretch');
  await ui.say('', '카운터 위 고양이가 하품을 한다. 너도 모르는구나.');
  audio.sfx('bell');
  await ui.say('', '딸랑— 문에 달린 종이 울렸다.');
  scene.setFace('normal');
  await scene.enterGuest('harin');
  ui.stand?.('harin', 'surprised');                       // ★ 첫 등장
  await ui.say(HARIN, '어… 여기가 어디예요? 분명 침대에 누워 있었는데.');
  await ui.say(ME, '어서 오세요. 잠이 안 오는 분들이 찾아오는 찻집이에요.');
  ui.unstand?.('harin');
  await ui.say(HARIN, '잠이 안 오는 건 맞아요… 내일 아침에 면접이 있거든요. 세 시간째 천장 무늬만 세고 있었어요.');
  await ui.say(ME, '몇 개였어요?');
  await ui.say(HARIN, '…이백십사 개요. 아, 진짜 세고 있었네.');
  await ui.say(ME, '그럼 차 한 잔 드릴게요. 혹시 마시면 마음이 놓이던 차가 있어요?');
  await ui.say(HARIN, '음… 있었어요. 이름은 모르겠는데, 어릴 때 마시던 거.');
  await ui.say('', '손님이 기억하는 그 맛을 찾아 주자. 이야기를 나누면 단서가 모인다.');

  await askLoop(ui, HARIN, N1_QUESTIONS, asked);
  await brewLoop(ctx, {
    guest: HARIN, recipe: HARIN_N1_RECIPE, lines: HARIN_N1, questions: N1_QUESTIONS, asked,
    // 오래 헤매면 고양이가 슬쩍 돕는다
    afterMiss: async (brew, tries) => {
      if (tries === 2 && !brew.additions.includes('yuja')) {
        scene.catDo?.('tail');
        await ui.say('', '고양이가 노란 병 쪽으로 꼬리를 살랑 흔든다. …힌트 주는 거니?');
      } else if (tries >= 4 && !brew.additions.includes('ginger')) {
        scene.catDo?.('sneeze');
        await ui.say('', '고양이가 생강 바구니에 코를 대고 재채기를 했다. 에취. 그건 좀 노골적인데.');
      }
    },
  });

  // 성공
  audio.sfx('success');
  scene.emit('spark', 101, 84, 24);
  scene.setFace('teary');
  ui.stand?.('harin', 'teary');                           // ★ 절정
  await ui.say(HARIN, '…이거예요. 이 맛이에요.');
  ui.unstand?.('harin');
  await memory(scene, audio, 'harin-1', async () => {
    await ui.say('', '열일곱 살 겨울, 기말고사 전날 밤.');
    await ui.say('', '엄마는 아무 말 없이 노란 병을 열고, 생강을 얇게 저몄다.');
    ui.stand?.('mother', 'normal', { side: 'center' });    // ★ 기억 속 엄마
    await ui.say('엄마', '하린아, 떨려도 괜찮아. 떨린다는 건 잘하고 싶다는 거니까.');
    ui.stand?.('mother', 'smile', { side: 'center' });
    await ui.say('엄마', '그리고 노란 병 몰래 퍼먹은 거, 엄마 다 알아.');
    ui.unstand?.('mother');
    await ui.say('', '그날 밤, 나는 웃다가 금방 잠들었다.');
  });
  await ui.say(HARIN, '…엄마 목소리, 오랜만에 들었네.');
  await ui.say(HARIN, '요즘 연락도 잘 안 했는데.');
  scene.setFace('smile');
  await ui.say(HARIN, '면접 끝나면 전화해 봐야겠어요. 노란 병 얘기도 하고.');
  await ui.say(ME, '어머님이 좋아하시겠네요. 아마 \'그럴 줄 알았다\'고 하실걸요.');
  await ui.say(HARIN, '헤헤, 맞아요. 꼭 그래요.');
  ui.stand?.('harin', 'sleepy');                          // ★ 잠들기 직전
  await ui.say(HARIN, '고마워요, 사장님. 이제… 잘 수 있을 것 같아요.');
  ui.unstand?.('harin');
  fallAsleep(scene, audio);
  await ui.say('', '하린은 카운터에 기대어 새근새근 잠들었다.');
  scene.catDo?.('loaf');
  await ui.say('', '고양이가 하린 옆에 슬쩍 붙어 눕는다. 자리 맡는 건 빠르구나.');
  await guestLeaves(scene, audio);
  scene.state.clock = 152;
  await ui.say('', '벽시계는 두 시 반을 조금 넘겼다.');
  await ui.say('', '하린이 앉아 있던 자리에, 무언가 반짝이는 게 남아 있다.');
  ui.show(null);
  await ui.item('엄마의 손편지', '하린아, 떨려도 괜찮아.\n넌 잘할 거야.\n— 냉장고에 유자차 있다\n(퍼먹지 말고)', 'letter');
  await ui.say('', '차를 한 잔 끓여 줄 때마다, 내 안에서도 무언가 조금씩 데워지는 것 같다.');
  await ui.say('', '…나는, 누구였더라.');
  scene.catDo?.('tail');
  await ui.say('', '고양이는 대답 대신 꼬리로 내 손등을 한 번 쓸었다.');
  // ★ 제4의 벽: 처음으로 틀 밖으로 나온다
  ui.cat?.out?.('walk');
  await ui.say('', '…그러고는 그대로 이쪽으로 걸어 나왔다.');
  ui.cat?.out?.('paw');
  await ui.say('', '내 손등을 앞발로 톡, 톡. 위로해 주는 건가.');
  await ui.say('', '…근데 거기 올라가면 안 되는데.');
  ui.cat?.home?.();
  ui.end();
}

// ── 밤 2: 식은 찻잔 ───────────────────────────────────────────

const N2_QUESTIONS = [
  {
    id: 'taste', label: '어떤 맛이었어요?',
    answer: '한 모금 몰래 마셔 봤는데… 구수했어요. 밥 냄새 같은. 그리고 단맛이 은은하게.',
    clue: '구수한 밥 냄새. 은은한 단맛.',
  },
  {
    id: 'smell', label: '무슨 향이 났어요?',
    answer: '부엌에 들어가면 달큰한 나무 냄새가 났어요. 겨울 붕어빵 같은. 생강은 아니었어요, 맵지 않았거든요.',
    clue: '달큰한 나무 향. 생강은 아님.',
  },
  {
    id: 'cup', label: '어머님 컵은 어땠어요?',
    answer: '늘 식어 있었어요. 타 놓고 장부 쓰다 보면 잊어버리니까. 엄마는 그게 더 맛있대요.',
    clue: '엄마 컵은 늘 식어 있었다.',
  },
  {
    id: 'sweet', label: '단맛은 뭐였을까요?',
    answer: '설탕통은 안 열었어요. 저 감기 걸리면 쓰던 그 끈적한 거, 그 병을 썼어요.',
    clue: '감기 때 쓰던 끈적한 단것.',
  },
];

export const HARIN_N2_LINES = {
  perfect: '…이거예요. 식었는데, 이상하게 따뜻해요.',
  temp: '맛은 비슷한데… 엄마 컵은 이렇게 뜨겁지 않았어요. 늘 식어 있었어요.',
  empty: '구수한 물이네요. 근데 엄마 건 향도 나고 달았어요.',
  base: {
    water: '너무 맑아요. 더 구수했어요, 밥 냄새처럼.',
    green: '풀 냄새가 나요. 엄마 건 더 구수했어요.',
    black: '떫어요. 엄마는 찻잎 우리는 거 안 좋아했어요.',
    default: '음… 엄마 건 더 구수했어요.',
  },
  missing: {
    cinnamon: '구수하고 달긴 한데… 부엌에 퍼지던 그 나무 냄새가 없어요.',
    honey: '향은 맞아요! 근데 너무 싱거워요. 그 끈적한 병…',
  },
  mixup: {
    cinnamon: { ginger: '앗, 매워요. 이건 제 차예요. 엄마 건 안 매웠어요.' },
    honey: { yuja: '새콤해요. 이건 제가 마시던 거고… 엄마 건 그냥 단맛이었어요.' },
  },
  extra: {
    milk: '우유는 아니었어요. 색이 더 맑은 갈색이었어요.',
    lemon: '이런 향은 없었어요. 엄마 부엌은 더 수수했어요.',
    mint: '이런 향은 없었어요. 엄마 부엌은 더 수수했어요.',
    chamomile: '이런 향은 없었어요. 엄마 부엌은 더 수수했어요.',
    ginger: '그건 엄마가 저한테만 넣어 줬던 거예요.',
    yuja: '그건 엄마가 저한테만 넣어 줬던 거예요.',
  },
  extraDefault: '엄마 부엌은 더 수수했어요.',
  pour: {
    perfect: ['딱 엄마 머그잔만큼이에요. 이 빠진 데 바로 아래까지.', '딱이에요. 엄마도 이만큼 따랐어요.'],
    good: ['이 정도면 좋아요. 엄마는 조금 더 따랐지만.', '좋아요, 넉넉해요.'],
    under: ['엄마는 늘 가득 따랐어요. 다 마시지도 못하면서.', '조금만 더요. 엄마 잔은 늘 찰랑찰랑했어요.'],
    over: ['넘쳤다! 괜찮아요, 어차피 식으면 줄어… 아, 그건 아닌가.', '또 넘쳤어요. 고양이가 핥으러 오겠다.'],
  },
  ice: {
    perfect: ['오, 얼음 딱. 컵이 금방 차가워져요.', '딱 시원해요.'],
    good: ['시원해요. 이 정도면 좋아요.', '좋아요, 차가워요.'],
    under: ['얼음이 좀 모자라요. 미지근해요… 엄마 보리차는 이가 시렸는데.', '아직 미지근해요. 얼음 한두 개만 더요.'],
    over: ['앗, 얼음이 넘쳤어요! 컵보다 얼음이 많아요.', '또 넘쳤다. 얼음 부자네요, 사장님.'],
  },
  steep: STEEP,
};

export async function nightTwo(ctx) {
  const { scene, ui, audio, progress } = ctx;
  ui.notebook('harin-2');
  const asked = new Set();
  // 비 오는 밤 — 창밖 날씨는 손님의 현실 날씨 (bible 1-2). 밤이 끝나면 main 이 걷는다
  scene.state.weather = 'rain';
  audio.weather?.('rain');

  await scene.fadeTo(0, 1200);
  await ui.say('', '새벽 두 시.');
  scene.state.clock = 120;
  await ui.say('', '시계는 다시 두 시를 가리키고 있다. 어제는 분명 세 시 가까이 갔는데.');
  if (progress?.hasItem?.('letter')) {
    await ui.say('', '창에 비친 내 모습이, 어제보다 조금 또렷하다. 어깨가… 이렇게 생겼었나.');
  }
  await ui.say('', '창밖에 비가 온다. 이 찻집 창에 빗방울이 맺힌 건 처음이다.');
  scene.catDo?.('paw');
  await ui.say('', '고양이가 창가로 가서 빗방울을 앞발로 톡, 톡 친다. 유리 너머라 안 잡힌다. 계속 친다.');
  if (progress?.hasItem?.('letter')) await ui.say('', '선반 위, 엄마의 손편지가 희미하게 빛나고 있다.');
  audio.sfx('bell');
  await ui.say('', '딸랑— 문에 달린 종이 울렸다.');
  scene.setFace('normal');
  await scene.enterGuest('harin');
  scene.setFace('smile');
  ui.stand?.('harin', 'smile');                           // ★ 재방문
  await ui.say(HARIN, '사장님! …아, 진짜 또 왔네. 꿈인데.');
  ui.stand?.('harin', 'surprised');
  await ui.say(HARIN, '근데 밖에 비 와요! 저 우산 없이 나왔는데…');
  ui.stand?.('harin', 'smile');
  await ui.say(HARIN, '…아, 꿈이지. 하나도 안 젖었네. 꿈 최고.');
  ui.unstand?.('harin');
  await ui.say(ME, '수건 드릴까요?');
  await ui.say(HARIN, '안 젖었다니까요?');
  await ui.say(ME, '그래도요. 분위기상.');
  await ui.say(ME, '그래서, 오늘은 천장 무늬 몇 개까지 셌어요?');
  await ui.say(HARIN, '오늘은 안 셌어요! …양을 셌어요. 사백 마리.');
  scene.catDo?.('ear');
  await ui.say('', '고양이가 \'양\'이라는 말에 귀를 쫑긋 세운다. 아니야, 먹는 거 아니야.');
  await ui.say(HARIN, '저 면접, 붙었어요. 1차요.');
  await ui.say(ME, '축하해요!');
  scene.setFace('normal');
  await ui.say(HARIN, '다음 주에 최종이 있는데… 오늘은 그거 때문에 못 자는 건 아니에요.');

  // 엄마와의 통화 (하린의 말로)
  await ui.say(HARIN, '그날 깨서 엄마한테 전화했어요. 진짜 오랜만에.');
  await ui.say(HARIN, '엄마가 "밥은 먹었니"부터 묻더라고요. 합격했다니까… 사장님 말이 맞았어요. "그럴 줄 알았다"고.');
  await ui.say(ME, '역시.');
  await ui.say(HARIN, '노란 병 얘기도 했는데, 엄마가 "너 그거 아직도 기억하니" 하면서 엄청 웃었어요.');
  await ui.say(HARIN, '근데 통화하는 내내… 엄마가 기침을 했어요. 별거 아니래요. 가게가 바빠서 그렇대요.');
  await ui.say(ME, '걱정되셨겠네요.');
  await ui.say(HARIN, '생각해 보니까 저는 엄마가 타 준 차만 기억하더라고요.');
  await ui.say(HARIN, '엄마는 뭘 마셨는지, 한 번도 물어본 적이 없어요.');
  await ui.say(HARIN, '…아, 하나 기억나요. 엄마가 밤에 장부 쓰면서 마시던 거.');
  await ui.say('', '손님이 처음으로, 자기가 아닌 사람의 맛을 찾고 있다.');

  await askLoop(ui, HARIN, N2_QUESTIONS, asked);
  await brewLoop(ctx, {
    guest: HARIN, recipe: HARIN_N2_RECIPE, lines: HARIN_N2_LINES, questions: N2_QUESTIONS, asked,
    afterMiss: async (brew, tries) => {
      if (tries === 2 && brew.temp !== 'cold') {
        scene.catDo?.('loaf');
        await ui.say('', '고양이가 식은 찻잔에 앞발을 대 보더니, 만족한 듯 그 옆에서 식빵을 굽는다. 너는 식은 걸 좋아하는구나.');
      } else if (tries >= 4 && !brew.additions.includes('cinnamon')) {
        scene.catDo?.('groom');
        await ui.say('', '고양이가 계피 바구니에 얼굴을 비비다가 재채기를 한다. 오늘도 노골적이네.');
      }
    },
  });

  audio.sfx('success');
  scene.emit('spark', 101, 84, 24);
  scene.setFace('teary');
  ui.stand?.('harin', 'teary');                           // ★ 절정
  await ui.say(HARIN, HARIN_N2_LINES.perfect);
  ui.unstand?.('harin');
  await memory(scene, audio, 'harin-2', async () => {
    await ui.say('', '열 살, 겨울. 목이 말라 깬 새벽.');
    await ui.say('', '부엌 불이 켜져 있었다. 엄마가 계산기를 두드리고 있었다.');
    await ui.say('', '창밖에 비가 왔다. 계산기 소리와 빗소리가 번갈아 들렸다.');
    await ui.say('', '식탁 위, 이가 빠진 머그잔. 한 모금 몰래 마셨다.');
    await ui.say('어린 하린', '엄마, 이거 다 식었어.');
    ui.stand?.('mother', 'smile', { side: 'center' });     // ★ 기억 속 엄마
    await ui.say('엄마', '식어도 맛있어. 계피는 식으면 더 달아.');
    ui.stand?.('mother', 'normal', { side: 'center' });
    await ui.say('엄마', '얼른 자. 엄마도 이것만 하고 잘게.');
    ui.unstand?.('mother');
    await ui.say('', '엄마는 그날, 내가 다시 잠들 때까지 그 잔을 다 마시지 않았다.');
  });
  // 울컥한 하린 곁을 지킨다 (틀 안 — 틀 밖은 게임 통틀어 한두 번, bible 1-9)
  scene.catDo?.('look');
  await ui.say(HARIN, '엄마는 그때도 혼자 깨어 있었네요.');
  await ui.say('', '고양이가 창가에서 고개를 돌려, 가만히 하린을 보고 있다. 오늘은 장난도 안 친다.');
  scene.setFace('smile');
  await ui.say(HARIN, '저 이번 주말에 집에 갈래요. 이번엔 제가 차를 타 드릴래요.');
  await ui.say(HARIN, '따뜻하게요. 엄마가 식기 전에 마시게. 옆에서 지키고 있을 거예요.');
  await ui.say(ME, '감시하는 거네요.');
  await ui.say(HARIN, '네, 감시요. 헤헤.');
  fallAsleep(scene, audio);
  await ui.say('', '하린은 찻잔을 두 손으로 감싼 채 잠들었다.');
  await guestLeaves(scene, audio);
  await ui.say('', '하린이 앉아 있던 자리에, 무언가 반짝이는 게 남아 있다.');
  ui.show(null);
  await ui.item('이 빠진 머그잔', '식어도 맛있어.\n계피는 식으면 더 달아.', 'mug');

  // ★ 떡밥 1컷 — 설명 없음, 반복 없음
  audio.sfx('water');
  await ui.say('', '하린의 잔을 씻는다. 졸졸, 물소리. 창밖엔 빗소리.');
  ui.show(null);
  audio.stopSfx?.('water', 0.15);
  audio.weather?.(null, 0.15);     // 물소리와 빗소리가 같이 뚝 — 이 밤의 유일한 완전한 정적
  await wait(600);
  audio.sfx('beep');
  await Promise.all([scene.flash?.('ceiling'), wait(1200)]);
  audio.sfx('beep');
  await wait(900);
  audio.weather?.('rain');          // 빗소리가 천천히 돌아온다
  await ui.say('', '…?');
  await ui.say('', '빗소리가 돌아왔다. 방금 그 정적은, 뭐였지.');
  scene.catDo?.('look');
  ui.stand?.('cat', 'normal', { side: 'center' });       // ★ 떡밥 직후, 고양이의 시선
  await ui.say('', '고양이가 귀를 세우고 나를 빤히 보고 있다.');
  await ui.say(ME, '…방금, 무슨 소리 났지.');
  ui.stand?.('cat', 'blink', { side: 'center' });
  scene.catDo?.('blink');
  await ui.say('', '고양이는 대답하지 않는다. 당연하지만.');
  ui.unstand?.('cat');
  await ui.say('', '창밖은 여전히 새벽이고, 비는 조금 가늘어졌다.');
  ui.end();
}

// ── 밤 3: 그때 그거요 (단골 주문) ─────────────────────────────

/** 단골 주문 오답: 첫 번째는 웃으며, 두 번째부터는 정답 재료를 직접 알려 준다 */
function regularHint(r, tries) {
  if (tries === 1) {
    return '음? 사장님, 처음 온 날 거요! 수첩 보면 다 써 있잖아요.';
  }
  const [kind, a] = r.reason.split(':');
  if (kind === 'temp') return '에이, 뜨겁게요! 손 데워지는 거.';
  if (kind === 'base') return '맑은 물이요, 맑은 물! 찻잎 안 넣었어요.';
  if (kind === 'empty') return '노란 병이랑 생강이요! 사장님 까먹었죠?';
  if (kind === 'missing' || kind === 'mixup') {
    return a === 'yuja' ? '에이, 사장님 까먹었죠? 노란 병이요, 노란 병!' : `${josa(nameOf(a), '이요', '요')}! 목이 확 데워지는 거.`;
  }
  if (kind === 'extra') return `${josa(nameOf(a), '은', '는')} 빼 주세요. 그건 안 들어가요, 헤헤.`;
  return r.line;
}

// 밤 3: 판정 대사는 쓰지 않고 (regularHint 가 대신) 따르기 반응만 단골답게
const HARIN_N3 = {
  ...N1_BASE,
  perfect: '…맞아요. 이제 이 맛은 제가 만들 줄도 알아요.',
  pour: {
    perfect: ['역시 사장님. 단골 잔은 눈 감고도 따르시네요.', '딱! 역시.'],
    good: ['좋아요. 단골 잔 인정.', '오케이, 이 정도면 좋아요.'],
    under: ['에이, 단골한테 반 잔이요? 서운한데요. 헤헤.', '사장님, 또 반 잔… 저 단골이에요!'],
    over: ['와, 서비스예요? 단골 최고!', '또 서비스? 저 이러다 매일 와요.'],
  },
  steep: STEEP,
};

export async function nightThree(ctx) {
  const { scene, ui, audio, progress } = ctx;
  ui.notebook('harin-1');   // 밤 1 단서가 그대로 보인다

  await scene.fadeTo(0, 1200);
  await ui.say('', '새벽 두 시.');
  if (progress?.hasItem?.('mug')) await ui.say('', '앞치마를 매다가 문득 손을 본다. 차를 많이 끓여 본 손이다.');
  if (progress?.hasItem?.('letter') && progress?.hasItem?.('mug')) {
    await ui.say('', '선반 위, 손편지와 머그잔이 나란히 놓여 있다.');
  }
  audio.sfx('bell');
  await ui.say('', '딸랑— 종소리가 오늘은 조금 경쾌하다.');
  scene.setFace('normal');
  await scene.enterGuest('harin');
  scene.setFace('smile');
  ui.stand?.('harin', 'smile');                           // ★ 등장
  await ui.say(HARIN, '사장님, 안녕하세요! 고양이도 안녕!');
  ui.unstand?.('harin');
  scene.catDo?.('tail');
  await ui.say('', '고양이는 꼬리 끝만 한 번 들었다 내린다. 이게 이 집 최고 예우다.');
  await ui.say(HARIN, '오늘은 잠이 안 와서… 아니, 안 오긴 하는데, 떨려서가 아니에요.');
  await ui.say(HARIN, '내일 최종 면접이에요. 근데 이상하게 설레요.');
  await ui.say(ME, '얼굴이 많이 밝아졌어요. 양 안 세도 되겠는데요.');
  await ui.say(HARIN, '주말에 집에 갔다 왔거든요.');
  await ui.say(HARIN, '엄마한테 유자차 타 드렸어요. 생강 저미다가 손 벨 뻔했는데, 엄마가 옆에서 웃더라고요. "그렇게 하는 거 아니다" 하면서.');
  await ui.say(HARIN, '결국 엄마가 저미고 저는 물만 부었어요. 그래도 제가 탄 거예요!');
  await ui.say(HARIN, '기침은 감기였대요. 병원 다녀왔대요. 제가 막 우겨서.');
  await ui.say(ME, '잘했어요.');

  // 단골 주문 — 질문 없이 바로, 기억해서 내린다
  await ui.say(HARIN, '오늘은 제가 주문해도 돼요?');
  await ui.say(HARIN, '그때 그거요. 처음 온 날 그거.');
  // 수첩 힌트 (틀 안)
  scene.catDo?.('paw');
  await ui.say('', '고양이가 카운터 위 수첩에 앞발을 턱 올린다.');
  await ui.say('', '단골의 "늘 마시던 것". …수첩을 보라는 거니? 그래, 펼쳐 봐도 좋다.');
  await brewLoop(ctx, {
    guest: HARIN, recipe: HARIN_N1_RECIPE, lines: HARIN_N3,
    onMiss: async (r, brew, tries) => {
      scene.setFace('smile');
      await ui.say(HARIN, regularHint(r, tries));
    },
  });

  audio.sfx('success');
  scene.emit('spark', 101, 84, 24);
  scene.setFace('smile');
  await ui.say(HARIN, HARIN_N3.perfect);
  scene.setFace('normal');
  await ui.say(HARIN, '근데 사장님.');
  await ui.say(ME, '네?');
  ui.stand?.('harin', 'normal');                          // ★ 이 밤의 핵심 질문
  await ui.say(HARIN, '사장님은 언제 자요? 저 올 때마다 깨어 있잖아요.');
  await ui.say(ME, '…글쎄요. 잘 모르겠어요. 얘한테 물어봐야 하나.');
  scene.catDo?.('stretch');
  await ui.say('', '고양이가 하품을 한다. 모른다는 뜻 같다.');
  scene.setFace('smile');
  ui.stand?.('harin', 'smile');
  await ui.say(HARIN, '사장님도 누가 차 타 줘야겠다. 다음엔 제가 타 드릴게요. 꿈에서라도.');
  ui.unstand?.('harin');
  await ui.say('', '그 말이, 이상하게 오래 남았다.');
  await ui.say(HARIN, '면접 결과는… 붙든 떨어지든, 괜찮을 것 같아요. 진짜로요.');
  await ui.say(HARIN, '그러니까 아마 한동안은 여기 못 올 거예요. 잘 잘 거라서.');
  await ui.say(ME, '그게 제일 좋은 소식이에요. 장사는 좀 안 되겠지만.');
  ui.stand?.('harin', 'sleepy');                          // ★ 작별
  await ui.say(HARIN, '에이, 다른 손님 오잖아요. 잘 있어요, 사장님.');
  ui.unstand?.('harin');
  fallAsleep(scene, audio, 'asleep-smile');
  await ui.say('', '하린은 웃는 얼굴로 잠들었다. 오늘은 카운터에 기대지 않고, 의자에 편하게 앉은 채로.');
  await guestLeaves(scene, audio);
  await ui.say('', '오늘은 아무것도 남지 않았다.');
  scene.state.shelfGlow = { ...scene.state.shelfGlow, letter: 0.8, mug: 0.8 };
  scene.emit('spark', 114, 74, 10);
  scene.catDo?.('purr');
  await ui.say('', '대신, 선반 위의 편지와 머그잔이 나란히 따뜻하게 빛난다.');
  await ui.say('', '…다음엔 제가 타 드릴게요.');
  scene.state.clock = 179;
  await ui.say('', '시계 바늘이 2시 59분에서 잠깐 머뭇거린다. 늘 그렇듯.');
  await ui.say('', '누군가 나에게 차를 타 준 적이, 있었던가.');
  // 오늘 영업 끝 (틀 안)
  scene.catDo?.('stretch');
  await ui.say('', '고양이가 기지개를 쭉 켜고 크게 하품을 한다. 오늘 영업은 여기까지라는 뜻이다.');
  ui.end();
}

// ── 밤 4: 태오 — 6월의 겨울 (docs/story/taeo-night.md) ─────────

const T_QUESTIONS = [
  {
    id: 'taste', label: '어떤 맛이었어요?',
    answer: '부드럽고 고소했어요. 뽀얀 색. 근데 그냥 우유는 아니었어요. 뒤에서 떫은 게 살짝 받쳐 줬어요.',
    clue: '뽀얗고 고소함. 뒤에 살짝 떫은맛.',
  },
  {
    id: 'smell', label: '향은 어땠어요?',
    answer: '달큰한 나무 향… 크리스마스 같은 냄새요. 걔가 "이게 겨울 냄새야" 그랬어요. 6월이었는데.',
    clue: '달큰한 나무 향. "겨울 냄새".',
  },
  {
    id: 'cafe', label: '어떤 카페였어요?',
    answer: '골목 안 작은 데요. 비가 와서 우연히 들어갔어요. 둘 다 우산이 없어서. 컵이 뜨거워서 한참 손만 녹였어요.',
    clue: '비 오는 날. 컵이 뜨거워 손을 녹임.',
  },
  {
    id: 'leaf', label: '차였어요, 커피였어요?',
    answer: '차요. 찻잎을 진하게 우려서 우유를 부었대요. 진한 갈색이 뽀얗게 변하는 거, 둘이 신기하다고 한참 봤어요.',
    clue: '진하게 우린 찻잎 + 우유.',
  },
];

export const TAEO_LINES = {
  perfect: '…이거네요. 진짜 이 맛이네.',
  temp: '차갑네요. 그날은 컵이 뜨거워서 한참 손만 녹였는데.',
  empty: '그냥 진한 차네요. 이것도 좋은데, 그날 건 뽀얬어요.',
  base: {
    // 하린 때 몸에 익은 '맑은 물'을 깨는 대사 — 이 밤의 핵심
    water: '…뭔가 비어 있어요. 우유랑 향은 있는데, 그 밑을 받쳐 주던 게 없어요. 떫고 진한 거.',
    green: '찻잎은 맞는 것 같은데… 풀 냄새가 나요. 더 진하고 붉은 쪽이었어요.',
    barley: '구수하네요. 근데 이건 보리차잖아요. 더 떫고 진했어요.',
    default: '음… 더 떫고 진했어요.',
  },
  missing: {
    milk: '진하고 향은 좋은데… 너무 떫어요. 뽀얀 색이었어요.',
    cinnamon: '고소하고 부드러워요. 근데 그 겨울 냄새가 없어요.',
  },
  mixup: {
    cinnamon: { ginger: '어, 매워요. 따뜻한 건 맞는데 이건 생강이죠. 더 달큰했어요.' },
  },
  extra: {
    lemon: '레몬은… 우유랑 같이 넣으면 안 될 것 같은데요.',
    mint: '화하네요. 그 카페는 따뜻한 냄새뿐이었어요.',
    chamomile: '꽃 향은 아니었어요.',
    yuja: '새콤한 건 없었어요.',
    ginger: '생강은 아니었어요. 맵지 않았어요.',
  },
  extraDefault: '이건 안 들어갔던 것 같아요.',
  pour: {
    perfect: ['딱이네요. 그 카페 사장님보다 잘 따르시는데요.', '딱이에요.'],
    good: ['좋네요. 적당해요.', '이 정도면 충분해요.'],
    under: ['반 잔이네요. …요즘 제 상태 같네.', '조금만 더 주세요. 오늘은 좀 길게 마시고 싶어서.'],
    over: ['아, 넘쳤다. 괜찮아요. 걔도 맨날 넘치게 따랐어요. …아, 또 걔 얘기.', '또 넘쳤네요. 오늘은 다 넘치는 날인가 봐요.'],
  },
  milk: {
    perfect: ['우유 딱이네요. 진한 갈색이 뽀얗게… 그날이랑 똑같아요.', '딱 그 색이에요.'],
    good: ['좋네요. 조금만 더 뽀얬던 것 같지만.', '이 정도면 좋아요.'],
    under: ['우유가 좀 적네요. 아직 떫어요. 그날은 더 뽀얬어요.', '조금만 더요. 아직 색이 진해요.'],
    over: ['우유가 너무 많아요. 밍밍해졌네… 홍차가 어디 갔지.', '또 우유 바다네요. 차가 우유에 빠졌어요.'],
  },
  steep: STEEP,
};

export async function nightFour(ctx) {
  const { scene, ui, audio } = ctx;
  ui.notebook('taeo-1');
  const asked = new Set();
  scene.state.weather = 'rain';
  audio.weather?.('rain');

  await scene.fadeTo(0, 1200);
  await ui.say('', '새벽 두 시. 오늘도 비가 온다.');
  await ui.say('', '하린은 오지 않았다. 잘 자고 있다는 뜻이다. 다행이다. 조금 심심하지만.');
  scene.catDo?.('blink');
  await ui.say('', '고양이가 창가에서 빗줄기를 세고 있다.');
  audio.sfx('bell');
  await ui.say('', '딸랑— 문에 달린 종이 울렸다.');
  scene.setFace('normal');
  await scene.enterGuest('taeo');
  ui.stand?.('taeo', 'normal');                           // ★ 첫 등장
  await ui.say('', '키가 크고 단정한 얼굴의 남자. 젖은 것처럼 보였는데, 젖지 않았다. 지쳐 보이는 건 진짜였다.');
  await ui.say(TAEO, '아, 실례합니다. …여기 영업하는 데 맞아요? 새벽 두 시에?');
  await ui.say(ME, '새벽 두 시에만 해요.');
  await ui.say(TAEO, '잘됐네요. 저도 요즘 새벽 두 시에만 깨어 있거든요.');
  ui.unstand?.('taeo');
  await ui.say(ME, '차 한 잔 드릴게요.');
  await ui.say(TAEO, '술 아니고요?');
  await ui.say(ME, '찻집이라서요.');
  await ui.say(TAEO, '…그쪽이 낫겠네요. 술 마시면 연락할 것 같아서.');
  await ui.say(TAEO, '헤어졌어요. 오늘. …아니, 어제구나. 열두 시 넘었으니까.');
  await ui.say(TAEO, '3년 만났는데, 끝나는 건 십 분이면 되더라고요.');
  await ui.say(ME, '…차는 십 분보다 오래 마셔도 돼요.');
  await ui.say(TAEO, '하하. 그거 좋네요.');
  await ui.say(TAEO, '마시고 싶은 거요? …있어요. 처음 만난 날 걔가 시켜 준 거. 저는 그때 커피밖에 몰랐거든요.');
  await ui.say('', '손님이 기억하는 그 맛을 찾아 주자. 이야기를 나누면 단서가 모인다.');

  await askLoop(ui, TAEO, T_QUESTIONS, asked);
  await brewLoop(ctx, {
    guest: TAEO, recipe: TAEO_RECIPE, lines: TAEO_LINES, questions: T_QUESTIONS, asked,
    afterMiss: async (brew, tries) => {
      if (tries === 2 && brew.base !== 'black') {
        scene.catDo?.('tail');
        await ui.say('', '고양이가 홍차 통 옆에 앉아 꼬리를 탁, 탁 친다. 오늘 힌트는 그쪽이구나.');
      } else if (tries >= 4 && !brew.additions.includes('milk')) {
        scene.catDo?.('paw');
        await ui.say('', '고양이가 우유병을 앞발로 톡톡 친다. 너 그거 마시고 싶은 거 아니지?');
      }
    },
  });

  audio.sfx('success');
  scene.emit('spark', 101, 84, 24);
  scene.setFace('teary');
  ui.stand?.('taeo', 'teary');                            // ★ 절정
  await ui.say(TAEO, TAEO_LINES.perfect);
  ui.unstand?.('taeo');
  await memory(scene, audio, 'taeo-1', async () => {
    await ui.say('', '6월, 장마 첫날. 골목 끝 작은 카페.');
    await ui.say('', '창가 2인석. 머그 두 잔에서 김이 올라왔다.');
    await ui.say('그 사람', '이거 마셔 봐. 겨울 냄새 나.');
    await ui.say(TAEO, '지금 6월인데.');
    await ui.say('그 사람', '그러니까. 6월에 겨울 냄새 나면 좋잖아.');
    await ui.say('', '비가 그칠 때까지, 우리는 두 잔을 아주 천천히 마셨다.');
    await ui.say('', '비는 그날 밤까지 그치지 않았다. 아무도 불평하지 않았다.');
  });
  await ui.say(TAEO, '…좋았네요. 그때.');
  await ui.say(TAEO, '오늘 내내 \'3년 버렸다\'고 생각했거든요.');
  await ui.say(TAEO, '근데 헤어졌다고 그게 없던 일이 되는 건 아니잖아요.');
  await ui.say(ME, '네. 진짜 있었던 일이에요.');
  scene.setFace('smile');
  await ui.say(TAEO, '…안 버렸네. 다 마셨네.');
  // 받아들인 다음에야 위로한다 (틀 안, 이별 얘기 한가운데는 금지, bible 1-9)
  scene.catDo?.('stretch');
  await ui.say('', '고양이가 카운터 끝에서 태오 쪽으로 몸을 쭉 늘인다. 배를 다 보이는 각도다.');
  await ui.say('', '…위로하는 방식이 좀 독특하다.');
  await ui.say(TAEO, '하하. 그 카페에도 고양이 있었어요. …아니다, 없었다. 방금 지어냈어요.');
  await ui.say(TAEO, '사장님, 이거 메뉴에 있어요?');
  await ui.say(ME, '오늘부터 생겼어요.');
  await ui.say(TAEO, '이름은요?');
  await ui.say(ME, '\'6월의 겨울\'?');
  await ui.say(TAEO, '…좀 오글거리는데. 좋네요.');
  ui.stand?.('taeo', 'sleepy');                           // ★ 잠들기 직전
  await ui.say(TAEO, '고마워요. 오늘은… 연락 안 하고 잘 수 있을 것 같아요.');
  ui.unstand?.('taeo');
  fallAsleep(scene, audio);
  await ui.say('', '태오는 빈 잔을 두 손으로 감싼 채 잠들었다. 바닥까지 비어 있었다.');
  await guestLeaves(scene, audio);
  await ui.say('', '태오가 앉아 있던 자리에, 무언가 반짝이는 게 남아 있다.');
  ui.show(null);
  await ui.item('영수증 한 장', '시나몬 밀크티 × 2\n─────\n(뒷면, 익숙한 글씨로)\n고마웠어. 진짜로.', 'receipt');
  await ui.say('', '첫 데이트 영수증. 그 사람이 3년 동안 갖고 있다가, 마지막 날 돌려준 것.');
  await ui.say('', '…나도 누군가에게, 고마웠다는 말을 들은 적이 있을까.');
  await ui.say('', '빗소리가 조금 가늘어졌다.');
  ui.end();
}

/** 사장 자기 모습 한 줄 — 모은 꿈 조각 수만큼 조금씩 또렷해진다 (bible 1-3). 이름·사고는 말하지 않는다 */
function selfLine(progress, lines) {
  const n = progress?.items?.length ?? 0;
  let pick = lines[0][1];
  for (const [min, text] of lines) if (n >= min) pick = text;
  return pick;
}

// ── 밤 5: 다희 ① — 아무것도 안 넣은 맛 (docs/story/dahui-1.md) ──

const J_QUESTIONS = [
  {
    id: 'taste', label: '어떤 맛이었어요?',
    answer: '구수했어요. 달지도 않고, 아무 향도 없고. 근데 이상하게 맛있었어요. 아무 맛도 안 나는데 맛있는 거, 그런 거 있잖아요.',
    clue: '구수함. 달지 않음. 다른 향 없음.',
  },
  {
    id: 'cold', label: '따뜻했어요, 차가웠어요?',
    answer: '냉장고에서 막 꺼낸 거요. 이가 시려서 한 번에 못 마셨어요. 마루에 엎드려서 컵에 맺힌 물방울 세다가 낮잠 자고.',
    clue: '냉장고에서 막 꺼냄. 이가 시림.',
  },
  {
    id: 'color', label: '무슨 색이었어요?',
    answer: '맑은 갈색이요. 유리병 너머로 햇빛 비치면 호박색이 됐어요. 뽀얗거나 탁하진 않았어요.',
    clue: '맑은 갈색 (호박색). 탁하지 않음.',
  },
  {
    id: 'grandma', label: '할머니가 뭘 넣으셨어요?',
    answer: '제가 설탕 넣어 달라고 하면 할머니가 그랬어요. "보리가 서운해한다." …그게 무슨 뜻인지 그땐 몰랐어요.',
    clue: '할머니: "보리가 서운해한다." (설탕 거절)',
  },
];

export const DAHUI_LINES = {
  perfect: '…이거예요. 아무것도 안 넣은 맛.',
  temp: '따뜻하네요. 근데 그건 이가 시릴 만큼 차가웠어요.',
  empty: '…이거예요. 아무것도 안 넣은 맛.',
  base: {
    water: '시원한데… 그냥 물이네요. 구수한 게 있었어요.',
    green: '풋풋하네요. 근데 풀 냄새보다는… 볶은 냄새였어요. 구수한 거.',
    black: '진하고 떫어요. 그건 훨씬 순했어요. 구수하고.',
    default: '음… 더 구수했어요.',
  },
  missing: {},
  mixup: {},
  // 이 밤의 핵심 — 넣으면 넣을수록 "아무것도 안 넣었어요" 쪽으로
  extra: {
    honey: '달아요. 할머니가 보셨으면 "보리가 서운해한다" 하셨을 거예요. 그건 아무것도 안 넣었어요.',
    cinnamon: '향이 좋네요. 근데 그 병엔 보리 냄새만 났어요. 아무것도 안 넣은 거.',
    ginger: '알싸해요. 감기약 같아요. 그건 그냥… 보리뿐이었어요.',
    lemon: '새콤해요! 병동 비타민 음료 생각나네. 그건 아무것도 안 넣었어요.',
    yuja: '달고 향긋한데… 이건 너무 꾸몄어요. 할머니 건 맨얼굴이었어요.',
    milk: '고소한데 뽀얘졌어요. 그건 맑았어요. 아무것도 안 넣어서.',
    chamomile: '꽃 냄새네요. 그 병엔 꽃도, 꿀도, 아무것도 없었어요.',
    mint: '화해요. 그 집 마루는 선풍기 하나로 충분했어요. 아무것도 안 넣고.',
  },
  extraDefault: '뭐가 들어갔네요. 그건 아무것도 안 넣었어요.',
  pour: {
    perfect: ['딱이네요. 병동 약컵보다 정확해요.', '딱이에요.'],
    good: ['좋아요. 적당해요.', '이 정도면 좋아요.'],
    under: ['반 잔이네요. 저 반 잔 체질 아니에요.', '조금만 더요.'],
    over: ['앗, 넘쳤다. 괜찮아요. 닦는 건 제가 전문이에요.', '또 넘쳤네요. 오늘 다들 바쁘네요, 손이.'],
  },
  ice: {
    perfect: ['얼음 딱. 컵에 금방 물방울이 맺혀요. 그거예요.', '딱 시원해요.'],
    good: ['시원해요. 이 정도면 좋아요.', '좋아요, 차가워요.'],
    under: ['얼음이 좀 적네요. 할머니 건 이가 시렸어요.', '아직 미지근해요. 한두 개만 더요.'],
    over: ['앗, 넘쳤다! 괜찮아요. 엎지르는 건 병동에서 매일 봐요.', '또 넘쳤어요. 얼음이 저보다 신났네.'],
  },
  steep: STEEP,
};

export async function nightFive(ctx) {
  const { scene, ui, audio, progress } = ctx;
  ui.notebook('dahui-1');
  const asked = new Set();
  let basket = 0;   // 재료 바구니 힌트를 몇 번 줬나

  await scene.fadeTo(0, 1200);
  await ui.say('', '새벽 두 시. 오늘은 비가 오지 않는다. 창밖이 맑고, 별이 몇 개 보인다.');
  await ui.say('', selfLine(progress, [
    [0, '창에 비친 내 모습은 오늘도 흐릿하다.'],
    [3, '창에 비친 내 얼굴. 눈 밑이 조금 어둡다. 나도 꽤 오래, 밤에 깨어 있던 사람 같다.'],
  ]));
  scene.catDo?.('groom');
  await ui.say('', '고양이는 맑은 날이 시시한지 세수만 하고 있다.');
  audio.sfx('bell');
  await ui.say('', '딸랑— 문에 달린 종이 울렸다.');
  scene.setFace('normal');
  await scene.enterGuest('dahui');
  ui.stand?.('dahui', 'normal');                       // ★ 첫 등장
  await ui.say('', '머리를 질끈 묶고 운동화를 신은 여자. 걸음이 빠르다. 들어오자마자 시계부터 본다.');
  await ui.say(DAHUI, '어, 여기 열려 있네요? 두 시에?');
  await ui.say(ME, '두 시에만 열어요.');
  await ui.say(DAHUI, '와, 딱 제 시간이다. 저 이 시간엔 원래 일하거든요. 간호사예요, 밤 근무.');
  ui.unstand?.('dahui');
  await ui.say(DAHUI, '오늘은 쉬는 날인데, 몸이 아직 출근해 있어요. 낮엔 못 자고, 밤엔 눈이 말똥말똥하고.');
  await ui.say(ME, '그럼 출근한 몸한테 차 한 잔 드릴게요.');
  await ui.say(DAHUI, '하하. 퇴근시켜 주세요, 제발.');
  await ui.say(DAHUI, '이 시간이면 병동 한 바퀴 돌 때예요. 링거 보고, 자는 분들 숨소리 듣고.');
  await ui.say(DAHUI, '몇 달째 안 깨어나시는 분한테도 "좋은 아침이에요" 하고요. 대답은 없는데, 그냥 버릇이 됐어요.');
  await ui.say(DAHUI, '아무튼! 쉬는 날에 병원 얘기 금지. 제가 정했어요, 방금.');
  await ui.say(DAHUI, '마시고 싶은 거요? 음… 여름방학마다 할머니 댁 냉장고에 있던 거요. 그거 마시면 낮잠이 쏟아졌거든요.');
  await ui.say('', '손님이 기억하는 그 맛을 찾아 주자. 이야기를 나누면 단서가 모인다.');

  await askLoop(ui, DAHUI, J_QUESTIONS, asked);
  await brewLoop(ctx, {
    guest: DAHUI, recipe: DAHUI_RECIPE, lines: DAHUI_LINES, questions: J_QUESTIONS, asked,
    afterMiss: async (brew, tries) => {
      if (tries >= 2 && brew.additions.length) {
        // "빼기" 힌트 — 넣을 것 바구니 위에 드러눕는다 (블렌딩 판 🐾 는 넣을 게 없으니 고양이가 맡는다)
        scene.catDo?.('loaf');
        await ui.say('', basket++ === 0
          ? '고양이가 재료 바구니 위에 철퍼덕 엎드린다. 비키라고 해도 안 비킨다. …오늘은 넣지 말라는 건가.'
          : '고양이가 또 재료 바구니를 깔고 앉았다. 알았어, 알았어.');
      } else if (tries === 2 && brew.base !== 'barley') {
        scene.catDo?.('tail');
        await ui.say('', '고양이가 보리차 통에 등을 대고 누워 꼬리를 탁, 탁 친다. 구수한 쪽이구나.');
      }
    },
  });

  audio.sfx('success');
  scene.emit('spark', 101, 84, 24);
  scene.setFace('teary');
  ui.stand?.('dahui', 'teary');                        // ★ 절정
  await ui.say(DAHUI, DAHUI_LINES.perfect);
  ui.unstand?.('dahui');
  await memory(scene, audio, 'dahui-1', async () => {
    await ui.say('', '여름방학. 시골 할머니 댁. 매미가 쉬지 않고 울었다.');
    await ui.say('', '냉장고 맨 아래 칸, 뚜껑에 금이 간 유리병. 고무줄로 칭칭 감아 두었다.');
    await ui.say(DAHUI, '할머니, 설탕!');
    await ui.say('할머니', '안 돼. 보리가 서운해한다.');
    await ui.say(DAHUI, '보리가 왜 서운해?');
    await ui.say('할머니', '보리가 혼자 다 했는데, 설탕이 와서 생색내면 서운하지.');
    await ui.say('', '컵에 맺힌 물방울을 세다가, 마루에서 잠이 들었다. 깨어 보면 이마에 할머니 부채 바람이 와 있었다.');
  });
  scene.setFace('smile');
  await ui.say(DAHUI, '…그래서 아무것도 안 넣은 거였구나. 보리가 혼자 다 해서.');
  await ui.say(DAHUI, '저 요즘 뭘 자꾸 넣었어요. 커피, 에너지 음료, 야식, 걱정.');
  await ui.say(DAHUI, '쉬는 날에도 뭐라도 해야 될 것 같아서, 하나도 안 쉬었어요.');
  await ui.say(ME, '오늘은 아무것도 안 넣은 밤으로 하죠.');
  await ui.say(DAHUI, '아무것도 안 넣은 밤. …그거 좋네요. 보리가 안 서운하게.');
  scene.catDo?.('purr');
  await ui.say('', '고양이가 골골거린다. 고양이는 원래 아무것도 안 하는 걸 제일 잘한다.');
  await ui.say(DAHUI, '여기 또 와도 돼요? 쉬는 날마다 몸이 출근할 텐데.');
  await ui.say(ME, '두 시에만 열어요.');
  ui.stand?.('dahui', 'sleepy');                       // ★ 잠들기 직전
  await ui.say(DAHUI, '딱 제 시간이네요. …오늘은 출근 안 하고, 퇴근할게요.');
  ui.unstand?.('dahui');
  fallAsleep(scene, audio, 'asleep-smile');
  await ui.say('', '다희는 컵의 물방울을 세다가, 셋도 못 세고 잠들었다.');
  await guestLeaves(scene, audio);
  await ui.say('', '다희가 앉아 있던 자리에, 무언가 반짝이는 게 남아 있다.');
  ui.show(null);
  await ui.item('할머니의 물병', '뚜껑에 금 간 유리병.\n고무줄로 칭칭 감겨 있다.\n바닥에 매직으로:\n「보리차 — 손대지 마라 (다희 빼고)」', 'bottle');
  await ui.say('', '할머니가 여름마다 채워 두던 병. 다희는 아직 그 병을 버리지 못했다. 가끔 꽃을 꽂아 둔다.');
  await ui.say('', '…아무것도 안 넣은 맛. 나도 그런 걸 좋아했던 것 같다.');
  ui.end();
}

// ── 밤 6: 수경 — 꽃 우유 (docs/story/sukyung.md) ─────────────
// 단서는 수경이 아니라 수경 첫째(5살) 얘기 속에 섞여 나온다 (bible 3장).

const S_QUESTIONS = [
  {
    id: 'taste', label: '어떤 맛이었어요?',
    answer: '그게 기억이… 아, 우리 첫째가요, 우유에 꿀 타 주면 "엄마 이거 꽃 맛 나" 그래요. 꽃 맛이 뭔지. 근데 그 말 듣고 생각났어요. 아빠 건 진짜로 꽃 냄새가 났어요.',
    clue: '우유 + 꿀. 그리고 진짜 꽃 냄새 (첫째: "꽃 맛").',
  },
  {
    id: 'flower', label: '무슨 꽃이었어요?',
    answer: '우리 애가 그림책 보다가 "사과 냄새 나는 꽃이 있대!" 하는 거예요. 노란 가운데에 하얀 꽃잎. 저 그거 보고 소리 질렀잖아요. 그거다! 애가 놀라서 울고. 하하.',
    clue: '사과 냄새 나는 꽃. 노란 가운데, 흰 꽃잎.',
  },
  {
    id: 'water', label: '무엇으로 끓였어요?',
    answer: '아빠가 냄비에 맹물을 끓여서 꽃을 우렸어요. 그다음에 우유. 찻잎은 없었어요. 우리 애는 차를 "쓴 물"이라고 부르거든요. 쓴 물 아니었어요, 그건.',
    clue: '맹물에 꽃을 우림. 찻잎(쓴 물) 없음.',
  },
  {
    id: 'when', label: '언제 마셨어요?',
    answer: '잠 안 오는 밤이요. 뜨거워서 후후 불면서 마셨어요. 우리 애도 후후 진짜 잘 불어요. 생일 촛불을 남의 것까지 다 꺼요.',
    clue: '잠 안 오는 밤. 뜨거워서 후후 붊.',
  },
];

export const SUKYUNG_LINES = {
  perfect: '…이거다. 아빠 꽃 우유.',
  temp: '차갑네요. 아빠 건 후후 불어야 했어요. …우리 애는 아이스크림도 후후 불지만.',
  empty: '그냥 따뜻한 물이네요. …솔직히 이것도 지금 너무 좋아요. 근데 그건 뽀얗고, 달고, 꽃 냄새가 났어요.',
  base: {
    barley: '구수한데… 보리 냄새가 꽃 냄새를 덮어요. 그냥 맹물이었어요.',
    green: '쓴 물이네요. 우리 애 말로. 찻잎은 없었어요.',
    black: '쓴 물이에요, 이건. 진한 쓴 물. 맹물이었어요.',
    default: '음… 그냥 맹물이었어요.',
  },
  missing: {
    milk: '꽃 향은 있는데, 뽀얗지가 않아요. 우유였어요.',
    honey: '고소하고 꽃 냄새도 나는데… 안 달아요. 우리 애가 "꽃 맛" 할 때 그 단맛이 없어요.',
    chamomile: '우유랑 꿀… 맛있어요. 근데 꽃 냄새가 없어요. 사과 냄새 나는 꽃.',
  },
  mixup: {
    chamomile: { mint: '화해요! 이건 치약 맛이에요… 꽃이었어요, 사과 냄새 나는.' },
    honey: { yuja: '달긴 한데 새콤해요. 그냥 꿀이었어요.' },
  },
  extra: {
    lemon: '어, 우유가 몽글몽글해졌어요. 이건… 이건 아니에요.',
    cinnamon: '향이 세요. 꽃 냄새가 숨었어요.',
    ginger: '맵다! 아빠 건 순했어요. 애가 마셔도 될 만큼.',
    mint: '화해요. 꽃이랑 우유랑 꿀이면 충분했어요.',
    yuja: '새콤한 건 없었어요.',
  },
  extraDefault: '이건 안 들어갔던 것 같아요.',
  pour: {
    perfect: ['딱이에요. 저 젖병 눈금 보는 사람인데, 인정.', '딱이네요.'],
    good: ['좋아요. 적당해요.', '이 정도면 충분해요.'],
    under: ['반 잔이네요. 저 오늘 반 잔으로 버틸 체력 없어요.', '조금만 더 주세요.'],
    over: ['넘쳤다! 괜찮아요. 우리 집은 매일 뭐가 넘쳐요. 우유, 국, 빨래.', '또 넘쳤네요. 익숙해요, 이런 거.'],
  },
  milk: {
    perfect: ['우유 딱. 뽀얗게… 아빠 냄비 색이에요.', '딱 그 색이에요.'],
    good: ['좋아요. 아빠는 조금 더 부었던 것 같지만.', '이 정도면 좋아요.'],
    under: ['우유가 좀 적어요. 아직 맑아요. 그건 더 뽀얬어요.', '조금만 더요. 뽀얗게.'],
    over: ['우유가 너무 많아요. 꽃이 어디 갔지… 우유 속에서 길을 잃었나 봐요.', '또 우유 바다네요. 꽃이 수영해요.'],
  },
  steep: STEEP,
};

export async function nightSix(ctx) {
  const { scene, ui, audio, progress } = ctx;
  ui.notebook('sukyung-1');
  const asked = new Set();

  await scene.fadeTo(0, 1200);
  await ui.say('', '새벽 두 시. 오늘도 맑다. 바람이 조금 있다.');
  await ui.say('', selfLine(progress, [
    [0, '주전자를 드는 내 손이 오늘은 조금 또렷하다.'],
    [4, '주전자를 드는 내 손. 손가락 옆에 작은 화상 자국이 있다. 주전자에 덴 자국이다. …언제였더라.'],
  ]));
  scene.catDo?.('ear');
  await ui.say('', '고양이가 귀를 쫑긋 세운다. 문밖에서 하품 소리가 났다. 고양이보다 큰 하품이었다.');
  audio.sfx('bell');
  await ui.say('', '딸랑— 문에 달린 종이 울렸다.');
  scene.setFace('normal');
  await scene.enterGuest('sukyung');
  ui.stand?.('sukyung', 'normal');                        // ★ 첫 등장
  await ui.say('', '부드러운 인상의 여자. 니트 어깨에 하얀 얼룩이 있다. …분유다. 아마도.');
  await ui.say(SUKYUNG, '아, 죄송해요. 문 열려 있길래… 여기 앉아도 돼요? 아무도 안 깨우는 데면 어디든 좋아요.');
  await ui.say(ME, '여기선 아무도 안 깨워요.');
  await ui.say(SUKYUNG, '와… 그 말 너무 좋다. 녹음해 가고 싶다.');
  ui.unstand?.('sukyung');
  await ui.say(SUKYUNG, '애가 둘이에요. 둘째가 두 시간마다 깨서 먹고, 첫째는 다섯 살인데 아직도 새벽에 제 이불로 와요.');
  await ui.say(SUKYUNG, '내일은 출근이고요. 너무 피곤한데, 피곤해서 오히려 잠이 안 와요. 이상하죠.');
  await ui.say(ME, '이상하지 않아요. 여기 오는 분들 다 그래요.');
  await ui.say(SUKYUNG, '다행이다. 저만 이상한 줄.');
  await ui.say(SUKYUNG, '마시고 싶은 거요? …어릴 때 잠 안 오면 아빠가 데워 준 거요. 꽃 우유라고 불렀어요. 근데 맛이 잘 기억이 안 나요. 요즘은 다 애들 얘기로만 기억해서.');
  await ui.say('', '손님이 기억하는 그 맛을 찾아 주자. 이야기를 나누면 단서가 모인다.');
  await ui.say('', '…단서는 이 손님보다, 이 손님의 아이 얘기 속에 있는 것 같다.');

  await askLoop(ui, SUKYUNG, S_QUESTIONS, asked);
  await brewLoop(ctx, {
    guest: SUKYUNG, recipe: SUKYUNG_RECIPE, lines: SUKYUNG_LINES, questions: S_QUESTIONS, asked,
    afterMiss: async (brew, tries) => {
      if (tries === 2 && brew.base !== 'water') {
        scene.catDo?.('tail');
        await ui.say('', '고양이가 맹물 주전자 옆에 앉아 꼬리를 탁, 탁 친다. 찻잎은 빼라는 거니?');
      } else if (tries >= 2 && !brew.additions.includes('chamomile')) {
        scene.catDo?.('sneeze');
        await ui.say('', '고양이가 캐모마일 통에 코를 박고 킁킁대다가 재채기를 한다. 사과 냄새가 났나 보다.');
      }
    },
  });

  audio.sfx('success');
  scene.emit('spark', 101, 84, 24);
  scene.setFace('teary');
  ui.stand?.('sukyung', 'teary');                         // ★ 절정
  await ui.say(SUKYUNG, SUKYUNG_LINES.perfect);
  ui.unstand?.('sukyung');
  await memory(scene, audio, 'sukyung-1', async () => {
    await ui.say('', '아주 어릴 때. 불 꺼진 부엌에, 가스 불만 파랗게 켜져 있었다.');
    await ui.say('', '작은 냄비 안에서 하얀 꽃이 동동 떠다녔다.');
    await ui.say('아빠', '꽃 우유야. 꽃이 잠을 데리고 온대.');
    await ui.say(SUKYUNG, '진짜?');
    await ui.say('아빠', '진짜. 아빠도 잠 안 와서 끓이는 거야. 반은 아빠 거.');
    await ui.say('', '아빠는 늘 내 잔을 먼저 채웠다. 아빠 잔에는 꽃이 하나도 안 남았다.');
  });
  await ui.say(SUKYUNG, '…아빠도 그때, 저 키우느라 잠 못 잤겠네요.');
  await ui.say(SUKYUNG, '저 매일 밤 애들 재우기만 했지, 누가 저를 재워 준 건… 진짜 오랜만이에요.');
  await ui.say(ME, '오늘은 재워 드릴게요.');
  scene.setFace('smile');
  await ui.say(SUKYUNG, '근데 저 이거 마시고 푹 자면, 둘째 깨면 어떡하죠?');
  await ui.say(ME, '오늘 당번은요?');
  await ui.say(SUKYUNG, '…아. 남편이다. 오늘 남편 당번이다!');
  await ui.say(SUKYUNG, '하하. 세상에. 저 당번 아닌 날에도 안 자고 있었어요.');
  scene.catDo?.('loaf');
  await ui.say('', '고양이가 수경 옆에서 식빵 자세로 몸을 만다. 잘 자는 법 시범이다.');
  ui.stand?.('sukyung', 'sleepy');                        // ★ 잠들기 직전
  await ui.say(SUKYUNG, '내일 애들한테 꽃 우유 해 줄래요. …아니다, 내일은 남편한테 해 달라고 할래요.');
  ui.unstand?.('sukyung');
  fallAsleep(scene, audio, 'asleep-smile');
  await ui.say('', '수경은 잔을 내려놓고, 엎드린 지 삼 초 만에 잠들었다. 프로의 솜씨였다.');
  await guestLeaves(scene, audio);
  await ui.say('', '수경이 앉아 있던 자리에, 무언가 반짝이는 게 남아 있다.');
  ui.show(null);
  await ui.item('첫째의 그림', '크레용 그림.\n침대에 누운 길쭉한 사람,\n이불 위에 하트가 열 개쯤.\n아래에 삐뚤빼뚤:\n「엄마 자는 거. 쉿」', 'drawing');
  await ui.say('', '엄마가 자는 걸 본 날이 드물어서, 볼 때 얼른 그렸을 것이다.');
  await ui.say('', '…누군가 내 곁에서, 내가 자는 걸 지켜본 적이 있을까.');
  ui.end();
}

export const NIGHTS = [nightOne, nightTwo, nightThree, nightFour, nightFive, nightSix];
