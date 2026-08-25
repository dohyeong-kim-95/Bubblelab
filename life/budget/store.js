// 카드 한 장의 소비. 화면과 테스트가 같이 쓰는 순수 함수만 둔다 —
// 저장은 localStorage(app.js)이고 서버로 나가는 것은 없다.
//
// 이 화면이 답하려는 질문은 하나다: "이 속도로 쓰면 한도를 넘나?" 그래서 합계보다
// **기준선(오늘까지 써도 되는 몫)** 이 먼저 나온다. 기준선은 한도를 주기 일수로
// 고르게 나눈 값이다 — 월초에 몰아 쓰는 사람에게는 박하지만, 그 박함이 이 화면의
// 쓸모다(남은 날에 하루 얼마씩 쓸 수 있는지가 매일 다시 계산된다).

export const DEFAULT_LIMIT = 1_000_000;
export const LIMIT_MAX = 100_000_000;
export const AMOUNT_MAX = 100_000_000;
export const MEMO_MAX = 40;
export const DEFAULT_START_DAY = 1;
// 29~31 은 없는 달이 있어 주기가 애매해진다 — 받지 않는다(카드 결제일은 대개 28 이하다).
export const START_DAY_MAX = 28;
// 기준선과 이만큼 안쪽이면 "맞게 쓰고 있다"로 본다. 매일 몇 백원 어긋났다고
// 경고가 뜨면 경고를 읽지 않게 된다.
const ON_PACE = 0.02;

const KST = "Asia/Seoul";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** 오늘. 자정 경계는 KST 한 곳에서만 다룬다. */
export function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

const parts = (date) => String(date).split("-").map(Number);
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dayNumber = (date) => { const [y, m, d] = parts(date); return Date.UTC(y, m - 1, d) / DAY_MS; };
const fromDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export const isDate = (value) => DATE.test(value ?? "") && !Number.isNaN(dayNumber(value));
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
export const shiftDate = (date, days) => fromDayNumber(dayNumber(date) + days);

export function normalizeStartDay(value) {
  const day = Math.floor(Number(value));
  if (!Number.isFinite(day) || day < 1) return DEFAULT_START_DAY;
  return Math.min(day, START_DAY_MAX);
}

export function normalizeLimit(value) {
  const won = Math.floor(Number(value));
  if (!Number.isFinite(won) || won < 0) throw new Error("한도를 숫자로 적어주세요");
  if (won > LIMIT_MAX) throw new Error("한도가 너무 큽니다");
  return won;
}

/* ── 주기 ───────────────────────────────────────────────────────────
 * 달이 아니라 주기다. 카드 청구는 1일에 시작하지 않는 경우가 많아
 * 시작일(startDay)을 받는다. 시작일이 1이면 그냥 달력의 한 달이다. */

/** date 가 속한 주기. end 는 포함하는 마지막 날이다. */
export function cycleOf(date, startDay = DEFAULT_START_DAY) {
  const day = normalizeStartDay(startDay);
  const [year, month, dayOfMonth] = parts(isDate(date) ? date : kstDate());
  let y = year;
  let m = month;
  if (dayOfMonth < day) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
  const start = iso(y, m, day);
  const next = m === 12 ? iso(y + 1, 1, day) : iso(y, m + 1, day);
  return { start, end: shiftDate(next, -1), days: daysBetween(start, next), startDay: day };
}

export const previousCycle = (cycle) => cycleOf(shiftDate(cycle.start, -1), cycle.startDay);
export const nextCycle = (cycle) => cycleOf(shiftDate(cycle.end, 1), cycle.startDay);
export const inCycle = (cycle, date) => isDate(date) && date >= cycle.start && date <= cycle.end;

/** "8월" 또는 시작일이 1이 아니면 "7/15–8/14". */
export function cycleLabel(cycle) {
  const [, month] = parts(cycle.start);
  if (cycle.startDay === 1) return `${month}월`;
  const [, endMonth, endDay] = parts(cycle.end);
  return `${month}/${cycle.startDay}–${endMonth}/${endDay}`;
}

