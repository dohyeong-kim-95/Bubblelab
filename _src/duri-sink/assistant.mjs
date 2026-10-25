// Duri 일정 비서 "당이" — 채팅의 "@당이 …"(또는 "@당 …") 를 로컬 모델(Ollama)로 읽어 공유 캘린더를 고친다.
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
  const days = Array.from({ length: 21 }, (_, i) => {
    const s = addDays(today, i);
    return `${s} ${WEEKDAYS[parseYmd(s).getDay()]}${i === 0 ? " (오늘)" : i === 1 ? " (내일)" : ""}`;
  });
  return { aliases, days };
}

export function buildMessages(command, ctx) {
  const evLines = [...ctx.aliases].map(([a, e]) =>
    `${a}: ${e.date}${e.endDate ? `~${e.endDate}` : ""}${e.start ? ` ${e.start}${e.end ? `-${e.end}` : ""}` : " 종일"} "${e.title ?? ""}"${e.recur?.freq ? " (반복)" : ""}`);
  const system = [
    "너는 두 사람이 같이 쓰는 캘린더의 일정 비서 '당이'다. 사용자의 한국어 요청을 읽고 할 일을 JSON 하나로만 답한다.",
    "형식(하나만 고른다):",
    '{"op":"add","title":"제목","date":"YYYY-MM-DD","endDate":"YYYY-MM-DD 또는 생략","start":"HH:MM 또는 생략","end":"HH:MM 또는 생략"}',
    '{"op":"list","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}',
    '{"op":"move","id":"e번호","date":"YYYY-MM-DD 또는 생략","start":"HH:MM 또는 생략","end":"HH:MM 또는 생략"}',
    '{"op":"delete","id":"e번호"}',
    '{"op":"unknown","reason":"짧은 이유"}',
    "규칙: 날짜는 아래 날짜표에서만 고른다. 요일·'다음주'·'내일'은 날짜표로 바꾼다. 시간이 없으면 start 를 생략한다(종일).",
    "오후 3시는 15:00. 옮기기·삭제는 아래 일정 목록의 e번호로만 가리킨다. 목록에 없으면 unknown.",
    "",
    "날짜표:",
    ...ctx.days,
    "",
    "일정 목록:",
    ...(evLines.length ? evLines : ["(없음)"]),
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: command }];
}

/** 모델 답을 믿지 않고 검증한다. 통과하면 정규화된 동작, 아니면 { op:"unknown", reason }. */
export function validateAction(raw, ctx, today) {
  const bad = (reason) => ({ op: "unknown", reason });
  if (!raw || typeof raw !== "object") return bad("이해하지 못했어요");
  const minDate = addDays(today, -366), maxDate = addDays(today, 3 * 366);
  const okDate = (s) => isYmd(s) && s >= minDate && s <= maxDate;
  const times = (start, end) => {
    if (start != null && start !== "" && !isHm(start)) return null;
    if (end != null && end !== "" && !isHm(end)) return null;
    const s = start || undefined, e = s && end ? end : undefined;
    if (s && e && e <= s) return { start: s };
    return { start: s, end: e };
  };
  switch (raw.op) {
    case "add": {
      const title = String(raw.title ?? "").trim().slice(0, 120);
      if (!title) return bad("일정 제목을 못 찾았어요");
      if (!okDate(raw.date)) return bad("날짜를 못 정했어요");
      const t = times(raw.start, raw.end);
      if (!t) return bad("시간 형식이 이상해요");
      const endDate = okDate(raw.endDate) && raw.endDate > raw.date ? raw.endDate : undefined;
      return { op: "add", title, date: raw.date, endDate, ...t };
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
    default:
      return bad(typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim().slice(0, 80) : "이해하지 못했어요");
  }
}

/** 동작 → 캘린더 변경(평문)과 채팅 답. 실제 암호화·전송은 호출자 몫. */
export function plan(action, { events, sender, now = Date.now() }) {
  const rev = now;
  if (action.op === "add") {
    const content = { date: action.date, title: action.title, owner: sender, shared: true };
    if (action.start) content.start = action.start;
    if (action.end) content.end = action.end;
    if (action.endDate) content.endDate = action.endDate;
    return { puts: [{ id: randId(), rev, content }], dels: [], reply: `📅 "${action.title}" 일정 추가됨 (${whenText(content)})` };
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
  return { puts: [], dels: [], reply: `🤖 ${action.reason}` };
}

const confirmText = (a) => a.op === "delete"
  ? `🤖 "${a.event.title}" (${whenText(a.event)}) 일정을 지울까요? "@당이 응" 이면 지워요.`
  : `🤖 "${a.event.title}" ${whenText(a.event)} → ${whenText({ ...a.event, date: a.date, start: a.start, end: a.end, endDate: undefined })}로 옮길까요? "@당이 응" 이면 옮겨요.`;

/** Ollama /api/chat. format:"json" 으로 JSON 만 받는다. */
export function ollamaAsk({ url, model, timeoutMs = 180_000 }) {
  return async (messages) => {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, format: "json", options: { temperature: 0 } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const body = await res.json();
    return JSON.parse(body.message?.content ?? "null");
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
    try { raw = await io.ask(buildMessages(command, ctx)); }
    catch (e) {
      io.log?.("당이: 모델 호출 실패", String(e?.message || e));
      await io.say("🤖 로컬 모델이 응답하지 않아요 (PC의 Ollama 확인)");
      return;
    }
    const action = validateAction(raw, ctx, today);
    io.log?.("당이:", JSON.stringify(raw), "→", action.op);
    if (action.op === "move" || action.op === "delete") {
      pending.set(name, { action, until: now() + PENDING_MS });
      await io.say(confirmText(action));
      return;
    }
    const p = plan(action, { events: io.events(), sender: name, now: now() });
    if (p.puts.length || p.dels.length) await io.apply(p);
    await io.say(p.reply);
  }

  return {
    onMessage(msg) {
      chain = chain.then(() => handle(msg)).catch((e) => io.log?.("당이 오류:", String(e?.message || e)));
      return chain;
    },
  };
}
