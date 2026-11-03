import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildScriptPrompt, koreanWeekday, parseScript } from "./podcast-ai.js";

test("parseScript는 코드펜스·잡담을 걷어내고 대본을 정규화한다", () => {
  const script = parseScript('```json\n{"title":" 아침 브리핑 ","turns":[' +
    '{"speaker":"A","text":"  안녕하세요.  "},{"speaker":"C","text":"반갑습니다"},' +
    '{"speaker":"B","text":""}]}\n```');
  assert.equal(script.title, "아침 브리핑");
  assert.deepEqual(script.turns, [
    { speaker: "A", text: "안녕하세요." },
    { speaker: "A", text: "반갑습니다" }, // 알 수 없는 화자는 A로
  ]);
});

test("parseScript는 JSON이 없으면 던지고, 분량 상한을 강제한다", () => {
  assert.throws(() => parseScript("no json here"));
  assert.throws(() => parseScript('{"title":"x","turns":[]}'));
  const long = parseScript(JSON.stringify({
    title: "x",
    turns: Array.from({ length: 10 }, () => ({ speaker: "A", text: "가".repeat(400) })),
  }), { maxScriptChars: 1000 });
  assert.ok(long.turns.length <= 3);
});

test("buildScriptPrompt는 메모리와 자료 이름을 포함한다", () => {
  const prompt = buildScriptPrompt({
    dateKst: "2026-07-18", memory: "개발 소식 위주로", sourceNames: ["a.pdf", "b.png"],
  });
  assert.ok(prompt.includes("2026-07-18"));
  assert.ok(prompt.includes("개발 소식 위주로"));
  assert.ok(prompt.includes("a.pdf, b.png"));
  assert.ok(prompt.includes("2026-07-18 토요일"));
});

test("koreanWeekday는 KST 날짜의 요일을 준다", () => {
  assert.equal(koreanWeekday("2026-11-04"), "수요일");
  assert.equal(koreanWeekday("2026-11-08"), "일요일");
});

test("팟캐스트는 외부 AI API(Gemini 등)를 부르지 않는다 — 생성은 집 PC 몫", () => {
  for (const file of ["podcast.js", "podcast-ai.js"]) {
    const code = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /generativelanguage|GEMINI_API_KEY|api\.openai\.com/i, file);
  }
});
