// 이모티콘 프롬프트 조립 + 자동 검사 (규약은 work/emoticon/doc/prompting.md).
//
// 세 가지 규칙을 코드로 강제한다:
//  1. 부정어 0개 — Gemini는 "그리지 마라"를 "그려라"로 읽는 경향이 있고
//     negative_prompt 파라미터도 없다. 실측으로 재현됐다(앞발 젤리, 귀 3개).
//  2. 변화가 먼저, 불변이 나중 — 충돌 시 먼저 언급된 쪽이 이긴다. 불변을
//     앞에 두면 프레임이 아예 안 움직인다(nod3·nod4).
//  3. 모순 금지 — "같은 크기" + "눌린다"는 논리 모순이라 부피 보존으로 번역한다.

// 부정 표현. Gemini 경로에서는 하나라도 있으면 조립을 실패시킨다.
const NEGATION_PATTERNS = [
  /\bno\b/i, /\bnot\b/i, /\bnever\b/i, /\bdon'?t\b/i, /\bdoes ?n'?t\b/i,
  /\bavoid\b/i, /\bwithout\b/i, /\bremove\b/i, /\bexclude\b/i, /\bomit\b/i,
  /\bfree of\b/i, /\bfree from\b/i,
  /그리지\s*마/, /하지\s*마/, /금지/, /없이/, /없는/, /말\s*것/,
];

// 모순 쌍: 크기·형태 고정과 변형 지시가 한 프롬프트에 같이 오면 안 된다.
// 캐릭터 몸의 크기·형태를 고정하는 표현만 잡는다. 캔버스 크기 고정은 정상이므로
// body/character/silhouette 같은 대상어가 가까이 있을 때만 모순으로 본다.
const FIXED_SIZE = /((body|character|silhouette|몸통|캐릭터)[^.\n]{0,40}(exactly the same|identical|same)\s+(size|shape|silhouette|scale)|(exactly the same|identical|same)\s+(body |character )?(size|shape|silhouette|scale)[^.\n]{0,20}(body|character|몸통)|몸통[^.\n]{0,20}크기[^.\n]{0,10}(동일|그대로|고정))/i;
const DEFORMATION = /(squash|stretch|compress|flatten|눌리|찌그|늘어)/i;

// 변형·크기 지시는 배율을 숫자로 못박아야 한다. 열린 형용사("spreads wider")는
// 상한 없는 지시로 읽혀 실측에서 가로가 +33% 퍼졌다 (prompting.md §4-1).
const OPEN_SCALE = /\b(wider|taller|shorter|bigger|larger|smaller|thinner|flatter|narrower)\b/i;
const RATIO = /\b\d+\.\d+\b|\b\d+\s*(times|배|%|x)\b/i;

export function findNegations(text) {
  return NEGATION_PATTERNS.filter((re) => re.test(text)).map((re) => String(re));
}

export function assertPromptRules(text, label = "프롬프트") {
  const negations = findNegations(text);
  if (negations.length) {
    throw new Error(
      `${label}에 부정 표현이 있습니다: ${negations.join(", ")} — ` +
      "부정어는 오히려 그 대상을 불러옵니다. 원하는 상태를 긍정으로 쓰거나 " +
      "부품 인벤토리로 대체하세요 (work/emoticon/doc/prompting.md §2)",
    );
  }
  if (FIXED_SIZE.test(text) && DEFORMATION.test(text)) {
    throw new Error(
      `${label}에 모순이 있습니다: 크기 고정 지시와 변형 지시가 함께 있습니다 — ` +
      '"부피감은 보존되고 세로 0.85배·가로 1.12배로 퍼진다"처럼 부피 보존으로 ' +
      "표현하세요 (work/emoticon/doc/prompting.md §4)",
    );
  }
  return text;
}

