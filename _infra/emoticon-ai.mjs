// 움직이는 이모티콘 이미지 생성 AI 계층 (work/emoticon 툴, CLI 전용 — Worker는
// emoticon-gen.js만 임포트한다). 프로바이더는 env로 교체:
//   EMOTICON_IMAGE_PROVIDER  "edge"(기본) | "gemini" | "mock"
//   edge   — 배포된 워커 프록시(/_emoticon/generate) 경유. API 키가 Worker
//            secret(GEMINI_STICKER_KEY)에만 있을 때 쓴다.
//            EMOTICON_EDGE_TOKEN (work 마스터 비밀번호, 필수)
//            EMOTICON_EDGE_URL   (기본 https://work.bubblelab.dev/_emoticon/generate)
//   gemini — Gemini API 직접 호출. EMOTICON_IMAGE_API_KEY 또는 GEMINI_API_KEY.
//            EMOTICON_IMAGE_MODEL (기본 gemini-2.5-flash-image)
//   mock   — API 키 없이 파이프라인 전체를 검증하는 합성 이미지 생성기
//            (테스트·드라이런 전용, 실제 산출물 품질과 무관).
import { encodePng } from "./png.mjs";
import { bytesToBase64, DEFAULT_IMAGE_MODEL, geminiGenerate } from "./emoticon-gen.js";

export { DEFAULT_IMAGE_MODEL };
const DEFAULT_EDGE_URL = "https://work.bubblelab.dev/_emoticon/generate";

// 프로바이더 인터페이스: generate({ prompt, references }) → 이미지 바이트(Uint8Array).
// references는 PNG/JPEG 바이트 배열 — 캐릭터 시트·이전 프레임을 넣어 일관성을 지킨다.
export function imageProvider(env = process.env) {
  const provider = env.EMOTICON_IMAGE_PROVIDER || "edge";

  if (provider === "mock") return mockProvider();

  if (provider === "gemini") {
    const model = env.EMOTICON_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
    return {
      name: `gemini/${model}`,
      async generate({ prompt, references = [] }) {
        const apiKey = env.EMOTICON_IMAGE_API_KEY || env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY(또는 EMOTICON_IMAGE_API_KEY)가 설정되지 않았습니다");
        return geminiGenerate({ apiKey, model, prompt, referencesB64: references.map(bytesToBase64) });
      },
    };
  }

  if (provider === "edge") {
    const url = env.EMOTICON_EDGE_URL || DEFAULT_EDGE_URL;
    return {
      name: `edge(${new URL(url).hostname})`,
      async generate({ prompt, references = [] }) {
        const token = env.EMOTICON_EDGE_TOKEN;
        if (!token) throw new Error("EMOTICON_EDGE_TOKEN(work 마스터 비밀번호)이 설정되지 않았습니다");
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ prompt, references: references.map(bytesToBase64) }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`edge 생성 실패 (${res.status}): ${body.slice(0, 300)}`);
        }
        return new Uint8Array(await res.arrayBuffer());
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
      const match = /(?:frame|key pose)\s+(\d+)\s*\/\s*(\d+)/i.exec(prompt);
      const scene = match
        ? drawScene({ background: [0, 255, 0, 255], frame: { index: Number(match[1]), total: Number(match[2]) } })
        : /in-between|breakdown/i.test(prompt)
          ? drawScene({ background: [0, 255, 0, 255], frame: { index: 2, total: 8 } })
          : drawScene({ background: [255, 255, 255, 255] });
      return new Uint8Array(encodePng(scene));
    },
  };
}
