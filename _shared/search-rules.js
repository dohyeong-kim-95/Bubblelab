// 랜딩(www) 카드 검색의 규칙 엔진. 서버도 AI도 쓰지 않는 **룰베이스**다 —
// 규칙마다 점수가 정해져 있고, 가장 높은 점수를 낸 규칙 이름이 결과에 함께 나온다.
// 브라우저(www/index.html)와 Node 테스트(_infra/search-rules.test.mjs)가 같이 쓰므로
// DOM·Node API를 쓰지 않는다.
//
// 규칙은 위에서부터 센 순서다.
//   정확 일치   "lotto"  → lotto
//   앞부분 일치 "사다"   → 사다리타기
//   부분 일치   "다리"   → 사다리타기
//   초성 일치   "ㅅㄷㄹ" → 사다리타기
//   자모 일치   "사다ㄹ" → 사다리타기        (한 글자를 덜 친 상태)
//   오타 교정   "tkeklfl" → 사다리타기       (한/영 안 바꾸고 친 경우)
//   비슷한 말   "제비뽑기" → 사다리타기       (아래 SYNONYMS 표)

export const RULES = [
  { id: "exact", label: "정확 일치", score: 100 },
  { id: "prefix", label: "앞부분 일치", score: 76 },
  { id: "part", label: "부분 일치", score: 58 },
  { id: "chosung", label: "초성 일치", score: 46 },
  { id: "jamo", label: "자모 일치", score: 40 },
  { id: "layout", label: "오타 교정", score: 34 },
  { id: "synonym", label: "비슷한 말", score: 30 },
];
const scoreOf = (id) => RULES.find((r) => r.id === id).score;

// 검색 대상 필드와 가중치. 제목·폴더 이름이 본체고, 카테고리 이름과 설명은 거들기만 한다.
const FIELDS = [
  { key: "title", weight: 1 },
  { key: "label", weight: 1 },
  { key: "name", weight: 0.95 },
  { key: "desc", weight: 0.7 },
  { key: "site", weight: 0.6 },
];

// 제목에도 폴더 이름에도 없는 말로 찾아올 때를 위한 유일한 수동 표.
// 한 줄 = 서로 바꿔 써도 되는 말 묶음. 토이를 추가할 때 손댈 필요는 없다
// (제목·폴더 이름은 자동으로 색인된다) — "이 말로도 찾고 싶다" 싶을 때만 늘린다.
export const SYNONYMS = [
  ["사다리", "ladder", "사다리타기", "제비뽑기"],
  ["로또", "lotto", "복권", "추첨"],
  ["운세", "fortune", "사주", "명식", "타로"],
  ["달력", "calendar", "캘린더"],
  ["사진", "photo", "포토", "네컷", "인생네컷", "카메라"],
  ["배경화면", "wallpaper", "월페이퍼", "바탕화면"],
  ["스티커", "sticker", "이모티콘"],
  ["음악", "music", "브금", "bgm"],
  ["채팅", "chat", "대화", "수다"],
  ["명상", "mindfulness", "호흡", "힐링"],
  ["날씨", "brief", "브리핑", "미세먼지", "아침"],
  ["변환", "convert", "이미지"],
  ["별자리", "stars", "밤하늘"],
  ["플래너", "planner", "일정", "다이어리", "할일"],
  ["게임", "game", "games", "놀이"],
  ["발판", "stepcam", "펌프", "pump", "디디알", "ddr", "리듬", "댄스", "춤"],
  ["도구", "util", "유틸", "툴"],
  ["스페인어", "espanol", "español", "스페인", "굿보스", "영화"],
];

