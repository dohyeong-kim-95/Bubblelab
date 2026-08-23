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
function openSms(prefill = "") {
  pending = [];
  $("sms-text").value = prefill;
  $("sms-summary").textContent = "";
  $("sms-preview").replaceChildren();
  $("sms-save").disabled = true;
  $("sms").showModal();
  if (prefill) readSms(prefill);
}

function readSms(text) {
  const { found, failed, fromBackup } = parseBackupOrText(text, kstDate());
  const seen = seenSigs(state);
  pending = found.map(({ entry }) => {
    // 같은 문자를 두 번 담지 않는다. 한 번에 붙여넣은 것 안에서 겹치는 것도 본다.
    const duplicate = seen.has(entry.sig);
    seen.add(entry.sig);
    return { entry, duplicate, take: !duplicate };
  });

  const fresh = pending.filter((row) => !row.duplicate).length;
  $("sms-summary").textContent = [
    `${pending.length}건 읽음`,
    pending.length - fresh > 0 ? `이미 담긴 것 ${pending.length - fresh}건` : "",
    // 백업 파일은 결제와 무관한 문자가 대부분이라 실패 건수를 세어 봐야 소음이다.
    !fromBackup && failed.length ? `못 읽은 것 ${failed.length}건 (${failed[0].reason})` : "",
  ].filter(Boolean).join(" · ");
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

$("sms-button").addEventListener("click", () => openSms());
$("sms-cancel").addEventListener("click", () => $("sms").close());
$("sms-read").addEventListener("click", () => readSms($("sms-text").value));
$("sms-file").addEventListener("change", async (event) => {
  const [file] = event.target.files ?? [];
  if (!file) return;
  try {
    const text = await file.text();
    $("sms-text").value = text.length > 4000 ? `${file.name} — ${Math.round(file.size / 1024)}KB` : text;
    readSms(text);
  } catch {
    $("sms-summary").textContent = "파일을 읽지 못했습니다";
  }
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

/* 공유 시트로 들어온 문자(manifest 의 share_target). 주소에 문자가 남지 않게
 * 읽자마자 지운다 — 뒤로 가기로 되돌아와 두 번 담기는 것도 막는다. */
const shared = new URLSearchParams(location.search);
const sharedText = [shared.get("text"), shared.get("title")].filter(Boolean).join("\n");
if (sharedText) {
  history.replaceState(null, "", location.pathname);
  openSms(sharedText);
}

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
