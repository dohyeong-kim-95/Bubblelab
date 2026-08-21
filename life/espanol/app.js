import {
  INTERVALS, REACTION_LEAD, STORAGE_KEY,
  addSong, clearMarks, deckLines, dueLines, emptyState, grade, kstDate, lineAt, lineSpan,
  parseState, progressOf, removeSong, setLineKo, setMark, songById, timeline, updateSong,
} from "./store.js";
import { readLine } from "./pronounce.js";
import { glossLine } from "./words.js";
import { AUDIO_MAX_BYTES, clipUrl, loadClip, removeClip, saveClip } from "./audio.js";

const $ = (id) => document.getElementById(id);
const player = $("player");

let state = load();
let songId = null;      // 보고 있는 곡
let queue = [];         // 연습에 남은 줄
let step = 0;           // 0 아무것도 · 1 소리 · 2 뜻까지
let clip = null;        // { id, name, data }
let clipSrc = null;     // blob: 주소 (재생용)
let stopAt = null;      // 구간 반복의 끝
let editing = null;     // 편집 중인 곡 id (없으면 새 노래)
let glossing = null;    // 뜻을 달고 있는 줄 id
let syncAt = 0;         // 줄 맞추기에서 가리키는 줄 번호

function load() {
  try { return parseState(localStorage.getItem(STORAGE_KEY)); } catch { return emptyState(); }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 공간이 없으면 화면만 유지 */ }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

const current = () => songById(state, songId);

/* ── 소리 ────────────────────────────────────────────────────────────────
 * 음원이 있고 그 줄의 시각을 찍어 뒀으면 진짜 노래를, 아니면 브라우저 음성을
 * 쓴다. 둘 다 없으면 조용히 실패하지 않고 그렇다고 말해 준다. */
const spanishVoice = () =>
  globalThis.speechSynthesis?.getVoices().find((voice) => voice.lang?.startsWith("es")) ?? null;

function speak(text) {
  const synth = globalThis.speechSynthesis;
  if (!synth) return false;
  const voice = spanishVoice();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  utterance.rate = 0.9;                       // 노래 속도에 가깝게 조금 늦춘다
  if (voice) utterance.voice = voice;
  synth.cancel();
  synth.speak(utterance);
  return Boolean(voice);
}

player.addEventListener("timeupdate", () => {
  if (stopAt !== null && player.currentTime >= stopAt) { player.pause(); stopAt = null; }
});

/** 그 줄만 들려준다. 음원 구간이 있으면 그것, 없으면 읽어 주기. */
function playLine(line) {
  const song = current();
  const span = song && clipSrc ? lineSpan(song, line.id) : null;
  if (span) {
    stopAt = span.end;
    player.currentTime = span.start;
    player.play().catch(() => { /* 사용자 동작 없이 막히면 조용히 넘어간다 */ });
    return true;
  }
  return speak(line.es);
}

function stopSound() {
  stopAt = null;
  player.pause();
  globalThis.speechSynthesis?.cancel();
}

/* ── 소리 표시 ───────────────────────────────────────────────────────────
 * 한 덩어리가 한 박이다. 강세 음절만 밝게 주고, 앞 단어에서 소리가 넘어온
 * 자리에는 이음표를 둔다 — 가사만 봐서는 절대 안 보이는 것이 그것이다. */
function soundNodes(text) {
  const box = document.createDocumentFragment();
  for (const [index, unit] of readLine(text).entries()) {
    if (unit.space && index) box.append(node("span", "gap", " "));
    else if (unit.linked) box.append(node("span", "tie", "‿"));
    box.append(node("span", `beat${unit.stress ? " on" : ""}`, unit.ko));
  }
  return box;
}

const BARS = ["", "▁", "▃", "▅", "▆", "█"];

