// Firebase 호환 어댑터.
// 기존 Firebase Realtime Database API의 서브셋(ref/get/set/update/remove/
// push/onValue/onDisconnect/serverTimestamp)을 그대로 내보내되, 백엔드는
// bubblelab 워커의 Durable Object(/_rt/avalon, WebSocket)를 사용한다.
// 이 모듈 밖의 게임 코드는 전혀 수정하지 않아도 된다.

const RT_NAME = 'avalon';

function wsUrl() {
  const host = import.meta.env?.VITE_RT_HOST || location.host;
  const proto = location.protocol === 'http:' ? 'ws' : 'wss';
  return `${proto}://${host}/_rt/${RT_NAME}`;
}

const norm = (p) => (p || '').split('/').filter(Boolean).join('/');

let ws = null;
let openPromise = null;
let nextId = 1;
const pending = new Map(); // id -> {resolve, reject}
const subs = new Map();    // path -> Set<callback>
const discs = new Map();   // path -> value (재연결 시 onDisconnect 재등록용)

function makeSnapshot(value) {
  return {
    val: () => (value === undefined ? null : value),
    exists: () => value !== null && value !== undefined,
  };
}

function handleMessage(msg) {
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) resolve(msg.value);
    else reject(new Error(msg.error || 'request failed'));
    return;
  }
  if (msg.ev === 'v') {
    const callbacks = subs.get(msg.path);
    if (callbacks) {
      for (const cb of [...callbacks]) cb(makeSnapshot(msg.value));
    }
  }
}

function sendRaw(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const sock = new WebSocket(wsUrl());
    let opened = false;

    sock.onopen = () => {
      opened = true;
      ws = sock;
      // 재연결 시 구독/onDisconnect 재등록 (서버가 현재 값을 다시 보내줌)
      for (const path of subs.keys()) sendRaw({ op: 'sub', path });
      for (const [path, value] of discs) sendRaw({ op: 'ondisc', path, value });
      resolve();
    };
    sock.onmessage = (e) => {
      try {
        handleMessage(JSON.parse(e.data));
      } catch { /* 무시 */ }
    };
    sock.onclose = () => {
      ws = null;
      openPromise = null;
      for (const { reject: rej } of pending.values()) {
        rej(new Error('connection closed'));
      }
      pending.clear();
      // 한 번이라도 연결됐었다면 자동 재연결
      if (opened) setTimeout(() => connect().catch(() => {}), 1000 + Math.random() * 1000);
    };
    sock.onerror = () => {
      if (!opened) reject(new Error('realtime server unreachable'));
    };
  });
  return openPromise;
}

async function request(msg) {
  await connect();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, ...msg }));
  });
}

// ---------- Firebase 호환 공개 API ----------

export const db = {}; // ref()의 첫 인자 자리만 지키는 더미

export async function initAuth() {
  await connect(); // 서버에 못 붙으면 기존처럼 에러 화면으로
  let uid = localStorage.getItem('avalon_uid');
  if (!uid) {
    uid = 'u_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    localStorage.setItem('avalon_uid', uid);
  }
  return uid;
}

export function ref(_db, path = '') {
  return { path: norm(path) };
}

export function serverTimestamp() {
  return { '.sv': 'timestamp' };
}

export async function get(r) {
  const value = await request({ op: 'get', path: r.path });
  return makeSnapshot(value);
}

export async function set(r, value) {
  await request({ op: 'set', path: r.path, value });
}

export async function update(r, values) {
  await request({ op: 'update', path: r.path, value: values });
}

export async function remove(r) {
  await request({ op: 'set', path: r.path, value: null });
}

let pushCount = 0;
export async function push(r, value) {
  // 시간순 정렬 가능한 유니크 키 (Firebase push id와 유사한 성질)
  const key = Date.now().toString(36) + '_' +
    (pushCount++).toString(36) + Math.random().toString(36).slice(2, 6);
  const childPath = `${r.path}/${key}`;
  await request({ op: 'set', path: childPath, value });
  return { path: childPath, key };
}

export function onValue(r, callback) {
  let callbacks = subs.get(r.path);
  if (!callbacks) {
    callbacks = new Set();
    subs.set(r.path, callbacks);
  }
  callbacks.add(callback);
  connect().then(() => sendRaw({ op: 'sub', path: r.path })).catch(() => {});

  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      subs.delete(r.path);
      sendRaw({ op: 'unsub', path: r.path });
    }
  };
}

export function onDisconnect(r) {
  return {
    set: async (value) => {
      discs.set(r.path, value);
      await request({ op: 'ondisc', path: r.path, value });
    },
    cancel: async () => {
      discs.delete(r.path);
      await request({ op: 'canceldisc', path: r.path });
    },
  };
}
