// 약속(util/yaksok) — 여럿이 날짜를 잡는 방. 방 하나가 YaksokDO 인스턴스 하나다
// (idFromName(코드)). 방들은 서로 모르므로 싱글턴에 모을 이유가 없고, 방마다 만료
// 알람을 따로 건다.
//
// 로그인은 없다. 참여하면 기기에 토큰을 주고 서버는 그 SHA-256 만 가진다. 링크를 아는
// 사람은 방을 볼 수 있고(카톡방이 곧 입장 경계), 투표하려면 닉네임으로 참여한다.
//
// 방은 저절로 사라진다 — 약속을 확정하면 그날로부터 30일, 확정하지 않으면 후보 기간
// 끝에서 30일. 방장이 터트리면 즉시 지우고 "터진 방"이라는 표시만 7일 남긴다.
import {
  CODE_ALPHABET, CODE_RE, FULL, MAX_MEMBERS, NAME_MAX, NO, NONE, TITLE_MAX,
  addDays, candidatePeriod, cleanText, isValidDate, kstToday, naverMapUrl,
} from "../util/yaksok/logic.js";

const KEEP_DAYS = 30;
const TOMBSTONE_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
const PAGE_ORIGIN = "https://util.bubblelab.dev";

const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// 만료 시각: 확정일(또는 후보 기간 끝) 다음 날 KST 0시 + 30일.
function expiryFor(room) {
  const base = room.confirmed?.date ?? room.period.end;
  return Date.parse(`${addDays(base, 1 + KEEP_DAYS)}T00:00:00+09:00`);
}

export class YaksokDO {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const token = request.headers.get("X-Yaksok-Token") ?? "";
    const action = url.pathname.slice(1);
    if (action === "init") return this.init(body);

