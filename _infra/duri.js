// Duri — 두 사람의 대화·사진을 중계하고 버퍼링하는 Durable Object.
// work.bubblelab.dev/duri 전용. 단일 인스턴스("main") 하나가 로비처럼 동작한다.
//
// 설계 원칙: 서버는 평문도 키도 신원도 모른다.
//   - 클라이언트가 공유 패스프레이즈(PBKDF2→AES-GCM)로 E2E 암호화한 블롭만 오간다.
//   - 발신자 이름·시각은 블롭 "안"에 들어가므로 서버엔 { iv, ct } 불투명 값뿐이다.
//   - 서버 역할은 두 가지뿐: (1) 접속자에게 실시간 중계 (2) 데스크톱 싱크가
//     받아 ack 할 때까지 버퍼에 적재. ack 되면 버퍼·R2에서 폐기한다.
//   - 사진 원본(암호블롭)은 R2(DURI_BUCKET)에 임시 보관, 메시지엔 참조만.
//
// 인증은 Worker가 판정해 X-Duri-Role 헤더로 알려준다(peer|sink). DO는 이를 신뢰한다.
//   - peer: work 게이트를 통과한 브라우저. 메시지 전송·수신, 버퍼 폐기 권한 없음.
//   - sink: 싱크 토큰을 제시한 데스크톱 데몬. 전체 수신 + ack 로 버퍼를 폐기한다.
//
// 프로토콜 (JSON 텍스트 프레임):
//   클라 → 서버: { type:"hello", since? }          … 접속. since 이후 버퍼를 받는다
//                { type:"msg", iv, ct }             … E2E 암호화된 텍스트
//                { type:"ack", seq }                … (sink) seq 까지 디스크 보존 완료
//                { type:"pong" }
//   서버 → 클라: { type:"welcome", head, online }   … 현재 최신 seq + 접속 인원
//                { type:"entry", ... }              … 버퍼/실시간 항목(아래 참조)
//                { type:"backfill-done", head }
//                { type:"presence", online }
//                { type:"ping" } / { type:"error", error }
//
// entry(텍스트): { type:"entry", seq, kind:"msg", at, iv, ct }
// entry(사진)  : { type:"entry", seq, kind:"photo", at, r2key, imgIv, sha256, bytes, metaIv, metaCt }

export const DURI_MAX_TEXT_BLOB = 16 * 1024; // 암호화된 텍스트 base64 상한
export const DURI_MAX_PHOTO_BYTES = 96 * 1024 * 1024; // 암호화된 사진 원본 상한(원본 보존이 원칙)
export const DURI_MAX_META_BLOB = 4 * 1024; // 사진 메타(이름·캡션) 암호블롭 상한
const MAX_BUFFER_ENTRIES = 5000; // 싱크가 오래 꺼져 있을 때의 상한
export const DURI_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 미ack 항목 보존 30일
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_CONNECTIONS = 8; // 두 사람 × 기기 몇 + 싱크
const PING_INTERVAL_MS = 30_000;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_LIMIT = 30; // 사진 연속 전송 여지를 두고 채팅보다 넉넉히
const SEQ_KEY = "seq";
const ACK_KEY = "ackSeq";
const BUF_PREFIX = "buf:";

const bufKey = (seq) => BUF_PREFIX + String(seq).padStart(12, "0");

// base64(표준) 문자열인지 + 길이 상한 검사. iv/ct 같은 불투명 값에 쓴다.
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export function isBlob(value, maxLen) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLen && B64.test(value);
}

// 클라이언트 텍스트 메시지 프레임 검증. 통과하면 { iv, ct }, 실패하면 throw.
export function validateMsgFrame(msg) {
  if (!msg || typeof msg !== "object") throw new Error("invalid message");
  if (!isBlob(msg.iv, 64)) throw new Error("invalid iv");
  if (!isBlob(msg.ct, DURI_MAX_TEXT_BLOB)) throw new Error("invalid ct");
  return { iv: msg.iv, ct: msg.ct };
}

// 사진 업로드 헤더(암호블롭 메타) 검증. 통과하면 정규화된 메타, 실패하면 null.
export function validatePhotoMeta({ imgIv, sha256, metaIv, metaCt }) {
  if (!isBlob(imgIv, 64)) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (!isBlob(metaIv, 64)) return null;
  if (!isBlob(metaCt, DURI_MAX_META_BLOB)) return null;
  return { imgIv, sha256, metaIv, metaCt };
}

// 안전한 R2 키인지 (버퍼 항목이 참조하는 사진만 다운로드 허용)
const R2_KEY = /^photo\/[0-9]{12}-[A-Za-z0-9]{8,32}$/;
export const isPhotoKey = (key) => typeof key === "string" && R2_KEY.test(key);

