import {
  BODY_MAX, MAX_BOX, TOPICS, addCard, byTopic, editCard, gradeCard, nextDueAt,
  normalizeSource, parseState, emptyState, removeCard, reviewQueue, stats, topicOf,
} from "./store.js";

const $ = (id) => document.getElementById(id);
const KEY = "bl_semi_v1";           // bl_ 로 시작해야 /backup/ 이 담아 간다

let state = load();
let tab = "notes";
/* 복습 큐는 화면에 들어올 때 한 번 만들고 그 안에서 돈다. 저장된 것에서 매번 다시
 * 뽑으면 "아직"을 누른 카드가 곧바로 같은 자리에 또 나와 넘어가지 못한다. */
let queue = [];
let revealed = false;
let deleteArmed = false;

function load() {
  try { return parseState(localStorage.getItem(KEY)) ?? emptyState(); } catch { return emptyState(); }
}

function save(next) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 용량이 차면 화면만 유지한다 */ }
  render();
}

/* ── 그리기 ─────────────────────────────────────────────────────── */
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

const boxMark = (box) => "●".repeat(box ?? 0) + "○".repeat(MAX_BOX - (box ?? 0));

function sourceLink(anchor, url) {
  anchor.hidden = !url;
  if (!url) return;
  anchor.href = url;
  try { anchor.textContent = new URL(url).hostname; } catch { anchor.textContent = url; }
}

function cardNode(card) {
  const details = node("details", "card");
  const summary = node("summary", "card-head");
  summary.append(node("span", "card-title", card.title));
  summary.append(node("span", "card-box", boxMark(card.box)));
  details.append(summary);

  details.append(node("p", "card-body", card.body));
  const anchor = node("a", "source");
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  sourceLink(anchor, card.source);
  details.append(anchor);

  const edit = node("button", "card-edit", "고치기");
  edit.type = "button";
  edit.addEventListener("click", () => openEditor(card));
  details.append(edit);
  return details;
}

function renderNotes() {
  const notes = $("notes");
  notes.replaceChildren();
  for (const group of byTopic(state.cards)) {
    const section = node("section", "topic");
    const head = node("h2", "topic-head");
    head.append(node("span", null, group.topic.label));
    head.append(node("span", "count", group.cards.length ? String(group.cards.length) : ""));
    section.append(head);
    if (group.cards.length) {
      for (const card of group.cards) section.append(cardNode(card));
    } else {
      section.append(node("p", "topic-hint", group.topic.hint));
    }
    notes.append(section);
  }
}

const DAY_MS = 86_400_000;
function whenBack(cards) {
  const at = nextDueAt(cards);
  if (at === null) return "";
  const days = Math.ceil((at - Date.now()) / DAY_MS);
  return days <= 0 ? "" : `다음 카드는 ${days}일 뒤에 돌아옵니다.`;
}

function renderReview() {
  const card = queue[0] ?? null;
  $("review-card").hidden = !card;
  $("review-empty").hidden = Boolean(card);

  if (!card) {
    $("review-empty").textContent = state.cards.length
      ? `지금 볼 카드가 없습니다. ${whenBack(state.cards)}`.trim()
      : "카드를 먼저 한 장 적어주세요.";
    return;
  }
  $("review-topic").textContent = topicOf(card.topic).label;
  $("review-title").textContent = card.title;
  $("review-body").textContent = card.body;
  sourceLink($("review-source"), card.source);
  // 답은 자리를 차지한 채 가려만 둔다 — 확인을 눌러도 버튼이 움직이지 않는다.
  $("review-body").classList.toggle("veiled", !revealed);
  $("review-source").classList.toggle("veiled", !revealed);
  $("review-show").disabled = revealed;
  $("review-again").disabled = !revealed;
  $("review-ok").disabled = !revealed;
  $("review-left").textContent = `남은 카드 ${queue.length}장`;
}

