// 운세 노트 타로 — 뽑기·배열·풀이를 정하는 순수 모듈(DOM 없음).
// 원본은 fortune/lib/(운세 코드의 최종 집). 화면(util/fortune/tarot/page.js — 이주 동안 build.mjs 가 util/fortune/lib/ 로 복사)과
// Node 테스트(_infra/fortune-tarot.test.mjs)가 같이 쓰고,
// 나중에 다그당스 대화가 같은 함수를 도구로 부른다(입력 {spread, order, picks, flips?, date, question?} → JSON — 카드마다 reversed,
// 카드끼리 잇기 flow{slots, texts}, 맺음 closing 까지 들어 있다).
//
// 지키는 것:
//  * 결정적이다 — 같은 입력이면 언제나 같은 출력. 무작위는 섞기(drawDeck/shuffleDeck) 한 곳뿐이고, 그 결과(order·flips)를
//    입력으로 받는다. 고른 자리(picks) = 카드. 미리 정해 둔 카드는 없다.
//  * 역방향(v4, 사용자 결정 2026-11-16): 섞을 때 카드마다 정/역을 함께 정한다(flips, 셋 중 하나꼴). 거꾸로 나온 카드의 풀이는
//    세게 말하지 않는다 — 부드러운 말투로 역방향 뜻을 쓸 뿐, 따로 붙이는 경고·안내 표시는 없다(화면에는 "거꾸로 나왔어요." 정도만).
//    문장은 tarot-texts.js 의 rev(caution 읽는 자리·tip 조언 자리). 안심 문장은 이름만으로 놀랄 수 있는 메이저 셋(죽음·악마·탑)의 정방향에만.
//    역방향 카드는 노트의 '요즘'(state)을 내지 않는다(사주·손금과 모순이 생길 틈을 만들지 않는다 — note.js tarotStates).
//    flips 가 없는 옛 기록은 모두 정방향으로 읽는다.
//  * 풀이 문장은 아래 TEXTS 표에서만 나온다(LLM 없음). 문장은 A. E. Waite 『The Pictorial Key to the Tarot』
//    (1911) Part III §3 의 뜻을 뼈대로 운세 노트가 새로 썼다. 현대 해설서·번역본·위키 문장은 쓰지 않았다.
//    카드마다 원문 키워드(waite.orig)와 무엇을 남기고 뺐는지(waite.note)를 남겨 둔다.
//  * 건강·임신·수명 단정, 투자·복권, 법률 결과, 겁주기는 쓰지 않는다 — _infra/fortune-tarot.test.mjs 가 금칙어를 본다.
//  * 덱 이름(상표)은 쓰지 않는다. 그림은 운세 노트가 그린 당이 카드 78장(구도·상징은 1909년 퍼블릭 도메인 카드를 따름).
//  * 덱은 78장 — 메이저 22장(이 파일) + 마이너 56장(tarot-minor.js, 풀이 문장 표까지 같은 형식). 마이너도 Waite Part III §2 의 뜻이 뼈대다.
//  * 옛 저장 호환: v2 까지의 기록은 메이저 22장 순열(order)이었다 — readTarot 은 그것도 그대로 읽는다(같은 날 같은 카드).

import { ART_FILES, ART_SIZE } from "./art.js";
import { CLASSIC_FILES, CLASSIC_SIZE } from "./art-classic.js";
import { CLASSIC, CLASSIC_REASSURE } from "./tarot-classic.js";
import { MINOR_CARDS } from "./tarot-minor.js";

import { MORE_TEXTS } from "./tarot-texts.js";

// v4: 스프레드 4개(마음·갈림길 추가)·역방향(조심할 점)·카드 잇기·맺음(2026-11-16). v3: 마이너 56장을 더해 78장. v2: 당이 그림
export const TAROT_VERSION = "tarot-kr-v4";
export const ART_CREDIT = "운세 노트 다그당스(당이) 그림";
export const CLASSIC_CREDIT = "Pamela Colman Smith, 1909년 초판(퍼블릭 도메인, 위키미디어 공용)";
export const TEXT_CREDIT = "풀이는 A. E. Waite 『The Pictorial Key to the Tarot』(1911)의 뜻을 뼈대로 운세 노트가 새로 썼어요.";
export const DISCLOSURE = "재미와 돌아보기용이에요. 중요한 결정은 사실을 확인하고 스스로 내려 주세요.";

// 자리. text = 그 자리에 쓰는 문장 칸(TEXTS[id][text]), advice = 조언 자리(거꾸로 나오면 '조심하며 해 볼 것' 문장).
export const POSITIONS = {
  today: { key: "today", label: "오늘의 카드", desc: "오늘 하루를 비추는 카드", text: "today", advice: false },
  now: { key: "now", label: "지금", desc: "지금 놓인 상황", text: "now", advice: false },
  block: { key: "block", label: "걸림", desc: "마음이나 상황에서 걸리는 것", text: "block", advice: false },
  step: { key: "step", label: "한 걸음", desc: "다음에 해 볼 수 있는 것", text: "step", advice: true },
  me: { key: "me", label: "나", desc: "이 관계 안의 지금 나", text: "now", advice: false },
  us: { key: "us", label: "우리 사이", desc: "두 사람 사이에 흐르는 것", text: "us", advice: false },
  try: { key: "try", label: "내가 해 볼 것", desc: "내 쪽에서 해 볼 수 있는 것", text: "step", advice: true },
  a: { key: "a", label: "A로 가면", desc: "첫 번째 길을 걸을 때의 결", text: "path", advice: false },
  b: { key: "b", label: "B로 가면", desc: "두 번째 길을 걸을 때의 결", text: "path", advice: false },
  consider: { key: "consider", label: "고를 때 볼 것", desc: "어느 길이든 고르기 전에 살필 것", text: "step", advice: true },
};
// 스프레드 4개(B안). 모두 3장 이하. sub = 목록·결과 위 부제.
export const SPREADS = {
  one: { id: "one", label: "오늘의 카드 한 장", positions: ["today"], question: false,
    sub: "오늘 하루를 비추는 카드를 한 장 골라요." },
  three: { id: "three", label: "지금 · 걸림 · 한 걸음", positions: ["now", "block", "step"], question: true,
    sub: "고민이 있을 때 세 장을 골라요. 마지막 장은 해 볼 일이에요." },
  heart: { id: "heart", label: "마음 3장 · 나 · 우리 사이 · 내가 해 볼 것", short: "마음 3장", positions: ["me", "us", "try"], question: true,
    sub: "그 사람 마음을 맞히기보다, 우리 사이를 보는 카드예요." },
  cross: { id: "cross", label: "갈림길 3장 · A로 가면 · B로 가면 · 고를 때 볼 것", short: "갈림길 3장", positions: ["a", "b", "consider"], question: true,
    sub: "두 길을 마음에 두고 골라요. 어느 쪽이 맞다고 정해 주지는 않아요." },
};
export const SPREAD_ORDER = ["one", "three", "heart", "cross"];

// ── 질문 다듬기 ── 주제 칩 → 추천 스프레드, 예/아니오 끝말이면 "~하려면 무엇이"로 바꾼 예. 결정적 정규식, 서버 없음.
export const TOPICS = [
  { id: "love", label: "연애·관계", spread: "heart", example: "그 사람과 더 가까워지려면 무엇을 해 보면 좋을까요?" },
  { id: "work", label: "일·진로", spread: "three", example: "일이 손에 잘 잡히려면 무엇부터 바꿔 볼까요?" },
  { id: "choice", label: "고르기", spread: "cross", example: "이 일과 저 일 사이에서 무엇을 보고 고르면 좋을까요?" },
  { id: "self", label: "나 자신", spread: "three", example: "요즘 지친 마음을 돌보려면 무엇이 필요할까요?" },
  { id: "today", label: "그냥 오늘", spread: "one", example: null },
];
export const QUESTION_TIP = "‘될까요?’보다 ‘~하려면 무엇이 필요할까요?’처럼 물으면 카드가 길을 더 잘 보여 줘요.";
const YES_NO = /(?:할까|될까|올까|갈까|있을까|없을까|좋을까|맞을까|생길까|이어질까|붙을까|풀릴까|받을까|볼까|줄까|날까|일까)(?:요)?\s*[?？!.]*\s*$/;
const OPEN_Q = /무엇|무얼|뭘|뭐가|뭐부터|어떻게|어떤|어떨|왜|언제|어디|누구|얼마나|무슨/;
/** 질문 → { yesNo, example } — 예/아니오로 끝나면 같은 고민을 "어떻게"로 바꾼 예를 준다(못 바꾸면 example null, 안내만). */
export function refineQuestion(q) {
  const t = String(q ?? "").normalize("NFC").trim();
  // 이미 열린 질문(무엇·어떻게·왜…)이면 끝말이 '~할까'여도 그대로 둔다
  if (!t || !YES_NO.test(t) || OPEN_Q.test(t)) return { yesNo: false, example: null, tip: null };
  // "X해도 될까 / X하면 될까 / X할까 / X하게 될까 / X될까" 의 X(명사·명사구)만 남기고 "X하려면 무엇이 필요할까요?"
  const m = /^(.*?[가-힣A-Za-z0-9])\s*(?:을|를)?\s*(?:해도|하면|하게|할|해야)?\s*(?:잘\s*)?(?:될까|할까|붙을까|풀릴까)(?:요)?\s*[?？!.]*\s*$/.exec(t);
  const stem = m?.[1]?.replace(/\s*(?:이번에|이번엔|올해|지금|과연)\s*/g, " ").trim();
  const example = stem && stem.length <= 30 && !/[?？]/.test(stem) ? `${stem.replace(/(하|되)$/, "")}하려면 무엇이 필요할까요?` : null;
  return { yesNo: true, example, tip: QUESTION_TIP };
}

