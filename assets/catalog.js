const category = document.body.dataset.category;
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const count = document.getElementById("count");
let items = [];

const esc = (value) => String(value).replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[char]);

function render() {
  const query = search.value.trim().toLocaleLowerCase("ko");
  const visible = items.filter((item) =>
    !query || [item.title, item.description, ...(item.tags || [])].join(" ").toLocaleLowerCase("ko").includes(query));
  count.textContent = `${visible.length}개`;
  if (!visible.length) {
    grid.innerHTML = `<div class="state">${items.length ? "검색 결과가 없습니다." : "아직 등록된 이미지가 없습니다.<br>새로운 이미지가 곧 추가될 예정입니다."}</div>`;
    return;
  }
  grid.innerHTML = visible.map((item) => `
    <article class="card">
      <div class="preview"><img src="${esc(item.preview)}" alt="${esc(item.title)} 미리보기" loading="lazy"></div>
      <div class="info">
        <h2>${esc(item.title)}</h2>
        <p class="description">${esc(item.description || "Bubblelab에서 만든 이미지입니다.")}</p>
        <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">#${esc(tag)}</span>`).join("")}</div>
        <div class="downloads">${item.downloads.map((download) =>
          `<a class="download" href="${esc(download.url)}" download="${esc(download.file)}">↓ ${esc(download.label)}</a>`).join("")}</div>
      </div>
    </article>`).join("");
}

search.addEventListener("input", render);

try {
  const response = await fetch("/_assets/catalog.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("catalog unavailable");
  const catalog = await response.json();
  items = (catalog.items || []).filter((item) => item.category === category);
  search.hidden = items.length < 5;
  render();
} catch {
  count.textContent = "";
  grid.innerHTML = '<div class="state">이미지 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</div>';
}
