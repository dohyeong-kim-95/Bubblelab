// 문자열로 그린 픽셀 스프라이트. 한 글자 = 한 픽셀, '.' = 투명.
// 줄 길이가 모두 같아야 한다 (tests/sprites.test.mjs 가 확인).

export const PALETTE = {
  k: '#2a1e24', // 외곽선
  // 하린 색은 확정 디자인(game/art/standing/harin-normal.png)에서 뽑았다
  h: '#36242a', // 하린 머리 (흑갈색)
  H: '#6d443e', // 머리 하이라이트 (따뜻한 갈색 윤기)
  s: '#eab398', // 피부
  S: '#c98a74', // 피부 그늘
  e: '#472d2d', // 눈 (갈색)
  c: '#e48c7c', // 볼
  m: '#b0605e', // 입
  w: '#848ba3', // 후드티 (회청색)
  W: '#616583', // 후드티 그늘
  // 고양이 색은 확정 그림(game/art/standing/cat-normal.webp): 생강빛 털, 진한 주황 고등어 줄무늬, 크림 앞발·턱, 연두 눈
  O: '#eaa66c', // 고양이
  o: '#c26a3a', // 고양이 줄무늬
  p: '#f0a0a8', // 고양이 코
  '-': '#2a1e24', // 감은 눈
  A: '#b38a72', // 엄마 카디건 (모카)
  P: '#ece0d0', // 앞치마·이너 (아이보리)
  M: '#5c3c30', // 엄마 머리 (갈색)
  N: '#7e5644', // 엄마 머리 윤기
  a: '#8c6856', // 카디건 그늘
  D: '#5a4038', // 엄마 치마 (짙은 갈색)
  L: '#4e3a40', // 엄마 스타킹
  F: '#d98a7a', // 엄마 실내화
  i: '#ffffff', // 눈 반짝임
  T: '#bfe2ff', // 눈물
  B: '#8a5e40', // 나무 의자
  q: '#f4ead2', // 편지지
  Q: '#d8c6a2', // 편지지 그늘
  r: '#9a6a5a', // 손글씨
  u: '#ece0cc', // 머그잔
  U: '#b8a68a', // 머그잔 그늘
  v: '#c8805a', // 머그잔 띠 (계피색)
  j: '#a8b848', // 고양이 눈동자 (연두)
  Z: '#1b1420', // 사장 실루엣 (역광)
  y: '#6a4634', // 실루엣 테두리 빛 (약하게)
  Y: '#f0a860', // 실루엣 테두리 빛 (강하게, 램프)
  G: '#2c2a3c', // 사장 셔츠 (아주 어둡게)
  R: '#3c2c26', // 사장 앞치마 (아주 어둡게)
  g: '#5a4234', // 앞치마 바느질선
  b: '#d8d0c4', // 찻주전자
  x: '#a99f94', // 찻주전자 그늘
  z: '#e3b7a0', // 찻주전자 무늬
  n: '#f6e4cc', // 고양이 흰 털 (턱·가슴·앞발)
  // 태오 (D-020)
  K: '#221e28', // 태오 머리 (거의 검정)
  J: '#46425a', // 태오 머리 윤기 (젖어서 푸르스름)
  V: '#2c3552', // 어두운 남색 코트
  X: '#1d2338', // 코트 그늘
  I: '#e6e4ea', // 흰 셔츠
  E: '#8a3a46', // 느슨한 넥타이 (와인색)
  t: '#d98a52', // 고양이 털 그늘
  // 차 종류별 미니게임 (bakeBrewSprites)
  1: '#e2f3f6d9', // 얼음 (살짝 비침)
  2: '#a8ccd4', // 얼음 그늘
  3: '#a9c3c8', // 유리 테두리
  4: '#cfe6ea24', // 유리 안쪽 (거의 투명)
  5: '#3e2c1e', // 찻잎 (말린 것)
  6: '#6e6634', // 찻잎 (펴진 것)
  7: '#94904c', // 찻잎 밝은 면
  8: '#8f877c', // 거름망 철망
  9: '#ffffff55', // 유리 반사 (반투명)
  // 고양이 선물 아이콘
  l: '#4f9a5a', // 사이다 병뚜껑 초록 · 카페 명찰 띠
  '+': '#c9ccc8', // 양철 (은색)
  '*': '#8d918e', // 양철 그늘
  '~': '#a7a8b4', // 비둘기 깃털
  '^': '#6e6f80', // 깃털 심
  d: '#e8c04a', // 은행잎
  f: '#b88a2c', // 은행잎 그늘
  '=': '#c4483e', // 빨간 줄무늬
  // 다희 (밤 5): 단정히 묶은 검은 머리(K·J) + 오트밀 카디건, 안에 민트 근무복
  '!': '#dcc8a8', // 카디건 (오트밀)
  '|': '#b39c80', // 카디건 그늘
  0: '#8cc4b2', // 근무복 (민트)
  // 수경 (밤 6): 헝클어진 갈색 똥머리 + 잠옷(분홍 체크) 위 라벤더 가디건
  '&': '#5e3e30', // 수경 머리
  '%': '#8e5e46', // 머리 윤기
  '@': '#ecbcc4', // 잠옷 (분홍)
  '#': '#c8939e', // 잠옷 체크
  $: '#aaa0c4', // 가디건 (라벤더 회색)
  '?': '#857ba2', // 가디건 그늘
  // 꿈 조각: 크레용
  ':': '#e0a83a', // 크레용 노랑
  ';': '#5a8ad0', // 크레용 파랑
};

// 어깨에 닿는 흑갈색 단발(앞머리 사이로 이마가 살짝, 끝이 바깥으로 뻗침), 회청색 후드티 + 밝은 끈.
// 눈(7줄 x4-5·x10-11)·볼(8줄)·입(9줄 x8-9) 자리는 표정 패치가 쓰므로 옮기지 않는다.
export const HARIN = [
  '....kkkkkkkk....',
  '..kkhhhhhhhhkk..',
  '.khhhhhhHHHhhhk.',
  '.khHHhhhhhhHHhk.',
  'khHhhhhhhhhhhHhk',
  'khhhshhhhshhhhhk',
  'khhssssssssssshk',
  'khsseesssseesshk',
  'kHsscsssssscsshk',
  'khhsssssmmsssHhk',
  'kHhhssssssssshhk',
  'khhhkSSSSSSkhhhk',
  'kHhk..kssk..khHk',
  '.kk.kWwwwwWk.kk.',
  '.kwwWwqwwqwWwwk.',
  'kwwwwwqwwqwwwwwk',
  'kwwwwwqwwqwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwWwwwwwwwwWwwk',
];

/** rows 의 일부 픽셀만 바꾼 새 스프라이트. edits = [[y, x, '글자들'], ...] */
export function patch(rows, edits) {
  const out = rows.map((r) => [...r]);
  for (const [y, x, chs] of edits) [...chs].forEach((ch, i) => { out[y][x + i] = ch; });
  return out.map((r) => r.join(''));
}

// ── 하린 표정 (얼굴만 바꾸고 크기는 같다) ───────────────────────
// 눈: 7번 줄 x4-5, x10-11 / 볼: 8번 줄 x4, x11 / 입: 9번 줄 x8-9

// 웃음: 눈이 ^ ^ 로 휘고, 입꼬리가 올라가고, 볼이 더 붉다
export const HARIN_SMILE = patch(HARIN, [
  [6, 4, 'ee'], [6, 10, 'ee'],
  [7, 3, 'esse'], [7, 9, 'esse'],
  [8, 3, 'cc'], [8, 11, 'cc'],
  [9, 7, 'mmmm'], [10, 8, 'mm'],
]);

// 울컥: 눈이 커지고 물기가 고인다(반짝임), 눈썹이 처지고 입술을 꾹 다문다
export const HARIN_TEARY = patch(HARIN, [
  [5, 4, 'h'], [5, 11, 'h'],               // 처진 눈썹 (안쪽 끝이 올라감)
  [6, 4, 'ee'], [6, 10, 'ee'],
  [7, 4, 'ei'], [7, 10, 'ie'],
  [8, 4, 'T'], [8, 11, 'T'],
  [9, 8, 'Sm'],
]);
// 울컥 반짝 프레임: 눈물 방울이 빛을 받는다 (scene 이 번갈아 그린다)
export const HARIN_TEARY_GLINT = patch(HARIN_TEARY, [
  [8, 4, 'i'], [8, 11, 'i'], [9, 4, 'T'], [9, 11, 'T'],
]);

// 잠든 하린: 눈을 감고 고개를 살짝 숙인다
export const HARIN_ASLEEP = patch(HARIN, [
  [7, 4, 'ss'], [7, 10, 'ss'],
  [8, 4, '--'], [8, 10, '--'],
]);

// 눈 깜빡임 (평소 표정에서 아주 가끔)
export const HARIN_BLINK = patch(HARIN, [[7, 4, '--'], [7, 10, '--']]);

// 웃으며 잠든 하린 (밤 3: 편하게 앉은 채로) — 고개를 숙이지 않고, 입꼬리가 올라가 있다
export const HARIN_ASLEEP_SMILE = patch(HARIN_ASLEEP, [[9, 7, 'msSm'], [10, 8, 'mm']]);

export const FACES = ['normal', 'smile', 'teary', 'asleep', 'asleep-smile'];