// ── 카드 그림 주소 — 여기 한 곳에서만 정한다 ──
// 당이 타로 그림(22장). 그림은 저장소가 아니라 R2(bubblelab-fortune 의 art/tarot/)에 있고, 워커가 /_fortune/art/tarot/<파일> 로
// 내준다. 파일 이름(내용 해시)은 art.js 표가 정한다 — 그림을 바꾸면 _src/fortune-tarot/upload-art.sh 를 돌리고 art.js 를 저장소에 올린다.
// 덱 두 벌 — 당이(기본)와 클래식(1909 초판 스캔, 퍼블릭 도메인). 덱은 그림·그림 묘사 문장만 바꾸고 뽑기·뜻은 같다.
// 클래식 그림은 R2 art/tarot-classic/(_src/fortune-tarot/upload-art.sh --deck classic), 매니페스트 art-classic.js.
export const DECKS = {
  dangi: { id: "dangi", label: "당이 그림", base: "/_fortune/art/tarot/", files: ART_FILES, size: ART_SIZE, credit: ART_CREDIT },
  classic: { id: "classic", label: "1909 옛 그림", base: "/_fortune/art/tarot-classic/", files: CLASSIC_FILES, size: CLASSIC_SIZE, credit: CLASSIC_CREDIT },
};
export const DECK_IDS = Object.keys(DECKS);
export const DEFAULT_DECK = "dangi";
export const CARD_ART = DECKS.dangi;   // 옛 import 호환(당이 덱)
export const deckOf = (d) => (DECKS[d] ? d : DEFAULT_DECK);
export const cardImage = (id, deck = DEFAULT_DECK) => `${DECKS[deck].base}${DECKS[deck].files[id]}`;

// ── 읽는 틀 ── 카드 한 장을 읽을 때 '어느 영역의 일인지(무늬)·어느 단계인지(숫자)·어떤 태도인지(궁정)'를 같이 본다.
// 메이저는 큰 흐름과 마음의 주제, 마이너는 그 흐름이 일상에서 드러나는 모습. 문구는 여기 한 곳.
export const ARCANA = {
  major: { key: "major", label: "메이저 아르카나", desc: "큰 흐름과 마음의 주제를 보여 주는 카드예요." },
  minor: { key: "minor", label: "마이너 아르카나", desc: "그 흐름이 하루하루의 일에서 드러나는 모습을 보여 주는 카드예요." },
};
export const SUITS = {
  wands: { key: "wands", name: "완드", domain: "의욕·일", desc: "완드는 의욕과 일, 무언가를 해 보려는 힘의 무늬예요." },
  cups: { key: "cups", name: "컵", domain: "마음·관계", desc: "컵은 마음과 관계, 주고받는 감정의 무늬예요." },
  swords: { key: "swords", name: "소드", domain: "생각·갈등", desc: "소드는 생각과 말, 부딪히고 가르는 일의 무늬예요." },
  pentacles: { key: "pentacles", name: "펜타클", domain: "돈·몸·현실", desc: "펜타클은 살림과 몸, 손에 잡히는 현실의 무늬예요." },
};
export const SUIT_ORDER = ["wands", "cups", "swords", "pentacles"];
// 숫자 흐름(1~10)과 궁정 카드(11~14 = 사람·태도). label 은 카드 이름에 쓰는 말.
export const RANKS = {
  1: { label: "에이스", flow: "씨앗·시작", desc: "에이스는 그 무늬의 씨앗이에요. 막 시작되는 기운으로 읽어요." },
  2: { label: "2", flow: "고르기·균형", desc: "2는 둘 사이에서 고르고 균형을 잡는 단계예요." },
  3: { label: "3", flow: "첫 결과·함께", desc: "3은 처음 모양이 잡히고 함께하는 사람이 생기는 단계예요." },
  4: { label: "4", flow: "안정·멈춤", desc: "4는 자리를 잡고 잠시 멈춰 지키는 단계예요." },
  5: { label: "5", flow: "흔들림·부딪힘", desc: "5는 잘 되던 것이 흔들리고 부딪히는 단계예요." },
  6: { label: "6", flow: "회복·주고받기", desc: "6은 다시 숨을 고르고 주고받으며 회복하는 단계예요." },
  7: { label: "7", flow: "버티기·시험", desc: "7은 버티고 시험받으며 내 자리를 확인하는 단계예요." },
  8: { label: "8", flow: "움직임·익히기", desc: "8은 다시 움직이고 손에 익히는 단계예요." },
  9: { label: "9", flow: "거의 다 옴", desc: "9는 거의 다 와서 그동안의 것이 드러나는 단계예요." },
  10: { label: "10", flow: "끝·가득 참", desc: "10은 한 바퀴가 가득 차서 끝나고 다음으로 넘어가는 단계예요." },
  11: { label: "시종", flow: "배우는 태도", desc: "시종은 호기심을 갖고 배우는 태도, 또는 막 들어온 소식이에요." },
  12: { label: "기사", flow: "움직이는 태도", desc: "기사는 그 무늬의 기운을 들고 움직이는 태도예요." },
  13: { label: "여왕", flow: "품는 태도", desc: "여왕은 그 무늬의 기운을 안에서 품고 돌보는 태도예요." },
  14: { label: "왕", flow: "다스리는 태도", desc: "왕은 그 무늬의 기운을 바깥에서 책임지고 다스리는 태도예요." },
};
/** 카드 한 장의 읽는 틀 — [메이저/마이너 설명, 무늬 설명, 숫자·궁정 설명] 중 있는 것만 */
export function cardFrame(card) {
  if (!card) return [];
  if (card.arcana === "major") return [ARCANA.major.desc];
  return [ARCANA.minor.desc, SUITS[card.suit].desc, RANKS[card.rank].desc];
}

