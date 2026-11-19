// 운세 노트 공통 '사람 특성' 어휘 — 사주·손금·타로가 같은 말로 만나는 곳(M4 설계 §1, §3-1, §3-2).
// 순수 모듈(DOM 없음). 원본은 여기 fortune/lib/ 하나 — 엣지(_infra/saju-traits.js)·브라우저(note.js)·
// Node 테스트(_infra/fortune-note.test.mjs)가 같이 쓴다.
//
// 지키는 것:
//  * id 는 안정 값(영역.이름). 바꾸지 않는다 — 바꿔야 하면 새 id 를 만들고 PALM_ALIAS 같은 대응표에 옛 id 를 남긴다.
//  * 표시명은 언제나 '~한 편'(경향). 단정·금칙(건강·돈·결혼 시기·수명·순위)은 어휘에 넣지 않는다.
//  * axis/pole: 같은 축·같은 극의 다른 id = 가까운 특성, 같은 축 반대 극 = 모순 쌍. pole 0(가운데)은 어느 쪽과도 아니다.

export const TRAITS_VERSION = "traits-v1";

export const DOMAINS = {
  temperament: "성향", thinking: "사고", emotion: "감정", relationship: "관계", work: "일", energy: "에너지",
};

// [id, 표시명(~한 편), 짧은 설명, axis, pole, 한 줄 요약용 이음꼴, 한 줄 요약용 끝꼴]
const ROWS = [
  // 성향
  ["temperament.bold", "먼저 움직이고 밀고 나가는 편", "생각이 서면 행동이 빠르다", "pace", 1, "먼저 움직이고", "먼저 움직이는"],
  ["temperament.careful", "살피고 신중하게 시작하는 편", "시작 전에 둘러보고 확인한다", "pace", -1, "신중하게 시작하고", "신중하게 시작하는"],
  ["temperament.principled", "원칙과 기준이 분명한 편", "옳다고 정한 선을 잘 지킨다", "flex", 1, "기준이 분명하고", "기준이 분명한"],
  ["temperament.flexible", "상황에 맞춰 유연하게 길을 찾는 편", "휘어도 꺾이지 않는다", "flex", -1, "유연하게 길을 찾고", "유연하게 길을 찾는"],
  ["temperament.grounded", "중심을 잡고 꾸준히 버티는 편", "익숙한 자리에서 힘이 난다", "change", -1, "꾸준히 버티고", "꾸준히 버티는"],
  ["temperament.change_seeking", "새 곳과 변화에 끌리는 편", "움직이며 기운을 얻는다", "change", 1, "새 곳에 끌리고", "새 곳에 끌리는"],
  ["temperament.dutiful", "맡은 책임을 지키며 신뢰를 쌓는 편", "규칙과 약속 안에서 인정받는다", "structure", 1, "책임을 지키고", "책임을 지키는"],
  ["temperament.free", "틀에 얽매이지 않고 자유로운 편", "스스로 정한 방식이 편하다", "structure", -1, "틀에 얽매이지 않고", "틀에 얽매이지 않는"],
  // 사고
  ["thinking.logical", "현실적이고 논리적으로 생각하는 편", "사실과 순서를 따진다", "style", 1, "논리적으로 생각하고", "논리적으로 생각하는"],
  ["thinking.imaginative", "상상력과 새로운 발상이 풍부한 편", "없는 것을 그려 본다", "style", -1, "상상력이 풍부하고", "상상력이 풍부한"],
  ["thinking.balanced", "현실 감각과 상상력 사이 균형을 잡는 편", "두 쪽을 함께 쓴다", "style", 0, "현실과 상상 사이 균형을 잡고", "현실과 상상 사이 균형을 잡는"],
  ["thinking.deep", "한 가지를 깊고 넓게 생각하는 편", "생각을 오래 이어 간다", "depth", 1, "깊고 넓게 생각하고", "깊고 넓게 생각하는"],
  ["thinking.quick", "결정이 빠르고 실용적인 편", "필요한 만큼 보고 정한다", "depth", -1, "결정이 빠르고", "결정이 빠른"],
  ["thinking.learner", "배우고 생각하는 힘이 큰 편", "묻고 익히며 자란다", "learn", 1, "배우는 힘이 크고", "배우는 힘이 큰"],
  ["thinking.intuitive", "남들이 놓친 것을 먼저 알아채는 편", "직관과 감이 좋다", "intuition", 1, "먼저 알아채고", "먼저 알아채는"],
  ["thinking.detail", "디테일과 완성도를 챙기는 편", "마무리의 질에 신경 쓴다", "detail", 1, "디테일을 챙기고", "디테일을 챙기는"],
  ["thinking.broad", "관심사가 넓고 시야가 큰 편", "여러 갈래를 한눈에 본다", "focus", -1, "시야가 넓고", "시야가 넓은"],
  // 감정
  ["emotion.expressive", "감정을 겉으로 잘 표현하는 편", "마음이 얼굴과 말에 드러난다", "expr", 1, "감정을 잘 드러내고", "감정을 잘 드러내는"],
  ["emotion.reserved", "마음을 속으로 정리한 뒤 꺼내는 편", "생각을 고른 뒤 말한다", "expr", -1, "마음을 속으로 정리하고", "마음을 속으로 정리하는"],
  ["emotion.steady", "감정을 차분하게 다루는 편", "기복이 크지 않다", "calm", 1, "감정이 차분하고", "감정이 차분한"],
  ["emotion.vivid", "그때그때 감정을 진하게 느끼는 편", "기쁨도 서운함도 크게 온다", "calm", -1, "감정을 진하게 느끼고", "감정을 진하게 느끼는"],
  ["emotion.sensitive", "감수성이 섬세한 편", "작은 변화도 잘 느낀다", "sense", 1, "감수성이 섬세하고", "감수성이 섬세한"],
  // 관계
  ["relationship.idealistic", "관계에서 기준과 이상이 분명한 편", "바라는 관계의 모습이 뚜렷하다", "rel_std", 1, "관계의 기준이 분명하고", "관계의 기준이 분명한"],
  ["relationship.practical", "관계에서도 실속과 자기 페이스를 챙기는 편", "무리하지 않는 거리를 안다", "rel_std", -1, "관계에서도 실속을 챙기고", "관계에서도 실속을 챙기는"],
  ["relationship.balanced", "마음을 주고받는 균형을 챙기는 편", "주는 만큼 받는 것도 본다", "rel_std", 0, "마음을 주고받는 균형을 챙기고", "마음을 주고받는 균형을 챙기는"],
  ["relationship.warm_host", "사람을 모으고 분위기를 띄우는 편", "모임의 온도를 올린다", "social", 1, "분위기를 띄우고", "분위기를 띄우는"],
  ["relationship.selective", "좁고 깊게 사귀고 혼자 시간도 필요한 편", "혼자 충전하는 시간이 있다", "social", -1, "좁고 깊게 사귀고", "좁고 깊게 사귀는"],
  ["relationship.caring", "주변을 챙기고 품는 편", "사람의 사정을 먼저 헤아린다", "tact", 1, "주변을 챙기고", "주변을 챙기는"],
  ["relationship.direct", "돌려 말하기보다 솔직하게 말하는 편", "꾸밈없이 전한다", "tact", -1, "솔직하게 말하고", "솔직하게 말하는"],
  ["relationship.communicative", "말과 생각으로 소통하길 좋아하는 편", "대화로 가까워진다", "talk", 1, "대화를 좋아하고", "대화를 좋아하는"],
  // 일
  ["work.independent", "자기 판단으로 움직이는 편", "혼자서도 해낸다", "indep", 1, "자기 판단으로 움직이고", "자기 판단으로 움직이는"],
  ["work.together", "함께할 때 힘이 나는 편", "곁에 사람이 있으면 더 잘한다", "indep", -1, "함께할 때 힘이 나고", "함께할 때 힘이 나는"],
  ["work.leading", "앞에 서서 길을 내는 편", "무리의 방향을 잡는다", "lead", 1, "앞에 서서 길을 내고", "앞에 서서 길을 내는"],
  ["work.maker", "만들고 표현하는 재주가 있는 편", "결과물로 말한다", "make", 1, "만드는 재주가 있고", "만드는 재주가 있는"],
  ["work.results", "현실 감각이 좋고 결과를 챙기는 편", "계획을 실제로 굴러가게 한다", "results", 1, "결과를 챙기고", "결과를 챙기는"],
  ["work.hands_on", "직접 해 보며 익히는 편", "부딪혀 보며 배운다", "learn", -1, "직접 해 보며 익히고", "직접 해 보며 익히는"],
  ["work.direction", "자기 길에 대한 방향감이 뚜렷한 편", "가고 싶은 쪽을 안다", "direction", 1, "가고 싶은 길이 뚜렷하고", "가고 싶은 길이 뚜렷한"],
  // 에너지
  ["energy.outgoing", "활동적이고 에너지를 바깥으로 쓰는 편", "움직이며 힘을 낸다", "out", 1, "에너지를 바깥으로 쓰고", "에너지를 바깥으로 쓰는"],
  ["energy.conserving", "에너지를 아껴 두었다가 집중해서 쓰는 편", "쓸 때 몰아서 쓴다", "out", -1, "에너지를 아꼈다 몰아 쓰고", "에너지를 아꼈다 몰아 쓰는"],
  ["energy.immersive", "한번 몰입하면 끝까지 파고드는 편", "한 가지에 깊이 빠진다", "focus", 1, "한번 몰입하면 끝까지 가고", "한번 몰입하면 끝까지 가는"],
];

