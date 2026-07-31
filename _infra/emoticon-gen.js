// Gemini 이미지 생성 호출 — Worker(/_emoticon/generate 프록시)와 Node CLI
// (_infra/emoticon-ai.mjs)가 공유한다. fetch·btoa·atob만 사용해 양쪽에서 돈다.
// Worker에서는 API 키가 GEMINI_STICKER_KEY secret으로만 존재하고 밖으로
// 나가지 않는다 — CLI는 프록시를 호출하는 edge 프로바이더로 이 키를 쓴다.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
// 요청 본문 상한: 레퍼런스 4장(base64 ≈ ×1.37) + 프롬프트 여유
export const EMOTICON_MAX_BODY = 8 * 1024 * 1024;
export const EMOTICON_MAX_REFERENCES = 4;
export const EMOTICON_MAX_PROMPT = 4000;

export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fetchWithRetry(url, init, label, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`${label} 실패 (${res.status}): ${body.slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

// referencesB64: base64 문자열 배열 (PNG/JPEG — 디코드해 매직 바이트로 판별).
// 성공 시 이미지 바이트(Uint8Array)를 돌려준다.
export async function geminiGenerate({ apiKey, model = DEFAULT_IMAGE_MODEL, prompt, referencesB64 = [] }) {
  if (!apiKey) throw new Error("Gemini API 키가 없습니다");
  const parts = [
    ...referencesB64.map((data) => ({
      // base64 선두로 형식 판별: JPEG(FF D8)은 "/9j", PNG은 "iVBOR"로 시작
      inlineData: { mimeType: data.startsWith("/9j") ? "image/jpeg" : "image/png", data },
    })),
    { text: prompt },
  ];
  const res = await fetchWithRetry(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    },
    `gemini image(${model})`,
  );
  const json = await res.json();
  const image = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!image) {
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join(" ") ?? "";
    throw new Error(`gemini image(${model})가 이미지를 반환하지 않았습니다: ${text.slice(0, 200)}`);
  }
  return base64ToBytes(image.inlineData.data);
}
