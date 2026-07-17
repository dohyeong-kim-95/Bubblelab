// 범용 실시간 데이터 서버 (Durable Object).
// Firebase Realtime Database의 서브셋을 WebSocket 위에 구현한다:
// 경로 기반 JSON 트리 + get/set/update/구독 + 접속종료 시 쓰기(onDisconnect).
// /_rt/<이름> 으로 접속하면 이름당 하나의 독립된 트리를 갖는다 (예: /_rt/avalon).
//
// 프로토콜 (JSON 텍스트 프레임):
//   클라 → 서버: { id?, op, path, value? }
//     op: get | set | update | sub | unsub | ondisc | canceldisc
//     (update의 value는 { 상대경로: 값 } 맵, 값 null = 삭제)
//   서버 → 클라: { id, ok, value?, error? }  … 요청 응답
//                { ev: "v", path, value }     … 구독 경로 변경 알림
// 값 안의 { ".sv": "timestamp" } 는 서버 시각(ms)으로 치환된다.

const MAX_PATH_LENGTH = 512;
const MAX_PATH_SEGMENTS = 16;
const MAX_VALUE_DEPTH = 20;
const MAX_VALUE_NODES = 5_000;
const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_SUBSCRIPTIONS = 32;
const MAX_ON_DISCONNECT = 32;
const MAX_UPDATE_ENTRIES = 64;
const MAX_CONNECTIONS = 100;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;
const POISON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const split = (path) => {
  if (typeof path !== "string" || path.length > MAX_PATH_LENGTH) {
    throw new Error("invalid path");
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.length > MAX_PATH_SEGMENTS || parts.some((part) =>
    !SAFE_SEGMENT.test(part) || POISON_KEYS.has(part))) {
    throw new Error("invalid path");
  }
  return parts;
};

export const normalizeRealtimePath = (path) => split(path).join("/");

