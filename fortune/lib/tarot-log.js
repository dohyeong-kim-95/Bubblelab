// 운세 노트 타로 — 이 기기의 지난 카드 기록(30일)과 통계. 순수 모듈(DOM·저장소 접근 없음): 화면이 브라우저 저장소에서 읽어 넘기고
// 돌려받은 값을 다시 쓴다. 기록은 서버로 보내지 않는다(화면 파일에 fetch 가 없다는 것을 _infra/fortune-tarot.test.mjs 가 본다).
//
// 지키는 것:
//  * 한 줄 = { date, spread, ids:[카드 id], rev:[0|1], q? } — 질문 원문(q)은 사용자가 '질문도 기억하기'를 켰을 때만 둔다(기본 끔).
//  * 30일이 지난 줄은 버린다. 같은 날·같은 스프레드·같은 카드는 한 줄(다시 열어도 늘지 않는다).
//  * 통계는 이번 달(달력 기준) 자주 나온 카드(2번 이상)·무늬, 거꾸로 나온 비율. 문장은 해요체 고정 문구.
import { CARD_BY_ID, SPREADS, SUITS, SUIT_ORDER, addDays } from "./tarot.js";

export const LOG_KEY = "bl-tarot-log";
export const PREF_KEY = "bl-tarot-pref";       // { reversals: true(기본), keepQuestion: false(기본) }
export const LOG_DAYS = 30;
export const DEFAULT_PREF = { reversals: true, keepQuestion: false };   // 카드 그림 덱은 여기 없다 — 당이 켜기/끄기(lib/prefs.js)가 정한다

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 저장된 값 → 쓸 수 있는 줄만(손으로 고쳤거나 옛 값이면 건너뛴다) */
export function readLog(x) {
  if (!Array.isArray(x)) return [];
  return x.filter((e) => e && DATE_RE.test(e.date) && SPREADS[e.spread] && Array.isArray(e.ids) && e.ids.length >= 1 && e.ids.length <= 3
    && e.ids.every((id) => CARD_BY_ID[id]) && Array.isArray(e.rev) && e.rev.length === e.ids.length && e.rev.every((r) => r === 0 || r === 1))
    .map((e) => ({ date: e.date, spread: e.spread, ids: [...e.ids], rev: [...e.rev], ...(typeof e.q === "string" && e.q ? { q: e.q.slice(0, 200) } : {}) }));
}
export function readPref(x) {
  return { reversals: x?.reversals !== false, keepQuestion: x?.keepQuestion === true };
}

/** readTarot 결과 → 기록 한 줄. keepQuestion 이 아니면 질문은 남기지 않는다. */
export function logEntry(read, { keepQuestion = false } = {}) {
  return { date: read.date, spread: read.spread, ids: read.cards.map((c) => c.id), rev: read.cards.map((c) => (c.reversed ? 1 : 0)),
    ...(keepQuestion && read.question?.raw ? { q: read.question.raw } : {}) };
}

export function pruneLog(log, today) {
  const from = addDays(today, -(LOG_DAYS - 1));
  return readLog(log).filter((e) => e.date >= from && e.date <= today);
}

/** 한 줄 더하기 — 같은 날·스프레드·카드면 바꿔 끼운다(질문 기억을 나중에 켠 경우 등). 날짜순. */
export function addToLog(log, entry, today) {
  const same = (e) => e.date === entry.date && e.spread === entry.spread && e.ids.join() === entry.ids.join();
  return [...pruneLog(log, today).filter((e) => !same(e)), ...readLog([entry])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 질문 기억을 끄면 이미 남은 질문도 지운다 */
export const forgetQuestions = (log) => readLog(log).map(({ q, ...e }) => e);

/** 달력(오늘부터 거꾸로 30일)과 이번 달 통계 */
export function logStats(log, today) {
  const rows = pruneLog(log, today);
  const days = [];
  for (let i = LOG_DAYS - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    days.push({ date, entries: rows.filter((e) => e.date === date) });
  }
  const month = today.slice(0, 7);
  const inMonth = rows.filter((e) => e.date.startsWith(month));
  const count = {}, suits = {};
  let cards = 0, reversed = 0, majors = 0;
  for (const e of inMonth) e.ids.forEach((id, i) => {
    cards++; reversed += e.rev[i];
    count[id] = (count[id] ?? 0) + 1;
    const c = CARD_BY_ID[id];
    if (c.suit) suits[c.suit] = (suits[c.suit] ?? 0) + 1; else majors++;
  });
  const topCards = Object.entries(count).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3)
    .map(([id, n]) => ({ id, name: CARD_BY_ID[id].name, n }));
  const topSuits = SUIT_ORDER.filter((k) => suits[k]).map((k) => ({ suit: k, name: SUITS[k].name, n: suits[k] })).sort((a, b) => b.n - a.n);
  return { days, month, readings: inMonth.length, cards, reversed, majors, topCards, topSuits };
}

const TIMES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
const times = (n) => (n <= 10 ? `${TIMES[n]} 번` : `${n}번`);
/** 통계 → 화면 문장(해요체) */
export function statsLines(st) {
  if (!st.cards) return ["이번 달에는 아직 뽑은 카드가 없어요."];
  const out = [`이번 달에 카드를 ${st.readings}번 펼쳐 ${st.cards}장을 봤어요.`];
  for (const c of st.topCards) out.push(`「${c.name}」 카드가 ${times(c.n)} 나왔어요.`);
  if (st.topSuits.length && st.topSuits[0].n >= 2) out.push(`무늬는 ${st.topSuits[0].name} 카드가 가장 많았어요.`);
  if (st.reversed) out.push(`거꾸로 나온 카드는 ${st.reversed}장이에요.`);
  return out;
}
