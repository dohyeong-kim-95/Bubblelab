import {
  addEntry, cycleLabel, cycleOf, editEntry, emptyState, entriesIn, groupByDay, inCycle,
  kstDate, pace, parseState, removeEntry, setLimit, setStartDay, shiftDate, shortWon, won,
} from "./store.js";
import { parseBackupOrText, seenSigs } from "./sms.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "bl_budget_v1";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

let state = load();
// 보고 있는 주기는 이 날짜 하나로 정해진다 — 시작일이 바뀌어도 다시 계산될 뿐이다.
let anchor = kstDate();
let editing = null;
let pending = [];   // 문자에서 읽어 낸 것들 — 담기 전까지는 화면에만 있다

function load() {
  try { return parseState(localStorage.getItem(STORAGE_KEY)) ?? emptyState(); }
  catch { return emptyState(); }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* 저장 공간이 없으면 화면만 유지한다 */ }
}

function update(next) {
  state = next;
  save();
  render();
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

const short = (date) => {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
};
const weekday = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

/* ── 화면 ───────────────────────────────────────────────────────────
 * 합계보다 기준선이 먼저다. "남은 돈"이 제일 크고, 그 밑의 막대가 오늘까지의
 * 기준선과 견주어 어디쯤인지 보여 준다. */
function render() {
  const cycle = cycleOf(anchor, state.startDay);
  const today = kstDate();
  const now = pace(state, cycle, today);

  $("cycle-label").textContent = cycleLabel(cycle);
  $("cycle-range").textContent = [
    `${short(cycle.start)}–${short(cycle.end)}`,
    `한도 ${shortWon(state.limit)}`,
    now.finished ? "지난 주기" : now.started ? `${now.daysLeft}일 남음` : "아직 시작 전",
  ].join(" · ");
  // 앞으로는 오늘이 든 주기까지만 간다 — 그다음은 아직 아무 일도 일어나지 않았다.
  $("next-cycle").disabled = inCycle(cycle, today) || cycle.start > today;

  renderHero(now);
  renderEntries(cycle);
  syncDateInput(cycle, today);
}

function renderHero(now) {
  const over = now.remaining < 0;
  $("hero-label").textContent = over ? "한도 초과" : "남은 돈";
  $("remaining").textContent = won(Math.abs(now.remaining));
  $("remaining").classList.toggle("over", over);

  const gauge = $("gauge");
  gauge.className = `gauge ${now.status}${now.finished ? " done" : ""}`;
  $("fill").style.width = `${Math.min(Math.max(now.ratio, 0), 1) * 100}%`;
  $("mark").style.left = `${Math.min(Math.max(now.linePos, 0), 1) * 100}%`;
  $("gauge-note").textContent = now.finished
    ? `${now.days}일 마감 · 한도 ${shortWon(now.limit)}`
    : now.started
      ? `${now.days}일 중 ${now.dayIndex}일째 · 오늘까지 기준 ${shortWon(now.expected)}`
      : `${now.days}일 · 하루 기준 ${shortWon(Math.round(now.limit / now.days))}`;

  $("verdict").textContent = verdict(now);
  $("verdict").classList.toggle("over", now.status === "over");

  $("fact-spent").textContent = won(now.spent);
  $("fact-perday").textContent = now.perDay == null ? "—" : won(Math.max(now.perDay, 0));
  $("fact-projected").textContent = now.projected == null ? "—" : won(now.projected);
  $("fact-today").textContent = now.finished || !now.started ? "—" : won(now.today);
}

function verdict(now) {
  if (!now.started) return "아직 시작하지 않은 주기입니다.";
  if (now.finished) {
    return now.remaining < 0
      ? `한도를 ${won(-now.remaining)} 넘기고 끝난 주기입니다.`
      : `${won(now.remaining)} 남기고 끝난 주기입니다.`;
  }
  if (now.status === "over") {
    return `한도를 ${won(-now.remaining)} 넘겼어요. 남은 ${now.daysLeft}일은 안 쓰는 게 최선입니다.`;
  }
  const perDay = `남은 ${now.daysLeft}일 동안 하루 ${won(now.perDay)}씩 쓸 수 있어요.`;
  if (now.status === "ahead") return `오늘까지 기준보다 ${won(now.diff)} 앞서 썼어요. ${perDay}`;
  if (now.status === "under") return `오늘까지 기준보다 ${won(-now.diff)} 덜 썼어요. ${perDay}`;
  return `기준에 맞게 쓰고 있어요. ${perDay}`;
}

function renderEntries(cycle) {
  const days = groupByDay(entriesIn(state, cycle));
  $("empty").hidden = days.length > 0;
  $("entries").replaceChildren(...days.map((day) => {
    const section = node("div", "day");
    const head = node("div", "day-head");
    head.append(
      node("span", null, `${short(day.on)} (${weekday(day.on)})`),
      node("span", "day-total", won(day.total)),
    );
    section.append(head, ...day.items.map(entryRow));
    return section;
  }));
}

function entryRow(entry) {
  const row = node("button", "entry");
  row.type = "button";
  const memo = node("span", `entry-memo${entry.memo ? "" : " blank"}`, entry.memo || "메모 없음");
  const amount = node("span", `entry-amount${entry.amount < 0 ? " refund" : ""}`,
    entry.amount < 0 ? `+${won(-entry.amount)}` : won(entry.amount));
  row.append(memo, amount);
  row.addEventListener("click", () => openEditor(entry));
  return row;
}

/* 적는 날짜의 기본값. 지난 주기를 보고 있으면 그 주기 안으로 맞춰 준다 —
 * 8월을 보면서 7월 것을 적는 일은 없다. */
function syncDateInput(cycle, today) {
  const input = $("date");
  if (document.activeElement === input) return;
  input.value = inCycle(cycle, today) ? today : cycle.start > today ? cycle.start : cycle.end;
}

/* ── 적기 ───────────────────────────────────────────────────────── */
$("add").addEventListener("submit", (event) => {
  event.preventDefault();
  const on = $("date").value || kstDate();
  try {
    update(addEntry(state, { amount: $("amount").value, memo: $("memo").value, on }));
    $("add-error").textContent = "";
    $("amount").value = "";
    $("memo").value = "";
    // 보고 있는 주기 밖에 적었으면 그쪽으로 따라간다 — 적은 것이 안 보이면 두 번 적게 된다.
    if (!inCycle(cycleOf(anchor, state.startDay), on)) { anchor = on; render(); }
    $("amount").focus();
  } catch (error) {
    $("add-error").textContent = error.message;
  }
});

/* ── 주기 넘기기 ────────────────────────────────────────────────── */
$("prev-cycle").addEventListener("click", () => {
  anchor = shiftDate(cycleOf(anchor, state.startDay).start, -1);
  render();
});
$("next-cycle").addEventListener("click", () => {
  anchor = shiftDate(cycleOf(anchor, state.startDay).end, 1);
  render();
});

/* ── 고치기 ─────────────────────────────────────────────────────── */
function openEditor(entry) {
  editing = entry.id;
  $("editor-amount").value = String(entry.amount);
  $("editor-memo").value = entry.memo;
  $("editor-date").value = entry.on;
  $("editor-error").textContent = "";
  $("editor").showModal();
}

$("editor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    update(editEntry(state, editing, {
      amount: $("editor-amount").value,
      memo: $("editor-memo").value,
      on: $("editor-date").value,
    }));
    $("editor").close();
  } catch (error) {
    $("editor-error").textContent = error.message;
  }
});
$("editor-delete").addEventListener("click", () => {
  update(removeEntry(state, editing));
  $("editor").close();
});
$("editor-cancel").addEventListener("click", () => $("editor").close());
$("editor").addEventListener("close", () => { editing = null; });

