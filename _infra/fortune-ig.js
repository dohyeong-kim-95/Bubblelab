// 인스타그램(@dageudangs.zip) "사주" 댓글 → DM 으로 생년월일 받기 → 집 PC 큐 → 승인 뒤 링크 DM.
// 화면에 그려지지 않는 서버 글이라 fortune.js(글꼴 조각 검사 대상)와 떼어 둔다.
//
// 공식 Instagram API with Instagram Login 만 쓴다(비공식 로그인·쿠키 금지).
//   - 댓글 → 비공개 답장(recipient.comment_id): 댓글 하나에 한 통, 7일 안.
//   - 그다음은 상대가 답한 뒤 24시간 안에만 보낼 수 있다 → 링크도 그 창 안에서(창이 닫혔으면 send 가 거절).
// 개인정보(이름·생년월일)는 ig:conv:<igsid>(대화 중, 하루 지나면 지움)와 ig:req:<id>(큐) 두 곳뿐,
// 링크를 보내거나(done) 버리면 지운다. 디스코드에는 몇 번째인지만 싣는다.
import { secretMatches } from "./papers.js";

const fortuneStub = (env) => env.FORTUNE.get(env.FORTUNE.idFromName("global"));
export const IG_GRAPH = "https://graph.instagram.com/v24.0";
export const IG_DAILY_CAP_DEFAULT = 10;
export const IG_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONV_TTL_MS = 24 * 60 * 60 * 1000;
const PRIVACY_URL = "https://util.bubblelab.dev/fortune/privacy/";
const REVIEW_URL = "https://util.bubblelab.dev/fortune/review/";
const SHARE_LINK_RE = /^https:\/\/util\.bubblelab\.dev\/fortune\/get\/#[A-Za-z0-9_-]{22}$/;

export const TRIGGER_RE = /사주/;
const CANCEL_RE = /^\s*(취소|그만|중단)\s*$/;

// 12시(지지) — 인덱스가 곧 h(0=자시). 버튼 글자는 20자 안.
export const HOURS = [
  ["자시 23:30–01:29", 0], ["축시 01:30–03:29", 1], ["인시 03:30–05:29", 2], ["묘시 05:30–07:29", 3],
  ["진시 07:30–09:29", 4], ["사시 09:30–11:29", 5], ["오시 11:30–13:29", 6], ["미시 13:30–15:29", 7],
  ["신시 15:30–17:29", 8], ["유시 17:30–19:29", 9], ["술시 19:30–21:29", 10], ["해시 21:30–23:29", 11],
];

const qr = (pairs) => pairs.map(([title, payload]) => ({ content_type: "text", title, payload }));
const say = (text, quick) => (quick ? { text, quick_replies: qr(quick) } : { text });

export const MSG = {
  invite: "다그당스예요! 댓글 고마워요 🐴\n만화 사주를 그려 드릴게요. 이 메시지에 \"시작\"이라고 답해 주세요.",
  consent: () => say(
    "만화 사주에는 생년월일·태어난 시·성별·양력/음력과 표지에 쓸 이름(별명 가능)이 필요해요.\n" +
    `받은 정보는 만화를 그리는 데만 쓰고, 링크를 보내고 나면 지워요.\n개인정보처리방침: ${PRIVACY_URL}`,
    [["동의하고 시작", "CONSENT_YES"], ["안 할래요", "CONSENT_NO"]]),
  declined: "알겠어요! 생각나면 언제든 \"사주\"라고 보내 주세요.",
  name: () => say("표지에 \"OO님의 만화 사주\"로 들어갈 이름이나 별명을 적어 주세요(12자 안).", [["이름 없이", "NAME_SKIP"]]),
  nameBad: "이름은 12자 안의 글자로 적어 주세요(기호·주소 없이).",
  birth: "생년월일을 적어 주세요. 예) 1995-10-28",
  birthBad: "날짜를 못 읽었어요. 1995-10-28 처럼 적어 주세요.",
  hour: () => say("태어난 시를 골라 주세요.", [...HOURS, ["몰라요", "H_NONE"]].map(([t, h]) => [t, typeof h === "number" ? `H_${h}` : h])),
  gender: () => say("성별을 골라 주세요.", [["남성", "G_male"], ["여성", "G_female"], ["안 알려 줄래요", "G_unspecified"]]),
  calendar: () => say("적어 주신 생일은 양력인가요, 음력인가요?", [["양력", "C_solar"], ["음력", "C_lunar"], ["음력 윤달", "C_leap"]]),
  confirm: (s) => say(`이대로 그릴게요.\n${summary(s)}`, [["맞아요", "OK_YES"], ["처음부터 다시", "OK_NO"]]),
  queued: "접수됐어요! 다그당스가 그려서 오늘 안에 이 DM 으로 링크를 보내 드릴게요 🎨\n(링크를 받으려면 이 대화를 지우지 말아 주세요)",
  full: "오늘 그릴 수 있는 자리가 다 찼어요 🙏 내일 다시 \"사주\"라고 보내 주세요.",
  dup: "이미 신청해 주셨어요! 다 그리면 이 DM 으로 링크를 보내 드릴게요.",
  cancelled: "취소했어요. 적어 주신 정보는 지웠어요.",
  help: "만화 사주를 받으려면 \"사주\"라고 보내 주세요.",
  link: (link) => `만화 사주가 완성됐어요 🐴🎨\n${link}\n링크는 7일 동안 열려요. 보시고 후기 남겨 주시면 다그당스가 힘이 나요 → ${REVIEW_URL}`,
};

