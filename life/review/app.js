import { hasAnything, summarize, yearsIn } from "./store.js";

const $ = (id) => document.getElementById(id);
const MONTH_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

/* 도구가 없어졌거나 저장 형식이 달라졌을 수 있다 — 읽다 실패하면 그 도구만 빼고
 * 나머지는 그대로 보여 준다. */
function readLocal(key, pick) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? pick(JSON.parse(raw)) ?? [] : [];
  } catch { return []; }
}

async function readBooks() {
  try {
    if (!indexedDB.databases) return [];
    const found = await indexedDB.databases();
    if (!found.some((database) => database.name === "bl_library")) return [];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("bl_library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains("books")) { db.close(); return []; }
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction("books", "readonly").objectStore("books").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  } catch { return []; }
}

async function collect() {
  return {
    todoLog: readLocal("bl_life_v1", (value) => value.log),
    pushupLog: readLocal("bl_pushup_v1", (value) => value.log),
    books: await readBooks(),
  };
}

function headline(count, unit, note) {
  const row = node("div", "headline");
  row.append(node("b", null, String(count)), node("span", null, unit));
  const block = node("section", "block");
  block.append(row);
  if (note) block.append(node("p", "note", note));
  return block;
}

function monthChart(counts) {
  const peak = Math.max(...counts, 1);
  const chart = node("div", "months");
  counts.forEach((count, index) => {
    const column = node("div", "month");
    const bar = node("div", `bar${count ? "" : " zero"}`);
    bar.style.height = `${Math.round((count / peak) * 64)}px`;
    bar.title = `${index + 1}월 ${count}개`;
    column.append(bar, node("div", "month-label", MONTH_LABELS[index]));
    chart.append(column);
  });
  return chart;
}

function render(summary) {
  const report = $("report");
  report.replaceChildren();

  if (summary.todos.total) {
    const block = headline(summary.todos.total, "가지 일을 끝냈습니다");
    block.append(monthChart(summary.todos.months));
    report.append(block);
  }
  if (summary.books.total) {
    const block = headline(summary.books.total, "권을 읽었습니다");
    const covers = node("div", "covers");
    for (const book of summary.books.items) {
      if (book.cover) {
        const image = node("img", "cover");
        image.src = book.cover;
        image.alt = `${book.title} 표지`;
        image.loading = "lazy";
        covers.append(image);
      } else covers.append(node("div", "cover cover-blank", book.title));
    }
    block.append(covers);
    report.append(block);
  }
  if (summary.pushup.sessions) {
    report.append(headline(summary.pushup.sessions, "번 운동했습니다",
      `한 번에 최고 ${summary.pushup.best}개 · 모두 ${summary.pushup.reps}개`));
  }
  $("empty").hidden = hasAnything(summary);
}

const sources = await collect();
const years = yearsIn(sources);
const thisYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date());
if (!years.includes(thisYear)) years.unshift(thisYear);

$("year").replaceChildren(...years.map((year) => {
  const option = document.createElement("option");
  option.value = year;
  option.textContent = `${year}년`;
  return option;
}));
$("year").value = thisYear;
$("year").addEventListener("change", () => render(summarize(sources, $("year").value)));
render(summarize(sources, thisYear));
