// 블렌딩 판정. 순수 함수 — DOM·캔버스 없이 테스트한다 (tests/blend.test.mjs).
//
// 손님은 정답을 말해 주지 않는다. 가장 크게 어긋난 한 가지만 "기억과 다른 점"으로
// 돌려준다. 그래서 플레이어는 한 번에 하나씩 고쳐 가며 맛을 좁혀 간다.

// 손님 대사표. 손님·밤마다 다른 표를 judge() 의 세 번째 인자로 넘긴다.
// 대사는 story 탭이 쓰고, 이 파일에는 밤 1(하린) 기본 표만 둔다.
//   perfect, temp, empty, base{찻물id|default}, missing{재료id}, mixup{정답id:{착각id}}, extra{재료id}, extraDefault
export const HARIN_N1_LINES = {
  perfect: '…이거예요. 이 맛이에요.',
  temp: '차가운 건 아니었어요. 컵을 쥐면 손이 따뜻했거든요.',
  empty: '그냥… 물 맛이에요.',
  base: {
    green: '찻잎 맛이 나요. 그건 아니었어요… 더 맑았어요.',
    black: '찻잎 맛이 진해요. 엄마는 차를 우리진 않았어요.',
    default: '구수하네요. 좋지만… 그 맛은 아니에요.',
  },
  missing: {
    yuja: '달콤한 건 비슷한데… 과일 껍질 같은 향긋함이 빠졌어요.',
    ginger: '뭔가 모자라요. 마시면 목이 확 데워지는 게 있었는데.',
  },
  mixup: {
    yuja: { lemon: '새콤한 건 맞아요. 그런데 이건 너무 시어요… 더 달고 부드러웠어요.' },
    ginger: { cinnamon: '따뜻한 향인데, 이건 달큰한 쪽이에요. 더 알싸했어요.' },
  },
  extra: {
    lemon: '레몬처럼 톡 쏘진 않았어요. 더 순했어요.',
    cinnamon: '이 향은 기억에 없어요. 좀 더 깔끔했어요.',
    milk: '우유는 안 들어갔어요. 더 맑은 색이었거든요.',
    chamomile: '꽃 향은… 아니었던 것 같아요.',
    mint: '화한 맛은 아니었어요. 오히려 몸이 데워졌는데.',
  },
  extraDefault: '이건 안 들어갔던 것 같아요.',
};

/**
 * @param {{base:string, temp:string, additions:string[]}} brew
 * @param {{base:string, temp:string, required:string[], allowed:string[]}} recipe
 * @param {object} [L]  대사표 (HARIN_N1_LINES 형식). 빠진 칸은 밤 1 표로 채운다
 * @returns {{ok:boolean, closeness:number, reason:string, line:string}}
 *   closeness: 0~1, 김의 색으로 "얼마나 가까운지" 보여주는 데 쓴다.
 *   reason: 어긋난 항목 (테스트·로그용)
 */
export function judge(brew, recipe, L = HARIN_N1_LINES) {
  const D = HARIN_N1_LINES;
  const line = (path) => path.reduce((o, k) => o?.[k], L);
  const adds = new Set(brew.additions);
  const okSet = new Set([...recipe.required, ...recipe.allowed]);
  const missing = recipe.required.filter((id) => !adds.has(id));
  const extras = [...adds].filter((id) => !okSet.has(id));

  // 가까움: 맞춘 요소 수 / 전체 요소 수. 군더더기 재료는 감점.
  const total = 2 + recipe.required.length;
  let hit = (brew.temp === recipe.temp ? 1 : 0) + (brew.base === recipe.base ? 1 : 0)
    + (recipe.required.length - missing.length);
  hit = Math.max(0, hit - extras.length * 0.5);
  const closeness = Math.round((hit / total) * 100) / 100;

  const ok = missing.length === 0 && extras.length === 0
    && brew.temp === recipe.temp && brew.base === recipe.base;
  if (ok) return { ok, closeness: 1, reason: 'perfect', line: L.perfect ?? D.perfect };

  // 가장 크게 어긋난 것부터 하나만 말한다: 온도 → 찻물 → 빠진 재료 → 군더더기
  if (brew.temp !== recipe.temp) return { ok, closeness, reason: 'temp', line: L.temp ?? D.temp };
  if (brew.base !== recipe.base) {
    return { ok, closeness, reason: 'base', line: line(['base', brew.base]) ?? line(['base', 'default']) ?? D.base.default };
  }
  if (adds.size === 0) return { ok, closeness, reason: 'empty', line: L.empty ?? D.empty };
  for (const id of missing) {
    const mixup = Object.keys(L.mixup?.[id] ?? {}).find((m) => adds.has(m));
    if (mixup) return { ok, closeness, reason: `mixup:${id}:${mixup}`, line: L.mixup[id][mixup] };
  }
  if (missing.length) {
    return { ok, closeness, reason: `missing:${missing[0]}`, line: line(['missing', missing[0]]) ?? '뭔가 하나 빠진 것 같아요.' };
  }
  const extra = extras[0];
  return { ok, closeness, reason: `extra:${extra}`, line: line(['extra', extra]) ?? L.extraDefault ?? D.extraDefault };
}

/** 찻잔에 담긴 차의 색: 찻물 색에 재료 색을 섞는다 */
export function brewColor(baseColor, tints) {
  const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let rgb = parse(baseColor);
  for (const t of tints) {
    const c = parse(t);
    rgb = rgb.map((v, i) => Math.round(v * 0.55 + c[i] * 0.45));
  }
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * 틀릴수록 쉬워진다 (사용자 2026-11-18). 블렌딩 판에서 🐾 로 살짝 표시할 정답 재료.
 *   1번 틀림: 손님 반응만 · 2번: 고양이 힌트(대본) · 3번: 찻물·온도 🐾 · 4번부터: 넣을 것까지 🐾
 * @returns {{base?:string, temp?:string, additions:string[]}}
 */
export function assistFor(recipe, tries) {
  const hint = { additions: [] };
  if (tries >= 3) { hint.base = recipe.base; hint.temp = recipe.temp; }
  if (tries >= 4) hint.additions = [...recipe.required];
  return hint;
}
