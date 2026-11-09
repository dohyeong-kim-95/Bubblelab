// opic 모의고사 로그인 — admin 이 발급한 계정만 들어온다(가입 화면 없음).
//
// 계정은 OpicDO 한 곳에 { id, salt, hash, gen, note, createdAt, lastLoginAt } 로 둔다. 비밀번호는
// PBKDF2-SHA256(10만 회, 워커 상한)으로만 남고, 세션 쿠키는 `만료.아이디.gen.난수.서명` 에 HMAC 서명한다.
// gen 은 비밀번호 재설정·삭제 때 올라가서, 그 전에 나간 세션을 문서 요청에서 끊는다.
// 녹음·답변은 지금처럼 폰에만 있다 — 서버에 남는 것은 계정뿐이다.

import { DAILY_LEVEL, dailyQuestion } from "../opic/questions.js";
import { createDelivery, kstDate, postToDiscord, secretMatches } from "./papers.js";

export const OPIC_ID_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const OPIC_PW_MIN = 6;
export const OPIC_PW_MAX = 128;
export const OPIC_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;
const NOTE_MAX = 60;

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

export function normalizeId(raw) {
  const id = String(raw ?? "").trim().toLowerCase();
  return OPIC_ID_RE.test(id) ? id : null;
}

export function passwordProblem(pw) {
  if (typeof pw !== "string") return "비밀번호가 없어요";
  if (pw.length < OPIC_PW_MIN) return `비밀번호는 ${OPIC_PW_MIN}자 이상`;
  if (pw.length > OPIC_PW_MAX) return `비밀번호는 ${OPIC_PW_MAX}자 이하`;
  return null;
}

export async function hashPassword(pw, saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256);
  return { salt: saltHex, hash: toHex(bits) };
}

// 길이가 같은 두 hex 문자열을 시간 차 없이 비교
function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const publicAccount = ({ id, note, createdAt, lastLoginAt }) => ({ id, note: note || "", createdAt, lastLoginAt: lastLoginAt ?? null });

export class OpicDO {
  constructor(state, env = {}) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const json = (data, status = 200) => Response.json(data, { status });
    const key = (id) => `a:${id}`;

    if (url.pathname === "/verify" && request.method === "POST") {
      const id = normalizeId(body.id);
      const acct = id && await this.storage.get(key(id));
      // 없는 계정도 같은 일을 해서 응답 시간으로 아이디 존재를 드러내지 않는다
      const { hash } = await hashPassword(String(body.password ?? ""), acct?.salt ?? "00".repeat(16));
      if (!acct || !sameHex(hash, acct.hash)) return json({ ok: false }, 401);
      acct.lastLoginAt = Date.now();
      await this.storage.put(key(id), acct);
      return json({ ok: true, id, gen: acct.gen });
    }

    if (url.pathname === "/check" && request.method === "GET") {
      const id = normalizeId(url.searchParams.get("id"));
      const acct = id && await this.storage.get(key(id));
      return json({ ok: Boolean(acct) && String(acct.gen) === url.searchParams.get("gen") });
    }

    if (url.pathname === "/accounts" && request.method === "GET") {
      const all = await this.storage.list({ prefix: "a:" });
      const accounts = [...all.values()].map(publicAccount).sort((a, b) => b.createdAt - a.createdAt);
      return json({ accounts });
    }

    if (url.pathname === "/accounts" && request.method === "POST") {
      const id = normalizeId(body.id);
      if (!id) return json({ error: "아이디는 영문 소문자·숫자·._- 3–32자" }, 400);
      const problem = passwordProblem(body.password);
      if (problem) return json({ error: problem }, 400);
      if (await this.storage.get(key(id))) return json({ error: "이미 있는 아이디예요" }, 409);
      const acct = {
        id, ...(await hashPassword(body.password)), gen: 1,
        note: String(body.note ?? "").trim().slice(0, NOTE_MAX), createdAt: Date.now(), lastLoginAt: null,
      };
      await this.storage.put(key(id), acct);
      return json({ account: publicAccount(acct) }, 201);
    }

    if (url.pathname === "/accounts/password" && request.method === "POST") {
      const id = normalizeId(body.id);
      const acct = id && await this.storage.get(key(id));
      if (!acct) return json({ error: "없는 아이디예요" }, 404);
      const problem = passwordProblem(body.password);
      if (problem) return json({ error: problem }, 400);
      Object.assign(acct, await hashPassword(body.password), { gen: acct.gen + 1 });
      await this.storage.put(key(id), acct);
      return json({ account: publicAccount(acct) });
    }

