// 팟캐스트 생성 파이프라인 — 자료 → 글 → (당이 컨텍스트에 맞게 줄이기) → 대담 대본.
// 입출력(파일·서버·TTS)은 podcast-worker.mjs 가 하고, 여기는 LLM 을 주입받는 순수한 단계만 둔다.
//
// 당이(llama-server, gemma-4-26B-A4B)는 컨텍스트가 8192토큰·슬롯 하나다. 프롬프트·자료·대본이
// 한 번에 들어가야 하므로 자료가 길면 먼저 조각별로 요약해 예산 안에 넣는다.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 리포에서는 _infra/ 의 원본을, 설치본(~/podcast-worker)에서는 install.sh 가 옆에 복사한 사본을 쓴다.
const { buildScriptPrompt, parseScript, SCRIPT_LIMITS } = await import("./podcast-ai.js")
  .catch(() => import("../../_infra/podcast-ai.js"));
export { SCRIPT_LIMITS };

export const LLM_DEFAULTS = {
  nCtx: 8192,
  materialTokens: 3600,   // 대본 프롬프트에 붙일 자료 예산
  pieceTokens: 3000,      // 요약할 때 한 번에 읽히는 조각 크기
  charsPerToken: 1.7,     // 한국어 실측 1.76 — 토큰을 못 셀 때의 어림
};
const MAX_SOURCE_CHARS = 200_000;

/** llama-server(OpenAI 호환)를 부르는 얇은 클라이언트. 속생각은 끈다(gemma4 는 기본으로 켜져 느리다). */
export function llamaClient(url, fetchImpl = fetch) {
  const base = url.replace(/\/+$/, "");
  return {
    async chat(messages, { maxTokens = 1024, json = false, temperature = 0.7 } = {}) {
      const res = await fetchImpl(`${base}/v1/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages, temperature, max_tokens: maxTokens, cache_prompt: true,
          chat_template_kwargs: { enable_thinking: false },
          ...(json && { response_format: { type: "json_object" } }),
        }),
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      if (!res.ok) throw new Error(`당이 응답 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return String(data.choices?.[0]?.message?.content ?? "");
    },
    async tokens(text) {
      const res = await fetchImpl(`${base}/tokenize`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }), signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return Math.ceil(text.length / LLM_DEFAULTS.charsPerToken);
      return (await res.json()).tokens?.length ?? Math.ceil(text.length / LLM_DEFAULTS.charsPerToken);
    },
    async healthy() {
      try { return (await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(3000) })).ok; }
      catch { return false; }
    },
  };
}

