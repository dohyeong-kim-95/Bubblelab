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

export const MAX_MEMBERS = 10;
export const NAME_MAX = 12;
export const TITLE_MAX = 30;
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";   // 0·1·i·l·o 는 헷갈려서 뺀다
export const CODE_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;

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
