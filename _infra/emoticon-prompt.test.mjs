import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPromptRules, breakdownPrompt, canonBlock, findNegations, keyPrompt, sheetPrompt,
} from "./emoticon-prompt.mjs";

const canon = canonBlock({ parts: "two ears, two eyes, one mouth, two arms, two legs" });

test("부정어는 조립 단계에서 차단된다", () => {
  // 실측: "NO paw pads" → 앞발 젤리가 생겼고, "never more than two ears" → 귀 3개.
  for (const bad of [
    "do not draw paw pads",
    "the paws have no pads",
    "never show a tail",
    "the head tilts without rotating",
    "그림자를 그리지 마",
    "장식 없이 단순하게",
  ]) {
    assert.throws(
      () => keyPrompt({ motion: "x", index: 1, total: 1, pose: bad, canon }),
      /부정 표현/,
      `차단되어야 함: ${bad}`,
    );
  }
});

test("긍정 서술과 부품 인벤토리는 통과한다", () => {
  const ok = keyPrompt({
    motion: "waving",
    index: 1,
    total: 2,
    pose: "the arm on the left side of the image is raised beside the head with the paw open",
    canon,
  });
  assert.deepEqual(findNegations(ok), []);
  assert.match(ok, /two ears, two eyes/);
});

test("크기 고정과 변형 지시가 함께 오면 모순으로 막는다", () => {
  assert.throws(
    () => keyPrompt({
      motion: "nod", index: 2, total: 2,
      pose: "the body keeps exactly the same size while it squashes down",
      canon,
    }),
    /모순/,
  );
  // 부피 보존 표현은 통과해야 한다 (권장 대안)
  assert.doesNotThrow(() => keyPrompt({
    motion: "nod", index: 2, total: 2,
    pose: "the body squashes to 0.85 vertically and widens to 1.12, its volume preserved",
    canon,
  }));
});

test("캔버스 크기 고정은 모순이 아니다 (오탐 방지)", () => {
  // CANON 블록은 캔버스를 Image 1에 맞추라고 한다 — 이건 정상이고
  // squash 지시와 함께 와도 막히면 안 된다.
  assert.doesNotThrow(() => keyPrompt({
    motion: "bounce", index: 1, total: 1,
    pose: "the body squashes to 0.8 vertically on landing, volume preserved",
    canon,
  }));
});

test("배율 없는 열린 변형 지시는 막는다", () => {
  // 실측(nod5): "spreads wider as it compresses" → 가로 +33% (부피 보존이면 +22%)
  for (const bad of [
    "the body spreads wider as it compresses",
    "the character gets shorter and flatter",
    "the body squashes on landing",
  ]) {
    assert.throws(
      () => keyPrompt({ motion: "x", index: 1, total: 1, pose: bad, canon }),
      /배율/,
      `차단되어야 함: ${bad}`,
    );
  }
  assert.doesNotThrow(() => keyPrompt({
    motion: "nod", index: 2, total: 2,
    pose: "the whole character is 0.92 times as tall and 1.08 times as wide, its volume preserved",
    canon,
  }));
});

test("변화(POSE)가 불변(IDENTITY)보다 먼저 온다", () => {
  // 충돌 시 먼저 언급된 쪽이 이긴다. 불변이 앞이면 프레임이 안 움직인다(nod3·nod4).
  const prompt = keyPrompt({ motion: "nod", index: 2, total: 2, pose: "the head sinks down", canon });
  assert.ok(prompt.indexOf("POSE") < prompt.indexOf("IDENTITY"), "POSE가 IDENTITY보다 앞");
  assert.ok(prompt.indexOf("IDENTITY") < prompt.indexOf("CANVAS"), "IDENTITY가 CANVAS보다 앞");
});

test("CANON 블록은 호출마다 바이트 단위로 동일하다", () => {
  const a = canonBlock({ parts: "two ears" });
  const b = canonBlock({ parts: "two ears" });
  assert.equal(a, b);
  // 키와 브레이크다운이 같은 상수 블록을 공유한다
  const key = keyPrompt({ motion: "m", index: 1, total: 2, pose: "p", canon: a });
  const bd = breakdownPrompt({ motion: "m", poseA: "p", poseB: "q", canon: a });
  assert.ok(key.includes(a) && bd.includes(a));
});

test("브레이크다운은 타이밍과 두 키를 인덱스로 지칭한다", () => {
  const bd = breakdownPrompt({ motion: "wave", poseA: "arm down", poseB: "arm up", canon, percent: 50 });
  assert.match(bd, /50% of the way from Image 2 to Image 3/);
  assert.match(bd, /Image 2 shows: arm down/);
  assert.match(bd, /Image 3 shows: arm up/);
  assert.deepEqual(findNegations(bd), []);
});

test("시트 프롬프트도 부정어 없이 흰 배경을 지정한다", () => {
  const sheet = sheetPrompt("a round white rabbit");
  assert.deepEqual(findNegations(sheet), []);
  assert.match(sheet, /background is a solid white surface/);
});

test("poseConstants는 키와 브레이크다운 양쪽에 같이 실린다", () => {
  // 실측(nod6): 두 키 모두 귀가 서 있는데 브레이크다운만 처진 귀를 그렸다.
  // "A와 B의 중간"만으로는 사양이 약해서, 매 프레임 참인 포즈 사실을 같이 준다.
  const constants = "both ears keep their full length with their bases on top of the head";
  const key = keyPrompt({ motion: "nod", index: 2, total: 2, pose: "the head sinks", constants, canon });
  const bd = breakdownPrompt({ motion: "nod", poseA: "up", poseB: "down", constants, canon });
  assert.ok(key.includes(constants) && bd.includes(constants));
  // POSE/MOTION 블록 안(= IDENTITY 앞)에 있어야 한다
  assert.ok(key.indexOf(constants) < key.indexOf("IDENTITY"));
  assert.ok(bd.indexOf(constants) < bd.indexOf("IDENTITY"));
  // 없으면 줄 자체가 붙지 않는다
  assert.ok(!keyPrompt({ motion: "nod", index: 1, total: 1, pose: "p", canon }).includes("in every frame"));
});

test("assertPromptRules는 통과 시 원문을 그대로 돌려준다", () => {
  const text = "the arm rises to shoulder height";
  assert.equal(assertPromptRules(text), text);
});