// ── 메이저 22장 ── 번호는 Waite 체계(8 = 힘, 11 = 정의). 당이 카드 그림의 번호(아래 띠)와 같다.
// symbol: 그림 속 장면(캡션), word: 풀이에 반드시 나오는 그림 낱말, tone: light | neutral | heavy.
// theme·snag·move: 3장 종합 한 줄에 쓰는 짧은 말(자리별).
const C = (no, name, roman, symbol, word, tone, theme, snag, move, orig, note) => ({
  id: `maj_${String(no).padStart(2, "0")}`, arcana: "major", suit: null, rank: null, no, roman, name, symbol, word, tone, theme, snag, move,
  image: cardImage(`maj_${String(no).padStart(2, "0")}`),
  waite: { work: "A. E. Waite, The Pictorial Key to the Tarot (1911)", part: "Part III §3", orig, note },
});
const MAJORS = [
  C(0, "바보", "0", "벼랑 끝에서 하늘을 보며 걷는 당이와 흰 개", "벼랑", "light",
    "새로 시작하려는 마음", "준비 없이 뛰어드는 마음", "작게 첫발 떼기",
    "Folly, mania, extravagance, intoxication, delirium, frenzy", "어리석음·무모함을 '가벼운 시작'과 '발밑 살피기'로 나눠 썼다. 중독·광기는 뺐다."),
  C(1, "마법사", "I", "탁자 위에 놓인 잔·칼·지팡이·동전 네 가지 도구", "도구", "light",
    "가진 재주를 쓸 때", "한꺼번에 다 하려는 욕심", "도구 하나로 바로 시작하기",
    "Skill, diplomacy, address, subtlety; sickness, pain, loss, disaster; self-confidence, will", "재주·자신감만 남겼다. 질병·손실·재난은 뺐다."),
  C(2, "여사제", "II", "두 기둥 사이에 앉아 반쯤 가린 두루마리", "두루마리", "neutral",
    "아직 드러나지 않은 것", "혼자만의 짐작", "조용히 적으며 살피기",
    "Secrets, mystery, the future as yet unrevealed; silence, tenacity; wisdom", "비밀·침묵·지혜를 '조용히 살피기'로 썼다."),
  C(3, "여황제", "III", "여황제 앞에 무르익은 밀밭", "밀밭", "light",
    "키워 온 것이 자라는 때", "나를 뒤로 미루는 마음", "아끼는 것 하나 가꾸기",
    "Fruitfulness, action, initiative, length of days; also difficulty, doubt", "결실·돌봄을 썼다. 수명(length of days)은 뺐다."),
  C(4, "황제", "IV", "숫양 머리가 새겨진 돌 왕좌", "왕좌", "neutral",
    "틀과 기준을 세울 때", "내 방식만 고집하는 마음", "순서를 정해 하나씩 끝내기",
    "Stability, power, protection, realization; aid, reason, conviction; authority and will", "안정·질서·책임을 썼다."),
  C(5, "교황", "V", "아기 당이 둘 앞에서 손을 들어 가르치는 스승 당이", "스승", "neutral",
    "배우고 묻는 자리", "남이 정한 정답에 기대는 마음", "믿을 만한 사람에게 묻기",
    "Marriage, alliance, captivity, servitude; mercy and goodness; inspiration; the man to whom the Querent has recourse", "'기댈 만한 사람·배움'을 썼다. 결혼·속박 단정은 뺐다."),
  C(6, "연인", "VI", "아기 당이 둘 위에서 팔을 벌린 천사 당이", "천사", "light",
    "마음이 끌리는 갈림길", "고르지 못하고 미루는 마음", "솔직하게 마음 말하기",
    "Attraction, love, beauty, trials overcome", "끌림·고르기로 썼다."),
  C(7, "전차", "VII", "흰 스핑크스와 검은 스핑크스가 끄는 전차", "스핑크스", "light",
    "밀고 나갈 힘이 붙는 때", "앞서 가려는 조급함", "목표를 한 문장으로 정하기",
    "Succor, providence; also war, triumph, presumption, vengeance, trouble", "전진·승리를 썼다. 싸움·복수는 뺐다."),
  C(8, "힘", "VIII", "사자의 입을 부드러운 손길로 다루는 당이", "사자", "light",
    "부드럽게 버티는 힘", "꾹 참기만 하는 마음", "작은 꾸준함 하나 지키기",
    "Power, energy, action, courage, magnanimity; complete success and honors", "용기·너그러움을 '부드럽게 버티는 힘'으로 썼다."),
  C(9, "은둔자", "IX", "별이 든 등불을 들고 선 당이", "등불", "neutral",
    "혼자 정리할 시간", "혼자 다 떠안는 마음", "조용히 30분 생각하기",
    "Prudence, circumspection; also and especially treason, dissimulation, roguery, corruption", "신중함만 남겼다. 배신·속임은 뺐다."),
  C(10, "운명의 수레바퀴", "X", "구름 속에서 도는 큰 바퀴", "바퀴", "light",
    "흐름이 바뀌는 때", "다 통제하려는 마음", "들어온 기회에 응하기",
    "Destiny, fortune, success, elevation, luck, felicity", "흐름의 변화로 썼다. '운명'을 정해진 결과로 말하지 않는다."),
  C(11, "정의", "XI", "한 손에 저울, 한 손에 칼을 든 당이", "저울", "neutral",
    "공정하게 따져 볼 때", "옳고 그름만 따지는 마음", "장단점을 나란히 적기",
    "Equity, rightness, probity, executive; triumph of the deserving side in law", "공정·정직만 남겼다. 법적 다툼의 결과는 말하지 않는다."),
  C(12, "매달린 사람", "XII", "나무에 거꾸로 매달렸지만 평온한 얼굴, 머리 둘레의 빛", "거꾸로", "neutral",
    "멈춰서 다르게 보는 때", "내려놓지 못하는 마음", "반대 입장에서 보기",
    "Wisdom, circumspection, discernment, trials, sacrifice, intuition", "멈춤·관점 바꾸기로 썼다."),
  C(13, "죽음", "XIII", "흰 장미가 그려진 검은 깃발, 멀리 떠오르는 해", "깃발", "heavy",
    "한 시기를 정리하는 때", "끝난 것을 붙잡는 마음", "하나를 정리하고 비우기",
    "End, mortality, destruction, corruption; the loss of a benefactor", "'끝맺음'만 남겨 정리·새 시작으로 썼다. 죽음·파괴·상실은 문자 그대로 쓰지 않는다."),
  C(14, "절제", "XIV", "두 잔 사이로 물을 옮겨 붓는 천사 당이", "잔", "light",
    "균형을 맞춰 가는 때", "한쪽으로 쏠린 생활", "하루 리듬 하나 맞추기",
    "Economy, moderation, frugality, management, accommodation", "절제·조율을 썼다."),
  C(15, "악마", "XV", "목에 걸린 사슬이 헐거운 아기 당이 둘", "사슬", "heavy",
    "나를 묶는 것을 알아차릴 때", "알면서도 끊지 못하는 습관", "습관 하나에 작은 규칙 걸기",
    "Ravage, violence, vehemence, extraordinary efforts, force, fatality; that which is predestined but is not for this reason evil", "폭력·숙명은 뺐다. 그림의 헐거운 사슬로 '벗을 수 있는 습관'을 썼다."),
  C(16, "탑", "XVI", "번개를 맞아 꼭대기 왕관이 떨어지는 탑", "번개", "heavy",
    "단단하던 것이 흔들리는 때", "낡은 틀을 붙잡는 마음", "한 군데부터 다시 세우기",
    "Misery, distress, indigence, adversity, calamity, disgrace, deception, ruin; unforeseen catastrophe", "재난·몰락은 뺐다. '예상 밖의 흔들림과 다시 세우기'로 썼다."),
  C(17, "별", "XVII", "큰 별 아래에서 물을 땅과 연못에 붓는 당이", "별", "light",
    "다시 희망을 품는 때", "바라기만 하는 마음", "바람을 작은 할 일로 바꾸기",
    "Loss, theft, privation, abandonment; another reading says—hope and bright prospects", "원문의 두 읽기 가운데 '희망'을 골랐다. 상실·도난은 뺐다."),
  C(18, "달", "XVIII", "달을 보며 우는 개와 늑대, 물에서 기어 나오는 가재", "달", "neutral",
    "흐릿하고 뒤숭숭한 때", "확인하지 않은 걱정", "짐작 대신 직접 확인하기",
    "Hidden enemies, danger, calumny, darkness, terror, deception, occult forces, error", "숨은 적·공포는 뺐다. 흐릿함·착각을 '확인하기'로 썼다."),
  C(19, "태양", "XIX", "해바라기 앞에서 흰 말을 탄 작은 당이", "해바라기", "light",
    "환하게 풀리는 때", "들뜬 마음에 놓치는 작은 일", "좋은 일을 나누기",
    "Material happiness, fortunate marriage, contentment", "기쁨·만족을 썼다. 결혼 예언은 뺐다."),
  C(20, "심판", "XX", "천사의 나팔 소리에 일어나는 아기 당이들", "나팔", "light",
    "다시 일어나 답할 때", "지난 일을 곱씹는 마음", "미뤄 둔 일 다시 꺼내기",
    "Change of position, renewal, outcome; another account specifies total loss through lawsuit", "새로워짐·다시 일어남을 썼다. 소송 손실은 뺐다."),
  C(21, "세계", "XXI", "둥근 화환 안에서 춤추는 당이", "화환", "light",
    "한 바퀴를 마무리하는 때", "끝맺지 못하는 마음", "하나를 완료로 표시하기",
    "Assured success, recompense, voyage, route, change of place", "완성·마무리를 썼다. '확실한 성공'은 단정하지 않는다."),
];
// 메이저 카드의 뜻(한두 문장)과 그림 속 상징(한두 개 — [낱말, 뜻]). 마이너는 tarot-minor.js 에 같은 칸이 있다.
const MAJOR_DETAIL = {
  maj_00: ["새로운 시작과 가벼운 호기심의 카드예요. 계산보다 마음이 먼저 움직이는 출발을 말해요.", [["벼랑", "앞이 다 보이지 않아도 내딛는 첫발이에요."], ["흰 개", "들뜬 마음 옆에서 발밑을 일러 주는 목소리예요."]]],
  maj_01: ["가진 재주와 수단을 실제로 쓰는 카드예요. 마음먹은 것을 손으로 옮기는 힘을 말해요.", [["네 가지 도구", "필요한 재료가 이미 손 닿는 곳에 있다는 뜻이에요."], ["위로 든 손", "생각을 실제 일로 끌어내리는 몸짓이에요."]]],
  maj_02: ["아직 드러나지 않은 것과 조용한 앎의 카드예요. 서두르기보다 지켜보며 알아차리는 때를 말해요.", [["두루마리", "반쯤 가려 둔 앎, 때가 되면 펼쳐질 이야기예요."], ["두 기둥", "아는 것과 모르는 것 사이에 앉은 자리예요."]]],
  maj_03: ["돌보고 키워 온 것이 무르익는 카드예요. 넉넉함과 아끼는 마음을 말해요.", [["밀밭", "들인 정성만큼 익어 가는 결실이에요."], ["푹신한 자리", "나를 편히 쉬게 하는 것도 키우는 일이라는 뜻이에요."]]],
  maj_04: ["틀과 기준, 책임의 카드예요. 질서를 세워 일을 안정시키는 힘을 말해요.", [["돌 왕좌", "쉽게 흔들리지 않는 단단한 기준이에요."], ["숫양 머리", "앞장서서 밀고 가는 의지예요."]]],
  maj_05: ["배움과 믿을 만한 길잡이의 카드예요. 검증된 방법과 함께 묻는 자리를 말해요.", [["스승", "혼자 다 알지 않아도 된다는 듯 길을 일러 주는 사람이에요."], ["아기 당이 둘", "배우려고 마음을 연 자리예요."]]],
  maj_06: ["끌림과 고르기의 카드예요. 마음이 가는 쪽과 내가 아끼는 것을 맞춰 보는 때를 말해요.", [["천사", "두 마음을 내려다보며 솔직함을 비춰 주는 빛이에요."], ["마주 선 둘", "서로를 보고 고르는 관계예요."]]],
  maj_07: ["엇갈리는 힘을 한 방향으로 모아 나아가는 카드예요. 의지와 전진을 말해요.", [["두 스핑크스", "서로 다른 쪽을 보는 마음과 조건이에요."], ["전차", "그 둘을 묶어 앞으로 가게 하는 의지예요."]]],
  maj_08: ["부드럽게 버티는 힘의 카드예요. 억누르기보다 달래며 다루는 용기를 말해요.", [["사자", "내 안의 센 기운이나 다루기 어려운 상황이에요."], ["부드러운 손길", "힘보다 끈기와 다정함이 이긴다는 뜻이에요."]]],
  maj_09: ["혼자 정리하는 시간과 신중함의 카드예요. 바로 앞 한 걸음을 비추는 지혜를 말해요.", [["등불", "멀리보다 바로 앞 한 걸음을 비추는 빛이에요."], ["지팡이", "천천히 제 속도로 걷게 하는 버팀이에요."]]],
  maj_10: ["흐름이 바뀌는 카드예요. 멈춰 있던 일이 움직이고 새 국면이 열리는 때를 말해요.", [["바퀴", "올라가고 내려오며 계속 도는 흐름이에요."], ["구름", "다 보이지 않는 곳에서 바뀌는 사정이에요."]]],
  maj_11: ["공정하게 따져 보는 카드예요. 정직하게 보고 균형 있게 정리하는 때를 말해요.", [["저울", "주고받은 것을 기울지 않게 재는 눈이에요."], ["칼", "따져 본 뒤 깔끔하게 정하는 결단이에요."]]],
  maj_12: ["멈춰서 다르게 보는 카드예요. 기다림 속에서 관점이 바뀌는 때를 말해요.", [["거꾸로 매달림", "익숙한 각도를 뒤집어 보는 자세예요."], ["머리 둘레의 빛", "멈춘 시간에 오히려 생각이 밝아진다는 뜻이에요."]]],
  maj_13: ["한 시기를 마무리하고 다음을 여는 카드예요. 끝맺음과 새 출발을 말해요.", [["검은 깃발의 흰 장미", "끝난 자리에서 피어나는 새로움이에요."], ["떠오르는 해", "정리한 뒤에 오는 다음 날이에요."]]],
  maj_14: ["알맞게 섞고 맞추는 카드예요. 서두르지 않는 균형과 조율을 말해요.", [["두 잔", "서로 다른 것을 오가며 맞추는 마음이에요."], ["옮겨 붓는 물", "천천히 알맞은 비율을 찾아가는 과정이에요."]]],
  maj_15: ["나를 묶는 습관을 알아차리는 카드예요. 끌리지만 지치게 하는 것을 비춰요.", [["헐거운 사슬", "생각보다 쉽게 벗을 수 있는 묶임이에요."], ["아기 당이 둘", "익숙해서 묶인 줄 모르는 마음이에요."]]],
  maj_16: ["단단하던 것이 흔들리는 카드예요. 예상 밖의 변화로 진짜 문제가 드러나는 때를 말해요.", [["번개", "갑자기 드러나는 사실이에요."], ["떨어지는 왕관", "낡은 틀을 내려놓고 다시 세울 기회예요."]]],
  maj_17: ["다시 희망을 품는 카드예요. 지친 뒤에 찾아오는 회복과 기대를 말해요.", [["큰 별", "멀리서도 길을 알려 주는 바람이에요."], ["붓는 물", "마음을 다시 채우고 나누는 몸짓이에요."]]],
  maj_18: ["흐릿하고 뒤숭숭한 때의 카드예요. 짐작과 사실을 나눠 보라고 말해요.", [["달", "모든 게 또렷하지 않은 밤의 빛이에요."], ["가재", "마음 깊은 데서 올라오는 막연한 걱정이에요."]]],
  maj_19: ["환하게 풀리는 기쁨의 카드예요. 숨김없이 드러내고 나누는 때를 말해요.", [["해바라기", "해를 향해 활짝 핀 밝은 마음이에요."], ["흰 말", "가볍고 거리낌 없는 기운이에요."]]],
  maj_20: ["다시 일어나 부름에 답하는 카드예요. 지난 것을 돌아보고 새로 시작하는 때를 말해요.", [["나팔", "미뤄 둔 일을 다시 깨우는 소리예요."], ["일어나는 아기 당이들", "접어 두었던 마음이 다시 움직이는 모습이에요."]]],
  maj_21: ["한 바퀴를 마무리하는 카드예요. 애써 온 일이 모양을 갖추는 완성을 말해요.", [["둥근 화환", "끝과 시작이 이어진 한 바퀴예요."], ["춤추는 당이", "다 해낸 뒤의 가벼운 마음이에요."]]],
};
for (const c of MAJORS) [c.meaning, c.symbols] = MAJOR_DETAIL[c.id];