function glossNodes(text, host) {
  host.textContent = "";
  const found = glossLine(text);
  for (const entry of found) {
    const row = node("li", "gloss-row");
    row.append(node("b", null, entry.es), node("span", null, entry.ko));
    host.append(row);
  }
  host.hidden = found.length === 0;
  return found.length;
}

/* ── 화면 고르기 ─────────────────────────────────────────────────────────
 * 주소의 해시가 곧 화면이다. 뒤로 가기가 그대로 동작해야 PWA 에서 헤매지 않는다. */
function route() {
  const hash = location.hash.replace(/^#/, "");
  const [, kind, id] = hash.match(/^\/([spv])\/(.+)$/) ?? [];
  const song = id ? songById(state, id) : null;
  songId = song?.id ?? null;
  stopSound();

  const view = song ? ({ p: "practice", v: "player" }[kind] ?? "song") : "list";
  $("view-list").hidden = view !== "list";
  $("view-song").hidden = view !== "song";
  $("view-practice").hidden = view !== "practice";
  $("view-player").hidden = view !== "player";
  $("add-button").hidden = view !== "list";
  $("song-menu").hidden = view !== "song";
  // 재생은 가사만 남기고 다 치운다 — lyric video 를 보는 화면이다.
  document.querySelector(".bar").hidden = view === "player";
  $("back").setAttribute("href", view === "list" ? "../" : view === "song" ? "#/" : `#/s/${songId}`);

  if (view === "list") { renderList(); return; }
  loadClipFor(song.id);
  if (view === "song") { renderSong(); return; }
  if (view === "player") { startPlayer(); return; }
  startPractice();
}

/* ── ① 곡 목록 ──────────────────────────────────────────────────────────── */
function renderList() {
  $("heading").textContent = "노래 스페인어";
  $("count").textContent = state.songs.length ? `${state.songs.length}곡` : "";
  const host = $("songs");
  host.textContent = "";
  for (const song of state.songs) {
    const stat = progressOf(song);
    const item = node("li", "song");
    const link = node("a", "song-link");
    link.href = `#/s/${song.id}`;
    const head = node("span", "song-head");
    head.append(node("b", null, song.title));
    if (song.artist) head.append(node("span", "song-artist", song.artist));
    link.append(head);
    link.append(node("span", "song-stat",
      `가사 없이 아는 줄 ${stat.known}/${stat.total}${stat.due ? ` · 오늘 ${stat.due}줄` : ""}`));
    const bar = node("span", "meter");
    const fill = node("span", "meter-fill");
    fill.style.width = `${stat.total ? Math.round((stat.known / stat.total) * 100) : 0}%`;
    bar.append(fill);
    link.append(bar);
    item.append(link);
    host.append(item);
  }
  $("empty").hidden = state.songs.length > 0;
}

/* ── ② 곡 한 편 ─────────────────────────────────────────────────────────── */
function renderSong() {
  const song = current();
  if (!song) { location.hash = "#/"; return; }
  $("heading").textContent = song.title;
  $("count").textContent = song.artist;
  const stat = progressOf(song);
  $("song-progress").textContent =
    `가사 없이 아는 줄 ${stat.known}/${stat.total} · 오늘 연습할 줄 ${stat.due}줄`;
  $("start-practice").textContent = stat.due ? `🎧 연습 시작 — ${stat.due}줄` : "🎧 다시 훑어보기";
  // 원곡을 틀려면 음원과 찍어 둔 줄이 둘 다 있어야 한다 — 없으면 오갈 자리가 없다.
  $("start-player").hidden = !clip || !timeline(song).length;

  const host = $("lines");
  host.textContent = "";
  for (const line of song.lines) {
    const row = node("li", "line");
    const play = node("button", "line-play", "▶︎");
    play.type = "button";
    play.setAttribute("aria-label", `${line.es} 듣기`);
    play.addEventListener("click", () => playLine(line));

    const body = node("button", "line-body");
    body.type = "button";
    // 원어가 주인공이고 소리는 그 밑에 붙는 도움말이다 — 읽을 줄 아는 사람에게
    // 한글 소리가 먼저 오면 눈이 그쪽으로 끌려 원문을 안 보게 된다.
    const sound = node("span", "sound");
    sound.append(soundNodes(line.es));
    body.append(node("span", "es", line.es), sound);
    if (line.ko) body.append(node("span", "ko", line.ko));
    body.addEventListener("click", () => openGloss(line));

    const box = node("span", "box", BARS[line.box] || "");
    box.title = `${line.box}/${INTERVALS.length - 1} 단계`;
    row.append(play, body, box);
    if (line.t !== null) row.classList.add("marked");
    host.append(row);
  }
}

/* ── ③ 연습 ─────────────────────────────────────────────────────────────
 * 한 줄이 카드 하나고, 세 단계로만 열린다.
 *
 *   ① 소리만          듣기 — 가사를 먼저 보여 주면 읽기 연습이 되어 버린다
 *   ② 원어            읽고 따라 부르기. 여기까지 되는 것이 목표 상태다
 *   ③ 음차 + 뜻 + 사전  ②에서 막혔을 때의 도움
 *
 * 음차를 ②에 같이 두면 눈이 그쪽으로 가서 원어를 영영 읽지 않게 된다. */
function startPractice() {
  const song = current();
  if (!song) { location.hash = "#/"; return; }
  $("heading").textContent = "연습";
  $("count").textContent = "";
  const due = dueLines(song, kstDate());
  queue = due.length ? [...due] : [...deckLines(song)];
  step = 0;
  renderCard();
}

function renderCard() {
  const song = current();
  const done = queue.length === 0;
  $("card").hidden = done;
  $("reveal").hidden = done || step >= 2;
  $("again").hidden = done || step < 2;
  $("got").hidden = done || step < 2;
  $("practice-done").hidden = !done;
  if (done) {
    const stat = progressOf(song);
    $("practice-progress").textContent = "";
    $("practice-done").textContent =
      `오늘 몫을 끝냈습니다. 가사 없이 아는 줄 ${stat.known}/${stat.total}.`;
    return;
  }

  const line = queue[0];
  $("practice-progress").textContent = `${queue.length}줄 남음`;
  $("reveal").textContent = step === 0 ? "원어 보기" : "음차·뜻 보기";
  $("card-hint").textContent = step === 0
    ? "무슨 뜻이었는지 떠올려 보세요"
    : step === 1 ? "원어를 보고 따라 불러 보세요" : "";

  // 원어가 먼저, 음차는 마지막이다 — 음차를 같이 열어 주면 원어를 읽으려 하지 않는다.
  $("card-es").hidden = step < 1;
  $("card-es").textContent = line.es;

  const sound = $("card-sound");
  sound.textContent = "";
  sound.hidden = step < 2;
  if (step >= 2) sound.append(soundNodes(line.es));
  $("card-ko").hidden = step < 2 || !line.ko;
  $("card-ko").textContent = line.ko;
  if (step >= 2) glossNodes(line.es, $("card-gloss"));
  else $("card-gloss").hidden = true;

  if (step === 0 && !playLine(line) && !clipSrc) {
    $("card-hint").textContent =
      "이 기기에 스페인어 음성이 없습니다 — 음원을 넣으면 노래로 연습할 수 있어요";
  }
}

function answer(ok) {
  const line = queue.shift();
  state = grade(state, songId, line.id, ok);
  save();
  // 틀린 줄은 이번 판 안에서 다시 돌아온다. 다음 날로 미루면 틀린 채로 굳는다.
  if (!ok) queue.push(songById(state, songId).lines.find((entry) => entry.id === line.id) ?? line);
  step = 0;
  renderCard();
}

$("reveal").addEventListener("click", () => { step = Math.min(step + 1, 2); renderCard(); });
$("again").addEventListener("click", () => answer(false));
$("got").addEventListener("click", () => answer(true));
$("play").addEventListener("click", () => { if (queue[0]) playLine(queue[0]); });
$("start-practice").addEventListener("click", () => { location.hash = `#/p/${songId}`; });
$("start-player").addEventListener("click", () => { location.hash = `#/v/${songId}`; });

/* ── 노래 넣기·고치기 ────────────────────────────────────────────────────── */
function openEditor(song) {
  editing = song?.id ?? null;
  $("editor-title").textContent = song ? "노래 고치기" : "노래 넣기";
  $("title-input").value = song?.title ?? "";
  $("artist-input").value = song?.artist ?? "";
  $("lyrics-input").value = song ? song.lines.map((line) => line.es).join("\n") : "";
  $("editor-error").textContent = "";
  $("editor").showModal();
}

$("add-button").addEventListener("click", () => openEditor(null));
$("editor-cancel").addEventListener("click", () => $("editor").close());
$("editor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = {
    title: $("title-input").value,
    artist: $("artist-input").value,
    lyrics: $("lyrics-input").value,
  };
  try {
    state = editing ? updateSong(state, editing, fields) : addSong(state, fields);
  } catch (error) {
    $("editor-error").textContent = error.message;
    return;
  }
  save();
  $("editor").close();
  if (editing) route();
  else location.hash = `#/s/${state.songs[0].id}`;   // 새 곡은 바로 열어 준다
});

