// 브라우저 저장소를 읽고 쓰는 쪽. 순수 계산은 store.js 에 있다.
import { isOurs, makeEnvelope } from "./store.js";

const ask = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export function collectLocal() {
  const local = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (isOurs(key)) local[key] = localStorage.getItem(key);
  }
  return local;
}

async function dumpDatabase({ name, version }) {
  const db = await ask(indexedDB.open(name, version));
  const stores = [];
  for (const storeName of [...db.objectStoreNames]) {
    const store = db.transaction(storeName, "readonly").objectStore(storeName);
    stores.push({
      name: storeName,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      keys: await ask(store.getAllKeys()),
      rows: await ask(store.getAll()),
    });
  }
  db.close();
  return { name, version: db.version, stores };
}

export async function collectDatabases() {
  if (!indexedDB.databases) return [];   // 목록을 못 얻으면 localStorage 만이라도 담는다
  const found = await indexedDB.databases();
  return Promise.all(found.filter((database) => isOurs(database.name)).map(dumpDatabase));
}

export async function collectAll() {
  return makeEnvelope({ local: collectLocal(), databases: await collectDatabases() });
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function restoreDatabase(spec) {
  await deleteDatabase(spec.name);
  const open = indexedDB.open(spec.name, spec.version || 1);
  open.onupgradeneeded = () => {
    for (const store of spec.stores) {
      open.result.createObjectStore(store.name, {
        keyPath: store.keyPath ?? undefined,
        autoIncrement: Boolean(store.autoIncrement),
      });
    }
  };
  const db = await ask(open);
  for (const store of spec.stores) {
    const rows = Array.isArray(store.rows) ? store.rows : [];
    const target = db.transaction(store.name, "readwrite").objectStore(store.name);
    // keyPath 가 없으면 키가 값 밖에 있다 — 함께 담아 둔 키로 되돌린다.
    rows.forEach((row, index) => {
      if (store.keyPath) target.put(row);
      else target.put(row, store.keys?.[index]);
    });
  }
  db.close();
}

export async function restoreAll(envelope) {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (isOurs(key)) localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(envelope.local)) localStorage.setItem(key, value);
  for (const spec of envelope.databases) await restoreDatabase(spec);
}
