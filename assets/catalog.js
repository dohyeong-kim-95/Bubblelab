const category = document.body.dataset.category;
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const count = document.getElementById("count");
let items = [];
let downloadCounts = { files: {}, items: {} };
const animatePreviews = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let activeRepeat = null;
const numberFormat = new Intl.NumberFormat("ko-KR");

const esc = (value) => String(value).replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[char]);

function previewMarkup(item) {
  if (item.category === "music" && /\.mp4$/i.test(item.preview)) {
    return `<video src="${esc(item.preview)}" aria-label="${esc(item.title)} 움직이는 썸네일" muted loop playsinline${animatePreviews ? " autoplay" : ""} preload="metadata"></video>`;
  }
  return `<img src="${esc(item.preview)}" alt="${esc(item.title)} 미리보기" loading="lazy">`;
}

function playerMarkup(item) {
  if (item.category !== "music") return "";
  const audio = item.downloads.find((download) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(download.file));
  if (!audio) return "";
  const playerId = `player-${item.id}`;
  return `<div class="listen-tools">
    <audio class="audio-player" id="${esc(playerId)}" src="${esc(audio.url)}" controls preload="metadata" aria-label="${esc(item.title)} 재생"></audio>
    <button class="repeat-button" type="button" data-repeat-player="${esc(playerId)}" data-title="${esc(item.title)}" data-preview="${esc(item.preview)}" aria-pressed="false">↻ 반복 듣기</button>
  </div>`;
}

function setRepeatButton(button, active) {
  button.setAttribute("aria-pressed", String(active));
  button.textContent = active ? "■ 반복 듣기 중" : "↻ 반복 듣기";
}

function stopRepeat() {
  if (!activeRepeat) return;
  activeRepeat.audio.loop = false;
  activeRepeat.audio.pause();
  activeRepeat.audio.currentTime = 0;
  setRepeatButton(activeRepeat.button, false);
  activeRepeat = null;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
}

async function toggleRepeat(button) {
  const audio = document.getElementById(button.dataset.repeatPlayer);
  if (!audio) return;
  if (activeRepeat?.audio === audio) {
    stopRepeat();
    return;
  }
  stopRepeat();
  audio.loop = true;
  try {
    await audio.play();
  } catch {
    audio.loop = false;
    button.textContent = "재생을 시작하지 못했어요";
    setTimeout(() => setRepeatButton(button, false), 1800);
    return;
  }
  activeRepeat = { audio, button };
  setRepeatButton(button, true);
  if ("mediaSession" in navigator) {
    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: button.dataset.title,
        artist: "Bubblelab Assets",
        artwork: [{ src: new URL(button.dataset.preview, location.href).href, type: "image/webp" }],
      });
    }
    navigator.mediaSession.playbackState = "playing";
  }
}

function render() {
  const query = search.value.trim().toLocaleLowerCase("ko");
  const visible = items.filter((item) =>
    !query || [item.title, item.description, ...(item.tags || [])].join(" ").toLocaleLowerCase("ko").includes(query));
  count.textContent = `${visible.length}개`;
  if (!visible.length) {
    grid.innerHTML = `<div class="state">${items.length ? "검색 결과가 없습니다." : "아직 등록된 에셋이 없습니다.<br>새로운 에셋이 곧 추가될 예정입니다."}</div>`;
    return;
  }
  grid.innerHTML = visible.map((item) => `
    <article class="card">
      <div class="preview">${previewMarkup(item)}</div>
      <div class="info">
        <div class="title-row">
          <h2>${esc(item.title)}</h2>
          <span class="item-download-count">총 ${numberFormat.format(downloadCounts.items[`${item.category}/${item.id}`] || 0)}회</span>
        </div>
        <p class="description">${esc(item.description || "Bubblelab에서 만든 에셋입니다.")}</p>
        ${playerMarkup(item)}
        <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">#${esc(tag)}</span>`).join("")}</div>
        <div class="downloads">${item.downloads.map((download) =>
          `<div class="download-item">
            <a class="download" href="/_download/${encodeURIComponent(item.category)}/${encodeURIComponent(item.id)}/${encodeURIComponent(download.file)}" download="${esc(download.file)}">↓ ${esc(download.label)}</a>
            <span class="download-count">${numberFormat.format(downloadCounts.files[`${item.category}/${item.id}/${download.file}`] || 0)}회 다운로드</span>
          </div>`).join("")}</div>
      </div>
    </article>`).join("");
  for (const video of grid.querySelectorAll("video")) {
    video.muted = true;
    if (animatePreviews) video.play()?.catch(() => {});
  }
  for (const button of grid.querySelectorAll("[data-repeat-player]")) {
    button.addEventListener("click", () => toggleRepeat(button));
  }
}

if ("mediaSession" in navigator) {
  const setMediaAction = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  };
  setMediaAction("play", () => {
    activeRepeat?.audio.play().then(() => { navigator.mediaSession.playbackState = "playing"; }).catch(() => {});
  });
  setMediaAction("pause", () => {
    activeRepeat?.audio.pause();
    navigator.mediaSession.playbackState = "paused";
  });
  setMediaAction("stop", stopRepeat);
}

search.addEventListener("input", render);

try {
  const [response, countsResponse] = await Promise.all([
    fetch("/_assets/catalog.json", { cache: "no-cache" }),
    fetch("/_asset-downloads", { cache: "no-cache" }).catch(() => null),
  ]);
  if (!response.ok) throw new Error("catalog unavailable");
  const catalog = await response.json();
  if (countsResponse?.ok) downloadCounts = await countsResponse.json();
  items = (catalog.items || []).filter((item) => item.category === category);
  search.hidden = items.length < 5;
  render();
} catch {
  count.textContent = "";
  grid.innerHTML = '<div class="state">에셋 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</div>';
}
