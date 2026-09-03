// DRAM 이 어떻게 동작하는지 내가 이해한 것을 카드로 쌓고, 다시 떠올려 확인한다.
// 화면과 _infra/semi.test.mjs 가 같이 쓰는 순수 함수만 둔다 — 저장은 localStorage(app.js)
// 이고 서버로 나가는 것은 없다.
//
// 카드 하나 = "질문 하나에 내 말로 답한 것"이다. 옮겨 적은 문서가 아니라 **떠올릴 수
// 있는 단위**여야 복습이 성립하므로, 설명은 짧게만 받는다.

export const TITLE_MAX = 80;
export const BODY_MAX = 800;
export const SOURCE_MAX = 300;
export const CARD_MAX = 500;

/* 주제는 공정이 아니라 **동작** 순서다 — 셀에 담긴 전하가 어떻게 밖으로 나오고
 * 어떻게 유지되는지의 흐름. hint 는 그 주제에서 답해야 할 질문이고, 카드가 없는
 * 주제 자리에 그대로 보인다(빈 화면이 무엇을 적으라는 뜻인지 알려 준다). */
export const TOPICS = [
  { id: "cell", label: "셀과 어레이", hint: "1T1C · 워드라인 · 비트라인 · 커패시터에 담기는 전하" },
  { id: "access", label: "주소와 커맨드", hint: "ACT · RD · WR · PRE 가 각각 무엇을 여닫는가" },
  { id: "sense", label: "센스앰프", hint: "차지 셰어링 · 읽으면 왜 깨지고 어떻게 되살아나는가" },
  { id: "timing", label: "타이밍", hint: "tRCD · tRP · tRAS · CL · 뱅크를 왜 나눠 쓰는가" },
  { id: "refresh", label: "리프레시", hint: "전하가 새는 속도 · tREFI · 리텐션" },
  { id: "io", label: "인터페이스", hint: "프리페치 · 버스트 · DDR · 랭크와 채널" },
  { id: "etc", label: "그 밖에", hint: "위 어디에도 붙지 않는 것" },
];
export const DEFAULT_TOPIC = "cell";

export const topicOf = (id) => TOPICS.find((topic) => topic.id === id) ?? TOPICS[TOPICS.length - 1];
const isTopic = (id) => TOPICS.some((topic) => topic.id === id);

/* 복습 간격(Leitner). 맞히면 한 칸 올라가 더 늦게 돌아오고, 못 하면 0 으로 떨어져
 * 그 자리에서 다시 나온다. 0 칸이 "오늘 또"인 이유는 방금 못 떠올린 것을 내일까지
 * 미룰 이유가 없어서다. */
export const BOX_DAYS = [0, 1, 3, 7, 21];
export const MAX_BOX = BOX_DAYS.length - 1;
const DAY_MS = 86_400_000;

const clean = (value, max) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const time = (value) => {
  const ms = Date.parse(value ?? "");
  return Number.isNaN(ms) ? null : ms;
};

/* 출처는 화면에서 누를 수 있는 링크가 되므로 http(s) 만 통과시킨다 —
 * javascript: 가 섞이면 링크 하나로 화면을 열어 주는 꼴이 된다. */
export function normalizeSource(value) {
  const text = clean(value, SOURCE_MAX);
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { return ""; }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href.slice(0, SOURCE_MAX) : "";
}

export function validateCard(fields) {
  const title = clean(fields?.title, TITLE_MAX);
  const body = clean(fields?.body, BODY_MAX);
  if (!title) throw new Error("제목을 적어주세요");
  if (!body) throw new Error("이해한 것을 한 줄이라도 적어주세요");
  return {
    topic: isTopic(fields?.topic) ? fields.topic : DEFAULT_TOPIC,
    title,
    body,
    source: normalizeSource(fields?.source),
  };
}

export function makeCard(fields, now = new Date()) {
  return {
    id: crypto.randomUUID(),
    ...validateCard(fields),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    box: 0,
    reviewedAt: null,
  };
}

