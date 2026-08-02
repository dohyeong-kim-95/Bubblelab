// 비전 부품 검사 — "이 프레임에 귀가 몇 개인가"를 모델에게 직접 묻는다.
//
// 왜 이걸 쓰는가: 사람 검수 불합격 6건 중 5건이 여분 사지였는데(귀 3·4개,
// 팔·손 4개) 픽셀 지표로는 하나도 안 잡혔고, 기하 검출도 두 설계 모두
// 실패했다 (work/emoticon/lesson_learned.md §42~43):
//   · 머리 위 가로 스캔 → 처진 귀는 머리 옆이라 안 잡힘
//   · 레퍼런스 실루엣 밖 면적 → 정상 동작(팔 들기 7%)과 구분 안 되고
//     nod11의 팔 4개는 0.1%로 신호 자체가 없음
// 개수 세기는 VLM이 잘하는 일이고, 텍스트 응답이라 이미지 생성보다 싸다.
//
// 프롬프트는 세는 대상을 **명시적으로 정의**한다. "귀"처럼 짧게 물으면
// 겹친 귀를 하나로 셀 수 있어서, 형태 단위로 세라고 못박는다.

export function partsPrompt(parts) {
  const list = parts.map((p) => `  "${p.key}": ${p.what}`).join("\n");
  return [
    "You are inspecting one frame of a cartoon sticker animation for drawing defects.",
    "Count the parts below by SHAPE, not by what the creature should have:",
    "if two shapes overlap or one droops behind another, they are still two shapes.",
    "Count every shape that is drawn, including duplicates and stray ones.",
    "",
    "Parts to count:",
    list,
    "",
    'Reply with JSON only: {"' + parts.map((p) => p.key).join('": 0, "') + '": 0}',
  ].join("\n");
}

export function parseCounts(text, parts) {
  let data;
  try { data = JSON.parse(text); } catch {
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) throw new Error(`부품 응답을 JSON으로 읽을 수 없습니다: ${text.slice(0, 120)}`);
    data = JSON.parse(match[0]);
  }
  const counts = {};
  for (const part of parts) {
    const value = data[part.key];
    if (!Number.isInteger(value) || value < 0 || value > 20) {
      throw new Error(`${part.key} 개수가 이상합니다: ${JSON.stringify(value)}`);
    }
    counts[part.key] = value;
  }
  return counts;
}

// parts: [{ key, what, expected }]
// ask: (imageB64) => Promise<string>  — 프로바이더 주입 (테스트에서 대체)
// 초과는 항상 결함이다 — 13컷 82프레임에서 초과(귀 3·4개, 팔 4개)는 전부
// 진짜 결함이었다.
//
// 부족은 **부위에 따라 다르다.** 처음엔 "부족 = 겹침"으로 뭉뚱그려 경고로
// 내렸는데, 그건 팔에서 뽑은 결론이었고 blink1에서 틀린 게 드러났다:
// 눈 1개 경고를 흘려보냈더니 실제로는 눈꺼풀이 얼굴 전체를 덮은 불량
// 프레임이었다. 정면 뷰에서 **눈·귀는 가려질 일이 없고**(occludable: false)
// 팔만 몸에 겹쳐 가려질 수 있다(occludable: true).
export async function inspectParts({ framesB64, parts, ask }) {
  const counts = [];
  const violations = [];
  const warnings = [];
  for (const [index, imageB64] of framesB64.entries()) {
    const text = await ask(imageB64, partsPrompt(parts));
    const found = parseCounts(text, parts);
    counts.push(found);
    for (const part of parts) {
      if (typeof part.expected !== "number" || found[part.key] === part.expected) continue;
      const item = { frame: index + 1, part: part.key, found: found[part.key], expected: part.expected };
      const soft = found[part.key] < part.expected && part.occludable;
      (soft ? warnings : violations).push(item);
    }
  }
  return { counts, violations, warnings };
}

// 우리 토끼 기본값. 캐릭터마다 다르면 컷 스펙에서 덮어쓴다.
export const RABBIT_PARTS = [
  { key: "ears", what: "long rabbit ear shapes attached to the head (upright, drooping, or behind)", expected: 2 },
  // 팔·발은 몸에 겹쳐 가려질 수 있다 — wave가 팔을 들면 실제로 1개로 세어지고,
  // 점프 프레임에서 발을 몸 아래로 접으면 발이 안 보인다.
  //
  // arms와 feet를 반드시 나눠서 묻는다. 예전에는 arms 설명이 "arm or paw"라
  // 웅크린 자세에서 **발까지 팔로 세어** arms 4를 신고했고, 그걸 오탐으로
  // 기각했다가 진짜 다리 과다를 놓칠 뻔했다(lesson_learned §56).
  { key: "arms", what: "arm shapes attached to the upper half of the body, at or above the waist (a folded pair on the belly counts as two)", expected: 2, occludable: true },
  { key: "feet", what: "foot or leg shapes hanging below the body at the bottom of the silhouette", expected: 2, occludable: true },
  { key: "eyes", what: "eye shapes on the face (open circles or closed arcs both count)", expected: 2 },
];