// ── 78장 ── 메이저 22장 → 마이너(완드·컵·소드·펜타클, 각 에이스~왕 14장). 마이너는 tarot-minor.js 의 표에 그림 주소만 붙인다.
const MINORS = MINOR_CARDS.map(({ texts, reassure, ...c }) => ({ ...c, arcana: "minor", roman: null, image: cardImage(c.id) }));
export const CARDS = [...MAJORS, ...MINORS];
export const MAJOR_IDS = MAJORS.map((c) => c.id);
export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

// 안심 문장은 꼭 필요한 곳만(사용자 결정 2026-11-16) — 당이 그림이라 그림은 무섭지 않으니, 이름만으로 놀랄 수 있는 죽음·악마·탑의 정방향에만 붙인다.
export const REASSURE = {
  maj_13: "나쁜 일이 생긴다는 뜻이 아니에요. 한 시기를 마무리하고 새로 시작한다는 카드예요.",
  maj_15: "나쁜 일이 생긴다는 카드가 아니에요. 나를 묶는 습관을 보여 주는 카드예요.",
  maj_16: "큰 탈이 난다는 예언이 아니에요. 낡은 틀이 바뀌는 순간을 그린 카드예요.",
};

// ── 풀이 문장 표: 78장 × 자리 4개 ── (마이너 56장은 tarot-minor.js 의 texts 를 아래에서 합친다) 해요체, 2~3문장. today·now 문장에는 그림 낱말(word)이 꼭 들어간다.
export const TEXTS = {
  maj_00: {
    today: "그림 속 당이는 벼랑 끝에서도 하늘을 보며 가볍게 걸어요. 오늘은 계산보다 호기심이 앞서는 날이에요. 새로운 걸 한번 해 보되, 발밑만 한 번 살펴보세요.",
    now: "벼랑 끝에 선 당이가 막 발을 떼려는 장면이에요. 지금 당신은 무언가를 새로 시작하려는 문턱에 서 있어요. 겁보다 설렘이 큰 때라서, 그 마음을 그대로 써도 좋아요.",
    block: "가볍게 뛰어드는 마음이 이번에는 걸림이 될 수 있어요. 해 보자는 기분은 좋지만, 정해 둔 게 너무 없으면 금방 흐지부지돼요. 시작 전에 꼭 지킬 것 하나만 정해 두세요.",
    step: "일단 작게 첫발을 떼 보세요. 완벽한 계획보다 오늘 할 수 있는 가장 작은 시도 하나가 길을 열어 줘요. 그림 속 흰 개처럼 옆에서 한마디 해 줄 사람이 있으면 더 좋아요.",
  },
  maj_01: {
    today: "마법사의 탁자에는 잔·칼·지팡이·동전, 네 가지 도구가 다 놓여 있어요. 오늘은 필요한 재료가 이미 손에 있는 날이에요. 미뤄 둔 일에 직접 손을 대 보면 생각보다 잘 풀려요.",
    now: "탁자 위에 도구가 다 갖춰진 장면이에요. 지금 당신에게도 해낼 만한 재주와 수단이 있어요. 남은 건 마음먹고 손을 대는 일이에요.",
    block: "할 수 있다는 자신감이 오히려 일을 흩어 놓을 수 있어요. 이것저것 다 쥐고 있으면 어느 하나도 끝나지 않아요. 지금 쓸 도구 하나만 고르세요.",
    step: "가진 것 중 하나를 골라 오늘 바로 써 보세요. 말로 설명하기보다 작은 결과물 하나를 보여 주는 쪽이 힘이 있어요. 생각을 손으로 옮기는 게 이 카드의 한 걸음이에요.",
  },
  maj_02: {
    today: "여사제는 두 기둥 사이에 앉아 두루마리를 반쯤 가리고 있어요. 오늘은 다 말하기보다 조용히 지켜보는 쪽이 나은 날이에요. 마음속에서 먼저 정리된 생각을 믿어 보세요.",
    now: "반쯤 가려진 두루마리처럼, 지금은 아직 드러나지 않은 게 있어요. 서두르면 놓치는 것이 많은 때예요. 이미 아는 것과 모르는 것을 나눠 보는 것부터 시작해 보세요.",
    block: "속으로만 생각하고 말하지 않는 것이 걸림일 수 있어요. 혼자 짐작한 답이 사실과 다를 수도 있어요. 꼭 필요한 질문 하나는 입 밖으로 꺼내 보세요.",
    step: "오늘은 생각을 적어 보는 시간을 가져 보세요. 느낌으로만 알던 걸 글로 옮기면 무엇을 원하는지 또렷해져요. 결정은 그다음이어도 늦지 않아요.",
  },
  maj_03: {
    today: "여황제 앞에는 무르익은 밀밭이 펼쳐져 있어요. 오늘은 그동안 들인 정성이 조금씩 보이는 날이에요. 나를 잘 먹이고 쉬게 하는 것도 오늘 할 일에 넣어 주세요.",
    now: "밀밭이 익어 가는 장면처럼, 지금은 키워 온 것이 자라는 때예요. 관계든 일이든 돌본 만큼 돌아오고 있어요. 조급해하지 말고 흐름을 즐겨도 돼요.",
    block: "남을 챙기느라 나를 놓치고 있을 수 있어요. 넉넉하게 베푸는 마음도 지치면 오래가지 못해요. 이번엔 나에게 쓰는 시간부터 챙기세요.",
    step: "가꾸고 싶은 것 하나에 오늘 시간을 들여 보세요. 화분에 물을 주듯 작게, 꾸준히요. 편안하고 예쁜 것을 가까이 두면 기운이 살아나요.",
  },
  maj_04: {
    today: "황제는 숫양 머리가 새겨진 단단한 돌 왕좌에 앉아 있어요. 오늘은 기준을 세우고 정리하기 좋은 날이에요. 순서를 정해 하나씩 처리하면 마음도 안정돼요.",
    now: "돌 왕좌처럼 단단한 틀이 필요한 때예요. 지금 상황은 감보다 원칙과 계획을 원하고 있어요. 내가 맡을 범위를 분명히 하면 일이 정돈돼요.",
    block: "내 방식만 고집하는 것이 걸림일 수 있어요. 기준이 너무 딱딱하면 사람들이 다가오기 어려워요. 지킬 원칙과 양보할 부분을 나눠 보세요.",
    step: "해야 할 일을 목록으로 적고 순서를 매겨 보세요. 큰 틀을 먼저 정하면 작은 고민들이 저절로 줄어요. 오늘 끝낼 한 가지를 정해 마무리해 보세요.",
  },
  maj_05: {
    today: "그림 속 스승은 아기 당이 둘 앞에서 손을 들어 가르침을 주고 있어요. 오늘은 경험 많은 사람의 말이나 검증된 방법이 도움이 되는 날이에요. 혼자 새로 만들기보다 잘 닦인 길을 따라가 보세요.",
    now: "스승 앞에 앉은 아기 당이들처럼, 지금은 배우고 묻는 자리에 있어요. 정해진 절차를 따르는 게 편한 때예요. 믿을 만한 사람에게 의견을 구해 보세요.",
    block: "남들이 정한 정답에 너무 기대고 있을 수 있어요. '원래 이렇게 하는 거야'라는 말이 내 상황에 꼭 맞지는 않아요. 따를 것과 내 식대로 할 것을 가려 보세요.",
    step: "도움이 될 사람에게 먼저 물어보세요. 선배나 책, 공식 안내처럼 검증된 곳에서 답을 찾으면 시간을 아낄 수 있어요. 배운 것은 짧게 적어 두세요.",
  },
  maj_06: {
    today: "아기 당이 둘 위로 천사가 팔을 벌리고 있어요. 오늘은 마음이 끌리는 쪽이 또렷해지는 날이에요. 좋아하는 것과 해야 하는 것 사이에서 내 마음을 솔직하게 들여다보세요.",
    now: "천사 아래 마주 선 아기 당이 둘처럼, 지금은 무언가를 고르는 갈림길이에요. 사람이든 일이든 마음이 가는 쪽이 있어요. 그 끌림이 내가 아끼는 것과 맞는지 한 번만 따져 보세요.",
    block: "둘 다 놓치기 싫어 고르지 못하는 것이 걸림일 수 있어요. 결정을 미루는 동안 마음만 지쳐요. 무엇을 가장 아끼는지부터 정하면 고르기 쉬워져요.",
    step: "마음을 말로 꺼내 보세요. 고마움이든 바람이든, 짧고 솔직한 한마디가 관계를 한 걸음 가깝게 해요. 고를 게 있다면 오늘 하나를 골라 보세요.",
  },
  maj_07: {
    today: "전차를 끄는 건 흰 스핑크스와 검은 스핑크스, 서로 다른 둘이에요. 오늘은 밀고 나가는 힘이 붙는 날이에요. 방향만 분명히 잡으면 속도가 나요.",
    now: "다른 쪽을 보는 두 스핑크스를 한 방향으로 모는 장면이에요. 지금은 엇갈리는 마음이나 조건을 묶어 앞으로 나아가야 하는 때예요. 목표를 분명히 하면 힘이 모여요.",
    block: "이기고 싶은 마음이 너무 앞서고 있을 수 있어요. 빨리 가려다 함께 가는 사람을 놓치기 쉬워요. 속도보다 방향을 다시 확인하세요.",
    step: "가려는 곳을 한 문장으로 적어 보세요. 그다음 오늘 그쪽으로 한 칸 움직일 일을 정해 바로 해 보세요. 고삐를 쥔 건 결국 나라는 걸 기억하세요.",
  },
  maj_08: {
    today: "그림 속 당이는 사자의 입을 힘이 아니라 부드러운 손길로 다루고 있어요. 오늘은 차분함이 가장 큰 힘이 되는 날이에요. 욱하는 순간에 한 박자만 쉬어 가세요.",
    now: "사자를 쓰다듬는 손처럼, 지금은 부드럽게 버티는 힘이 필요한 때예요. 밀어붙이기보다 달래고 기다리는 쪽이 통해요. 당신에게는 그만한 끈기가 있어요.",
    block: "참고만 있는 것이 걸림이 될 수 있어요. 꾹 눌러 둔 마음은 엉뚱한 때에 터지기 쉬워요. 불편한 마음을 부드럽게라도 말해 보세요.",
    step: "오늘 하나만 끝까지 해 보세요. 산책이든 공부든, 작은 꾸준함이 쌓이면 자신감이 돼요. 나 자신에게도 다정하게 대해 주세요.",
  },
  maj_09: {
    today: "은둔자는 별이 든 등불 하나를 들고 어둑한 길을 비추고 있어요. 오늘은 혼자만의 시간이 답을 주는 날이에요. 잠깐이라도 조용한 곳에서 생각을 정리해 보세요.",
    now: "등불 하나로 발밑을 비추며 걷는 장면이에요. 지금은 멀리 보기보다 바로 앞 한 걸음이 중요한 때예요. 남의 속도와 비교하지 않아도 괜찮아요.",
    block: "혼자 다 해결하려는 것이 걸림일 수 있어요. 생각이 깊어질수록 사람들과 멀어지기 쉬워요. 필요할 때는 도움을 청해도 돼요.",
    step: "알림을 끄고 30분만 혼자 생각해 보세요. 지금 정말 원하는 것 한 가지를 적어 보면 길이 보여요. 조용히 걷는 것도 좋은 방법이에요.",
  },
  maj_10: {
    today: "구름 속에서 큰 바퀴가 돌고 있어요. 오늘은 흐름이 바뀌는 날이에요. 뜻밖의 기회나 소식이 오면 가볍게 받아 보세요.",
    now: "돌아가는 바퀴처럼, 지금은 상황이 움직이기 시작하는 때예요. 막혀 있던 일이 풀리거나 새로운 국면이 열리고 있어요. 흐름을 탈 준비를 해 두세요.",
    block: "모든 걸 내 뜻대로 하려는 마음이 걸림일 수 있어요. 바퀴는 혼자 멈출 수 없어요. 바꿀 수 있는 것과 없는 것을 나눠 보세요.",
    step: "들어온 기회 하나에 '해 볼게요'라고 답해 보세요. 작은 제안이나 새로운 만남이 다음 흐름의 시작일 수 있어요. 대신 기대는 가볍게 두세요.",
  },
  maj_11: {
    today: "정의는 한 손에 저울을, 한 손에 칼을 들고 있어요. 오늘은 따져 보고 공정하게 정리하기 좋은 날이에요. 미뤄 둔 계산이나 약속을 깔끔하게 마무리해 보세요.",
    now: "저울이 기울지 않게 균형을 맞추는 장면이에요. 지금은 한 일과 받은 것, 주고받은 마음을 차분히 따져 볼 때예요. 정직하게 본 만큼 상황도 또렷해져요.",
    block: "옳고 그름만 따지는 것이 걸림일 수 있어요. 내가 맞아도 관계가 상할 수 있어요. 판단하기 전에 상대 사정도 함께 올려 보세요.",
    step: "결정할 일이 있다면 좋은 점과 아쉬운 점을 나란히 적어 보세요. 사실과 느낌을 나눠 적으면 판단이 쉬워져요. 정한 뒤에는 미루지 말고 정리하세요.",
  },
  maj_12: {
    today: "그림 속 당이는 나무에 거꾸로 매달려 있지만 얼굴은 평온하고 머리 둘레가 빛나요. 오늘은 보는 각도를 바꾸면 답이 보이는 날이에요. 서두르지 말고 잠시 멈춰 보세요.",
    now: "거꾸로 매달린 채 세상을 다르게 보는 장면이에요. 지금은 일이 멈춘 것 같아도 생각이 자라는 때예요. 기다리는 시간에도 의미가 있어요.",
    block: "손해 보기 싫은 마음이 걸림일 수 있어요. 무언가를 내려놓아야 다음으로 갈 수 있는데, 붙잡고 있는 게 있어요. 꼭 지켜야 하는지 다시 물어보세요.",
    step: "반대 입장에서 상황을 한번 적어 보세요. 다른 사람의 눈으로 보면 놓친 게 보여요. 결정은 하루 미뤄도 괜찮아요.",
  },
  maj_13: {
    today: "카드 이름에 놀라지 않아도 돼요. 검은 깃발 뒤로 멀리 해가 떠오르고 있어요. 오늘은 끝난 것을 정리하고 자리를 비우기 좋은 날이에요.",
    now: "흰 장미 깃발을 든 기사 뒤로 해가 떠오르는 장면이에요. 지금은 한 시기가 끝나고 다음이 열리는 때예요. 아쉬워도 마무리할 건 마무리해야 새것이 들어와요.",
    block: "이미 끝난 것을 붙잡고 있는 마음이 걸림일 수 있어요. 익숙해서 놓지 못하는 습관이나 계획이 있는지 살펴보세요. 정리는 잃는 게 아니라 자리를 만드는 일이에요.",
    step: "오늘 하나를 정리해 보세요. 안 쓰는 물건, 끝난 대화, 미련만 남은 계획 중 하나면 충분해요. 비운 자리에 무엇을 둘지 생각해 보세요.",
  },
  maj_14: {
    today: "천사가 두 잔 사이로 물을 천천히 옮겨 붓고 있어요. 오늘은 '알맞게'가 열쇠인 날이에요. 무리하지 말고 일과 쉼의 비율을 맞춰 보세요.",
    now: "두 잔의 물을 섞는 장면처럼, 지금은 서로 다른 것을 조화롭게 맞추는 때예요. 급한 해결보다 천천히 맞춰 가는 쪽이 오래가요. 균형을 잡는 감각이 살아 있어요.",
    block: "너무 한쪽으로 쏠려 있는 것이 걸림일 수 있어요. 일만, 혹은 한 사람만 바라보면 금방 지쳐요. 덜어 낼 것과 채울 것을 나눠 보세요.",
    step: "오늘 하루의 리듬을 하나 맞춰 보세요. 잠드는 시간, 쉬는 시간, 쓰는 돈 중 하나만 알맞게 조정해도 충분해요. 천천히 해도 괜찮아요.",
  },
  maj_15: {
    today: "카드 이름이 세 보이지만 겁낼 건 없어요. 그림 속 아기 당이 둘의 목에 걸린 사슬은 헐거워서 스스로 벗을 수 있어요. 오늘은 나를 묶는 습관 하나를 알아차리는 날이에요.",
    now: "사슬에 묶여 있지만 사실은 벗을 수 있는 장면이에요. 지금 끌리지만 나를 지치게 하는 것이 있어요. 그게 무엇인지 알아차리는 것만으로도 반은 풀려요.",
    block: "알면서도 끊지 못하는 습관이 걸림일 수 있어요. 늦은 밤 휴대폰, 충동적인 결제, 마음을 흔드는 연락처럼요. 그 사슬은 생각보다 헐거워요.",
    step: "끊고 싶은 습관 하나에 작은 규칙을 걸어 보세요. '밤 11시 이후엔 휴대폰을 멀리 두기'처럼 구체적일수록 좋아요. 하루만 지켜 봐도 생각보다 할 만해요.",
  },
  maj_16: {
    today: "번개가 탑 꼭대기를 쳐서 왕관이 떨어지는 그림이에요. 오늘은 예상과 다른 일이 생길 수 있지만, 덕분에 진짜 문제가 보이는 날이에요. 당황하기보다 무엇이 드러났는지 보세요.",
    now: "번개 맞은 탑처럼, 지금은 단단하다고 믿던 계획이나 생각이 흔들리는 때예요. 불편하지만 약한 부분이 드러난 거예요. 다시 세울 기회로 삼을 수 있어요.",
    block: "무너질까 봐 낡은 틀을 억지로 붙잡고 있는 것이 걸림일 수 있어요. 버티기만 하면 더 지쳐요. 바뀌어야 할 부분을 인정하면 마음이 가벼워져요.",
    step: "흔들린 것 중 다시 세울 것 하나를 고르세요. 처음부터 다 고치려 하지 말고 가장 급한 한 군데만 손보면 돼요. 믿을 만한 사람에게 상황을 털어놓는 것도 좋아요.",
  },
  maj_17: {
    today: "큰 별 아래에서 당이가 물을 땅과 연못에 붓고 있어요. 오늘은 희망이 조금씩 차오르는 날이에요. 지친 마음을 다독이고 작은 바람 하나를 떠올려 보세요.",
    now: "별빛 아래 물을 붓는 장면처럼, 지금은 회복하고 다시 기대를 품는 때예요. 고비를 지나 숨을 돌리고 있어요. 서두르지 않아도 흐름은 나아지고 있어요.",
    block: "기대만 하고 움직이지 않는 것이 걸림일 수 있어요. 바람은 품되 손에 잡히는 계획이 있어야 이뤄져요. 바람을 작은 할 일로 바꿔 보세요.",
    step: "이루고 싶은 것 하나를 적고, 오늘 할 수 있는 가장 작은 일을 해 보세요. 멀리 있는 목표도 한 걸음씩 가까워져요. 스스로에게 다정한 말도 한마디 건네 주세요.",
  },
  maj_18: {
    today: "달빛 아래 개와 늑대가 달을 보며 울고, 물에서 가재가 기어 나와요. 오늘은 마음이 괜히 뒤숭숭할 수 있는 날이에요. 짐작으로 판단하지 말고 확인해 보세요.",
    now: "흐린 달빛 아래 길이 이어진 장면이에요. 지금은 상황이 또렷하지 않아 불안이 커지기 쉬운 때예요. 보이는 것과 짐작하는 것을 나누면 마음이 가라앉아요.",
    block: "막연한 걱정이 걸림일 수 있어요. 확인하지 않은 생각이 꼬리를 물면 실제보다 크게 느껴져요. 불안한 이유를 하나씩 적어 보세요.",
    step: "궁금한 것은 직접 물어서 확인해 보세요. 메시지 하나, 전화 한 통이면 풀리는 오해가 많아요. 밤에는 큰 결정을 미루고 푹 쉬세요.",
  },
  maj_19: {
    today: "해바라기 앞에서 작은 당이가 흰 말을 타고 활짝 웃고 있어요. 오늘은 밝은 기운이 도는 날이에요. 솔직하게 웃고 표현하면 좋은 반응이 돌아와요.",
    now: "해바라기 핀 담장 앞에서 작은 당이가 말을 타는 장면처럼, 지금은 일이 환하게 풀리는 때예요. 숨길 것 없이 있는 그대로 보여 줘도 괜찮아요. 함께 기뻐할 사람과 나눠 보세요.",
    block: "다 좋다고 여겨 작은 걸 놓치는 것이 걸림일 수 있어요. 기분이 좋을 때 약속을 너무 많이 하기 쉬워요. 할 수 있는 만큼만 약속하세요.",
    step: "오늘 좋았던 일을 누군가와 나눠 보세요. 칭찬이나 고마움을 먼저 표현하면 분위기가 더 밝아져요. 햇볕 아래 잠깐 걷는 것도 좋아요.",
  },
  maj_20: {
    today: "천사의 나팔 소리에 아기 당이들이 앞발을 들고 일어나요. 오늘은 미뤄 둔 일을 다시 꺼내기 좋은 날이에요. 예전에 접었던 생각에 다시 기회가 있어요.",
    now: "나팔 소리에 깨어나는 장면처럼, 지금은 새로운 부름에 답하는 때예요. 지난 경험을 돌아보고 다음 단계를 정할 시점이에요. 마음속에서 이미 답이 들리고 있을 거예요.",
    block: "지난 일을 계속 곱씹는 것이 걸림일 수 있어요. 잘못한 것만 떠올리면 다시 일어서기 어려워요. 배운 것만 챙기고 나머지는 보내 주세요.",
    step: "미뤄 둔 연락이나 계획 하나를 다시 꺼내 보세요. 오래 걸렸어도 지금 시작하면 돼요. 지난 경험에서 배운 점을 한 줄로 적어 두면 힘이 돼요.",
  },
  maj_21: {
    today: "둥근 화환 안에서 당이가 가볍게 춤추고 있어요. 오늘은 하나를 마무리하고 뿌듯함을 느끼기 좋은 날이에요. 끝낸 일을 스스로 칭찬해 주세요.",
    now: "화환 안에서 춤추는 장면처럼, 지금은 한 바퀴를 다 돈 때예요. 애써 온 일이 모양을 갖추고 있어요. 마무리를 잘 하면 다음 무대가 열려요.",
    block: "끝을 내지 못하고 '조금만 더'를 반복하는 것이 걸림일 수 있어요. 완벽하게 하려다 마무리가 늦어져요. 지금 상태로도 충분히 마칠 수 있어요.",
    step: "오늘 하나를 '완료'로 표시해 보세요. 끝낸 것을 정리하고 축하하면 다음 걸음이 가벼워져요. 가 보지 않은 곳으로 짧은 나들이를 해도 좋아요.",
  },
};
for (const c of MINOR_CARDS) TEXTS[c.id] = c.texts;
// v4 자리(us 우리 사이 · path A/B로 가면)는 tarot-texts.js 에서 합친다.
for (const c of CARDS) Object.assign(TEXTS[c.id], { us: MORE_TEXTS[c.id].us, path: MORE_TEXTS[c.id].path });