// ── 태오 (29세 회사원, 비 오는 밤에 온다) ────────────────────────────
// 단정한 짧은 머리 + 이마로 흘러내린 젖은 앞머리 두 가닥, 또렷한 눈썹·턱선, 어두운 남색 코트, 흰 셔츠, 풀어진 넥타이.
// 눈(7줄 x4-5·x10-11) 자리는 하린과 같다. 어깨와 머리에 빗방울(T).
export const TAEO = [
  '....kkkkkkkk....',
  '..kkKKKKKKKKkk..',
  '.kKKKKKJJKKKTKk.',
  '.kKKJJKKKKKKKKk.',
  'kKKKKKKKKKKKKKKk',
  'kKKssKssssKssKKk',
  'kKsKKssssssKKsKk',
  'kSsseesssseessSk',
  'kSssssssssssssSk',
  '.ksssssSSsssssk.',
  '..kSssssssssSk..',
  '...kkSSSSSSkk...',
  '......kssk......',
  '..kkVVkIIkVVkk..',
  '.kVTVkIEEIkVVVk.',
  'kVVVVXkEEkXVVTVk',
  'kVVVVVXEEXVVVVVk',
  'kVVVVVVXXVVVVVVk',
  'kVVVVVVVVVVVVVVk',
];
export const TAEO_BLINK = patch(TAEO, [[7, 4, '--'], [7, 10, '--']]);
// 웃음: 눈을 가늘게, 입꼬리를 살짝
export const TAEO_SMILE = patch(TAEO, [[7, 4, 'kk'], [7, 10, 'kk'], [8, 4, 'ee'], [8, 10, 'ee'], [9, 6, 'SmmS'], [8, 3, 'c'], [8, 12, 'c']]);
// 울컥: 눈썹 안쪽이 올라가고 눈에 물기, 입을 꾹
export const TAEO_TEARY = patch(TAEO, [[6, 3, 's'], [5, 4, 'K'], [6, 12, 's'], [5, 11, 'K'], [7, 4, 'ei'], [7, 10, 'ie'], [8, 4, 'T'], [8, 11, 'T'], [9, 7, 'kk']]);
export const TAEO_TEARY_GLINT = patch(TAEO_TEARY, [[8, 4, 'i'], [8, 11, 'i'], [9, 4, 'T'], [9, 11, 'T']]);
export const TAEO_ASLEEP = patch(TAEO, [[7, 4, 'ss'], [7, 10, 'ss'], [8, 4, '--'], [8, 10, '--'], [9, 7, 'S']]);
export const TAEO_ASLEEP_SMILE = patch(TAEO_ASLEEP, [[9, 6, 'SmmS']]);

// ── 표정 패치 (하린 얼굴 틀: 눈 7줄 x4-5·x10-11, 볼 8줄 x4·x11, 입 9줄 x8-9) ─────────────
const faceSet = (base, brow) => {
  const teary = patch(base, [[6, 4, brow[0]], [6, 10, brow[1]], [7, 4, 'ei'], [7, 10, 'ie'], [8, 4, 'T'], [8, 11, 'T'], [9, 8, 'Sm']]);
  const asleep = patch(base, [[7, 4, 'ss'], [7, 10, 'ss'], [8, 4, '--'], [8, 10, '--']]);
  return {
    normal: [base, patch(base, [[7, 4, '--'], [7, 10, '--']])],
    smile: [patch(base, [[6, 4, 'ee'], [6, 10, 'ee'], [7, 3, 'esse'], [7, 9, 'esse'], [8, 3, 'cc'], [8, 11, 'cc'], [9, 7, 'mmmm'], [10, 8, 'mm']])],
    teary: [teary, patch(teary, [[8, 4, 'i'], [8, 11, 'i'], [9, 4, 'T'], [9, 11, 'T']])],
    asleep: [asleep],
    'asleep-smile': [patch(asleep, [[9, 7, 'msSm'], [10, 8, 'mm']])],
  };
};

// ── 다희 (31, 신경과 병동 야간 간호사. 근무 끝나고 온 차림) ─────────────
// 뒤로 단정히 묶은 검은 머리(옆이 깔끔해 얼굴선이 드러난다, 오른쪽 뒤로 꽁지), 옆으로 넘긴 앞머리,
// 가지런한 눈썹, 오트밀 카디건 + 안에 민트 근무복 V넥. 피곤하지만 단정하다.
export const DAHUI = [
  '....kkkkkkkk....',
  '..kkKKKKKKKKkk..',
  '.kKKKKKJJKKKKKk.',
  '.kKJJKKKKKKKKKKk',
  'kKKKKKKKKKsssKKk',
  'kKKKKssssssssKKk',
  'kKKsSSssssSSssKk',
  'kKsseesssseessKk',
  'kKsscsssssscssKk',
  'kKKsssssmmsssKKk',
  '.kKKssssssssKKKk',
  '..kkkSSSSSSkkKKk',
  '......kssk...kKk',
  '.kk!!!k00k!!!kk.',
  'k!!!!!k00k!!!!!k',
  'k!!!!!|00|!!!!!k',
  'k!!!!!!|0|!!!!!k',
  'k|!!!!!!|!!!!!|k',
  'k|!!!!!!!!!!!!|k',
];
const DAHUI_FACES = faceSet(DAHUI, ['sS', 'Ss']);

// ── 수경 (38, 두 아이 엄마. 새벽 수유에 지쳤지만 다정하다) ─────────────
// 대충 틀어 올린 갈색 똥머리 + 삐져나온 잔머리, 흘러내린 옆머리, 분홍 체크 잠옷 위 라벤더 가디건.
export const SUKYUNG = [
  '.....kkkkkk..k..',
  '...kk&&%%&&kk.k.',
  '..k.k&&&&&&&kk..',
  '.kkk&&&%%&&&&kk.',
  'k&%&&&&&&&&&&%&k',
  'k&&&&ss&&ss&&&&k',
  'k&&ssSssssSsss&k',
  'k&sseesssseess&k',
  'k&sscsssssscss&k',
  'k&&sssssmmsss&&k',
  'k&&&ssssssss&&&k',
  '.k&&kSSSSSSk&&k.',
  '.k&k..kssk..k&k.',
  '.kk$$k@@@@k$$kk.',
  'k$$$$k@@@@k$$$$k',
  'k$$$$?@#@#?$$$$k',
  'k$$$$?#@#@?$$$$k',
  'k?$$$$?@@?$$$$?k',
  'k?$$$$?@@?$$$$?k',
];
const SUKYUNG_FACES = faceSet(SUKYUNG, ['sS', 'Ss']);
export const [DAHUI_BLINK, DAHUI_SMILE, DAHUI_TEARY, DAHUI_TEARY_GLINT, DAHUI_ASLEEP, DAHUI_ASLEEP_SMILE] = [
  DAHUI_FACES.normal[1], DAHUI_FACES.smile[0], ...DAHUI_FACES.teary, DAHUI_FACES.asleep[0], DAHUI_FACES['asleep-smile'][0]];
export const [SUKYUNG_BLINK, SUKYUNG_SMILE, SUKYUNG_TEARY, SUKYUNG_TEARY_GLINT, SUKYUNG_ASLEEP, SUKYUNG_ASLEEP_SMILE] = [
  SUKYUNG_FACES.normal[1], SUKYUNG_FACES.smile[0], ...SUKYUNG_FACES.teary, SUKYUNG_FACES.asleep[0], SUKYUNG_FACES['asleep-smile'][0]];

/** 손님 id → 표정 → [기본 프레임, 보조 프레임(깜빡임·눈물 반짝)]. 새 손님은 여기 한 줄 */
export const GUEST_FACES = {
  harin: {
    normal: [HARIN, HARIN_BLINK], smile: [HARIN_SMILE], teary: [HARIN_TEARY, HARIN_TEARY_GLINT],
    asleep: [HARIN_ASLEEP], 'asleep-smile': [HARIN_ASLEEP_SMILE],
  },
  taeo: {
    normal: [TAEO, TAEO_BLINK], smile: [TAEO_SMILE], teary: [TAEO_TEARY, TAEO_TEARY_GLINT],
    asleep: [TAEO_ASLEEP], 'asleep-smile': [TAEO_ASLEEP_SMILE],
  },
  dahui: DAHUI_FACES,
  sukyung: SUKYUNG_FACES,
};

export const CAT = [
  '.k..k.........',
  'kOkkOk........',
  'kOOOOOkkkkkk..',
  'kO-OO-OooOooOk',
  'kOOpOOOOOOOOOk',
  'kOOOOOoOOoOOOk',
  '.kkkkkkkkkkkkk',
];

// ── 고양이 동작 프레임 (바닥선을 맞춰 그린다. 꼬리는 scene 이 따로 그린다) ──
export const CAT_BLINK = patch(CAT, [[3, 2, 'o'], [3, 5, 'o']]);
// 귀 쫑긋: 오른쪽 귀가 납작해졌다 선다
export const CAT_EAR = patch(CAT, [[0, 4, '.'], [1, 4, 'kk']]);
// 골골: 눈을 지그시 감는다
export const CAT_PURR = patch(CAT, [[3, 2, 'o'], [3, 5, 'o'], [5, 6, 'O']]);
// 고개 들어 사장 쳐다보기 (머리가 두 칸 올라온다)
export const CAT_LOOK = [
  '.k..k.........',
  'kOkkOk........',
  'kOOOOOk.......',
  'kO-OO-Ok......',
  'kOOpOOOk......',
  'kOOOOOOkkkkkk.',
  'kOOOOOOooOooOk',
  'kOOOOOoOOoOOOk',
  '.kkkkkkkkkkkkk',
];
export const CAT_LOOK_BLINK = patch(CAT_LOOK, [[3, 2, 'o'], [3, 5, 'o']]);
// 식빵 자세: 앞발을 접어 넣고 동그랗게, 눈은 반쯤 감고 (꼬리는 몸에 감아 안 보인다)
export const CAT_LOAF = [
  '.k..k......',
  'kOkkOk.....',
  'kOOOOOkkkk.',
  'kOoOOoOooOk',
  'kOOpOOOOOOk',
  'kOOOOOoOoOk',
  '.kkkkkkkkk.',
];
// 그루밍 1: 앞발을 들어 얼굴 앞에
export const CAT_GROOM1 = [
  '...............',
  '..k..k.........',
  '.kOkkOk........',
  '.kOOOOOkkkkkk..',
  'kkOoOOoOooOooOk',
  'kOkOpOOOOOOOOOk',
  'kOkOOOOoOOoOOOk',
  '.kkkkkkkkkkkkkk',
];
// 그루밍 2: 고개를 숙여 앞발을 핥는다 (분홍 혀)
export const CAT_GROOM2 = [
  '...............',
  '..k..k.........',
  '.kOkkOk........',
  '.kOOOOOkkkkkk..',
  '.kOoOOoOooOooOk',
  'kOOOpOOOOOOOOOk',
  'kOkpOOOoOOoOOOk',
  '.kkkkkkkkkkkkkk',
];
// 기지개: 앞발을 쭉 뻗고 엉덩이를 든다
// 재채기: 코를 찡그리며 고개를 든다 (에… 에…)
export const CAT_SNEEZE_UP = patch(CAT_LOOK, [[3, 2, 'o'], [3, 5, 'o'], [4, 2, 'o'], [4, 4, 'o']]);
// 앞발 톡톡: 왼쪽에 두 칸 여유를 두고 앞발을 들었다(UP) 내린다(DOWN)
const CAT_WIDE = CAT.map((r) => `..${r}`);
export const CAT_PAW_UP = patch(CAT_WIDE, [[3, 0, 'kk'], [4, 0, 'kOO'], [5, 0, '.kk']]);
export const CAT_PAW_DOWN = patch(CAT_WIDE, [[5, 0, 'kk'], [6, 0, 'kOO']]);
export const CAT_STRETCH = [
  '..............kkk.',
  '.............kOOOk',
  '....k..k....kOoOOk',
  '...kOkkOkkkkOOOOOk',
  '...kOoOOoOooOOoOOk',
  '...kOOpOOOOOOOkOOk',
  'kkkkOOOOOkkkkkkOOk',
  'kOOOOOkkk.....kOk.',
  '.kkkkk........kkk.',
];

