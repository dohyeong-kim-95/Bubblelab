import test from "node:test";
import assert from "node:assert/strict";
import { RABBIT_PARTS, inspectParts, parseCounts, partsPrompt } from "./emoticon-vision.mjs";

test("프롬프트는 '형태 단위로 세라'를 명시한다", () => {
  // 겹치거나 처진 귀를 하나로 세면 nod3의 귀 4개를 놓친다.
  const prompt = partsPrompt(RABBIT_PARTS);
  assert.match(prompt, /by SHAPE/);
  assert.match(prompt, /including duplicates/);
  assert.match(prompt, /"ears": 0, "arms": 0, "eyes": 0/);
});

test("JSON이 산문에 섞여 와도 읽어낸다", () => {
  assert.deepEqual(
    parseCounts('여기 있습니다:\n```json\n{"ears":4,"arms":2,"eyes":2}\n```', RABBIT_PARTS),
    { ears: 4, arms: 2, eyes: 2 },
  );
});

test("이상한 개수는 조용히 넘기지 않고 실패시킨다", () => {
  for (const bad of ['{"ears":"둘","arms":2,"eyes":2}', '{"ears":-1,"arms":2,"eyes":2}', '{"arms":2,"eyes":2}']) {
    assert.throws(() => parseCounts(bad, RABBIT_PARTS), /개수가 이상합니다/);
  }
  assert.throws(() => parseCounts("설명만 있고 JSON이 없음", RABBIT_PARTS), /JSON으로 읽을 수 없습니다/);
});

test("기대치와 다른 프레임만 위반으로 남는다", async () => {
  const replies = ['{"ears":2,"arms":2,"eyes":2}', '{"ears":4,"arms":2,"eyes":2}', '{"ears":2,"arms":4,"eyes":2}'];
  let i = 0;
  const result = await inspectParts({
    framesB64: ["a", "b", "c"], parts: RABBIT_PARTS, ask: async () => replies[i++],
  });
  assert.equal(result.counts.length, 3);
  assert.deepEqual(result.violations, [
    { frame: 2, part: "ears", found: 4, expected: 2 },
    { frame: 3, part: "arms", found: 4, expected: 2 },
  ]);
});

test("expected가 없는 부품은 세기만 하고 판정하지 않는다", async () => {
  const parts = [{ key: "ears", what: "ears" }];
  const result = await inspectParts({
    framesB64: ["a"], parts, ask: async () => '{"ears":5}',
  });
  assert.deepEqual(result.counts, [{ ears: 5 }]);
  assert.deepEqual(result.violations, []);
});

test("비전 모델은 목록에서 고른다 (이름 하드코딩 금지)", async () => {
  // gemini-2.5-flash를 상수로 박았다가 "신규 사용자에게 제공되지 않는다" 404로
  // 죽었다. 실제 사용 가능한 목록에서 골라야 한다.
  const { pickVisionModel } = await import("./emoticon-gen.js");
  const catalog = [
    "models/gemini-2.5-flash-image", "models/gemini-3-pro-preview", "models/gemini-3-flash",
    "models/gemini-2.5-pro", "models/text-embedding-004", "models/gemini-2.5-flash-preview-tts",
  ];
  assert.equal(pickVisionModel(catalog), "gemini-3-flash");
  // 이미지·TTS·임베딩 전용은 후보에서 빠진다
  assert.throws(() => pickVisionModel(["models/imagen-4", "models/text-embedding-004"]), /찾지 못했습니다/);
  // flash가 없으면 pro로 내려간다
  assert.equal(pickVisionModel(["models/gemini-2.5-pro"]), "gemini-2.5-pro");
});