/* ── 카드 문자에서 담기 ─────────────────────────────────────────
 * 브라우저는 문자를 읽을 수 없다. 문자가 여기 오는 길은 셋이고 파서는 하나다:
 * 공유 시트(manifest 의 share_target) · 붙여넣기 · 백업 파일. */
function openSms(text = "") {
  pending = [];
  $("sms-summary").textContent = "";
  $("sms-preview").replaceChildren();
  $("sms-save").disabled = true;
  if (!$("sms").open) $("sms").showModal();
  if (text.trim()) readSms(text);
}

function readSms(text, fileName = "") {
  const { found, failed, fromBackup, scanned, clipped, newestOn } = parseBackupOrText(text, kstDate());
  const seen = seenSigs(state);
  pending = found.map(({ entry }) => {
    // 같은 문자를 두 번 담지 않는다. 한 번에 붙여넣은 것 안에서 겹치는 것도 본다.
    const duplicate = seen.has(entry.sig);
    seen.add(entry.sig);
    return { entry, duplicate, take: !duplicate };
  });

  const fresh = pending.filter((row) => !row.duplicate).length;
  // 읽은 것이 언제 것인지가 "왜 안 늘어나나" 의 답이다 — 개수만으로는 알 수 없다.
  const days = pending.map((row) => row.entry.on).sort();
  const span = days.length
    ? `${days[0].slice(5).replace("-", "/")}~${days.at(-1).slice(5).replace("-", "/")}`
    : "";
  $("sms-summary").textContent = [
    fileName,
    // 파일이 언제 것인지 말해 준다 — "백업했는데 안 늘어난다" 는 대개 옛 파일을 연 것이다.
    // 받은 시각이 없는 백업도 있다(date 속성이 빠진다) — 그때는 본문 날짜에 기댄다고 알린다.
    fromBackup ? (newestOn ? `최근 문자 ${newestOn.slice(5).replace("-", "/")}` : "받은 시각 없는 백업") : "",
    span ? `${pending.length}건 읽음 (${span})` : `${pending.length}건 읽음`,
    pending.length - fresh > 0 ? `이미 담긴 것 ${pending.length - fresh}건` : "",
    // 조용히 자르지 않는다. 자르는 쪽은 언제나 옛 문자다(sms.js).
    clipped ? `옛 문자 ${clipped}건은 건너뜀` : "",
    // 백업 파일은 결제와 무관한 문자가 대부분이라 실패 건수를 세어 봐야 소음이다.
    !fromBackup && failed.length ? `못 읽은 것 ${failed.length}건 (${failed[0].reason})` : "",
  ].filter(Boolean).join(" · ");
  if (fromBackup) {
    // 파일에서 금액이 든 문자를 몇 건이나 봤는지 — 파일 탓인지 파서 탓인지 여기서 갈린다.
    $("sms-summary").textContent += ` · 파일에서 금액이 든 문자 ${scanned + clipped}건`;
  }
  renderPreview();
}

