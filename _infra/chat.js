// 익명 채팅 로비 (Durable Object).
// util.bubblelab.dev/chat 전용 — 단일 로비 하나를 WebSocket으로 중계한다.
// 메시지는 어디에도 저장하지 않는다: 접속 중인 사람에게 브로드캐스트될 뿐이며
// DO storage에는 관리자 설정(최대 동시 접속 인원)만 남는다.
//
// 프로토콜 (JSON 텍스트 프레임):
//   서버 → 클라: { type: "welcome", id, nick, online: [{id,nick}], max }
//                { type: "chat", kind: "text"|"sticker", id, nick, text?|pack?,n?, at }
//                { type: "join"|"leave", id, nick, count }
//                { type: "nick", id, nick, prev, count }
//                { type: "full", max }        … 정원 초과, 이어서 close(4001)
//                { type: "error", error }
//   클라 → 서버: { type: "text", text }
//                { type: "sticker", pack, n }
//                { type: "nick", nick }
//
// 관리자 전용 내부 경로 (Worker의 /admin/api/chat 에서만 호출):
//   GET  /settings  → { maxConnections, online }
//   POST /settings  { maxConnections } → 저장 후 현재 설정 반환

export const CHAT_MAX_TEXT_LENGTH = 500;
export const CHAT_NICK_MAX_LENGTH = 16;
export const CHAT_DEFAULT_MAX_CONNECTIONS = 10;
const MAX_CONNECTIONS_FLOOR = 1;
const MAX_CONNECTIONS_CEIL = 100;
const MAX_MESSAGE_BYTES = 8 * 1024;
// 접속당 플러드 제한: 10초 창에 메시지·닉변경 합산 12건까지
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_LIMIT = 12;
// 유령 연결 정리: 30초마다 ping, 다음 ping까지 pong이 없으면 끊는다
// (모바일 브라우저가 백그라운드로 가며 소켓만 남기는 경우 최대 ~60초 안에 정리)
const PING_INTERVAL_MS = 30_000;

// 사용할 수 있는 스티커 팩과 장수. /_assets/sticker/<팩>/NN.png 와 1:1 대응.
// 클라이언트는 URL이 아니라 { pack, n } 참조만 보내고 서버가 여기서 검증한다.
export const CHAT_STICKER_PACKS = new Map([
  ["brown-horse", 16],
  ["golden-retriever", 16],
  ["pink-horse", 16],
  ["simple-horse", 16],
]);

// 제어문자·양방향 제어·폭 없는 문자 제거. 본문(TEXT_STRIP)은 줄바꿈(\n)만 남긴다.
const NICK_STRIP = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;
const TEXT_STRIP = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;

// 닉네임 정리: 제어문자 제거, 공백 축약, 길이 제한. 부적합하면 null.
export function sanitizeChatNick(raw) {
  if (typeof raw !== "string") return null;
  const nick = raw.replace(/\s+/g, " ").replace(NICK_STRIP, "").trim();
  if (!nick || nick.length > CHAT_NICK_MAX_LENGTH) return null;
  return nick;
}

// 클라이언트 채팅 프레임 검증. 통과하면 브로드캐스트용 페이로드, 실패하면 throw.
export function validateChatMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw new Error("invalid message");
  if (msg.type === "text") {
    if (typeof msg.text !== "string") throw new Error("invalid text");
    const text = msg.text.replace(TEXT_STRIP, "").trim();
    if (!text || text.length > CHAT_MAX_TEXT_LENGTH) throw new Error("invalid text");
    return { kind: "text", text };
  }
  if (msg.type === "sticker") {
    const count = CHAT_STICKER_PACKS.get(msg.pack);
    if (!count) throw new Error("unknown sticker pack");
    if (!Number.isInteger(msg.n) || msg.n < 1 || msg.n > count) throw new Error("invalid sticker");
    return { kind: "sticker", pack: msg.pack, n: msg.n };
  }
  throw new Error("unknown type");
}

// 관리자 설정값 검증. 정수 1–100만 허용, 그 외 null.
export function parseMaxConnections(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(n) || n < MAX_CONNECTIONS_FLOOR || n > MAX_CONNECTIONS_CEIL) return null;
  return n;
}

const NICK_HEADS = ["포근한", "신나는", "느긋한", "씩씩한", "수줍은", "명랑한", "졸린", "재빠른"];
const NICK_TAILS = ["갈색말", "골댕이", "핑크말", "심플말", "버블", "당근"];

function randomNick() {
  const head = NICK_HEADS[Math.floor(Math.random() * NICK_HEADS.length)];
  const tail = NICK_TAILS[Math.floor(Math.random() * NICK_TAILS.length)];
  return `${head} ${tail}${Math.floor(Math.random() * 90) + 10}`;
}

// 로비 안에서 겹치지 않는 랜덤 닉네임 (닉네임은 접속자 간 유일해야 한다)
export function uniqueNick(taken) {
  for (let i = 0; i < 30; i++) {
    const nick = randomNick();
    if (!taken.has(nick)) return nick;
  }
  return `버블${Math.floor(Math.random() * 9000) + 1000}`;
}

export class ChatDO {
  constructor(state) {
    this.state = state;
    this.conns = new Set();
    this.maxConnections = undefined;
  }