// 엄마 뒷모습: 어른 비율(키 47px). 목덜미에 낮게 묶은 쪽머리, 모카 카디건, 아이보리 앞치마 끈 리본. 색은 game/art/standing/mother-normal.webp 기준.
export const MOTHER = [
  '......kkkkkkkk......',
  '.....kMMNNNMMMk.....',
  '....kMNNMMMMMMMk....',
  '....kMNMMMMMMMMk....',
  '....kMMMMMMMMMMk....',
  '....kMMMMMMMMMMk....',
  '....kMMMMMMMMMMk....',
  '....kSMMMMMMMMSk....',
  '....kSMMMMMMMMSk....',
  '.....kMMMMMMMMk.....',
  '......kMMNNMMk......',
  '.....kMMNMMMMMk.....',
  '.....kMMMMMMMMk.....',
  '......kkSSSSkk......',
  '....kkkAAAAAAkkk....',
  '...kAAAAAAAAAAAAk...',
  '..kAAAAAAAAAAAAAAk..',
  '..kAAAAAAAAAAAAAAk..',
  '..kAaAAAAAAAAAAaAk..',
  '..kAaAAAAAAAAAAaAk..',
  '..kAaAAAAAAAAAAaAk..',
  '..kAaAAAAAAAAAAaAk..',
  '..kAaAAAAAAAAAAaAk..',
  '..kaaAAPPAAPPAAaak..',
  '..kaPPPPPPPPPPPPak..',
  '..kaAAPPPAAPPPAAak..',
  '..kaAAAAPAAPAAAAak..',
  '..kaAAAAPAAPAAAAak..',
  '..kaaAAPAAAAPAAaak..',
  '..kkkAAPAAAAPAAkkk..',
  '...kPkkkkkkkkkkPk...',
  '...kPDDDDDDDDDDPk...',
  '...kPDDDDDDDDDDPk...',
  '...kPDDDDDDDDDDPk...',
  '..kPDDDDDDDDDDDDPk..',
  '..kPDDDDDDDDDDDDPk..',
  '..kPDDDDDDDDDDDDPk..',
  '..kDDDDDDDDDDDDDDk..',
  '..kDDDDDDDDDDDDDDk..',
  '..kkkkkkkkkkkkkkkk..',
  '......kLLkkLLk......',
  '......kLLkkLLk......',
  '......kLLkkLLk......',
  '......kLLkkLLk......',
  '......kLLkkLLk......',
  '.....kFFFkkFFFk.....',
  '.....kkkkkkkkkk.....',
];

// 엄마 옆모습: 의자에 앉아 오른쪽(식탁)을 본다. 팔은 식탁 위, 앞치마.
export const MOTHER_SITTING = [
  '.......kkkkkk...........',
  '......kMMNNMMk..........',
  '.....kMMNMMMMMk.........',
  '.....kMMMMMMMMMk........',
  '.....kMMMMMMMMSk........',
  '.....kMMMMMMMsssk.......',
  '..kkkMMMMMMMMseSk.......',
  '.kMNMkMMMMMSsssssk......',
  '.kMMMkMMMMMssssskk......',
  '.kMMMkMMMMMMsssmk.......',
  '..kkkkMMMMMSssk.........',
  '.......kkkkkSSk.........',
  '........kASSSAk.........',
  '......kkAAAAAAkk........',
  '..kk.kAAAAAAAAAAk.......',
  '..kBkkAAAaAAAAAAk.......',
  '..kBkkAAAaAAAAAAk.......',
  '..kBkkAAAaAAAAAAkkkkkkk.',
  '..kBkkAAAAaaaaaaaaaaaSSk',
  '..kBkkAAAAAkkkkkkkkkkkkk',
  '..kBkkAAAAAAAPPPk.......',
  '..kBkkAAAAAAAPPPk.......',
  '..kBkkAAAAAAAPPPk.......',
  '..kBkkAAAAAAAPPPk.......',
  '..kBkkaAAAAAAPPPPkkkk...',
  '..kBkkDDDDDDDDPPPPDDDk..',
  '..kBkkDDDDDDDDDDDDDDDk..',
  '..kBkkkkkkkkkkkkkkkLLk..',
  '..kBBBBBBBBBBBBBk.kLLk..',
  '..kkkkkkkkkkkkkkk.kLLk..',
  '...kBk.......kBk..kLLk..',
  '...kBk.......kBk..kLLk..',
  '...kBk.......kBk..kLLk..',
  '...kBk.......kBk..kLLk..',
  '...kBk.......kBk..kLLk..',
  '...kBk.......kBk..kLLk..',
  '...kBk.......kBk..kLLk..',
  '...kBk.......kBk..kFFFFk',
  '...kkk.......kkk..kkkkkk',
];

// ── 꿈 조각 아이콘 (선반에 놓이는 물건, 8칸 안팎) ─────────────────
// 엄마의 손편지: 접은 편지
export const ITEM_LETTER = [
  '.kkkkkkk',
  'kqqqqqqk',
  'kqrrrrqk',
  'kqqqqqqk',
  'kqrrrqQk',
  'kqqqqQQk',
  'kkkkkkk.',
];
// 이 빠진 머그잔: 입구 왼쪽 위가 빠져 있다
export const ITEM_MUG = [
  '.kkk.kk...',
  'kuuu.uuk..',
  'kuuuuuukk.',
  'kvvvvvvkUk',
  'kuuuuuukUk',
  'kuuuuuukk.',
  'kUuuuuUk..',
  '.kkkkkk...',
];
// 아직 그림이 없는 꿈 조각
// 영수증 한 장 (태오): 인쇄 줄 + 뒷면 손글씨 한 줄, 아래는 찢긴 톱니
export const ITEM_RECEIPT = [
  'kkkkkkk',
  'kqqqqqk',
  'kqrrrqk',
  'kqqqqqk',
  'kqrqrrk',
  'kqqqqqk',
  'kQeQeQk',
  'kqkqkqk',
  '.k.k.k.',
];
// 다희 「할머니의 물병」: 금 간 빨간 뚜껑을 노란 고무줄로 칭칭, 보리차, 바닥에 매직 글씨
export const ITEM_BOTTLE = [
  '.kkkkkk.',
  'k==k===k',
  'k::::::k',
  'k=k=:==k',
  '.kkkkkk.',
  '..kTik..',
  '.kiTTTk.',
  'kTvvvvTk',
  'kTvivvTk',
  'kTvvvvTk',
  'kTkvkkTk',
  '.kkkkkk.',
];
// 수경 「첫째의 그림」: 크레용으로 침대에 누운 길쭉한 사람(엄마), 하트 열 개쯤, 아래에 삐뚤빼뚤 글씨. 귀퉁이가 말렸다
export const ITEM_DRAWING = [
  'kkkkkkkkkkk',
  'kq=qq=qq=qk',
  'k=qq=qq=qqk',
  'kqq=qq=qq=k',
  'kqqqqqqqqqk',
  'kqhs;;;;;qk',
  'kq:::::::qk',
  'kq:qqqqq:Qk',
  'kqrrqrrqQk.',
  'kkkkkkkkk..',
];
// ── 고양이 선물 (data.js CAT_GIFTS) ──
// 찌그러진 사이다 병뚜껑: 톱니 테, 오른쪽이 눌려 안쪽 은색이 보인다
export const GIFT_BOTTLECAP = [
  '..k.k.k..',
  '.klllllk.',
  'klillllkk',
  '.llllll+k',
  'klllll++k',
  '.kllll+k.',
  '..k.kkk..',
];
// 회색 비둘기 깃털 (비스듬히)
export const GIFT_FEATHER = [
  '.......kk',
  '......k~k',
  '.....k~~k',
  '....k~^~k',
  '...k~^~k.',
  '..k~^~~k.',
  '.k~^~kk..',
  'k^kkk....',
  'kk.......',
];
// 갈색 코트 단추 (구멍 넷)
export const GIFT_BUTTON = [
  '..kkkk..',
  '.kvBBBk.',
  'kvBBBBDk',
  'kBBkBkDk',
  'kBBBBBDk',
  'kBBkBkDk',
  '.kBDDDk.',
  '..kkkk..',
];
// 노랗게 마른 은행잎 (가운데 갈라진 부채꼴)
export const GIFT_GINKGO = [
  'kkkk.kkkk',
  'kdddkdddk',
  'kddddddfk',
  '.kddddfk.',
  '..kdddk..',
  '...kfk...',
  '...kfk...',
  '....k....',
];
// 줄무늬 양말 한 짝
export const GIFT_SOCK = [
  '.kkkkk...',
  '.kqqqk...',
  '.k===k...',
  '.kqqqk...',
  '.k===k...',
  '.kqqqqkk.',
  '.k======k',
  '.kQqqqqqk',
  '..kkkkkk.',
];
// 빨간 줄무늬 빵집 포장 끈 (나비 모양으로 꼬임)
export const GIFT_RIBBON = [
  '.kk...kk.',
  'k=qk.kq=k',
  'kq=qkq=qk',
  '.k=q=q=k.',
  '.kq=k=qk.',
  'k=qk.k=qk',
  'kkk...kkk',
];
// 깨끗한 참치캔 뚜껑
export const GIFT_TUNA_LID = [
  '..kkkkk..',
  '.k+++++k.',
  'k+*****+k',
  'k+*+i+*+k',
  'k+*+++*+k',
  'k+*****+k',
  '.k+++++k.',
  '..kkkkk..',
];
// 카페 직원 명찰: 초록 띠에 작은 잔 무늬, 이름 칸 쪽이 부러져 없다 (글자는 없다)
export const GIFT_BADGE = [
  'kkkkkkkkk',
  'klldlllk.',
  'kqqqqqk..',
  'kqQQQQk..',
  'kqqqqk...',
  'kqqqqk...',
  'kkkkk....',
];
export const ITEM_SHARD = [
  '...k...',
  '..kik..',
  '.kiTTk.',
  'kiTTTTk',
  '.kTTTk.',
  '..kTk..',
  '...k...',
];


