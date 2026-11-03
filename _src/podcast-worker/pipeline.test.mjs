import test from "node:test";
import assert from "node:assert/strict";
import { buildScript, extractSource, fitMaterial, llamaClient, writeScript } from "./pipeline.mjs";

// 글자 수 = 토큰 수로 세는 가짜 당이. chat 은 넘겨준 응답을 차례로 돌려준다.
function fakeLlm(replies = []) {
  const calls = [];
  return {
    calls,
    async tokens(text) { return text.length; },
    async chat(messages, opts) {
      calls.push({ messages, opts });
      const reply = replies.shift();
      return typeof reply === "function" ? reply(messages, opts) : reply ?? "메모";
    },
  };
}

const SCRIPT = JSON.stringify({ title: "아침", turns: [{ speaker: "A", text: "안녕하세요" }, { speaker: "B", text: "반갑습니다" }] });

test("텍스트는 그대로, PDF 는 pdftotext 로, 이미지는 당이 비전으로 읽는다", async () => {
  const llm = fakeLlm(["사진 속 글자"]);
  const text = await extractSource({ name: "a.md", mime: "text/markdown", bytes: new TextEncoder().encode("# 제목\n\n\n\n본문") }, { llm });
  assert.equal(text, "# 제목\n\n본문");
  const pdf = await extractSource({ name: "a.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) }, { llm, pdf: async () => "PDF 본문" });
  assert.equal(pdf, "PDF 본문");
  await assert.rejects(extractSource({ name: "s.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) }, { llm, pdf: async () => "  " }), /스캔 PDF/);
  const image = await extractSource({ name: "a.png", mime: "image/png", bytes: new Uint8Array([1, 2]) }, { llm });
  assert.equal(image, "사진 속 글자");
  const part = llm.calls[0].messages[0].content[1];
  assert.equal(part.image_url.url, "data:image/png;base64,AQI=");
});

test("fitMaterial 은 예산 안이면 원문을, 넘치면 넘친 자료만 조각 요약한다", async () => {
  const short = { name: "짧은.txt", text: "가".repeat(100) };
  const long = { name: "긴.txt", text: "나".repeat(5000) };
  const fits = await fitMaterial([short], { llm: fakeLlm(), budgetTokens: 1000 });
  assert.ok(fits.includes("[자료: 짧은.txt]") && fits.includes("가".repeat(100)));

  const llm = fakeLlm();
  const fitted = await fitMaterial([short, long], { llm, budgetTokens: 1000, pieceTokens: 2000 });
  assert.ok(fitted.includes("가".repeat(100)), "짧은 자료는 원문 유지");
  assert.ok(fitted.includes("[자료: 긴.txt (요약)]"));
  assert.ok(!fitted.includes("나".repeat(3000)), "긴 자료 원문은 빠진다");
  assert.equal(llm.calls.length, 3); // 5000자 / 2000 → 3조각
});

test("writeScript 는 JSON 모드로 묻고, 깨진 JSON 이면 한 번 더 시킨 뒤 포기한다", async () => {
  const llm = fakeLlm(["깨진 응답", SCRIPT]);
  const script = await writeScript({ material: "자료", sourceNames: ["a"], memory: "", dateKst: "2026-11-04", llm });
  assert.equal(script.title, "아침");
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[0].opts.json, true);
  assert.ok(llm.calls[0].messages[0].content.includes("수요일"));
  assert.ok(llm.calls[0].opts.maxTokens > 1000);

  await assert.rejects(writeScript({ material: "자료", sourceNames: ["a"], memory: "", dateKst: "2026-11-04", llm: fakeLlm(["x", "y"]) }), /대본 JSON/);
  await assert.rejects(writeScript({ material: "가".repeat(8000), sourceNames: ["a"], memory: "", dateKst: "2026-11-04", llm: fakeLlm() }), /너무 깁니다/);
});

test("buildScript 는 읽을 글이 없으면 멈추고, 있으면 대본까지 간다", async () => {
  const empty = { name: "빈.txt", mime: "text/plain", bytes: new Uint8Array() };
  await assert.rejects(buildScript({ sources: [empty], memory: "", dateKst: "2026-11-04", llm: fakeLlm() }), /읽을 글이 없습니다/);
  const doc = { name: "a.txt", mime: "text/plain", bytes: new TextEncoder().encode("내용") };
  const script = await buildScript({ sources: [doc], memory: "경제 위주", dateKst: "2026-11-04", llm: fakeLlm([SCRIPT]) });
  assert.equal(script.turns.length, 2);
});

test("llamaClient 는 속생각을 끄고 JSON 모드를 켜서 부른다", async () => {
  let body;
  const client = llamaClient("http://x:1/", async (url, init) => {
    body = JSON.parse(init.body);
    assert.equal(url, "http://x:1/v1/chat/completions");
    return Response.json({ choices: [{ message: { content: "답" } }] });
  });
  assert.equal(await client.chat([{ role: "user", content: "q" }], { json: true, maxTokens: 10 }), "답");
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, 10);
});