export const emptyState = () => ({ v: 1, cards: [] });

function normalizeCard(value) {
  if (!value || typeof value.id !== "string") return null;
  let fields;
  try { fields = validateCard(value); } catch { return null; }
  const box = Number.isInteger(value.box) ? Math.min(MAX_BOX, Math.max(0, value.box)) : 0;
  return {
    id: value.id,
    ...fields,
    createdAt: time(value.createdAt) ? value.createdAt : new Date().toISOString(),
    updatedAt: time(value.updatedAt) ? value.updatedAt : new Date().toISOString(),
    box,
    reviewedAt: time(value.reviewedAt) ? value.reviewedAt : null,
  };
}

export function parseState(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || value.v !== 1) return null;
  const cards = (Array.isArray(value.cards) ? value.cards : []).map(normalizeCard).filter(Boolean);
  return { v: 1, cards: cards.slice(0, CARD_MAX) };
}

export function addCard(state, fields, now = new Date()) {
  if (state.cards.length >= CARD_MAX) throw new Error(`카드는 ${CARD_MAX}장까지입니다`);
  return { ...state, cards: [...state.cards, makeCard(fields, now)] };
}

export function editCard(state, id, fields, now = new Date()) {
  const found = state.cards.find((card) => card.id === id);
  if (!found) throw new Error("그런 카드가 없습니다");
  const next = { ...found, ...validateCard(fields), updatedAt: now.toISOString() };
  return { ...state, cards: state.cards.map((card) => (card.id === id ? next : card)) };
}

export const removeCard = (state, id) => ({ ...state, cards: state.cards.filter((card) => card.id !== id) });

/** 주제별로 묶는다. 카드가 없는 주제도 자리를 지킨다 — 빈 자리가 곧 다음에 볼 것이다. */
export function byTopic(cards) {
  return TOPICS.map((topic) => ({
    topic,
    cards: cards
      .filter((card) => card.topic === topic.id)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
  }));
}

/** 다음에 돌아올 시각(ms). 한 번도 안 본 카드는 0 이라 맨 앞이다. */
export function dueAt(card) {
  const last = time(card.reviewedAt);
  if (last === null) return 0;
  return last + BOX_DAYS[Math.min(MAX_BOX, card.box ?? 0)] * DAY_MS;
}

export const isDue = (card, now = new Date()) => dueAt(card) <= now.getTime();

/* 덜 익은 것부터, 같은 칸이면 오래 안 본 것부터. 순서가 무작위가 아니어야 어제
 * 못 떠올린 것이 오늘 또 나온다. */
export function reviewQueue(cards, now = new Date()) {
  return cards
    .filter((card) => isDue(card, now))
    .sort((a, b) => (a.box ?? 0) - (b.box ?? 0) || dueAt(a) - dueAt(b));
}

export function gradeCard(state, id, ok, now = new Date()) {
  const found = state.cards.find((card) => card.id === id);
  if (!found) throw new Error("그런 카드가 없습니다");
  const next = {
    ...found,
    box: ok ? Math.min(MAX_BOX, (found.box ?? 0) + 1) : 0,
    reviewedAt: now.toISOString(),
  };
  return { ...state, cards: state.cards.map((card) => (card.id === id ? next : card)) };
}

/** 다음에 복습할 시각. 지금 볼 것이 없을 때 "언제 돌아오는지"를 적기 위한 것. */
export function nextDueAt(cards) {
  const times = cards.map(dueAt);
  return times.length ? Math.min(...times) : null;
}

export function stats(cards, now = new Date()) {
  return {
    total: cards.length,
    due: cards.filter((card) => isDue(card, now)).length,
    // 마지막 칸까지 올라간 것만 "익었다"고 센다(21일 뒤에나 돌아온다).
    learned: cards.filter((card) => (card.box ?? 0) >= MAX_BOX).length,
  };
}
