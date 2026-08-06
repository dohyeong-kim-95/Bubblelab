const category = document.body.dataset.category;
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const count = document.getElementById("count");
const deviceTabs = document.getElementById("device-tabs");
// 배경화면은 크게 봐야 고르는 물건이라 미리보기를 눌러 전체 화면으로 연다.
const zoomable = category === "wallpaper";
let device = "all";
let items = [];
let visibleItems = [];
let downloadCounts = { files: {}, items: {} };
const animatePreviews = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let activeRepeat = null;
const numberFormat = new Intl.NumberFormat("ko-KR");

const esc = (value) => String(value).replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[char]);

// 배경화면 [모바일 | PC] 탭. 분류는 metadata 의 device 를 그대로 쓰고,
// 손으로 쓴 항목을 위해 규격 파일명(mobile/tablet/desktop/wide)으로 한 번 더
// 짐작한다. 둘 다 없으면 null — 정사각·원본처럼 양쪽에 다 보이는 파일이다.
const FILE_DEVICE = { mobile: "mobile", tablet: "mobile", desktop: "desktop", wide: "desktop" };

function downloadDevice(download) {
  if (download.device === "mobile" || download.device === "desktop") return download.device;
  return FILE_DEVICE[download.file.replace(/\.[^.]+$/, "").toLowerCase()] || null;
}

const matchesDevice = (download) => device === "all" || (downloadDevice(download) ?? device) === device;

// 미리보기 칸을 항목 비율에 맞춘다 (세로 배경화면은 세로 칸). 카드 높이가
// 끝없이 늘어나지 않게 세로 1:2, 가로 4:3 에서 자른다 — 그 밖은 남는 쪽에
// 여백이 생기지만 그림이 잘리지는 않는다.
const ASPECT_MIN = 0.5;
const ASPECT_MAX = 4 / 3;

function previewAspectStyle(item) {
  const { width, height } = item.previewSize || {};
  if (!width || !height) return "";
  const ratio = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, width / height));
  return ` style="aspect-ratio: ${ratio.toFixed(4)}"`;
}

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
    (!query || [item.title, item.description, ...(item.tags || [])].join(" ").toLocaleLowerCase("ko").includes(query))
    && item.downloads.some(matchesDevice));
  count.textContent = `${visible.length}개`;
  if (!visible.length) {
    const empty = !items.length
      ? "아직 등록된 에셋이 없습니다.<br>새로운 에셋이 곧 추가될 예정입니다."
      : query ? "검색 결과가 없습니다."
      : device === "mobile" ? "아직 모바일 배경화면이 없습니다."
      : device === "desktop" ? "아직 PC 배경화면이 없습니다."
      : "검색 결과가 없습니다.";
    visibleItems = [];
    grid.innerHTML = `<div class="state">${empty}</div>`;
    return;
  }
  visibleItems = visible;
  grid.innerHTML = visible.map((item) => `
    <article class="card">
      <div class="preview"${previewAspectStyle(item)}${zoomable
        ? ` tabindex="0" role="button" data-zoom="${esc(item.id)}" aria-label="${esc(item.title)} 크게 보기"`
        : ""}>${previewMarkup(item)}${zoomable ? '<span class="zoom-hint" aria-hidden="true">⤢</span>' : ""}</div>
      <div class="info">
        <div class="title-row">
          <h2>${esc(item.title)}</h2>
          <span class="item-download-count">총 ${numberFormat.format(downloadCounts.items[`${item.category}/${item.id}`] || 0)}회</span>
        </div>
        <p class="description">${esc(item.description || "Bubblelab에서 만든 에셋입니다.")}</p>
        ${playerMarkup(item)}
        <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">#${esc(tag)}</span>`).join("")}</div>
        <div class="downloads">${
          category === "sticker" && item.downloads.length > 1
            ? `<button class="download-all" type="button" data-download-all="${esc(item.id)}">↓ 스티커 팩 모두 받기 (${item.downloads.length}개 ZIP)</button>`
            : ""}${item.downloads.filter(matchesDevice).map((download) =>
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
  for (const button of grid.querySelectorAll("[data-download-all]")) {
    button.addEventListener("click", () => downloadAll(button));
  }
  for (const zone of grid.querySelectorAll("[data-zoom]")) {
    zone.addEventListener("click", () => openZoom(zone.dataset.zoom));
    zone.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openZoom(zone.dataset.zoom);
    });
  }
}