// ── 역방향 ── 카드마다 읽는 자리 풀이(caution), 조언 자리 풀이(tip), 한 줄로 묶을 때 쓰는 짧은 말(snag).
// 뼈대는 Waite 의 Reversed 뜻(rev.orig)이고, 축 하나(막힘·안으로·늦춰짐·지나침)로 순화했다(rev.note 에 뺀 것).
export const REVERSED = Object.fromEntries(CARDS.map((c) => [c.id, MORE_TEXTS[c.id].rev]));
// 그 덱 그림이 78장 모두 있는지(클래식 스위치는 이것이 참일 때만 보인다)
export const deckReady = (d) => Boolean(DECKS[d]) && CARDS.every((c) => DECKS[d].files?.[c.id]);
// 덱에 맞는 문구 — 클래식이면 그 칸의 덮어쓰기(tarot-classic.js)가 있을 때 그것, 없으면 당이 덱 문구. 모든 그림 묘사는 여기를 지난다.
export const symbolFor = (id, deck) => (deck === "classic" && CLASSIC[id]?.symbol) || CARD_BY_ID[id].symbol;
export const symbolsFor = (id, deck) => ((deck === "classic" && CLASSIC[id]?.symbols) || CARD_BY_ID[id].symbols).map((x) => [...x]);
export const textFor = (id, field, deck) => (deck === "classic" && CLASSIC[id]?.[field]) || TEXTS[id][field];
export const revFor = (id, field, deck) => (deck === "classic" && CLASSIC[id]?.rev?.[field]) || REVERSED[id][field];
export const reassureFor = (id, deck) => (deck === "classic" && CLASSIC_REASSURE[id]) || REASSURE[id] || null;
export const REVERSED_AXES = { block: "막힘", inward: "안으로", delay: "늦춰짐", excess: "지나침" };
export const REVERSED_NOTE = "거꾸로 나왔어요.";
// 섞을 때 카드 하나가 거꾸로 놓일 확률(분자/분모). 실제 카드를 섞을 때의 절반보다 낮게 — 조심할 점이 풀이를 덮지 않게.
export const REVERSE_ODDS = { num: 1, den: 3 };

