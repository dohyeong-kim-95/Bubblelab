// 약속 — 화면과 서버(_infra/yaksok.js)가 함께 쓰는 순수 규칙.
// 날짜는 전부 KST 달력 날짜 문자열("YYYY-MM-DD")로 다룬다. 시각은 쓰지 않는다.

// 한 날짜에 대한 한 사람의 응답. 탭할 때마다 전일 → 점심 → 저녁 → 불가 → 전일 로 돈다.
// 0(미응답)은 한 번도 누르지 않은 날이다 — 불가(4)와 구분해야 "몇 명 응답"을 셀 수 있다.
export const NONE = 0, FULL = 1, LUNCH = 2, DINNER = 3, NO = 4;
export const STATE_LABEL = { [FULL]: "전일 가능", [LUNCH]: "점심만", [DINNER]: "저녁만", [NO]: "불가" };
export const SLOT_LABEL = { full: "전일", lunch: "점심", dinner: "저녁" };

export function nextState(state) {
  return state === NONE || state === NO ? FULL : state + 1;
}

// 정원은 방을 만들 때 고른다(방장이 나중에 바꿀 수 있고, 이미 들어온 인원 밑으로는 못 줄인다).
export const CAPACITY_MIN = 2, CAPACITY_MAX = 20, CAPACITY_DEFAULT = 10;
export function cleanCapacity(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= CAPACITY_MIN && n <= CAPACITY_MAX ? n : null;
}
export const NAME_MAX = 12;
// 방 코드는 사람이 정한다 — 같은 코드를 치면 PC·폰 어디서든 같은 방이 열린다.
// 치기 쉽게 영문 소문자·숫자 6자리는 다 받고, 🎲 는 헷갈리는 글자(0·1·i·l·o)를 빼고 뽑는다.
export const CODE_RE = /^[a-z0-9]{6}$/;
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function normalizeCode(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

export function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function parts(date) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function fmt(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
}

export function addDays(date, n) {
  const { y, m, d } = parts(date);
  return fmt(y, m, d + n);
}

// 후보 기간은 방을 만든 날부터 다음 달 말일까지로 고정한다.
export function candidatePeriod(today) {
  const { y, m } = parts(today);
  return { start: today, end: fmt(y, m + 2, 0) };
}

export function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return false;
  const { y, m, d } = parts(date);
  return fmt(y, m, d) === date;
}

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export function weekday(date) {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dateLabel(date) {
  const { m, d } = parts(date);
  return `${m}월 ${d}일(${WEEKDAYS[weekday(date)]})`;
}

// 이름·제목: 앞뒤 공백과 제어 문자를 지우고 길이를 자른다. 비면 null.
export function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return text || null;
}

// 날짜별 합계. 점심칸 = 전일 + 점심만, 저녁칸 = 전일 + 저녁만.
export function tally(votes, memberIds, dates) {
  const byDate = {};
  for (const date of dates) byDate[date] = { lunch: 0, dinner: 0, no: 0 };
  for (const id of memberIds) {
    for (const [date, state] of Object.entries(votes[id] ?? {})) {
      const t = byDate[date];
      if (!t) continue;
      if (state === FULL || state === LUNCH) t.lunch += 1;
      if (state === FULL || state === DINNER) t.dinner += 1;
      if (state === NO) t.no += 1;
    }
  }
  const responded = memberIds.filter((id) => Object.keys(votes[id] ?? {}).length > 0);
  return { byDate, responded };
}

// 가장 많이 모이는 날. 점심·저녁 중 많은 쪽을 그날의 점수로 보고, 같으면 이른 날이 먼저다.
export function bestDates(byDate, limit = 3) {
  return Object.entries(byDate)
    .map(([date, t]) => {
      const count = Math.max(t.lunch, t.dinner);
      const slot = t.lunch === t.dinner ? "full" : t.lunch > t.dinner ? "lunch" : "dinner";
      return { date, count, slot, lunch: t.lunch, dinner: t.dinner };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || (a.date < b.date ? -1 : 1))
    .slice(0, limit);
}

// 네이버 지도 링크만 받는다(단축 링크 포함). 나머지 주소는 거절한다.
const NAVER_HOSTS = new Set(["naver.me", "map.naver.com", "m.map.naver.com",
  "place.naver.com", "m.place.naver.com", "pcmap.place.naver.com"]);
export function naverMapUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:" || !NAVER_HOSTS.has(url.hostname)) return null;
    return url.href.slice(0, 300);
  } catch {
    return null;
  }
}