/* ── 상태 ─────────────────────────────────────────────────────────── */

export function emptyState(limit = DEFAULT_LIMIT, startDay = DEFAULT_START_DAY) {
  return { v: 1, limit: normalizeLimit(limit), startDay: normalizeStartDay(startDay), entries: [] };
}

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** 저장된 소비 하나. 환불·취소는 음수로 적는다. */
export function makeEntry(fields = {}, now = new Date()) {
  return normalizeEntry({
    id: crypto.randomUUID(),
    amount: 0,
    memo: "",
    on: kstDate(now),
    at: now.toISOString(),
    ...fields,
  });
}

export function normalizeEntry(entry) {
  const amount = Math.round(Number(entry?.amount));
  return {
    id: typeof entry?.id === "string" && entry.id ? entry.id : crypto.randomUUID(),
    amount: Number.isFinite(amount) ? amount : 0,
    memo: clean(entry?.memo, MEMO_MAX),
    on: isDate(entry?.on) ? entry.on : kstDate(),
    at: typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
    // 카드 문자에서 온 것만 갖는 표식. 같은 문자를 두 번 담지 않으려고 둔다(sms.js).
    ...(typeof entry?.sig === "string" && entry.sig ? { sig: entry.sig.slice(0, 40) } : {}),
    // 담아는 두되 합계에서 빼는 것. 즉시결제로 빠져나간 카드값처럼 "쓴 돈이 아닌" 것을
    // 지우지 않고 남겨 둘 수 있어야 한다 — 지우면 다음 백업에서 또 담긴다.
    ...(entry?.skip ? { skip: true } : {}),
  };
}

export function validateEntry(entry) {
  const errors = [];
  const amount = Number(entry?.amount);
  if (!Number.isFinite(amount) || Math.round(amount) === 0) errors.push("금액을 적어주세요");
  else if (Math.abs(Math.round(amount)) > AMOUNT_MAX) errors.push("금액이 너무 큽니다");
  if (!isDate(entry?.on)) errors.push("날짜가 올바르지 않습니다");
  return errors;
}

export function parseState(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || value.v !== 1) return null;
  let limit;
  try { limit = normalizeLimit(value.limit); } catch { limit = DEFAULT_LIMIT; }
  const entries = (Array.isArray(value.entries) ? value.entries : [])
    .map(normalizeEntry)
    .filter((entry) => validateEntry(entry).length === 0);
  return { v: 1, limit, startDay: normalizeStartDay(value.startDay), entries };
}

export function addEntry(state, fields, now = new Date()) {
  const entry = makeEntry(fields, now);
  const errors = validateEntry(entry);
  if (errors.length) throw new Error(errors[0]);
  return { ...state, entries: [...state.entries, entry] };
}

export function editEntry(state, id, fields) {
  const found = state.entries.find((entry) => entry.id === id);
  if (!found) throw new Error("그런 항목이 없습니다");
  const next = normalizeEntry({ ...found, ...fields, id: found.id, at: found.at });
  const errors = validateEntry(next);
  if (errors.length) throw new Error(errors[0]);
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? next : entry)) };
}

export const removeEntry = (state, id) =>
  ({ ...state, entries: state.entries.filter((entry) => entry.id !== id) });

export const setLimit = (state, value) => ({ ...state, limit: normalizeLimit(value) });

/* 시작일을 바꿔도 적힌 것은 그대로다 — 날짜로 저장하니 주기가 다시 그어질 뿐이다. */
export const setStartDay = (state, value) => ({ ...state, startDay: normalizeStartDay(value) });

/* ── 세기 ─────────────────────────────────────────────────────────── */

/** 합계. 계산에서 뺀 것(skip)은 세지 않는다 — 목록에는 남아 있어도 돈은 아니다. */
export const totalOf = (entries) =>
  entries.reduce((sum, entry) => (entry.skip ? sum : sum + entry.amount), 0);

