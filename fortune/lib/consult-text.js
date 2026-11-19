// 다그당스 상담 노트의 문구 — 역술가가 노트에 써 주는 순서(스크립트)의 말 전부를 여기 한 곳에 둔다(M4 v2, LLM 없음).
// 순수 모듈(DOM 없음). 화면(fortune/notebook/consult.js)과 Node 테스트(_infra/fortune-consult.test.mjs)가 같이 쓴다.
//
// 지키는 것:
//  * 다그당스 말투는 차분하고 따뜻한 역술가의 해요체(~해요/~이에요). “승”으로 끝나는 어미는 쓰지 않는다(사용자 결정 2026-11-16 —
//    가벼워 보인다는 피드백. 인스타 DM 문구만 그 어미를 유지하는데, 그건 이 화면 밖이다). 감탄·장난은 줄인다.
//    풀이 본문(카드·대운·토정)은 엔진이 쓴 해요체를 그대로 옮겨 적는다(지어내지 않는다).
//  * 특성 문장은 note.js 가 고른 것만 쓴다 — 여기에는 성격을 단정하는 말을 두지 않는다(금칙·경향 어미는 테스트가 본다).
//  * 운세끼리 맞세우는 말("사주는 A인데 손금은 B")을 쓰지 않는다. 겹치지 않으면 "같은 말을 한 곳은 아직 없어요"까지만.
export const CONSULT_VERSION = "consult-v2";   // v2: 해요체로 바꿈

export const TOPICS = [
  { id: "love", label: "연애" },
  { id: "work", label: "일" },
  { id: "self", label: "나 자신" },
  { id: "today", label: "그냥 오늘" },
];
export const SKIP = "다음에 할래요";

// 받침에 따라 '이에요/예요', '이군요/군요'
const batchim = (w) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };
const ieyo = (w) => `${w}${batchim(w) ? "이에요" : "예요"}`;
const igunyo = (w) => `${w}${batchim(w) ? "이군요" : "군요"}`;

