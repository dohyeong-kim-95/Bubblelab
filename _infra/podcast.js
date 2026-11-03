// podcast.bubblelab.dev — 데일리 팟캐스트 서비스.
// 낮에 모은 PDF·이미지를 다음 날 아침 한국어 대담 오디오로 만들어 준다.
// 저장: 메타데이터는 PodcastDO(단일 인스턴스), 파일은 R2(PODCAST_BUCKET).
// 생성: cron(06:40 KST) 또는 수동 요청 → 작업 큐 → 집 PC 생성기가 가져가서
// 대본(당이)·녹음(로컬 TTS)을 끝내고 WAV를 올린다(`_src/podcast-worker/`).
// 워커는 외부 AI API를 부르지 않는다 — 큐·파일·완료 커밋만 맡는다.
import { SUPPORTED_SOURCE_TYPES } from "./podcast-ai.js";
import { sendWebPush } from "./webpush.js";
import { consumeRateLimit, rateLimitResponse, requireJsonRequest } from "./security.js";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCES_PER_DAY = 20;
const MAX_GENERATION_BYTES = 20 * 1024 * 1024; // 생성 1회에 넣을 소스 총량
const MAX_KEEP_BYTES = 50 * 1024 * 1024;       // 1인당 보관(매일 사용) 자료 총량
const MAX_JOB_ATTEMPTS = 3;                    // 같은 단계 연속 실패 허용 횟수
const STALE_GENERATION_MS = 30 * 60 * 1000;    // 이보다 오래 멈춘 생성은 재시도 허용
const WORKER_ONLINE_MS = 5 * 60 * 1000;        // PC 생성기가 이 안에 다녀갔으면 켜진 것으로 본다
const MAX_AUDIO_BYTES = 90 * 1024 * 1024;      // 24kHz 모노 WAV 약 30분
const MAX_MEMORY_CHARS = 2000;
const MAX_PUSH_SUBS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_PODCASTS = 7;

export const UPLOAD_MAX_BYTES = MAX_SOURCE_BYTES + 64 * 1024;
export const WORKER_AUDIO_MAX_BYTES = MAX_AUDIO_BYTES;

// 초대 코드: 헷갈리는 글자(I·O·0·1)를 뺀 12자. 서버에는 해시만 저장한다.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const validInviteCode = (code) =>
  /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code ?? "");

export function newInviteCode() {
  const random = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...random].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