/* ── 줄의 뜻 ─────────────────────────────────────────────────────────────
 * 아는 낱말은 이미 달려 있다. 손으로 적는 것은 낱말만으로 안 되는 줄뿐이다. */
function openGloss(line) {
  glossing = line.id;
  $("gloss-es").textContent = line.es;
  const sound = $("gloss-sound");
  sound.textContent = "";
  sound.append(soundNodes(line.es));
  glossNodes(line.es, $("gloss-known"));
  $("gloss-input").value = line.ko;
  $("gloss-dialog").showModal();
}

$("gloss-cancel").addEventListener("click", () => $("gloss-dialog").close());
$("gloss-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state = setLineKo(state, songId, glossing, $("gloss-input").value);
  save();
  $("gloss-dialog").close();
  renderSong();
});

/* ── 곡 메뉴 ─────────────────────────────────────────────────────────────── */
$("song-menu").addEventListener("click", () => {
  $("menu-clip-remove").hidden = !clip;
  $("menu-remove").textContent = "이 노래 지우기";
  $("menu").showModal();
});
$("menu-close").addEventListener("click", () => $("menu").close());
$("menu-edit").addEventListener("click", () => { $("menu").close(); openEditor(current()); });
$("menu-reset-marks").addEventListener("click", () => {
  state = clearMarks(state, songId);
  save();
  $("menu").close();
  renderSong();
});
$("menu-clip-remove").addEventListener("click", async () => {
  await removeClip(songId);
  setClip(null);
  $("menu").close();
  renderSong();
});
// 지우면 되돌릴 수 없다 — 확인 없이 지우지 않는다(alert 은 PWA 에서 쓰지 않는다).
$("menu-remove").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.textContent !== "정말 지울까요?") { button.textContent = "정말 지울까요?"; return; }
  await removeClip(songId);
  state = removeSong(state, songId);
  save();
  $("menu").close();
  location.hash = "#/";
});