// ── 초상화 (대화창 옆, 48×48) ───────────────────────────────────
// 손으로 찍기엔 커서 도형으로 칠한 뒤 자동 외곽선을 두른다. 결과는 다른 스프라이트처럼 문자열 줄이다.
const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill('.'));
const put = (g, x, y, ch) => { if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch; };
const ell = (g, cx, cy, rx, ry, ch) => {
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) g[y][x] = ch;
  }
};
const rect = (g, x0, y0, w, h, ch) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(g, x, y, ch); };
const pts = (g, ch, list) => { for (const [x, y] of list) put(g, x, y, ch); };
/** 좌우 대칭으로 찍기 (48칸 기준: x ↔ 47-x) */
const sym = (g, ch, list) => pts(g, ch, list.flatMap(([x, y]) => [[x, y], [47 - x, y]]));
/** 비어 있는 칸 중 그림과 맞닿은 칸에 외곽선 */
const outline = (g, ch = 'k') => {
  const src = g.map((r) => [...r]);
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
    if (src[y][x] !== '.') continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (src[y + dy]?.[x + dx] ?? '.') !== '.');
    if (near) g[y][x] = ch;
  }
};
const toRows = (g) => g.map((r) => r.join(''));

// ── 틀 밖 고양이 (roam.js 용, 오른쪽을 보는 옆모습) ─────────────────
// 모두 맨 아래 줄 = 발바닥 아래 바닥선. 왼쪽을 보게 하려면 좌우로 뒤집어 쓴다.
const catHead = (g, cx, cy, eyes = 'open') => {
  ell(g, cx, cy, 3.2, 2.8, 'O');
  pts(g, 'O', [[cx - 2, cy - 3], [cx - 2, cy - 4], [cx + 2, cy - 3], [cx + 2, cy - 4]]);   // 귀
  pts(g, 'p', [[cx - 2, cy - 3], [cx + 2, cy - 3]]);
  put(g, cx, cy - 2, 'o');                                                                // 이마 줄무늬
  if (eyes === 'open') pts(g, '-', [[cx - 1, cy], [cx + 2, cy]]);
  else if (eyes === 'closed') pts(g, 'o', [[cx - 1, cy], [cx + 2, cy]]);
  put(g, cx + 3, cy + 1, 'p');                                                            // 코
};
/** 서 있는 옆모습. legs = 네 다리 [x, 바닥에서 들린 칸] (뒷다리 둘, 앞다리 둘) */
const catStand = (legs, { bob = 0 } = {}) => {
  const g = grid(22, 11);
  const by = 6 - bob;
  for (const [x, lift] of legs) rect(g, x, by + 2, 2, 9 - (by + 2) - lift + 1, 'O');
  ell(g, 10, by, 6.5, 2.6, 'O');
  pts(g, 'o', [[7, by - 2], [10, by - 2], [13, by - 2], [8, by + 1], [11, by + 1]]);
  pts(g, 'O', [[3, by - 1], [2, by - 2], [1, by - 3], [1, by - 4], [2, by - 5]]);             // 꼬리 (S자)
  catHead(g, 17, by - 2);
  outline(g);
  return toRows(g);
};
export const CAT_WALK1 = catStand([[3, 0], [7, 1], [12, 1], [16, 0]]);
export const CAT_WALK2 = catStand([[4, 0], [6, 0], [13, 0], [15, 0]], { bob: 1 });
export const CAT_WALK3 = catStand([[3, 1], [7, 0], [12, 0], [16, 1]]);
export const CAT_WALK4 = catStand([[5, 0], [6, 1], [14, 1], [15, 0]], { bob: 1 });

/** 앉은 옆모습. paw: null | 'up' | 'down' (앞발 톡톡), face: 'open' | 'closed' | 'yawn' */
const catSit = ({ paw = null, face = 'open' } = {}) => {
  const g = grid(20, 15);
  ell(g, 8.5, 10.5, 5, 3.5, 'O');                     // 엉덩이
  ell(g, 12, 8, 2.8, 4.5, 'O');                       // 가슴
  pts(g, 'q', [[13, 7], [14, 8], [14, 9], [13, 10]]); // 가슴 털
  rect(g, 11, 10, 2, 4, 'O');                         // 받친 앞발
  if (paw === 'up') { rect(g, 14, 7, 3, 2, 'O'); rect(g, 16, 5, 2, 2, 'O'); }
  else if (paw === 'down') { rect(g, 14, 10, 4, 2, 'O'); rect(g, 17, 12, 2, 2, 'O'); }
  else rect(g, 13, 11, 2, 3, 'O');
  rect(g, 2, 13, 10, 1, 'O'); put(g, 1, 12, 'O');     // 몸에 감은 꼬리
  pts(g, 'o', [[6, 8], [9, 7], [5, 11], [2, 13], [5, 13], [8, 13]]);
  if (face === 'yawn') {
    ell(g, 13, 3.5, 3.2, 2.8, 'O');
    pts(g, 'O', [[11, 0], [11, 1], [15, 0], [15, 1]]); pts(g, 'p', [[11, 1], [15, 1]]);
    pts(g, 'o', [[12, 3], [15, 3]]);                  // 꼭 감은 눈
    rect(g, 15, 4, 2, 3, 'p'); put(g, 16, 4, 'k'); put(g, 16, 6, 'k');   // 쩍 벌린 입
  } else {
    catHead(g, 13, 4, face);
  }
  outline(g);
  return toRows(g);
};
export const CAT_SIT = catSit();
export const CAT_PAWTEXT1 = catSit({ paw: 'up' });
export const CAT_PAWTEXT2 = catSit({ paw: 'down', face: 'closed' });
export const CAT_YAWN = catSit({ face: 'yawn' });

// 도약: 몸을 길게 펴고 앞발은 앞으로, 뒷발은 뒤로
export const CAT_JUMP = (() => {
  const g = grid(28, 10);
  ell(g, 13, 4.5, 8.5, 2.2, 'O');
  for (let i = 0; i < 5; i++) { rect(g, 20 + i, 6 + Math.floor(i / 2), 2, 1, 'O'); rect(g, 6 - i, 6 + Math.floor(i / 2), 2, 1, 'O'); }
  rect(g, 0, 3, 5, 1, 'O'); put(g, 0, 2, 'O');        // 꼬리
  pts(g, 'o', [[9, 3], [12, 3], [15, 3], [18, 3]]);
  catHead(g, 23, 3);
  outline(g);
  return toRows(g);
})();
// 착지: 납작 웅크림
export const CAT_LAND = (() => {
  const g = grid(22, 9);
  ell(g, 10, 5.5, 7, 2.2, 'O');
  for (const x of [3, 6, 13, 16]) rect(g, x, 7, 2, 1, 'O');
  pts(g, 'O', [[2, 4], [1, 3], [0, 3]]);
  pts(g, 'o', [[7, 4], [10, 4], [13, 4]]);
  catHead(g, 18, 5, 'closed');
  outline(g);
  return toRows(g);
})();
// 뒹굴: 배를 보이고 네 발을 든다 (두 프레임 번갈아)
const catRoll = (alt) => {
  const g = grid(22, 11);
  ell(g, 10, 6.5, 7, 2.5, 'O');
  for (let x = 5; x <= 15; x++) for (let y = 4; y <= 6; y++) if (g[y][x] === 'O') g[y][x] = 'q';   // 배
  const legs = alt ? [[5, 1], [8, 2], [12, 2], [15, 1]] : [[4, 2], [8, 1], [12, 1], [16, 2]];
  for (const [x, top] of legs) rect(g, x, top, 2, 5 - top, 'O');
  pts(g, 'O', alt ? [[2, 7], [1, 6], [0, 5]] : [[2, 7], [1, 8], [0, 8]]);   // 꼬리 살랑
  ell(g, 18, 7, 3, 2.4, 'O');                         // 거꾸로 누운 머리
  pts(g, 'O', [[17, 10 - 1], [20, 9]]);
  pts(g, 'o', [[17, 7], [19, 7]]); put(g, 18, 5, 'p');
  outline(g);
  return toRows(g);
};
export const CAT_ROLL1 = catRoll(false);
export const CAT_ROLL2 = catRoll(true);