    if (url.pathname === "/accounts/delete" && request.method === "POST") {
      const id = normalizeId(body.id);
      if (!id || !(await this.storage.get(key(id)))) return json({ error: "없는 아이디예요" }, 404);
      await this.storage.delete(key(id));
      return json({ ok: true });
    }

    if (url.pathname.startsWith("/daily/")) return this.daily(request, url, body, json);

    return json({ error: "not found" }, 404);
  }

  /* 오늘의 문항 — 집 PC 데몬이 만들고(claude -p), 여기서 보관하고 디스코드로 보낸다. */
  async daily(request, url, body, json) {
    const at = Number(url.searchParams.get("at")) || Date.now();
    if (url.pathname === "/daily/pending" && request.method === "GET") {
      const date = kstDate(at);
      const question = dailyQuestion(date);
      if (!question) return json({ due: false, reason: "시작일 전입니다" });
      if (await this.storage.get(`d:${date}`)) return json({ due: false, reason: "오늘 것은 이미 만들었습니다" });
      const hourKst = new Date(at + 9 * 3600 * 1000).getUTCHours();
      if (hourKst < DAILY_HOUR_KST) return json({ due: false, reason: `${DAILY_HOUR_KST}시 이후에 만듭니다` });
      const claimed = (await this.storage.get("daily-claim")) ?? 0;
      if (at - claimed < DAILY_CLAIM_TTL_MS) return json({ due: false, reason: "다른 실행이 만드는 중입니다" });
      if (url.searchParams.get("peek") !== "1") await this.storage.put("daily-claim", at);
      return json({ due: true, date, level: DAILY_LEVEL, question });
    }
    if (url.pathname === "/daily/done" && request.method === "POST") {
      const date = String(body.date ?? "");
      const question = dailyQuestion(date);
      // 문항은 데몬이 보낸 것을 믿지 않고 날짜로 다시 정한다 — 남는 것은 답안 칸뿐이다
      if (!question) return json({ error: "날짜가 이상해요" }, 400);
      const item = normalizeDaily(body, question, at);
      if (!item) return json({ error: "답안이 비었어요" }, 400);
      const first = !(await this.storage.get(`d:${date}`));
      await this.storage.put(`d:${date}`, item);
      await this.storage.delete("daily-claim");
      let sent = false;
      const delivery = createDelivery({ ...this.env, DISCORD_CHANNEL_ID: this.env.OPIC_DISCORD_CHANNEL_ID || this.env.DISCORD_CHANNEL_ID });
      if (first && delivery && body.notify !== false) {
        await postToDiscord(delivery, dailyDiscordPayload(item, this.env.OPIC_ORIGIN || "https://opic.bubblelab.dev"));
        sent = true;
      }
      return json({ ok: true, date, sent });
    }
    if (url.pathname === "/daily/list" && request.method === "GET") {
      const all = await this.storage.list({ prefix: "d:" });
      const items = [...all.values()].map(({ date, kind, topic, question }) => ({ date, kind, topic, question }))
        .sort((a, b) => b.date.localeCompare(a.date));
      return json({ items });
    }
    if (url.pathname === "/daily/get" && request.method === "GET") {
      const item = await this.storage.get(`d:${url.searchParams.get("date")}`);
      return item ? json({ item }) : json({ error: "없어요" }, 404);
    }
    return json({ error: "not found" }, 404);
  }
}

/* ── 오늘의 문항: 프롬프트 · 검증 · 디스코드 ───────────────────────────────── */

export const DAILY_HOUR_KST = 7;
export const DAILY_CLAIM_TTL_MS = 20 * 60 * 1000;
const cut = (v, n) => String(v ?? "").replace(/\s+$/u, "").trim().slice(0, n);

