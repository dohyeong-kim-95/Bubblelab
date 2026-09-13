const feed = document.querySelector("#feed");
const empty = document.querySelector("#empty");
const position = document.querySelector("#position");
const sound = document.querySelector("#sound");
const caption = document.querySelector("#caption");
const VIEWED_KEY = "bl_pops_viewed_v1";
const MAX_PREPARED_AHEAD = 1;

let items = [];
let activeIndex = -1;
let audible = false;
let wrapping = false;

const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[char]);

function readViewed() {
  try {
    const value = JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch { return new Set(); }
}

function markViewed(id) {
  const viewed = readViewed();
  viewed.add(id);
  localStorage.setItem(VIEWED_KEY, JSON.stringify([...viewed].slice(-1000)));
}

function renderItem(item, index) {
  const title = item.title || "스페인어 단어";
  const example = item.example ? `<p class="pop-example">${esc(item.example)}</p>` : "";
  const meta = [item.level, item.topic].filter(Boolean).map(esc).join(" · ");
  const video = document.createElement("video");
  video.className = "pop-video";
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.loop = true;
  video.preload = "none";
  video.dataset.src = item.src;
  if (item.poster) video.dataset.poster = item.poster;
  video.setAttribute("aria-label", `${title} 영상`);

  const article = document.createElement("article");
  article.className = "pop";
  article.dataset.index = String(index);
  article.append(video);
  article.insertAdjacentHTML("beforeend", `<div class="pop-copy">
    <p class="pop-kind">${esc(item.kind || "ESPAÑOL")}</p>
    <h1 class="pop-word">${esc(item.word || title)}</h1>
    <p class="pop-meaning">${esc(item.meaning || "")}</p>
    ${example}
    <div class="pop-meta"><span>${meta}</span><span>${esc(item.duration || "20초 이내")}</span></div>
  </div><span class="tap-hint" aria-hidden="true">재생</span>`);
  article.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    const current = article.querySelector("video");
    if (!current.src) return;
    if (current.paused) { current.play().catch(() => {}); article.classList.remove("paused"); }
    else { current.pause(); article.classList.add("paused"); }
  });
  return article;
}

function setSource(article, eager = false) {
  const video = article.querySelector("video");
  if (!video || video.src || !video.dataset.src) return;
  video.preload = eager ? "auto" : "metadata";
  video.src = video.dataset.src;
  if (video.dataset.poster) video.poster = video.dataset.poster;
  // 동적으로 src를 붙인 뒤에도 모바일 브라우저가 즉시 디코더를 준비하도록
  // 명시적으로 로드한다. 다음 영상은 metadata만, 현재 영상은 전체 선행 로드다.
  video.load();
}

function releaseSource(article) {
  const video = article.querySelector("video");
  if (!video || !video.src) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function updatePosition() {
  position.textContent = activeIndex < 0 ? "" : `${activeIndex + 1} / ${items.length}`;
}

function updateCaption(item, video) {
  const segments = Array.isArray(item.segments) ? item.segments : [];
  if (!segments.length || !Number.isFinite(video.currentTime)) return;
  const progress = video.duration > 0 ? video.currentTime / video.duration : 0;
  const segment = segments.find((one) => progress >= one.from && progress < one.to)
    || segments.at(-1);
  caption.textContent = segment.text || "";
  caption.className = `caption is-${segment.kind || "word"}`;
}

function activate(index) {
  if (index < 0 || index >= items.length) return;
  activeIndex = index;
  const cards = [...feed.querySelectorAll(".pop")];
  cards.forEach((card, cardIndex) => {
    const video = card.querySelector("video");
    const near = Math.abs(cardIndex - index) <= MAX_PREPARED_AHEAD;
    if (near) setSource(card, cardIndex === index);
    else releaseSource(card);
    if (cardIndex === index) {
      video.muted = !audible;
      video.ontimeupdate = () => updateCaption(items[index], video);
      video.onloadedmetadata = () => updateCaption(items[index], video);
      video.play().then(() => card.classList.remove("paused")).catch(() => card.classList.add("paused"));
      markViewed(items[index].id);
    } else if (video) {
      video.pause();
      card.classList.remove("paused");
    }
  });
  updatePosition();
}

function setAudible(next) {
  audible = next;
  sound.setAttribute("aria-pressed", String(audible));
  sound.textContent = audible ? "소리 켬" : "소리 끔";
  const video = feed.querySelector(`.pop[data-index="${activeIndex}"] video`);
  if (video) video.muted = !audible;
  if (video) updateCaption(items[activeIndex], video);
}

async function load() {
  let manifest;
  try {
    const response = await fetch("content/manifest.json", { cache: "no-cache" });
    manifest = await response.json();
  } catch {
    empty.textContent = "콘텐츠 목록을 불러오지 못했어요.";
    empty.hidden = false;
    return;
  }
  items = Array.isArray(manifest.items) ? manifest.items.filter((item) => item && item.id && item.src) : [];
  if (!items.length) { empty.hidden = false; return; }
  feed.replaceChildren(...items.map(renderItem));
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) activate(Number(visible.target.dataset.index));
  }, { root: feed, threshold: [0.6, 0.85] });
  for (const card of feed.querySelectorAll(".pop")) observer.observe(card);
  activate(0);
}

sound.addEventListener("click", () => setAudible(!audible));
feed.addEventListener("scroll", () => {
  if (wrapping || feed.scrollHeight <= feed.clientHeight) return;
  const last = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 2;
  const first = feed.scrollTop <= 2;
  if (!last && !first) return;
  wrapping = true;
  requestAnimationFrame(() => {
    feed.scrollTop = last ? 2 : feed.scrollHeight - feed.clientHeight - 2;
    wrapping = false;
  });
});
load();
