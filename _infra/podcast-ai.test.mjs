import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_DEFAULTS, buildScriptPrompt, bytesToBase64, chunkTurns, createScriptProvider,
  createTtsProvider, parseAudioRate, parseScript, pcmToWav, wavDurationSeconds,
} from "./podcast-ai.js";

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

test("chunkTurns는 한도 내에서 연속 묶음을 만들고 긴 턴은 쪼갠다", () => {
  const turns = [
    { speaker: "A", text: "안녕하세요. ".repeat(30).trim() },
    { speaker: "B", text: "네 반갑습니다. ".repeat(30).trim() },
  ];
  const chunks = chunkTurns(turns, 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    const chars = chunk.reduce((sum, t) => sum + t.text.length + 4, 0);
    assert.ok(chars <= 200, `chunk too big: ${chars}`);
    for (const turn of chunk) assert.ok(["A", "B"].includes(turn.speaker));
  }
  // 쪼개져도 전체 내용은 보존된다
  const joined = chunks.flat().map((t) => t.text).join(" ");
  assert.ok(joined.includes("안녕하세요"));
  assert.ok(joined.includes("반갑습니다"));
});

test("pcmToWav는 유효한 RIFF 헤더를 만든다", () => {
  const pcm = new Uint8Array(24000 * 2 * 3); // 3초 분량 16-bit mono
  const wav = pcmToWav([pcm], { sampleRate: 24000 });
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint32(40, true), pcm.length);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wavDurationSeconds(wav, { sampleRate: 24000 }), 3);
});

test("parseAudioRate는 MIME에서 샘플레이트를 읽는다", () => {
  assert.equal(parseAudioRate("audio/L16;codec=pcm;rate=24000"), 24000);
  assert.equal(parseAudioRate("audio/wav"), AI_DEFAULTS.sampleRate);
});

test("buildScriptPrompt는 메모리와 자료 이름을 포함한다", () => {
  const prompt = buildScriptPrompt({
    dateKst: "2026-07-18", memory: "개발 소식 위주로", sourceNames: ["a.pdf", "b.png"],
  });
  assert.ok(prompt.includes("2026-07-18"));
  assert.ok(prompt.includes("개발 소식 위주로"));
  assert.ok(prompt.includes("a.pdf, b.png"));
});

const withMockedFetch = async (handler, run) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  try { return { result: await run(), calls }; }
  finally { globalThis.fetch = original; }
};

// Gemini 스트리밍(SSE) 응답 형식 헬퍼 — 여러 이벤트로 쪼개 보낸다
const sse = (...payloads) => new Response(
  payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join(""), { status: 200 },
);

test("gemini 대본 프로바이더는 소스를 inlineData로 보내고 SSE 응답을 파싱한다", async () => {
  const env = { GEMINI_API_KEY: "test-key" };
  const provider = createScriptProvider(env);
  assert.equal(provider.name, `gemini/${AI_DEFAULTS.llmModel}`);
  const { result, calls } = await withMockedFetch(
    () => sse(
      { candidates: [{ content: { parts: [{ text: '{"title":"T","turns":[' }] } }] },
      { candidates: [{ content: { parts: [{ text: '{"speaker":"A","text":"hi"}]}' }] } }] },
    ),
    () => provider.generate({
      sources: [{ name: "doc.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }],
      memory: "", dateKst: "2026-07-18",
    }),
  );
  assert.equal(result.title, "T");
  assert.ok(calls[0].url.includes(`/models/${AI_DEFAULTS.llmModel}:streamGenerateContent`));
  assert.equal(calls[0].init.headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contents[0].parts[1].inlineData.mimeType, "application/pdf");
  assert.equal(body.contents[0].parts[1].inlineData.data, bytesToBase64(new Uint8Array([1, 2, 3])));
});

test("gemini TTS 프로바이더는 멀티스피커 설정을 보내고 SSE PCM 조각을 WAV로 합친다", async () => {
  const env = { GEMINI_API_KEY: "test-key", PODCAST_TTS_VOICE_A: "VoiceA" };
  const provider = createTtsProvider(env);
  const pcm = new Uint8Array(24000 * 2); // 1초
  const half = pcm.length / 2;
  const { result, calls } = await withMockedFetch(
    () => sse(
      { candidates: [{ content: { parts: [{ inlineData: {
        mimeType: "audio/L16;rate=24000", data: bytesToBase64(pcm.slice(0, half)),
      } }] } }] },
      { candidates: [{ content: { parts: [{ inlineData: {
        mimeType: "audio/L16;rate=24000", data: bytesToBase64(pcm.slice(half)),
      } }] } }] },
    ),
    () => provider.synthesize([
      { speaker: "A", text: "안녕하세요" }, { speaker: "B", text: "반갑습니다" },
    ]),
  );
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  const speakers = body.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
  assert.equal(speakers[0].voiceConfig.prebuiltVoiceConfig.voiceName, "VoiceA");
  assert.ok(body.contents[0].parts[0].text.includes("A: 안녕하세요"));
  assert.equal(result.wav.length, 44 + pcm.length);
  assert.equal(result.durationSeconds, 1);
});

test("openai 프로바이더 어댑터 — PDF 거부, TTS는 화자별 보이스", async () => {
  const env = {
    PODCAST_LLM_PROVIDER: "openai", PODCAST_LLM_API_KEY: "k",
    PODCAST_TTS_PROVIDER: "openai", PODCAST_TTS_MODEL: "tts-x",
    PODCAST_TTS_VOICE_A: "alloy", PODCAST_TTS_VOICE_B: "verse",
  };
  await assert.rejects(
    createScriptProvider(env).generate({
      sources: [{ name: "x.pdf", mime: "application/pdf", bytes: new Uint8Array(1) }],
      memory: "", dateKst: "2026-07-18",
    }),
    /PDF/,
  );
  const pcm = new Uint8Array(24000 * 2);
  const { calls } = await withMockedFetch(
    () => new Response(pcm, { status: 200 }),
    () => createTtsProvider(env).synthesize([
      { speaker: "A", text: "하나" }, { speaker: "B", text: "둘" },
    ]),
  );
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].init.body).voice, "alloy");
  assert.equal(JSON.parse(calls[1].init.body).voice, "verse");
  assert.equal(JSON.parse(calls[0].init.body).response_format, "pcm");
});