export const TRAITS = Object.fromEntries(ROWS.map(([id, label, desc, axis, pole, and, adn]) =>
  [id, { id, domain: id.split(".")[0], label, desc, axis, pole, short: { and, adn } }]));

// 손금 초안 id(palm-lab m2_run.py 의 TRAITS·HAND_TYPE) → 공통 id. 표에 없는 id 는 그대로 쓴다(§1-3).
// 손 모양 '4원소'는 서양 원소라 사주 오행 '화'와 이름이 겹쳐 뜻으로 바꿨다.
export const PALM_ALIAS = {
  "emotion.inward": "emotion.reserved",
  "work.careful_start": "temperament.careful",
  "thinking.quick": "thinking.quick",
  "focus.immersive": "energy.immersive",
  "hand.fire": "temperament.bold",
  "hand.earth": "work.hands_on",
  "hand.air": "relationship.communicative",
  "hand.water": "emotion.sensitive",
};
// 손금 확신도(high/medium/low) → 공통 숫자. 사주 단독 특성(0.5)을 밀어내지 않게 high 는 0.55(§9-1 발견 1).
export const PALM_CONF = { high: 0.55, medium: 0.45, low: 0.3 };

// 손금 판독이 내는 축 — '사주가 본 것을 손금으로도 맞춰 볼 수 있는' 축(§6-3).
export const PALM_AXES = ["expr", "calm", "rel_std", "style", "depth", "pace", "indep", "out", "focus", "direction", "talk", "sense", "learn"];