function renderPreview() {
  $("sms-preview").replaceChildren(...pending.map((row, index) => {
    const item = node("li", `preview-row${row.duplicate ? " duplicate" : ""}`);
    const label = node("label", "preview-label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = row.take;
    box.addEventListener("change", () => {
      pending[index].take = box.checked;
      $("sms-save").disabled = !pending.some((one) => one.take);
      updateSaveLabel();
    });
    const body = node("span", "preview-body");
    body.append(
      node("span", "preview-memo", row.entry.memo || "메모 없음"),
      node("span", "preview-when", `${row.entry.on.slice(5).replace("-", "/")}${row.duplicate ? " · 이미 담김" : ""}`),
    );
    label.append(box, body, node("span", "preview-amount", won(row.entry.amount)));
    item.append(label);
    return item;
  }));
  $("sms-save").disabled = !pending.some((row) => row.take);
  updateSaveLabel();
}

function updateSaveLabel() {
  const count = pending.filter((row) => row.take).length;
  $("sms-save").textContent = count ? `${count}건 담기` : "담기";
}

/* 폴더를 기억해 두고 "그 폴더의 최신 백업"을 바로 여는 길. File System Access API 가
 * 필요해서 있는지 물어보고 켠다 — 안드로이드에서도 실제로 동작하는 것을 확인했다
 * (2026-08-24, 삼성 폰). 없는 브라우저는 파일 선택창 그대로다. */
const FOLDER_DB = "bl_budget_fs";     // 기기 안에서만 뜻이 있는 폴더 손잡이 하나
const canPickFolder = typeof window.showDirectoryPicker === "function";

function folderStore(mode) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(FOLDER_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onsuccess = () => resolve(open.result.transaction("handles", mode).objectStore("handles"));
    open.onerror = () => reject(open.error);
  });
}

