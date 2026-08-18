import {
  GOAL, REST_SECONDS, bestRecord, completeSession, emptyState, isDone, makePlan,
  nextDay, parseState, retest, sessionCount, totalReps,
} from "./store.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "bl_pushup_v1";
// 처음 여는 사람의 기준값. 재검사(↻)로 언제든 다시 잰다.
const DEFAULT_MAX = 5;

let state = load();
let plan = makePlan(state.max);
let session = null;   // { day, sets, index, resting }
let restTimer = null;

function load() {
  try { return parseState(localStorage.getItem(STORAGE_KEY)) ?? emptyState(DEFAULT_MAX); }
  catch { return emptyState(DEFAULT_MAX); }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 저장 공간이 없으면 화면만 유지 */ }
}

function update(next) {
  state = next;
  plan = makePlan(state.max);
  save();
  render();
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

const setsLabel = (item) => `${item.sets.slice(0, -1).join(" · ")} · ${item.target}+`;

/* ── 목록 ───────────────────────────────────────────────────────────── */
function render() {
  const upcoming = nextDay(state);
  $("progress").textContent = `${state.done.length}/${plan.length}`;
  const best = bestRecord(state);
  $("summary").textContent =
    `목표 ${GOAL}개 · 현재 최대 ${state.max}개 · ${plan.length}회차(주 3회 기준 약 ${Math.ceil(plan.length / 3)}주)`
    + (best ? ` · 최고 기록 ${best}개` : "");

  $("days").replaceChildren(...plan.map((item) => {
    const done = isDone(state, item.day);
    const row = node("button", `day${done ? " done" : ""}${item.day === upcoming ? " next" : ""}`);
    row.type = "button";
    row.append(
      node("span", "day-label", `Day ${item.day}`),
      node("span", "day-sets", setsLabel(item)),
      node("span", "day-total", done ? "완료" : `${totalReps(item)}개`),
    );
    row.addEventListener("click", () => startSession(item));
    return row;
  }));
  if (upcoming) {
    $("days").children[upcoming - 1]?.scrollIntoView({ block: "nearest" });
  }
}

/* ── 한 회차 수행 ────────────────────────────────────────────────────
 * 세트 사이 60초를 세어 준다. 원본 프로그램의 휴식 규칙이고, 이게 없으면
 * 그냥 숫자 목록이지 운동이 되지 않는다. */
function startSession(item) {
  session = { day: item.day, sets: item.sets, index: 0, resting: false };
  $("runner").showModal();
  renderRunner();
}

function stopRest() {
  clearInterval(restTimer);
  restTimer = null;
}

function renderRunner() {
  const { day, sets, index, resting, left } = session;
  const last = index === sets.length - 1;
  $("runner-title").textContent = `Day ${day}`;
  $("runner-step").textContent = resting ? "쉬는 중" : `세트 ${index + 1} / ${sets.length}${last ? " · 최대한" : ""}`;
  $("runner-reps").textContent = resting ? String(left) : `${sets[index]}${last ? "+" : ""}`;
  $("runner-reps").classList.toggle("resting", resting);
  $("runner-add").hidden = !resting;
  $("actual").hidden = resting || !last;
  $("actual-label").hidden = resting || !last;
  if (!resting && last && !$("actual").value) $("actual").value = String(sets[index]);
  $("runner-next").textContent = resting ? "스킵" : last ? "끝내기" : "완료";
}

function beginRest() {
  session.resting = true;
  session.left = REST_SECONDS;
  restTimer = setInterval(() => {
    session.left -= 1;
    if (session.left <= 0) { stopRest(); advance(); return; }
    renderRunner();
  }, 1000);
  renderRunner();
}

function advance() {
  stopRest();
  session.resting = false;
  session.index += 1;
  renderRunner();
}

function finish() {
  const reps = Math.max(0, Math.floor(Number($("actual").value) || 0));
  update(completeSession(state, session.day, reps));
  closeRunner();
}

function closeRunner() {
  stopRest();
  session = null;
  $("actual").value = "";
  $("runner").close();
}

$("runner-next").addEventListener("click", () => {
  if (!session) return;
  if (session.resting) { stopRest(); advance(); return; }
  if (session.index === session.sets.length - 1) { finish(); return; }
  beginRest();
});
// 쉬는 시간이 모자랄 때. 원본 프로그램도 "필요하면 더 쉬라"고 한다.
$("runner-add").addEventListener("click", () => {
  if (!session?.resting) return;
  session.left += 10;
  renderRunner();
});
$("runner-quit").addEventListener("click", closeRunner);
$("runner").addEventListener("close", () => { stopRest(); session = null; });

/* ── 재검사 ─────────────────────────────────────────────────────────── */
$("retest-button").addEventListener("click", () => {
  $("retest-max").value = String(state.max);
  $("retest-error").textContent = "";
  $("retest").showModal();
});
$("retest-cancel").addEventListener("click", () => $("retest").close());
$("retest-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    update(retest(state, $("retest-max").value));
    $("retest").close();
  } catch (error) { $("retest-error").textContent = error.message; }
});

render();