// 타로 상태(state) 어휘(§1-4). lean: 바탕 카드와 엇갈리는지 볼 때만 쓴다 — 겹침 점수에는 절대 더하지 않는다.
export const STATES = {
  "state.starting": { label: "새로 시작하려는 때", lean: ["pace", 1] },
  "state.moving": { label: "힘이 붙어 나아가는 때", lean: ["pace", 1] },
  "state.growing": { label: "키워 온 것이 자라는 때", lean: null },
  "state.ordering": { label: "틀과 균형을 잡는 때", lean: ["structure", 1] },
  "state.learning": { label: "배우고 묻는 때", lean: ["learn", 1] },
  "state.choosing": { label: "마음이 갈림길에 선 때", lean: null },
  "state.pausing": { label: "멈춰서 안을 들여다보는 때", lean: ["pace", -1] },
  "state.changing": { label: "흐름이 바뀌는 때", lean: ["change", 1] },
  "state.closing": { label: "한 시기를 정리하는 때", lean: null },
  "state.noticing": { label: "나를 묶는 것을 알아차리는 때", lean: null },
  "state.enduring": { label: "부드럽게 버티는 때", lean: ["change", -1] },
};
export const CARD_STATE = {
  maj_00: "state.starting", maj_01: "state.starting", maj_02: "state.pausing", maj_03: "state.growing",
  maj_04: "state.ordering", maj_05: "state.learning", maj_06: "state.choosing", maj_07: "state.moving",
  maj_08: "state.enduring", maj_09: "state.pausing", maj_10: "state.changing", maj_11: "state.ordering",
  maj_12: "state.pausing", maj_13: "state.closing", maj_14: "state.ordering", maj_15: "state.noticing",
  maj_16: "state.changing", maj_17: "state.growing", maj_18: "state.pausing", maj_19: "state.moving",
  maj_20: "state.changing", maj_21: "state.closing",
  // 마이너(2026-11-16, 78장 덱) — '지금 상황'으로 분명히 읽히는 카드만. 나머지 27장은 흐름을 억지로 만들지 않는다(요즘 줄 없음).
  wands_01: "state.starting", wands_02: "state.choosing", wands_03: "state.growing", wands_07: "state.enduring", wands_08: "state.moving", wands_11: "state.learning", wands_12: "state.changing",
  cups_01: "state.starting", cups_04: "state.pausing", cups_07: "state.choosing", cups_08: "state.changing", cups_11: "state.learning", cups_12: "state.moving",
  swords_01: "state.starting", swords_02: "state.choosing", swords_04: "state.pausing", swords_06: "state.changing", swords_08: "state.noticing", swords_10: "state.closing", swords_11: "state.learning", swords_12: "state.moving", swords_14: "state.ordering",
  pentacles_01: "state.starting", pentacles_02: "state.ordering", pentacles_05: "state.enduring", pentacles_07: "state.pausing", pentacles_08: "state.learning", pentacles_09: "state.growing", pentacles_11: "state.learning",
};