export function validateRealtimeValue(value) {
  let nodes = 0;
  const visit = (current, depth) => {
    nodes += 1;
    if (nodes > MAX_VALUE_NODES || depth > MAX_VALUE_DEPTH) {
      throw new Error("value too complex");
    }
    if (current === null || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error("invalid number");
      return;
    }
    if (typeof current === "string") {
      if (current.length > 8_192) throw new Error("string too long");
      return;
    }
    if (typeof current !== "object") throw new Error("invalid value");
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype &&
        Object.getPrototypeOf(current) !== null) {
      throw new Error("invalid object");
    }
    const entries = Object.entries(current);
    if (entries.length > 1_000) throw new Error("object too large");
    for (const [key, child] of entries) {
      if (!key || key.length > 128 || POISON_KEYS.has(key)) throw new Error("invalid key");
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return value;
}

function getAt(tree, path) {
  let node = tree;
  for (const k of split(path)) {
    if (node === null || typeof node !== "object") return null;
    node = node[k];
    if (node === undefined) return null;
  }
  return node === undefined ? null : node;
}

function resolveSentinels(v, now) {
  if (v && typeof v === "object") {
    if (v[".sv"] === "timestamp" && Object.keys(v).length === 1) return now;
    const out = Array.isArray(v) ? [] : {};
    for (const k of Object.keys(v)) out[k] = resolveSentinels(v[k], now);
    return out;
  }
  return v;
}

const isEmptyObj = (v) =>
  v !== null && typeof v === "object" && Object.keys(v).length === 0;

// path에 value를 기록한다 (null = 삭제). Firebase처럼 빈 부모 가지는 정리한다.
function setAt(tree, path, value) {
  const keys = split(path);
  if (keys.length === 0) {
    for (const k of Object.keys(tree)) delete tree[k];
    if (value && typeof value === "object") Object.assign(tree, value);
    return;
  }
  const parents = [tree];
  let node = tree;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (node[k] === null || typeof node[k] !== "object") node[k] = {};
    node = node[k];
    parents.push(node);
  }
  const last = keys[keys.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  // 빈 객체가 된 조상 정리
  for (let i = parents.length - 1; i > 0; i--) {
    if (isEmptyObj(parents[i])) delete parents[i - 1][keys[i - 1]];
    else break;
  }
}

// 구독 경로 a와 변경 경로 b가 서로 영향을 주는가 (조상/자손/동일)
function related(a, b) {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/") || a === "" || b === "";
}

export class RealtimeDO {
  constructor(state) {
    this.state = state;
    this.conns = new Set();
    this.tree = undefined;
  }

  async load() {
    if (this.tree === undefined) {
      this.tree = (await this.state.storage.get("tree")) ?? {};
    }
  }

  save() {
    this.state.storage.put("tree", this.tree);
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket expected", { status: 426 });
    }
    if (this.conns.size >= MAX_CONNECTIONS) {
      return new Response("too many connections", { status: 503 });
    }
    await this.load();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const conn = { ws: server, subs: new Set(), disc: new Map() };
    this.conns.add(conn);

    server.addEventListener("message", (e) => {
      let msg;
      try {
        if (typeof e.data !== "string" ||
            new TextEncoder().encode(e.data).byteLength > MAX_MESSAGE_BYTES) {
          server.close(1009, "message too large");
          return;
        }
        msg = JSON.parse(e.data);
        if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw new Error("invalid message");
        if (msg.id !== undefined &&
            !((typeof msg.id === "number" && Number.isSafeInteger(msg.id)) ||
              (typeof msg.id === "string" && msg.id.length <= 64))) {
          throw new Error("invalid id");
        }
      } catch {
        return;
      }
      try {
        this.handle(conn, msg);
      } catch {
        if (msg.id !== undefined) this.send(conn, { id: msg.id, ok: false, error: "invalid request" });
      }
    });
    const bye = () => this.onClose(conn);
    server.addEventListener("close", bye);
    server.addEventListener("error", bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  send(conn, obj) {
    try {
      conn.ws.send(JSON.stringify(obj));
    } catch {
      /* 이미 닫힌 소켓 */
    }
  }

  handle(conn, { id, op, path = "", value }) {
    path = normalizeRealtimePath(path);
    const now = Date.now();

    switch (op) {
      case "get":
        this.send(conn, { id, ok: true, value: getAt(this.tree, path) });
        return;

      case "set": {
        validateRealtimeValue(value ?? null);
        setAt(this.tree, path, resolveSentinels(value ?? null, now));
        this.afterWrite([path]);
        break;
      }

      case "update": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("invalid update");
        }
        const entries = Object.entries(value);
        if (entries.length > MAX_UPDATE_ENTRIES) throw new Error("update too large");
        validateRealtimeValue(value);
        const changed = [];
        for (const [rel, v] of entries) {
          const full = normalizeRealtimePath(path + "/" + rel);
          setAt(this.tree, full, resolveSentinels(v, now));
          changed.push(full);
        }
        this.afterWrite(changed);
        break;
      }

      case "sub":
        if (!conn.subs.has(path) && conn.subs.size >= MAX_SUBSCRIPTIONS) {
          throw new Error("too many subscriptions");
        }
        conn.subs.add(path);
        this.send(conn, { ev: "v", path, value: getAt(this.tree, path) });
        break;

      case "unsub":
        conn.subs.delete(path);
        break;

      case "ondisc":
        validateRealtimeValue(value ?? null);
        if (!conn.disc.has(path) && conn.disc.size >= MAX_ON_DISCONNECT) {
          throw new Error("too many on-disconnect writes");
        }
        conn.disc.set(path, value ?? null);
        break;

      case "canceldisc":
        conn.disc.delete(path);
        break;

      default:
        this.send(conn, { id, ok: false, error: "unknown operation" });
        return;
    }
    if (id !== undefined) this.send(conn, { id, ok: true });
  }

  afterWrite(changedPaths) {
    this.save();
    for (const conn of this.conns) {
      const notified = new Set();
      for (const sub of conn.subs) {
        if (notified.has(sub)) continue;
        if (changedPaths.some((c) => related(sub, c))) {
          notified.add(sub);
          this.send(conn, { ev: "v", path: sub, value: getAt(this.tree, sub) });
        }
      }
    }
  }

  onClose(conn) {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    const changed = [];
    const now = Date.now();
    for (const [path, value] of conn.disc) {
      setAt(this.tree, path, resolveSentinels(value, now));
      changed.push(path);
    }
    if (changed.length) this.afterWrite(changed);
  }
}