export const T = {
  hello: ["어서 오세요. 다그당스예요.", "오늘은 이 노트에 하나씩 적어 가며 봐 드릴게요."],
  tapHint: "(화면을 톡 치면 바로 다 써 드려요)",
  again: (date) => `다시 오셨네요. 지난번(${date})에 적은 페이지 아래에 이어서 쓸게요.`,
  againSame: "아까 쓰던 데서 이어 갈게요.",
  topicAsk: "오늘 가장 궁금한 게 뭐예요? 하나에 동그라미를 쳐 주세요.",
  topicAgain: "오늘은 무엇이 궁금하세요?",
  topicPicked: (label) => `좋아요. ‘${label}’ 이야기부터 해 볼게요.`,
  topicSkipped: "그럼 가볍게 시작해 볼게요.",

  tarotAsk: "먼저 카드 한 장을 볼게요. 섞어 두었으니 마음이 가는 걸 골라 주세요.",
  tarotFor: (label) => `‘${label}’을 떠올리며 골라 보세요.`,
  tarotGot: (roman, name, josa, reversed = false) => `「${roman ? `${roman}. ` : ""}${name}」${josa} ${reversed ? "거꾸로 " : ""}나왔어요.`,   // 마이너는 로마 숫자 없이 이름만
  tarot3Lead: (label) => `${label}으로 더 펼쳐 볼게요.`,
  tarot3Pick: (pos) => `‘${pos}’ 자리 카드를 골라 주세요.`,
  tarot3Card: (pos, name, reversed) => `${pos} — 「${name}」${reversed ? "(거꾸로)" : ""}`,
  tarot3Skipped: "세 장은 다음에 펼쳐도 괜찮아요.",
  tarotNow: (state) => `요즘은 ${ieyo(state)}.`,
  tarotKept: (name, until) => `지난번에 뽑은 「${name}」 카드가 아직 ‘요즘’ 자리에 있어요(${until}까지).`,
  tarotSkipped: "카드는 다음에 뽑아도 괜찮아요.",
  tarotCaption: (name, md) => `${name} · ${md}`,
  tarotMargin: (until) => `요즘\n~${until}`,

  birthLead: "카드는 ‘요즘’을 보여 줘요. 생일을 알려 주시면 타고난 바탕도 봐 드릴게요.",
  birthLeadNoCard: "생일을 알려 주시면 타고난 바탕을 봐 드릴게요.",
  birthAsk: "태어난 날이 언제예요?",
  birthTime: "태어난 시각",
  birthTimeUnknown: "몰라요",
  birthDone: "다 적었어요",
  birthKept: (when) => `생일은 지난번에 적어 두었어요 — ${when}.`,
  birthSkipped: "생일은 다음에 알려 주셔도 괜찮아요.",
  birthBusy: "명식을 세고 있어요…",
  sajuStart: (when) => `${igunyo(when)}. 명식을 적어 볼게요.`,
  sajuMe: (name, image) => `나(일간)는 ${name} — ${ieyo(image)}.`,
  sajuBase: "타고난 바탕으로는",
  sajuNoCards: "아직 힘 있게 짚이는 건 없어서, 바탕 한 줄만 적어 둘게요.",
  sajuHourHint: "(태어난 시각을 알면 조금 더 자세해져요)",
  sajuKept: "타고난 바탕은 위에 적은 그대로예요.",
  manyMargin: (el) => `${el}\n많음`,

  palmAsk: "손바닥도 보여 주시겠어요? 사진 한 장이면 선을 그려 드려요.",
  palmConsent: "사진은 보관하지 않아요. 손금을 읽는 동안만 잠깐 올라가고, 다 읽으면 바로 지워요(늦어도 하루 안에). 읽을 때 AI(Claude)가 사진을 봐요. 결과 중 선마다 읽은 글과 특성 목록(예: ‘감정을 차분하게 다루는 편’)만 이 기기의 노트에 남겨요. 사진과 선 위치는 남기지 않아요.",
  palmYes: "네, 보여 줄게요",
  palmShoot: "손바닥 전체가 들어오게 찍어 주세요. 왼손·오른손은 사진에서 알아봐요.",
  palmNoCamera: "카메라를 열 수 없어서 갤러리에서 골라 주세요.",
  palmBlocked: "카메라가 막혀 있어서 갤러리에서 골라 주세요.",
  palmGallery: "🖼️ 갤러리에서 찾기",
  palmReading: "손금을 읽고 있어요. 보통 30초쯤 걸려요.",
  palmAhead: (n) => `앞에 ${n}분이 기다리고 있어요.`,
  palmCaption: (side, n) => `${side ? `${side} · ` : ""}선 ${["", "하나", "둘", "셋", "넷"][n] ?? n}`,
  palmNoTraits: "선은 그렸는데, 특성으로 적을 만큼 또렷한 건 없어요.",
  palmSumUp: "정리하면, 손금으로는 이런 편이에요.",
  palmNoLines: "선마다 풀이는 손바닥을 한 번 더 보여 주시면 적어 드릴게요.",
  palmKept: "손바닥은 지난번에 보았어요. 사진은 남기지 않았고 읽은 것만 적어 두었어요.",
  palmRest: "손금 보기는 지금 잠시 쉬고 있어요. 다음에 보여 주세요.",
  palmSkipped: "손바닥은 다음에 보여 주셔도 괜찮아요.",
  palmRetry: "다시 찍을게요",
  dangiSwitch: "당이",
  dangiSwitchLabel: "곁에 다그당스 그림 보이기",
  palmRedoBtn: "다른 사진으로 다시 보기",
  palmRedoRest: "손금 보기가 지금 쉬고 있어서, 사진은 다음에 바꿀 수 있어요.",
  palmRedoLead: "새 사진으로 다시 볼게요. 새로 읽으면 앞에 적은 손금 풀이는 새 것으로 바꿔요. 이번 사진도 남기지 않아요.",
  palmRedoKeep: "그럼 앞에 본 손금을 그대로 둘게요.",
  palmRedone: "앞의 손금 풀이는 새 사진으로 읽은 것으로 바꿨어요.",
  palmRedoAgain: "손바닥 사진을 바꿔서 다시 봤어요. 위에 적은 손금이 새로 읽은 거예요.",
  palmErr: { offline: "손금 보기가 방금 쉬러 갔어요. 다음에 보여 주세요.", busy: "지금 기다리는 분이 많아요. 조금 뒤에 다시 해 주세요.",
    rate: "조금 쉬었다가 다시 해 주세요.", image: "사진 파일을 열 수 없어요. 다른 사진으로 해 주세요.",
    internal: "처리 중에 문제가 생겼어요. 조금 뒤에 다시 해 주세요.", network: "인터넷 연결을 확인하고 다시 해 주세요." },

  sumLead: "이제 앞에 적은 걸 함께 볼게요.",
  sumSame: "여기와 여기가 같은 말을 하고 있어요.",
  sumSameLine: (label) => `사주도 손금도 「${label}」이라고 했어요.`,
  sumNone: "사주와 손금이 같은 말을 한 곳은 아직 없어요. 서로 부딪치지 않는 것만 적어 두었어요.",
  sumNow: (state) => `그리고 카드는 요즘을 ‘${state}’라고 보여 줬어요.`,
  sumBase: (trait, state) => `타고난 바탕은 사주의 「${trait}」, 요즘은 타로의 「${state}」예요.`,
  sumBaseAgainst: (trait, state) => `타고난 바탕은 사주의 「${trait}」, 요즘은 타로의 「${state}」 — 바탕과 다른 결로 움직이는 때예요.`,
  sameMargin: "같은\n말",

  wrapLead: "오늘 노트를 한 줄로 적으면 이래요.",
  moreAsk: "더 볼까요?",
  more: { tojeong: "올해 토정비결", luck: "대운 흐름", tarot: "카드 한 장", tarot3: "세 장으로 더 보기", birth: "생일 적기", palm: "손바닥 보여 주기", palmRedo: "손바닥 사진 바꾸기", stop: "오늘은 여기까지" },
  luckGender: "대운은 남녀에 따라 흐르는 방향이 달라서, 하나만 더 여쭤볼게요.",
  luckGenders: { male: "남자", female: "여자" },
  luckNone: "대운을 세지 못했어요. 조금 뒤에 다시 해 주세요.",
  luckLead: "10년마다 바뀌는 흐름을 연필로 그려 볼게요. 구간을 누르면 그때 풀이를 적어 드려요.",
  luckPick: (from, to, ganji, luck) => `${from}~${to}세 · ${ganji}${luck ? " 대운" : "(대운 전)"} —`,
  luckNow: (from, to, ganji) => `지금(${from}~${to}세)은 ${ganji} 대운이에요.`,
  luckNext: (from, ganji) => `다음은 ${from}세부터 ${ganji} 대운이에요.`,
  tojeongLead: (year) => `올해(${year}년) 토정비결을 적어 볼게요.`,
  tojeongTitle: (reading, ko) => `괘는 「${reading}」 — ${ko}.`,
  tojeongMonth: (month) => `이번 달(음력 ${month}) 한 줄:`,
  tojeongFail: "토정 본문을 불러오지 못했어요. 조금 뒤에 다시 해 주세요.",
  bye: "오늘은 여기까지 적을게요. 카드는 일주일 뒤에 새로 뽑을 수 있어요.",
  doneMargin: (marks) => [].concat(marks).join("\n"),
  footer: "두 운세가 같은 말을 하거나, 서로 부딪치지 않는 것만 모았어요. 재미로 보는 풀이예요.",
  clear: "이 기기에서 노트 지우기",
  privacy: "개인정보처리방침",
  tabs: "한눈에 보기 →",   // 탭 화면(오늘·사주·궁합·토정·바이오리듬·타로·손금, fortune/note/)
  // 생일 빈칸·차트 오류
  err: {
    year: (max) => `태어난 해는 1920~${max} 사이로 적어 주세요.`,
    month: "월은 1~12로 적어 주세요.",
    day: (m, days) => `${m}월은 ${days}일까지예요.`,
    future: "아직 오지 않은 날이에요.",
    time: "시각은 0~23시, 0~59분으로 적어 주세요.",
    rate: "조금 쉬었다가 다시 해 주세요.",
    chart: "명식을 세지 못했어요. 조금 뒤에 다시 해 주세요.",
  },
};

