// 움직이는 이모티콘 이미지 생성 AI 계층 (work/emoticon 툴).
// podcast-ai.js와 같은 방식으로 프로바이더를 env로 교체한다:
//   EMOTICON_IMAGE_PROVIDER  "gemini"(기본) | "mock"
//   EMOTICON_IMAGE_MODEL     기본 gemini-2.5-flash-image (Nano Banana)
//   EMOTICON_IMAGE_API_KEY   (없으면 GEMINI_API_KEY로 폴백)
// mock은 API 키 없이 파이프라인 전체를 검증하기 위한 합성 이미지 생성기다
// (테스트와 드라이런 전용 — 실제 산출물 품질과 무관).
import { encodePng } from "./png.mjs";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

function apiKey(env) {
  return env.EMOTICON_IMAGE_API_KEY || env.GEMINI_API_KEY || "";
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
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

// 프로바이더 인터페이스: generate({ prompt, references }) → 이미지 바이트(Uint8Array).
// references는 PNG/JPEG 바이트 배열 — 캐릭터 시트·이전 프레임을 넣어 일관성을 지킨다.
export function imageProvider(env = process.env) {
  const provider = env.EMOTICON_IMAGE_PROVIDER || "gemini";
  const model = env.EMOTICON_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

  if (provider === "mock") return mockProvider();

  if (provider === "gemini") {
    return {
      name: `gemini/${model}`,
      async generate({ prompt, references = [] }) {
        const key = apiKey(env);
        if (!key) throw new Error("GEMINI_API_KEY(또는 EMOTICON_IMAGE_API_KEY)가 설정되지 않았습니다");
        const parts = [
          ...references.map((bytes) => ({
            inlineData: { mimeType: bytes[0] === 0xff ? "image/jpeg" : "image/png", data: toBase64(bytes) },
          })),
          { text: prompt },
        ];
        const res = await fetchWithRetry(
          `${GEMINI_BASE}/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
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
        return new Uint8Array(Buffer.from(image.inlineData.data, "base64"));
      },
    };
  }

  throw new Error(`알 수 없는 EMOTICON_IMAGE_PROVIDER: ${provider}`);
}

// ── mock: 결정론적 합성 이미지 ──────────────────────────────────────────
// 프롬프트에서 "프레임 i/N"을 읽어 원(캐릭터 대역)이 튀는 프레임을 그린다.
// 시트 요청(프레임 표기 없음)은 흰 배경, 프레임 요청은 크로마키용 초록 배경.
function drawScene({ size = 512, background, frame = null }) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set(background, i * 4);
  const radius = size * 0.22;
  const cx = size / 2;
  let cy = size * 0.55;
  if (frame) {
    const phase = ((frame.index - 1) / frame.total) * 2 * Math.PI;
    cy -= Math.abs(Math.sin(phase)) * size * 0.18; // 바운스 루프 (시작=끝)
  }
  const paint = (x, y, r, color) => {
    for (let py = Math.max(0, y - r | 0); py < Math.min(size, y + r); py++) {
      for (let px = Math.max(0, x - r | 0); px < Math.min(size, x + r); px++) {
        if ((px - x) ** 2 + (py - y) ** 2 <= r * r) data.set(color, (py * size + px) * 4);
      }
    }
  };
  paint(cx, cy, radius, [255, 176, 32, 255]);            // 몸통
  paint(cx - radius * 0.35, cy - radius * 0.2, radius * 0.1, [30, 30, 30, 255]); // 눈
  paint(cx + radius * 0.35, cy - radius * 0.2, radius * 0.1, [30, 30, 30, 255]);
  return { width: size, height: size, data };
}

function mockProvider() {
  return {
    name: "mock",
    async generate({ prompt }) {
      const match = /프레임\s+(\d+)\s*\/\s*(\d+)/.exec(prompt);
      const scene = match
        ? drawScene({ background: [0, 255, 0, 255], frame: { index: Number(match[1]), total: Number(match[2]) } })
        : drawScene({ background: [255, 255, 255, 255] });
      return new Uint8Array(encodePng(scene));
    },
  };
}