export function pdfToText(bytes) {
  return (async () => {
    const dir = await mkdtemp(join(tmpdir(), "podcast-pdf-"));
    try {
      const file = join(dir, "in.pdf");
      await writeFile(file, bytes);
      return await new Promise((resolve, reject) => {
        execFile("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 64 * 1024 * 1024 },
          (error, stdout) => (error ? reject(new Error(`PDF 글자를 꺼내지 못했습니다: ${error.message}`)) : resolve(stdout)));
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })();
}

const tidy = (text) => String(text).replace(/\r/g, "").replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_SOURCE_CHARS);

/** 소스 하나를 글로 바꾼다. 이미지는 당이의 눈(비전)으로 읽는다. */
export async function extractSource({ name, mime, bytes }, { llm, pdf = pdfToText }) {
  if (mime === "application/pdf") {
    const text = tidy(await pdf(bytes));
    if (!text) throw new Error(`"${name}" 에서 글자를 찾지 못했습니다 (스캔 PDF는 이미지로 올려 주세요)`);
    return text;
  }
  if (mime.startsWith("image/")) {
    const b64 = Buffer.from(bytes).toString("base64");
    return tidy(await llm.chat([{ role: "user", content: [
      { type: "text", text: "이 이미지에 담긴 내용을 한국어로 빠짐없이 옮겨 적어라. 글자는 그대로 옮기고, 그림·도표·사진은 무엇을 보여 주는지 설명한다. 설명만 출력한다." },
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
    ] }], { maxTokens: 1500, temperature: 0.2 }));
  }
  return tidy(new TextDecoder().decode(bytes));
}

function splitByChars(text, size) {
  const pieces = [];
  let rest = text;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("다. "));
    const at = cut > size / 2 ? cut + 1 : size;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * 자료들을 대본 프롬프트 예산(토큰) 안에 넣는다. 넘치면 넘친 자료만 조각내 요약한다.
 * 예산은 자료 길이에 비례해 나누되, 짧은 자료는 원문 그대로 둔다.
 */
export async function fitMaterial(docs, { llm, budgetTokens = LLM_DEFAULTS.materialTokens, pieceTokens = LLM_DEFAULTS.pieceTokens, log = () => {} }) {
  const block = (name, text) => `[자료: ${name}]\n${text}`;
  const sized = [];
  for (const doc of docs) sized.push({ ...doc, tokens: await llm.tokens(block(doc.name, doc.text)) });
  const total = sized.reduce((sum, d) => sum + d.tokens, 0);
  if (total <= budgetTokens) return sized.map((d) => block(d.name, d.text)).join("\n\n");

  const out = [];
  for (const doc of sized) {
    const share = Math.max(300, Math.floor(budgetTokens * doc.tokens / total));
    if (doc.tokens <= share) { out.push(block(doc.name, doc.text)); continue; }
    const ratio = doc.text.length / doc.tokens;
    const pieces = splitByChars(doc.text, Math.floor(pieceTokens * ratio));
    const perPieceChars = Math.max(200, Math.floor(share * ratio / pieces.length));
    log(`"${doc.name}" ${doc.tokens}토큰 → ${pieces.length}조각을 조각당 ${perPieceChars}자로 요약`);
    const notes = [];
    for (const [i, piece] of pieces.entries()) {
      notes.push(await llm.chat([
        { role: "system", content: `너는 팟캐스트 작가의 자료 조사원이다. 주어진 글의 핵심 사실·숫자·주장·예시를 한국어 요점 메모로 ${perPieceChars}자 이내로 정리한다. 메모만 출력한다.` },
        { role: "user", content: `[${doc.name} — ${i + 1}/${pieces.length}]\n${piece}` },
      ], { maxTokens: Math.ceil(perPieceChars / ratio) + 64, temperature: 0.2 }));
    }
    out.push(block(`${doc.name} (요약)`, notes.map((n) => n.trim()).join("\n")));
  }
  return out.join("\n\n");
}

/** 대담 대본을 쓴다. JSON 이 깨지면 한 번 더 시킨다. */
export async function writeScript({ material, sourceNames, memory, dateKst, llm, nCtx = LLM_DEFAULTS.nCtx, maxScriptChars = SCRIPT_LIMITS.maxScriptChars }) {
  const system = buildScriptPrompt({ dateKst, memory, sourceNames, maxScriptChars });
  const used = await llm.tokens(`${system}\n${material}`);
  const maxTokens = nCtx - used - 64;
  if (maxTokens < 1000) throw new Error(`자료가 너무 깁니다 (프롬프트 ${used}토큰)`);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await llm.chat([
      { role: "system", content: system },
      { role: "user", content: material },
    ], { maxTokens, json: true, temperature: 0.7 });
    try { return parseScript(text, { maxScriptChars }); }
    catch (error) { lastError = error; }
  }
  throw new Error(`대본 JSON 을 받지 못했습니다: ${lastError.message}`);
}

/** 소스 목록 → 대본까지 한 번에. */
export async function buildScript({ sources, memory, dateKst, llm, pdf, log = () => {} }) {
  const docs = [];
  for (const source of sources) {
    const text = await extractSource(source, { llm, pdf });
    log(`"${source.name}" ${text.length}자`);
    if (text) docs.push({ name: source.name, text });
  }
  if (docs.length === 0) throw new Error("자료에서 읽을 글이 없습니다");
  const material = await fitMaterial(docs, { llm, log });
  return writeScript({ material, sourceNames: docs.map((d) => d.name), memory, dateKst, llm });
}