// 사용자가 대시 없이 12자만 치거나 소문자·공백을 섞어도 받아준다.
export function normalizeInviteCode(raw) {
  const chars = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (chars.length !== 12) return null;
  const code = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
  return validInviteCode(code) ? code : null;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashInviteCode(code) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bl-podcast:${code}`)));
}

export function kstToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const json = (data, init) => Response.json(data, init);
const notFound = () => new Response("not found", { status: 404 });

const shiftDays = (day, delta) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

// 알림 말투 팩. 완성(아침)·리마인더(저녁) 각각 여러 문구를 두고 번갈아 쓴다.
// 사용자가 설정에서 톤을 고른다 (기본 playful — 듀오링고식 장난).
export const NOTIFY_TONES = ["playful", "warm", "plain"];
const NOTIFY_MESSAGES = {
  playful: {
    complete: [
      (t) => ({ title: "🎙️ 나왔어요!", body: `"${t}" — 안 들으면 저 삐져요` }),
      (t) => ({ title: "☕ 오늘 방송 준비 완료", body: t }),
      (t) => ({ title: "👂 귀 좀 빌려주세요", body: `"${t}" 도착했습니다` }),
      (t) => ({ title: "🔔 따끈따끈", body: `"${t}" 방금 구웠어요` }),
    ],
    reminder: [
      { title: "👀 어라, 오늘 조용하시네요", body: "자료를 안 넣으면 내일 아침 방송이 텅 비어요" },
      { title: "📭 자료함이 비었어요", body: "지금 하나 안 넣으면 내일은 정적입니다…" },
    ],
  },
  warm: {
    complete: [
      (t) => ({ title: "🎙️ 좋은 아침이에요", body: `오늘의 이야기 "${t}"를 준비했어요` }),
      (t) => ({ title: "☀️ 오늘도 함께 시작해요", body: t }),
      (t) => ({ title: "🍵 방송이 준비됐어요", body: `"${t}", 천천히 들어보세요` }),
    ],
    reminder: [
      { title: "🌙 자기 전에", body: "읽을거리 하나 넣어두면 내일 아침 방송으로 와요" },
      { title: "💌 오늘 하루 어땠어요?", body: "자료 하나 넣어두면 내일 들려드릴게요" },
    ],
  },
  plain: {
    complete: [
      (t) => ({ title: "오늘의 팟캐스트", body: t }),
      (t) => ({ title: "재생 준비됨", body: t }),
    ],
    reminder: [
      { title: "자료 없음", body: "자료가 없어 내일 아침 생성이 없습니다. 지금 추가할 수 있어요" },
    ],
  },
};

function pickNotify(tone, kind, index) {
  const pack = NOTIFY_MESSAGES[NOTIFY_TONES.includes(tone) ? tone : "playful"][kind];
  return pack[index % pack.length];
}

// ── 세션 (planner와 같은 HMAC 서명 토큰, 쿠키 bl_pod) ─────────────
async function sessionHmacKey(env) {
  const secret = env.PODCAST_SESSION_SECRET || env.ADMIN_SESSION_SECRET ||
    (env.ADMIN_ID && env.ADMIN_PASSWORD ? `${env.ADMIN_ID}\0${env.ADMIN_PASSWORD}` : null);
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`${secret}\0bl-podcast-session`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function issueSession(key, userId) {
  const payload = `${Date.now() + SESSION_TTL_MS}.${userId}.${crypto.randomUUID()}`;
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

async function sessionUser(key, token) {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 4) return null;
  const [expiry, userId, nonce, sig] = parts;
  if (!expiry || !userId || !nonce || !/^[0-9a-f]{64}$/.test(sig ?? "")) return null;
  if (!Number.isFinite(+expiry) || Date.now() > +expiry) return null;
  const sigBytes = Uint8Array.from(sig.match(/../g) ?? [], (h) => parseInt(h, 16));
  const valid = await crypto.subtle.verify(
    "HMAC", key, sigBytes, new TextEncoder().encode(`${expiry}.${userId}.${nonce}`),
  );
  return valid ? userId : null;
}

function cookieValue(request, name) {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

const podcastStub = (env) => env.PODCAST.get(env.PODCAST.idFromName("global"));

// ── 워커 라우트: /_podcast/* ─────────────────────────────────────
export async function handlePodcast(request, env, url) {
  // R2 바인딩(wrangler.jsonc r2_buckets)이 없으면 파일을 다룰 수 없다.
  if (!env.PODCAST_BUCKET) {
    return new Response("podcast storage is not configured", { status: 503 });
  }
  const key = await sessionHmacKey(env);
  if (!key) return new Response("podcast session secret is not configured", { status: 503 });
  const stub = podcastStub(env);
  const path = url.pathname;
  const uid = await sessionUser(key, cookieValue(request, "bl_pod"));
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${url.protocol === "https:" ? "; Secure" : ""}`;

  if (path === "/_podcast/login" && request.method === "POST") {
    const contentTypeError = requireJsonRequest(request);
    if (contentTypeError) return contentTypeError;
    const limited = await consumeRateLimit(request, env, {
      scope: "podcast-login", limit: 5, windowMs: 15 * 60 * 1000,
    });
    if (!limited.allowed) return rateLimitResponse(limited);
    const body = await request.json().catch(() => ({}));
    const code = normalizeInviteCode(body.code);
    if (!code) return json({ error: "코드는 12자입니다. 다시 확인해주세요" }, { status: 400 });
    const response = await stub.fetch("https://podcast.internal/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeHash: await hashInviteCode(code) }),
    });
    if (!response.ok) return json({ error: "등록되지 않은 코드입니다" }, { status: 401 });
    const { userId } = await response.json();
    return json({ authenticated: true }, {
      headers: { "Set-Cookie": `bl_pod=${await issueSession(key, userId)}; ${cookieFlags}`, "Cache-Control": "no-store" },
    });
  }

  if (path === "/_podcast/logout" && request.method === "POST") {
    return json({ authenticated: false }, {
      headers: { "Set-Cookie": "bl_pod=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" },
    });
  }

  if (path === "/_podcast/session" && request.method === "GET") {
    return json(
      { authenticated: Boolean(uid), vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (path.startsWith("/_podcast/worker/")) return handleWorker(request, env, url, stub);

  if (!uid) return json({ error: "authentication required" }, { status: 401 });

  if (path === "/_podcast/home" && request.method === "GET") {
    return stub.fetch(`https://podcast.internal/home?uid=${uid}`);
  }

  if (path === "/_podcast/memory" && request.method === "PUT") {
    const contentTypeError = requireJsonRequest(request);
    if (contentTypeError) return contentTypeError;
    return stub.fetch(`https://podcast.internal/memory?uid=${uid}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: await request.text(),
    });
  }

  if (path === "/_podcast/prefs" && request.method === "PUT") {
    const contentTypeError = requireJsonRequest(request);
    if (contentTypeError) return contentTypeError;
    return stub.fetch(`https://podcast.internal/prefs?uid=${uid}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: await request.text(),
    });
  }

  if (path === "/_podcast/listened" && request.method === "POST") {
    return stub.fetch(`https://podcast.internal/listened?uid=${uid}`, { method: "POST" });
  }

  if (path === "/_podcast/upload" && request.method === "POST") {
    const limited = await consumeRateLimit(request, env, {
      scope: "podcast-upload", limit: 30, windowMs: 60 * 60 * 1000,
    });
    if (!limited.allowed) return rateLimitResponse(limited);
    const mime = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
    if (!SUPPORTED_SOURCE_TYPES.has(mime)) {
      return json({ error: "PDF·이미지(PNG/JPEG/WebP)·텍스트(.txt/.md)만 올릴 수 있습니다" }, { status: 415 });
    }
    const name = decodeURIComponent(request.headers.get("X-File-Name") ?? "")
      .replace(/[\r\n]/g, " ").trim().slice(0, 120) || "이름 없는 파일";
    // 본문을 메모리에 쌓지 않고 R2로 바로 스트리밍한다 (수신과 저장이 겹쳐 빨라짐).
    const size = Number(request.headers.get("Content-Length")) || 0;
    if (size <= 0) return json({ error: "빈 파일입니다" }, { status: 400 });
    if (size > MAX_SOURCE_BYTES) {
      return json({ error: "파일이 10MB를 넘습니다" }, { status: 413 });
    }
    const registered = await stub.fetch(`https://podcast.internal/sources?uid=${uid}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mime, size }),
    });
    if (!registered.ok) return registered;
    const { source } = await registered.json();
    try {
      await env.PODCAST_BUCKET.put(source.r2Key, request.body, {
        httpMetadata: { contentType: mime },
      });
    } catch (error) {
      await stub.fetch(`https://podcast.internal/sources?uid=${uid}&id=${source.id}`, { method: "DELETE" });
      throw error;
    }
    return json({ source });
  }

  if (path === "/_podcast/source" && ["DELETE", "PATCH"].includes(request.method)) {
    const id = url.searchParams.get("id") ?? "";
    if (request.method === "PATCH") {
      const contentTypeError = requireJsonRequest(request);
      if (contentTypeError) return contentTypeError;
    }
    return stub.fetch(`https://podcast.internal/sources?uid=${uid}&id=${encodeURIComponent(id)}`, {
      method: request.method,
      ...(request.method === "PATCH" && {
        headers: { "Content-Type": "application/json" }, body: await request.text(),
      }),
    });
  }

  if (path === "/_podcast/generate" && request.method === "POST") {
    const limited = await consumeRateLimit(request, env, {
      scope: "podcast-generate", limit: 3, windowMs: 60 * 60 * 1000,
    });
    if (!limited.allowed) return rateLimitResponse(limited);
    return stub.fetch(`https://podcast.internal/generate?uid=${uid}`, { method: "POST" });
  }

  if (path.startsWith("/_podcast/audio/") && request.method === "GET") {
    const podId = path.slice("/_podcast/audio/".length);
    const meta = await stub.fetch(`https://podcast.internal/audio-meta?pod=${encodeURIComponent(podId)}`);
    if (!meta.ok) return notFound();
    const { userId, audioKey, title } = await meta.json();
    if (userId !== uid || !audioKey) return notFound();
    return serveAudio(env, request, url, audioKey, title);
  }

  if (path === "/_podcast/push" && ["POST", "DELETE"].includes(request.method)) {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return json({ error: "push is not configured" }, { status: 503 });
    }
    const contentTypeError = requireJsonRequest(request);
    if (contentTypeError) return contentTypeError;
    return stub.fetch(`https://podcast.internal/push?uid=${uid}`, {
      method: request.method, headers: { "Content-Type": "application/json" }, body: await request.text(),
    });
  }

  return notFound();
}