// ── 틀 밖 고양이 고해상도 (ROAM, 장면 픽셀의 절반 크기) ──────────────
// 위 1배 그림과 같은 모양을 2배 격자에 다시 칠하고, 1픽셀 디테일(눈 반짝·주둥이·속귀·발가락·가는 줄무늬·흰 앞발)을 더한다.
const R2 = 2;
const P2 = (g) => ({
  ell: (cx, cy, rx, ry, ch) => ell(g, cx * R2 + 0.5, cy * R2 + 0.5, rx * R2, ry * R2, ch),
  rect: (x, y, w, h, ch) => rect(g, x * R2, y * R2, w * R2, h * R2, ch),
  px: (x, y, ch) => put(g, x, y, ch),              // 2배 격자 좌표로 한 칸
});
const grid2 = (w, h) => grid(w * R2, (h - 1) * R2 + 1);
/** 맨 아래 줄은 바닥선 전용: 비우고 외곽선을 두른다 */
const outline2 = (g) => { g[g.length - 1].fill('.'); outline(g); };
/** 2배 머리. (cx, cy) 는 1배 좌표. eyes: open | blink | happy | squint */
const head2 = (g, cx, cy, eyes = 'open') => {
  const P = P2(g);
  P.ell(cx, cy, 3.3, 2.9, 'O');
  const X = cx * R2 + 1, Y = cy * R2 + 1;            // 2배 격자의 머리 중심
  for (const dir of [-1, 1]) {                        // 귀: 삼각형 + 분홍 속귀
    for (let i = 0; i < 6; i++) for (let k = 0; k <= Math.floor(i / 1.5); k++) {
      put(g, X + dir * (4 - Math.floor(i / 3)) + (dir < 0 ? -k + 1 : k - 1), Y - 9 + i, 'O');
    }
    put(g, X + dir * 4, Y - 6, 'p'); put(g, X + dir * 4, Y - 5, 'p');
  }
  pts(g, 'o', [[X - 1, Y - 5], [X - 1, Y - 4], [X + 1, Y - 5], [X + 1, Y - 4], [X, Y - 6], [X + 4, Y - 1], [X + 5, Y - 2]]);   // 이마 M자·볼 줄
  ell(g, X + 4, Y + 2.5, 2.6, 1.8, 'n');             // 흰 주둥이·턱
  pts(g, 'p', [[X + 6, Y + 1], [X + 7, Y + 1]]);     // 코
  pts(g, 'k', [[X + 6, Y + 3], [X + 5, Y + 4]]);     // 입
  for (const ex of [X - 2, X + 3]) {
    if (eyes === 'open') { rect(g, ex, Y - 1, 2, 2, 'j'); put(g, ex + 1, Y - 1, 'e'); put(g, ex + 1, Y, 'e'); put(g, ex, Y - 1, 'i'); }
    else if (eyes === 'happy') pts(g, 'k', [[ex - 1, Y], [ex, Y - 1], [ex + 1, Y - 1], [ex + 2, Y]]);
    else if (eyes === 'squint') pts(g, 'k', [[ex - 1, Y - 1], [ex, Y], [ex + 1, Y], [ex + 2, Y - 1]]);
    else pts(g, 'k', [[ex, Y], [ex + 1, Y]]);
  }
};
/** 등·몸통 줄무늬 (2배 격자, 가는 세로줄) */
const stripes2 = (g, list) => { for (const [x, y, len] of list) for (let i = 0; i < len; i++) if (g[y + i]?.[x] === 'O') g[y + i][x] = 'o'; };
/** 몸 아래쪽 그늘 한 줄 */
const belly2 = (g) => {
  const src = g.map((r) => [...r]);
  for (let y = 0; y < g.length - 1; y++) for (let x = 0; x < g[0].length; x++) if (src[y][x] === 'O' && src[y + 1][x] === '.') g[y][x] = 't';
};

const stand2 = (legs, { bob = 0 } = {}) => {
  const g = grid2(22, 11);
  const P = P2(g);
  const by = 6 - bob;
  for (const [x, lift] of legs) P.rect(x, by + 2, 2, 9 - (by + 2) - lift + 1, 'O');
  P.ell(10, by, 6.5, 2.6, 'O');
  for (const [x, y] of [[3, by - 1], [2, by - 2], [1, by - 3], [1, by - 4], [2, by - 5]]) P.rect(x, y, 1, 1, 'O');   // 꼬리
  head2(g, 17, by - 2);
  belly2(g);
  stripes2(g, [[12, by * 2 - 4, 4], [16, by * 2 - 4, 5], [20, by * 2 - 4, 5], [24, by * 2 - 4, 4], [3, (by - 3) * 2, 2], [5, (by - 1) * 2, 2]]);
  for (const [x, lift] of legs) {                    // 흰 발끝 + 발가락 줄
    const fy = (9 - lift) * R2;
    rect(g, x * R2, fy, 4, 2, 'n'); put(g, x * R2 + 1, fy + 1, 'k'); put(g, x * R2 + 3, fy + 1, 'k');
  }
  outline2(g);
  return toRows(g);
};

const sit2 = ({ paw = null, eyes = 'open', yawn = false } = {}) => {
  const g = grid2(20, 15);
  const P = P2(g);
  P.ell(8.5, 10.5, 5, 3.5, 'O');
  P.ell(12, 8, 2.8, 4.5, 'O');
  P.rect(11, 10, 2, 4, 'O');
  if (paw === 'up') { P.rect(14, 7, 3, 2, 'O'); P.rect(16, 5, 2, 2, 'O'); }
  else if (paw === 'down') { P.rect(14, 10, 4, 2, 'O'); P.rect(17, 12, 2, 2, 'O'); }
  else P.rect(13, 11, 2, 3, 'O');
  P.rect(2, 13, 10, 1, 'O'); P.rect(1, 12, 1, 1, 'O');   // 감은 꼬리
  ell(g, 26, 16, 2.6, 5, 'n');                        // 흰 가슴
  if (yawn) {
    P.ell(13, 3.5, 3.2, 2.8, 'O');
    head2(g, 13, 3.5, 'squint');
    ell(g, 33, 9, 2, 2.5, 'p'); put(g, 33, 7, 'k'); put(g, 34, 11, 'k');   // 쩍 벌린 입
  } else head2(g, 13, 4, eyes);
  belly2(g);
  stripes2(g, [[12, 16, 3], [15, 15, 4], [18, 18, 4], [8, 20, 3], [4, 26, 2], [8, 26, 2], [12, 26, 2], [16, 26, 2]]);
  // 흰 앞발
  const paws = paw === 'up' ? [[32, 10]] : paw === 'down' ? [[34, 24]] : [[26, 26]];
  for (const [x, y] of [[22, 26], ...paws]) { rect(g, x, y, 4, 2, 'n'); put(g, x + 1, y + 1, 'k'); put(g, x + 3, y + 1, 'k'); }
  outline2(g);
  return toRows(g);
};

const jump2 = () => {
  const g = grid2(28, 10);
  const P = P2(g);
  P.ell(13, 4.5, 8.5, 2.2, 'O');
  for (let i = 0; i < 5; i++) { P.rect(20 + i, 6 + Math.floor(i / 2), 2, 1, 'O'); P.rect(6 - i, 6 + Math.floor(i / 2), 2, 1, 'O'); }
  P.rect(0, 3, 5, 1, 'O'); P.rect(0, 2, 1, 1, 'O');
  head2(g, 23, 3);
  belly2(g);
  stripes2(g, [[18, 6, 4], [24, 6, 4], [30, 6, 4], [36, 6, 4], [2, 6, 2], [6, 6, 2]]);
  rect(g, 48, 16, 4, 2, 'n'); rect(g, 2, 16, 4, 2, 'n');
  outline2(g);
  return toRows(g);
};
const land2 = () => {
  const g = grid2(22, 9);
  const P = P2(g);
  P.ell(10, 5.5, 7, 2.2, 'O');
  for (const x of [3, 6, 13, 16]) P.rect(x, 7, 2, 1, 'O');
  for (const [x, y] of [[2, 4], [1, 3], [0, 3]]) P.rect(x, y, 1, 1, 'O');
  head2(g, 18, 5, 'squint');
  belly2(g);
  stripes2(g, [[14, 8, 3], [20, 8, 3], [26, 8, 3]]);
  for (const x of [3, 6, 13, 16]) rect(g, x * R2, 14, 4, 2, 'n');
  outline2(g);
  return toRows(g);
};
const roll2 = (alt) => {
  const g = grid2(22, 11);
  const P = P2(g);
  P.ell(10, 6.5, 7, 2.5, 'O');
  for (let y = 0; y < g.length; y++) for (let x = 10; x <= 31; x++) if (g[y][x] === 'O' && y <= 13) g[y][x] = 'n';   // 하얀 배
  const legs = alt ? [[5, 1], [8, 2], [12, 2], [15, 1]] : [[4, 2], [8, 1], [12, 1], [16, 2]];
  for (const [x, top] of legs) { P.rect(x, top, 2, 5 - top, 'O'); rect(g, x * R2, top * R2, 4, 2, 'n'); }
  for (const [x, y] of alt ? [[2, 7], [1, 6], [0, 5]] : [[2, 7], [1, 8], [0, 8]]) P.rect(x, y, 1, 1, 'O');
  P.ell(18, 7, 3, 2.4, 'O');
  pts(g, 'k', [[34, 14], [35, 15], [36, 15], [37, 14], [39, 14], [40, 15], [41, 15], [42, 14]]);   // 거꾸로 웃는 눈
  pts(g, 'p', [[38, 11], [39, 11]]);
  belly2(g);
  stripes2(g, [[8, 14, 2], [36, 16, 2]]);
  outline2(g);
  return toRows(g);
};

/** 틀 밖 고양이 고해상도 프레임 (모두 오른쪽 보기, 맨 아래 줄 = 바닥선). res = 장면 픽셀 하나에 들어가는 칸 수 */
export const ROAM = {
  res: R2,
  walk: [stand2([[3, 0], [7, 1], [12, 1], [16, 0]]), stand2([[4, 0], [6, 0], [13, 0], [15, 0]], { bob: 1 }),
    stand2([[3, 1], [7, 0], [12, 0], [16, 1]]), stand2([[5, 0], [6, 1], [14, 1], [15, 0]], { bob: 1 })],
  sit: sit2(),
  sitBlink: sit2({ eyes: 'blink' }),
  paw: [sit2({ paw: 'up' }), sit2({ paw: 'down', eyes: 'squint' })],
  yawn: sit2({ yawn: true }),
  jump: jump2(),
  land: land2(),
  roll: [roll2(false), roll2(true)],
  purr: sit2({ eyes: 'happy' }),
};

