const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_RATE_LIMIT = 10_000;
const MIN_WINDOW_MS = 1_000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.bubblelab.dev",
    "media-src 'self' blob: https://*.bubblelab.dev",
    "font-src 'self' data:",
    "connect-src 'self' https://*.bubblelab.dev wss://*.bubblelab.dev",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "accelerometer=(), camera=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function featureEnabled(env, name) {
  return env?.[name] === "true";
}

export function validateMutationRequest(request, maxBytes = 64 * 1024) {
  if (SAFE_METHODS.has(request.method)) return null;

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((origin && origin !== url.origin) || fetchSite === "cross-site") {
    return Response.json({ error: "cross-origin request denied" }, { status: 403 });
  }

  const rawLength = request.headers.get("Content-Length");
  if (rawLength !== null) {
    const length = Number(rawLength);
    if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
      return Response.json({ error: "request body too large" }, { status: 413 });
    }
  }
  return null;
}

export function validateWebSocketOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: "websocket origin denied" }, { status: 403 });
  }
  return null;
}

export function requireJsonRequest(request) {
  const type = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  return type === "application/json"
    ? null
    : Response.json({ error: "application/json required" }, { status: 415 });
}

export function applySecurityHeaders(response, request) {
  // Cloudflare WebSocket upgrade responses cannot be reconstructed safely.
  if (response.status === 101) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rateLimitName(request, env, scope) {
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const secret = env.ADMIN_SESSION_SECRET || env.PLANNER_SESSION_SECRET || env.ADMIN_PASSWORD;
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${secret}\0bubblelab-rate-limit`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${scope}\0${address}`),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function consumeRateLimit(request, env, options) {
  const limit = Math.min(MAX_RATE_LIMIT, Math.max(1, Math.floor(options.limit)));
  const windowMs = Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, Math.floor(options.windowMs)));

  // Local unit tests may call handlers without bindings. Production deploys require
  // RATE_LIMITER and ADMIN_SESSION_SECRET in wrangler.jsonc, so this is fail-open
  // only in an explicitly incomplete local environment.
  if (!env.RATE_LIMITER) return { allowed: true, retryAfter: 0 };
  const name = await rateLimitName(request, env, options.scope);
  if (!name) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };

  const id = env.RATE_LIMITER.idFromName(name);
  const response = await env.RATE_LIMITER.get(id).fetch("https://rate-limit.internal/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit, windowMs }),
  });
  if (!response.ok) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
  return response.json();
}

export function rateLimitResponse(result) {
  return Response.json({ error: "too many requests" }, {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(Math.max(1, Math.ceil(result.retryAfter))),
    },
  });
}

export class RateLimiterDO {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/check") {
      return new Response("not found", { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const limit = Math.min(MAX_RATE_LIMIT, Math.max(1, Math.floor(Number(body.limit))));
    const windowMs = Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, Math.floor(Number(body.windowMs))));
    if (!Number.isFinite(limit) || !Number.isFinite(windowMs)) {
      return new Response("invalid limit", { status: 400 });
    }

    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const current = await this.state.storage.get("current");
    const count = current?.bucket === bucket ? Number(current.count) || 0 : 0;
    const resetAt = (bucket + 1) * windowMs;

    if (count >= limit) {
      return Response.json({
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      });
    }

    await this.state.storage.put("current", { bucket, count: count + 1 });
    if (typeof this.state.storage.setAlarm === "function") {
      await this.state.storage.setAlarm(resetAt + 60_000);
    }
    return Response.json({ allowed: true, retryAfter: 0 });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}