function summary(s) {
  const b = s.birth;
  const hour = b.h == null ? "모름" : HOURS[b.h][0].split(" ")[0];
  const cal = b.calendar === "lunar" ? (b.lunarLeap ? "음력 윤달" : "음력") : "양력";
  const g = { male: "남성", female: "여성" }[s.gender] ?? "안 알림";
  return `· 이름: ${s.name || "(없음)"}\n· 생일: ${b.y}-${String(b.m).padStart(2, "0")}-${String(b.d).padStart(2, "0")} (${cal})\n· 시: ${hour}\n· 성별: ${g}`;
}

/** 자유 글에서 생년월일 읽기 — 1995-10-28 · 1995.10.28 · 19951028 · 95년 10월 28일 · 1995 10 28. */
export function parseBirthText(text, thisYear) {
  const t = String(text ?? "").trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(t.replace(/\s/g, ""))
    || /(\d{2,4})\s*(?:[-./년\s])\s*(\d{1,2})\s*(?:[-./월\s])\s*(\d{1,2})\s*일?/.exec(t);
  if (!m) return null;
  let y = Number(m[1]); const mo = Number(m[2]), d = Number(m[3]);
  if (m[1].length === 2) y += y > thisYear % 100 ? 1900 : 2000;
  else if (m[1].length === 3) return null;
  if (y < 1900 || y > thisYear || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function validSolar(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function cleanName(text) {
  const n = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!n || [...n].length > 12) return null;
  if (/[<>@/\\:"'`{}[\]()#%&*=+|~^$]|https?|www\./i.test(n)) return null;
  return n;
}

/**
 * 대화 한 걸음. state 는 저장된 대화(없으면 null), input 은 { text, payload }.
 * 돌려주는 값: { state(null=지움), replies:[message], enqueue?:request }.
 * 큐 넣기(상한·중복)는 DO 가 enqueue 를 보고 정한다.
 */
export function igStep(state, input, thisYear) {
  const text = String(input.text ?? "").trim();
  const p = input.payload ?? "";
  if (CANCEL_RE.test(text)) return { state: null, replies: [say(MSG.cancelled)] };
  const start = () => ({ state: { step: "consent" }, replies: [MSG.consent()] });
  if (!state) return TRIGGER_RE.test(text) || /^시작$/.test(text) ? start() : { state: null, replies: [say(MSG.help)] };
  if (state.step === "invited") return start();
  if (state.step !== "consent" && state.step !== "birth" && TRIGGER_RE.test(text) && !p) return start();

  switch (state.step) {
    case "consent":
      if (p === "CONSENT_YES" || /^(동의|네|예|응|좋아요?)/.test(text)) return { state: { step: "name" }, replies: [MSG.name()] };
      if (p === "CONSENT_NO") return { state: null, replies: [say(MSG.declined)] };
      return { state, replies: [MSG.consent()] };
    case "name": {
      if (p === "NAME_SKIP") return { state: { step: "birth", name: "" }, replies: [say(MSG.birth)] };
      const name = cleanName(text);
      if (!name) return { state, replies: [say(MSG.nameBad), MSG.name()] };
      return { state: { step: "birth", name }, replies: [say(MSG.birth)] };
    }
    case "birth": {
      const b = parseBirthText(text, thisYear);
      if (!b) return { state, replies: [say(MSG.birthBad)] };
      return { state: { ...state, step: "hour", birth: b }, replies: [MSG.hour()] };
    }
    case "hour": {
      const h = /^H_(\d{1,2})$/.exec(p);
      if (!h && p !== "H_NONE") return { state, replies: [MSG.hour()] };
      return { state: { ...state, step: "gender", birth: { ...state.birth, h: h ? Number(h[1]) : null } }, replies: [MSG.gender()] };
    }
    case "gender": {
      const g = /^G_(male|female|unspecified)$/.exec(p);
      if (!g) return { state, replies: [MSG.gender()] };
      return { state: { ...state, step: "calendar", gender: g[1] }, replies: [MSG.calendar()] };
    }
    case "calendar": {
      const c = /^C_(solar|lunar|leap)$/.exec(p);
      if (!c) return { state, replies: [MSG.calendar()] };
      const { y, m, d } = state.birth;
      const calendar = c[1] === "solar" ? "solar" : "lunar";
      if (calendar === "solar" ? !validSolar(y, m, d) : d > 30) return { state: { ...state, step: "birth" }, replies: [say(MSG.birthBad)] };
      const next = { ...state, step: "confirm", birth: { ...state.birth, calendar, lunarLeap: c[1] === "leap" } };
      return { state: next, replies: [MSG.confirm(next)] };
    }
    case "confirm":
      if (p === "OK_NO") return { state: { step: "name" }, replies: [MSG.name()] };
      if (p !== "OK_YES") return { state, replies: [MSG.confirm(state)] };
      return { state: null, replies: [], enqueue: { name: state.name, birth: state.birth, gender: state.gender } };
    default:
      return start();
  }
}

/** Meta 웹훅 서명(X-Hub-Signature-256: sha256=<hex>, 앱 시크릿으로 원문 HMAC). */
export async function verifyIgSignature(raw, header, secret) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header ?? ""));
  if (!m || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return secretMatches(m[1].toLowerCase(), hex);
}

/** 웹훅 본문 → 우리가 다룰 사건만: comment(사주 댓글) · message(글·버튼). 우리 계정이 쓴 것·에코는 버린다. */
export function igEvents(body, ownId) {
  const out = [];
  if (body?.object !== "instagram") return out;
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      if (ch.field !== "comments" || !v.id || !v.from?.id || v.from.id === ownId) continue;
      if (TRIGGER_RE.test(String(v.text ?? ""))) out.push({ kind: "comment", commentId: String(v.id), from: String(v.from.id) });
    }
    for (const ev of entry.messaging ?? []) {
      const msg = ev.message;
      const sender = ev.sender?.id;
      if (!msg || msg.is_echo || !sender || sender === ownId) continue;
      out.push({ kind: "message", from: String(sender), text: String(msg.text ?? "").slice(0, 200), payload: String(msg.quick_reply?.payload ?? ""), at: Number(ev.timestamp) || Date.now() });
    }
  }
  return out;
}

