// 토정비결 해설 — 괘 본문(tojeong/<괘>.json, 형식 tojeong-text-v2)의 해설을 화면·노트가 쓰는 모양으로 넘긴다.
//
// 원문은 춘호재 필사본(국립중앙도서관 CNTS-00076808100, PD) 괘마다 4구이고, 한 해 총론과 달 풀이는
// **운세 노트 자체 해설**로 본문 JSON 에 사람이 써 둔 글이다(규칙 조합·외부 AI 없음, 같은 괘면 언제나 같은 글).
// 달 풀이는 4구를 석 달씩 맡는다: 1구 정월–3월, 2구 4–6월, 3구 7–9월, 4구 10–12월(`from`).
// 원본·판독 절차·검사는 _src/util-tojeong/DESIGN.md, 형식 검사는 _infra/tojeong-reading.test.mjs.
//
// 브라우저(util/fortune/index.html 이 동적 import)와 Node(만화 사주 노트 note_page.mjs·품질 심사 도구)가
// 같이 쓰므로 DOM 을 쓰지 않는다. 반환 모양({paragraph, months[{month,text,tone}]})은 v1 과 같다.

export const TOJEONG_READING_VERSION = "tojeong-note-v1";

export const MONTH_NAMES = ["정월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "동짓달", "섣달"];

// 달 i 가 기대는 구 번호(0부터). 본문의 from 과 같아야 한다(테스트가 본다).
export const monthSource = (index) => Math.floor(index / 3);

export function yearReading(data) {
  if (data?.format !== "tojeong-text-v2") throw new Error(`토정 본문 형식이 다르다: ${data?.format}`);
  const months = data.months.map((m, i) => ({
    month: MONTH_NAMES[i], text: m.text, tone: m.tone, from: m.from, picks: [`from:${m.from}`, `tone:${m.tone}`],
  }));
  return { version: TOJEONG_READING_VERSION, paragraph: data.overview, months, tone: data.tone, picks: [`tone:${data.tone}`] };
}

// 원문 한 구의 판독 메모 — 신뢰도 중·하 글자와 못 읽은 글자(□)만, 화면에 작게 붙인다.
export function readingNote(line) {
  const parts = (line.chars ?? [])
    .filter((c) => c.conf !== "상" || c.read == null)
    .map((c) => {
      if (c.read == null) return "□ 판독 못 함";
      const alt = c.alt?.length ? `, 다른 읽기 ${c.alt.join("·")}` : "";
      return `${c.read} ${c.conf === "하" ? "추정" : "흘림"}${alt}`;
    });
  const page = line.src ? `필사본 ${line.src.folio}장` : "";
  return [page, ...parts].filter(Boolean).join(" · ");
}