function harinPortrait(face) {
  const g = grid(48, 48);
  ell(g, 23.5, 54, 22, 17, 'w');                 // 후드티 어깨
  rect(g, 5, 44, 38, 4, 'w');
  ell(g, 23.5, 37, 9, 2.5, 'W');                 // 뒤로 넘긴 후드
  pts(g, 'W', [[14, 44], [14, 45], [14, 46], [33, 44], [33, 45], [33, 46]]);   // 주름
  rect(g, 21, 30, 6, 8, 'S');                    // 목
  ell(g, 23.5, 19, 15.5, 13.5, 'h');             // 단발 뒷머리
  rect(g, 8, 19, 32, 13, 'h');
  ell(g, 23.5, 22, 10.5, 11, 's');               // 얼굴
  ell(g, 23.5, 12, 13, 6.5, 'h');                // 앞머리
  sym(g, 'h', [[14, 18], [15, 18], [18, 18], [19, 19], [22, 18], [14, 19]]);
  rect(g, 11, 16, 3, 16, 'h');                   // 얼굴 옆 머리
  rect(g, 34, 16, 3, 16, 'h');
  sym(g, 'H', [[15, 9], [16, 8], [17, 8], [18, 7], [19, 7], [12, 13], [11, 15]]);   // 머리 윤기
  rect(g, 20, 38, 1, 6, 'P'); rect(g, 27, 38, 1, 6, 'P');                         // 후드 끈
  pts(g, 'S', [[17, 31], [18, 32], [29, 32], [30, 31], [19, 33], [28, 33]]);      // 턱 그늘
  const eye = (x) => { rect(g, x, 22, 2, 3, 'e'); put(g, x, 22, 'i'); };
  const closed = (x) => pts(g, 'e', [[x - 1, 23], [x, 24], [x + 1, 24], [x + 2, 23]]);
  const cheeks = (wide) => { sym(g, 'c', [[16, 27], [17, 27], ...(wide ? [[15, 27], [16, 26]] : [])]); };
  if (face === 'smile') {
    for (const x of [18, 28]) pts(g, 'e', [[x - 1, 23], [x, 22], [x + 1, 22], [x + 2, 23]]);
    cheeks(true);
    rect(g, 22, 27, 4, 1, 'm'); rect(g, 23, 28, 2, 1, 'm');
  } else if (face === 'teary') {
    for (const x of [18, 28]) { rect(g, x - 1, 22, 3, 3, 'e'); put(g, x - 1, 22, 'i'); put(g, x + 1, 24, 'i'); }
    sym(g, 'h', [[19, 20], [20, 19]]);                       // 처진 눈썹
    sym(g, 'T', [[17, 25], [17, 26], [16, 27]]);
    cheeks(false);
    pts(g, 'm', [[22, 29], [23, 28], [24, 28], [25, 29]]);
  } else if (face === 'asleep' || face === 'asleep-smile') {
    closed(18); closed(28);
    cheeks(face === 'asleep-smile');
    if (face === 'asleep-smile') { rect(g, 22, 27, 4, 1, 'm'); rect(g, 23, 28, 2, 1, 'm'); }
    else rect(g, 23, 28, 2, 1, 'm');
  } else {
    eye(18); eye(28);
    cheeks(false);
    rect(g, 23, 28, 2, 1, 'm');
  }
  outline(g);
  return toRows(g);
}

function motherPortrait(face) {
  const g = grid(48, 48);
  ell(g, 23.5, 55, 22, 18, 'A');                 // 카디건
  rect(g, 4, 44, 40, 4, 'A');
  pts(g, 'a', [[13, 42], [13, 43], [13, 44], [13, 45], [13, 46], [13, 47], [34, 42], [34, 43], [34, 44], [34, 45], [34, 46], [34, 47]]);
  rect(g, 17, 40, 14, 8, 'q');                   // 앞치마 가슴판
  rect(g, 17, 38, 2, 3, 'q'); rect(g, 29, 38, 2, 3, 'q');   // 앞치마 끈
  pts(g, 'Q', [[17, 47], [30, 47], [23, 44], [24, 44]]);
  rect(g, 20, 31, 8, 8, 'S');                    // 목
  ell(g, 33, 7, 5, 4.5, 'M');                    // 쪽 찐 머리
  pts(g, 'N', [[32, 4], [33, 4], [34, 5]]);
  ell(g, 23.5, 18, 13, 12.5, 'M');               // 머리
  ell(g, 23.5, 23, 10.5, 11.5, 's');             // 얼굴
  ell(g, 23.5, 13, 11, 4.5, 'M');                // 이마 위 머리 (가르마)
  pts(g, 'N', [[16, 10], [17, 9], [18, 9], [28, 9], [29, 9], [30, 10]]);
  sym(g, 's', [[12, 23], [12, 24]]); sym(g, 'S', [[12, 25]]);   // 귀
  pts(g, 'S', [[17, 32], [18, 33], [29, 33], [30, 32]]);
  sym(g, 'S', [[15, 24]]);                       // 눈가 주름
  if (face === 'smile') {
    for (const x of [18, 28]) pts(g, 'e', [[x - 1, 24], [x, 23], [x + 1, 23], [x + 2, 24]]);
    sym(g, 'c', [[16, 27], [17, 27]]);
    pts(g, 'm', [[21, 28], [22, 29], [23, 29], [24, 29], [25, 29], [26, 28]]);
  } else {
    for (const x of [18, 28]) { rect(g, x, 23, 2, 2, 'e'); put(g, x, 23, 'i'); }
    sym(g, 'M', [[17, 21], [18, 20], [19, 20], [20, 20]]);   // 눈썹
    sym(g, 'c', [[16, 27]]);
    pts(g, 'm', [[22, 29], [23, 29], [24, 29], [25, 29]]);
  }
  outline(g);
  return toRows(g);
}

function catPortrait(face) {
  const g = grid(48, 48);
  ell(g, 23.5, 52, 17, 15, 'O');                 // 몸
  ell(g, 23.5, 44, 7, 7, 'q');                   // 가슴 털
  for (const [x0, dir] of [[10, 1], [37, -1]]) { // 귀 (삼각형)
    for (let i = 0; i < 9; i++) for (let k = 0; k <= i; k++) put(g, x0 + dir * k, 6 + i, 'O');
    for (let i = 3; i < 8; i++) for (let k = 1; k <= i - 3; k++) put(g, x0 + dir * (k + 1), 6 + i, 'p');
  }
  ell(g, 23.5, 24, 15.5, 12, 'O');               // 머리
  pts(g, 'o', [[20, 13], [20, 14], [20, 15], [23, 12], [23, 13], [23, 14], [24, 12], [24, 13], [24, 14], [27, 13], [27, 14], [27, 15]]);
  sym(g, 'o', [[9, 22], [10, 22], [11, 22], [9, 25], [10, 25], [9, 40], [10, 41], [11, 42]]);   // 볼·몸 줄무늬
  ell(g, 23.5, 29.5, 6.5, 4, 'q');               // 주둥이
  pts(g, 'p', [[23, 27], [24, 27], [23, 28], [24, 28]]);
  pts(g, 'k', [[23, 29], [24, 29], [22, 30], [25, 30], [21, 30], [26, 30]]);
  sym(g, 'q', [[12, 28], [11, 28], [10, 27], [12, 30], [11, 31], [10, 31]]);        // 수염
  if (face === 'smile' || face === 'purr') {
    for (const x of [17, 28]) pts(g, 'k', [[x - 1, 23], [x, 22], [x + 1, 22], [x + 2, 22], [x + 3, 23]]);
  } else if (face === 'asleep' || face === 'blink') {
    for (const x of [17, 28]) pts(g, 'k', [[x - 1, 23], [x, 24], [x + 1, 24], [x + 2, 24], [x + 3, 23]]);
  } else {
    for (const x of [17, 28]) {
      rect(g, x - 1, 21, 5, 4, 'j'); rect(g, x + 1, 21, 1, 4, 'e');
      put(g, x - 1, 21, 'O'); put(g, x + 3, 21, 'O'); put(g, x - 1, 24, 'O'); put(g, x + 3, 24, 'O');
      put(g, x, 22, 'i');
    }
  }
  outline(g);
  return toRows(g);
}

/**
 * 사장: 역광 실루엣. 밤이 지날수록 조금씩 자세해진다. 얼굴은 어떤 단계에서도 그림자 속이다.
 * 0 실루엣 · 1 앞치마 윤곽 + 찻주전자 든 손 · 2 머리 모양·걷은 소매 · 3 옷 색이 조금 · 4 테두리 빛·김·바느질
 */
export const OWNER_STAGES = 5;
function ownerPortrait(stage) {
  const st = Math.max(0, Math.min(OWNER_STAGES - 1, Math.floor(stage) || 0));
  const g = grid(48, 48);
  ell(g, 23.5, 55, 21, 18, 'Z');                 // 어깨
  rect(g, 5, 44, 38, 4, 'Z');
  rect(g, 20, 29, 8, 9, 'Z');                    // 목
  ell(g, 23.5, 18, 11.5, 12.5, 'Z');             // 머리
  if (st >= 2) {                                 // 머리 모양: 옆으로 넘긴 앞머리, 뒤로 묶은 짧은 꽁지
    ell(g, 23.5, 13, 12.5, 8, 'Z');
    pts(g, 'Z', [[35, 18], [36, 19], [36, 20], [37, 21], [12, 17], [11, 18]]);
  }
  const pot = st >= 1;
  if (pot) {                                     // 찻주전자를 든 손 (오른쪽 아래)
    ell(g, 38, 39.5, 6.5, 4.5, 'Z');
    rect(g, 35, 33, 6, 2, 'Z'); rect(g, 37, 32, 2, 1, 'Z');          // 뚜껑·꼭지
    pts(g, 'Z', [[45, 38], [45, 37], [46, 36], [47, 35]]);           // 주둥이
    pts(g, 'Z', [[31, 36], [30, 37], [30, 38], [30, 39], [31, 40]]); // 손잡이
    rect(g, 27, 38, 4, 4, 'Z');                  // 손
  }
  // 테두리 빛 (램프가 오른쪽 뒤에서): 오른쪽·위쪽 가장자리
  const rim = (ch, from, to, x0 = 0) => {
    const src = g.map((r) => [...r]);
    for (let y = from; y < to; y++) for (let x = x0; x < 48; x++) {
      if (src[y][x] !== 'Z') continue;
      const edgeR = (src[y][x + 1] ?? '.') === '.';
      const edgeU = (src[y - 1]?.[x] ?? '.') === '.';
      if (edgeR || (edgeU && x > 22)) g[y][x] = ch;
    }
  };
  rim('y', 0, pot ? 48 : 24);
  if (st >= 4) rim('Y', 0, 30);
  if (pot) {                                     // 주전자 윗면은 램프를 받아 따로 보인다
    for (let x = 33; x <= 43; x++) for (let y = 31; y < 46; y++) {
      if (g[y][x] === 'Z' && g[y - 1][x] !== 'Z' && g[y - 1][x] !== 'G') { g[y][x] = st >= 4 ? 'Y' : 'y'; break; }
    }
  }
  if (st >= 3) {                                 // 옷 색이 아주 조금 (주전자는 은빛으로)
    for (let y = 36; y < 48; y++) for (let x = 0; x < 48; x++) if (g[y][x] === 'Z' && !(x > 31 && y < 45)) g[y][x] = 'G';
    for (let y = 38; y < 48; y++) for (let x = 16; x < 27; x++) if (g[y][x] === 'G') g[y][x] = 'R';
    for (let y = 31; y < 45; y++) for (let x = 32; x < 48; x++) if (g[y][x] === 'Z') g[y][x] = 'x';
  }
  if (pot) {                                     // 앞치마 윤곽 (손 왼쪽까지)
    for (let y = 39; y < 48; y++) { put(g, 15, y, 'y'); if (g[y][27] !== 'Z') put(g, 27, y, 'y'); }
    for (let x = 15; x <= 26; x++) put(g, x, 38, 'y');
    pts(g, 'y', [[17, 37], [18, 36], [19, 35], [28, 35], [29, 36], [30, 37]]);   // 목끈
  }
  if (st >= 2) {                                 // 걷은 소매, 앞머리 결
    for (let x = 5; x < 12; x++) put(g, x, 45, 'y');
    pts(g, 'y', [[30, 9], [31, 10], [32, 11], [33, 13]]);
  }
  if (st >= 4) {                                 // 앞치마 주머니 바느질, 주전자 김
    for (let x = 18; x <= 24; x++) put(g, x, 43, 'g');
    for (let y = 43; y < 47; y++) { put(g, 18, y, 'g'); put(g, 24, y, 'g'); }
    pts(g, 'y', [[46, 32], [45, 30], [46, 28], [45, 26]]);
  }
  outline(g);
  return toRows(g);
}