// 포즈 문장 전용 검사. 캔버스·레이아웃 서술("smaller side views")에 걸리지
// 않도록 조립된 프롬프트 전체가 아니라 포즈 문장에만 적용한다.
export function assertPoseScale(pose, label = "포즈") {
  if ((OPEN_SCALE.test(pose) || DEFORMATION.test(pose)) && !RATIO.test(pose)) {
    throw new Error(
      `${label}에 배율 없는 변형 지시가 있습니다 — "wider/squash" 같은 열린 표현은 ` +
      '상한 없이 읽힙니다(실측 가로 +33%). "0.92 times as tall and 1.08 times as ' +
      'wide, its volume preserved"처럼 숫자로 쓰세요 (work/emoticon/doc/prompting.md §4-1)',
    );
  }
  return pose;
}

// 캐릭터 공통 블록. 프레임마다 **바이트 단위로 동일**해야 한다 —
// 동의어로 바꾸는 것조차 모델에게는 새 지시다.
export function canonBlock({ parts = "", style = "" } = {}) {
  return [
    "IDENTITY — same as Image 1:",
    "  the same character, the same colors, the same head-to-body ratio,",
    "  the same uniform black outline weight, the same flat cel-shaded style" +
      (style ? `, ${style}` : ""),
    ...(parts ? [`PARTS — everything visible in the frame:`, `  ${parts}`] : []),
    "CANVAS:",
    "  the background is a solid white surface",
    "  a square 1:1 canvas matching Image 1",
    "  a front view at eye level; the character's feet rest on the same baseline as Image 1",
  ].join("\n");
}

export function sheetPrompt(description) {
  return assertPromptRules([
    `Draw a character reference sheet for a sticker character: ${description}`,
    "Layout: one large full-body front view, plus smaller side and back views,",
    "  plus four expression heads (happy, sad, angry, surprised).",
    "Style: a flat sticker illustration with clean thick outlines.",
    "The background is a solid white surface and the canvas holds only the character drawings.",
    "This sheet is the reference for every later frame, so the colors, proportions and",
    "accessories stay clear and consistent.",
  ].join("\n"), "시트 프롬프트");
}

// 키 포즈: 변화(POSE) → 불변(CANON) 순서. prompting.md §3.
export function keyPrompt({ motion, index, total, pose, constants = "", canon }) {
  const text = assertPromptRules([
    "Redraw the character from Image 1 in a new pose.",
    "",
    `POSE — the only thing that differs in this frame (key ${index} of ${total} in "${motion}"):`,
    `  ${pose}`,
    "  Exaggerate this pose so the silhouette reads at a glance.",
    ...(constants ? [`  Throughout "${motion}", in every frame: ${constants}`] : []),
    "",
    canon,
  ].join("\n"), `키 ${index} 프롬프트`);
  assertPoseScale(pose, `키 ${index} 포즈`);
  return text;
}

// 브레이크다운: 두 키 사이의 중간. 시트·키A·키B 3장이 입력이며
// gemini-2.5-flash-image의 권장 상한(3장)에 정확히 맞는다.
// constants는 두 키에서 **똑같이 참인 포즈 사실**이다. "A와 B의 중간"만으로는
// 사양이 약해서, 두 키 어디에도 없는 형태를 브레이크다운이 지어낸다 —
// 실측(nod6): 두 키 모두 귀가 서 있는데 브레이크다운만 처진 귀를 그렸다.
export function breakdownPrompt({ motion, poseA, poseB, constants = "", note = "", canon, percent = 50 }) {
  return assertPromptRules([
    "Draw the in-between frame between Image 2 and Image 3.",
    "",
    `TIMING — this frame sits ${percent}% of the way from Image 2 to Image 3 in "${motion}".`,
    "MOTION — the only thing that differs in this frame:",
    `  Image 2 shows: ${poseA}`,
    `  Image 3 shows: ${poseB}`,
    "  Draw the halfway state between them. Hands and head travel along a natural arc,",
    "  so this frame sits slightly off the straight line between the two.",
    // 오버래핑 액션은 브레이크다운에서만 참이다 — 키에 쓰면 최하점이 흐려진다.
    ...(note ? [`  ${note}`] : []),
    ...(constants ? [`  Both Image 2 and Image 3 hold this, and so does this frame: ${constants}`] : []),
    "",
    canon,
  ].join("\n"), "브레이크다운 프롬프트");
}