async function savedFolder() {
  try {
    const store = await folderStore("readonly");
    return await new Promise((resolve) => {
      const request = store.get("folder");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function rememberFolder(handle) {
  try { (await folderStore("readwrite")).put(handle, "folder"); } catch { /* 못 담아도 이번엔 열린다 */ }
}

/**
 * 폴더에서 가장 최근 백업 파일. 수정 시각으로 고르되, **시각이 같거나 없으면 이름**으로
 * 가른다 — 안드로이드 파일 제공자가 lastModified 를 0 으로 주는 일이 있고, 그러면
 * 옛 파일을 열어 놓고 "백업했는데 안 늘어난다" 가 된다(백업 파일명에는 날짜가 들어간다).
 */
async function newestBackup(handle) {
  let newest = null;
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "file" || !/\.(xml|txt)$/i.test(name)) continue;
    const file = await entry.getFile();
    const fresher = !newest
      || file.lastModified > newest.lastModified
      || (file.lastModified === newest.lastModified && file.name.localeCompare(newest.name, "en") > 0);
    if (fresher) newest = file;
  }
  return newest;
}

async function openFromFolder(pickAgain = false) {
  try {
    let handle = pickAgain ? null : await savedFolder();
    if (!handle) {
      handle = await window.showDirectoryPicker({ id: "bl-budget-sms", mode: "read", startIn: "downloads" });
      await rememberFolder(handle);
    }
    // 권한은 브라우저를 껐다 켜면 다시 물어본다 — 손잡이는 남아 있으므로 한 번 눌러 준다.
    if (await handle.queryPermission?.({ mode: "read" }) !== "granted"
      && await handle.requestPermission?.({ mode: "read" }) !== "granted") {
      $("sms-summary").textContent = "폴더 읽기를 허용해야 열 수 있어요";
      return;
    }
    showFolder(handle.name);
    const file = await newestBackup(handle);
    if (!file) { $("sms-summary").textContent = `${handle.name} 에 백업 파일이 없어요`; return; }
    readSms(await file.text(), file.name);
  } catch (error) {
    // 사용자가 선택창을 닫은 것은 실패가 아니다.
    if (error?.name !== "AbortError") $("sms-summary").textContent = "폴더를 열지 못했습니다";
  }
}

function showFolder(name) {
  $("folder-name").textContent = name ? `기억한 폴더: ${name}` : "";
  $("folder-row").hidden = !name;
  $("folder-open").textContent = name ? "폴더에서 최신 백업 열기" : "백업 폴더 고르기";
}

if (canPickFolder) {
  $("folder-open").hidden = false;
  $("sms-file-label").classList.remove("primary");
  $("sms-file-label").textContent = "다른 파일 고르기";
  $("folder-open").addEventListener("click", () => openFromFolder());
  $("folder-change").addEventListener("click", () => openFromFolder(true));
  savedFolder().then((handle) => showFolder(handle?.name ?? ""));
}

$("sms-button").addEventListener("click", () => openSms());
$("sms-cancel").addEventListener("click", () => $("sms").close());
$("sms-file").addEventListener("change", async (event) => {
  const [file] = event.target.files ?? [];
  if (!file) return;
  try { readSms(await file.text()); }
  catch { $("sms-summary").textContent = "파일을 읽지 못했습니다"; }
  event.target.value = "";
});

$("sms-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const taking = pending.filter((row) => row.take).map((row) => row.entry);
  let next = state;
  for (const entry of taking) {
    try { next = addEntry(next, entry, new Date(`${entry.on}T12:00:00Z`)); }
    catch { /* 한 건이 틀렸다고 나머지를 버리지 않는다 */ }
  }
  update(next);
  // 담은 것이 지금 보는 주기에 하나도 없으면 그쪽으로 따라간다.
  const cycle = cycleOf(anchor, state.startDay);
  if (taking.length && !taking.some((entry) => inCycle(cycle, entry.on))) {
    anchor = taking.map((entry) => entry.on).sort().at(-1);
    render();
  }
  $("sms").close();
});
$("sms").addEventListener("close", () => { pending = []; });

/* 공유 시트로 들어온 것(manifest 의 share_target). 파일은 POST 로 오므로 서비스워커가
 * 받아 캐시에 담아 두고 ?share=1 로 넘긴다(life/sw.js). 주소에 문자가 남지 않게 읽자마자
 * 지운다 — 뒤로 가기로 되돌아와 두 번 담기는 것도 막는다.
 *
 * ?text= 도 계속 받는다: 이미 설치된 폰의 WebAPK 는 매니페스트가 갱신될 때까지 옛
 * 방식(GET)으로 보낸다. */
const SHARE_CACHE = "bl-life-share";
const SHARE_KEY = "/__share";

async function takeShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has("share") && !params.has("text") && !params.has("title")) return;
  history.replaceState(null, "", location.pathname);
  if (params.has("share")) {
    try {
      const cache = await caches.open(SHARE_CACHE);
      const stored = await cache.match(SHARE_KEY);
      await cache.delete(SHARE_KEY);
      const text = stored ? await stored.text() : "";
      if (text.trim()) { openSms(text); return; }
    } catch { /* 캐시를 못 읽으면 빈 화면이라도 연다 */ }
    openSms();
    $("sms-summary").textContent = "공유받은 것을 읽지 못했습니다 — 파일 열기로 넣어주세요";
    return;
  }
  openSms([params.get("text"), params.get("title")].filter(Boolean).join("\n"));
}
takeShared();

/* ── 한도와 주기 ────────────────────────────────────────────────── */
$("settings-button").addEventListener("click", () => {
  $("limit-input").value = String(state.limit);
  $("start-day-input").value = String(state.startDay);
  $("settings-error").textContent = "";
  $("settings").showModal();
});
$("settings-cancel").addEventListener("click", () => $("settings").close());
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    update(setStartDay(setLimit(state, $("limit-input").value), $("start-day-input").value));
    $("settings").close();
  } catch (error) {
    $("settings-error").textContent = error.message;
  }
});

render();