/** 초상화 줄 (테스트·굽기용). id: 'harin' | 'mother' | 'cat' | 'owner'. owner 는 face 대신 단계(0~4) */
export function portraitRows(id, face = 'normal') {
  if (id === 'harin') return harinPortrait(face);
  if (id === 'mother') return motherPortrait(face);
  if (id === 'cat') return catPortrait(face);
  if (id === 'owner') return ownerPortrait(face);
  throw new Error(`unknown portrait: ${id}`);
}

/** 팔레트를 세피아로 (기억 장면 속 인물용) */
function sepiaPalette(pal) {
  const out = {};
  for (const [ch, hex] of Object.entries(pal)) {
    const n = parseInt(hex.slice(1), 16);
    const r0 = n >> 16, g0 = (n >> 8) & 255, b0 = n & 255;
    const r = Math.min(255, (r0 * 0.393 + g0 * 0.769 + b0 * 0.189) * 0.82);
    const gg = Math.min(255, (r0 * 0.349 + g0 * 0.686 + b0 * 0.168) * 0.76);
    const b = Math.min(255, (r0 * 0.272 + g0 * 0.534 + b0 * 0.131) * 0.62);
    out[ch] = `#${[r, gg, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  }
  return out;
}
const SEPIA = sepiaPalette(PALETTE);

/** 캔버스를 만든다: DOM 이 있으면 <canvas>, 없으면 OffscreenCanvas */
function makeCanvas(w, h) {
  if (globalThis.document) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  return new OffscreenCanvas(w, h);
}

/**
 * 대화창 초상화. 48×48 을 scale 정수배로 굽는다.
 * bakePortrait('harin', 'teary', 3) / bakePortrait('owner', 2, 3) / bakePortrait('mother', 'smile', 3, { sepia: true })
 */
export function bakePortrait(id, face = 'normal', scale = 3, { sepia = false } = {}) {
  const rows = portraitRows(id, face);
  const k = Math.max(1, Math.round(scale));
  return bake(rows, sepia ? SEPIA : PALETTE, k, makeCanvas(rows[0].length * k, rows.length * k));
}

// ── 차 따르기 미니게임용 큰 찻주전자·찻잔 ─────────────────────
// 주전자 주둥이는 오른쪽 위. 기울이기(회전)는 lead 가 한다.
export const POUR_POT = (() => {
  const g = grid(38, 27);
  ell(g, 4.5, 14, 4, 5.5, 'b'); ell(g, 4.5, 14, 2, 3.5, '.');      // 손잡이 고리
  ell(g, 17, 16.5, 12, 8.5, 'b');                                   // 몸통
  for (let y = 19; y < 27; y++) for (let x = 0; x < 38; x++) if (g[y][x] === 'b' && x > 7) g[y][x] = 'x';
  for (let x = 7; x < 28; x++) if (g[14][x] === 'b') { g[14][x] = 'z'; if (x % 3 === 0) g[15][x] = 'z'; }   // 무늬 띠
  rect(g, 10, 7, 14, 2, 'b'); ell(g, 17, 6.5, 6, 1.5, 'b'); ell(g, 17, 4, 2, 1.5, 'x');   // 뚜껑·꼭지
  for (let i = 0; i < 8; i++) { rect(g, 27 + i, 14 - i, 2, 3, 'b'); }                       // 주둥이
  pts(g, 'i', [[10, 11], [11, 10], [12, 10]]);                                             // 반짝
  outline(g);
  return toRows(g);
})();
export const POUR_CUP = (() => {
  const g = grid(26, 18);
  ell(g, 21, 8, 3.5, 3.5, 'u'); ell(g, 21, 8, 1.5, 1.8, '.');      // 손잡이
  rect(g, 3, 3, 16, 8, 'u'); ell(g, 10.5, 11, 7.5, 4, 'u');        // 잔
  for (let x = 3; x < 19; x++) if (g[8][x] === 'u') g[8][x] = 'v';  // 띠
  for (let y = 11; y < 16; y++) for (let x = 0; x < 26; x++) if (g[y][x] === 'u' && x > 12) g[y][x] = 'U';
  ell(g, 10.5, 3, 7.5, 1.6, 'U');                                   // 입구 안쪽 (빈 잔)
  ell(g, 10.5, 16, 10, 1.5, 'U');                                   // 받침
  outline(g);
  return toRows(g);
})();

/**
 * 따르기 미니게임 스프라이트를 scale 정수배로 굽는다.
 * → { pot, cup, spout: {x,y} (주전자 안 주둥이 끝), mouth: {x,y,w,h} (잔 입구 안쪽 = 차가 차오르는 곳) } (모두 굽힌 픽셀 단위)
 */
export function bakePourSprites(scale = 4) {
  const k = Math.max(1, Math.round(scale));
  const make = (rows) => bake(rows, PALETTE, k, makeCanvas(rows[0].length * k, rows.length * k));
  return {
    pot: make(POUR_POT), cup: make(POUR_CUP),
    spout: { x: 36 * k, y: 7 * k },
    mouth: { x: 3 * k, y: 2 * k, w: 16 * k, h: 3 * k },
  };
}

// 수경의 아빠 (기억 속, 뒷모습): 짧은 머리, 넓은 어깨, 니트 + 바지, 팔을 앞으로 굽혀 냄비를 든다
export const FATHER = (() => {
  const g = grid(22, 48);
  ell(g, 11, 6, 5, 5.5, 'K');                          // 뒷머리 (짧게)
  pts(g, 's', [[5, 6], [5, 7], [16, 6], [16, 7]]);     // 귀
  pts(g, 'J', [[9, 2], [10, 2], [8, 3]]);              // 윤기
  rect(g, 8, 11, 6, 2, 's');                           // 목
  for (let y = 13; y < 31; y++) {                      // 몸통: 어깨가 넓고 허리로 좁아진다
    const half = y < 15 ? 7 + (y - 13) * 1.5 : Math.max(6, 9 - (y - 15) * 0.18);
    for (let x = Math.round(11 - half); x < Math.round(11 + half); x++) put(g, x, y, 'w');
  }
  for (let y = 15; y < 28; y++) { put(g, 2, y, 'W'); put(g, 19, y, 'W'); }   // 앞으로 굽힌 팔 (뒤에선 소매만)
  for (let y = 16; y < 31; y++) put(g, 11, y, 'W');                         // 니트 골
  rect(g, 4, 29, 14, 2, 'W');                                                 // 밑단 고무단
  rect(g, 5, 31, 12, 13, 'V'); rect(g, 10, 36, 2, 8, '.');                    // 바지 (두 다리)
  for (let y = 31; y < 44; y++) { put(g, 5, y, 'X'); put(g, 16, y, 'X'); }
  rect(g, 4, 44, 6, 2, 'F'); rect(g, 12, 44, 6, 2, 'F');                     // 슬리퍼
  outline(g);
  return toRows(g).slice(0, 47);
})();
// ── 차 종류별 미니게임 (얼음·우유·우리기) ─────────────────────
// 모두 120×96 판에 ×2 로 그린다. 그리는 순서: 잔(뒤) → 차 칸 → 얼음/거름망 → front(앞 반사).

/** 키 큰 유리잔 18×34. 안쪽(차가 차는 칸)은 '4', 벽은 '3'. 위로 갈수록 살짝 넓다. */
const glassWalls = (y) => { const inset = Math.round(y * 2 / 30); return [inset, 17 - inset]; };
export const BREW_GLASS = (() => {
  const g = grid(18, 34);
  for (let y = 1; y < 30; y++) { const [l, r] = glassWalls(y); put(g, l, y, '3'); put(g, r, y, '3'); for (let x = l + 1; x < r; x++) put(g, x, y, '4'); }
  for (let x = 2; x < 16; x++) put(g, x, 0, '3');                    // 입구 뒤쪽 테
  const [bl, br] = glassWalls(30);
  for (let y = 30; y < 34; y++) for (let x = bl; x <= br; x++) put(g, x, y, y === 30 || y === 33 || x === bl || x === br ? '3' : '4');  // 두꺼운 바닥
  return toRows(g);
})();
/** 유리잔 앞면: 입구 앞쪽 테 + 세로 반사. 차·얼음 위에 겹친다. */
export const BREW_GLASS_FRONT = (() => {
  const g = grid(18, 34);
  for (let x = 2; x < 16; x++) put(g, x, 2, '3');
  put(g, 1, 1, '3'); put(g, 16, 1, '3');
  for (let y = 5; y < 26; y++) put(g, glassWalls(y)[0] + 2, y, y < 8 ? 'i' : '9');
  for (let y = 6; y < 12; y++) put(g, glassWalls(y)[1] - 2, y, '9');
  pts(g, 'i', [[6, 31], [7, 31]]);
  return toRows(g);
})();
/** 얼음 조각: 작 4·중 6·큰 8 정사각, 왼쪽 위에 하이라이트 1px */
const iceCube = (n) => {
  const g = grid(n, n);
  rect(g, 0, 0, n, n, '1');
  for (let i = 0; i < n; i++) { put(g, n - 1, i, '2'); put(g, i, n - 1, '2'); }
  put(g, 1, 1, 'i');
  if (n >= 6) put(g, 2, 1, 'i');
  return toRows(g);
};
export const ICE_S = iceCube(4), ICE_M = iceCube(6), ICE_L = iceCube(8);

/** 작은 우유 주전자 22×20. 손잡이 왼쪽, 주둥이 오른쪽 위. */
export const MILK_JUG = (() => {
  const g = grid(22, 20);
  ell(g, 3.5, 11, 3, 4, 'u'); ell(g, 3.5, 11, 1.4, 2.2, '.');         // 손잡이
  ell(g, 11, 12, 7, 6.5, 'u'); rect(g, 6, 4, 11, 5, 'u'); rect(g, 7, 16, 9, 3, 'u');   // 몸통 (바닥 평평)
  for (let y = 2; y < 9; y++) for (let x = 14; x < 22; x++) {           // 주둥이: 입구에서 오른쪽 위로 뾰족한 입술
    if (y >= 2 + (x - 14) * 0 && y >= 4 - (x - 16) * 0.5 && y <= 8 - (x - 14) * 1.0 && x <= 20) put(g, x, y, 'u');
  }
  for (let x = 4; x < 19; x++) if (g[9][x] === 'u') g[9][x] = 'v';     // 계피색 띠 (찻잔과 한 벌)
  for (let y = 10; y < 20; y++) for (let x = 12; x < 22; x++) if (g[y][x] === 'u') g[y][x] = 'U';
  for (let x = 7; x < 18; x++) if (g[4][x] === 'u') put(g, x, 4, 'U');   // 입구 안쪽
  pts(g, 'i', [[7, 11], [7, 12], [8, 10]]);
  outline(g);
  return toRows(g);
})();

/** 유리 티포트 40×32. 손잡이 왼쪽, 주둥이 오른쪽. 물(차 칸)은 몸통 안 '4'. */
export const BREW_TEAPOT = (() => {
  const g = grid(40, 32);
  ell(g, 5, 18, 4, 5.5, '3'); ell(g, 5, 18, 2.5, 4, '.');              // 손잡이 (유리)
  for (let i = 0; i < 9; i++) { rect(g, 31 + i * 0.75 | 0, 22 - i, 2, 2, '3'); }   // 주둥이
  ell(g, 20, 19, 13, 12, '3'); ell(g, 20, 19, 12, 11, '4');            // 몸통
  rect(g, 13, 5, 14, 4, '3'); rect(g, 14, 5, 12, 4, '4');              // 목 (뚜껑 자리 = 거름망이 앉는 곳)
  for (let x = 15; x < 26; x++) put(g, x, 30, '3');
  for (let x = 12; x < 29; x++) put(g, x, 31, '3');                    // 바닥
  return toRows(g);
})();
export const BREW_TEAPOT_FRONT = (() => {
  const g = grid(40, 32);
  for (let x = 13; x < 27; x++) put(g, x, 8, '3');                     // 목 앞쪽 테
  for (let y = 13; y < 25; y++) put(g, 10 + Math.round(Math.abs(y - 18) * 0.35), y, y < 15 ? 'i' : '9');
  for (let y = 12; y < 17; y++) put(g, 29, y, '9');
  return toRows(g);
})();
/** 거름망 16×24 (위 고리 0~2행, 테 3~4행, 철망 5~23행). 찻잎 단계 0 말림 → 1 풀림 → 2 활짝. */
const steepBasket = (stage, lifted = false) => {
  const g = grid(16, 24);
  ell(g, 7.5, 1.5, 2.5, 1.6, '8'); ell(g, 7.5, 1.6, 1.2, 0.8, '.');   // 고리
  rect(g, 0, 3, 16, 2, 'b'); for (let x = 1; x < 15; x++) put(g, x, 4, 'x');   // 테
  for (let y = 5; y < 24; y++) {
    const r = y < 18 ? 5.5 : 5.5 * Math.sqrt(Math.max(0, 1 - ((y - 17.5) / 6.5) ** 2));
    for (let x = 0; x < 16; x++) {
      const d = Math.abs(x - 7.5);
      if (d > r) continue;
      put(g, x, y, d > r - 1 || y === 23 ? '8' : ((x + y) % 3 === 0 && y % 2 === 0 ? '8' : '4'));
    }
  }
  // 찻잎 (철망 안쪽 칸에만). 단계마다 차지하는 높이와 색이 다르다.
  const hash = (x, y) => ((x * 73 + y * 151 + x * y * 7) % 23) / 23;
  const [from, dense, cols] = [[20, 0.45, '55'], [16, 0.6, '556'], [10, 0.72, '5667']][stage];
  for (let y = from; y < 23; y++) for (let x = 2; x < 14; x++) {
    if (g[y][x] !== '4' && !(g[y][x] === '8' && Math.abs(x - 7.5) < 4)) continue;
    const h = hash(x, y);
    const fill = y >= 21 ? dense + 0.25 : dense;
    if (h < fill) put(g, x, y, cols[Math.floor(hash(y, x) * cols.length)]);
  }
  if (lifted) pts(g, 'T', [[6, 23], [10, 23]]);                        // 물방울
  return toRows(g);
};
export const STEEP_BASKET = [0, 1, 2].map((s) => steepBasket(s));
export const STEEP_LIFTED = steepBasket(2, true);

/** 행 목록에서 ch 칸 좌표 (논리 픽셀) */
const cellsOf = (rows, chs, y0 = 0, y1 = rows.length) => {
  const out = [];
  rows.forEach((row, y) => { if (y >= y0 && y < y1) [...row].forEach((ch, x) => { if (chs.includes(ch)) out.push([x, y]); }); });
  return out;
};

/**
 * 차 종류별 미니게임 스프라이트를 scale 정수배로 굽는다 (판 120×96 에 ×2).
 * 좌표·칸은 모두 굽힌 픽셀이 아니라 **논리 픽셀** (×scale 해서 쓴다). 그리는 순서: back → 차 칸 → 조각 → front.
 * - 'ice':   { glass, front, cells, mouth, ice: [작, 중, 큰] }
 *            cells = 차가 차는 안쪽 칸 [[x,y]...] (2~29행), mouth = 입구 안쪽 {x,y,w,h}, floor = 얼음이 닿는 바닥 y
 * - 'milk':  { jug, cup, cupCells, cupMouth, pivot, spout }  (cup 은 POUR_CUP 재사용, pivot = 손잡이 축)
 * - 'steep': { pot, front, cells, basket: [3단계], lifted, seat, drip }
 *            seat = 거름망을 놓을 포트 안 좌표(바구니 왼쪽 위), drip = 건진 거름망에서 물이 떨어지는 점(바구니 기준)
 */
export function bakeBrewSprites(kind, scale = 2) {
  const k = Math.max(1, Math.round(scale));
  const make = (rows) => bake(rows, PALETTE, k, makeCanvas(rows[0].length * k, rows.length * k));
  if (kind === 'ice') {
    return {
      res: k, glass: make(BREW_GLASS), front: make(BREW_GLASS_FRONT),
      cells: cellsOf(BREW_GLASS, '4', 2, 30), mouth: { x: 2, y: 0, w: 14, h: 3 }, floor: 30,
      ice: [ICE_S, ICE_M, ICE_L].map(make),
    };
  }
  if (kind === 'milk') {
    return {
      res: k, jug: make(MILK_JUG), cup: make(POUR_CUP),
      cupCells: cellsOf(POUR_CUP, 'uUv', 3, 15).filter(([x]) => x >= 3 && x <= 18),
      cupMouth: { x: 3, y: 2, w: 16, h: 3 },
      pivot: { x: 3, y: 11 }, spout: { x: 21, y: 2 },
    };
  }
  if (kind === 'steep') {
    return {
      res: k, pot: make(BREW_TEAPOT), front: make(BREW_TEAPOT_FRONT),
      cells: cellsOf(BREW_TEAPOT, '4', 9, 31),
      basket: STEEP_BASKET.map(make), lifted: make(STEEP_LIFTED),
      seat: { x: 12, y: 2 }, drip: { x: 8, y: 24 },
    };
  }
  throw new Error(`bakeBrewSprites: 모르는 종류 '${kind}'`);
}

// 꿈 조각 id → 아이콘 스프라이트. 옛 저장의 제목 id 도 받는다. 모르는 id 는 ITEM_SHARD.
export const ITEM_ICONS = {
  letter: ITEM_LETTER, mug: ITEM_MUG, receipt: ITEM_RECEIPT, shard: ITEM_SHARD, bottle: ITEM_BOTTLE, drawing: ITEM_DRAWING,
  // 고양이 선물
  bottlecap: GIFT_BOTTLECAP, feather: GIFT_FEATHER, button: GIFT_BUTTON, ginkgo: GIFT_GINKGO,
  sock: GIFT_SOCK, ribbon: GIFT_RIBBON, 'tuna-lid': GIFT_TUNA_LID, badge: GIFT_BADGE,
};
const ITEM_ALIAS = { '엄마의 손편지': 'letter', '이 빠진 머그잔': 'mug', '영수증 한 장': 'receipt', '할머니의 물병': 'bottle', '첫째의 그림': 'drawing' };

/** 아이템 id 를 아이콘 이름으로 ('letter' | 'mug' | 'shard') */
export function itemIcon(id) {
  const key = ITEM_ALIAS[id] ?? id;
  return Object.hasOwn(ITEM_ICONS, key) ? key : 'shard';
}

/**
 * 꿈 조각 아이콘을 scale 정수배로 굽는다 (ui.item 카드용).
 * DOM 이 있으면 <canvas> 를 돌려줘서 바로 append 할 수 있다. 크기는 (w×scale, h×scale).
 */
export function bakeIcon(id, scale = 6) {
  const rows = ITEM_ICONS[itemIcon(id)];
  const k = Math.max(1, Math.round(scale));
  const w = rows[0].length * k, h = rows.length * k;
  return bake(rows, PALETTE, k, makeCanvas(w, h));
}

/** 스프라이트를 캔버스로 한 번만 굽는다. scale = 정수배, target = 그려 넣을 캔버스(없으면 새로) */
export function bake(rows, palette = PALETTE, scale = 1, target = null) {
  const c = target ?? new OffscreenCanvas(rows[0].length * scale, rows.length * scale);
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = palette[ch] ?? '#ff00ff';
      g.fillRect(x * scale, y * scale, scale, scale);
    });
  });
  return c;
}
