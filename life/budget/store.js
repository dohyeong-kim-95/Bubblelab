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
  return {
    v: 1,
    limit: normalizeLimit(limit),
    startDay: normalizeStartDay(startDay),
    entries: [],
    // 화면을 열 때 기억한 폴더에서 최신 백업을 알아서 읽는다. 하루 한 번이면 충분하다.
    auto: true,
    lastSyncOn: "",
    // 가맹점 이름 → 카테고리. 한 번 정하면 다음부터 그 칸으로 담긴다.
    rules: {},
  };
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
    // 카테고리. 아직 정하지 않았으면 빈 값(미분류)이다 — 미분류로 남는 것을 정상으로 본다.
    ...(isCategory(entry?.cat) ? { cat: entry.cat } : {}),
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
  return {
    v: 1,
    limit,
    startDay: normalizeStartDay(value.startDay),
    entries,
    // 자동 읽기는 나중에 붙였다 — 옛 저장본에는 이 칸이 없다(기본은 켜 둔다).
    auto: value.auto !== false,
    lastSyncOn: isDate(value.lastSyncOn) ? value.lastSyncOn : "",
    // 한 번 정한 카테고리는 가맹점 이름에 붙어 남는다. 옛 저장본에는 이 칸이 없다.
    rules: normalizeRules(value.rules),
  };
}

function normalizeRules(rules) {
  const clean = {};
  for (const [key, cat] of Object.entries(rules && typeof rules === "object" ? rules : {})) {
    if (isCategory(cat) && key) clean[ruleKey(key)] = cat;
  }
  return clean;
}

/* ── 카테고리 ───────────────────────────────────────────────────────
 * 목록은 **고정**이다. 늘리고 줄이게 하면 관리할 것이 하나 늘고, 이름이 흔들리면
 * 지난 주기와 견줄 수 없다. 미분류로 남는 것은 정상이다 — 분류를 강요하지 않는다.
 *
 * 자동 분류를 똑똑하게 만들지 않는다. 문자에는 가맹점 이름밖에 없고 그게 무슨 소비인지는
 * 사람만 안다. 대신 **한 번 정한 것을 기억**한다(state.rules) — 쓸수록 손이 덜 간다. */
export const CATEGORIES = [
  { id: "food", label: "식비" },
  { id: "cafe", label: "카페/간식" },
  { id: "transport", label: "교통" },
  { id: "living", label: "생필품" },
  { id: "health", label: "의료" },
  { id: "fun", label: "문화/여가" },
  { id: "bills", label: "통신/구독" },
  { id: "etc", label: "기타" },
];
export const UNCATEGORIZED = "미분류";

const isCategory = (id) => CATEGORIES.some((one) => one.id === id);
export const categoryLabel = (id) => CATEGORIES.find((one) => one.id === id)?.label ?? UNCATEGORIZED;

/**
 * 규칙의 열쇠. 카드사마다 띄어쓰기·대소문자가 달라 붙여서 비교하고, 법인 머리
 * ("(주)"·"㈜"·"주식회사")는 떼어 낸다 — 같은 가게가 두 규칙으로 갈리면 안 된다.
 */
export const ruleKey = (memo) => String(memo ?? "")
  .replace(/\(주\)|\(유\)|㈜|주식회사/g, "")
  .toLowerCase()
  .replace(/[\s()·.,\-*]/g, "");

/**
 * 이 가맹점은 어느 칸인가. 순서가 곧 우선순위다.
 * 1. 내가 정한 규칙 — 언제나 이긴다.
 * 2. 씨앗 표(merchants.js) — 이름에 든 글자로 본다. 겹치면 **긴 쪽**이 이긴다
 *    ("쿠팡이츠" 가 "쿠팡" 을 이겨야 배달이 생필품으로 가지 않는다).
 * 3. 미분류.
 */
export function categoryFor(memo, rules = {}, seeds = []) {
  const key = ruleKey(memo);
  if (!key) return "";
  if (isCategory(rules[key])) return rules[key];
  let best = "";
  let length = 0;
  for (const seed of seeds) {
    const needle = ruleKey(seed.match);
    if (!needle || needle.length <= length || !key.includes(needle)) continue;
    if (!isCategory(seed.cat)) continue;
    best = seed.cat;
    length = needle.length;
  }
  return best;
}

/**
 * 카테고리를 정한다. **같은 이름의 다른 항목도 함께 바뀌고** 규칙으로 남는다 —
 * 같은 가맹점이 주기마다 다른 칸에 있으면 카테고리를 보는 뜻이 없다.
 * 빈 값으로 두면 규칙도 지운다(잘못 정한 것을 되돌릴 길이 있어야 한다).
 */
export function setCategory(state, id, cat) {
  const found = state.entries.find((entry) => entry.id === id);
  if (!found) throw new Error("그런 항목이 없습니다");
  const next = isCategory(cat) ? cat : "";
  const key = ruleKey(found.memo);
  const rules = { ...state.rules };
  if (key) {
    if (next) rules[key] = next; else delete rules[key];
  }
  return {
    ...state,
    rules,
    entries: state.entries.map((entry) => (entry.id === id || (key && ruleKey(entry.memo) === key)
      ? normalizeEntry({ ...entry, cat: next })
      : entry)),
  };
}

