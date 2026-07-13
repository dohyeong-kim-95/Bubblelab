const normalizePath = (path = "") => String(path).split("/").filter(Boolean).join("/");

function socketUrl(namespace, host) {
  const protocol = location.protocol === "http:" ? "ws" : "wss";
  return `${protocol}://${host || location.host}/_rt/${namespace}`;
}

export class RealtimeClient {
  constructor({ namespace, host = "" }) {
    if (!/^[a-z0-9-]{1,64}$/.test(namespace)) throw new Error("invalid realtime namespace");
    this.namespace = namespace;
    this.host = host;
    this.socket = null;
    this.connecting = null;
    this.closed = false;
    this.requestId = 1;
    this.pending = new Map();
    this.subscriptions = new Map();
    this.disconnectWrites = new Map();
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.closed = false;
    this.connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(socketUrl(this.namespace, this.host));
      let opened = false;
      ws.addEventListener("open", () => {
        opened = true;
        this.socket = ws;
        for (const path of this.subscriptions.keys()) this._send({ op: "sub", path });
        for (const [path, value] of this.disconnectWrites) this._send({ op: "ondisc", path, value });
        resolve();
      });
      ws.addEventListener("message", (event) => {
        try { this._handle(JSON.parse(event.data)); } catch (_) {}
      });
      ws.addEventListener("close", () => {
        if (this.socket === ws) this.socket = null;
        this.connecting = null;
        for (const { reject: fail } of this.pending.values()) fail(new Error("connection closed"));
        this.pending.clear();
        if (opened && !this.closed) setTimeout(() => this.connect().catch(() => {}), 800 + Math.random() * 900);
      });
      ws.addEventListener("error", () => {
        if (!opened) { this.connecting = null; reject(new Error("realtime server unreachable")); }
      });
    });
    return this.connecting;
  }

  close() {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
  }

  _send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  _handle(message) {
    if (message.id && this.pending.has(message.id)) {
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      message.ok ? request.resolve(message.value) : request.reject(new Error(message.error || "request failed"));
      return;
    }
    if (message.ev === "v") {
      const callbacks = this.subscriptions.get(normalizePath(message.path));
      if (callbacks) for (const callback of [...callbacks]) callback(message.value ?? null);
    }
  }

  async request(op, path = "", value) {
    await this.connect();
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, op, path: normalizePath(path), ...(value === undefined ? {} : { value }) }));
    });
  }

  get(path) { return this.request("get", path); }
  set(path, value) { return this.request("set", path, value); }
  update(path, values) { return this.request("update", path, values); }
  remove(path) { return this.set(path, null); }

  subscribe(path, callback) {
    path = normalizePath(path);
    let callbacks = this.subscriptions.get(path);
    if (!callbacks) { callbacks = new Set(); this.subscriptions.set(path, callbacks); }
    callbacks.add(callback);
    this.connect().then(() => this._send({ op: "sub", path })).catch(() => {});
    return () => {
      callbacks.delete(callback);
      if (!callbacks.size) {
        this.subscriptions.delete(path);
        this._send({ op: "unsub", path });
      }
    };
  }

  async onDisconnect(path, value) {
    path = normalizePath(path);
    this.disconnectWrites.set(path, value);
    await this.request("ondisc", path, value);
    return async () => {
      this.disconnectWrites.delete(path);
      await this.request("canceldisc", path);
    };
  }
}

export const serverTimestamp = () => ({ ".sv": "timestamp" });
export const createRealtimeClient = (options) => new RealtimeClient(options);
