import {
  COVER_MAX_BYTES, NOTE_MAX, groupByYear, kstDate, makeBook, normalizeBook, validateBook,
} from "./store.js";

const $ = (id) => document.getElementById(id);
let books = [];
let draftCover = null;

/* ── 저장 ────────────────────────────────────────────────────────────────
 * 표지가 있어 localStorage 로는 금방 넘친다. IndexedDB 는 용량 여유가 있고
 * 책 한 권이 곧 레코드 하나라 그대로 맞는다. 서버로 나가는 것은 없다. */
const DB_NAME = "bl_library";
const STORE = "books";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ??= openDb());
const loadAll = async () => transact(await db(), "readonly", (store) => store.getAll());
const saveOne = async (book) => transact(await db(), "readwrite", (store) => store.put(book));
const removeOne = async (id) => transact(await db(), "readwrite", (store) => store.delete(id));

/* ── 표지 ────────────────────────────────────────────────────────────────
 * 외부 API 를 부를 수 없으므로(CSP) 기기에서 고른 사진을 쓴다. 원본 그대로
 * 두면 한 권에 몇 MB 라, 긴 변 400px JPEG 로 줄여 담는다. */
async function shrinkCover(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.8, 0.6, 0.45]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= COVER_MAX_BYTES) return data;
  }
  throw new Error("표지가 너무 큽니다. 다른 사진을 골라주세요.");
}

/* ── 그리기 ─────────────────────────────────────────────────────────── */
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function bookCard(book) {
  const card = node("button", "book");
  card.type = "button";
  card.setAttribute("aria-label", `${book.title} 고치기`);
  if (book.cover) {
    const image = node("img", "book-cover");
    image.src = book.cover;
    image.alt = `${book.title} 표지`;
    image.loading = "lazy";
    card.append(image);
  } else {
    card.append(node("div", "book-cover book-blank", book.title));
  }
  card.append(node("div", "book-title", book.title));
  if (book.note) card.append(node("div", "book-note", book.note));
  card.addEventListener("click", () => openEditor(book));
  return card;
}

function render() {
  const shelf = $("shelf");
  const years = groupByYear(books);
  shelf.replaceChildren(...years.flatMap(({ year, books: items }) => {
    const heading = node("h2", "year", `${year} · ${items.length}권`);
    const grid = node("div", "grid");
    grid.append(...items.map(bookCard));
    return [heading, grid];
  }));
  $("count").textContent = books.length ? `${books.length}권` : "";
  $("empty").hidden = books.length > 0;
}

/* ── 편집 ───────────────────────────────────────────────────────────── */
function showCover(cover) {
  draftCover = cover;
  $("cover-preview").hidden = !cover;
  $("cover-empty").hidden = Boolean(cover);
  $("cover-clear").hidden = !cover;
  if (cover) $("cover-preview").src = cover;
}

function openEditor(book = null) {
  $("editor-title").textContent = book ? "책 고치기" : "책 남기기";
  $("book-id").value = book?.id ?? "";
  $("title-input").value = book?.title ?? "";
  $("author-input").value = book?.author ?? "";
  $("note-input").value = book?.note ?? "";
  $("date-input").value = book?.readOn ?? kstDate();
  $("editor-delete").hidden = !book;
  $("editor-error").textContent = "";
  showCover(book?.cover ?? null);
  updateNoteCount();
  $("editor").showModal();
  $("title-input").focus();
}

const updateNoteCount = () => {
  $("note-count").textContent = `${$("note-input").value.length}/${NOTE_MAX}`;
};

async function submit(event) {
  event.preventDefault();
  const existing = books.find((item) => item.id === $("book-id").value);
  const book = normalizeBook({
    ...(existing ?? makeBook()),
    title: $("title-input").value,
    author: $("author-input").value,
    note: $("note-input").value,
    readOn: $("date-input").value,
    cover: draftCover,
  });
  const errors = validateBook(book);
  if (errors.length) { $("editor-error").textContent = errors[0]; return; }
  await saveOne(book);
  books = [...books.filter((item) => item.id !== book.id), book];
  render();
  $("editor").close();
}

async function remove() {
  const id = $("book-id").value;
  if (!id) return;
  await removeOne(id);
  books = books.filter((item) => item.id !== id);
  render();
  $("editor").close();
}

$("add-button").addEventListener("click", () => openEditor());
$("editor-form").addEventListener("submit", (event) => {
  submit(event).catch((error) => { $("editor-error").textContent = error.message; });
});
$("editor-cancel").addEventListener("click", () => $("editor").close());
$("editor-delete").addEventListener("click", () => void remove());
$("note-input").addEventListener("input", updateNoteCount);
$("cover-clear").addEventListener("click", () => showCover(null));
$("cover-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try { showCover(await shrinkCover(file)); }
  catch (error) { $("editor-error").textContent = error.message; }
});

loadAll().then((saved) => { books = saved; render(); }).catch(() => render());