export class DuriDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.conns = new Set();
    this.head = undefined; // 최신 seq
    this.ackSeq = undefined; // 싱크가 보존 완료한 seq
    this.alarmScheduled = false;
  }

  async load() {
    if (this.head === undefined) {
      this.head = (await this.state.storage.get(SEQ_KEY)) ?? 0;
      this.ackSeq = (await this.state.storage.get(ACK_KEY)) ?? 0;
    }
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const role = request.headers.get("X-Duri-Role") === "sink" ? "sink" : "peer";

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.handleSocket(request, role);
    }
    if (url.pathname.endsWith("/photo") && request.method === "POST") {
      return this.handlePhotoUpload(request);
    }
    const marker = "/photo/";
    const at = url.pathname.indexOf(marker);
    if (at !== -1 && request.method === "GET") {
      return this.handlePhotoDownload(url.pathname.slice(at + marker.length));
    }
    if (url.pathname.endsWith("/status") && request.method === "GET") {
      return Response.json({
        head: this.head, ackSeq: this.ackSeq, online: this.conns.size,
        pending: this.head - this.ackSeq,
      });
    }
    return new Response("not found", { status: 404 });
  }

  // ── WebSocket ────────────────────────────────────────────────
  handleSocket(request, role) {
    if (this.conns.size >= MAX_CONNECTIONS) {
      return new Response("too many connections", { status: 503 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    const conn = { ws: server, role, stamps: [], alive: true };
    this.conns.add(conn);
    this.scheduleAlarm();

    server.addEventListener("message", (e) => {
      if (typeof e.data !== "string" ||
          new TextEncoder().encode(e.data).byteLength > MAX_MESSAGE_BYTES) {
        try { server.close(1009, "message too large"); } catch { /* 닫힘 */ }
        return;
      }
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handle(conn, msg);
    });
    const bye = () => this.onClose(conn);
    server.addEventListener("close", bye);
    server.addEventListener("error", bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  handle(conn, msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

    if (msg.type === "pong") { conn.alive = true; return; }

    if (msg.type === "hello") {
      const since = Number.isInteger(msg.since) && msg.since >= 0 ? msg.since : this.head;
      this.send(conn, { type: "welcome", head: this.head, online: this.conns.size });
      this.broadcast({ type: "presence", online: this.conns.size }, conn);
      this.backfill(conn, since);
      return;
    }

    if (msg.type === "ack") {
      if (conn.role !== "sink") return; // 싱크만 버퍼를 폐기할 수 있다
      if (Number.isInteger(msg.seq)) this.state.blockConcurrencyWhile(() => this.prune(msg.seq));
      return;
    }

    // 플러드 제한 (ack/pong 제외)
    const now = Date.now();
    conn.stamps = conn.stamps.filter((t) => now - t < FLOOD_WINDOW_MS);
    if (conn.stamps.length >= FLOOD_LIMIT) {
      this.send(conn, { type: "error", error: "rate" });
      return;
    }

    if (msg.type === "msg") {
      let payload;
      try { payload = validateMsgFrame(msg); } catch {
        this.send(conn, { type: "error", error: "invalid message" });
        return;
      }
      conn.stamps.push(now);
      this.state.blockConcurrencyWhile(() =>
        this.append({ kind: "msg", at: now, iv: payload.iv, ct: payload.ct }));
    }
  }

  // ── 버퍼 적재/폐기 ───────────────────────────────────────────
  async append(entry) {
    const seq = this.head + 1;
    const full = { seq, ...entry };
    await this.state.storage.put(bufKey(seq), full);
    this.head = seq;
    await this.state.storage.put(SEQ_KEY, seq);
    await this.capBuffer();
    this.broadcast({ type: "entry", ...full });
    return full;
  }

  // 싱크가 seq 까지 보존 완료 → 그 이하 버퍼와 사진 R2 객체를 폐기한다.
  async prune(seq) {
    const upto = Math.min(seq, this.head);
    if (upto <= this.ackSeq) return;
    const entries = await this.state.storage.list({
      prefix: BUF_PREFIX, end: bufKey(upto + 1), limit: 1000,
    });
    const keys = [];
    for (const [key, value] of entries) {
      if (value.kind === "photo" && isPhotoKey(value.r2key)) {
        await this.env.DURI_BUCKET.delete(value.r2key).catch(() => {});
      }
      keys.push(key);
    }
    if (keys.length) await this.state.storage.delete(keys);
    this.ackSeq = upto;
    await this.state.storage.put(ACK_KEY, upto);
  }

  // 미ack 항목이 상한을 넘으면 오래된 것부터 버린다(PC가 오래 꺼진 경우의 손실 상한).
  async capBuffer() {
    const pending = this.head - this.ackSeq;
    const overflow = pending - MAX_BUFFER_ENTRIES;
    if (overflow <= 0) return;
    const entries = await this.state.storage.list({
      prefix: BUF_PREFIX, limit: overflow,
    });
    const keys = [];
    let last = this.ackSeq;
    for (const [key, value] of entries) {
      if (value.kind === "photo" && isPhotoKey(value.r2key)) {
        await this.env.DURI_BUCKET.delete(value.r2key).catch(() => {});
      }
      keys.push(key);
      last = value.seq;
    }
    if (keys.length) await this.state.storage.delete(keys);
    if (last > this.ackSeq) { this.ackSeq = last; await this.state.storage.put(ACK_KEY, last); }
  }

  async backfill(conn, since) {
    const start = bufKey(Math.max(since, this.ackSeq) + 1);
    const entries = await this.state.storage.list({ prefix: BUF_PREFIX, start, limit: 1000 });
    for (const [, value] of entries) this.send(conn, { type: "entry", ...value });
    this.send(conn, { type: "backfill-done", head: this.head });
  }

  // ── 사진 (R2 임시 버퍼) ──────────────────────────────────────
  async handlePhotoUpload(request) {
    if (!this.env.DURI_BUCKET) return new Response("storage unavailable", { status: 503 });
    const meta = validatePhotoMeta({
      imgIv: request.headers.get("X-Duri-Img-Iv"),
      sha256: request.headers.get("X-Duri-Sha256"),
      metaIv: request.headers.get("X-Duri-Meta-Iv"),
      metaCt: request.headers.get("X-Duri-Meta"),
    });
    if (!meta) return new Response("invalid photo metadata", { status: 400 });
    // 큰 업로드는 메모리에 담기 전에 Content-Length 로 먼저 거른다.
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > DURI_MAX_PHOTO_BYTES) {
      return new Response(`photo too large (${declared} bytes, max ${DURI_MAX_PHOTO_BYTES})`, { status: 413 });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return new Response("empty body", { status: 400 });
    if (body.byteLength > DURI_MAX_PHOTO_BYTES) {
      return new Response(`photo too large (${body.byteLength} bytes, max ${DURI_MAX_PHOTO_BYTES})`, { status: 413 });
    }
    const seq = this.head + 1;
    const rand = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const r2key = `photo/${String(seq).padStart(12, "0")}-${rand}`;
    await this.env.DURI_BUCKET.put(r2key, body, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const entry = await this.state.blockConcurrencyWhile(() => this.append({
      kind: "photo", at: Date.now(), r2key,
      imgIv: meta.imgIv, sha256: meta.sha256, bytes: body.byteLength,
      metaIv: meta.metaIv, metaCt: meta.metaCt,
    }));
    return Response.json({ seq: entry.seq, r2key }, { headers: { "Cache-Control": "no-store" } });
  }

  async handlePhotoDownload(key) {
    if (!isPhotoKey(key)) return new Response("invalid key", { status: 400 });
    if (!this.env.DURI_BUCKET) return new Response("storage unavailable", { status: 503 });
    const object = await this.env.DURI_BUCKET.get(key);
    if (!object) return new Response("not found", { status: 404 });
    return new Response(object.body, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  }

  // ── 연결 유지 / 정리 ─────────────────────────────────────────
  scheduleAlarm() {
    if (this.alarmScheduled) return;
    this.alarmScheduled = true;
    this.state.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
  }

  async alarm() {
    this.alarmScheduled = false;
    for (const conn of [...this.conns]) {
      if (!conn.alive) {
        try { conn.ws.close(4002, "ping timeout"); } catch { /* 닫힘 */ }
        this.onClose(conn);
        continue;
      }
      conn.alive = false;
      this.send(conn, { type: "ping" });
    }
    if (this.conns.size) this.scheduleAlarm();
  }

  send(conn, obj) {
    try { conn.ws.send(JSON.stringify(obj)); } catch { this.onClose(conn); }
  }

  broadcast(obj, except = null) {
    const frame = JSON.stringify(obj);
    for (const conn of [...this.conns]) {
      if (conn === except) continue;
      try { conn.ws.send(frame); } catch { this.onClose(conn); }
    }
  }

  onClose(conn) {
    if (!this.conns.delete(conn)) return;
    this.broadcast({ type: "presence", online: this.conns.size });
  }
}
