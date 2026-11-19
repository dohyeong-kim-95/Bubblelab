// 재료·찻물·손님 데이터. 게임 로직(blend.js)과 화면이 함께 쓴다.

export const BASES = [
  { id: 'water',  name: '맑은 물',  color: '#d9e7f0', note: '아무 맛도 없는 맑은 물' },
  { id: 'green',  name: '녹차',    color: '#a9c46a', note: '풋풋하고 쌉쌀한 찻잎' },
  { id: 'black',  name: '홍차',    color: '#a8553a', note: '진하고 떫은 찻잎' },
  { id: 'barley', name: '보리차',  color: '#c99a5b', note: '구수한 볶은 보리' },
];

export const TEMPS = [
  { id: 'hot',  name: '뜨겁게' },
  { id: 'cold', name: '차갑게' },
];

// tint: 찻잔 색을 섞을 때 쓰는 색. icon: 픽셀 아이콘 이름 (scene.js)
export const ADDITIONS = [
  { id: 'yuja',      name: '노란 병',  tint: '#f2c230', note: '달고 향긋한 과일 껍질 절임' },
  { id: 'ginger',    name: '생강',     tint: '#e0b070', note: '알싸하고 몸을 데우는 뿌리' },
  { id: 'honey',     name: '꿀',       tint: '#f0a830', note: '부드럽게 단맛' },
  { id: 'lemon',     name: '레몬',     tint: '#f4e04a', note: '톡 쏘게 신맛' },
  { id: 'cinnamon',  name: '계피',     tint: '#9a5a32', note: '달큰하고 따뜻한 향' },
  { id: 'milk',      name: '우유',     tint: '#f4efe4', note: '고소하고 뽀얀 맛' },
  { id: 'chamomile', name: '캐모마일', tint: '#f0e0a0', note: '사과를 닮은 꽃 향' },
  { id: 'mint',      name: '민트',     tint: '#9ad6a0', note: '화하고 시원한 잎' },
];

export const MAX_ADDITIONS = 3;

// 하린이 기억하는 맛: 뜨거운 맑은 물 + 노란 병(유자청) + 생강. 꿀은 넣어도 괜찮다.
export const HARIN_RECIPE = {
  base: 'water',
  temp: 'hot',
  required: ['yuja', 'ginger'],
  allowed: ['honey'],
};
export const HARIN_N1_RECIPE = HARIN_RECIPE;

// 밤 2 — 엄마가 장부 쓰며 마시던 식은 차: 보리차 · 차갑게 · 계피 + 꿀
export const HARIN_N2_RECIPE = {
  base: 'barley',
  temp: 'cold',
  required: ['cinnamon', 'honey'],
  allowed: [],
};

// 태오 — 3년 만난 사람과 헤어진 비 오는 밤. 처음 데이트한 카페의 시나몬 밀크티: 홍차 · 뜨겁게 · 우유 + 계피
export const TAEO_RECIPE = {
  base: 'black',
  temp: 'hot',
  required: ['milk', 'cinnamon'],
  allowed: ['honey'],
};

// 다희 ① — 야간 근무 끝, 낮에 못 자는 몸. 할머니 댁 냉장고 보리차: 보리차 · 차갑게 · 아무것도 안 넣음 ("빼기")
export const DAHUI_RECIPE = {
  base: 'barley',
  temp: 'cold',
  required: [],
  allowed: [],
};

// 수경 — 새벽 수유에 지친 엄마. 어릴 때 아빠가 데워 준 꽃 우유: 맑은 물 · 뜨겁게 · 우유 + 꿀 + 캐모마일 (3칸 다 채우기)
export const SUKYUNG_RECIPE = {
  base: 'water',
  temp: 'hot',
  required: ['milk', 'honey', 'chamomile'],
  allowed: [],
};

// 고양이 선물함 (사용자 2026-11-18). 문장: story 탭 docs/story/cat-gifts.md 표 그대로.
// 밤이 끝날 때 가끔 고양이가 물어 온다 — 언제 주는지는 CAT_GIFT_NIGHTS.
export const CAT_GIFTS = [
  { id: 'bottlecap', name: '병뚜껑', body: '찌그러진 사이다 병뚜껑. 고양이는 이걸 보물이라고 생각한다. 반박하지 않기로 했다.' },
  { id: 'feather', name: '비둘기 깃털', body: '회색 깃털 한 가닥. 나머지 비둘기는 어디 있는지 묻지 않기로 했다.' },
  { id: 'button', name: '코트 단추', body: '갈색 코트 단추. 누군가 지금쯤 바람 들어오는 코트를 입고 있을 것이다.' },
  { id: 'ginkgo', name: '은행잎', body: '노랗게 마른 은행잎. 냄새 나는 열매가 아니라 잎이라서 정말 다행이다.' },
  { id: 'sock', name: '양말 한 짝', body: '줄무늬 양말 한 짝. 나머지 한 짝을 찾는 사람이 이 동네 어딘가에 있다.' },
  { id: 'ribbon', name: '빵집 끈', body: '빨간 줄무늬 포장 끈. 갓 구운 빵 냄새가 살짝 남아 있다. 고양이가 오늘 어디 다녀왔는지 알겠다.' },
  { id: 'tuna-lid', name: '참치캔 뚜껑', body: '깨끗하게 씻긴 참치캔 뚜껑. 누가 이렇게 깨끗이 씻어 뒀을까. 고양이는 이걸 꼭 내 앞에 둔다.' },
  { id: 'badge', name: '이름 없는 명찰', body: '어느 카페 직원 명찰. 이름이 적혀 있었을 자리가 부러져 없다. …이상하게 손에 익다.' },
];

/** 밤 n 이 끝난 뒤 고양이가 물어 오는 선물 (매 밤은 아니다). 밤 2·4·6 … */
export const CAT_GIFT_NIGHTS = { 2: 'bottlecap', 4: 'feather', 6: 'button' };