/* ---------- 정규화 ---------- */
// 대소문자·띄어쓰기·구분기호를 지운다. "image-convert" 와 "image convert" 가 같아진다.
export function normalize(value) {
  return String(value ?? "").toLowerCase()
    .replace(/[\s··|—–\-_/\\,.()[\]{}!?'"“”‘’:;+&]+/g, "");
}

const CHO = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const JUNG = [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"];
const JONG = ["", ...("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")];
// 겹모음·겹받침은 친 순서(자판 두 번)대로 편다 — 자모 비교의 기준을 자판에 맞춘다.
const SPLIT = {
  ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ",
  ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ",
  ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ",
};
const SYLLABLE = (ch) => ch.codePointAt(0) - 0xac00;
const isSyllable = (n) => n >= 0 && n < 11172;

// 한글 음절을 초성만 남긴 열로. "사다리타기" → "ㅅㄷㄹㅌㄱ"
export function chosungOf(value) {
  let out = "";
  for (const ch of String(value ?? "")) {
    const n = SYLLABLE(ch);
    if (isSyllable(n)) out += CHO[Math.floor(n / 588)];
    else if (/[ㄱ-ㅎ]/.test(ch)) out += ch;
    // 영문·숫자는 뺀다 — 초성 질의는 한글만 겨눈다
  }
  return out;
}
const isChosungQuery = (q) => q.length > 0 && /^[ㄱ-ㅎ]+$/.test(q);

// 한글 음절을 초·중·종 자모열로 편다. "사다리" → "ㅅㅏㄷㅏㄹㅣ"
// 자판을 친 순서와 같아서, 덜 친 질의("사다ㄹ")나 한/영 오타와 그대로 비교된다.
export function jamoOf(value) {
  let out = "";
  for (const ch of String(value ?? "")) {
    const n = SYLLABLE(ch);
    if (!isSyllable(n)) { out += SPLIT[ch] ?? ch; continue; }
    const jung = JUNG[Math.floor((n % 588) / 28)];
    const jong = JONG[n % 28];
    out += CHO[Math.floor(n / 588)] + (SPLIT[jung] ?? jung) + (SPLIT[jong] ?? jong);
  }
  return out;
}

// 두벌식 자판. 한/영 전환을 잊고 친 영문을 자모로 되돌린다.
const KEYS = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ", y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
  Q: "ㅃ", W: "ㅉ", E: "ㄸ", R: "ㄲ", T: "ㅆ", O: "ㅒ", P: "ㅖ",
};
// 영문이 하나도 없으면 빈 문자열 — 규칙을 건너뛰라는 뜻이다.
export function layoutJamo(value) {
  let out = "", hit = 0;
  for (const ch of String(value ?? "")) {
    if (KEYS[ch]) { out += KEYS[ch]; hit++; } else out += ch;
  }
  return hit ? out : "";
}

/* ---------- 한 필드 대 한 낱말 ---------- */
function baseRule(field, q) {
  if (!field || !q) return null;
  if (field === q) return "exact";
  if (field.startsWith(q)) return "prefix";
  if (field.includes(q)) return "part";
  return null;
}

function matchField(raw, token) {
  const field = normalize(raw);
  if (!field) return null;
  const q = normalize(token);
  if (!q) return null;

  const base = baseRule(field, q);
  if (base) return base;
  if (isChosungQuery(q) && chosungOf(raw).includes(q)) return "chosung";
  if (jamoOf(field).includes(jamoOf(q))) return "jamo";

  const typed = layoutJamo(token);
  if (typed && jamoOf(field).includes(jamoOf(normalize(typed)))) return "layout";
  return null;
}

// 비슷한 말: 질의가 든 묶음의 다른 낱말로 한 번 더 찾아본다. 점수는 절반만 준다.
// 짧은 낱말(두 자 이하)은 **부분 일치를 막는다** — "뽑기"가 "꺼내기"에 걸리는 식으로
// 엉뚱한 카드를 끌고 오기 때문이다. 짧은 낱말은 정확·앞부분 일치만 인정한다.
function synonymScore(entry, token) {
  const q = normalize(token);
  let best = 0;
  for (const group of SYNONYMS) {
    if (!group.some((word) => normalize(word) === q)) continue;
    for (const word of group) {
      const term = normalize(word);
      if (term === q) continue;
      for (const { key, weight } of FIELDS) {
        const rule = baseRule(normalize(entry[key]), term);
        if (!rule || (rule === "part" && term.length < 3)) continue;
        best = Math.max(best, scoreOf(rule) * weight * 0.5);
      }
    }
  }
  return best;
}

// 한 낱말에 대한 항목 점수. 못 찾으면 0.
function scoreToken(entry, token) {
  let best = 0, rule = null;
  for (const { key, weight } of FIELDS) {
    const hit = matchField(entry[key], token);
    if (!hit) continue;
    const score = scoreOf(hit) * weight;
    if (score > best) { best = score; rule = hit; }
  }
  const bySynonym = synonymScore(entry, token);
  if (bySynonym > best) { best = bySynonym; rule = "synonym"; }
  return { score: best, rule };
}

/* ---------- 공개 API ---------- */
// entries: { site, name, label, title, desc } 를 가진 카드 목록.
// 띄어쓴 낱말은 **모두** 맞아야 한다("네컷 사진" → 두 낱말 다 맞는 카드만).
export function searchCards(entries, query, { limit = 24 } = {}) {
  const tokens = String(query ?? "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  const hits = [];
  for (const entry of entries) {
    let sum = 0, best = 0, rule = null;
    let all = true;
    for (const token of tokens) {
      const got = scoreToken(entry, token);
      if (!got.score) { all = false; break; }
      sum += got.score;
      if (got.score > best) { best = got.score; rule = got.rule; }
    }
    if (!all) continue;
    hits.push({ entry, score: sum / tokens.length, rule, label: RULES.find((r) => r.id === rule).label });
  }

  // 점수 → 짧은 이름(더 정확한 후보) → 가나다. 같은 질의면 항상 같은 순서가 나온다.
  hits.sort((a, b) =>
    b.score - a.score ||
    String(a.entry.label ?? a.entry.name).length - String(b.entry.label ?? b.entry.name).length ||
    String(a.entry.name).localeCompare(String(b.entry.name), "ko"));
  return hits.slice(0, limit);
}
