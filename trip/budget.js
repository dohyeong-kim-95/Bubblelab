// 여행 계획·예산 계산. 화면(index.html)과 `_infra/trip.test.mjs` 가 같이 쓴다 —
// 계산을 화면 안에 두면 테스트가 못 본다.
//
// 금액은 **항상 원(KRW) 정수**로 집계한다. 항목은 원/현지통화 둘 중 하나로
// 입력받고(`cur`), 현지통화는 여행에 하나뿐인 환율(`rate`, 현지 1단위당 원)로
// 환산한다 — 항목마다 환율을 두면 나중에 환율을 고쳤을 때 과거 항목이 따라오지
// 않아서, 계획 단계에서는 오히려 헷갈린다.

export const CATS = [
  { key: "flight", label: "항공", emoji: "✈️" },
  { key: "stay", label: "숙소", emoji: "🏨" },
  { key: "move", label: "교통", emoji: "🚃" },
  { key: "food", label: "식비", emoji: "🍜" },
  { key: "play", label: "관광", emoji: "🎟️" },
  { key: "shop", label: "쇼핑", emoji: "🛍️" },
  { key: "etc", label: "기타", emoji: "📌" },
];
export const CAT_KEYS = CATS.map((c) => c.key);
export const CAT_BY_KEY = new Map(CATS.map((c) => [c.key, c]));

// 계획 → 예약 → 결제. "결제"만 실제로 나간 돈이고 나머지는 아직 예상이다.
export const STATUSES = [
  { key: "plan", label: "계획", emoji: "○" },
  { key: "booked", label: "예약", emoji: "◐" },
  { key: "paid", label: "결제", emoji: "●" },
];
export const STATUS_KEYS = STATUSES.map((s) => s.key);

const DAY_MS = 86400000;
// 기간을 잘못 입력해(예: 연도 오타) 날짜 카드를 몇만 장 그리는 사고를 막는다.
export const MAX_DAYS = 90;

const pad2 = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → UTC epoch ms. 형식이 아니면 null. */
export function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  // 2026-02-31 처럼 넘어간 날짜를 걸러 낸다 (Date.UTC 는 조용히 이월한다).
  const back = new Date(ms);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

