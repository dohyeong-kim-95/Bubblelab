// podcast.bubblelab.dev — 데일리 팟캐스트 서비스.
// 낮에 모은 PDF·이미지를 다음 날 아침 한국어 대담 오디오로 만들어 준다.
// 저장: 메타데이터는 PodcastDO(단일 인스턴스), 파일은 R2(PODCAST_BUCKET).
// 생성: cron(06:40 KST) 또는 수동 요청 → 작업 큐 → DO alarm이 한 건씩 처리.
// AI 호출은 podcast-ai.js 프로바이더 계층을 거친다 (env로 모델·업체 교체).
import {
  AI_DEFAULTS, chunkTurns, createScriptProvider, createTtsProvider, pcmToWav,
  SUPPORTED_SOURCE_TYPES, wavDurationSeconds,
} from "./podcast-ai.js";
import { sendWebPush } from "./webpush.js";
import { consumeRateLimit, rateLimitResponse, requireJsonRequest } from "./security.js";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCES_PER_DAY = 20;
const MAX_GENERATION_BYTES = 20 * 1024 * 1024; // 생성 1회에 넣을 소스 총량
const MAX_KEEP_BYTES = 50 * 1024 * 1024;       // 1인당 보관(매일 사용) 자료 총량
const MAX_JOB_ATTEMPTS = 3;                    // 같은 단계 연속 실패 허용 횟수
const STALE_GENERATION_MS = 30 * 60 * 1000;    // 이보다 오래 멈춘 생성은 재시도 허용
const MAX_MEMORY_CHARS = 2000;
const MAX_PUSH_SUBS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_PODCASTS = 7;

export const UPLOAD_MAX_BYTES = MAX_SOURCE_BYTES + 64 * 1024;

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