// 요즘(타로 state)에 맞춘 마무리 한마디 — 조언은 하나, 상황 말투(설계 D4). 성향을 말하지 않는다.
export const STATE_TIP = {
  "state.starting": "요즘은 새로 시작하려는 때라서, 작은 첫걸음 하나를 오늘 떼어 보셔도 좋아요.",
  "state.moving": "요즘은 힘이 붙어 나아가는 때라서, 하던 일을 한 걸음 더 밀어 보셔도 좋아요.",
  "state.growing": "요즘은 키워 온 것이 자라는 때라서, 해 온 일을 한 번 돌아보며 물을 주세요.",
  "state.ordering": "요즘은 틀과 균형을 잡는 때라서, 할 일 하나를 정리해 두면 좋아요.",
  "state.learning": "요즘은 배우고 묻는 때라서, 궁금한 걸 하나 물어보셔도 좋아요.",
  "state.choosing": "요즘은 마음이 갈림길에 선 때라서, 끌리는 쪽을 한 줄로 적어 보세요.",
  "state.pausing": "요즘은 멈춰서 안을 들여다보는 때라서, 오늘은 조용한 시간을 조금 챙겨 보세요.",
  "state.changing": "요즘은 흐름이 바뀌는 때라서, 달라진 것 하나를 알아차려 보세요.",
  "state.closing": "요즘은 한 시기를 정리하는 때라서, 끝낸 일 하나에 동그라미를 쳐 보세요.",
  "state.noticing": "요즘은 나를 묶는 것을 알아차리는 때라서, 줄이고 싶은 습관 하나를 적어 보세요.",
  "state.enduring": "요즘은 부드럽게 버티는 때라서, 오늘은 숨을 한 번 고르고 가셔도 좋아요.",
};
export const NO_STATE_TIP = "오늘은 여기 적은 한 줄만 기억해 두셔도 충분해요.";

// 태어난 시각 → 노트 말("아침 7시 10분"). 시각을 모르면 날짜만.
export function birthWhen(b) {
  const date = `${b.calendar === "lunar" ? "음력 " : ""}${b.y}년 ${b.m}월 ${b.d}일`;
  if (b.timeMode !== "clock" || !/^\d{2}:\d{2}$/.test(b.time || "")) return date;
  const [h, m] = b.time.split(":").map(Number);
  const part = h < 5 ? "새벽" : h < 11 ? "아침" : h < 15 ? "낮" : h < 19 ? "저녁" : "밤";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${date}, ${part} ${h12}시${m ? ` ${m}분` : ""}`;
}

// 모든 고정 문구(검사용) — 함수는 대표 인자로 펼친다
export function allConsultTexts() {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") out.push(v("가", "나", "다"), v("물", "산", "길"));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(T); walk(STATE_TIP); walk(TOPICS.map((t) => t.label)); out.push(SKIP, NO_STATE_TIP);
  return out;
}
