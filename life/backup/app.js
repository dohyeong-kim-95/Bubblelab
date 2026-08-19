import { PREFIX, fileName, isOurs, makeEnvelope, parseEnvelope, summarize } from "./store.js";

const $ = (id) => document.getElementById(id);
const ask = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/* ── 모으기 ──────────────────────────────────────────────────────────────
 * 도구 목록을 묻지 않는다. bl_ 로 시작하는 것을 전부 담는다 — 도구를 지운 뒤에도
 * 그 도구가 남긴 기록은 여기 담긴다. */
function collectLocal() {
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

async function collectDatabases() {
  if (!indexedDB.databases) return [];   // 목록을 못 얻으면 localStorage 만이라도 담는다
  const found = await indexedDB.databases();
  const mine = found.filter((database) => isOurs(database.name));
  return Promise.all(mine.map(dumpDatabase));
}

/* ── 되돌리기 ─────────────────────────────────────────────────────────── */
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

async function restore(envelope) {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (isOurs(key)) localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(envelope.local)) localStorage.setItem(key, value);
  for (const spec of envelope.databases) await restoreDatabase(spec);
}

/* ── 화면 ──────────────────────────────────────────────────────────────── */
function renderList(target, envelope) {
  const items = summarize(envelope);
  target.replaceChildren(...items.map((item) => {
    const row = document.createElement("li");
    row.append(item.name.replace(PREFIX, ""));
    const meta = document.createElement("span");
    meta.className = "count";
    meta.textContent = item.count === null ? item.kind : `${item.kind} ${item.count}개`;
    row.append(meta);
    return row;
  }));
  return items.length;
}

async function refresh() {
  const envelope = makeEnvelope({ local: collectLocal(), databases: await collectDatabases() });
  const count = renderList($("current"), envelope);
  $("current-empty").hidden = count > 0;
  return envelope;
}

let pending = null;

$("export-button").addEventListener("click", async () => {
  $("status").textContent = "모으는 중…";
  try {
    const envelope = await refresh();
    const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName();
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    $("status").textContent = `${link.download} 로 내보냈습니다.`;
  } catch (error) { $("status").textContent = `내보내지 못했습니다: ${error.message}`; }
});

$("import-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    pending = parseEnvelope(await file.text());
    renderList($("incoming"), pending);
    $("incoming-when").textContent = pending.exportedAt
      ? `${new Date(pending.exportedAt).toLocaleString("ko-KR")} 에 내보낸 파일` : "";
    $("confirm").showModal();
  } catch (error) { $("status").textContent = `읽지 못했습니다: ${error.message}`; }
});

$("confirm-cancel").addEventListener("click", () => { pending = null; $("confirm").close(); });
$("confirm-ok").addEventListener("click", async () => {
  if (!pending) return;
  $("confirm").close();
  $("status").textContent = "되돌리는 중…";
  try {
    await restore(pending);
    pending = null;
    await refresh();
    $("status").textContent = "가져왔습니다. 각 화면을 다시 열면 반영됩니다.";
  } catch (error) { $("status").textContent = `가져오지 못했습니다: ${error.message}`; }
});

refresh().catch(() => { $("current-empty").hidden = false; });
