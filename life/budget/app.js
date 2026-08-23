import {
  addEntry, cycleLabel, cycleOf, editEntry, emptyState, entriesIn, groupByDay, inCycle,
  kstDate, pace, parseState, removeEntry, setLimit, setStartDay, shiftDate, shortWon, won,
} from "./store.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "bl_budget_v1";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

let state = load();
// 보고 있는 주기는 이 날짜 하나로 정해진다 — 시작일이 바뀌어도 다시 계산될 뿐이다.
let anchor = kstDate();
let editing = null;

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