    const room = await this.storage.get("room");
    if (!room) {
      const popped = await this.storage.get("popped");
      return popped ? json({ error: "터트린 방이에요.", popped: true }, 410)
        : json({ error: "없는 방이에요." }, 404);
    }
    const me = token ? await this.member(room, token) : null;
    if (action === "state") return json(this.view(room, me));
    if (action === "join") return this.join(room, me, body);
    if (!me) return json({ error: "먼저 닉네임으로 참여해 주세요." }, 401);
    if (action === "vote") return this.vote(room, me, body);
    if (me.id !== room.hostId) return json({ error: "방장만 할 수 있어요." }, 403);
    if (action === "confirm") return this.confirm(room, me, body);
    if (action === "place") return this.place(room, me, body);
    if (action === "host") return this.handOver(room, me, body);
    if (action === "pop") return this.pop(room, body);
    return json({ error: "not found" }, 404);
  }

  async member(room, token) {
    const hash = await sha256(token);
    return room.members.find((m) => m.tokenHash === hash) ?? null;
  }

  view(room, me) {
    return {
      code: room.code,
      title: room.title,
      period: room.period,
      members: room.members.map((m) => ({
        id: m.id, name: m.name, host: m.id === room.hostId,
        responded: Object.keys(room.votes[m.id] ?? {}).length > 0,
      })),
      votes: room.votes,
      confirmed: room.confirmed,
      place: room.place,
      expiresAt: room.expiresAt,
      me: me ? { id: me.id, name: me.name, host: me.id === room.hostId } : null,
      max: MAX_MEMBERS,
    };
  }

  async save(room) {
    room.expiresAt = expiryFor(room);
    await this.storage.put("room", room);
    await this.storage.setAlarm(room.expiresAt);
  }

  async init(body) {
    if (await this.storage.get("room") || await this.storage.get("popped")) {
      return json({ error: "taken" }, 409);
    }
    const title = cleanText(body.title, TITLE_MAX);
    const name = cleanText(body.name, NAME_MAX);
    if (!title || !name || !CODE_RE.test(body.code ?? "")) {
      return json({ error: "약속 이름과 닉네임을 적어 주세요." }, 400);
    }
    const token = randomToken();
    const today = isValidDate(body.today) ? body.today : kstToday();
    const room = {
      code: body.code, title, createdAt: Date.now(), period: candidatePeriod(today),
      hostId: "m1", nextId: 2,
      members: [{ id: "m1", name, tokenHash: await sha256(token), joinedAt: Date.now() }],
      votes: {}, confirmed: null, place: null,
    };
    await this.save(room);
    return json({ code: room.code, token, state: this.view(room, room.members[0]) }, 201);
  }

  async join(room, me, body) {
    if (me) return json({ state: this.view(room, me) });
    const name = cleanText(body.name, NAME_MAX);
    if (!name) return json({ error: "닉네임을 적어 주세요." }, 400);
    if (room.members.length >= MAX_MEMBERS) {
      return json({ error: `이 방은 ${MAX_MEMBERS}명이 다 찼어요.` }, 409);
    }
    if (room.members.some((m) => m.name === name)) {
      return json({ error: "이미 있는 닉네임이에요. 다른 이름을 써 주세요." }, 409);
    }
    const token = randomToken();
    const member = { id: `m${room.nextId++}`, name, tokenHash: await sha256(token), joinedAt: Date.now() };
    room.members.push(member);
    await this.save(room);
    return json({ token, state: this.view(room, member) }, 201);
  }

  // 여러 날짜를 한 번에 받는다(화면이 연타를 모아 보낸다). 0 은 응답 지우기.
  async vote(room, me, body) {
    const changes = body.votes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      return json({ error: "votes 가 필요해요." }, 400);
    }
    const entries = Object.entries(changes);
    if (entries.length > 100) return json({ error: "한 번에 너무 많아요." }, 400);
    const mine = { ...(room.votes[me.id] ?? {}) };
    for (const [date, state] of entries) {
      if (!isValidDate(date) || date < room.period.start || date > room.period.end) {
        return json({ error: `후보 기간 밖의 날짜예요: ${date}` }, 400);
      }
      if (!Number.isInteger(state) || state < NONE || state > NO) {
        return json({ error: "응답 값이 올바르지 않아요." }, 400);
      }
      if (state === NONE) delete mine[date];
      else mine[date] = state;
    }
    if (Object.keys(mine).length) room.votes[me.id] = mine;
    else delete room.votes[me.id];
    await this.save(room);
    return json({ state: this.view(room, me) });
  }

  async confirm(room, me, body) {
    if (body.date === null) {
      room.confirmed = null;
    } else {
      if (!isValidDate(body.date) || body.date < room.period.start || body.date > room.period.end) {
        return json({ error: "후보 기간 안의 날짜를 골라 주세요." }, 400);
      }
      if (!["full", "lunch", "dinner"].includes(body.slot)) {
        return json({ error: "점심·저녁·전일 중에 골라 주세요." }, 400);
      }
      room.confirmed = { date: body.date, slot: body.slot, at: Date.now() };
    }
    await this.save(room);
    return json({ state: this.view(room, me) });
  }

  async place(room, me, body) {
    if (body.url === null) {
      room.place = null;
    } else {
      const url = naverMapUrl(body.url);
      if (!url) return json({ error: "네이버 지도 링크를 붙여 넣어 주세요 (naver.me/…)." }, 400);
      room.place = { name: cleanText(body.name, 40) ?? "약속 장소", url };
    }
    await this.save(room);
    return json({ state: this.view(room, me) });
  }

  async handOver(room, me, body) {
    const target = room.members.find((m) => m.id === body.memberId);
    if (!target) return json({ error: "없는 참여자예요." }, 400);
    room.hostId = target.id;
    await this.save(room);
    return json({ state: this.view(room, me) });
  }

  // 방 이름을 그대로 적어야 터진다 — 잘못 누른 한 번에 모두의 기록이 사라지지 않게.
  async pop(room, body) {
    if (cleanText(body.title, TITLE_MAX) !== room.title) {
      return json({ error: "방 이름을 똑같이 적어 주세요." }, 400);
    }
    await this.storage.deleteAll();
    await this.storage.put("popped", Date.now());
    await this.storage.setAlarm(Date.now() + TOMBSTONE_DAYS * DAY_MS);
    return json({ popped: true });
  }

  async alarm() {
    const room = await this.storage.get("room");
    // 확정일을 옮겨 만료가 뒤로 밀렸으면 아직 지우지 않는다.
    if (room && room.expiresAt > Date.now()) {
      await this.storage.setAlarm(room.expiresAt);
      return;
    }
    await this.storage.deleteAll();
  }
}