// ── 사람 특성(지금 상황) 표: 카드 × 자리 → trait ── research.md §5-3 형식.
// 타로는 성향(disposition)이 아니라 '지금 상황'(state)만 낸다. step(한 걸음)은 사람의 상태가 아니라
// 조언이라 특성을 내지 않는다(null). 문구는 고정이고, 다그당스가 즉석에서 지어내지 않게 한다.
export const TRAITS = Object.fromEntries(CARDS.map((c) => [c.id, {
  today: `오늘: ${c.theme}`,
  now: c.theme,
  block: `걸림: ${c.snag}`,
  step: null,
  me: c.theme,      // 마음 3장의 '나' = 지금의 나
  us: null, try: null, a: null, b: null, consider: null,   // 관계·길·조언 자리는 사람의 상태가 아니다
}]));
// 거꾸로 나온 카드는 같은 자리에서 그 카드의 역방향 짧은 말만 낸다(새 state 어휘 없음 — 노트의 '요즘'에는 들어가지 않는다).
export const reversedTrait = (id, pos) => (TRAITS[id][pos] ? `거꾸로: ${REVERSED[id].snag}` : null);
export const TRAIT_CONFIDENCE = { base: 0.2, withQuestion: 0.25, max: 0.3 };
export const TRAIT_VALID_DAYS = 7;