test("TTS 쿼터(429) 소진 시 예비 모델로 자동 전환한다", async () => {
  const env = { GEMINI_API_KEY: "k" };
  const pcm = new Uint8Array(24000 * 2);
  const { result, calls } = await withMockedFetch(
    (url) => url.includes(AI_DEFAULTS.ttsModel)
      ? new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }), { status: 429 })
      : sse({ candidates: [{ content: { parts: [{ inlineData: {
          mimeType: "audio/L16;rate=24000", data: bytesToBase64(pcm),
        } }] } }] }),
    () => createTtsProvider(env).synthesizeChunk([{ speaker: "A", text: "안녕" }]),
  );
  assert.equal(result.pcm.length, pcm.length);
  // 기본 모델 시도(429 재시도 포함) 후 예비 모델 호출
  assert.ok(calls.some((c) => c.url.includes("gemini-2.5-pro-preview-tts")));

  // "none"이면 그대로 실패한다
  await assert.rejects(
    withMockedFetch(
      () => new Response("quota", { status: 429 }),
      () => createTtsProvider({ GEMINI_API_KEY: "k", PODCAST_TTS_FALLBACK_MODEL: "none" })
        .synthesizeChunk([{ speaker: "A", text: "안녕" }]),
    ),
    /429/,
  );
});

test("텍스트 소스는 첨부가 아니라 본문으로 들어간다", async () => {
  const env = { GEMINI_API_KEY: "k" };
  const textBytes = new TextEncoder().encode("오늘의 메모 내용");
  const { calls } = await withMockedFetch(
    () => sse({ candidates: [{ content: { parts: [{ text: '{"title":"T","turns":[{"speaker":"A","text":"hi"}]}' }] } }] }),
    () => createScriptProvider(env).generate({
      sources: [
        { name: "메모.txt", mime: "text/plain", bytes: textBytes },
        { name: "doc.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) },
      ],
      memory: "", dateKst: "2026-07-19",
    }),
  );
  const parts = JSON.parse(calls[0].init.body).contents[0].parts;
  assert.ok(parts[1].text.includes("[자료: 메모.txt]"));
  assert.ok(parts[1].text.includes("오늘의 메모 내용"));
  assert.equal(parts[2].inlineData.mimeType, "application/pdf");

  // openai 어댑터도 텍스트는 본문으로 (PDF 없이)
  const openaiEnv = { PODCAST_LLM_PROVIDER: "openai", PODCAST_LLM_API_KEY: "k" };
  const { calls: openaiCalls } = await withMockedFetch(
    () => Response.json({ choices: [{ message: { content: '{"title":"T","turns":[{"speaker":"A","text":"hi"}]}' } }] }),
    () => createScriptProvider(openaiEnv).generate({
      sources: [{ name: "메모.txt", mime: "text/plain", bytes: textBytes }],
      memory: "", dateKst: "2026-07-19",
    }),
  );
  const content = JSON.parse(openaiCalls[0].init.body).messages[0].content;
  assert.equal(content[1].type, "text");
  assert.ok(content[1].text.includes("오늘의 메모 내용"));
});

test("알 수 없는 프로바이더는 즉시 던진다", () => {
  assert.throws(() => createScriptProvider({ PODCAST_LLM_PROVIDER: "nope" }));
  assert.throws(() => createTtsProvider({ PODCAST_TTS_PROVIDER: "nope" }));
});