function render() {
  const counts = stats(state.cards);
  $("count").textContent = counts.total ? `${counts.learned}/${counts.total}` : "";
  $("due-count").textContent = counts.due ? String(counts.due) : "";
  $("tab-notes").setAttribute("aria-current", String(tab === "notes"));
  $("tab-review").setAttribute("aria-current", String(tab === "review"));
  $("notes").hidden = tab !== "notes";
  $("review").hidden = tab !== "review";
  if (tab === "notes") renderNotes(); else renderReview();
}

/* ── 복습 ───────────────────────────────────────────────────────── */
function startReview() {
  queue = reviewQueue(state.cards);
  revealed = false;
}

function grade(ok) {
  const card = queue[0];
  if (!card) return;
  const rest = queue.slice(1);
  // "아직"은 뒤로 돌린다 — 맨 앞에 두면 같은 카드만 되풀이된다.
  queue = ok ? rest : [...rest, card];
  revealed = false;
  save(gradeCard(state, card.id, ok));
}

/* ── 카드 고치기 ─────────────────────────────────────────────────── */
function resetDelete() {
  deleteArmed = false;
  $("editor-delete").textContent = "삭제";
}

function openEditor(card) {
  $("card-id").value = card?.id ?? "";
  $("editor-title").textContent = card ? "카드 고치기" : "카드 남기기";
  $("topic-input").value = card?.topic ?? TOPICS[0].id;
  $("title-input").value = card?.title ?? "";
  $("body-input").value = card?.body ?? "";
  $("source-input").value = card?.source ?? "";
  $("editor-error").textContent = "";
  $("editor-delete").hidden = !card;
  resetDelete();
  countBody();
  $("editor").showModal();
}

const countBody = () => { $("body-count").textContent = `${$("body-input").value.length}/${BODY_MAX}`; };

function submitEditor(event) {
  event.preventDefault();
  const id = $("card-id").value;
  const fields = {
    topic: $("topic-input").value,
    title: $("title-input").value,
    body: $("body-input").value,
    source: $("source-input").value,
  };
  // 출처는 store 가 http(s) 아닌 것을 조용히 버린다. 적어 둔 것이 소리 없이
  // 사라지지 않게 여기서 먼저 되돌려준다.
  if (fields.source.trim() && !normalizeSource(fields.source)) {
    $("editor-error").textContent = "출처는 http:// 나 https:// 로 시작하는 주소만 됩니다";
    return;
  }
  try {
    save(id ? editCard(state, id, fields) : addCard(state, fields));
  } catch (error) {
    $("editor-error").textContent = error.message;
    return;
  }
  $("editor").close();
}

/* ── 붙이기 ─────────────────────────────────────────────────────── */
for (const topic of TOPICS) {
  const option = document.createElement("option");
  option.value = topic.id;
  option.textContent = topic.label;
  $("topic-input").append(option);
}

$("tab-notes").addEventListener("click", () => { tab = "notes"; render(); });
$("tab-review").addEventListener("click", () => { tab = "review"; startReview(); render(); });
$("add-button").addEventListener("click", () => openEditor(null));

$("review-show").addEventListener("click", () => { revealed = true; renderReview(); });
$("review-ok").addEventListener("click", () => grade(true));
$("review-again").addEventListener("click", () => grade(false));

$("editor-form").addEventListener("submit", submitEditor);
$("body-input").addEventListener("input", countBody);
$("editor-cancel").addEventListener("click", () => $("editor").close());
$("editor-cancel-2").addEventListener("click", () => $("editor").close());
$("editor").addEventListener("close", resetDelete);
$("editor-delete").addEventListener("click", () => {
  // 두 번 눌러야 지워진다. confirm() 은 PWA 에서 출처가 드러나 쓰지 않는다.
  if (!deleteArmed) { deleteArmed = true; $("editor-delete").textContent = "정말 지울까요?"; return; }
  const id = $("card-id").value;
  queue = queue.filter((card) => card.id !== id);
  save(removeCard(state, id));
  $("editor").close();
});

render();