/* ── 음원 ────────────────────────────────────────────────────────────────── */
const sizeLabel = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
  : `${Math.round(bytes / 1024)}KB`);

function setClip(next) {
  if (clipSrc) URL.revokeObjectURL(clipSrc);
  clip = next;
  clipSrc = next ? clipUrl(next.data) : null;
  // src="" 로 두면 브라우저가 이 페이지를 음원으로 받아 보려다 실패한다.
  if (clipSrc) player.src = clipSrc;
  else { player.removeAttribute("src"); player.load(); }
  // 영상에서 소리만 남겼으면 그렇다고 말해 준다 — 넣은 파일과 크기가 달라 보인다.
  $("clip-name").textContent = next
    ? `${next.name}${next.kind === "sound" ? " · 소리만" : ""} ${sizeLabel(next.size)}`
    : "";
  $("clip-pick").textContent = next ? "🎵 음원 바꾸기" : "🎵 음원 넣기";
  $("clip-sync").hidden = !next;
}

async function loadClipFor(id) {
  // 이미 물려 있으면 그대로 둔다. 다시 걸면 src 가 새 blob 이 되어 **재생 위치가
  // 0 으로 돌아간다** — 곡 ⇄ 연습 ⇄ 재생 을 오갈 때마다 처음으로 튀던 원인이다.
  if (clip?.id === id) return;
  const found = await loadClip(id);
  // 그 사이 다른 곡으로 옮겨 갔으면 버린다.
  if (songId !== id) return;
  setClip(found);
  // 음원 유무에 따라 재생 버튼이 달라진다 — 받아 온 뒤 한 번 더 그린다.
  if (!$("view-song").hidden) renderSong();
}

