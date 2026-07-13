export const PHASE = Object.freeze({
  ROLE_REVEAL: "role_reveal",
  EXPLANATION_READY: "explanation_ready",
  EXPLANATION: "explanation",
  DISCUSSION: "discussion",
  VOTING: "voting",
  TIE_BREAK: "tie_break",
  LIAR_GUESS: "liar_guess",
  JUDGMENT: "judgment",
  RESULT: "result",
});

export const WORD_BANK = Object.freeze({
  음식: ["김치찌개", "떡볶이", "피자", "초밥", "치킨", "라면", "햄버거", "냉면", "삼겹살", "붕어빵", "김밥", "파스타", "샐러드", "만두", "카레", "팥빙수", "도넛", "샌드위치", "갈비", "순대"],
  동물: ["고양이", "강아지", "코끼리", "기린", "펭귄", "돌고래", "호랑이", "판다", "캥거루", "악어", "수달", "토끼", "다람쥐", "문어", "독수리", "낙타", "고릴라", "북극곰", "거북이", "공작"],
  장소: ["놀이공원", "도서관", "편의점", "공항", "수영장", "동물원", "영화관", "캠핑장", "병원", "학교", "미술관", "헬스장", "카페", "지하철", "해수욕장", "마트", "노래방", "우체국", "백화점", "공원"],
  물건: ["우산", "칫솔", "냉장고", "선풍기", "이어폰", "리모컨", "가위", "거울", "베개", "충전기", "노트북", "텀블러", "시계", "안경", "프라이팬", "카메라", "드라이기", "열쇠", "손전등", "여권"],
  직업: ["소방관", "교사", "의사", "요리사", "파일럿", "경찰관", "배우", "기자", "미용사", "농부", "건축가", "개발자", "작가", "사진작가", "수의사", "운동선수", "택배기사", "웹툰작가", "마술사", "아나운서"],
  스포츠: ["축구", "야구", "농구", "배드민턴", "수영", "양궁", "볼링", "테니스", "탁구", "골프", "스키", "배구", "복싱", "서핑", "마라톤", "펜싱", "컬링", "스케이트보드", "클라이밍", "체조"],
  취미: ["독서", "낚시", "등산", "사진", "요리", "뜨개질", "게임", "그림", "캠핑", "자전거", "영화감상", "노래", "춤", "악기연주", "식물키우기", "퍼즐", "보드게임", "베이킹", "여행", "러닝"],
  인물: ["산타클로스", "백설공주", "신데렐라", "피터팬", "로빈후드", "셜록홈즈", "드라큘라", "슈퍼맨", "배트맨", "스파이더맨", "해리포터", "피노키오", "알라딘", "홍길동", "세종대왕", "이순신", "아인슈타인", "나폴레옹", "모나리자", "로미오"],
});

export function shuffle(values, random = Math.random) {
  const output = [...values];
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function createRound(playerIds, random = Math.random) {
  if (playerIds.length < 4 || playerIds.length > 10) throw new Error("4~10명이 필요합니다.");
  const order = shuffle(playerIds, random);
  const liarId = order[Math.floor(random() * order.length)];
  const moderatorId = order[0];
  const categories = Object.keys(WORD_BANK);
  const category = categories[Math.floor(random() * categories.length)];
  const words = WORD_BANK[category];
  const word = words[Math.floor(random() * words.length)];
  return { order, liarId, moderatorId, category, word };
}

export function privateRoles(round) {
  return Object.fromEntries(round.order.map((id) => [id, id === round.liarId
    ? { role: "liar", category: round.category }
    : { role: "citizen", category: round.category, word: round.word }]));
}

export function tallyVotes(votes = {}, eligibleIds = []) {
  const eligible = new Set(eligibleIds), counts = {};
  for (const vote of Object.values(votes)) {
    const targetId = vote?.targetId;
    if (eligible.has(targetId)) counts[targetId] = (counts[targetId] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  return {
    counts,
    max,
    leaders: max ? eligibleIds.filter((id) => counts[id] === max) : [],
  };
}

export function normalizeGuess(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function resultForAccusation({ accusedId, liarId, word, guess = "", correct = false }) {
  if (accusedId !== liarId) {
    return { winner: "liar", reason: "citizen_accused", accusedId, liarId, word, guess: "", correct: false };
  }
  return { winner: correct ? "liar" : "citizens", reason: correct ? "guess_correct" : "guess_wrong",
    accusedId, liarId, word, guess: normalizeGuess(guess), correct: !!correct };
}