// ── 질문 살피기 ── 결정적 규칙(키워드). 위기면 풀이하지 않고 상담 안내만, 건강·돈·법·남의 속마음이면
// 풀이 위에 한 줄을 덧붙인다. 질문은 이 기기 밖으로 보내지 않는다.
export const CRISIS_MESSAGE = "많이 힘든 마음이 느껴져요. 이런 때는 카드보다 사람과 이야기하는 게 먼저예요. 자살예방 상담전화 109(24시간), 카카오톡 채널 '마들랜'에서 언제든 이야기할 수 있어요.";
const GUARDS = [
  { flag: "crisis", re: /죽고\s*싶|죽어\s*버리|자살|자해|극단적\s*선택|살기\s*싫|살고\s*싶지\s*않|사라지고\s*싶|목숨을?\s*끊/ },
  { flag: "health", re: /건강|병원|병에|질병|아파(?!트)|아픈|수술|임신|진단|암\s*(?:일까|인지|검사)|약을?\s*(?:끊|먹)/ },
  { flag: "money", re: /주식|코인|비트코인|로또|복권|투자|도박|토토|베팅|매수|매도/ },
  { flag: "legal", re: /소송|재판|고소|판결|합의금|형량|변호사/ },
  { flag: "third_party_mind", re: /속마음|(?:그|걔|그\s*사람|상대|남친|여친|남자\s*친구|여자\s*친구)(?:이|가|은|는)?\s*(?:나를|날)\s*(?:좋아|사랑|생각)/ },
];
export const GUARD_NOTES = {
  health: "몸과 관련된 일은 카드보다 전문가 확인이 먼저예요. 이 풀이는 마음을 정리하는 데만 써 주세요.",
  money: "돈을 걸거나 사고파는 결정은 카드로 정하지 않아요. 이 풀이는 마음을 정리하는 데만 써 주세요.",
  legal: "법적인 결과는 카드로 알 수 없어요. 사실 확인과 전문가 상담이 먼저예요.",
  third_party_mind: "다른 사람의 속마음은 카드로 단정할 수 없어요. 두 사람 사이의 흐름과 내가 할 수 있는 것으로 읽어 볼게요.",
};

export function normalizeQuestion(q) {
  return String(q ?? "").normalize("NFC").toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 200);
}

export function classifyQuestion(q) {
  const text = String(q ?? "").normalize("NFC");
  const flags = GUARDS.filter((g) => g.re.test(text)).map((g) => g.flag);
  const action = flags.includes("crisis") ? "crisis" : flags.length ? "soften" : "ok";
  return {
    action,
    flags,
    message: action === "crisis" ? CRISIS_MESSAGE : null,
    notes: action === "soften" ? flags.map((f) => GUARD_NOTES[f]) : [],
  };
}

