import {
  MAX_LISTS, STORAGE_KEY, addItem, addList, clearDone, emptyState, parseState,
  orderedItems, progressOf, removeItem, removeList, renameList, reorderItems, reorderLists,
  setTool, toggleItem,
} from "./store.js";

const $ = (id) => document.getElementById(id);
const track = $("track");
let state = load();
let index = 0;

function load() {
  try { return parseState(localStorage.getItem(STORAGE_KEY)); } catch { return emptyState(); }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 저장 공간이 없으면 화면만 유지 */ }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

const current = () => state.lists[Math.min(index, state.lists.length - 1)];

/* 손잡이를 끌어 순서를 바꾼다. 끄는 동안에는 DOM 을 직접 옮겨 눈에 보이게 하고,
 * 손을 떼면 그때 보이던 id 순서를 그대로 저장한다 — 인덱스 계산을 두 번 하지 않는다.
 * 길게 누르기는 이미 도구 연결이 쓰고 있어 손잡이를 따로 둔다. */
function draggable(handle, row, container, commit) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    row.classList.add("dragging");

    const onMove = (moveEvent) => {
      for (const other of [...container.children]) {
        if (other === row) continue;
        const box = other.getBoundingClientRect();
        if (moveEvent.clientY < box.top || moveEvent.clientY > box.bottom) continue;
        // 끌고 있는 행은 제자리에 두고 상대를 옮긴다. 잡고 있는 요소를 DOM 에서
        // 움직이면 포인터 캡처가 풀려 드래그가 그 자리에서 끊긴다.
        const dragged = row.getBoundingClientRect();
        container.insertBefore(other, dragged.top < box.top ? row : row.nextSibling);
        break;
      }
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      row.classList.remove("dragging");
      commit([...container.children].map((child) => child.dataset.id).filter(Boolean));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  });
}
const listById = (id) => state.lists.find((list) => list.id === id);
const panelOf = (id) => track.querySelector(`[data-list-id="${CSS.escape(id)}"]`);

/* 키보드가 올라오면 앱이 그만큼 줄어야 한다(가려지면 안 된다). 뷰포트 meta 의
 * interactive-widget=resizes-content 가 기본이고, 이건 그걸 지원하지 않는
 * 브라우저를 위한 보험이다. */
function syncViewport() {
  const height = globalThis.visualViewport?.height;
  document.documentElement.style.setProperty("--app-h", height ? `${Math.round(height)}px` : "100%");
}

/* ── 그리기 ─────────────────────────────────────────────────────────────
 * 항목 하나가 바뀌었을 때 전체를 다시 그리지 않는다. 목록이 길어질수록 그게
 * 그대로 지연으로 느껴지고, 스크롤 위치까지 튄다. */