// 확정된 약속을 캘린더에 넣는 링크·파일. 점심 12–14시, 저녁 18–21시, 전일은 종일 일정.
const SLOT_TIME = { lunch: ["120000", "140000"], dinner: ["180000", "210000"] };
export function calendarEvent({ title, date, slot, place }) {
  const day = date.replaceAll("-", "");
  const next = addDays(date, 1).replaceAll("-", "");
  const times = SLOT_TIME[slot];
  const dates = times ? `${day}T${times[0]}/${day}T${times[1]}` : `${day}/${next}`;
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", title);
  google.searchParams.set("dates", dates);
  if (times) google.searchParams.set("ctz", "Asia/Seoul");
  if (place?.name) google.searchParams.set("location", place.name);
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//bubblelab//yaksok//KO", "BEGIN:VEVENT",
    `UID:${day}-${Math.random().toString(36).slice(2)}@bubblelab.dev`,
    times ? `DTSTART;TZID=Asia/Seoul:${day}T${times[0]}` : `DTSTART;VALUE=DATE:${day}`,
    times ? `DTEND;TZID=Asia/Seoul:${day}T${times[1]}` : `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${esc(title)}`,
    ...(place?.name ? [`LOCATION:${esc(place.name)}`] : []),
    ...(place?.url ? [`URL:${place.url}`] : []),
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  return { google: google.href, ics };
}

// 맨 위 진행 단계. 방 상태로 정한다 — 확정 전이면 날짜 잡기, 확정했는데 장소가 없으면 장소 전달,
// 장소까지 정했고 약속일이 지나지 않았으면 놀기, 약속일이 지나면 정산.
export const PHASES = ["날짜 잡기", "장소 전달", "놀기", "정산"];
// 방장이 "놀기 끝 → 정산" 을 누르면(settling) 약속일이 지나지 않았어도 정산이다 — 당일 저녁에 나누는 게 보통이다.
export function phaseOf(room, today) {
  if (!room.confirmed) return 0;
  if (room.settling || today > room.confirmed.date) return 3;
  return room.place ? 2 : 1;
}

// 한 날짜의 가능 인원(점심·저녁)과 모두 되는지. 분모는 정원 — 안 들어온 사람까지 세야 "8명 중 3명"이다.
export function dayCounts(votes, memberIds, date) {
  let lunch = 0, dinner = 0;
  for (const id of memberIds) {
    const s = votes[id]?.[date];
    if (s === FULL || s === LUNCH) lunch += 1;
    if (s === FULL || s === DINNER) dinner += 1;
  }
  return { lunch, dinner };
}

// ── 사진 ──
export const PHOTO_MAX = 50;
export const PHOTO_BYTES_MAX = 100 * 1024 * 1024;
export const PHOTO_ONE_MAX = 4 * 1024 * 1024;    // 한 장(화면이 긴 변 2048px JPEG 로 줄여 올린다)

// ── 송금 정보 ── 카카오페이 송금 링크(qr.kakaopay.com)만 링크로 받고, 계좌는 글로 받는다.
export function kakaopayUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" && url.hostname === "qr.kakaopay.com" ? url.href.slice(0, 200) : null;
  } catch {
    return null;
  }
}

// ── 정산 ── 돈은 원 단위 정수. 나누어떨어지지 않는 몇 원은 참여자 순서대로 1원씩 더 낸다.
export const AMOUNT_MAX = 10_000_000;
export function cleanAmount(value) {
  const n = typeof value === "string" ? Number(value.replace(/[,\s원]/g, "")) : value;
  return Number.isInteger(n) && n > 0 && n <= AMOUNT_MAX ? n : null;
}

export function settle(memberIds, expenses) {
  const balance = Object.fromEntries(memberIds.map((id) => [id, 0]));
  let total = 0;
  for (const e of expenses) {
    const who = (e.participants ?? memberIds).filter((id) => id in balance);
    if (!who.length || !(e.payer in balance)) continue;
    total += e.amount;
    balance[e.payer] += e.amount;
    const base = Math.floor(e.amount / who.length);
    let rest = e.amount - base * who.length;
    for (const id of who) {
      balance[id] -= base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
    }
  }
  // 받을 사람·보낼 사람을 큰 금액부터 짝지으면 송금 횟수가 (거의) 최소가 된다.
  const creditors = memberIds.filter((id) => balance[id] > 0).map((id) => ({ id, left: balance[id] }))
    .sort((a, b) => b.left - a.left);
  const debtors = memberIds.filter((id) => balance[id] < 0).map((id) => ({ id, left: -balance[id] }))
    .sort((a, b) => b.left - a.left);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].left, creditors[j].left);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].left -= amount;
    creditors[j].left -= amount;
    if (!debtors[i].left) i += 1;
    if (!creditors[j].left) j += 1;
  }
  return { total, balance, transfers };
}

export const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
