// 약속 정산 — 결제내역 캡처·영수증 사진을 읽어 결제 건을 뽑는다(Gemini 비전).
//
// 결과는 **후보**일 뿐이다: 화면이 보여 주고 사람이 고쳐서 확정해야 정산에 들어간다.
// 캡처 원본은 저장하지 않는다(카드번호 뒷자리 같은 게 찍혀 있다) — 여기서 읽고 버린다.
// 모델은 env.YAKSOK_VISION_MODEL 로 바꾼다. 이름을 박아 두면 신규 키에서 404 가 나는 일이
// 있어(emoticon-vision.test.mjs 참고) 기본값은 버전 없는 "flash-latest" 별칭이다.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 25000;

const PROMPT = `이 이미지는 한국 카드앱·은행앱의 결제내역 캡처이거나 식당 영수증 사진이다.
여러 사람이 함께 먹고 마신 비용을 나누려고 한다. 결제 건(가게 단위)을 모두 뽑아라.
- title: 가게 이름(없으면 품목 요약). 짧게.
- amount: 결제 금액(원, 정수). 쉼표·"원" 없이.
- at: 결제 시각을 "YYYY-MM-DD HH:MM" 으로(모르면 빈 문자열).
- canceled: 취소·환불된 건이면 true.
영수증 한 장이면 합계 한 건만 낸다. 이미지에 결제 정보가 없으면 빈 배열을 낸다.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" }, amount: { type: "INTEGER" },
          at: { type: "STRING" }, canceled: { type: "BOOLEAN" },
        },
        required: ["title", "amount"],
      },
    },
  },
  required: ["items"],
};

// 모델이 돌려준 JSON 을 믿지 않는다 — 모양을 다시 맞추고, 같은 가게·금액·시각은 하나로 합친다
// (두 사람이 같은 캡처를 올리거나 캡처가 겹치는 일이 흔하다).
export function cleanParsed(raw) {
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(raw?.items) ? raw.items : []) {
    const amount = Number.isInteger(item?.amount) ? item.amount : Math.round(Number(item?.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) continue;
    const title = String(item?.title ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) || "결제";
    const at = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(item?.at ?? "") ? item.at : "";
    const key = `${title}|${amount}|${at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ title, amount, at, canceled: item?.canceled === true });
  }
  return items;
}

export async function parseReceipt(env, { data, mime }, fetchImpl = fetch) {
  const key = env.YAKSOK_VISION_API_KEY || env.GEMINI_API_KEY;
  if (!key) {
    throw Object.assign(new Error("자동 인식을 지금 쓸 수 없어요. 금액을 직접 적어 주세요."), { status: 503 });
  }
  const model = env.YAKSOK_VISION_MODEL || DEFAULT_MODEL;
  const response = await fetchImpl(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const status = response.status === 429 ? 503 : 502;
    throw Object.assign(new Error(response.status === 429
      ? "자동 인식이 잠시 붐벼요. 조금 뒤에 다시 하거나 직접 적어 주세요."
      : "자동 인식에 실패했어요. 금액을 직접 적어 주세요."), { status });
  }
  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return cleanParsed(parsed);
}