// ── 워커 쪽 ─────────────────────────────────────────────────────

const stubFor = (env, code) => env.YAKSOK.get(env.YAKSOK.idFromName(code));

function forward(env, code, action, request, body) {
  const headers = { "Content-Type": "application/json" };
  const token = request.headers.get("X-Yaksok-Token");
  if (token) headers["X-Yaksok-Token"] = token;
  return stubFor(env, code).fetch(`https://yaksok.internal/${action}`, {
    method: body === undefined ? "GET" : "POST", headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ACTIONS = new Set(["join", "vote", "confirm", "place", "host", "pop"]);

// /_yaksok/rooms            POST 방 만들기
// /_yaksok/rooms/<코드>      GET  방 상태
// /_yaksok/rooms/<코드>/<동작> POST 참여·투표·확정·장소·방장 넘기기·터트리기
export async function handleYaksokApi(request, env, path) {
  const segments = path.split("/").filter(Boolean).slice(1);   // ["rooms", code?, action?]
  if (segments[0] !== "rooms" || segments.length > 3) return json({ error: "not found" }, 404);
  const [, code, action] = segments;

  if (!code) {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    const body = await request.json().catch(() => ({}));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = randomCode();
      const response = await forward(env, candidate, "init", request, {
        code: candidate, title: body.title, name: body.name, today: kstToday(),
      });
      if (response.status !== 409) return response;
    }
    return json({ error: "잠시 후 다시 시도해 주세요." }, 503);
  }

  if (!CODE_RE.test(code)) return json({ error: "없는 방이에요." }, 404);
  if (!action) {
    if (request.method !== "GET") return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
    return forward(env, code, "state", request);
  }
  if (!ACTIONS.has(action)) return json({ error: "not found" }, 404);
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
  return forward(env, code, action, request, await request.json().catch(() => ({})));
}

// 카톡이 링크를 긁어 미리보기를 만든다 — 방 이름이 담긴 OG 태그를 페이지에 끼운다.
// 방 이름은 사람이 적은 글이라 반드시 이스케이프한다.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function ogTags(room, code) {
  const title = room ? `🫧 ${room.title}` : "🫧 약속 잡기";
  const description = room?.confirmed
    ? "약속이 잡혔어요. 눌러서 날짜와 장소를 확인하세요."
    : "되는 날짜를 톡톡 눌러 주세요. 모두 되는 날을 찾아 드려요.";
  const tags = {
    "og:type": "website",
    "og:site_name": "bubblelab 약속",
    "og:title": title,
    "og:description": description,
    "og:url": `${PAGE_ORIGIN}/yaksok/${code}`,
    "og:image": `${PAGE_ORIGIN}/yaksok/og.png`,
    "og:image:width": "1200",
    "og:image:height": "630",
  };
  return Object.entries(tags)
    .map(([key, value]) => `<meta property="${key}" content="${escapeHtml(value)}">`)
    .join("\n") + `\n<meta name="description" content="${escapeHtml(description)}">`;
}

export async function renderRoomPage(html, env, code) {
  let room = null;
  try {
    const response = await forward(env, code, "state", new Request("https://yaksok.internal/"));
    if (response.ok) room = await response.json();
  } catch { /* 미리보기는 방 이름이 없어도 뜬다 */ }
  return html.replace("<!--yaksok-og-->", ogTags(room, code));
}