export function toISO(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const weekday = (iso) => {
  const ms = parseDate(iso);
  return ms === null ? "" : WEEKDAYS[new Date(ms).getUTCDay()];
};

/**
 * 여행 기간의 날짜 목록(양끝 포함). 끝이 시작보다 앞이면 하루짜리로 본다 —
 * 기간을 고치는 중에 화면이 통째로 비는 것보다 낫다.
 */
export function dayList(start, end) {
  const s = parseDate(start);
  if (s === null) return [];
  const e = parseDate(end);
  const last = e === null || e < s ? s : e;
  const days = [];
  for (let ms = s; ms <= last && days.length < MAX_DAYS; ms += DAY_MS) days.push(toISO(ms));
  return days;
}

/** 오늘(KST 기준 날짜) 대비 남은 날. 출발일이 오늘이면 0, 지났으면 음수. */
export function dday(start, todayISO) {
  const s = parseDate(start);
  const t = parseDate(todayISO);
  if (s === null || t === null) return null;
  return Math.round((s - t) / DAY_MS);
}

/**
 * 브라우저 로컬이 아니라 KST 기준의 오늘 날짜. 여행지에서 열어도 D-day 가
 * 흔들리지 않는다 (epoch 에 +9h 하고 UTC 필드를 읽으면 KST 벽시계다).
 */
export function todayKST(now = new Date()) {
  return toISO(now.getTime() + 9 * 3600000);
}

const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

/** 항목 하나의 원화 환산액(정수). 인원 배수(`per`)가 켜져 있으면 인원만큼 곱한다. */
export function itemKRW(item, trip) {
  const amount = num(item?.amount, 0);
  const rate = Math.max(0, num(trip?.rate, 1));
  const krw = item?.cur === "LOC" ? amount * rate : amount;
  const people = item?.per ? Math.max(1, Math.round(num(trip?.people, 1))) : 1;
  return Math.round(krw * people);
}

/**
 * 여행 하나의 집계. 화면의 숫자는 전부 여기서 나온다 —
 * 같은 합계를 두 군데서 따로 더하면 언젠가 어긋난다.
 */
export function summarize(trip, todayISO) {
  const days = dayList(trip?.start, trip?.end);
  const people = Math.max(1, Math.round(num(trip?.people, 1)));
  const items = Array.isArray(trip?.items) ? trip.items : [];

  const zero = () => ({ planned: 0, paid: 0, count: 0 });
  const cat = new Map(CAT_KEYS.map((k) => [k, zero()]));
  const day = new Map(days.map((d) => [d, zero()]));
  let planned = 0;
  let paid = 0;
  let booked = 0;
  let undated = zero();

  for (const item of items) {
    const krw = itemKRW(item, trip);
    planned += krw;
    if (item?.status === "paid") paid += krw;
    if (item?.status === "booked") booked += krw;

    const c = cat.get(CAT_BY_KEY.has(item?.cat) ? item.cat : "etc");
    c.planned += krw;
    c.count += 1;
    if (item?.status === "paid") c.paid += krw;

    // 기간 밖(또는 날짜 없는) 항목도 총액에는 들어간다. 항공권처럼 날짜를
    // 정하기 전에 금액만 잡아 두는 경우가 실제로 많다.
    const d = day.get(item?.date) ?? undated;
    d.planned += krw;
    d.count += 1;
    if (item?.status === "paid") d.paid += krw;
  }

  const budgets = trip?.budgets ?? {};
  let budgetTotal = 0;
  const byCat = CATS.map((c) => {
    const acc = cat.get(c.key);
    const budget = Math.max(0, Math.round(num(budgets[c.key], 0)));
    budgetTotal += budget;
    return {
      ...c,
      budget,
      planned: acc.planned,
      paid: acc.paid,
      count: acc.count,
      over: budget > 0 && acc.planned > budget,
      // 예산이 0이면 비율은 의미가 없다(막대를 그리지 않는다).
      ratio: budget > 0 ? acc.planned / budget : null,
    };
  });

  return {
    days,
    dayCount: days.length,
    people,
    planned,
    paid,
    booked,
    unpaid: planned - paid,
    budgetTotal,
    remain: budgetTotal - planned,
    perPerson: Math.round(planned / people),
    perDay: days.length ? Math.round(planned / days.length) : 0,
    byCat,
    byDay: days.map((d) => ({ date: d, ...day.get(d) })),
    undated,
    itemCount: items.length,
    dday: dday(trip?.start, todayISO),
  };
}

export const formatKRW = (n) => `${Math.round(num(n, 0)).toLocaleString("ko-KR")}원`;

/** 통계 칸처럼 자리가 좁은 곳에서 쓰는 짧은 표기. 1,234,567 → 123.5만 */
export function formatShort(n) {
  const v = Math.round(num(n, 0));
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(abs % 100000000 ? 1 : 0)}억`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(abs % 10000 ? 1 : 0)}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);
const clean = (v, max, fallback = "") => str(v, fallback).slice(0, max);

let seq = 0;
export function newId(prefix = "i") {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

export function newItem(patch = {}) {
  return {
    id: newId("i"),
    date: "",
    time: "",
    title: "",
    cat: "etc",
    amount: 0,
    cur: "KRW",
    per: false,
    status: "plan",
    memo: "",
    ...patch,
  };
}

export function newTrip(patch = {}) {
  const today = todayKST();
  return {
    id: newId("t"),
    title: "새 여행",
    dest: "",
    start: today,
    end: today,
    people: 1,
    currency: "KRW",
    rate: 1,
    budgets: Object.fromEntries(CAT_KEYS.map((k) => [k, 0])),
    items: [],
    ...patch,
  };
}

/**
 * 저장된 값·가져온 JSON을 화면이 믿고 쓸 수 있는 모양으로 고친다.
 * 남이 만든 파일을 여는 게 아니라 **내 옛 저장본**을 여는 쪽이라, 모르는 필드는
 * 버리고 이상한 값은 기본값으로 끌어내린다(거절하면 기록만 잃는다).
 */
export function normalizeTrip(raw) {
  const base = newTrip();
  const t = raw && typeof raw === "object" ? raw : {};
  const start = parseDate(t.start) !== null ? t.start : base.start;
  const end = parseDate(t.end) !== null ? t.end : start;
  const trip = {
    id: clean(t.id, 64) || base.id,
    title: clean(t.title, 60) || "새 여행",
    dest: clean(t.dest, 60),
    start,
    end,
    people: Math.min(99, Math.max(1, Math.round(num(t.people, 1)))),
    currency: clean(t.currency, 8).toUpperCase() || "KRW",
    rate: (() => {
      const r = num(t.rate, 1);
      return r > 0 && r < 1000000 ? r : 1;
    })(),
    budgets: Object.fromEntries(
      CAT_KEYS.map((k) => [k, Math.max(0, Math.round(num(t.budgets?.[k], 0)))]),
    ),
    items: (Array.isArray(t.items) ? t.items : []).slice(0, 2000).map((raw) => {
      const it = raw && typeof raw === "object" ? raw : {};
      return {
        id: clean(it.id, 64) || newId("i"),
        date: parseDate(it.date) !== null ? it.date : "",
        time: /^([01]\d|2[0-3]):[0-5]\d$/.test(str(it.time)) ? it.time : "",
        title: clean(it.title, 80),
        cat: CAT_BY_KEY.has(it.cat) ? it.cat : "etc",
        amount: Math.max(0, Math.round(num(it.amount, 0) * 100) / 100),
        cur: it.cur === "LOC" ? "LOC" : "KRW",
        per: it.per === true,
        status: STATUS_KEYS.includes(it.status) ? it.status : "plan",
        memo: clean(it.memo, 500),
      };
    }),
  };
  return trip;
}

/** 저장본 전체(여행 여러 개). 형식이 깨져 있으면 빈 상태로 시작한다. */
export function normalizeStore(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const trips = (Array.isArray(s.trips) ? s.trips : []).slice(0, 50).map(normalizeTrip);
  const activeId = trips.some((t) => t.id === s.activeId) ? s.activeId : trips[0]?.id ?? "";
  return { version: 1, trips, activeId };
}

/** 일정 정렬: 시간이 있는 항목이 먼저(시간순), 없는 항목은 뒤에 입력순으로. */
export function sortItems(items) {
  return [...items].sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });
}