async function serveAudio(env, request, url, audioKey, title) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("Range") ?? "");
  const object = range
    ? await env.PODCAST_BUCKET.get(audioKey, {
        range: {
          offset: Number(range[1]),
          ...(range[2] && { length: Number(range[2]) - Number(range[1]) + 1 }),
        },
      })
    : await env.PODCAST_BUCKET.get(audioKey);
  if (!object) return notFound();
  const headers = new Headers({
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });
  if (url.searchParams.has("download")) {
    const safe = encodeURIComponent(`${title || "podcast"}.wav`);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${safe}`);
  }
  if (range) {
    const total = object.size;
    const offset = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    headers.set("Content-Range", `bytes ${offset}-${end}/${total}`);
    headers.set("Content-Length", String(end - offset + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

// ── 집 PC 생성기 라우트: /_podcast/worker/* (Bearer 토큰) ──────────
// 토큰은 admin 🎙️ Podcast 화면에서 발급하고 DO에는 해시만 남는다.
// 생성기 하나만 붙는다고 보고, 큐 맨 앞 작업을 가져가서 끝까지 만든다.
const USER_ID_RE = /^[0-9a-f-]{36}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handleWorker(request, env, url, stub) {
  const token = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!token) return json({ error: "worker token required" }, { status: 401 });
  const authed = await stub.fetch("https://podcast.internal/worker/auth", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenHash: await hashWorkerToken(token) }),
  });
  if (!authed.ok) return json({ error: "invalid worker token" }, { status: 401 });

  const path = url.pathname.slice("/_podcast/worker".length);
  if (path === "/claim" && request.method === "POST") {
    return stub.fetch("https://podcast.internal/worker/claim", { method: "POST" });
  }
  if (path === "/source" && request.method === "GET") {
    const key = url.searchParams.get("key") ?? "";
    if (!/^src\/[0-9a-f-]{36}\/[0-9]+-[0-9]{8}$/.test(key)) return notFound();
    const object = await env.PODCAST_BUCKET.get(key);
    if (!object) return notFound();
    return new Response(object.body, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  }
  if (["/progress", "/fail"].includes(path) && request.method === "POST") {
    const contentTypeError = requireJsonRequest(request);
    if (contentTypeError) return contentTypeError;
    return stub.fetch(`https://podcast.internal/worker${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text(),
    });
  }
  if (path === "/audio" && request.method === "PUT") {
    const userId = url.searchParams.get("user") ?? "";
    const date = url.searchParams.get("date") ?? "";
    const size = Number(request.headers.get("Content-Length")) || 0;
    if (!USER_ID_RE.test(userId) || !DATE_RE.test(date)) return json({ error: "bad job" }, { status: 400 });
    if (size <= 44 || size > MAX_AUDIO_BYTES) return json({ error: "bad audio size" }, { status: 413 });
    const audioKey = `audio/${userId}/${date}-${crypto.randomUUID().slice(0, 8)}.wav`;
    await env.PODCAST_BUCKET.put(audioKey, request.body, { httpMetadata: { contentType: "audio/wav" } });
    const done = await stub.fetch("https://podcast.internal/worker/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId, date, audioKey, sizeBytes: size,
        title: url.searchParams.get("title") ?? "",
        durationSeconds: Number(url.searchParams.get("duration")) || null,
      }),
    });
    if (!done.ok) await env.PODCAST_BUCKET.delete(audioKey).catch(() => {});
    return done;
  }
  return notFound();
}

