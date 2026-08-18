const NAME = "bl_life";
const VERSION = 1;
const STORES = ["meta", "envelopes", "outbox", "conflicts"];

export function openLifeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact(db, store, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const dbGet = (db, store, id) => transact(db, store, "readonly", (objectStore) => objectStore.get(id));
export const dbPut = (db, store, value) => transact(db, store, "readwrite", (objectStore) => objectStore.put(value));
export const dbDelete = (db, store, id) => transact(db, store, "readwrite", (objectStore) => objectStore.delete(id));
export const dbAll = (db, store) => transact(db, store, "readonly", (objectStore) => objectStore.getAll());

export function dbBulkPut(db, store, values) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const objectStore = tx.objectStore(store);
    for (const value of values) objectStore.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function dbQueueMutation(db, envelopes, mutation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["envelopes", "outbox"], "readwrite");
    const envelopeStore = tx.objectStore("envelopes");
    for (const envelope of envelopes) envelopeStore.put(envelope);
    tx.objectStore("outbox").put(mutation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("로컬 저장 트랜잭션이 취소됐습니다"));
  });
}

export async function lockLocal(db) {
  await dbDelete(db, "meta", "key");
}
