// 팟캐스트 생성 AI 계층 — 대본(LLM)과 음성(TTS)을 프로바이더로 추상화한다.
// 최저가 모델로 갈아탈 수 있게 코드가 아닌 env 설정으로 교체한다:
//   PODCAST_LLM_PROVIDER  "gemini"(기본) | "openai"  ← OpenAI 호환이면 전부
//   PODCAST_LLM_MODEL     기본 gemini-2.5-flash
//   PODCAST_LLM_BASE_URL  openai 프로바이더의 베이스 URL (OpenRouter, Groq 등)
//   PODCAST_LLM_API_KEY   (없으면 GEMINI_API_KEY로 폴백)
//   PODCAST_TTS_PROVIDER  "gemini"(기본) | "openai"
//   PODCAST_TTS_MODEL     기본 gemini-2.5-flash-preview-tts
//   PODCAST_TTS_FALLBACK_MODEL  기본 모델이 쿼터(429)에 걸리면 쓸 예비 모델
//                         (gemini 전용, 기본 gemini-2.5-pro-preview-tts,
//                          "none"으로 끔 — 모델별 무료 쿼터가 따로라 유효하다)
//   PODCAST_TTS_BASE_URL / PODCAST_TTS_API_KEY / PODCAST_TTS_VOICE_A / _B
// WebCrypto·fetch만 사용하므로 Worker와 Node(로컬 품질 검증) 양쪽에서 돌아간다.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const AI_DEFAULTS = {
  // "-latest" 별칭은 Google이 최신 flash로 유지해줘서 신규 계정에서도 404가 안 난다.
  // 더 저렴하게 가려면 PODCAST_LLM_MODEL=gemini-flash-lite-latest 로 교체.
  llmModel: "gemini-flash-latest",
  ttsModel: "gemini-2.5-flash-preview-tts",
  // Gemini TTS 프리셋 보이스. openai 프로바이더에서는 해당 서비스의 보이스명을 넣는다.
  voiceA: "Kore",
  voiceB: "Puck",
  sampleRate: 24000,
  maxTurns: 60,
  maxScriptChars: 9000,   // 한국어 기준 약 10분 분량
  // Workers의 외부 fetch는 무응답 ~100초에 끊기므로(오류 524) 호출은
  // 스트리밍으로 하고, 조각도 한 호출이 짧게 끝나도록 작게 나눈다.
  ttsChunkChars: 1600,
  maxTtsChunks: 20,       // 폭주 비용 방지 상한
};

export const SUPPORTED_SOURCE_TYPES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp",
  "text/plain", "text/markdown",
]);

const MAX_TEXT_SOURCE_CHARS = 200_000;