/** 카테고리별 합계. 합계에서 뺀 것(skip)은 여기서도 빠진다 — 두 수가 어긋나면 안 된다. */
export function byCategory(entries) {
  const sums = new Map();
  for (const entry of entries) {
    if (entry.skip) continue;
    const cat = isCategory(entry.cat) ? entry.cat : "";
    const row = sums.get(cat) ?? { cat, label: categoryLabel(cat), total: 0, count: 0 };
    row.total += entry.amount;
    row.count += 1;
    sums.set(cat, row);
  }
  return [...sums.values()].sort((a, b) => b.total - a.total);
}

export const setAuto = (state, auto) => ({ ...state, auto: Boolean(auto) });
export const markSynced = (state, on = kstDate()) =>
  ({ ...state, lastSyncOn: isDate(on) ? on : kstDate() });
/** 오늘 아직 안 읽었으면 읽을 때다. 하루 한 번을 넘겨 폴더를 들추지 않는다. */
export const needsSync = (state, today = kstDate()) => Boolean(state.auto) && state.lastSyncOn !== today;

/**
 * 여러 건을 한 번에 담고 **담긴 id 를 함께 돌려준다** — 방금 담은 것만 되돌리려면
 * 무엇이 새로 들어왔는지 알아야 한다.
 */
export function addEntries(state, drafts, now = new Date()) {
  const added = [];
  let next = state;
  for (const draft of drafts) {
    try {
      next = addEntry(next, draft, now);
      added.push(next.entries.at(-1).id);
    } catch { /* 한 건이 틀렸다고 나머지를 버리지 않는다 */ }
  }
  return { state: next, added };
}

export const removeEntries = (state, ids) => {
  const drop = new Set(ids);
  return { ...state, entries: state.entries.filter((entry) => !drop.has(entry.id)) };
};

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

/* ── 내보내기 ───────────────────────────────────────────────────────
 * 쓰임새가 "LLM 에 넣고 물어보기" 라 CSV 가 아니라 **글 한 덩어리**다. 위에는 사람이
 * 읽는 요약(주기·한도·페이스·카테고리별 합계), 아래에는 탭으로 나눈 표를 둔다 —
 * 요약이 있어야 모델이 "많다/적다" 를 자기 기준으로 지어내지 않는다.
 *
 * 합계에서 뺀 것(skip)도 표에는 남기고 열로 표시한다. 빼 버리면 파일만 보고는 왜 없는지
 * 알 수 없고, 모델이 합계와 표를 더해 보고 어긋난다고 여긴다. */
export function exportText(state, cycle, today = kstDate()) {
  const entries = [...entriesIn(state, cycle)]
    .sort((a, b) => (a.on === b.on ? a.at.localeCompare(b.at) : a.on.localeCompare(b.on)));
  const now = pace(state, cycle, today);
  const skipped = entries.filter((entry) => entry.skip);
  const share = (value) => (now.spent > 0 ? ` (${Math.round((value / now.spent) * 100)}%)` : "");
  const short = (date) => date.slice(5);

  const head = [
    "아래는 카드 한 장으로 쓴 한 주기의 소비 기록이다. 금액 단위는 원(KRW), 날짜는 한국 시간이다.",
    `주기 ${cycle.start} ~ ${cycle.end} (${cycle.days}일) · 한도 ${won(now.limit)}`,
    now.finished
      ? `끝난 주기 · 쓴 돈 ${won(now.spent)} · ${now.remaining < 0 ? `한도를 ${won(-now.remaining)} 넘김` : `${won(now.remaining)} 남김`}`
      : now.started
        ? `${now.days}일 중 ${now.dayIndex}일째(${today}) · 오늘까지 기준선 ${won(now.expected)}`
          + ` · 쓴 돈 ${won(now.spent)} · 남은 돈 ${won(now.remaining)}`
          + (now.perDay == null ? "" : ` · 남은 ${now.daysLeft}일 동안 하루 ${won(now.perDay)}`)
        : `아직 시작하지 않은 주기 · 하루 기준 ${won(Math.round(now.limit / now.days))}`,
    skipped.length
      ? `합계에서 뺀 것 ${skipped.length}건 ${won(skipped.reduce((sum, one) => sum + one.amount, 0))}`
        + " (카드 대금 납부처럼 쓴 돈이 아닌 것 — 아래 표의 제외=Y)"
      : "",
  ].filter(Boolean);

  const cats = byCategory(entries).map((row) => `- ${row.label} ${won(row.total)}${share(row.total)} ${row.count}건`);
  const rows = entries.map((entry) => [
    short(entry.on),
    entry.amount,
    entry.memo || "(메모 없음)",
    categoryLabel(entry.cat),
    entry.skip ? "Y" : "",
  ].join("\t"));

  return [
    head.join("\n"),
    "",
    `카테고리별 (합계 ${won(now.spent)})`,
    ...(cats.length ? cats : ["- 아직 적은 것이 없다"]),
    "",
    `기록 ${entries.length}건`,
    ["날짜", "금액", "가맹점", "카테고리", "제외"].join("\t"),
    ...rows,
    "",
  ].join("\n");
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