// ── 크게 보기 ────────────────────────────────────────────────────────────
// 카드 썸네일은 최대 800px 미리보기라 배경화면을 고르기엔 작다. 눌러서
// 전체 화면으로 열고, 실제 다운로드 파일을 그대로 띄운다(누를 때만 받는다).
// 화살표로 지금 보이는 목록 안에서 이동, Esc 로 닫는다.
let zoom = null;
let zoomIndex = -1;
let zoomOpener = null;

function zoomFile(item) {
  return item.downloads.find(matchesDevice) || item.downloads[0];
}

function ensureZoom() {
  if (zoom) return zoom;
  zoom = document.createElement("div");
  zoom.className = "zoom-layer";
  zoom.hidden = true;
  zoom.setAttribute("role", "dialog");
  zoom.setAttribute("aria-modal", "true");
  zoom.innerHTML = `
    <button class="zoom-close" type="button" aria-label="닫기">✕</button>
    <button class="zoom-step" data-step="-1" type="button" aria-label="이전 배경화면">‹</button>
    <img alt="">
    <button class="zoom-step" data-step="1" type="button" aria-label="다음 배경화면">›</button>
    <div class="zoom-bar"><span class="zoom-title"></span><a class="download zoom-download" download>↓</a></div>`;
  zoom.addEventListener("click", (event) => {
    const step = event.target.closest("[data-step]");
    if (step) return showZoom(zoomIndex + Number(step.dataset.step));
    // 이미지·버튼 바깥(배경)을 누르면 닫는다
    if (event.target === zoom || event.target.closest(".zoom-close")) closeZoom();
  });
  document.body.appendChild(zoom);
  return zoom;
}

function showZoom(index) {
  if (!visibleItems.length) return;
  zoomIndex = (index + visibleItems.length) % visibleItems.length;
  const item = visibleItems[zoomIndex];
  const download = zoomFile(item);
  const layer = ensureZoom();
  const image = layer.querySelector("img");
  image.src = download ? download.url : item.preview;
  image.alt = `${item.title} 크게 보기`;
  layer.querySelector(".zoom-title").textContent = item.title;
  const link = layer.querySelector(".zoom-download");
  link.hidden = !download;
  if (download) {
    link.href = `/_download/${encodeURIComponent(item.category)}/${encodeURIComponent(item.id)}/${encodeURIComponent(download.file)}`;
    link.setAttribute("download", download.file);
    link.textContent = `↓ ${download.label}`;
  }
  for (const step of layer.querySelectorAll("[data-step]")) step.hidden = visibleItems.length < 2;
}

function openZoom(id) {
  const index = visibleItems.findIndex((item) => item.id === id);
  if (index < 0) return;
  zoomOpener = document.activeElement;
  showZoom(index);
  zoom.hidden = false;
  document.body.classList.add("zoom-open");
  zoom.querySelector(".zoom-close").focus();
}

function closeZoom() {
  if (!zoom || zoom.hidden) return;
  zoom.hidden = true;
  zoom.querySelector("img").removeAttribute("src");
  document.body.classList.remove("zoom-open");
  zoomOpener?.focus?.();
  zoomOpener = null;
}

addEventListener("keydown", (event) => {
  if (!zoom || zoom.hidden) return;
  if (event.key === "Escape") closeZoom();
  else if (event.key === "ArrowLeft") showZoom(zoomIndex - 1);
  else if (event.key === "ArrowRight") showZoom(zoomIndex + 1);
});

// 팩 전체를 한 번에: 각 파일을 받아 무압축 ZIP 하나로 묶어 내려준다.
// (모바일 브라우저는 탭당 다운로드 1개만 허용 → 개별 16회 다운로드가 불가)
async function downloadAll(button) {
  const item = items.find((entry) => entry.id === button.dataset.downloadAll);
  if (!item || typeof window.blMakeZip !== "function") return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "받는 중…";
  try {
    const files = await Promise.all(item.downloads.map(async (download) => {
      const response = await fetch(
        `/_download/${encodeURIComponent(item.category)}/${encodeURIComponent(item.id)}/${encodeURIComponent(download.file)}`,
        { cache: "no-cache" },
      );
      if (!response.ok) throw new Error(download.file);
      return { name: download.file, data: new Uint8Array(await response.arrayBuffer()) };
    }));
    const blob = window.blMakeZip(files);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${item.id}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    button.textContent = "완료 ✓";
  } catch {
    button.textContent = "받기 실패 — 다시 시도";
  } finally {
    setTimeout(() => { button.disabled = false; button.textContent = original; }, 1800);
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

deviceTabs?.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-device]");
  if (!tab || tab.dataset.device === device) return;
  device = tab.dataset.device;
  for (const button of deviceTabs.querySelectorAll("[data-device]")) {
    button.setAttribute("aria-selected", String(button === tab));
  }
  render();
});

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