// 소스 하나를 Gemini/OpenAI 메시지 파트로 바꾼다. 텍스트는 본문으로 풀고
// (양쪽 API 모두 확실히 지원), PDF·이미지는 바이너리 첨부로 보낸다.
function sourceToText(source) {
  const text = new TextDecoder().decode(source.bytes).slice(0, MAX_TEXT_SOURCE_CHARS);
  return `\n[자료: ${source.name}]\n${text}\n`;
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function buildScriptPrompt({ dateKst, memory, sourceNames, maxScriptChars = AI_DEFAULTS.maxScriptChars }) {
  const memoryBlock = memory?.trim()
    ? `\n[청취자 메모리 — 대본에 반영할 개인 지침]\n${memory.trim()}\n`
    : "";
  return `너는 한국어 데일리 팟캐스트의 작가다. 첨부된 자료(${sourceNames.join(", ")})를 바탕으로
진행자 두 명(A: 차분한 진행자, B: 호기심 많은 해설자)이 나누는 자연스러운 대담 대본을 작성하라.

규칙:
- 오늘 날짜는 ${dateKst}. 아침에 듣는 방송이라는 톤을 유지한다.
- 자료의 핵심 내용을 빠짐없이 다루되, 나열이 아니라 대화로 풀어낸다.
- 인사와 오프닝으로 시작해 요약과 클로징으로 끝낸다.
- 전체 분량은 공백 포함 ${maxScriptChars}자 이내.
- 출력은 아래 JSON 형식만. 다른 텍스트를 붙이지 않는다.
${memoryBlock}
출력 형식:
{"title": "에피소드 제목", "turns": [{"speaker": "A", "text": "..."}, {"speaker": "B", "text": "..."}]}`;
}

// LLM 응답에서 대본 JSON을 꺼내 검증·정규화한다.
export function parseScript(text, { maxTurns = AI_DEFAULTS.maxTurns, maxScriptChars = AI_DEFAULTS.maxScriptChars } = {}) {
  const stripped = String(text ?? "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("script response has no JSON object");
  let parsed;
  try { parsed = JSON.parse(stripped.slice(start, end + 1)); }
  catch { throw new Error("script response is not valid JSON"); }

  const title = String(parsed.title ?? "").trim().slice(0, 120) || "오늘의 팟캐스트";
  if (!Array.isArray(parsed.turns) || parsed.turns.length === 0) {
    throw new Error("script has no turns");
  }
  const turns = [];
  let totalChars = 0;
  for (const turn of parsed.turns.slice(0, maxTurns)) {
    const speaker = turn?.speaker === "B" ? "B" : "A";
    const text = String(turn?.text ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    totalChars += text.length;
    if (totalChars > maxScriptChars) break;
    turns.push({ speaker, text });
  }
  if (turns.length === 0) throw new Error("script turns are all empty");
  return { title, turns };
}

// TTS 1회 호출 한도에 맞춰 턴을 연속 묶음으로 나눈다. 한 턴이 한도를
// 넘으면 문장 경계에서 쪼갠다 (화자는 유지).
export function chunkTurns(turns, maxChars = AI_DEFAULTS.ttsChunkChars) {
  const normalized = [];
  const splitMax = maxChars - 8; // 화자 라벨("A: "+개행) 오버헤드 여유
  for (const turn of turns) {
    if (turn.text.length <= splitMax) { normalized.push(turn); continue; }
    let rest = turn.text;
    while (rest.length > splitMax) {
      const slice = rest.slice(0, splitMax);
      const cut = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("다. "), slice.lastIndexOf("요. "));
      const at = cut > splitMax / 2 ? cut + 2 : splitMax;
      normalized.push({ speaker: turn.speaker, text: rest.slice(0, at).trim() });
      rest = rest.slice(at).trim();
    }
    if (rest) normalized.push({ speaker: turn.speaker, text: rest });
  }
  const chunks = [];
  let current = [];
  let currentChars = 0;
  for (const turn of normalized) {
    const cost = turn.text.length + 4;
    if (current.length && currentChars + cost > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(turn);
    currentChars += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// 16-bit mono PCM 조각들을 하나의 WAV 파일로 감싼다.
export function pcmToWav(pcmChunks, { sampleRate = AI_DEFAULTS.sampleRate, channels = 1 } = {}) {
  const dataLength = pcmChunks.reduce((sum, c) => sum + c.length, 0);
  const buffer = new Uint8Array(44 + dataLength);
  const view = new DataView(buffer.buffer);
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) buffer[offset + i] = text.charCodeAt(i);
  };
  const byteRate = sampleRate * channels * 2;
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);         // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (const chunk of pcmChunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return buffer;
}

export function wavDurationSeconds(wavBytes, { sampleRate = AI_DEFAULTS.sampleRate, channels = 1 } = {}) {
  return Math.round((wavBytes.length - 44) / (sampleRate * channels * 2));
}

// "audio/L16;codec=pcm;rate=24000" 류의 MIME에서 샘플레이트를 읽는다.
export function parseAudioRate(mime, fallback = AI_DEFAULTS.sampleRate) {
  const match = /rate=(\d+)/.exec(mime ?? "");
  return match ? Number(match[1]) : fallback;
}

async function requestJson(url, init, label) {
  let response = await fetch(url, init);
  if (response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    response = await fetch(url, init);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return response.json();
}

// Gemini streamGenerateContent(alt=sse) 호출 — 바이트가 곧바로 흐르기
// 시작하므로 Cloudflare의 무응답 타임아웃(524)에 걸리지 않는다.
// 모든 SSE 이벤트의 content parts를 순서대로 모아 반환한다.
async function requestGeminiStream(url, init, label) {
  let response = await fetch(url, init);
  if (response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    response = await fetch(url, init);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  const body = await response.text();
  const parts = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload);
      parts.push(...(data.candidates?.[0]?.content?.parts ?? []));
    } catch { /* 잘린 조각은 무시 */ }
  }
  if (parts.length === 0) throw new Error(`${label} returned no content`);
  return parts;
}

const llmKey = (env) => env.PODCAST_LLM_API_KEY || env.GEMINI_API_KEY;
const ttsKey = (env) => env.PODCAST_TTS_API_KEY || env.PODCAST_LLM_API_KEY || env.GEMINI_API_KEY;

// 호출 자체 집계 훅 — env.recordAiCall(kind, model, ok)이 있으면 기록한다
// (PodcastDO가 붙여준다; 내부 재시도는 1회로 세는 근사치).
async function tracked(env, kind, model, fn) {
  try {
    const result = await fn();
    await env.recordAiCall?.(kind, model, true);
    return result;
  } catch (error) {
    await env.recordAiCall?.(kind, model, false)?.catch?.(() => {});
    throw error;
  }
}

// ── 대본 프로바이더 ──────────────────────────────────────────────
// sources: [{ name, mime, bytes: Uint8Array }]
export function createScriptProvider(env) {
  const provider = env.PODCAST_LLM_PROVIDER || "gemini";
  const model = env.PODCAST_LLM_MODEL || AI_DEFAULTS.llmModel;

  if (provider === "gemini") {
    return {
      name: `gemini/${model}`,
      async generate({ sources, memory, dateKst }) {
        const key = llmKey(env);
        if (!key) throw new Error("GEMINI_API_KEY (또는 PODCAST_LLM_API_KEY) is not configured");
        const prompt = buildScriptPrompt({ dateKst, memory, sourceNames: sources.map((s) => s.name) });
        const body = {
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              ...sources.map((s) => s.mime.startsWith("text/")
                ? { text: sourceToText(s) }
                : { inlineData: { mimeType: s.mime, data: bytesToBase64(s.bytes) } }),
            ],
          }],
          generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
        };
        const parts = await tracked(env, "script", model, () => requestGeminiStream(
          `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify(body),
          },
          "gemini script",
        ));
        return parseScript(parts.map((p) => p.text ?? "").join(""));
      },
    };
  }

  if (provider === "openai") {
    const baseUrl = (env.PODCAST_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    return {
      name: `openai/${model}`,
      async generate({ sources, memory, dateKst }) {
        const key = llmKey(env);
        if (!key) throw new Error("PODCAST_LLM_API_KEY is not configured");
        // OpenAI 호환 API의 멀티모달 입력은 이미지 data URL 기준.
        // PDF 지원은 프로바이더마다 달라서 이 어댑터에서는 받지 않는다 → Gemini 사용.
        const pdf = sources.find((s) => s.mime === "application/pdf");
        if (pdf) throw new Error(`openai LLM provider cannot read PDF source "${pdf.name}" — use gemini`);
        const prompt = buildScriptPrompt({ dateKst, memory, sourceNames: sources.map((s) => s.name) });
        const body = {
          model,
          response_format: { type: "json_object" },
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...sources.map((s) => s.mime.startsWith("text/")
                ? { type: "text", text: sourceToText(s) }
                : {
                    type: "image_url",
                    image_url: { url: `data:${s.mime};base64,${bytesToBase64(s.bytes)}` },
                  }),
            ],
          }],
        };
        const data = await tracked(env, "script", model, () => requestJson(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
          },
          "openai script",
        ));
        return parseScript(data.choices?.[0]?.message?.content ?? "");
      },
    };
  }

  throw new Error(`unknown PODCAST_LLM_PROVIDER "${provider}"`);
}

// ── 음성 프로바이더 ──────────────────────────────────────────────
// synthesize(turns) → { wav: Uint8Array, sampleRate, durationSeconds }
export function createTtsProvider(env) {
  const provider = env.PODCAST_TTS_PROVIDER || "gemini";
  const model = env.PODCAST_TTS_MODEL || AI_DEFAULTS.ttsModel;
  const voiceA = env.PODCAST_TTS_VOICE_A || AI_DEFAULTS.voiceA;
  const voiceB = env.PODCAST_TTS_VOICE_B || AI_DEFAULTS.voiceB;

  // 두 프로바이더 모두 두 가지 메서드를 제공한다:
  //   synthesizeChunk(turns) → { pcm, sampleRate }  — 조각 하나 (DO가 단계 실행에 사용)
  //   synthesize(turns)      → { wav, ... }         — 전체 (로컬 CLI 검증용)
  const wrapFull = (provider) => async (turns) => {
    const chunks = chunkTurns(turns);
    if (chunks.length > AI_DEFAULTS.maxTtsChunks) {
      throw new Error(`script too long for TTS (${chunks.length} chunks)`);
    }
    const pcmParts = [];
    let sampleRate = AI_DEFAULTS.sampleRate;
    for (const chunk of chunks) {
      const part = await provider.synthesizeChunk(chunk);
      sampleRate = part.sampleRate;
      pcmParts.push(part.pcm);
    }
    const wav = pcmToWav(pcmParts, { sampleRate });
    return { wav, sampleRate, durationSeconds: wavDurationSeconds(wav, { sampleRate }) };
  };

  if (provider === "gemini") {
    const fallbackModel = env.PODCAST_TTS_FALLBACK_MODEL || "gemini-2.5-pro-preview-tts";
    const callModel = (ttsModel, turns) => tracked(env, "tts", ttsModel, async () => {
      const key = ttsKey(env);
      if (!key) throw new Error("GEMINI_API_KEY (또는 PODCAST_TTS_API_KEY) is not configured");
      const dialogue = turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
      const body = {
        contents: [{
          role: "user",
          parts: [{ text: `다음 대화를 자연스러운 한국어 팟캐스트 대담으로 읽어주세요. 밝고 편안한 아침 방송 톤입니다.\n\n${dialogue}` }],
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: "A", voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceA } } },
                { speaker: "B", voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceB } } },
              ],
            },
          },
        },
      };
      const parts = await requestGeminiStream(
        `${GEMINI_BASE}/models/${ttsModel}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
        },
        `gemini tts(${ttsModel})`,
      );
      const audioParts = parts.filter((p) => p.inlineData?.data);
      if (audioParts.length === 0) throw new Error(`gemini tts(${ttsModel}) returned no audio`);
      const pcmSegments = audioParts.map((p) => b64ToBytes(p.inlineData.data));
      const total = pcmSegments.reduce((sum, s) => sum + s.length, 0);
      const pcm = new Uint8Array(total);
      let offset = 0;
      for (const segment of pcmSegments) { pcm.set(segment, offset); offset += segment.length; }
      return { pcm, sampleRate: parseAudioRate(audioParts[0].inlineData.mimeType) };
    });
    const geminiProvider = {
      name: `gemini/${model}`,
      async synthesizeChunk(turns) {
        try {
          return await callModel(model, turns);
        } catch (error) {
          // 기본 모델의 일일 쿼터 소진(429) 시 예비 모델로 — 모델별 쿼터가 따로다
          const quotaHit = /\(429\)|RESOURCE_EXHAUSTED|quota/i.test(String(error?.message ?? ""));
          if (!quotaHit || !fallbackModel || fallbackModel === "none" || fallbackModel === model) throw error;
          return callModel(fallbackModel, turns);
        }
      },
    };
    geminiProvider.synthesize = wrapFull(geminiProvider);
    return geminiProvider;
  }

  if (provider === "openai") {
    const baseUrl = (env.PODCAST_TTS_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const openaiProvider = {
      name: `openai/${model}`,
      // OpenAI 호환 TTS는 화자별 단일 보이스 호출 → PCM으로 받아 이어붙인다.
      synthesizeChunk: (turns) => tracked(env, "tts", model, async () => {
        const key = ttsKey(env);
        if (!key) throw new Error("PODCAST_TTS_API_KEY is not configured");
        const sampleRate = AI_DEFAULTS.sampleRate;
        const gap = new Uint8Array(sampleRate * 2 * 0.3); // 턴 사이 0.3초 무음
        const pcmParts = [];
        for (const turn of turns) {
          const response = await fetch(`${baseUrl}/audio/speech`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model,
              voice: turn.speaker === "A" ? voiceA : voiceB,
              input: turn.text,
              response_format: "pcm",
            }),
          });
          if (!response.ok) {
            const detail = (await response.text().catch(() => "")).slice(0, 300);
            throw new Error(`openai tts failed (${response.status}): ${detail}`);
          }
          pcmParts.push(new Uint8Array(await response.arrayBuffer()), gap);
        }
        const total = pcmParts.reduce((sum, p) => sum + p.length, 0);
        const pcm = new Uint8Array(total);
        let offset = 0;
        for (const part of pcmParts) { pcm.set(part, offset); offset += part.length; }
        return { pcm, sampleRate };
      }),
    };
    openaiProvider.synthesize = wrapFull(openaiProvider);
    return openaiProvider;
  }

  throw new Error(`unknown PODCAST_TTS_PROVIDER "${provider}"`);
}

function b64ToBytes(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}