export function igQueuedNotice(nth, todayCount, cap) {
  return { content: `📸 인스타 만화 사주 신청 — 오늘 ${todayCount}/${cap}번째 (누적 ${nth})\n집 PC 가 5분 안에 집어 가서 그려요. 다 되면 📬 알림이 한 번 더 와요.`, allowed_mentions: { parse: [] } };
}
export function igReadyNotice(status, reason) {
  const content = status === "failed"
    ? `⚠️ 인스타 만화 사주 자동 준비가 멈췄어요${reason ? ` — ${reason}` : ""}\nMaster 세션에 "인스타 실패 봐 줘" 라고 해 주세요.`
    : "📬 인스타 만화 사주 링크가 준비됐어요 — Master 세션에 \"인스타 확인\" 이라고 하면 링크를 보여 드리고, \"보내\" 하면 DM 으로 보내요.\n(상대가 마지막으로 답한 뒤 24시간 안에 보내야 해요)";
  return { content, allowed_mentions: { parse: [] } };
}

/** Graph API 로 DM 한 통. recipient 는 {id} 또는 {comment_id}. 실패해도 웹훅은 200 으로 끝낸다. */
export async function igSend(env, recipient, message, fetcher = fetch) {
  if (!env.IG_ACCESS_TOKEN) return { ok: false, error: "no token" };
  const res = await fetcher(`${IG_GRAPH}/me/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.IG_ACCESS_TOKEN}` },
    body: JSON.stringify({ recipient, message }),
  });
  if (!res.ok) {
    console.error("ig send failed", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return { ok: false, error: `status ${res.status}` };
  }
  return { ok: true };
}