/** 계산에 넣었다 뺐다 한다. 목록에서 한 번 눌러 바꾼다. */
export function toggleSkip(state, id) {
  const found = state.entries.find((entry) => entry.id === id);
  if (!found) throw new Error("그런 항목이 없습니다");
  return {
    ...state,
    entries: state.entries.map((entry) =>
      (entry.id === id ? normalizeEntry({ ...entry, skip: !entry.skip }) : entry)),
  };
}

/** 주기 안의 항목. 최근 날짜가 위, 같은 날이면 나중에 적은 것이 위로. */
export function entriesIn(state, cycle) {
  return state.entries
    .filter((entry) => inCycle(cycle, entry.on))
    .sort((a, b) => String(b.on).localeCompare(String(a.on)) || String(b.at).localeCompare(String(a.at)));
}

/** 날짜별로 묶는다 — 하루에 얼마 썼는지가 목록에서 먼저 보여야 한다. */
export function groupByDay(entries) {
  const days = new Map();
  for (const entry of entries) {
    if (!days.has(entry.on)) days.set(entry.on, []);
    days.get(entry.on).push(entry);
  }
  return [...days.entries()].map(([on, items]) => ({ on, items, total: totalOf(items) }));
}

/**
 * 이 주기를 지금 얼마나 썼나. 지난 주기·다음 주기도 같은 함수로 본다
 * (지난 주기는 dayIndex 가 꽉 차 있고, 다음 주기는 0 이다).
 */
export function pace(state, cycle, today = kstDate()) {
  const limit = state.limit;
  const entries = entriesIn(state, cycle);
  const spent = totalOf(entries);
  const { days } = cycle;
  const raw = daysBetween(cycle.start, today) + 1;   // 오늘이 주기의 몇째 날인가(1부터)
  const started = raw > 0;
  const finished = raw > days;
  const dayIndex = Math.min(Math.max(raw, 0), days);
  const daysLeft = finished ? 0 : days - Math.max(raw, 1) + 1;   // 오늘을 포함해 남은 날
  const expected = Math.round((limit * dayIndex) / days);
  const diff = spent - expected;                     // +면 기준선보다 앞서 쓴 것
  const remaining = limit - spent;
  return {
    limit, spent, remaining, days, dayIndex, daysLeft, expected, diff, started, finished,
    today: totalOf(entries.filter((entry) => entry.on === today)),
    // 오늘부터 남은 날에 하루 얼마씩. 이미 넘겼으면 음수가 그대로 나온다.
    perDay: daysLeft > 0 ? Math.floor(remaining / daysLeft) : null,
    // 이 속도 그대로면 주기 끝에 얼마. 아직 시작 전이면 셀 것이 없다.
    projected: dayIndex > 0 ? Math.round((spent / dayIndex) * days) : null,
    ratio: limit > 0 ? spent / limit : 0,
    linePos: dayIndex / days,
    status: status(spent, limit, diff),
  };
}

function status(spent, limit, diff) {
  if (spent > limit) return "over";                      // 한도를 넘겼다
  if (Math.abs(diff) <= limit * ON_PACE) return "on";    // 기준선 언저리
  return diff > 0 ? "ahead" : "under";                   // 앞서 씀 / 아껴 씀
}

/* ── 보이기 ───────────────────────────────────────────────────────── */

export const won = (value) => `${Math.round(value).toLocaleString("ko-KR")}원`;

/** 큰 숫자는 만 단위로 줄여 읽는다 — 헤드라인은 자릿수보다 크기가 먼저다. */
export function shortWon(value) {
  const amount = Math.round(value);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs < 10_000) return `${sign}${abs.toLocaleString("ko-KR")}원`;
  const man = abs / 10_000;
  const text = man >= 100 ? Math.round(man).toLocaleString("ko-KR") : String(Math.round(man * 10) / 10);
  return `${sign}${text}만원`;
}