/** 데몬이 claude -p 에 건네는 글. 문항은 우리 문항 은행에서 온 것이라 남이 쓴 글이 섞이지 않는다. */
export function buildDailyPrompt(question, level = DAILY_LEVEL) {
  return `You are an OPIc (ACTFL Oral Proficiency Interview - computer) coach for a Korean office worker aiming for ${level}.
Write a model spoken answer to today's practice question, then explain it in Korean.

Question type: ${question.kind} / topic: ${question.topic}
Question: "${question.text}"

Rules for the answer (English):
- Sound like natural speech, not an essay: first person, contractions, a few natural fillers ("you know", "I mean", "to be honest") but not many.
- ${level} level: about 220–280 words (around 2 minutes spoken). Clear opening, organized body with concrete details, a short wrap-up.
- Match the task: description → vivid detail; habit → present tense routine; past experience → accurate past tenses with a story arc; comparison → past vs present with reasons; social issue → opinion with reasons and examples; role-play "ask" → speak to the other person and ask 3–4 questions; role-play "problem" → explain the problem to the other person and offer 2–3 alternatives.
- Personal details must be plausible but generic (no real names of people or companies).

Return ONLY one JSON object, no markdown fences:
{"answer": "...English answer...",
 "ko": "...Korean translation of the whole answer...",
 "structure": ["도입: ...", "본론: ...", "마무리: ..."],
 "expressions": [{"en": "phrase", "ko": "뜻", "note": "언제 쓰는지 한 줄"}],
 "swap": "내 얘기로 바꿔 말할 때 바꿀 부분 1–2문장 (한국어)",
 "pitfall": "${level} 에서 이 유형에서 흔히 깎이는 점 한 줄 (한국어)"}
Give 5 or 6 expressions taken from your answer.`;
}

/** 모델 출력에서 JSON 하나를 꺼내 칸을 확인한다. 모자라면 throw. */
export function parseDaily(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON 이 없다");
  const data = JSON.parse(raw.slice(start, end + 1));
  if (typeof data.answer !== "string" || data.answer.split(/\s+/).length < 80) throw new Error("답안이 너무 짧다");
  if (typeof data.ko !== "string" || data.ko.length < 40) throw new Error("해석이 없다");
  if (!Array.isArray(data.expressions) || data.expressions.length < 3) throw new Error("표현이 모자라다");
  return data;
}

export function normalizeDaily(body, question, at = Date.now()) {
  const answer = cut(body.answer, 4000);
  if (answer.length < 200) return null;
  return {
    date: String(body.date), level: DAILY_LEVEL, kind: question.kind, topic: question.topic, question: question.text,
    answer, ko: cut(body.ko, 4000),
    structure: (Array.isArray(body.structure) ? body.structure : []).slice(0, 6).map((s) => cut(s, 200)).filter(Boolean),
    expressions: (Array.isArray(body.expressions) ? body.expressions : []).slice(0, 8)
      .map((e) => ({ en: cut(e?.en, 120), ko: cut(e?.ko, 120), note: cut(e?.note, 200) })).filter((e) => e.en),
    swap: cut(body.swap, 400), pitfall: cut(body.pitfall, 300), at,
  };
}

export function dailyDiscordPayload(item, origin = "https://opic.bubblelab.dev") {
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const exprs = item.expressions.slice(0, 6).map((e) => `• **${e.en}** — ${e.ko}`).join("\n");
  const description = clip(`${clip(item.answer, 700)}\n\n**핵심 표현**\n${exprs}${item.pitfall ? `\n\n⚠️ ${item.pitfall}` : ""}`, 3500);
  return {
    content: `🗣️ **${item.date} 오늘의 오픽** · ${item.kind} · ${item.topic} (${item.level} 모범답안)`,
    embeds: [{
      title: clip(item.question, 256), url: `${origin}/daily.html?d=${item.date}`, description,
      footer: { text: "해석·구성·음성 듣기는 제목을 눌러 오픽 화면에서" },
    }],
  };
}

/* ── 세션 ─────────────────────────────────────────────────────────────── */

