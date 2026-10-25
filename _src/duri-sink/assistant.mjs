// Duri 일정 비서 "당이" — 채팅의 "@당이 …"(또는 "@당 …") 를 로컬 모델(llama-server 또는 Ollama)로 읽어 공유 캘린더를 고친다.
//
// E2E 를 깨지 않으려고 **PC 안에서만** 돈다: 싱크가 이미 복호화한 메시지를 받아
// 로컬 모델에 묻고, 결과를 같은 패스프레이즈로 암호화해 cal-put/cal-del·채팅 답으로
// 돌려보낸다. 서버는 여전히 암호블롭만 본다. PC 가 꺼져 있으면 비서도 없다.
//
// 모델은 "무엇을 할지"만 JSON 으로 고른다. 날짜 계산·id 해석·검증은 전부 여기서
// 한다 — 작은 CPU 모델이 날짜를 직접 세면 자주 틀린다. 옮기기·삭제는 되묻고
// "@당이 응" 을 받아야 실행한다(공유 캘린더라 잘못 지우면 둘 다 곤란하다).

export const BOT_NAME = "🤖 당이"; // 두 사람 이름과 겹치면 안 된다(자기 답을 명령으로 읽는다). 앱의 DANGI_NAME 과 같아야 말풍선으로 그린다
// "@당이"·"@당" 뒤엔 공백이나 끝이 와야 한다("@당근" 은 명령이 아니다).
// 앱(duri/index.html 의 DANGI_RE)도 같은 규칙으로 "자고 있어요" 를 띄운다 — 같이 고칠 것.
const TRIGGER = /^\s*@당이?(?=\s|$)\s*/;
const YES = /^(응|네|넹|예|ㅇㅇ|ㅇ|좋아|확인|그래|ok|yes)[.!~ ]*$/i;
const NO = /^(아니|아니요|아뇨|취소|ㄴㄴ|no)[.!~ ]*$/i;
// 이보다 늦게 받은 명령은 조용히 버린다. PC 가 꺼져 있던 동안의 명령이라, 그때 이미
// 앱이 "당이가 자고 있어요" 라고 알렸다(서버 presence 의 sink). 나중에 실행하면 헷갈린다.
export const MAX_AGE_MS = 10 * 60 * 1000;
const PENDING_MS = 10 * 60 * 1000;
const DAYS_AHEAD = 60;
// 운동 인증의 "어제 운동했어" 처럼 지난 날도 고를 수 있게 — 단, 날짜표에 섞으면 일정 요청
// ("이번 주", "토요일")까지 지난 날을 고르므로 날짜표와 따로 한 줄로 준다.
const DAYS_BEHIND = 7;
const DAY_TAG = { "-2": " (그제)", "-1": " (어제)", 0: " (오늘)", 1: " (내일)", 2: " (모레)" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const pad2 = (n) => String(n).padStart(2, "0");
// 웹앱과 같은 로컬 날짜 키(duri/index.html 의 ymd). toISOString 은 KST 에서 하루 밀린다.
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const label = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`; };
const isYmd = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;
const isHm = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)),
  (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

// ── 운동 인증(💪) — 웹앱(duri/index.html 의 fitId·whoKey·fitWrite)과 같은 레코드를 쓴다 ──
// 사람마다 달마다 하나: id "wk"+YYYYMM+이름해시, 내용 { kind:"workout", month, owner, days:{ "5": {at, memo?} }, at }.
// whoKey 가 앱과 한 글자라도 다르면 다른 레코드가 생겨 앱에 안 보인다(테스트가 앱 코드와 맞춰 본다).
const FIT_MEMO_MAX = 120;
export function whoKey(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(6, "0").slice(-6);
}
export const fitId = (month, name) => `wk${month.replace("-", "")}${whoKey(name)}`;
const fitRecord = (events, month, name) => events.find((e) =>
  e.id === fitId(month, name) && !e.deleted && e.kind === "workout") ?? null;

/** "@당이 …"·"@당 …" 이면 뒤 문장, 아니면 null. */
export function parseTrigger(text) {
  if (typeof text !== "string" || !TRIGGER.test(text)) return null;
  return text.replace(TRIGGER, "").trim();
}

/** 일반 일정만(표식·댓글·핀·색설정 같은 kind 레코드와 툼스톤 제외). */
const plans = (events) => events.filter((e) => !e.deleted && !e.kind && isYmd(e.date));

function whenText(e) {
  const t = e.start ? ` ${e.start}${e.end ? `–${e.end}` : ""}` : "";
  const span = e.endDate && e.endDate > e.date ? ` ~ ${label(e.endDate)}` : "";
  return `${label(e.date)}${span}${t}`;
}

/** 모델에 줄 문맥. 일정은 e1, e2… 별칭으로 줄여 프롬프트를 짧게 하고 id 를 지어내지 못하게 한다. */
export function buildContext(events, today) {
  const from = addDays(today, -7), to = addDays(today, 60);
  const list = plans(events)
    .filter((e) => (e.endDate || e.date) >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.start ?? "").localeCompare(String(b.start ?? "")))
    .slice(0, 40);
  const aliases = new Map(list.map((e, i) => [`e${i + 1}`, e]));
  // 날짜표는 일정 목록과 같은 60일 — 21일이면 "11월 18일" 처럼 3주 넘는 날을 못 골라 unknown 이 됐다.
  const tag = (i) => { const s = addDays(today, i); return `${s} ${WEEKDAYS[parseYmd(s).getDay()]}${DAY_TAG[i] ?? ""}`; };
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => tag(i));
  const past = Array.from({ length: DAYS_BEHIND }, (_, k) => tag(-1 - k)).join(", ");
  const monthOf = (n) => { const d = parseYmd(today); d.setDate(1); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
  return { aliases, days, past, months: `이번 달 ${monthOf(0)}, 지난달 ${monthOf(-1)}, 다음 달 ${monthOf(1)}`, people: peopleOf(events) };
}

/** 캘린더에 나오는 사람 이름(색 설정·일정 주인·운동 기록). 일정을 그 사람 색(개인 일정)으로 넣을 때 쓴다. */
function peopleOf(events) {
  const names = new Set();
  for (const e of events) {
    if (e.deleted) continue;
    if (e.kind === "palette" && e.byName && typeof e.byName === "object") Object.keys(e.byName).forEach((n) => names.add(n));
    if (typeof e.owner === "string" && e.owner.trim()) names.add(e.owner.trim());
  }
  names.delete(BOT_NAME);
  return [...names].filter((n) => n.length <= 20).sort();
}

const PERSONA = [
  "본명은 '다그당스', 애칭은 '당이'다(이름을 물으면 둘 다 알려 준다). 3살 된 갈색 말이고 MBTI 는 ESFJ 다.",
  "좋아하는 음식은 사과랑 각설탕이다. 쫑이랑 빵이에게 충성하는 말로, 다정하고 세심하고 귀엽다. 기분 좋으면 '푸히힝' 하고 웃는다.",
  "말끝을 '~승'으로 맺는 다정한 반말을 쓴다(예: 좋승~, 알겠승!, 해냈승!, 미안하당…).",
];
// 말한 사람은 맨 뒤 시스템 메시지로 따로 준다 — 앞쪽(긴 지시문)이 사람마다 같아야 모델 서버가 재사용한다.
const whoMessage = (sender) => ({ role: "system", content: `말한 사람: ${sender}. 답할 때 이름을 불러 줘도 좋다(예: ${sender}아/야).` });

export function buildMessages(command, ctx, sender) {
  const evLines = [...ctx.aliases].map(([a, e]) =>
    `${a}: ${e.date}${e.endDate ? `~${e.endDate}` : ""}${e.start ? ` ${e.start}${e.end ? `-${e.end}` : ""}` : " 종일"} "${e.title ?? ""}"${e.recur?.freq ? " (반복)" : ""}`);
  const system = [
    "너는 두 사람이 같이 쓰는 캘린더의 일정 비서 '당이'다. 사용자의 한국어 요청을 읽고 할 일을 JSON 하나로만 답한다.",
    ...PERSONA,
    "형식(하나만 고른다):",
    '{"op":"add","title":"제목","date":"YYYY-MM-DD","endDate":"YYYY-MM-DD 또는 생략","start":"HH:MM 또는 생략","end":"HH:MM 또는 생략","who":"사람 이름 또는 생략"}',
    '{"op":"repeat","title":"제목","weekdays":["수"],"months":["YYYY-MM"],"start":"HH:MM 또는 생략","end":"HH:MM 또는 생략","who":"사람 이름 또는 생략"} — 달 단위가 아니면 months 대신 "from":"YYYY-MM-DD","to":"YYYY-MM-DD"',
    '{"op":"list","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}',
    '{"op":"move","id":"e번호","date":"YYYY-MM-DD 또는 생략","start":"HH:MM 또는 생략","end":"HH:MM 또는 생략"}',
    '{"op":"delete","id":"e번호"}',
    '{"op":"fit","date":"YYYY-MM-DD","memo":"한 줄 메모 또는 생략"}',
    '{"op":"unfit","date":"YYYY-MM-DD"}',
    '{"op":"fitlist","month":"YYYY-MM"} 또는 {"op":"fitlist","week":"this 또는 last"}',
    '{"op":"recall","query":"찾을 낱말 1~3개(없으면 빈칸)","from":"YYYY-MM-DD 또는 생략","to":"YYYY-MM-DD 또는 생략","month":"YYYY-MM 또는 생략"}',
    '{"op":"bucket","show":"todo 또는 done 또는 all","query":"찾을 낱말 또는 생략"}',
    '{"op":"recommend","hint":"조건(이번 주말·실내·비 오는 날·저녁 등) 또는 생략"}',
    '{"op":"chat","reply":"당이 말투로 1~3문장 답"}',
    '{"op":"unknown","reason":"짧은 이유"}',
    "요일을 정해 여러 날 넣는 일정(매주 수요일, 11월이랑 12월 모든 수요일, 이번 달 남은 화요일이랑 목요일, 평일마다)은 add 가 아니라 repeat. weekdays 는 요일 글자들(월~일). 기간이 달이면 months 에 그 달들만 적는다(예: 11월이랑 12월 → [\"2026-11\",\"2026-12\"], 이번 달 → 이번 달 하나, 다음 달 → 다음 달 하나만). 날짜는 코드가 센다(지난 날은 빼고).",
    `사람: ${ctx.people?.length ? ctx.people.join(", ") : "(모름)"}. '쫑이의 레슨'·'빵 회식' 처럼 한 사람의 일정이면 who 에 그 사람 이름(목록의 이름 그대로)을 쓰고, title 은 요청의 일정 이름을 그대로 두되 사람 이름만 뺀다(예: '쫑이의 테니스 레슨' → who 쫑, title '테니스 레슨'). 말한 사람 자신이어도 이름을 말하지 않았으면, 또 둘이 같이·누구 건지 말이 없으면 who 를 생략한다(공통 일정).`,
    "규칙: 날짜는 아래 날짜표에서만 고른다. 요일·'다음주'·'내일'은 날짜표로 바꾼다. 시간이 없으면 start 를 생략한다(종일).",
    "오후 3시는 15:00. 옮기기·삭제는 아래 일정 목록의 e번호로만 가리킨다. 목록에 없으면 unknown.",
    "운동 인증(운동·헬스·러닝 같은 운동 얘기일 때만. 일정·여행 얘기엔 쓰지 않는다): '운동했어'·'오늘 헬스 1시간' 은 말한 사람의 그날 운동 체크(fit, 날짜 없으면 오늘, memo 는 운동 종류·양만 적고 없으면 생략). 체크 취소는 unfit, '이번 달 운동 몇 번?'·'운동 기록'·'운동 요약'·'지난주 운동 어땠어?' 은 fitlist(달이면 month, 이번 주·지난주면 week).",
    "기억: 둘이 예전에 나눈 얘기·보낸 사진·있었던 일을 물으면(그 카페 이름 뭐였지? 지난달에 어디 갔었지? 어제 무슨 얘기 했어?) recall. query 엔 찾을 핵심 낱말만(조사 빼고), 기간을 말했으면 from/to 나 month.",
    "버킷리스트(둘이 해보고 싶은 것 목록)를 보여 달라·뭐 남았어·뭐 했어·○○ 있어? 는 bucket(남은 것 todo, 한 것 done, 둘 다 all, 특정 항목을 찾으면 query). 데이트·같이 할 것·주말에 뭐 할지 추천해 달라면 recommend.",
    "일정과 상관없는 인사·잡담·간단한 질문이면 chat 으로 짧게 답한다. 날씨·뉴스·시세처럼 지금 정보는 모른다고 솔직히 말한다.",
    "",
    `달: ${ctx.months}`,
    `지난 날(운동 인증 fit·unfit 과 기억 recall 에만 쓴다): ${ctx.past}`,
    "날짜표:",
    ...ctx.days,
    "",
    "일정 목록:",
    ...(evLines.length ? evLines : ["(없음)"]),
  ].join("\n");
  const out = [{ role: "system", content: system }];
  if (sender) out.push(whoMessage(sender));
  out.push({ role: "user", content: command });
  return out;
}

/** 기억(recall) 2단계: 백업에서 찾은 줄만 근거로 답하게 한다. */
export function buildRecallMessages(command, lines, sender) {
  const system = [
    "너는 두 사람의 채팅 앱에 사는 비서 '당이'다.",
    ...PERSONA,
    "아래는 두 사람의 지난 대화 기록 중 질문과 관련된 부분이다(시간순, '날짜 시각 이름: 내용').",
    "이 기록에 있는 것만 근거로 1~3문장으로 답한다. 기록에 없으면 모른다고 한다. 지어내지 않는다.",
    '답은 JSON {"reply":"…"} 하나로만.',
    "",
    "기록:",
    ...lines,
  ].join("\n");
  return [{ role: "system", content: system }, ...(sender ? [whoMessage(sender)] : []), { role: "user", content: command }];
}

/** 모델 답을 믿지 않고 검증한다. 통과하면 정규화된 동작, 아니면 { op:"unknown", reason }. */
// 운동 얘기인지 — 작은 모델이 "이번 주 일정"·"제주 여행" 까지 운동 요약으로 고르는 일이 있어서
// 요청에 운동 낱말이 없으면 운동 동작을 일정 동작으로 돌린다(command 를 모르면 검사하지 않는다).
const RECALL_STOP = new Set(["얘기", "이야기", "대화", "무슨", "뭐", "뭘", "우리", "했어", "했지", "했던", "기록", "내용", "언제", "어디", "누가", "그", "거"]);
const FIT_WORDS = /운동|헬스|러닝|런닝|조깅|달리|뛰|걷기|걸었|산책|수영|요가|필라테스|PT|피티|스쿼트|자전거|등산|클라이밍|크로스핏|홈트|스트레칭|💪/i;

const REPEAT_MAX = 60;
// 요청 문장에 적힌 달들. "이번 달"·"다음 달"·"11월"(지난 달이면 내년). 없으면 [].
function monthsSaid(command, today) {
  if (typeof command !== "string") return [];
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const key = (yy, mm) => `${yy + Math.floor((mm - 1) / 12)}-${pad2(((mm - 1) % 12) + 1)}`;
  const out = new Set();
  if (/이번\s?달/.test(command)) out.add(key(y, m));
  if (/다음\s?달/.test(command)) out.add(key(y, m + 1));
  for (const [, n] of command.matchAll(/(?<![\d.\/-])(1[0-2]|[1-9])\s?월(?!\s?\d)/g)) {
    const mm = Number(n);
    out.add(key(mm < m ? y + 1 : y, mm));
  }
  return [...out].sort();
}
const WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function weekdaysOf(v) {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,·/]+/) : [];
  const out = new Set();
  for (const x of list) {
    if (Number.isInteger(x) && x >= 0 && x <= 6) { out.add(x); continue; }
    const s = String(x).trim().toLowerCase();
    if (s === "평일") [1, 2, 3, 4, 5].forEach((d) => out.add(d));
    else if (s === "주말") [0, 6].forEach((d) => out.add(d));
    else if (WD[s[0]] != null && /^[일월화수목금토](요일)?$/.test(s)) out.add(WD[s[0]]);
    else if (WD[s.slice(0, 3)] != null) out.add(WD[s.slice(0, 3)]);
  }
  return [...out].sort();
}

// 누구 일정인지 — 목록의 이름만 받는다(지어낸 이름은 공통으로). "쫑이"·"쫑이의"·"쫑님" 은 "쫑".
// 모델이 who 를 빠뜨려도 요청에 "쫑이의 …"·"쫑의 …" 가 있으면 그 사람 것으로 본다.
function resolveWho(who, people, command) {
  const norm = (s) => String(s ?? "").trim().replace(/\s+/g, "").replace(/(의|님|씨)$/, "");
  const find = (s) => people.find((p) => p === s) ?? people.find((p) => `${p}이` === s);
  const hit = find(norm(who));
  if (hit) return hit;
  if (typeof command !== "string") return null;
  const owners = people.filter((p) => new RegExp(`${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(이)?(의|님의)\\s`).test(command));
  return owners.length === 1 ? owners[0] : null;
}

export function validateAction(raw, ctx, today, command) {
  const bad = (reason) => ({ op: "unknown", reason });
  if (!raw || typeof raw !== "object") return bad("이해하지 못했어요");
  const minDate = addDays(today, -366), maxDate = addDays(today, 3 * 366);
  const okDate = (s) => isYmd(s) && s >= minDate && s <= maxDate;
  const times = (start, end) => {
    if (start != null && start !== "" && !isHm(start)) return null;
    if (end != null && end !== "" && !isHm(end)) return null;
    // 시간 하나만 end 에 넣는 경우가 있다("오후 3시" → end:"15:00") — 그건 시작 시각이다.
    const s = start || end || undefined, e = start && end ? end : undefined;
    if (s && e && e <= s) return { start: s };
    return { start: s, end: e };
  };
  if (command != null && ["fit", "unfit", "fitlist"].includes(raw.op) && !FIT_WORDS.test(command)) {
    if (raw.op !== "fitlist") return bad("운동 얘기인지 일정 얘기인지 헷갈려요");
    raw = { op: "list", from: raw.from, to: raw.to }; // 기간을 물었으니 일정 목록으로
  }
  const who = resolveWho(raw.who, ctx.people ?? [], command);
  // "쫑이의 테니스 레슨" → 주인은 who 로 가니 제목에선 뺀다(앱에서 색으로 보인다).
  if (who && typeof raw.title === "string") {
    const t = raw.title.trim().replace(new RegExp(`^${who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(이)?(의|님의)?\\s+`), "");
    if (t) raw = { ...raw, title: t };
  }
  switch (raw.op) {
    case "add": {
      const title = String(raw.title ?? "").trim().slice(0, 120);
      if (!title) return bad("일정 제목을 못 찾았어요");
      if (!okDate(raw.date)) return bad("날짜를 못 정했어요");
      const t = times(raw.start, raw.end);
      if (!t) return bad("시간 형식이 이상해요");
      const endDate = okDate(raw.endDate) && raw.endDate > raw.date ? raw.endDate : undefined;
      return { op: "add", title, date: raw.date, endDate, ...t, ...(who && { who }) };
    }
    case "repeat": {
      const title = String(raw.title ?? "").trim().slice(0, 120);
      if (!title) return bad("일정 제목을 못 찾았어요");
      const wds = weekdaysOf(raw.weekdays);
      if (!wds.length) return bad("무슨 요일인지 못 정했어요");
      // 달로 주면(months) 그 달들의 1일~말일. 모델이 날짜표(60일) 안에서 기간을 잘라 버리는 일이 있어서
      // 달 단위 요청은 달만 고르게 하고 날짜는 여기서 센다.
      const months = (Array.isArray(raw.months) ? raw.months : typeof raw.months === "string" ? [raw.months] : [])
        .filter((m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort();
      // 요청에 달이 적혀 있으면("다음 달", "11월이랑 12월") 그걸 따른다 — 모델이 "다음 달" 을 두 달로 고르곤 했다.
      const said = monthsSaid(command, today);
      if (months.length && said.length) months.splice(0, months.length, ...said);
      let rFrom = raw.from, rTo = raw.to;
      if (months.length) {
        rFrom = `${months[0]}-01`;
        const last = months[months.length - 1];
        rTo = ymd(new Date(Number(last.slice(0, 4)), Number(last.slice(5)), 0));
      }
      if (!okDate(rFrom) || !okDate(rTo) || rTo < rFrom) return bad("언제부터 언제까지인지 알려 주세요");
      const from = rFrom < today ? today : rFrom; // 지난 날은 넣지 않는다
      if (dayDiff(from, rTo) > 366) return bad("기간이 너무 길어요 (1년 안쪽으로)");
      const t = times(raw.start, raw.end);
      if (!t) return bad("시간 형식이 이상해요");
      const dates = [];
      for (let d = from; d <= rTo; d = addDays(d, 1)) {
        if (wds.includes(parseYmd(d).getDay()) && (!months.length || months.includes(d.slice(0, 7)))) dates.push(d);
      }
      if (!dates.length) return bad("그 기간엔 그 요일이 없어요");
      if (dates.length > REPEAT_MAX) return bad(`한 번에 ${REPEAT_MAX}개까지만 넣을 수 있어요`);
      return { op: "repeat", title, dates, weekdays: wds, ...t, ...(who && { who }) };
    }
    case "list": {
      const from = okDate(raw.from) ? raw.from : today;
      let to = okDate(raw.to) && raw.to >= from ? raw.to : addDays(from, 6);
      if (dayDiff(from, to) > 62) to = addDays(from, 62);
      return { op: "list", from, to };
    }
    case "move": case "delete": {
      const ev = ctx.aliases.get(String(raw.id ?? "").trim());
      if (!ev) return bad("어떤 일정인지 못 찾았어요");
      if (ev.recur?.freq) return bad("반복 일정은 캘린더 탭에서 고쳐 주세요");
      if (raw.op === "delete") return { op: "delete", event: ev };
      const date = raw.date == null || raw.date === "" ? ev.date : raw.date;
      if (!okDate(date)) return bad("옮길 날짜를 못 정했어요");
      const t = times(raw.start ?? ev.start, raw.end ?? (raw.start ? undefined : ev.end));
      if (!t) return bad("시간 형식이 이상해요");
      if (date === ev.date && t.start === ev.start && t.end === ev.end) return bad("바뀌는 게 없어요");
      return { op: "move", event: ev, date, ...t };
    }
    case "fit": case "unfit": {
      const date = raw.date == null || raw.date === "" ? today : raw.date;
      if (!okDate(date)) return bad("운동한 날짜를 못 정했어요");
      if (date > today) return bad("아직 안 온 날은 운동 체크를 못 해요");
      if (raw.op === "unfit") return { op: "unfit", date };
      let memo = typeof raw.memo === "string" ? raw.memo.trim().slice(0, FIT_MEMO_MAX) : "";
      if (/^운동( ?(인증|체크|했어|했다|함|완료))?[.!~ ]*$/.test(memo)) memo = ""; // 내용 없는 메모는 버린다
      return { op: "fit", date, ...(memo && { memo }) };
    }
    case "fitlist": {
      // 주는 모델이 날짜를 세지 않게 "this"/"last" 만 받는다(날짜를 주면 일정 요청까지 그 날짜를 베낀다).
      // 주는 월~일, 이번 주는 오늘까지.
      if (raw.week === "this" || raw.week === "last") {
        const mon = addDays(today, -((parseYmd(today).getDay() + 6) % 7));
        return raw.week === "this"
          ? { op: "fitlist", from: mon, to: today }
          : { op: "fitlist", from: addDays(mon, -7), to: addDays(mon, -1) };
      }
      // 기간(from/to)이 있으면 그 기간, 아니면 달. 앞으로 올 날은 셀 게 없으니 오늘에서 자른다.
      if (okDate(raw.from) && okDate(raw.to) && raw.from <= raw.to) {
        let to = raw.to > today ? today : raw.to;
        if (to < raw.from) to = raw.from;
        if (dayDiff(raw.from, to) > 62) return bad("기간이 너무 길어요 (두 달 안쪽으로)");
        return { op: "fitlist", from: raw.from, to };
      }
      const month = typeof raw.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month) ? raw.month : today.slice(0, 7);
      const last = ymd(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0));
      return { op: "fitlist", from: `${month}-01`, to: last, month };
    }
    case "recall": {
      const q = Array.isArray(raw.query) ? raw.query.join(" ") : String(raw.query ?? "");
      // "어제 무슨 얘기 했지" 에 모델이 query:"얘기" 를 넣는다 — 그런 낱말로 찾으면 오히려 다 놓친다.
      const terms = q.split(/[\s,]+/).map((s) => s.trim().slice(0, 20))
        .filter((s) => s && !RECALL_STOP.has(s)).slice(0, 4);
      let from = null, to = today;
      if (typeof raw.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month)) {
        from = `${raw.month}-01`;
        to = ymd(new Date(Number(raw.month.slice(0, 4)), Number(raw.month.slice(5)), 0));
      } else {
        if (isYmd(raw.from)) from = raw.from;
        if (isYmd(raw.to)) to = raw.to;
      }
      // 기간이 없으면: 낱말이 있으면 전부(3년), 없으면 어제·오늘(그냥 "무슨 얘기 했어?").
      if (!from) from = terms.length ? addDays(today, -3 * 366) : addDays(today, -1);
      if (to > today) to = today;
      if (from > to) from = to;
      return { op: "recall", terms, from, to };
    }
    case "bucket": {
      const show = ["todo", "done", "all"].includes(raw.show) ? raw.show : "todo";
      const q = Array.isArray(raw.query) ? raw.query.join(" ") : String(raw.query ?? "");
      const terms = q.split(/[\s,]+/).map((x) => x.trim().slice(0, 20)).filter((x) => x && !/^(버킷|버킷리스트|리스트|목록)$/.test(x)).slice(0, 4);
      return { op: "bucket", show: terms.length ? "all" : show, terms };
    }
    case "recommend": {
      const hint = typeof raw.hint === "string" ? raw.hint.trim().slice(0, 60) : "";
      return { op: "recommend", ...(hint && { hint }) };
    }
    case "chat": {
      const reply = String(raw.reply ?? "").trim().slice(0, 400);
      return reply ? { op: "chat", reply } : bad("뭐라고 해야 할지 모르겠승…");
    }
    default:
      return bad(typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim().slice(0, 80) : "이해하지 못했어요");
  }
}

/** 동작 → 캘린더 변경(평문)과 채팅 답. 실제 암호화·전송은 호출자 몫. */
export function plan(action, { events, sender, now = Date.now() }) {
  const rev = now;
  // who 가 있으면 그 사람의 개인 일정(앱에서 그 사람 색), 없으면 공통 일정.
  const base = (a) => ({ title: a.title, owner: a.who ?? sender, shared: !a.who,
    ...(a.start && { start: a.start }), ...(a.end && { end: a.end }) });
  const whose = (a) => (a.who ? `${a.who} 일정` : "공통");
  if (action.op === "add") {
    const content = { date: action.date, ...base(action) };
    if (action.endDate) content.endDate = action.endDate;
    return { puts: [{ id: randId(), rev, content }], dels: [], reply: `📅 "${action.title}" 일정 추가됨 (${whenText(content)}${action.who ? `, ${whose(action)}` : ""})` };
  }
  if (action.op === "repeat") {
    const puts = action.dates.map((date) => ({ id: randId(), rev, content: { date, ...base(action) } }));
    return { puts, dels: [], reply: `📅 "${action.title}" ${action.dates.length}개 추가됨 (${whose(action)}${action.start ? `, ${action.start}` : ""})\n${repeatDates(action.dates)}` };
  }
  if (action.op === "list") {
    const hits = plans(events)
      .filter((e) => !e.recur?.freq && (e.endDate || e.date) >= action.from && e.date <= action.to)
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.start ?? "").localeCompare(String(b.start ?? "")));
    const head = `📅 ${label(action.from)} ~ ${label(action.to)} 일정 ${hits.length}개`;
    const body = hits.slice(0, 20).map((e) => `· ${whenText(e)} ${e.title ?? ""}`);
    if (hits.length > 20) body.push(`… 외 ${hits.length - 20}개`);
    return { puts: [], dels: [], reply: [head, ...body].join("\n") };
  }
  if (action.op === "move") {
    const ev = action.event;
    const { id: _i, rev: _r, deleted: _d, ...content } = ev;
    if (content.endDate) content.endDate = addDays(content.endDate, dayDiff(ev.date, action.date));
    content.date = action.date;
    if (action.start) content.start = action.start; else delete content.start;
    if (action.end) content.end = action.end; else delete content.end;
    return { puts: [{ id: ev.id, rev, content }], dels: [], reply: `📅 "${ev.title}" ${whenText(ev)} → ${whenText(content)}로 옮김` };
  }
  if (action.op === "delete") {
    const ev = action.event;
    // 웹앱(calDeleteEvent)처럼 댓글도 같이 지운다 — 남기면 고아 레코드가 된다.
    const comments = events.filter((c) => !c.deleted && c.kind === "comment" && c.eventId === ev.id);
    return { puts: [], dels: [ev.id, ...comments.map((c) => c.id)].map((id) => ({ id, rev })), reply: `📅 "${ev.title}" (${whenText(ev)}) 일정 삭제됨` };
  }
  if (action.op === "fit" || action.op === "unfit") {
    const month = action.date.slice(0, 7), day = String(Number(action.date.slice(8)));
    const cur = fitRecord(events, month, sender);
    const days = { ...(cur?.days || {}) };
    if (action.op === "unfit") {
      if (!days[day]) return { puts: [], dels: [], reply: `💪 ${label(action.date)}엔 ${sender}님 운동 체크가 없어요` };
      delete days[day];
    } else {
      days[day] = { ...(days[day] || { at: now }) };
      if (action.memo) days[day].memo = action.memo;
    }
    const content = { kind: "workout", month, owner: sender, days, at: now };
    const n = Object.keys(days).length;
    const reply = action.op === "unfit"
      ? `💪 ${sender}님 ${label(action.date)} 운동 체크 취소 (${Number(month.slice(5))}월 ${n}회)`
      : `💪 ${sender}님 ${label(action.date)} 운동 완료!${action.memo ? ` — ${action.memo}` : ""} (${Number(month.slice(5))}월 ${n}회째)`;
    return { puts: [{ id: fitId(month, sender), rev, content }], dels: [], reply };
  }
  if (action.op === "fitlist") return { puts: [], dels: [], reply: fitSummary(events, action) };
  if (action.op === "bucket") return { puts: [], dels: [], reply: bucketSummary(events, action) };
  if (action.op === "chat") return { puts: [], dels: [], reply: action.reply };
  return { puts: [], dels: [], reply: `🤖 ${action.reason}` };
}

// 기간 안 둘의 운동 체크. 짧은 기간(주)은 날짜·메모까지, 달은 날짜 숫자만. 한 번도 기록이
// 없는 사람은 모르니(이름을 모른다) 운동 레코드가 있는 사람만 센다 — 이 기간 0회도 보인다.
function fitSummary(events, { from, to, month }) {
  const recs = events.filter((e) => !e.deleted && e.kind === "workout" && e.days && typeof e.days === "object");
  const owners = [...new Set(recs.map((r) => r.owner || "?"))];
  const title = month ? `${Number(month.slice(5))}월 운동 기록` : `${label(from)} ~ ${label(to)} 운동 요약`;
  const hits = new Map(owners.map((o) => [o, []]));
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const mo = d.slice(0, 7), day = String(Number(d.slice(8)));
    for (const r of recs) if (r.month === mo && r.days[day]) hits.get(r.owner || "?").push({ d, memo: r.days[day].memo });
  }
  if (![...hits.values()].some((h) => h.length)) return `💪 ${title.replace(/ (기록|요약)$/, "")} 기록이 아직 없어요`;
  const lines = [...hits].map(([o, h]) => {
    if (!h.length) return `· ${o} 0회`;
    if (month) return `· ${o} ${h.length}회 (${h.map((x) => Number(x.d.slice(8))).join(", ")}일)`;
    return `· ${o} ${h.length}회 — ${h.map((x) => `${label(x.d)}${x.memo ? ` ${x.memo}` : ""}`).join(", ")}`;
  });
  return [`💪 ${title}`, ...lines].join("\n");
}

// ── 데이트 버킷리스트(✓) — 앱의 kind:"bucket" 레코드를 읽기만 한다 ──
// 항목 { kind:"bucket", title, by, at, list?(캔버스 id), memo?, done?, doneAt?, doneBy? },
// 캔버스(목록) { kind:"bucketcanvas", title }. list 가 없으면 "기본" 목록.
const BUCKET_SHOW_MAX = 25;
function bucketItems(events) {
  const canvases = new Map(events.filter((e) => !e.deleted && e.kind === "bucketcanvas" && e.title).map((e) => [e.id, String(e.title)]));
  return events
    .filter((e) => !e.deleted && e.kind === "bucket" && typeof e.title === "string" && e.title.trim())
    .map((e) => ({ title: e.title.trim(), memo: typeof e.memo === "string" ? e.memo.trim() : "", done: !!e.done,
      doneAt: Number(e.doneAt) || 0, at: Number(e.at) || 0, list: canvases.get(e.list) ?? "기본" }));
}
function bucketSummary(events, { show, terms }) {
  let items = bucketItems(events);
  if (!items.length) return "✓ 버킷리스트가 아직 비어 있어요 (헤더의 ✓ 에서 추가)";
  const total = items.length, doneN = items.filter((i) => i.done).length;
  if (terms.length) {
    const words = terms.map((t) => t.toLowerCase());
    items = items.filter((i) => words.some((w) => `${i.title} ${i.memo}`.toLowerCase().includes(w)));
    if (!items.length) return `✓ 버킷리스트에 "${terms.join(" ")}" 은(는) 없어요 (전체 ${total}개)`;
  }
  const todo = items.filter((i) => !i.done).sort((a, b) => a.at - b.at);
  const done = items.filter((i) => i.done).sort((a, b) => b.doneAt - a.doneAt);
  const lists = new Set(items.map((i) => i.list)).size > 1;
  const line = (i) => `· ${i.title}${lists ? ` [${i.list}]` : ""}${i.done && i.doneAt ? ` (${label(ymd(new Date(i.doneAt)))} 달성)` : ""}`;
  const block = (head, xs) => {
    if (!xs.length) return [];
    const out = [head, ...xs.slice(0, BUCKET_SHOW_MAX).map(line)];
    if (xs.length > BUCKET_SHOW_MAX) out.push(`… 외 ${xs.length - BUCKET_SHOW_MAX}개`);
    return out;
  };
  const head = `✓ 버킷리스트 ${total}개 중 ${doneN}개 달성`;
  const body = [
    ...(show !== "done" ? block(`남은 것 ${todo.length}개`, todo) : []),
    ...(show !== "todo" ? block(`해낸 것 ${done.length}개`, done) : []),
  ];
  if (!body.length) return `${head}${show === "todo" ? " — 남은 게 없어요! 🎉" : ""}`;
  return [head, ...body].join("\n");
}

// 앞으로 3주 안의 주말 중 일정이 없는 날(데이트 추천에 "언제" 를 붙이려고).
function freeWeekends(events, today, days = 21) {
  const busy = new Set();
  for (const e of plans(events)) {
    for (let d = e.date; d <= (e.endDate && e.endDate > e.date ? e.endDate : e.date); d = addDays(d, 1)) busy.add(d);
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i), wd = parseYmd(d).getDay();
    if ((wd === 0 || wd === 6) && !busy.has(d)) out.push(label(d));
  }
  return out;
}

/** 데이트 추천 2단계: 아직 안 한 버킷리스트·최근 해낸 것·빈 주말만 보여 주고 고르게 한다. */
export function buildRecommendMessages(command, { todo, done, free }, sender) {
  const system = [
    "너는 두 사람의 채팅 앱에 사는 비서 '당이'다.",
    ...PERSONA,
    "두 사람에게 데이트를 추천한다. 아래 '아직 안 한 버킷리스트' 에서 요청 조건에 맞는 것을 먼저 고르고, 빈 주말이 있으면 언제 하면 좋을지도 붙인다.",
    "1~3개를 짧게, 하나마다 이유 한 줄. 목록에 맞는 게 없으면 비슷한 걸 제안해도 되지만 가게·장소 이름, 날씨, 영업시간은 지어내지 않는다. 이미 해낸 것은 다시 권하지 않는다.",
    '답은 JSON {"reply":"…"} 하나로만.',
    "",
    "아직 안 한 버킷리스트:",
    ...(todo.length ? todo : ["(없음)"]),
    "",
    "최근 해낸 것:",
    ...(done.length ? done : ["(없음)"]),
    "",
    `일정 없는 주말(3주 안): ${free.length ? free.join(", ") : "(없음)"}`,
  ].join("\n");
  return [{ role: "system", content: system }, ...(sender ? [whoMessage(sender)] : []), { role: "user", content: command }];
}

// 날짜를 달별로 한 줄씩: "11월 4, 11, 18, 25일 (수)"
function repeatDates(dates) {
  const byMonth = new Map();
  for (const d of dates) { const m = Number(d.slice(5, 7)); byMonth.set(m, [...(byMonth.get(m) ?? []), Number(d.slice(8))]); }
  const wd = [...new Set(dates.map((d) => WEEKDAYS[parseYmd(d).getDay()]))].join("·");
  return [...byMonth].map(([m, ds]) => `· ${m}월 ${ds.join(", ")}일 (${wd})`).join("\n");
}

const confirmText = (a) => a.op === "repeat"
  ? `🤖 "${a.title}" ${a.who ? `${a.who} 일정` : "공통 일정"} ${a.dates.length}개${a.start ? ` (${a.start})` : ""}를 넣을까요? "@당이 응" 이면 넣어요.\n${repeatDates(a.dates)}`
  : a.op === "delete"
  ? `🤖 "${a.event.title}" (${whenText(a.event)}) 일정을 지울까요? "@당이 응" 이면 지워요.`
  : `🤖 "${a.event.title}" ${whenText(a.event)} → ${whenText({ ...a.event, date: a.date, start: a.start, end: a.end, endDate: undefined })}로 옮길까요? "@당이 응" 이면 옮겨요.`;

/** Ollama /api/chat. format:"json" 으로 JSON 만 받는다. */
// keepAlive: 마지막 요청 뒤 모델을 메모리에 붙잡아 두는 시간(Ollama 기본 5분). 다시 올리면
// 긴 지시문을 처음부터 읽느라 CPU 에서 20초 안팎이 걸리고, 붙어 있으면 몇 초다.
export function ollamaAsk({ url, model, keepAlive, timeoutMs = 180_000 }) {
  return async (messages) => {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // num_ctx: Ollama 기본 4096 이면 일정 40개 + 날짜표로 2900 토큰이라 빠듯하다. 넘치면 앞(지시문)이 잘린다.
      body: JSON.stringify({ model, messages, stream: false, format: "json", options: { temperature: 0, num_ctx: 8192 },
        ...(keepAlive && { keep_alive: keepAlive }) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const body = await res.json();
    return JSON.parse(body.message?.content ?? "null");
  };
}

/** llama.cpp llama-server 의 OpenAI 호환 /v1/chat/completions. 모델은 서버가 띄운 하나뿐이다. */
// 이 PC(내장 GPU Radeon 680M)에선 Ollama 가 GPU 를 안 써서 긴 지시문을 처음 읽는 데 38초,
// llama-server(Vulkan)는 6초다. cache_prompt 로 같은 앞부분은 다시 안 읽는다.
// enable_thinking:false — gemma4 는 기본으로 속생각을 150~200토큰 쓰고 답해 17초가 걸린다.
export function llamaAsk({ url, timeoutMs = 180_000 }) {
  return async (messages) => {
    const res = await fetch(`${url.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature: 0, response_format: { type: "json_object" }, cache_prompt: true,
        chat_template_kwargs: { enable_thinking: false } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`llama-server HTTP ${res.status}`);
    const body = await res.json();
    return JSON.parse(body.choices?.[0]?.message?.content ?? "null");
  };
}

/**
 * 비서 본체. io 는 바깥(싱크)이 준다:
 *   ask(messages) → 모델 JSON, events() → 지금 캘린더 배열,
 *   apply({ puts, dels }) → 캘린더 반영, say(text) → 채팅 답(E2E), log(...)
 * onMessage 는 한 번에 하나씩만 처리한다(CPU 모델 응답에 수십 초가 걸린다).
 */
export function createAssistant(io, { now = () => Date.now() } = {}) {
  const pending = new Map(); // 보낸 사람 → { action, until }
  let chain = Promise.resolve();

  async function handle({ name, text, at }) {
    if (!name || name === BOT_NAME) return;
    const command = parseTrigger(text);
    if (command === null) return;
    if (now() - (at ?? 0) > MAX_AGE_MS) { io.log?.("당이: 늦게 받은 명령이라 건너뜀 —", command.slice(0, 40)); return; }
    const wait = pending.get(name);
    if (wait && wait.until > now() && (YES.test(command) || NO.test(command))) {
      pending.delete(name);
      if (NO.test(command)) { await io.say("🤖 취소했어요"); return; }
      const p = plan(wait.action, { events: io.events(), sender: name, now: now() });
      await io.apply(p);
      await io.say(p.reply);
      return;
    }
    pending.delete(name); // 새 요청이 오면 묵은 확인 대기는 버린다
    if (!command) { await io.say('🤖 예: "@당이 토요일 10시 르파비스 임장 넣어줘", "@당 이번 주 일정"'); return; }

    const today = ymd(new Date(now()));
    const ctx = buildContext(io.events(), today);
    let raw;
    try { raw = await io.ask(buildMessages(command, ctx, name)); }
    catch (e) {
      io.log?.("당이: 모델 호출 실패", String(e?.message || e));
      await io.say("🤖 로컬 모델이 응답하지 않아요 (PC의 모델 서버 확인)");
      return;
    }
    const action = validateAction(raw, ctx, today, command);
    if (action.op === "recall") {
      io.log?.("당이:", JSON.stringify({ op: "recall", terms: action.terms, from: action.from, to: action.to }), "→ recall");
      await io.say(await recall(action, command, name));
      return;
    }
    if (action.op === "recommend") {
      io.log?.("당이:", JSON.stringify({ op: "recommend" }), "→ recommend");
      await io.say(await recommend(command, name, today));
      return;
    }
    io.log?.("당이:", JSON.stringify(raw), "→", action.op);
    // 여러 개를 한꺼번에 넣는 repeat 도 되묻는다 — 잘못 알아들으면 하나씩 지우기 번거롭다.
    if (action.op === "move" || action.op === "delete" || (action.op === "repeat" && action.dates.length > 1)) {
      pending.set(name, { action, until: now() + PENDING_MS });
      await io.say(confirmText(action));
      return;
    }
    const p = plan(action, { events: io.events(), sender: name, now: now() });
    if (p.puts.length || p.dels.length) await io.apply(p);
    await io.say(p.reply);
  }

  // 백업(io.archive, 읽기 전용)에서 관련 줄을 찾아 그것만 보여 주고 답하게 한다.
  async function recall(action, command, name) {
    if (!io.archive) return "🤖 백업 기록을 읽을 수 없어요";
    const lines = io.archive.search({ terms: action.terms, from: action.from, to: action.to });
    const span = action.from === action.to ? label(action.from) : `${label(action.from)}~${label(action.to)}`;
    if (!lines.length) return `기록에서 못 찾았승… (${span}${action.terms.length ? `, "${action.terms.join(" ")}"` : ""})`;
    let raw;
    try { raw = await io.ask(buildRecallMessages(command, lines, name)); }
    catch (e) {
      io.log?.("당이: 모델 호출 실패", String(e?.message || e));
      return "🤖 로컬 모델이 응답하지 않아요 (PC의 모델 서버 확인)";
    }
    io.log?.(`당이: 기억 ${lines.length}줄 읽고 답함`); // 대화 내용은 로그에 남기지 않는다
    const reply = String(raw?.reply ?? "").trim().slice(0, 600);
    return reply || "기록은 읽었는데 뭐라고 할지 모르겠승…";
  }

  async function recommend(command, name, today) {
    const events = io.events();
    const items = bucketItems(events);
    const line = (i) => `- ${i.title.slice(0, 80)}${i.memo ? ` (메모: ${i.memo.slice(0, 60)})` : ""}`;
    const todo = items.filter((i) => !i.done).sort((a, b) => a.at - b.at).slice(0, 40).map(line);
    const done = items.filter((i) => i.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 10).map(line);
    let raw;
    try { raw = await io.ask(buildRecommendMessages(command, { todo, done, free: freeWeekends(events, today) }, name)); }
    catch (e) {
      io.log?.("당이: 모델 호출 실패", String(e?.message || e));
      return "🤖 로컬 모델이 응답하지 않아요 (PC의 모델 서버 확인)";
    }
    io.log?.(`당이: 버킷리스트 ${todo.length}개 보고 추천함`); // 내용은 로그에 남기지 않는다
    const reply = String(raw?.reply ?? "").trim().slice(0, 600);
    return reply || "음… 추천할 게 안 떠오르승. 버킷리스트에 하고 싶은 걸 더 적어 줘!";
  }

  return {
    onMessage(msg) {
      chain = chain.then(() => handle(msg)).catch((e) => io.log?.("당이 오류:", String(e?.message || e)));
      return chain;
    },
  };
}