$("clip-pick").addEventListener("click", () => $("clip-input").click());
$("clip-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  $("clip-error").textContent = "";
  if (!file) return;
  const pick = $("clip-pick");
  const label = pick.textContent;
  pick.disabled = true;
  // 영상에서 소리를 뽑는 데 몇 초 걸린다. 아무 반응이 없으면 고장으로 받아들인다.
  pick.textContent = file.type.startsWith("video/") ? "소리만 뽑는 중…" : "넣는 중…";
  try {
    setClip(await saveClip(songId, file));
  } catch (error) {
    $("clip-error").textContent = error.message
      ?? `${Math.round(AUDIO_MAX_BYTES / 1024 / 1024)}MB 까지만 넣을 수 있어요`;
    pick.textContent = label;
  } finally {
    pick.disabled = false;
  }
});

/* 줄 맞추기 — 들으면서 줄이 시작할 때마다 누른다. 파형을 그리거나 자동으로
 * 맞추려 들지 않는다. 노래 한 곡은 3분이고, 그동안 스무 번 누르면 끝난다.
 *
 * 대신 되감을 수 있어야 한다. 한 줄 놓쳤다고 처음부터 다시 듣게 하면 아무도
 * 끝까지 안 한다 — 재생바·±3초·"앞 줄로" 가 그것을 위해 있다. */
const clock = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

let scrubbing = false;

/** 재생바·시각·재생 버튼을 지금 상태에 맞춘다. 끌고 있는 동안에는 손잡이를 뺏지 않는다. */
function renderScrub() {
  if (!$("sync").open) return;
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  const seek = $("sync-seek");
  seek.max = duration || 0;
  if (!scrubbing) seek.value = player.currentTime || 0;
  $("sync-time").textContent = `${clock(player.currentTime)} / ${clock(duration)}`;
  $("sync-play").textContent = player.paused ? "▶︎" : "⏸";
}

for (const event of ["timeupdate", "loadedmetadata", "play", "pause", "seeked"]) {
  player.addEventListener(event, renderScrub);
}

const seekTo = (seconds) => {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  player.currentTime = Math.min(Math.max(seconds, 0), duration || 0);
  renderScrub();
};

$("sync-seek").addEventListener("input", (event) => {
  scrubbing = true;
  seekTo(Number(event.target.value));
});
$("sync-seek").addEventListener("change", () => { scrubbing = false; });
$("sync-play").addEventListener("click", () => {
  if (player.paused) player.play().catch(() => { /* 막히면 다시 누른다 */ });
  else player.pause();
  renderScrub();
});
$("sync-back3").addEventListener("click", () => seekTo(player.currentTime - 3));
$("sync-fwd3").addEventListener("click", () => seekTo(player.currentTime + 3));