export async function hashWorkerToken(token) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bl-podcast-worker:${token}`)));
}

// ── admin 라우트: /api/podcast/users (admin 세션 뒤에서 호출됨) ──
export async function handlePodcastAdmin(request, env, url) {
  const stub = podcastStub(env);
  if (url.pathname === "/api/podcast/worker") {
    if (request.method === "GET") return stub.fetch("https://podcast.internal/admin/worker");
    if (request.method === "POST") return stub.fetch("https://podcast.internal/admin/worker", { method: "POST" });
  }
  if (url.pathname === "/api/podcast/users") {
    if (request.method === "GET") return stub.fetch("https://podcast.internal/admin/users");
    if (request.method === "POST") {
      return stub.fetch("https://podcast.internal/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await request.json().catch(() => ({}))),
      });
    }
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      return stub.fetch(`https://podcast.internal/admin/users?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    }
  }
  return null;
}

// cron(06:40 KST)에서 호출 — 미사용 소스가 있는 사용자를 일괄 큐잉
export function runDailyGeneration(env) {
  return podcastStub(env).fetch("https://podcast.internal/run-daily", { method: "POST" });
}

// cron(22:00 KST)에서 호출 — 자료 없는 사용자에게 저녁 넛지 알림
export function runEveningReminder(env) {
  return podcastStub(env).fetch("https://podcast.internal/evening-reminder", { method: "POST" });
}

// ── Durable Object ───────────────────────────────────────────────
export class PodcastDO {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid");

    if (url.pathname === "/login" && request.method === "POST") {
      const { codeHash } = await request.json().catch(() => ({}));
      const userId = typeof codeHash === "string" ? await this.storage.get(`code:${codeHash}`) : null;
      if (!userId) return json({ error: "unknown code" }, { status: 401 });
      const user = await this.storage.get(`user:${userId}`);
      if (!user) return json({ error: "unknown code" }, { status: 401 });
      user.lastLoginAt = Date.now();
      await this.storage.put(`user:${userId}`, user);
      return json({ userId });
    }

    if (url.pathname === "/admin/users") return this.adminUsers(request, url);
    if (url.pathname === "/admin/worker") return this.adminWorker(request);
    if (url.pathname.startsWith("/worker/")) return this.workerRoute(request, url.pathname.slice("/worker".length));
    if (url.pathname === "/run-daily" && request.method === "POST") return this.runDaily();
    if (url.pathname === "/evening-reminder" && request.method === "POST") return this.eveningReminder();
    if (url.pathname === "/audio-meta" && request.method === "GET") {
      const index = await this.storage.get(`podidx:${url.searchParams.get("pod")}`);
      if (!index) return notFound();
      const pod = await this.storage.get(`pod:${index.userId}:${index.date}`);
      if (!pod || pod.status !== "completed") return notFound();
      return json({ userId: index.userId, audioKey: pod.audioKey, title: pod.title });
    }