// 어휘·문구에 넣지 않는 말(§1-5) — 규칙표·템플릿 문장·(나중) LLM 출력 검사가 같이 쓴다.
export const BANNED_RE = /(건강|질병|병에|수명|단명|장수|사고(?:가|를|수)|다치|수술|사망|이혼|파혼|투자|주식|코인|로또|도박|대박|횡재|재물운|돈복|부자|반드시|틀림없|절대(?:로)?|운명(?:이에요|입니다)|정해져 있|무조건|정확도|적중)/;

// 모순 쌍(§3-1). ① 같은 축 반대 극은 축 표에서 자동으로 나온다. ② 축은 다르지만 한 사람에게 같이 말하면
// 모순으로 읽히는 쌍은 손으로 적는다 — 새로 걸리는 쌍이 나오면 여기 더하고, 결정적 검사가 다음부터 막는다.
export const CROSS_CONFLICTS = [
  ["temperament.careful", "thinking.quick"],          // 살피고 시작 ↔ 결정이 빠름
  ["emotion.reserved", "relationship.warm_host"],     // 속으로 정리 ↔ 분위기를 띄움
  ["emotion.reserved", "relationship.direct"],        // 속으로 정리 ↔ 솔직하게 말함
  ["relationship.selective", "energy.outgoing"],      // 혼자 시간 ↔ 에너지를 바깥으로
  ["temperament.free", "temperament.principled"],     // 틀에 얽매이지 않음 ↔ 원칙이 분명
  ["temperament.grounded", "energy.outgoing"],        // 익숙한 자리에서 힘 ↔ 움직이며 힘
];

export function conflicts(a, b) {
  if (a === b) return false;
  const A = TRAITS[a], B = TRAITS[b];
  if (A && B && A.pole && A.axis === B.axis && A.pole === -B.pole) return true;
  return CROSS_CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// 같은 축 ± 쌍 전체(표 확인용)
export function axisPairs() {
  const out = [];
  for (const A of Object.values(TRAITS)) for (const B of Object.values(TRAITS))
    if (A.pole === 1 && B.pole === -1 && A.axis === B.axis) out.push([A.id, B.id]);
  return out;
}

// 역할 나눔(§3-2) — 문장 틀이지 모순을 설명하는 장치가 아니다. "바탕은 A인데 습관은 B" 같은 대비는 만들지 않는다.
export const ROLE = { saju: "타고난 바탕", palm: "살아오며 드러난 습관", tarot: "요즘" };
export const SOURCE_NAME = { saju: "사주", palm: "손금", tarot: "타로" };