function renderSync() {
  const song = current();
  const line = song.lines[syncAt];
  if (!line) { closeSync(); return; }
  $("sync-line").textContent = line.es;
  const sound = $("sync-sound");
  sound.textContent = "";
  sound.append(soundNodes(line.es));
  $("sync-at").textContent = line.t === null
    ? `${syncAt + 1} / ${song.lines.length}`
    : `${syncAt + 1} / ${song.lines.length} · 찍어 둔 시각 ${line.t.toFixed(1)}초`;
  renderScrub();
}

function closeSync() {
  player.pause();
  $("sync").close();
  renderSong();
}

$("clip-sync").addEventListener("click", () => {
  syncAt = 0;
  stopAt = null;
  player.currentTime = 0;
  player.play().catch(() => { /* 막히면 사용자가 다시 누른다 */ });
  renderSync();
  $("sync").showModal();
});
$("sync-now").addEventListener("click", () => {
  const line = current().lines[syncAt];
  // 들은 뒤에 손이 움직인다 — 누른 자리가 아니라 그보다 앞을 찍는다.
  state = setMark(state, songId, line.id, player.currentTime - REACTION_LEAD);
  save();
  syncAt += 1;
  renderSync();
});
$("sync-skip").addEventListener("click", () => { syncAt += 1; renderSync(); });
/* 앞 줄로 갈 때는 소리도 그 자리로 되돌린다 — 찍은 시각이 틀렸다는 걸 알고 돌아오는
 * 것이라, 거기서 다시 들어야 고칠 수 있다. */
$("sync-back").addEventListener("click", () => {
  syncAt = Math.max(0, syncAt - 1);
  const mark = current()?.lines[syncAt]?.t;
  if (Number.isFinite(mark)) seekTo(mark);
  renderSync();
});
$("sync-close").addEventListener("click", closeSync);

/* ── ④ 재생 (lyric video) ────────────────────────────────────────────────
 * 원곡을 그대로 틀고 문장 단위로 오간다. 줄 맞추기에서 찍어 둔 시각이 그대로
 * 문장의 경계가 된다(store.js 의 timeline) — 여기서 새로 재지 않는다.
 *
 * 진행은 timeupdate(초당 네 번)가 아니라 rAF 로 그린다. 글자가 네 칸씩 끊겨
 * 차오르면 노래를 따라가는 느낌이 사라진다. */
let frame = null;
let lyricAt = -2;        // 지금 그려 둔 문장 번호 (-1 은 첫 문장 전, -2 는 아직 안 그림)
let repeatOne = false;

function stopFrames() {
  if (frame) cancelAnimationFrame(frame);
  frame = null;
}

function drawLyric(force) {
  const song = current();
  if (!song) return;
  const marks = timeline(song);
  const index = lineAt(song, player.currentTime);
  const now = marks[index] ?? null;

  if (force || index !== lyricAt) {
    lyricAt = index;
    $("lv-prev").textContent = marks[index - 1]?.line.es ?? "";
    $("lv-next").textContent = marks[index + 1]?.line.es ?? "";
    const line = now?.line;
    $("lv-line").textContent = line?.es ?? "";
    const sound = $("lv-sound");
    sound.textContent = "";
    if (line) sound.append(soundNodes(line.es));
    $("lv-ko").textContent = line?.ko ?? "";
    // 새 문장은 아래에서 올라오며 뜬다. 클래스를 다시 붙이려면 리플로우가 한 번 필요하다.
    $("lv-line").classList.remove("lv-in");
    void $("lv-line").offsetWidth;
    $("lv-line").classList.add("lv-in");
  }

  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  // 이 문장 안에서 지금 어디쯤인가 — 글자가 그만큼 차오른다.
  const end = now ? now.end ?? duration : 0;
  const done = now && end > now.start ? (player.currentTime - now.start) / (end - now.start) : 0;
  $("lv-line").style.setProperty("--fill", `${Math.min(Math.max(done, 0), 1) * 100}%`);

  if (repeatOne && now?.end !== null && now && player.currentTime >= now.end) {
    player.currentTime = now.start;
  }

  const seek = $("lv-seek");
  seek.max = duration || 0;
  if (!scrubbing) seek.value = player.currentTime || 0;
  $("lv-time").textContent = `${clock(player.currentTime)} / ${clock(duration)}`;
  $("lv-play").textContent = player.paused ? "▶︎" : "⏸";
}