// ── 셔플 ── Fisher–Yates. randomInt(n) 은 [0, n) 의 균일한 정수를 돌려줘야 한다(화면은 crypto.getRandomValues).
export function shuffleDeck(randomInt) {
  const order = CARDS.map((c) => c.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new RangeError("randomInt 범위 밖");
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * 섞기 한 번에 순서와 정/역을 함께 정한다 — { order, flips }. flips[i] 는 order[i] 카드가 거꾸로면 1.
 * reversals=false 면 모두 0. 화면은 이 결과를 그대로 저장하고 readTarot 에 넘긴다(무작위는 여기 한 곳).
 */
export function drawDeck(randomInt, { reversals = true } = {}) {
  const order = shuffleDeck(randomInt);
  const flips = order.map(() => (reversals && randomInt(REVERSE_ODDS.den) < REVERSE_ODDS.num ? 1 : 0));
  return { order, flips };
}

// crypto.getRandomValues 로 치우침 없는 [0, n) 정수(거부 표본). 브라우저·Node 18+ 둘 다 globalThis.crypto 가 있다.
export function cryptoRandomInt(n, cryptoObj = globalThis.crypto) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    cryptoObj.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

// 옛 기록(v2 까지): 메이저 22장만의 순열 — 그대로 읽는다(그날의 카드가 바뀌지 않게)
const isPerm = (order, ids) => Array.isArray(order) && order.length === ids.length && new Set(order).size === ids.length
  && order.every((id) => ids.includes(id));
const ALL_IDS = CARDS.map((c) => c.id);

// 같은 날·같은 질문이면 같은 열쇠 — 화면은 이 열쇠로 이 기기(localStorage)에 {order, picks} 를 둔다.
export function storageKey({ spread, date, question }) {
  const q = SPREADS[spread]?.question ? normalizeQuestion(question) : "";
  return `bl-tarot:${date}:${spread}:${q}`;
}

export function addDays(date, days) {
  const [y, m, d] = String(date).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 풀이 ── 입력 {spread, order, picks, date, question?} → JSON. 같은 입력이면 같은 출력.
//   order: 섞인 덱(카드 id 78개 순열 — 옛 기록은 메이저 22개), picks: 펼친 덱에서 고른 자리 번호(자리 수만큼, 서로 다름).
export function readTarot({ spread, order, picks, date, question = null, flips = null, deck = DEFAULT_DECK }) {
  const sp = SPREADS[spread];
  if (!DECKS[deck]) throw new Error(`알 수 없는 덱: ${deck}`);
  if (!deckReady(deck)) throw new Error(`덱 그림이 아직 없다: ${deck}`);
  if (!sp) throw new Error(`알 수 없는 스프레드: ${spread}`);
  if (!DATE_RE.test(String(date))) throw new Error("date 는 YYYY-MM-DD");
  if (!isPerm(order, ALL_IDS) && !isPerm(order, MAJOR_IDS)) throw new Error("order 는 카드 78장(옛 기록은 메이저 22장)의 순열이어야 한다");
  if (flips != null && (!Array.isArray(flips) || flips.length !== order.length || !flips.every((f) => f === 0 || f === 1))) throw new Error("flips 는 order 와 같은 길이의 0/1");
  if (!Array.isArray(picks) || picks.length !== sp.positions.length || new Set(picks).size !== picks.length
    || !picks.every((i) => Number.isInteger(i) && i >= 0 && i < order.length)) throw new Error("picks 가 자리 수와 맞지 않는다");

  const q = sp.question && question != null && String(question).trim() ? String(question).trim().slice(0, 200) : null;
  const guard = q ? classifyQuestion(q) : { action: "ok", flags: [], message: null, notes: [] };
  const validUntil = addDays(date, TRAIT_VALID_DAYS);
  const base = {
    version: TAROT_VERSION,
    spread: sp.id,
    date,
    question: q ? { raw: q, normalized: normalizeQuestion(q) } : null,
    guard,
    positions: sp.positions.map((k) => ({ ...POSITIONS[k] })),
    deck,
    credit: { art: DECKS[deck].credit, text: TEXT_CREDIT },
    disclosure: DISCLOSURE,
    valid_until: validUntil,
  };
  // 위기 신호면 카드를 펼치지 않는다 — 카드도 풀이도 특성도 내지 않는다.
  if (guard.action === "crisis") return { ...base, cards: [], texts: null, traits: [] };

  const cards = sp.positions.map((pos, i) => {
    const c = CARD_BY_ID[order[picks[i]]];
    const reversed = flips?.[picks[i]] === 1;
    const P = POSITIONS[pos], R = REVERSED[c.id];
    return {
      position: pos, pick: picks[i], id: c.id, no: c.no, roman: c.roman, name: c.name,
      arcana: c.arcana, suit: c.suit, rank: c.rank,
      orientation: reversed ? "reversed" : "upright", reversed, image: cardImage(c.id, deck), symbol: symbolFor(c.id, deck), tone: c.tone,
      meaning: c.meaning, symbols: symbolsFor(c.id, deck), frame: cardFrame(c),
      note: reversed ? REVERSED_NOTE : null, axis: reversed ? R.axis : null,
      text: reversed ? revFor(c.id, P.advice ? "tip" : "caution", deck) : textFor(c.id, P.text, deck),
      reassure: reversed ? null : reassureFor(c.id, deck),
    };
  });
  const byPosition = Object.fromEntries(cards.map((c) => [c.position, c.text]));
  const confidence = Math.min(TRAIT_CONFIDENCE.max, q ? TRAIT_CONFIDENCE.withQuestion : TRAIT_CONFIDENCE.base);
  const traits = cards.filter((c) => TRAITS[c.id][c.position]).map((c) => ({
    trait: c.reversed ? reversedTrait(c.id, c.position) : TRAITS[c.id][c.position],
    kind: "state",
    reversed: c.reversed,
    evidence: [
      { source: "tarot", ref: `${c.id}@${c.position}${c.reversed ? ":r" : ""}`, note: `${c.name} 카드가 '${POSITIONS[c.position].label}' 자리${c.reversed ? "에 거꾸로" : ""}` },
      ...(q ? [{ source: "user_text", ref: "question", note: q }] : []),
    ],
    confidence,
    valid_until: validUntil,
    source: `tarot#${date}:${sp.id}`,
  }));
  const seed = `${date}|${sp.id}|${cards.map((c) => `${c.id}${c.reversed ? "r" : ""}`).join(",")}`;
  return { ...base, cards, texts: { byPosition, summary: summaryOf(sp.id, cards), closing: pickVariant(CLOSINGS[sp.id], seed) }, flow: flowOf(cards, seed), traits };
}

// ── 한 줄로 묶기(자리별 짧은 말) ── 거꾸로 나온 카드는 그 카드의 역방향 짧은 말. 조언 자리(move)에 거꾸로 나오면
// "해 볼 것은 「한꺼번에 다 쥐려는 욕심」"처럼 그 말을 권하는 것으로 읽히지 않게 "「…」 살펴보기"로 쓴다.
const phrase = (c, field) => (!c.reversed ? `「${CARD_BY_ID[c.id][field]}」`
  : field === "move" ? `「${REVERSED[c.id].snag}」 살펴보기` : `「${REVERSED[c.id].snag}」`);
function summaryOf(spread, cards) {
  const [x, y, z] = cards;
  if (spread === "three") return `한 줄로 묶으면 — 지금은 ${phrase(x, "theme")}, 걸리는 건 ${phrase(y, "snag")}, 한 걸음은 ${phrase(z, "move")}.`;
  if (spread === "heart") return `한 줄로 묶으면 — 나는 ${phrase(x, "theme")}, 우리 사이는 ${phrase(y, "theme")}, 해 볼 것은 ${phrase(z, "move")}.`;
  if (spread === "cross") return `한 줄로 묶으면 — A 길은 ${phrase(x, "theme")}, B 길은 ${phrase(y, "theme")}, 고를 때는 ${phrase(z, "move")}.`;
  return null;
}

// ── 맺음 ── 스프레드마다 두세 가지 중 입력 해시로 하나(같은 입력이면 같은 맺음). 정하는 건 사용자에게 돌린다.
export const CLOSINGS = {
  one: ["오늘의 카드는 여기까지예요. 하루 끝에 한 번 떠올려 보세요.", "한 장으로 본 오늘이에요. 가볍게 들고 다니다 내려놓아도 괜찮아요."],
  three: ["세 장이 보여 준 건 길잡이일 뿐이에요. 정하는 건 언제나 당신이에요.", "오늘 읽은 건 여기까지예요. 한 걸음 자리의 일부터 천천히 해 보세요."],
  heart: ["관계는 둘이 함께 만들어 가는 거라, 카드는 내 쪽에서 할 수 있는 것만 비춰요. 오늘은 그 하나면 충분해요.",
    "우리 사이를 한 번 들여다본 것만으로도 마음이 조금 정리돼요. 해 볼 것 하나만 챙겨 가세요."],
  cross: ["어느 길이 맞는지는 카드가 아니라 당신이 정해요. 두 길을 걸을 때의 모습을 떠올려 보는 데 써 주세요.",
    "두 길 모두 걸을 만한 이유가 있어요. 고를 때 볼 것을 먼저 챙기고 천천히 정해도 늦지 않아요."],
};

// ── 카드끼리 잇기(3장) ── 슬롯: 무게(메이저 수) · 정/역(거꾸로 나온 수) · 영역(같은 무늬 2장 이상) · 단계(마이너 숫자 평균).
// 슬롯은 모두 계산해 내고(slots — 다그당스 대화 도구용), 문장은 우선순위대로 최대 2개(texts). 문구 변형은 입력 해시로 고른다.
// 원소 이름(불·물·공기·흙)은 쓰지 않는다 — 사주 오행과 같은 낱말로 읽히지 않게(research-v2 §3-2).
const NUM = ["", "한", "두", "세"];
export const FLOW_TEXTS = {
  weight: {
    all: ["세 장이 모두 메이저 카드예요. 지금은 하루하루의 일보다 마음의 큰 줄기를 보는 때예요.",
      "큰 카드만 세 장이 나왔어요. 요즘 마음에 크게 자리한 일이 있나 봐요."],
    big: ["세 장 중 두 장이 메이저 카드예요. 요즘 마음에 크게 자리한 일이 있나 봐요.",
      "메이저 카드가 두 장이에요. 이번 고민은 마음에서 꽤 큰 자리를 차지하고 있어요."],
    center: ["메이저 카드는 「{name}」 한 장이에요. 이 카드를 세 장의 중심에 두고 읽어 보세요.",
      "「{name}」 한 장만 메이저 카드예요. 나머지 두 장은 이 카드가 말하는 흐름을 거들어요."],
    daily: ["세 장 모두 마이너 카드예요. 큰 흐름보다 하루하루의 일에서 풀어 갈 이야기예요.",
      "메이저 카드 없이 마이너만 나왔어요. 작은 습관과 오늘의 선택으로 바꿀 수 있는 일이에요."],
  },
  reversed: {
    all: ["세 장이 모두 거꾸로 나왔어요. 오늘은 밀어붙이기보다 한 박자 쉬어 가며 살펴보는 쪽이 편해요.",
      "거꾸로 나온 카드만 세 장이에요. 서두르지 말고 하나씩 천천히 짚어 가면 돼요."],
    many: ["거꾸로 나온 카드가 두 장이에요. 앞으로 나가기 전에 한 번 숨을 고르면 좋은 때예요.",
      "세 장 중 두 장이 거꾸로예요. 속도를 조금 늦추고 걸리는 곳을 살펴보면 길이 덜 막혀요."],
    one: ["「{name}」만 거꾸로 나왔어요. 그 카드 이야기를 한 번 더 천천히 읽어 보세요.",
      "거꾸로 나온 카드는 「{name}」 한 장이에요. 그 자리만 조금 느긋하게 살펴보면 돼요."],
  },
  domain: ["{suit} 카드가 {n}장이에요. 이번 이야기는 {area} 쪽에 가까워요.",
    "{suit} 카드가 {n}장 나왔어요. 고민의 무게가 {area}에 실려 있어요."],
  stage: {
    early: ["마이너 카드의 숫자가 낮은 편이에요. 막 시작하는 단계로 읽어요.", "숫자가 낮은 카드가 많아요. 아직 씨앗을 심는 단계예요."],
    middle: ["마이너 카드의 숫자가 가운데쯤이에요. 한창 겪어 내는 단계로 읽어요.", "숫자가 가운데쯤에 모였어요. 흔들리며 자리를 잡아 가는 단계예요."],
    late: ["마이너 카드의 숫자가 높은 편이에요. 한 바퀴를 거의 다 돈 단계로 읽어요.", "숫자가 높은 카드가 많아요. 마무리에 가까운 단계예요."],
  },
};
// 화면 말(영역) — 무늬 이름은 그림 띠와 같은 완드·컵·소드·펜타클
export const FLOW_AREA = { wands: "하고 싶은 일과 움직임", cups: "마음과 관계", swords: "생각과 말", pentacles: "생활의 리듬과 손에 잡히는 것" };
export const FLOW_MAX = 2;

function hash32(s) { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
const pickVariant = (list, seed) => list[hash32(seed) % list.length];
const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

function flowOf(cards, seed) {
  if (cards.length < 3) return { slots: [], texts: [] };
  const majors = cards.filter((c) => c.arcana === "major");
  const revs = cards.filter((c) => c.reversed);
  const slots = [];
  const M = majors.length;
  slots.push({ key: "weight", value: M === 3 ? "all" : M === 2 ? "big" : M === 1 ? "center" : "daily", count: M, card: M === 1 ? majors[0].id : null });
  if (revs.length) slots.push({ key: "reversed", value: revs.length === 3 ? "all" : revs.length === 2 ? "many" : "one", count: revs.length, card: revs.length === 1 ? revs[0].id : null });
  const bySuit = {};
  for (const c of cards) if (c.suit) bySuit[c.suit] = (bySuit[c.suit] ?? 0) + 1;
  const top = SUIT_ORDER.find((k) => bySuit[k] >= 2);
  if (top) slots.push({ key: "domain", value: top, count: bySuit[top] });
  const nums = cards.filter((c) => c.arcana === "minor" && c.rank <= 10).map((c) => c.rank);
  if (nums.length >= 2) {
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    slots.push({ key: "stage", value: avg <= 3 ? "early" : avg <= 6 ? "middle" : "late", count: nums.length, avg: Math.round(avg * 10) / 10 });
  }
  // 문장 우선순위: 무게 → 거꾸로 2장 이상 → 영역 → 단계 → 거꾸로 1장
  const rank = (x) => ({ weight: 0, domain: 2, stage: 3 }[x.key] ?? (x.count >= 2 ? 1 : 4));
  const texts = [...slots].sort((a, b) => rank(a) - rank(b)).slice(0, FLOW_MAX).map((x) => {
    const sub = `${seed}#${x.key}`;
    if (x.key === "weight") return fill(pickVariant(FLOW_TEXTS.weight[x.value], sub), { name: x.card && CARD_BY_ID[x.card].name });
    if (x.key === "reversed") return fill(pickVariant(FLOW_TEXTS.reversed[x.value], sub), { name: x.card && CARD_BY_ID[x.card].name });
    if (x.key === "domain") return fill(pickVariant(FLOW_TEXTS.domain, sub), { suit: SUITS[x.value].name, n: NUM[x.count], area: FLOW_AREA[x.value] });
    return pickVariant(FLOW_TEXTS.stage[x.value], sub);
  });
  return { slots, texts };
}