/**
 *   GET  /_fortune/ig/webhook  (Meta 구독 확인: hub.mode=subscribe·hub.verify_token=IG_VERIFY_TOKEN → hub.challenge)
 *   POST /_fortune/ig/webhook  (X-Hub-Signature-256 검사 → DO 로 사건 넘김, 언제나 200)
 *   GET  /_fortune/ig-requests                (Bearer COMIC_SINK_SECRET) → { requests }
 *   POST /_fortune/ig-requests/<id>/ready     (Bearer) {status:"packaged", link} | {status:"failed", reason} → 디스코드 알림
 *   POST /_fortune/ig-requests/<id>/send      (Bearer) → 준비된 링크를 DM 으로 보내고 개인정보 삭제 | 409 window
 *   POST /_fortune/ig-requests/<id>/done      (Bearer) → 보내지 않고 삭제
 */
export async function handleFortuneIg(request, env, url) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const relay = async (target, init) => {
    const res = await fortuneStub(env).fetch(`https://fortune.internal${target}`, init);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  };
  const path = url.pathname;
  if (path === "/_fortune/ig/webhook") {
    if (!env.IG_APP_SECRET || !env.IG_VERIFY_TOKEN) return json({ error: "not configured" }, 503);
    if (request.method === "GET") {
      const q = url.searchParams;
      if (q.get("hub.mode") !== "subscribe" || !secretMatches(q.get("hub.verify_token") ?? "", env.IG_VERIFY_TOKEN)) return json({ error: "forbidden" }, 403);
      return new Response(q.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const raw = await request.text();
    if (!(await verifyIgSignature(raw, request.headers.get("X-Hub-Signature-256"), env.IG_APP_SECRET))) return json({ error: "signature" }, 401);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ ok: true }); }
    const events = igEvents(body, env.IG_USER_ID ? String(env.IG_USER_ID) : "");
    if (events.length) await relay("/ig/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(events) });
    return json({ ok: true });
  }
  const m = /^\/_fortune\/ig-requests(?:\/([0-9a-f]{16})\/(ready|send|done))?$/.exec(path);
  if (!m) return json({ error: "not found" }, 404);
  if (!env.COMIC_SINK_SECRET) return json({ error: "not configured" }, 503);
  if (!secretMatches((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env.COMIC_SINK_SECRET)) return json({ error: "unauthorized" }, 401);
  const [, id, action] = m;
  if (!id) return request.method === "GET" ? relay("/ig/list") : json({ error: "method" }, 405);
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (action === "ready") {
    const b = await request.json().catch(() => ({}));
    const status = b?.status === "failed" ? "failed" : "packaged";
    const link = String(b?.link ?? "");
    if (status === "packaged" && !SHARE_LINK_RE.test(link)) return json({ error: "link" }, 400);
    const reason = String(b?.reason ?? "").replace(/[\u0000-\u001f@<>]/g, " ").slice(0, 120);
    return relay(`/ig/ready/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, link, reason }) });
  }
  return relay(`/ig/${action}/${id}`, { method: "POST" });
}

/** FortuneDO 안쪽 — storage·env·postNotice(payload) 를 받는다. now 는 테스트용. */
export async function igInDO(storage, env, request, url, postNotice, { now = Date.now(), fetcher = fetch } = {}) {
  const path = url.pathname;
  const kstDay = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const thisYear = Number(kstDay.slice(0, 4));
  const cap = Number(env.IG_DAILY_CAP) > 0 ? Number(env.IG_DAILY_CAP) : IG_DAILY_CAP_DEFAULT;

  if (path === "/ig/events" && request.method === "POST") {
    const events = await request.json().catch(() => []);
    // 하루 넘게 멈춘 대화는 지운다(생년월일이 남지 않게).
    for (const [k, v] of await storage.list({ prefix: "ig:conv:" })) if (now - (v.at ?? 0) > CONV_TTL_MS) await storage.delete(k);
    for (const ev of Array.isArray(events) ? events : []) {
      if (ev.kind === "comment") {
        if (await storage.get(`ig:invited:${ev.commentId}`)) continue;   // 같은 댓글 웹훅 재전송
        await storage.put(`ig:invited:${ev.commentId}`, now);
        if (!(await storage.get(`ig:conv:${ev.from}`))) await storage.put(`ig:conv:${ev.from}`, { step: "invited", at: now });
        await igSend(env, { comment_id: ev.commentId }, { text: MSG.invite }, fetcher);
        continue;
      }
      if (ev.kind !== "message") continue;
      const userKey = `ig:user:${ev.from}`;
      const open = await storage.get(userKey);   // 큐에 들어가 있는 신청 id
      if (open && (await storage.get(`ig:req:${open}`))) {
        const req = await storage.get(`ig:req:${open}`);
        await storage.put(`ig:req:${open}`, { ...req, lastUserAt: now });   // 24시간 창을 다시 연다
        if (CANCEL_RE.test(ev.text)) {
          await storage.delete(`ig:req:${open}`); await storage.delete(userKey);
          await igSend(env, { id: ev.from }, say(MSG.cancelled), fetcher);
        } else if (TRIGGER_RE.test(ev.text)) {
          await igSend(env, { id: ev.from }, say(MSG.dup), fetcher);
        }
        continue;
      }
      const convKey = `ig:conv:${ev.from}`;
      const prev = (await storage.get(convKey)) ?? null;
      const step = igStep(prev, ev, thisYear);
      let replies = step.replies;
      if (step.enqueue) {
        const dayKey = `ig:day:${kstDay}`;
        const today = (await storage.get(dayKey)) ?? 0;
        if (today >= cap) {
          replies = [say(MSG.full)];
        } else {
          const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          const total = ((await storage.get("ig:count")) ?? 0) + 1;
          await storage.put(`ig:req:${id}`, { id, igsid: ev.from, ...step.enqueue, created: new Date(now).toISOString(), lastUserAt: now, status: "queued" });
          await storage.put(userKey, id);
          await storage.put(dayKey, today + 1);
          await storage.put("ig:count", total);
          replies = [say(MSG.queued)];
          await postNotice(igQueuedNotice(total, today + 1, cap));
        }
      }
      if (step.state) await storage.put(convKey, { ...step.state, at: now });
      else await storage.delete(convKey);
      for (const r of replies) await igSend(env, { id: ev.from }, r, fetcher);
    }
    return Response.json({ ok: true });
  }

  if (path === "/ig/list" && request.method === "GET") {
    const requests = [...(await storage.list({ prefix: "ig:req:" })).values()]
      .sort((a, b) => (a.created < b.created ? -1 : 1))
      .map(({ igsid, ...rest }) => ({ ...rest, windowOpen: now - rest.lastUserAt < IG_WINDOW_MS }));
    return Response.json({ requests });
  }

  const m = /^\/ig\/(ready|send|done)\/([0-9a-f]{16})$/.exec(path);
  if (!m || request.method !== "POST") return new Response("not found", { status: 404 });
  const [, action, id] = m;
  const key = `ig:req:${id}`;
  const req = await storage.get(key);
  if (!req) return Response.json({ error: "not found" }, { status: 404 });
  const forget = async () => { await storage.delete(key); await storage.delete(`ig:user:${req.igsid}`); };

  if (action === "ready") {
    const { status, link, reason } = await request.json().catch(() => ({}));
    if (status === "packaged") await storage.put(key, { ...req, status: "ready", link });
    const notified = await postNotice(igReadyNotice(status, reason));
    return Response.json({ ok: true, notified });
  }
  if (action === "done") { await forget(); return Response.json({ ok: true }); }
  // send
  if (req.status !== "ready" || !req.link) return Response.json({ error: "not ready" }, { status: 409 });
  if (now - req.lastUserAt >= IG_WINDOW_MS) return Response.json({ error: "window" }, { status: 409 });
  const sent = await igSend(env, { id: req.igsid }, { text: MSG.link(req.link) }, fetcher);
  if (!sent.ok) return Response.json({ error: "send", detail: sent.error }, { status: 502 });
  await forget();
  return Response.json({ ok: true });
}