function tick() {
  if ($("view-player").hidden) { stopFrames(); return; }
  drawLyric(false);
  frame = requestAnimationFrame(tick);
}

function startPlayer() {
  const marks = timeline(current());
  if (!marks.length) { location.hash = `#/s/${songId}`; return; }
  stopAt = null;                       // 구간 반복(연습)이 걸려 있으면 풀어 준다
  lyricAt = -2;
  // 도입부를 멀뚱히 보고 있게 하지 않는다 — 첫 문장 앞이면 거기서부터.
  if (!(player.currentTime > marks[0].start)) player.currentTime = marks[0].start;
  player.play().catch(() => { /* 막히면 ▶ 로 시작한다 */ });
  drawLyric(true);
  if (!frame) frame = requestAnimationFrame(tick);
}

/** 문장 단위로 오간다. 한참 들은 뒤의 ⏮ 은 지금 문장 처음으로 (음악 앱과 같은 관례). */
function jump(delta) {
  const song = current();
  const marks = timeline(song);
  const index = lineAt(song, player.currentTime);
  const started = marks[index]?.start ?? 0;
  const target = delta < 0 && index >= 0 && player.currentTime - started > 1.5 ? index : index + delta;
  // 마지막 문장에서 ⏭ 은 할 일이 없다 — 그 문장을 다시 시작해 버리면 갇힌 것처럼 보인다.
  if (target >= marks.length) return;
  const entry = marks[Math.max(target, 0)];
  if (!entry) return;
  player.currentTime = entry.start;
  drawLyric(true);
}

$("lv-close").addEventListener("click", () => { location.hash = `#/s/${songId}`; });
$("lv-back").addEventListener("click", () => jump(-1));
$("lv-forward").addEventListener("click", () => jump(1));
$("lv-play").addEventListener("click", () => {
  if (player.paused) player.play().catch(() => { /* 막히면 다시 누른다 */ });
  else player.pause();
  drawLyric(false);
});
$("lv-seek").addEventListener("input", (event) => {
  scrubbing = true;
  player.currentTime = Number(event.target.value);
  drawLyric(false);
});
$("lv-seek").addEventListener("change", () => { scrubbing = false; });
$("lv-repeat").addEventListener("click", () => {
  repeatOne = !repeatOne;
  $("lv-repeat").setAttribute("aria-pressed", String(repeatOne));
  $("lv-repeat").classList.toggle("on", repeatOne);
});

/* ── 시작 ────────────────────────────────────────────────────────────────── */
globalThis.speechSynthesis?.addEventListener?.("voiceschanged", () => {
  if (!$("view-practice").hidden && step === 0) renderCard();
});
/* 서비스워커는 캐시에서 먼저 내주고 뒤에서 새 버전을 받는다. 본체(life/app.js)는
 * 그때 다시 그리는데 도구 페이지에 그 처리가 없으면, 배포한 것이 "다음 번에 열 때"가
 * 아니라 "그다음 번에 열 때" 나타난다. 하던 일이 날아갈 때는 건드리지 않는다. */
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type !== "life:updated") return;
  if (!$("view-practice").hidden || document.querySelector("dialog[open]") || $("clip-pick").disabled) return;
  location.reload();
});

window.addEventListener("hashchange", route);
window.addEventListener("pagehide", stopSound);
route();