  async load() {
    if (this.maxConnections === undefined) {
      const stored = await this.state.storage.get("maxConnections");
      this.maxConnections = parseMaxConnections(stored) ?? CHAT_DEFAULT_MAX_CONNECTIONS;
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    await this.load();

    if (url.pathname === "/settings") return this.handleSettings(request);
    if (url.pathname === "/reset" && request.method === "POST") {
      for (const conn of [...this.conns]) {
        try { conn.ws.close(4003, "lobby reset"); } catch { /* 이미 닫힌 소켓 */ }
      }
      this.conns.clear();
      return Response.json({ maxConnections: this.maxConnections, online: 0 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket expected", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    // 정원 초과: 업그레이드 실패(브라우저에서 사유 확인 불가) 대신
    // 접속을 받아 사유를 알려주고 즉시 닫는다.
    if (this.conns.size >= this.maxConnections) {
      try {
        server.send(JSON.stringify({ type: "full", max: this.maxConnections }));
        server.close(4001, "room full");
      } catch { /* 이미 닫힌 소켓 */ }
      return new Response(null, { status: 101, webSocket: client });
    }

    // 저장해 둔 닉네임(?nick=)은 접속 시점에 바로 적용한다 — 재접속 때
    // "랜덤닉 입장 → 개명" 두 단계 브로드캐스트가 생기지 않게.
    // 부적합하거나 이미 쓰는 이름이면 조용히 랜덤 닉으로 대체한다.
    const taken = new Set([...this.conns].map((c) => c.nick));
    const requested = sanitizeChatNick(url.searchParams.get("nick") ?? "");
    const conn = {
      ws: server,
      id: crypto.randomUUID().slice(0, 8),
      nick: requested && !taken.has(requested) ? requested : uniqueNick(taken),
      stamps: [],
      alive: true,
    };
    this.conns.add(conn);
    // 주의: accept와 101 응답 반환 사이에 await를 두면 소켓 페어가 깨진다
    this.scheduleAlarm();

    this.send(conn, {
      type: "welcome",
      id: conn.id,
      nick: conn.nick,
      online: [...this.conns].map((c) => ({ id: c.id, nick: c.nick })),
      max: this.maxConnections,
    });
    this.broadcast({ type: "join", id: conn.id, nick: conn.nick, count: this.conns.size }, conn);

    server.addEventListener("message", (e) => {
      let msg;
      try {
        if (typeof e.data !== "string" ||
            new TextEncoder().encode(e.data).byteLength > MAX_MESSAGE_BYTES) {
          server.close(1009, "message too large");
          return;
        }
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handle(conn, msg);
    });
    const bye = () => this.onClose(conn);
    server.addEventListener("close", bye);
    server.addEventListener("error", bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSettings(request) {
    if (request.method === "GET") {
      return Response.json({ maxConnections: this.maxConnections, online: this.conns.size });
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const max = parseMaxConnections(body.maxConnections);
      if (max === null) {
        return Response.json({ error: "maxConnections must be an integer 1-100" }, { status: 400 });
      }
      this.maxConnections = max;
      await this.state.storage.put("maxConnections", max);
      // 이미 접속한 사람은 끊지 않는다 — 새 접속부터 적용.
      return Response.json({ maxConnections: this.maxConnections, online: this.conns.size });
    }
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }

  scheduleAlarm() {
    if (this.alarmScheduled) return;
    this.alarmScheduled = true;
    this.state.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
  }

  // 30초마다: 지난 ping에 pong이 없던 연결을 정리하고 나머지에 다시 ping
  async alarm() {
    this.alarmScheduled = false;
    for (const conn of [...this.conns]) {
      if (!conn.alive) {
        try { conn.ws.close(4002, "ping timeout"); } catch { /* 이미 닫힌 소켓 */ }
        this.onClose(conn);
        continue;
      }
      conn.alive = false;
      this.send(conn, { type: "ping" });
    }
    if (this.conns.size) this.scheduleAlarm();
  }

  handle(conn, msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

    if (msg.type === "pong") { // 생존 응답 — 플러드 카운트에 넣지 않는다
      conn.alive = true;
      return;
    }

    const now = Date.now();
    conn.stamps = conn.stamps.filter((t) => now - t < FLOOD_WINDOW_MS);
    if (conn.stamps.length >= FLOOD_LIMIT) {
      this.send(conn, { type: "error", error: "rate" });
      return;
    }

    if (msg.type === "nick") {
      const nick = sanitizeChatNick(msg.nick);
      if (!nick) {
        this.send(conn, { type: "error", error: "invalid nick" });
        return;
      }
      if (nick === conn.nick) return;
      // 닉네임은 접속자 간 유일 — 다른 브라우저가 같은 이름을 쓸 수 없다
      if ([...this.conns].some((c) => c !== conn && c.nick === nick)) {
        this.send(conn, { type: "error", error: "nick-taken" });
        return;
      }
      conn.stamps.push(now);
      const prev = conn.nick;
      conn.nick = nick;
      this.broadcast({ type: "nick", id: conn.id, nick, prev, count: this.conns.size });
      return;
    }

    let payload;
    try {
      payload = validateChatMessage(msg);
    } catch {
      this.send(conn, { type: "error", error: "invalid message" });
      return;
    }
    conn.stamps.push(now);
    this.broadcast({ type: "chat", ...payload, id: conn.id, nick: conn.nick, at: now });
  }

  send(conn, obj) {
    this.sendFrame(conn, JSON.stringify(obj));
  }

  // send가 던지면 그 연결은 끝난 것 — 그 자리에서 정리해 다음 브로드캐스트가
  // 죽은 소켓을 다시 건드리지 않게 한다.
  sendFrame(conn, frame) {
    try {
      conn.ws.send(frame);
    } catch {
      this.onClose(conn);
    }
  }

  broadcast(obj, except = null) {
    const frame = JSON.stringify(obj);
    for (const conn of [...this.conns]) {
      if (conn === except) continue;
      this.sendFrame(conn, frame);
    }
  }

  onClose(conn) {
    if (!this.conns.delete(conn)) return;
    this.broadcast({ type: "leave", id: conn.id, nick: conn.nick, count: this.conns.size });
  }
}
