import { createSentinel, decryptEnvelope, deriveKey, encodeBase64Url, randomSalt, verifySentinel } from "./crypto.js";
import { dbAll, dbDelete, dbGet, dbPut, lockLocal, openLifeDb } from "./db.js";
import { TITLE_MAX, actionsOn, carriedOver, conflictCopy, kstDate, makeAction, planImport, validateEntity } from "./model.js";
import { fromServerEnvelope, lifeBase, lifeFetch, queueEntities, queueEntity, readLocal, syncNow } from "./sync.js";

const $ = (id) => document.getElementById(id);
const state = { db: null, key: null, entities: [], bootstrap: null, setup: false, view: "today", leaving: false };

function setText(id, value) { $(id).textContent = value; }
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function entityById(id) { return state.entities.find((item) => item.id === id); }
function formatDate(value) { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(value); }
function formatDay(value) { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date(`${value}T12:00:00+09:00`)); }
function formatTimestamp(value) { return value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—"; }

let notifyTimer = null;
function notify(message) {
  setText("toast", message);
  $("toast").hidden = !message;
  clearTimeout(notifyTimer);
  if (message) notifyTimer = setTimeout(() => { $("toast").hidden = true; }, 4000);
}

/* 목록에서 부르는 저장은 전부 이곳을 지난다 — 실패를 조용히 삼키지 않고
 * 화면에 남긴다(예전에 저장 실패가 unhandled rejection 으로만 남은 적이 있다). */
async function guard(action) {
  try { await action(); } catch (error) { notify(error?.message || "저장하지 못했습니다."); }
}

async function refreshLocal() {
  const local = await readLocal(state.db, state.key);
  state.entities = local.entities;
  render();
  await renderSettingsCounts();
  await renderConflicts();
}

async function saveEntity(entity) {
  const errors = validateEntity(entity);
  if (errors.length) throw new Error(errors[0]);
  await queueEntity(state.db, state.key, entity);
  await refreshLocal();
  void synchronize();
}

function actionRow(action, { carried = false } = {}) {
  const row = node("li", `action-row${action.status === "done" ? " completed" : ""}`);
  const complete = node("button", "complete-button", action.status === "done" ? "●" : "○");
  complete.type = "button";
  complete.setAttribute("aria-label", action.status === "done" ? `${action.title} 완료 취소` : `${action.title} 완료`);
  complete.addEventListener("click", () => guard(() => toggleAction(action)));
  row.append(complete, node("span", "action-title", action.title));

  const controls = node("div", "row-actions");
  if (carried) {
    const move = node("button", "", "오늘로");
    move.type = "button";
    move.setAttribute("aria-label", `${action.title} 오늘로 옮기기`);
    move.addEventListener("click", () => guard(() => moveToToday(action)));
    controls.append(node("span", "day-badge", formatDay(action.date)), move);
  }
  const edit = node("button", "", "수정");
  edit.type = "button";
  edit.addEventListener("click", () => openEditor(action.id));
  const remove = node("button", "", "삭제");
  remove.type = "button";
  remove.addEventListener("click", () => openDelete(action.id));
  controls.append(edit, remove);
  row.append(controls);
  return row;
}

function renderToday() {
  const today = kstDate();
  const actions = actionsOn(state.entities, today);
  const list = $("today-actions");
  list.replaceChildren(...actions.map((action) => actionRow(action)));
  setText("today-count", actions.length ? `${actions.filter((item) => item.status === "done").length}/${actions.length}` : "");
  $("today-empty").hidden = actions.length > 0;

  const carried = carriedOver(state.entities, today);
  $("carried-section").hidden = carried.length === 0;
  setText("carried-count", carried.length ? `${carried.length}건` : "");
  $("carried-actions").replaceChildren(...carried.map((action) => actionRow(action, { carried: true })));
}

function render() {
  setText("date-label", formatDate(new Date()));
  renderToday();
}

async function toggleAction(action) {
  const done = action.status !== "done";
  const now = new Date().toISOString();
  await saveEntity({ ...action, status: done ? "done" : "active", completedAt: done ? now : null, updatedAt: now });
}

async function moveToToday(action) {
  await saveEntity({ ...action, date: kstDate(), updatedAt: new Date().toISOString() });
}

function openEditor(entityId = "") {
  const existing = entityId ? entityById(entityId) : null;
  $("editor-id").value = existing?.id || "";
  $("editor-title-input").value = existing?.title || "";
  $("editor-date").value = existing?.date || kstDate();
  setText("editor-title", existing ? "할 일 수정" : "할 일 추가");
  setText("editor-error", "");
  $("editor-dialog").showModal();
  $("editor-title-input").focus();
}

async function submitEditor(event) {
  event.preventDefault();
  const existing = entityById($("editor-id").value);
  try {
    const title = $("editor-title-input").value.trim();
    const date = $("editor-date").value;
    if (!title) throw new Error("할 일을 적어주세요.");
    const entity = existing
      ? { ...existing, title, date, updatedAt: new Date().toISOString() }
      : makeAction({ title, date });
    await saveEntity(entity);
    $("editor-dialog").close();
  } catch (error) { setText("editor-error", error.message); }
}

function openDelete(id) {
  const entity = entityById(id);
  if (!entity) return;
  $("delete-id").value = id;
  setText("delete-copy", `“${entity.title}”을 삭제합니다.`);
  $("delete-dialog").showModal();
}

async function submitDelete(event) {
  event.preventDefault();
  const entity = entityById($("delete-id").value);
  $("delete-dialog").close();
  if (!entity) return;
  const now = new Date().toISOString();
  await guard(() => saveEntity({ ...entity, deletedAt: now, updatedAt: now }));
}

async function quickAdd(event) {
  event.preventDefault();
  const title = $("quick-title").value.trim();
  if (!title) return;
  $("quick-title").value = "";
  await guard(() => saveEntity(makeAction({ title })));
}

function showApp() {
  $("boot").hidden = true;
  $("unlock").hidden = true;
  $("app").hidden = false;
  switchView(new URLSearchParams(location.search).get("view") || "today", false);
}

function showUnlock(setup = false) {
  state.setup = setup;
  $("boot").hidden = true;
  $("app").hidden = true;
  $("unlock").hidden = false;
  $("passphrase-confirm").hidden = !setup;
  $("confirm-label").hidden = !setup;
  $("passphrase-confirm").required = setup;
  setText("unlock-title", setup ? "할 일 기록 시작하기" : "할 일 기록 열기");
  setText("unlock-copy", setup ? "서버도 읽지 못하는 암호 키를 이 기기에서 만듭니다." : "이 기기에서 기록을 복호화할 패스프레이즈를 입력하세요.");
  $("passphrase").focus();
}

async function handleUnlock(event) {
  event.preventDefault();
  setText("unlock-error", "");
  const passphrase = $("passphrase").value;
  if (state.setup && passphrase !== $("passphrase-confirm").value) { setText("unlock-error", "두 패스프레이즈가 다릅니다."); return; }
  try {
    if (state.setup) {
      const saltBytes = randomSalt();
      const salt = encodeBase64Url(saltBytes);
      const key = await deriveKey(passphrase, saltBytes);
      const sentinel = await createSentinel(key);
      const response = await lifeFetch("bootstrap", { method: "POST", body: JSON.stringify({ salt, sentinel }) });
      if (!response.ok) throw new Error(`초기화 실패 (${response.status})`);
      state.bootstrap = { initialized: true, salt, sentinel, head: 0 };
      await dbPut(state.db, "meta", { id: "bootstrap", value: state.bootstrap });
      state.key = key;
    } else {
      const key = await deriveKey(passphrase, state.bootstrap.salt);
      if (!await verifySentinel(key, state.bootstrap.sentinel)) throw new Error("패스프레이즈가 올바르지 않습니다.");
      state.key = key;
    }
    await dbPut(state.db, "meta", { id: "key", value: state.key });
    await refreshLocal();
    showApp();
    void synchronize();
  } catch (error) { setText("unlock-error", error.message || "기록을 열 수 없습니다."); }
}

async function initialize() {
  state.db = await openLifeDb();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const [keyRecord, bootstrapRecord, logoutRecord] = await Promise.all([
    dbGet(state.db, "meta", "key"), dbGet(state.db, "meta", "bootstrap"), dbGet(state.db, "meta", "logoutPending"),
  ]);
  const savedKey = keyRecord?.value || null;
  state.bootstrap = bootstrapRecord?.value || null;
  if (logoutRecord?.value) {
    await lockLocal(state.db);
    scrubDecryptedState();
    if (navigator.onLine && await finishPendingLogout()) { location.reload(); return; }
    showUnlock(false);
    setText("unlock-error", "서버 로그아웃 대기 중입니다. 온라인이 되면 자동으로 마칩니다.");
    return;
  }
  if (savedKey) {
    state.key = savedKey;
    await refreshLocal();
    showApp();
  } else {
    if (!navigator.onLine && state.bootstrap?.initialized) {
      showUnlock(false);
      return;
    }
    try {
      const response = await lifeFetch("bootstrap");
      if (!response.ok) throw new Error(`서버 연결 실패 (${response.status})`);
      state.bootstrap = await response.json();
      await dbPut(state.db, "meta", { id: "bootstrap", value: state.bootstrap });
      showUnlock(!state.bootstrap.initialized);
    } catch (error) {
      setText("boot", navigator.onLine ? error.message : "오프라인입니다. 이 기기에 열린 키가 없어 기록을 열 수 없습니다.");
    }
  }
  if (state.key) void synchronize();
}

async function synchronize() {
  if (!navigator.onLine || !state.key) { setText("sync-state", "오프라인 · 로컬"); return; }
  setText("sync-state", "동기화 중");
  $("sync-state").classList.remove("error");
  try {
    await syncNow(state.db, state.key);
    await refreshLocal();
    setText("sync-state", "동기화됨");
    await loadServerStatus();
  } catch (error) {
    setText("sync-state", navigator.onLine ? error.message : "오프라인 · 로컬");
    $("sync-state").classList.add("error");
  }
}

async function lock() {
  scrubDecryptedState();
  state.key = null;
  state.entities = [];
  await lockLocal(state.db);
  showUnlock(false);
}

async function logout() {
  await lock();
  await dbPut(state.db, "meta", { id: "logoutPending", value: true });
  if (navigator.onLine && await finishPendingLogout()) { location.reload(); return; }
  setText("unlock-error", "로컬 잠금 완료 · 온라인 복귀 시 서버 로그아웃을 마칩니다.");
}

function scrubDecryptedState() {
  state.entities = [];
  for (const id of ["today-actions", "carried-actions", "conflict-list"]) $(id)?.replaceChildren();
  for (const input of document.querySelectorAll("input:not([type=hidden]), textarea")) input.value = "";
  for (const id of ["sink-token-output", "import-result", "delete-copy", "toast"]) setText(id, "");
  $("sink-token-output").hidden = true;
  $("toast").hidden = true;
  $("editor-dialog").close();
  $("delete-dialog").close();
}

async function finishPendingLogout() {
  try {
    const response = await fetch(`${lifeBase()}/logout`, { method: "POST", credentials: "same-origin" });
    if (!response.ok && response.status !== 401) return false;
    await dbDelete(state.db, "meta", "logoutPending");
    return true;
  } catch { return false; }
}

/* 서버 세션이 만료되면 게이트의 로그인 화면으로 보낸다. 이 기기의 암호 키는
 * 그대로 두므로 로그인 뒤 패스프레이즈를 다시 묻지 않는다. */
function handleUnauthorized() {
  if (state.leaving) return;
  state.leaving = true;
  location.href = `${lifeBase()}/login`;
}

function switchView(view, updateUrl = true) {
  if (!["today", "settings"].includes(view)) view = "today";
  state.view = view;
  document.querySelectorAll(".view").forEach((element) => { element.hidden = element.dataset.view !== view; });
  document.querySelectorAll("[data-view-target]").forEach((button) => button.setAttribute("aria-current", button.dataset.viewTarget === view ? "page" : "false"));
  setText("view-title", view === "today" ? "오늘" : "설정");
  $("quick-add").hidden = view !== "today";
  if (updateUrl) history.replaceState(null, "", `?view=${view}`);
}

async function renderSettingsCounts() {
  const [outbox, conflicts, lastSync] = await Promise.all([dbAll(state.db, "outbox"), dbAll(state.db, "conflicts"), dbGet(state.db, "meta", "lastSync")]);
  setText("outbox-count", `${outbox.length}건`);
  setText("conflict-count", `${conflicts.length}건`);
  setText("last-sync", formatTimestamp(lastSync?.value));
}

async function conflictDrafts(conflict) {
  const drafts = [];
  for (const frame of conflict.mutation.frames || []) {
    try { drafts.push(await decryptEnvelope(state.key, frame)); } catch { /* retain opaque conflict */ }
  }
  return drafts;
}

async function renderConflicts() {
  const container = $("conflict-list");
  container.replaceChildren();
  if (!state.key) return;
  const conflicts = await dbAll(state.db, "conflicts");
  for (const conflict of conflicts) {
    const item = node("section", "conflict-item");
    const drafts = await conflictDrafts(conflict);
    item.append(node("p", "", drafts.length ? drafts.map((draft) => draft.title).join(", ") : "복호화할 수 없는 로컬 수정"));
    const actions = node("div", "row-actions");
    const remote = node("button", "", "서버 최신본 유지");
    remote.type = "button";
    remote.addEventListener("click", () => guard(() => resolveConflictRemote(conflict)));
    const local = node("button", "", "내 수정 복사본 만들기");
    local.type = "button";
    local.addEventListener("click", () => guard(() => resolveConflictLocal(conflict, drafts)));
    actions.append(remote, local);
    item.append(actions);
    container.append(item);
  }
}

/* 409 로 거절된 뮤테이션의 낙관적 로컬 쓰기를 되돌린다. 서버가 처음 보는
 * 항목이면 latest 가 null 로 오므로, 그때는 로컬 envelope 을 지워야 한다 —
 * 남겨 두면 서버가 모르는 rev 를 계속 들고 있어 그 항목만 영영 409 가 난다. */
async function applyRemoteConflict(conflict) {
  for (const record of conflict.remote || []) {
    const entityId = record.entityId || record.id;
    if (!entityId) continue;
    if (record.latest?.iv) {
      const envelope = fromServerEnvelope(record.latest);
      await dbPut(state.db, "envelopes", { id: envelope.entityId, ...envelope });
    } else {
      await dbDelete(state.db, "envelopes", entityId);
    }
  }
}

async function resolveConflictRemote(conflict) {
  await applyRemoteConflict(conflict);
  await dbDelete(state.db, "conflicts", conflict.id);
  await refreshLocal();
}

async function resolveConflictLocal(conflict, drafts) {
  await applyRemoteConflict(conflict);
  if (drafts.length) await queueEntities(state.db, state.key, drafts.map((draft) => conflictCopy(draft)));
  await dbDelete(state.db, "conflicts", conflict.id);
  await refreshLocal();
  void synchronize();
}

async function loadServerStatus() {
  try {
    const response = await lifeFetch("status");
    if (!response.ok) return;
    const status = await response.json();
    setText("server-head", String(status.head ?? "—"));
    setText("sink-head", String(status.sinkAckSeq ?? "—"));
    setText("sink-seen", formatTimestamp(status.sinkLastSeen));
  } catch { /* local UI remains usable */ }
}

function exportData() {
  const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), entities: state.entities };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `life-${kstDate()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.schemaVersion !== 1 || !Array.isArray(payload.entities)) throw new Error("지원하지 않는 내보내기 형식입니다");
    const planned = planImport(state.entities, payload.entities);
    // queueEntities 가 서버 프레임 한도에 맞춰 여러 뮤테이션으로 나눠 담는다.
    await queueEntities(state.db, state.key, planned.entities);
    await refreshLocal();
    setText("import-result", `${planned.entities.length}건을 가져왔습니다${planned.copies ? ` · 중복 ${planned.copies}건은 복사본으로 보존` : ""}.`);
    void synchronize();
  } catch (error) { setText("import-result", `가져오지 못했습니다: ${error.message}`); }
  event.target.value = "";
}

async function issueSinkToken() {
  setText("sink-token-output", "발급 중…");
  $("sink-token-output").hidden = false;
  try {
    const response = await lifeFetch("sink-token", { method: "POST", body: "{}" });
    if (!response.ok) throw new Error(`발급 실패 (${response.status})`);
    const result = await response.json();
    setText("sink-token-output", result.token || "응답에 토큰이 없습니다.");
  } catch (error) { setText("sink-token-output", error.message); }
}

document.addEventListener("DOMContentLoaded", () => {
  $("quick-title").maxLength = TITLE_MAX;
  $("unlock-form").addEventListener("submit", handleUnlock);
  $("quick-add").addEventListener("submit", quickAdd);
  $("editor-form").addEventListener("submit", submitEditor);
  $("editor-close").addEventListener("click", () => $("editor-dialog").close());
  $("editor-cancel").addEventListener("click", () => $("editor-dialog").close());
  $("delete-form").addEventListener("submit", submitDelete);
  $("delete-close").addEventListener("click", () => $("delete-dialog").close());
  $("delete-cancel").addEventListener("click", () => $("delete-dialog").close());
  $("lock-button").addEventListener("click", () => guard(lock));
  $("settings-lock").addEventListener("click", () => guard(lock));
  $("logout-button").addEventListener("click", () => guard(logout));
  $("export-button").addEventListener("click", exportData);
  $("import-input").addEventListener("change", importData);
  $("sink-token-button").addEventListener("click", issueSinkToken);
  $("empty-add").addEventListener("click", () => openEditor());
  document.querySelectorAll("[data-view-target]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewTarget)));
  addEventListener("online", () => void (async () => {
    const pending = (await dbGet(state.db, "meta", "logoutPending"))?.value;
    if (pending) {
      if (await finishPendingLogout()) location.reload();
      return;
    }
    await synchronize();
  })());
  addEventListener("offline", () => setText("sync-state", "오프라인 · 로컬"));
  addEventListener("life:unauthorized", handleUnauthorized);
  void initialize();
});
