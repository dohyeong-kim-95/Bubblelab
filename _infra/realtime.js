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

const split = (p) => p.split("/").filter(Boolean);
const norm = (p) => split(p).join("/");

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
    if (v[".sv"] === "timestamp") return now;
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
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      try {
        this.handle(conn, msg);
      } catch (err) {
        if (msg.id) this.send(conn, { id: msg.id, ok: false, error: String(err) });
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
    path = norm(path);
    const now = Date.now();

    switch (op) {
      case "get":
        this.send(conn, { id, ok: true, value: getAt(this.tree, path) });
        return;

      case "set": {
        setAt(this.tree, path, resolveSentinels(value ?? null, now));
        this.afterWrite([path]);
        break;
      }

      case "update": {
        const changed = [];
        for (const [rel, v] of Object.entries(value ?? {})) {
          const full = norm(path + "/" + rel);
          setAt(this.tree, full, resolveSentinels(v, now));
          changed.push(full);
        }
        this.afterWrite(changed);
        break;
      }

      case "sub":
        conn.subs.add(path);
        this.send(conn, { ev: "v", path, value: getAt(this.tree, path) });
        break;

      case "unsub":
        conn.subs.delete(path);
        break;

      case "ondisc":
        conn.disc.set(path, value ?? null);
        break;

      case "canceldisc":
        conn.disc.delete(path);
        break;

      default:
        this.send(conn, { id, ok: false, error: `unknown op: ${op}` });
        return;
    }
    if (id) this.send(conn, { id, ok: true });
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