export async function opicSessionKey(env) {
  // 별도 시크릿을 늘리지 않고 admin 세션 시크릿에서 용도를 달리해 파생한다
  const secret = env.ADMIN_SESSION_SECRET || `${env.ADMIN_ID}\0${env.ADMIN_PASSWORD}\0bl-admin-session`;
  return crypto.subtle.importKey("raw", enc.encode(`${secret}\0bl-opic-session`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueOpicSession(key, id, gen, now = Date.now()) {
  const payload = `${now + OPIC_SESSION_TTL_MS}.${id}.${gen}.${crypto.randomUUID()}`;
  return `${payload}.${toHex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)))}`;
}

/** 서명·만료가 맞으면 { id, gen }, 아니면 null. */
export async function readOpicSession(key, token, now = Date.now()) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 5) return null;
  const [expiry, id, gen, nonce, sig] = parts;
  if (!normalizeId(id) || !/^\d+$/.test(gen) || !nonce || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (!Number.isFinite(+expiry) || now > +expiry) return null;
  const ok = await crypto.subtle.verify("HMAC", key, fromHex(sig), enc.encode(`${expiry}.${id}.${gen}.${nonce}`));
  return ok ? { id, gen: Number(gen) } : null;
}

export function opicConfigured(env) {
  return env?.ENABLE_OPIC === "true" && Boolean(env.OPIC);
}

const stub = (env) => env.OPIC.get(env.OPIC.idFromName("accounts"));
const cookieOf = (request) => Object.fromEntries((request.headers.get("Cookie") ?? "").split(";").filter(Boolean)
  .map((p) => { const [k, ...v] = p.trim().split("="); return [k, v.join("=")]; })).bl_opic;

/**
 * opic 서브도메인 게이트. 통과면 null, 아니면 응답.
 * `limit(request)` 은 로그인 시도 제한(워커의 enforceRateLimit) — 막히면 응답을 돌려준다.
 */
export async function handleOpicGate(request, env, url, base = "", limit = async () => null) {
  if (!opicConfigured(env)) return new Response("opic is not configured", { status: 503 });
  const key = await opicSessionKey(env);
  const html = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const clear = "bl_opic=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  if (url.pathname.startsWith("/_sink/")) return handleOpicSink(request, env, url);
  const session = await readOpicSession(key, cookieOf(request));

  if (url.pathname === "/login" && request.method === "POST") {
    const limited = await limit(request);
    if (limited) return limited;
    const form = await request.formData();
    const id = normalizeId(form.get("username"));
    const res = id && await stub(env).fetch("https://opic.internal/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: String(form.get("password") ?? "") }),
    });
    const data = res?.ok ? await res.json() : null;
    if (!data?.ok) return new Response(OPIC_LOGIN_PAGE({ error: true, base, id: form.get("username") }), { status: 401, headers: html });
    const token = await issueOpicSession(key, data.id, data.gen);
    return new Response(null, { status: 303, headers: {
      Location: `${base}/`,
      "Set-Cookie": `bl_opic=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OPIC_SESSION_TTL_MS / 1000}${secure}`,
    } });
  }
  if (url.pathname === "/logout") {
    return new Response(null, { status: 303, headers: { Location: `${base}/login`, "Set-Cookie": clear } });
  }
  if (url.pathname === "/login") {
    if (session) return new Response(null, { status: 303, headers: { Location: `${base}/` } });
    return new Response(OPIC_LOGIN_PAGE({ base }), { headers: html });
  }
  if (!session) return new Response(null, { status: 303, headers: { Location: `${base}/login` } });
  // 문서(화면)를 열 때만 계정이 아직 살아 있는지 DO 에 묻는다 — 지운 계정·바꾼 비밀번호의 옛 세션을 끊는다
  const isDocument = url.pathname === "/" || url.pathname.endsWith(".html") ||
    request.headers.get("Sec-Fetch-Dest") === "document";
  if (isDocument) {
    const res = await stub(env).fetch(`https://opic.internal/check?id=${session.id}&gen=${session.gen}`);
    const alive = res.ok && (await res.json()).ok;
    if (!alive) return new Response(null, { status: 303, headers: { Location: `${base}/login`, "Set-Cookie": clear } });
  }
  if (url.pathname === "/_daily" || /^\/_daily\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) {
    if (request.method !== "GET") return new Response("not found", { status: 404 });
    const date = url.pathname.slice("/_daily/".length);
    const res = await stub(env).fetch(date ? `https://opic.internal/daily/get?date=${date}` : "https://opic.internal/daily/list");
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (url.pathname === "/_me") {
    return Response.json({ id: session.id }, { headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

/**
 * 집 PC 데몬 자리 — 논문 다이제스트와 같은 PAPERS_SINK_SECRET 을 쓴다(같은 PC·같은 env 파일이라
 * 시크릿을 늘리지 않는다). 경로·메서드는 둘만 연다.
 */
export async function handleOpicSink(request, env, url) {
  const routes = { "GET /_sink/daily/pending": "/daily/pending", "POST /_sink/daily/done": "/daily/done" };
  const target = routes[`${request.method} ${url.pathname}`];
  if (!target) return new Response("not found", { status: 404 });
  if (!env.PAPERS_SINK_SECRET) return new Response("sink is not configured", { status: 503 });
  const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secretMatches(offered, env.PAPERS_SINK_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const peek = url.searchParams.get("peek") === "1" ? "?peek=1" : "";
  const res = await stub(env).fetch(`https://opic.internal${target}${peek}`, request.method === "POST"
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() }
    : undefined);
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/** admin 의 /api/opic/accounts — 인증은 handleAdmin 이 이미 했다. */
export async function handleOpicAdmin(request, env, url) {
  if (!url.pathname.startsWith("/api/opic/")) return null;
  if (!opicConfigured(env)) return Response.json({ error: "opic is not configured" }, { status: 503 });
  const action = url.pathname.slice("/api/opic".length);
  const routes = {
    "GET /accounts": "/accounts",
    "POST /accounts": "/accounts",
    "POST /accounts/password": "/accounts/password",
    "POST /accounts/delete": "/accounts/delete",
  };
  const target = routes[`${request.method} ${action}`];
  if (!target) return Response.json({ error: "not found" }, { status: 404 });
  const res = await stub(env).fetch(`https://opic.internal${target}`, request.method === "POST"
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() }
    : undefined);
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// 로그인 화면 — opic 화면과 같은 OPIc 토큰(주황 #ff6633, 각진 버튼, 잉크 글자)
export const OPIC_LOGIN_PAGE = ({ error = false, base = "", id = "" } = {}) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>🎙️ 오픽 모의고사 — 로그인</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>🎙️</text></svg>">
<style>
  :root { color-scheme: light; --p: #ff6633; --ph: #ff4a0f; --pa: #d54406; --ink: #212529; --muted: #666d73; --gray: #6c757d; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); min-height: 100dvh; font-size: 16px; line-height: 1.5;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Noto Sans KR", Arial, sans-serif; }
  header { border-bottom: 1px solid var(--muted); padding: calc(env(safe-area-inset-top, 0px) + .8rem) max(16px, env(safe-area-inset-right, 0px)) .8rem max(16px, env(safe-area-inset-left, 0px)); }
  header b { font-weight: 800; font-size: 1.25rem; } header b span { color: var(--p); }
  header small { color: var(--muted); font-weight: 600; margin-left: .4rem; font-size: .8rem; }
  main { max-width: 26rem; margin: 0 auto; padding: 2.4rem max(16px, env(safe-area-inset-right, 0px)) 2rem max(16px, env(safe-area-inset-left, 0px)); }
  h1 { font-size: 1.35rem; text-align: center; margin: 0 0 1.6rem; text-wrap: balance; }
  label { display: block; font-size: 1.05rem; margin: 0 0 .3rem; }
  input { width: 100%; height: 3.4rem; border: 1px solid var(--gray); border-radius: 0; padding: 0 .9rem; font: inherit; font-size: 1.05rem; margin-bottom: 1rem; }
  input:focus { outline: none; border-color: var(--pa); }
  button { width: 100%; height: 3.4rem; border: 2px solid transparent; border-radius: 0; background: var(--p); color: var(--ink);
           font: inherit; font-weight: 700; font-size: 1.1rem; box-shadow: 0 2px 1px 0 rgba(0,0,0,.2); cursor: pointer; margin-top: .4rem; }
  button::after { content: " ›"; font-size: 1.3rem; }
  button:hover { background: var(--ph); }
  button:active { background: var(--pa); color: #fff; box-shadow: none; transform: scale(.98); }
  .err { background: #ffe0d6; color: #94472e; border: 1px solid #ffd4c6; padding: .7rem .9rem; margin-bottom: 1rem; font-weight: 600; }
  .note { color: var(--muted); font-size: .9rem; text-align: center; margin-top: 1.4rem; }
</style></head>
<body>
<header><b><span>OPIc</span> 모의고사</b><small>비공식 연습</small></header>
<main>
  <h1>Oral Proficiency Interview - computer (OPIc)</h1>
  ${error ? '<p class="err" role="alert">아이디 또는 비밀번호가 맞지 않아요.</p>' : ""}
  <form method="post" action="${escapeHtml(base)}/login">
    <label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${escapeHtml(id)}"${id ? "" : " autofocus"}>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required${id ? " autofocus" : ""}>
    <button type="submit">Log In</button>
  </form>
  <p class="note">계정은 운영자가 발급해요. 연습용 비공식 모의고사입니다.</p>
</main>
</body></html>`;