    const user = uid ? await this.storage.get(`user:${uid}`) : null;
    if (!user) return json({ error: "unknown user" }, { status: 401 });

    if (url.pathname === "/home" && request.method === "GET") return this.home(user);
    if (url.pathname === "/memory" && request.method === "PUT") {
      const body = await request.json().catch(() => ({}));
      user.memory = String(body.memory ?? "").slice(0, MAX_MEMORY_CHARS);
      await this.storage.put(`user:${user.id}`, user);
      return json({ saved: true });
    }
    if (url.pathname === "/prefs" && request.method === "PUT") {
      const body = await request.json().catch(() => ({}));
      if (NOTIFY_TONES.includes(body.tone)) {
        user.notifyTone = body.tone;
        await this.storage.put(`user:${user.id}`, user);
      }
      return json({ saved: true, notifyTone: user.notifyTone ?? "playful" });
    }
    if (url.pathname === "/listened" && request.method === "POST") return this.recordListen(user);
    if (url.pathname === "/sources") {
      if (request.method === "POST") return this.addSource(user, request);
      if (request.method === "DELETE") return this.deleteSource(user, url.searchParams.get("id"));
      if (request.method === "PATCH") return this.setSourceKeep(user, url.searchParams.get("id"), request);
    }
    if (url.pathname === "/generate" && request.method === "POST") {
      return this.enqueue(user.id, { manual: true });
    }
    if (url.pathname === "/push") {
      if (request.method === "POST") return this.addPushSubscription(user, request);
      if (request.method === "DELETE") return this.removePushSubscription(user, request);
    }
    return notFound();
  }

  async home(user) {
    const today = kstToday();
    const sources = [...(await this.storage.list({ prefix: `src:${user.id}:` })).values()];
    const pods = [...(await this.storage.list({ prefix: `pod:${user.id}:` })).values()]
      .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, RECENT_PODCASTS);
    const jobs = (await this.storage.get("jobs")) ?? [];
    const project = ({ id, date, status, stage, title, durationSeconds, sizeBytes, error, sourceNames, updatedAt }) =>
      ({ id, date, status, stage, title, durationSeconds, sizeBytes, error, sourceNames, updatedAt });
    const todayPod = pods.find((p) => p.date === today);
    return json({
      user: {
        name: user.name, memory: user.memory ?? "",
        notifyTone: user.notifyTone ?? "playful",
        streak: user.streak ?? 0, longestStreak: user.longestStreak ?? 0,
      },
      today,
      todayPodcast: todayPod ? project(todayPod) : null,
      queued: jobs.some((job) => job.userId === user.id),
      workerOnline: Date.now() - ((await this.storage.get("workerSeenAt")) ?? 0) < WORKER_ONLINE_MS,
      sources: sources.map(({ id, name, mime, size, uploadedAt, keep }) => ({ id, name, mime, size, uploadedAt, keep: Boolean(keep) })),
      podcasts: pods.map(project),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  async addSource(user, request) {
    const body = await request.json().catch(() => ({}));
    const today = kstToday();
    const existing = [...(await this.storage.list({ prefix: `src:${user.id}:` })).values()];
    if (existing.filter((s) => s.date === today).length >= MAX_SOURCES_PER_DAY) {
      return json({ error: `하루 최대 ${MAX_SOURCES_PER_DAY}개까지 올릴 수 있습니다` }, { status: 409 });
    }
    // 같은 밀리초에 여러 개가 올라와도 업로드 순서가 보장되게 단조 시퀀스를 붙인다
    const seq = ((await this.storage.get("seq")) ?? 0) + 1;
    await this.storage.put("seq", seq);
    const id = `${Date.now()}-${String(seq).padStart(8, "0")}`;
    const source = {
      id,
      name: String(body.name ?? "").slice(0, 120),
      mime: String(body.mime ?? ""),
      size: Number(body.size) || 0,
      date: today,
      uploadedAt: Date.now(),
      keep: false,
      r2Key: `src/${user.id}/${id}`,
    };
    await this.storage.put(`src:${user.id}:${id}`, source);
    return json({ source });
  }

  // 보관 자료: 생성 후에도 지워지지 않고 매일 대본에 사용된다 (1인 50MB).
  async setSourceKeep(user, id, request) {
    const body = await request.json().catch(() => ({}));
    const keep = Boolean(body.keep);
    const key = `src:${user.id}:${id}`;
    const source = await this.storage.get(key);
    if (!source) return notFound();
    if (keep) {
      const all = [...(await this.storage.list({ prefix: `src:${user.id}:` })).values()];
      const keptBytes = all.filter((s) => s.keep && s.id !== id).reduce((sum, s) => sum + s.size, 0);
      if (keptBytes + source.size > MAX_KEEP_BYTES) {
        return json({ error: "보관함이 가득 찼습니다 (1인 50MB)" }, { status: 409 });
      }
    }
    source.keep = keep;
    await this.storage.put(key, source);
    return json({ source });
  }

  async deleteSource(user, id) {
    const key = `src:${user.id}:${id}`;
    const source = await this.storage.get(key);
    if (!source) return notFound();
    await this.storage.delete(key);
    await this.env.PODCAST_BUCKET.delete(source.r2Key).catch(() => {});
    return json({ deleted: true });
  }

  async addPushSubscription(user, request) {
    const body = await request.json().catch(() => ({}));
    const sub = body.subscription ?? body;
    if (typeof sub?.endpoint !== "string" || !sub.endpoint.startsWith("https://") ||
        typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") {
      return json({ error: "invalid subscription" }, { status: 400 });
    }
    const existing = await this.storage.list({ prefix: `push:${user.id}:` });
    if (existing.size >= MAX_PUSH_SUBS) {
      const oldestKey = [...existing.keys()][0];
      await this.storage.delete(oldestKey);
    }
    const endpointHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint)));
    await this.storage.put(`push:${user.id}:${endpointHash.slice(0, 32)}`, {
      endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    return json({ subscribed: true });
  }

  async removePushSubscription(user, request) {
    const body = await request.json().catch(() => ({}));
    const endpoint = String(body.endpoint ?? "");
    const endpointHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
    await this.storage.delete(`push:${user.id}:${endpointHash.slice(0, 32)}`);
    return json({ subscribed: false });
  }

  async adminUsers(request, url) {
    if (request.method === "GET") {
      const users = [...(await this.storage.list({ prefix: "user:" })).values()]
        .map(({ id, name, createdAt, lastLoginAt }) => ({ id, name, createdAt, lastLoginAt }));
      return json({ users });
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name ?? "").trim().slice(0, 40);
      if (!name) return json({ error: "invalid name" }, { status: 400 });
      const code = newInviteCode();
      const user = { id: crypto.randomUUID(), name, memory: "", createdAt: Date.now(), lastLoginAt: null };
      await this.storage.put(`user:${user.id}`, user);
      await this.storage.put(`code:${await hashInviteCode(code)}`, user.id);
      // 코드는 이 응답에서 한 번만 보여준다 (서버에는 해시만 남는다).
      return json({ user, code });
    }
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      const user = await this.storage.get(`user:${id}`);
      if (!user) return notFound();
      for (const prefix of [`src:${id}:`, `pod:${id}:`, `push:${id}:`]) {
        for (const key of (await this.storage.list({ prefix })).keys()) await this.storage.delete(key);
      }
      for (const [codeKey, codeUser] of await this.storage.list({ prefix: "code:" })) {
        if (codeUser === id) await this.storage.delete(codeKey);
      }
      for (const podKey of (await this.storage.list({ prefix: "podidx:" })).keys()) {
        const index = await this.storage.get(podKey);
        if (index?.userId === id) await this.storage.delete(podKey);
      }
      await this.storage.delete(`user:${id}`);
      const bucket = this.env.PODCAST_BUCKET;
      for (const prefix of [`src/${id}/`, `audio/${id}/`, `tmp/${id}/`]) {
        const listed = await bucket.list({ prefix }).catch(() => null);
        for (const object of listed?.objects ?? []) await bucket.delete(object.key).catch(() => {});
      }
      return json({ deleted: true });
    }
    return notFound();
  }

  // 오늘 팟캐스트가 없고(실패했거나 오래 멈춘 경우 포함) 소스가 있으면 큐에 넣는다.
  async enqueue(userId, { manual = false } = {}) {
    const date = kstToday();
    const existing = await this.storage.get(`pod:${userId}:${date}`);
    // 30분 넘게 진행이 없는 생성은 중단된 것으로 보고 재시도를 허용한다.
    const stale = existing && ["pending", "generating"].includes(existing.status) &&
      Date.now() - (existing.updatedAt ?? 0) > STALE_GENERATION_MS;
    if (existing && existing.status !== "failed" && !stale) {
      return json({ error: "오늘 팟캐스트는 이미 있습니다" }, { status: 409 });
    }
    const sources = await this.storage.list({ prefix: `src:${userId}:` });
    if (sources.size === 0) return json({ error: "올려둔 소스가 없습니다" }, { status: 409 });
    const jobs = ((await this.storage.get("jobs")) ?? []).filter((job) => job.userId !== userId);
    jobs.push({ userId, date, manual });
    await this.storage.put("jobs", jobs);
    const pod = {
      id: existing?.id ?? crypto.randomUUID(),
      date, status: "pending", stage: null, title: null, audioKey: null,
      durationSeconds: null, sizeBytes: null, error: null, manual,
      sourceNames: [], consumedKeys: [],
      createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
    };
    await this.storage.put(`pod:${userId}:${date}`, pod);
    await this.storage.put(`podidx:${pod.id}`, { userId, date });
    return json({ queued: true, podcast: pod });
  }

  async runDaily() {
    let queuedCount = 0;
    for (const user of (await this.storage.list({ prefix: "user:" })).values()) {
      const sources = await this.storage.list({ prefix: `src:${user.id}:` });
      if (sources.size === 0) continue;
      const existing = await this.storage.get(`pod:${user.id}:${kstToday()}`);
      if (existing && existing.status !== "failed") continue;
      const response = await this.enqueue(user.id, { manual: false });
      if (response.status === 200) queuedCount += 1;
    }
    return json({ queued: queuedCount });
  }

  // 예전(Gemini) 생성기가 걸어 둔 알람이 남아 있을 수 있다 — 지금은 할 일이 없다.
  async alarm() {}

  async adminWorker(request) {
    if (request.method === "POST") {
      // 새 토큰을 발급하면 옛 토큰은 바로 무효가 된다. 응답에서 한 번만 보여준다.
      const token = `pw_${hex(crypto.getRandomValues(new Uint8Array(24)))}`;
      await this.storage.put("workerTokenHash", await hashWorkerToken(token));
      return json({ token });
    }
    const jobs = (await this.storage.get("jobs")) ?? [];
    return json({
      hasToken: Boolean(await this.storage.get("workerTokenHash")),
      seenAt: (await this.storage.get("workerSeenAt")) ?? null,
      queued: jobs.length,
    });
  }

  async workerRoute(request, path) {
    if (path === "/auth") {
      const { tokenHash } = await request.json().catch(() => ({}));
      const stored = await this.storage.get("workerTokenHash");
      return stored && tokenHash === stored ? json({ ok: true }) : json({ ok: false }, { status: 401 });
    }
    if (path === "/claim") return this.workerClaim();
    const body = await request.json().catch(() => ({}));
    const job = (((await this.storage.get("jobs")) ?? []))
      .find((item) => item.userId === body.userId && item.date === body.date);
    if (!job) return json({ error: "no such job" }, { status: 409 });
    if (path === "/progress") {
      const patch = { stage: ["script", "tts", "store"].includes(body.stage) ? body.stage : "script" };
      if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
      await this.updatePod(job, patch);
      return json({ ok: true });
    }
    if (path === "/fail") {
      // 큐에는 남겨 둔다 — 다음 claim이 시도 횟수를 세고 상한에서 실패 처리한다.
      await this.updatePod(job, { error: String(body.error ?? "생성 실패").slice(0, 300) });
      return json({ ok: true });
    }
    if (path === "/complete") return this.workerComplete(job, body);
    return notFound();
  }

  // 큐 맨 앞 작업을 PC 생성기에 내준다. 같은 작업을 다시 가져가면(PC가 중간에
  // 꺼졌다 켜진 경우) 처음부터 다시 만들고, MAX_JOB_ATTEMPTS번을 넘기면 실패 처리한다.
  async workerClaim() {
    await this.storage.put("workerSeenAt", Date.now());
    const jobs = (await this.storage.get("jobs")) ?? [];
    while (jobs.length > 0) {
      const job = jobs[0];
      const pod = await this.storage.get(`pod:${job.userId}:${job.date}`);
      const user = await this.storage.get(`user:${job.userId}`);
      if (!pod || !user || pod.status === "completed") { jobs.shift(); continue; }
      job.attempts = (job.attempts ?? 0) + 1;
      if (job.attempts > MAX_JOB_ATTEMPTS) {
        jobs.shift();
        await this.markFailed(job, new Error(pod.error ? `여러 번 시도했지만 완료하지 못했습니다 — ${pod.error}` : "여러 번 시도했지만 완료하지 못했습니다"));
        continue;
      }
      // 보관(keep) 자료 먼저, 나머지는 업로드 순서. 입력 총량 상한 내에서만 넘기고,
      // 실제 사용된 일회성 소스만 삭제 대상으로 기록한다 (초과분·보관분은 남는다).
      const entries = [...(await this.storage.list({ prefix: `src:${job.userId}:` })).entries()];
      const ordered = [...entries.filter(([, m]) => m.keep), ...entries.filter(([, m]) => !m.keep)];
      const sources = [];
      const consumed = [];
      let totalBytes = 0;
      for (const [key, meta] of ordered) {
        if (totalBytes + meta.size > MAX_GENERATION_BYTES) continue;
        totalBytes += meta.size;
        sources.push({ key: meta.r2Key, name: meta.name, mime: meta.mime, size: meta.size });
        if (!meta.keep) consumed.push({ key, r2Key: meta.r2Key });
      }
      if (sources.length === 0) {
        jobs.shift();
        await this.markFailed(job, new Error("올려둔 소스가 없습니다"));
        continue;
      }
      await this.storage.put("jobs", jobs);
      await this.updatePod(job, {
        status: "generating", stage: "script", error: null,
        consumedKeys: consumed, sourceNames: sources.map((s) => s.name).slice(0, 20),
      });
      return json({
        job: { userId: job.userId, date: job.date, attempt: job.attempts },
        memory: user.memory ?? "", sources,
      });
    }
    await this.storage.put("jobs", jobs);
    return new Response(null, { status: 204 });
  }

  // 오디오는 라우트가 R2에 이미 올렸다. 완료 상태를 먼저 커밋한 뒤에 정리한다 —
  // 정리가 실패해도 결과·원본이 함께 사라지는 일이 없다 (정리 실패는 무해).
  async workerComplete(job, body) {
    const pod = await this.storage.get(`pod:${job.userId}:${job.date}`);
    if (!pod) return json({ error: "no such podcast" }, { status: 409 });
    const title = String(body.title ?? "").trim().slice(0, 120) || pod.title || "오늘의 팟캐스트";
    const consumedKeys = [...(pod.consumedKeys ?? [])];
    await this.updatePod(job, {
      status: "completed", stage: null, error: null, title, audioKey: body.audioKey,
      durationSeconds: Number(body.durationSeconds) || null, sizeBytes: Number(body.sizeBytes) || null,
      consumedKeys: [],
    });
    const jobs = ((await this.storage.get("jobs")) ?? [])
      .filter((item) => !(item.userId === job.userId && item.date === job.date));
    await this.storage.put("jobs", jobs);
    const bucket = this.env.PODCAST_BUCKET;
    for (const { key, r2Key } of consumedKeys) {
      await this.storage.delete(key);
      await bucket.delete(r2Key).catch(() => {});
    }
    await this.notifyCompleted(job, title);
    return json({ completed: true });
  }

  async updatePod(job, patch) {
    const pod = await this.storage.get(`pod:${job.userId}:${job.date}`);
    if (!pod) return null;
    Object.assign(pod, patch, { updatedAt: Date.now() });
    await this.storage.put(`pod:${job.userId}:${job.date}`, pod);
    return pod;
  }

  async markFailed(job, error) {
    console.error("podcast generation failed", job.userId, error);
    await this.updatePod(job, {
      status: "failed", stage: null, error: String(error?.message ?? error).slice(0, 300),
    });
  }

  // 한 사용자의 등록된 모든 기기로 푸시를 보낸다 (만료 구독은 정리).
  async sendPush(userId, { title, body, url = "https://podcast.bubblelab.dev/" }) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = this.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return 0;
    const vapid = {
      publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT || "https://podcast.bubblelab.dev",
    };
    const payload = JSON.stringify({ title, body, url });
    let sent = 0;
    for (const [key, sub] of await this.storage.list({ prefix: `push:${userId}:` })) {
      try {
        const result = await sendWebPush(sub, payload, vapid);
        if (result.gone) await this.storage.delete(key);
        else if (result.ok) sent += 1;
      } catch (error) {
        console.error("push send failed", error);
      }
    }
    return sent;
  }

  async notifyCompleted(job, title) {
    const user = await this.storage.get(`user:${job.userId}`);
    const count = user?.notifyCount ?? 0;
    const msg = pickNotify(user?.notifyTone, "complete", count)(title);
    let body = msg.body;
    if ((user?.streak ?? 0) >= 2) body += ` 🔥${user.streak}일 연속!`;
    await this.sendPush(job.userId, { title: msg.title, body });
    if (user) { user.notifyCount = count + 1; await this.storage.put(`user:${user.id}`, user); }
  }

  // 22:00 KST — 내일 아침 방송에 쓸 소스가 없는(그리고 알림을 켠) 사용자에게 넛지.
  async eveningReminder() {
    let notified = 0;
    for (const user of (await this.storage.list({ prefix: "user:" })).values()) {
      const subs = await this.storage.list({ prefix: `push:${user.id}:` });
      if (subs.size === 0) continue;                 // 알림 안 켠 사람은 건너뜀
      const sources = await this.storage.list({ prefix: `src:${user.id}:` });
      if (sources.size > 0) continue;                // 이미 자료를 넣어둔 사람은 조용히
      const count = user.notifyCount ?? 0;
      const msg = pickNotify(user.notifyTone, "reminder", count);
      const sent = await this.sendPush(user.id, { title: msg.title, body: msg.body });
      if (sent > 0) { user.notifyCount = count + 1; await this.storage.put(`user:${user.id}`, user); notified += 1; }
    }
    return json({ notified });
  }

  // 청취 스트릭: 재생할 때마다 그날을 기록하고 연속 일수를 갱신한다.
  async recordListen(user) {
    const today = kstToday();
    if (user.lastListenDate !== today) {
      const yesterday = shiftDays(today, -1);
      user.streak = user.lastListenDate === yesterday ? (user.streak ?? 0) + 1 : 1;
      user.longestStreak = Math.max(user.longestStreak ?? 0, user.streak);
      user.lastListenDate = today;
      await this.storage.put(`user:${user.id}`, user);
    }
    return json({ streak: user.streak ?? 1, longest: user.longestStreak ?? 1 });
  }
}
