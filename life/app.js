import {
  MAX_LISTS, STORAGE_KEY, addItem, addList, clearDone, emptyState, parseState,
  progressOf, removeItem, removeList, renameList, toggleItem,
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

/* 목록 이동은 CSS scroll-snap 이 맡는다 — 드래그를 직접 처리하지 않아야
 * 관성·되돌아가기·접근성이 브라우저 것 그대로 나온다. */
function renderPanels() {
  track.replaceChildren(...state.lists.map((list) => {
    const panel = node("section", "panel");
    panel.dataset.listId = list.id;
    const items = node("ul", "items");
    for (const item of list.items) {
      const row = node("li", `item${item.done ? " done" : ""}`);
      const toggle = node("button", "check", item.done ? "●" : "○");
      toggle.type = "button";
      toggle.setAttribute("aria-pressed", String(item.done));
      toggle.setAttribute("aria-label", `${item.text} ${item.done ? "완료 취소" : "완료"}`);
      toggle.addEventListener("click", () => update(toggleItem(state, list.id, item.id)));
      const text = node("span", "text", item.text);
      const remove = node("button", "remove", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `${item.text} 삭제`);
      remove.addEventListener("click", () => update(removeItem(state, list.id, item.id)));
      row.append(toggle, text, remove);
      items.append(row);
    }
    panel.append(items);
    if (!list.items.length) panel.append(node("p", "empty", "아직 없습니다."));
    return panel;
  }));
}

function renderDots() {
  $("dots").replaceChildren(...state.lists.map((list, position) => {
    const dot = node("button", `dot${position === index ? " on" : ""}`);
    dot.type = "button";
    dot.setAttribute("aria-label", list.name);
    dot.setAttribute("aria-current", position === index ? "true" : "false");
    dot.addEventListener("click", () => goTo(position));
    return dot;
  }));
  $("dots").hidden = state.lists.length < 2;
}

function renderHeader() {
  const list = current();
  const { done, total } = progressOf(list);
  $("list-name").textContent = list.name;
  $("list-count").textContent = total ? `${done}/${total}` : "";
}

/* 제목은 한 번 누르면 목록 선택, 두 번 누르면 이름 바꾸기다. 같은 자리에 두 동작이
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
  const items = state.lists.map((list, position) => {
    const { done, total } = progressOf(list);
    const button = node("button", "pick");
    button.type = "button";
    button.setAttribute("aria-current", String(position === index));
    button.append(node("span", "", list.name), node("span", "count", total ? `${done}/${total}` : ""));
    button.addEventListener("click", () => { $("picker").close(); goTo(position); });
    return button;
  });
  $("picker-items").replaceChildren(...items);
  $("picker").showModal();
}

async function renamePrompt() {
  const name = await ask("이름 바꾸기", current().name);
  if (name === null) return;
  try { update(renameList(state, current().id, name)); }
  catch (error) { await ask(error.message, "", { confirm: true }); }
}

function render() {
  index = Math.max(0, Math.min(index, state.lists.length - 1));
  renderPanels();
  renderDots();
  renderHeader();
  goTo(index, "auto");
}

function update(next) {
  state = next;
  save();
  render();
}

function goTo(position, behavior = "smooth") {
  index = Math.max(0, Math.min(position, state.lists.length - 1));
  track.scrollTo({ left: index * track.clientWidth, behavior });
  renderDots();
  renderHeader();
}

// 스와이프가 멈춘 자리를 헤더·점에 반영한다.
let settle = null;
track.addEventListener("scroll", () => {
  clearTimeout(settle);
  settle = setTimeout(() => {
    const position = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (position !== index) { index = position; renderDots(); renderHeader(); }
  }, 60);
}, { passive: true });

addEventListener("resize", () => track.scrollTo({ left: index * track.clientWidth, behavior: "auto" }));

$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("add-text");
  const text = input.value;
  input.value = "";
  update(addItem(state, current().id, text));
  const panel = track.children[index];
  panel?.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
});

/* 이름 입력은 dialog 하나를 돌려 쓴다. window.prompt 는 PWA 에서 주소를 드러내고
 * 스타일도 맞지 않는다. */
function ask(title, value = "", { confirm = false } = {}) {
  return new Promise((resolve) => {
    const dialog = $("prompt");
    $("prompt-title").textContent = title;
    $("prompt-text").value = value;
    $("prompt-text").hidden = confirm;
    $("prompt-text").required = !confirm;
    $("prompt-error").textContent = "";
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
  try { await handler(); } catch (error) { await ask(error.message, ""); }
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

$("menu-clear").addEventListener("click", withMenu(() => update(clearDone(state, current().id))));

$("menu-remove").addEventListener("click", withMenu(async () => {
  const list = current();
  // 빈 목록은 그냥 지운다. 적어 둔 게 있으면 한 번 묻는다.
  if (list.items.length && !await ask(`"${list.name}" 의 ${list.items.length}개를 지울까요?`, "", { confirm: true })) return;
  const next = removeList(state, list.id);
  index = Math.max(0, index - 1);
  update(next);
}));

render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