function itemRow(list, item) {
  const row = node("li", `item${item.done ? " done" : ""}`);
  row.dataset.id = item.id;
  const toggle = node("button", "check", item.done ? "●" : "○");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", String(item.done));
  toggle.setAttribute("aria-label", `${item.text} ${item.done ? "완료 취소" : "완료"}`);
  toggle.addEventListener("click", () => update(toggleItem(state, list.id, item.id), list.id));

  const text = node("span", "text");
  text.append(item.text);
  if (item.tool) text.append(node("span", "tool", `↗ ${item.tool}`));
  text.title = item.tool ? `두 번 누르면 ${item.tool} 열기 · 길게 누르면 도구 바꾸기` : "길게 누르면 도구 연결";
  attachToolGestures(text, row, list, item);

  const remove = node("button", "remove", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", `${item.text} 삭제`);
  remove.addEventListener("click", () => update(removeItem(state, list.id, item.id), list.id));

  const grip = node("button", "grip", "⠿");
  grip.type = "button";
  grip.setAttribute("aria-label", `${item.text} 순서 바꾸기`);

  row.append(toggle, text, remove, grip);
  return row;
}

function fillPanel(panel, list) {
  const items = node("ul", "items");
  for (const item of orderedItems(list)) {
    const row = itemRow(list, item);
    draggable(row.querySelector(".grip"), row, items,
      (order) => update(reorderItems(state, list.id, order), list.id));
    items.append(row);
  }
  panel.replaceChildren(items);
  if (!list.items.length) panel.append(node("p", "empty", "아직 없습니다."));
}

function renderPanel(listId) {
  const list = listById(listId);
  const panel = panelOf(listId);
  if (list && panel) fillPanel(panel, list);
}

function renderPanels() {
  track.replaceChildren(...state.lists.map((list) => {
    const panel = node("section", "panel");
    panel.dataset.listId = list.id;
    fillPanel(panel, list);
    return panel;
  }));
}

/* 점은 목록 구성이 바뀔 때만 다시 만든다. 스와이프 중에는 클래스만 갈아 끼운다 —
 * 매 프레임 DOM 을 새로 만들면 그게 그대로 굼뜬 느낌이 된다. */
let dotEls = [];

function renderDots() {
  dotEls = state.lists.map((list, position) => {
    const dot = node("button", "dot");
    dot.type = "button";
    dot.setAttribute("aria-label", list.name);
    dot.addEventListener("click", () => goTo(position));
    return dot;
  });
  $("dots").replaceChildren(...dotEls);
  $("dots").hidden = state.lists.length < 2;
  markDots();
}

function markDots() {
  dotEls.forEach((dot, position) => {
    dot.classList.toggle("on", position === index);
    dot.setAttribute("aria-current", position === index ? "true" : "false");
  });
}

function renderHeader() {
  const list = current();
  const { done, total } = progressOf(list);
  $("list-name").textContent = list.name;
  $("list-count").textContent = total ? `${done}/${total}` : "";
}

function render() {
  index = Math.max(0, Math.min(index, state.lists.length - 1));
  renderPanels();
  renderDots();
  renderHeader();
  goTo(index, "auto");
}

/** listId 를 주면 그 목록만 다시 그린다. 없으면 목록 구성이 바뀐 것이라 전부. */
function update(next, listId = null) {
  state = next;
  save();
  if (listId && panelOf(listId)) { renderPanel(listId); renderHeader(); }
  else render();
}

/* 점을 누르거나 목록을 새로 만들어 옮길 때. 부드럽게 미끄러지는 동안에는 중간
 * 위치가 계속 들어오므로 스크롤 핸들러가 끼어들지 못하게 잠깐 막는다 — 안 막으면
 * 목적지에 닿기 전 중간값으로 헤더가 되돌아간다. */
let navigatingUntil = 0;

function goTo(position, behavior = "smooth") {
  index = Math.max(0, Math.min(position, state.lists.length - 1));
  navigatingUntil = behavior === "smooth" ? Date.now() + 600 : 0;
  track.scrollTo({ left: index * track.clientWidth, behavior });
  markDots();
  renderHeader();
}

/* 손가락을 따라오게 한다. 스크롤이 멈추기를 기다리지 않고 매 프레임 확인하되,
 * 프레임당 한 번으로 묶어 스크롤을 방해하지 않는다(절반을 넘어서면 넘어간 것). */
let scrollFrame = 0;
// 손가락이 닿는 순간 사용자가 주도권을 가져간다 — 미끄러지던 중이라도 잠금을 푼다.
track.addEventListener("pointerdown", () => { navigatingUntil = 0; }, { passive: true });
track.addEventListener("scroll", () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const position = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (position === index) { navigatingUntil = 0; return; }   // 목적지에 닿았다
    if (Date.now() < navigatingUntil) return;                  // 아직 미끄러지는 중
    if (position < 0 || position >= state.lists.length) return;
    index = position;
    markDots();
    renderHeader();
  });
}, { passive: true });

addEventListener("resize", () => {
  syncViewport();
  track.scrollTo({ left: index * track.clientWidth, behavior: "auto" });
});
globalThis.visualViewport?.addEventListener("resize", syncViewport);

$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("add-text");
  const text = input.value;
  input.value = "";
  const list = current();
  update(addItem(state, list.id, text), list.id);
  panelOf(list.id)?.scrollTo({ top: panelOf(list.id).scrollHeight, behavior: "smooth" });
});

/* ── 도구 연결 ──────────────────────────────────────────────────────────
 * 할 일마다 도구 이름을 하나 붙일 수 있다. 이름은 그대로 주소가 되어
 * (이 앱 기준 상대경로) `/<이름>/` 을 연다. 두 번 누르면 열고, 길게 누르면
 * 이름을 고친다. */
const LONG_PRESS_MS = 500;

function toolHref(tool) {
  return new URL(`${tool}/`, location.href).href;
}

function attachToolGestures(text, row, list, item) {
  let timer = null;
  let origin = null;
  let longPressed = false;

  const stop = () => {
    clearTimeout(timer);
    timer = null;
    origin = null;
    row.classList.remove("pressing");
  };
  text.addEventListener("pointerdown", (event) => {
    longPressed = false;
    origin = { x: event.clientX, y: event.clientY };
    row.classList.add("pressing");
    timer = setTimeout(() => { longPressed = true; stop(); void linkPrompt(list, item); }, LONG_PRESS_MS);
  });
  text.addEventListener("pointermove", (event) => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) stop();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) text.addEventListener(type, stop);
  text.addEventListener("contextmenu", (event) => event.preventDefault());
  text.addEventListener("dblclick", () => {
    if (longPressed) return;
    if (item.tool) location.assign(toolHref(item.tool));
    else void linkPrompt(list, item);
  });
}

async function linkPrompt(list, item) {
  const name = await ask("도구 연결", item.tool ?? "", { optional: true, hint: "비우면 연결을 끊습니다" });
  if (name === null) return;
  try { update(setTool(state, list.id, item.id, name), list.id); }
  catch (error) { await ask(error.message, "", { confirm: true }); }
}

