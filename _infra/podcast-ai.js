// 팟캐스트 대본 규칙 — 워커(업로드 형식 검사)와 집 PC 생성기(`_src/podcast-worker/`)가
// 같이 쓴다. 대본은 PC의 당이(llama-server)가 쓰고 녹음도 PC의 로컬 TTS가 한다 —
// 외부 AI API는 쓰지 않는다. 그래서 이 파일에는 프롬프트와 응답 검증만 있다.

export const SCRIPT_LIMITS = {
  maxTurns: 60,
  // 당이의 컨텍스트(8192토큰) 안에 자료 요약과 대본이 같이 들어가야 한다.
  // 한국어 약 5~6분 분량.
  maxScriptChars: 5000,
};

export const SUPPORTED_SOURCE_TYPES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp",
  "text/plain", "text/markdown",
]);

// 요일은 계산해서 넣는다 — 모델에 맡기면 틀린다(실제로 수요일을 화요일이라 했다).
export function koreanWeekday(dateKst) {
  return "일월화수목금토"[new Date(`${dateKst}T00:00:00Z`).getUTCDay()] + "요일";
}

export function buildScriptPrompt({ dateKst, memory, sourceNames, maxScriptChars = SCRIPT_LIMITS.maxScriptChars }) {
  const memoryBlock = memory?.trim()
    ? `\n[청취자 메모리 — 대본에 반영할 개인 지침]\n${memory.trim()}\n`
    : "";
  return `너는 한국어 데일리 팟캐스트의 작가다. 아래에 붙인 자료(${sourceNames.join(", ")})를 바탕으로
진행자 두 명(A: 차분한 진행자, B: 호기심 많은 해설자)이 나누는 자연스러운 대담 대본을 작성하라.

규칙:
- 오늘은 ${dateKst} ${koreanWeekday(dateKst)}이다. 날짜·요일을 말할 땐 이 값만 쓴다. 아침에 듣는 방송이라는 톤을 유지한다.
- 자료의 핵심 내용을 빠짐없이 다루되, 나열이 아니라 대화로 풀어낸다.
- 인사와 오프닝으로 시작해 요약과 클로징으로 끝낸다.
- 소리로만 듣는 방송이다. 표·목록·기호·영문 약어는 말로 읽을 수 있게 풀어 쓴다.
- 전체 분량은 공백 포함 ${maxScriptChars}자 이내.
- 출력은 아래 JSON 형식만. 다른 텍스트를 붙이지 않는다.
${memoryBlock}
출력 형식:
{"title": "에피소드 제목", "turns": [{"speaker": "A", "text": "..."}, {"speaker": "B", "text": "..."}]}`;
}

// LLM 응답에서 대본 JSON을 꺼내 검증·정규화한다.
export function parseScript(text, { maxTurns = SCRIPT_LIMITS.maxTurns, maxScriptChars = SCRIPT_LIMITS.maxScriptChars } = {}) {
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