// ── admin 라우트: /api/podcast/users (admin 세션 뒤에서 호출됨) ──
export async function handlePodcastAdmin(request, env, url) {
  const stub = podcastStub(env);
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
    if (url.pathname === "/run-daily" && request.method === "POST") return this.runDaily();
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
      user: { name: user.name, memory: user.memory ?? "" },
      today,
      todayPodcast: todayPod ? project(todayPod) : null,
      queued: jobs.some((job) => job.userId === user.id),
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
      sourceNames: [], script: null, ttsDone: 0, chunkKeys: [], sampleRate: null,
      consumedKeys: [], createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
    };
    await this.storage.put(`pod:${userId}:${date}`, pod);
    await this.storage.put(`podidx:${pod.id}`, { userId, date });
    await this.storage.setAlarm(Date.now() + 100);
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

  // 큐 맨 앞 작업의 "한 단계"만 실행한다 (대본 → TTS 조각 하나 → 조립).
  // 각 단계가 1~2분 안에 끝나므로 실행 시간 제한에 안전하고, 처리 중
  // DO가 죽어도 워치독 알람이 진행분부터 재개한다. 같은 단계가 연속으로
  // MAX_JOB_ATTEMPTS번 실패하면 실패 처리한다.
  async alarm() {
    const jobs = (await this.storage.get("jobs")) ?? [];
    const job = jobs[0];
    if (!job) return;
    job.attempts = (job.attempts ?? 0) + 1;
    let stepFailed = false;
    if (job.attempts > MAX_JOB_ATTEMPTS) {
      jobs.shift();
      await this.storage.put("jobs", jobs);
      await this.markFailed(job, new Error("여러 번 시도했지만 완료하지 못했습니다"));
    } else {
      await this.storage.put("jobs", jobs); // 시도 횟수 기록, 큐에는 유지
      await this.storage.setAlarm(Date.now() + 15 * 60 * 1000); // 워치독
      let outcome = null;
      try {
        outcome = await this.processStep(job);
      } catch (error) {
        stepFailed = true;
        console.error("podcast step failed", job.userId, error);
        // 재시도 예정이지만 사용자에게 마지막 오류를 보여준다
        await this.updatePod(job, { error: String(error?.message ?? error).slice(0, 300) });
      }
      const current = (await this.storage.get("jobs")) ?? [];
      const index = current.findIndex((item) => item.userId === job.userId && item.date === job.date);
      if (index >= 0) {
        if (outcome === "done") current.splice(index, 1);
        else if (!stepFailed) current[index].attempts = 0; // 진행됐으면 시도 횟수 리셋
        await this.storage.put("jobs", current);
      }
    }
    const left = (await this.storage.get("jobs")) ?? [];
    if (left.length > 0) {
      // 실패 후 재시도는 잠시 기다렸다가 (API 일시 오류·쿼터 완화 대기)
      await this.storage.setAlarm(Date.now() + (stepFailed ? 60 * 1000 * job.attempts : 750));
    } else {
      await this.storage.deleteAlarm();
    }
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

  // 생성의 한 단계를 실행하고 "done" | "continue"를 반환한다.
  async processStep(job) {
    const pod = await this.storage.get(`pod:${job.userId}:${job.date}`);
    const user = await this.storage.get(`user:${job.userId}`);
    if (!pod || !user || pod.status === "completed") return "done";
    const bucket = this.env.PODCAST_BUCKET;

    // 1단계 — 소스 읽기 + 대본 생성
    if (!pod.script) {
      await this.updatePod(job, { status: "generating", stage: "script", error: null });
      const sourceEntries = [...(await this.storage.list({ prefix: `src:${job.userId}:` })).entries()];
      // 보관(keep) 자료 먼저, 나머지는 업로드 순서. AI 입력 총량 상한 내에서만 읽고,
      // 실제 사용된 일회성 소스만 삭제 대상으로 기록한다 (초과분·보관분은 남는다).
      const ordered = [
        ...sourceEntries.filter(([, meta]) => meta.keep),
        ...sourceEntries.filter(([, meta]) => !meta.keep),
      ];
      const sources = [];
      const consumed = [];
      let totalBytes = 0;
      for (const [key, meta] of ordered) {
        if (totalBytes + meta.size > MAX_GENERATION_BYTES) continue;
        const object = await bucket.get(meta.r2Key);
        if (!object) continue;
        const bytes = new Uint8Array(await object.arrayBuffer());
        totalBytes += meta.size; // 상한 판정은 등록된 크기 기준으로 일관되게
        sources.push({ name: meta.name, mime: meta.mime, bytes });
        if (!meta.keep) consumed.push({ key, r2Key: meta.r2Key });
      }
      if (sources.length === 0) throw new Error("소스 파일을 읽지 못했습니다");

      const script = await createScriptProvider(this.env).generate({
        sources, memory: user.memory, dateKst: job.date,
      });
      if (chunkTurns(script.turns).length > AI_DEFAULTS.maxTtsChunks) {
        throw new Error("대본이 너무 깁니다 — 소스를 줄여주세요");
      }
      await this.updatePod(job, {
        stage: "tts", title: script.title, script, ttsDone: 0, chunkKeys: [],
        consumedKeys: consumed, sourceNames: sources.map((s) => s.name).slice(0, 20),
      });
      return "continue";
    }

    // 2단계 — TTS 조각 하나씩 합성해 R2에 보관
    const chunks = chunkTurns(pod.script.turns);
    if ((pod.ttsDone ?? 0) < chunks.length) {
      await this.updatePod(job, { stage: "tts" });
      const part = await createTtsProvider(this.env).synthesizeChunk(chunks[pod.ttsDone]);
      const chunkKey = `tmp/${job.userId}/${job.date}-${pod.ttsDone}.pcm`;
      await bucket.put(chunkKey, part.pcm);
      await this.updatePod(job, {
        ttsDone: pod.ttsDone + 1,
        chunkKeys: [...(pod.chunkKeys ?? []), chunkKey],
        sampleRate: part.sampleRate,
      });
      return "continue";
    }

    // 3단계 — 조각 조립 → 오디오 저장 → 완료 커밋 → 소스·임시파일 정리
    await this.updatePod(job, { stage: "store" });
    const pcmParts = [];
    for (const chunkKey of pod.chunkKeys ?? []) {
      const object = await bucket.get(chunkKey);
      if (!object) throw new Error("합성된 조각이 사라졌습니다 — 다시 시도해주세요");
      pcmParts.push(new Uint8Array(await object.arrayBuffer()));
    }
    const sampleRate = pod.sampleRate ?? AI_DEFAULTS.sampleRate;
    const wav = pcmToWav(pcmParts, { sampleRate });
    const audioKey = `audio/${job.userId}/${job.date}-${crypto.randomUUID().slice(0, 8)}.wav`;
    await bucket.put(audioKey, wav, { httpMetadata: { contentType: "audio/wav" } });

    // 완료 상태를 먼저 커밋한 뒤에 정리한다 — 마지막 단계가 실패해도
    // 결과·원본이 함께 사라지는 일이 없다 (정리 실패는 무해).
    const title = pod.title;
    const consumedKeys = [...(pod.consumedKeys ?? [])];
    const chunkKeys = [...(pod.chunkKeys ?? [])];
    await this.updatePod(job, {
      status: "completed", stage: null, audioKey,
      durationSeconds: wavDurationSeconds(wav, { sampleRate }), sizeBytes: wav.length,
      script: null, chunkKeys: [], consumedKeys: [],
    });
    for (const { key, r2Key } of consumedKeys) {
      await this.storage.delete(key);
      await bucket.delete(r2Key).catch(() => {});
    }
    for (const chunkKey of chunkKeys) {
      await bucket.delete(chunkKey).catch(() => {});
    }
    await this.notifyCompleted(job, title);
    return "done";
  }

  async notifyCompleted(job, title) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = this.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
    const vapid = {
      publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT || "https://podcast.bubblelab.dev",
    };
    const payload = JSON.stringify({
      title: "🎙️ 오늘의 팟캐스트가 준비되었습니다",
      body: title, url: "https://podcast.bubblelab.dev/",
    });
    for (const [key, sub] of await this.storage.list({ prefix: `push:${job.userId}:` })) {
      try {
        const result = await sendWebPush(sub, payload, vapid);
        if (result.gone) await this.storage.delete(key);
      } catch (error) {
        console.error("push send failed", error);
      }
    }
  }
}