/* ── 제목 ───────────────────────────────────────────────────────────────
 * 한 번 누르면 목록 선택, 두 번 누르면 이름 바꾸기다. 같은 자리에 두 동작이
 * 겹치므로 단일 탭을 잠깐 미뤄 두 번째 탭을 기다린다 — 이보다 짧으면 더블탭을
 * 놓치고, 길면 목록 선택이 굼떠 보인다. */
const DOUBLE_TAP_MS = 250;
let tapTimer = null;

function onTitleTap() {
  if (tapTimer) {
    clearTimeout(tapTimer);
    tapTimer = null;
    void renamePrompt();
    return;
  }
  tapTimer = setTimeout(() => { tapTimer = null; openPicker(); }, DOUBLE_TAP_MS);
}

function openPicker() {
  const container = $("picker-items");
  container.replaceChildren(...state.lists.map((list, position) => {
    const { done, total } = progressOf(list);
    const row = node("div", "pick");
    row.dataset.id = list.id;
    const open = node("button", "pick-open");
    open.type = "button";
    open.setAttribute("aria-current", String(position === index));
    open.append(node("span", "", list.name), node("span", "count", total ? `${done}/${total}` : ""));
    open.addEventListener("click", () => { $("picker").close(); goTo(position); });
    const grip = node("button", "grip", "⠿");
    grip.type = "button";
    grip.setAttribute("aria-label", `${list.name} 순서 바꾸기`);
    row.append(open, grip);
    draggable(grip, row, container, commitListOrder);
    return row;
  }));
  $("picker").showModal();
}

/* 목록 순서가 바뀌면 위치 번호의 의미도 바뀐다 — 보고 있던 목록을 id 로 붙잡아
 * 그 자리로 따라간다. */
function commitListOrder(order) {
  const showing = current().id;
  update(reorderLists(state, order));
  const moved = state.lists.findIndex((list) => list.id === showing);
  if (moved >= 0) goTo(moved, "auto");
  openPicker();
}

async function renamePrompt() {
  const name = await ask("이름 바꾸기", current().name);
  if (name === null) return;
  try { update(renameList(state, current().id, name)); }
  catch (error) { await ask(error.message, "", { confirm: true }); }
}

/* 입력은 dialog 하나를 돌려 쓴다. window.prompt 는 PWA 에서 출처를 드러내고
 * 스타일도 맞지 않는다. */
function ask(title, value = "", { confirm = false, optional = false, hint = "" } = {}) {
  return new Promise((resolve) => {
    const dialog = $("prompt");
    $("prompt-title").textContent = title;
    $("prompt-text").value = value;
    $("prompt-text").hidden = confirm;
    $("prompt-text").required = !confirm && !optional;
    $("prompt-error").textContent = hint;
    const done = (result) => { dialog.close(); resolve(result); };
    $("prompt-form").onsubmit = (event) => {
      event.preventDefault();
      done(confirm ? true : $("prompt-text").value);
    };
    $("prompt-cancel").onclick = () => done(null);
    dialog.oncancel = () => resolve(null);
    dialog.showModal();
    if (!confirm) { $("prompt-text").focus(); $("prompt-text").select(); }
  });
}

const withMenu = (handler) => async () => {
  $("menu").close();
  try { await handler(); } catch (error) { await ask(error.message, "", { confirm: true }); }
};

$("list-name").addEventListener("click", onTitleTap);
// 키보드로는 탭 횟수를 셀 수 없다 — Enter 는 목록 선택, 이름 바꾸기는 ⋯ 메뉴에 있다.
$("list-name").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  clearTimeout(tapTimer);
  tapTimer = null;
  openPicker();
});
$("picker").addEventListener("click", (event) => { if (event.target === $("picker")) $("picker").close(); });
$("menu-button").addEventListener("click", () => $("menu").showModal());
$("menu-close").addEventListener("click", () => $("menu").close());
$("menu").addEventListener("click", (event) => { if (event.target === $("menu")) $("menu").close(); });

$("menu-add").addEventListener("click", withMenu(async () => {
  if (state.lists.length >= MAX_LISTS) throw new Error(`목록은 ${MAX_LISTS}개까지예요`);
  const name = await ask("새 목록");
  if (name === null) return;
  update(addList(state, name));
  goTo(state.lists.length - 1);
}));

$("menu-rename").addEventListener("click", withMenu(renamePrompt));

$("menu-clear").addEventListener("click", withMenu(() => {
  const list = current();
  update(clearDone(state, list.id), list.id);
}));

$("menu-remove").addEventListener("click", withMenu(async () => {
  const list = current();
  // 빈 목록은 그냥 지운다. 적어 둔 게 있으면 한 번 묻는다.
  if (list.items.length && !await ask(`"${list.name}" 의 ${list.items.length}개를 지울까요?`, "", { confirm: true })) return;
  const next = removeList(state, list.id);
  index = Math.max(0, index - 1);
  update(next);
}));

syncViewport();
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
