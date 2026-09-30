// 약속 화면. 규칙은 logic.js, 저장은 서버(/_yaksok, _infra/yaksok.js)가 맡는다.
import {
  CAPACITY_DEFAULT, CAPACITY_MAX, CAPACITY_MIN, CODE_RE, DINNER, FULL, LUNCH, NO, NONE, PHASES,
  PHOTO_MAX, SLOT_LABEL, STATE_LABEL,
  bestDates, calendarEvent, cleanAmount, dateLabel, datesBetween, dayCounts, kstToday, nextState,
  normalizeCode, randomCode, settle, tally, weekday, won,
} from "./logic.js";
import { drawSprite } from "./sprite.js";
import { cardPngBase64 } from "./card.js";
import { zipStore } from "./zip.js";

const $ = (id) => document.getElementById(id);
const API = "/_yaksok/rooms";
const STORE_KEY = "yaksok:rooms";
const POLL_MS = 8000;

// ── 기기에 남기는 것: 방 코드별 내 토큰과 방 이름 (내 약속 목록용) ──
function loadRooms() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}
function saveRoom(code, data) {
  const rooms = loadRooms();
  rooms[code] = { ...rooms[code], ...data, seen: Date.now() };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rooms)); } catch { /* 사생활 보호 모드 */ }
}
function forgetRoom(code) {
  const rooms = loadRooms();
  delete rooms[code];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rooms)); } catch {}
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["X-Yaksok-Token"] = token;
  const response = await fetch(`${API}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "잠시 후 다시 시도해 주세요."), { status: response.status, data });
  return data;
}

// 방 주소는 /yaksok/<코드> (로컬은 /util/yaksok/<코드>). "yaksok" 바로 다음 조각이 코드다 —
// "yaksok" 자체도 영문 6자라, 끝 조각만 보면 첫 화면을 방으로 착각한다.
const segments = location.pathname.split("/").filter(Boolean);
const afterYaksok = segments[segments.indexOf("yaksok") + 1] ?? "";
const code = segments.includes("yaksok") && CODE_RE.test(afterYaksok) && afterYaksok === segments.at(-1)
  ? afterYaksok : null;
const roomUrl = (c) => new URL(c, location.href.replace(/[^/]*([?#].*)?$/, "")).href;

// − / + 정원 조절기. 범위 밖으로는 버튼이 꺼진다.
function bindStepper(id, get, set, min = () => CAPACITY_MIN) {
  const box = $(id);
  const sync = () => {
    const [down, up] = box.querySelectorAll("button");
    down.disabled = get() <= min();
    up.disabled = get() >= CAPACITY_MAX;
  };
  box.addEventListener("click", async (event) => {
    const step = Number(event.target.closest("button")?.dataset.step);
    if (!step) return;
    const next = Math.min(CAPACITY_MAX, Math.max(min(), get() + step));
    if (next !== get()) await set(next);
    sync();
  });
  sync();
  return sync;
}

// ── 첫 화면 ──
function showHome() {
  $("home").hidden = false;
  const rooms = Object.entries(loadRooms()).sort((a, b) => b[1].seen - a[1].seen);
  if (rooms.length) {
    $("mine").hidden = false;
    $("mine-list").replaceChildren(...rooms.map(([c, r]) => {
      const a = document.createElement("a");
      a.href = c;
      const name = document.createElement("span");
      name.textContent = `🫧 ${c}`;
      const small = document.createElement("span");
      small.className = "muted";
      small.textContent = r.seen ? new Date(r.seen).toLocaleDateString("ko-KR") : "";
      a.append(name, small);
      return a;
    }));
  }
  // 코드 칸은 영문 소문자·숫자만 남긴다(대문자는 소문자로).
  for (const id of ["c-code", "e-code"]) {
    $(id).addEventListener("input", () => {
      const clean = normalizeCode($(id).value).replace(/[^a-z0-9]/g, "").slice(0, 6);
      if (clean !== $(id).value) $(id).value = clean;
    });
  }
  const roll = () => {
    $("c-code").value = randomCode();
    $("dice").classList.remove("roll");
    void $("dice").offsetWidth;   // 애니메이션을 다시 시작한다
    $("dice").classList.add("roll");
  };
  $("dice").addEventListener("click", roll);
  let capacity = CAPACITY_DEFAULT;
  bindStepper("c-cap", () => capacity, (next) => { capacity = next; $("c-cap-val").textContent = next; });
  $("c-code").value = randomCode();

  // 방 열기: 없는 코드면 만들고, 있는 코드면 그 방에 참여한다 — PC·폰에서 같은 코드면 같은 방.
  $("create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const code = normalizeCode($("c-code").value);
    const name = $("c-name").value;
    $("c-err").textContent = "";
    if (!CODE_RE.test(code)) { $("c-err").textContent = "방 코드는 영문 소문자·숫자 6자리예요."; return; }
    button.disabled = true;
    try {
      const data = await api("", { method: "POST", body: { code, name, capacity } });
      saveRoom(code, { token: data.token });
      location.href = code;
    } catch (error) {
      if (error.data?.exists) {
        // 이미 있는 방 — 내 토큰이 있으면 그냥 열고, 없으면 이 닉네임으로 참여한다.
        if (loadRooms()[code]?.token) { location.href = code; return; }
        try {
          const joined = await api(`/${code}/join`, { method: "POST", body: { name } });
          saveRoom(code, { token: joined.token });
        } catch (joinError) {
          // 닉네임 겹침·정원 초과 — 방 화면의 참여 칸에서 이어서 한다.
          try { sessionStorage.setItem("yaksok:flash", JSON.stringify({ code, name, error: joinError.message })); } catch {}
        }
        location.href = code;
        return;
      }
      $("c-err").textContent = error.message;
      button.disabled = false;
    }
  });

  $("enter").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalizeCode($("e-code").value);
    if (!CODE_RE.test(code)) { $("e-err").textContent = "방 코드는 영문 소문자·숫자 6자리예요."; return; }
    location.href = code;
  });
}

function showGone(icon, title, text) {
  $("room").hidden = true;
  $("gone").hidden = false;
  $("gone-icon").textContent = icon;
  $("gone-title").textContent = title;
  $("gone-text").textContent = text;
}


// ── 방 ──
let state = null;
let token = null;
const pending = {};          // 아직 서버에 안 보낸 내 응답 { date: state }
let flushTimer = null;
let inFlight = false;
let flushFailures = 0;
let gone = false;

const memberIds = () => state.members.map((m) => m.id);
const nameOf = (id) => state.members.find((m) => m.id === id)?.name ?? "?";
const isHost = () => Boolean(state?.me?.host);

function myVotes() {
  const mine = { ...(state.votes[state.me?.id] ?? {}) };
  for (const [date, s] of Object.entries(pending)) {
    if (s === NONE) delete mine[date]; else mine[date] = s;
  }
  return mine;
}

function allVotes() {
  if (!state.me) return state.votes;
  return { ...state.votes, [state.me.id]: myVotes() };
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "on") for (const [type, fn] of Object.entries(value)) node.addEventListener(type, fn);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

// ── 맨 위: 진행 단계 ──
function renderPhases() {
  $("phases").replaceChildren(...PHASES.map((label, i) => el("li", {
    class: i === state.phase ? "now" : i < state.phase ? "done" : "",
    "aria-current": i === state.phase ? "step" : "false",
  }, label)));
}

// ── READY 창: 정원만큼 자리, 들어온 사람은 캐릭터, 날짜를 넣었으면 READY, 빈 자리는 실루엣 ──
function renderReady() {
  const responded = state.members.filter((m) => m.responded).length;
  $("ready-count").textContent = `${state.members.length}/${state.max}명 · READY ${responded}`;
  const seats = [];
  for (let i = 0; i < state.max; i += 1) {
    const m = state.members[i];
    const canvas = el("canvas", { width: 16, height: 16, "aria-hidden": "true" });
    if (m) {
      drawSprite(canvas, `${m.id}:${m.name}`);
      seats.push(el("div", {
        class: `seat${m.responded ? " ready-on" : ""}${m.id === state.me?.id ? " me" : ""}`,
        title: `${m.name}${m.responded ? " — 날짜를 넣었어요" : " — 아직 날짜를 안 넣었어요"}`,
      }, m.host ? el("span", { class: "crown", "aria-label": "방장" }, "👑") : null, canvas,
      el("span", { class: "who" }, m.name + (m.id === state.me?.id ? " (나)" : "")),
      el("span", { class: "tag" }, m.responded ? "READY" : "대기")));
    } else {
      drawSprite(canvas, `empty:${i}`, { silhouette: true });
      const seat = el(state.me ? "div" : "button", { class: "seat empty", type: "button", title: "빈 자리" },
        canvas, el("span", { class: "who" }, "빈 자리"), el("span", { class: "tag" }, "—"));
      if (!state.me) seat.addEventListener("click", () => $("j-name").focus());
      seats.push(seat);
    }
  }
  $("seats").replaceChildren(...seats);
}

// ── 달력: 한 장. 칸 위 점심·아래 저녁, 불투명도 = 가능 인원 ÷ 정원, 모두 되면 테두리,
//    왼쪽 위 작은 칸이 내 응답. 드래그 중에는 이 칸만 다시 칠한다(달력 전체를 다시 그리면
//    손가락 아래 요소가 바뀌어 터치 드래그가 끊긴다). ──
function drawCell(button) {
  const date = button.dataset.date;
  button.querySelectorAll(".half, .mine, .counts").forEach((node) => node.remove());
  const { lunch, dinner } = dayCounts(allVotes(), memberIds(), date);
  const cap = state.max;
  const top = el("span", { class: "half top" });
  top.style.setProperty("background", `rgb(var(--lunch-rgb) / ${lunch / cap})`);
  const bottom = el("span", { class: "half bottom" });
  bottom.style.setProperty("background", `rgb(var(--dinner-rgb) / ${dinner / cap})`);
  button.append(top, bottom);
  button.classList.toggle("all", lunch === cap || dinner === cap);
  if (lunch || dinner) button.append(el("span", { class: "counts" }, `${lunch}·${dinner}`));
  const mine = state.me ? myVotes()[date] ?? NONE : NONE;
  if (state.me) button.append(el("span", { class: `mine s${mine}` }));
  button.setAttribute("aria-label",
    `${dateLabel(date)} 점심 ${lunch}명 저녁 ${dinner}명 (정원 ${cap}명)${state.me ? ` · 내 응답 ${STATE_LABEL[mine] ?? "미응답"}` : ""}`);
}

function renderCalendar() {
  const dates = datesBetween(state.period.start, state.period.end);
  const inPeriod = new Set(dates);
  const today = kstToday();
  const confirmed = state.confirmed?.date;
  const months = [];
  for (let d = state.period.start.slice(0, 8) + "01"; d <= state.period.end; ) {
    const [y, m] = d.split("-").map(Number);
    months.push({ y, m });
    d = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  $("months").replaceChildren(...months.map(({ y, m }) => {
    const grid = el("div", { class: "grid" }, ...["일", "월", "화", "수", "목", "금", "토"].map((w, i) =>
      el("div", { class: "dow" + (i === 0 ? " sun" : i === 6 ? " sat" : "") }, w)));
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    for (let i = 0; i < weekday(first); i += 1) grid.append(el("div"));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let day = 1; day <= last; day += 1) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const wd = weekday(date);
      const button = el("button", {
        type: "button",
        class: "day" + (wd === 0 ? " sun" : wd === 6 ? " sat" : "") + (date === today ? " today" : "")
          + (date === confirmed ? " picked" : ""),
      }, el("span", { class: "num" }, String(day)));
      button.dataset.date = date;
      button.disabled = !inPeriod.has(date);
      if (inPeriod.has(date)) drawCell(button);
      grid.append(button);
    }
    return el("div", { class: "month" }, el("h3", {}, `${y}년 ${m}월`), grid);
  }));
  $("cal-help").textContent = state.me
    ? "톡 누를 때마다 내 응답이 전일 → 점심만 → 저녁만 → 불가 순서로 바뀌어요."
    : "참여하면 날짜를 누를 수 있어요.";
  $("drag-tip").textContent = state.me
    ? (matchMedia("(pointer: coarse)").matches ? "꾹 누른 채 끌면 여러 날을 한 번에 칠해요." : "누른 채 끌면 여러 날을 한 번에 칠해요.")
    : "";
  $("legend").replaceChildren(
    el("span", {}, el("i", { class: "lg-lunch" }), "위 = 점심"),
    el("span", {}, el("i", { class: "lg-dinner" }), "아래 = 저녁"),
    el("span", {}, `진하기 = 가능 인원 ÷ 정원 ${state.max}명`),
    el("span", {}, el("i", { class: "lg-all" }), "모두 가능"),
    state.me ? el("span", {}, el("i", { class: "lg-mine" }), "내 응답") : null,
  );
}

function renderBest() {
  const dates = datesBetween(state.period.start, state.period.end);
  const { byDate } = tally(allVotes(), memberIds(), dates);
  const best = bestDates(byDate, 3);
  $("best-empty").hidden = best.length > 0;
  $("best").replaceChildren(...best.map((item) => el("li", {},
    el("div", {},
      el("div", {}, `${dateLabel(item.date)} ${SLOT_LABEL[item.slot]}${item.count === state.max ? " · 모두 가능" : ""}`),
      el("div", { class: "who" }, `${item.count}/${state.max}명 · 점심 ${item.lunch} 저녁 ${item.dinner}`)),
    isHost() ? el("button", { type: "button", on: { click: () => openConfirm(item.date, item.slot) } }, "확정") : null)));
}

function renderMine() {
  $("m-count").textContent = "";
  $("members-card").hidden = !state.me;
}

let syncHostCap = null;
function renderHost() {
  $("host-card").hidden = !isHost();
  if (!isHost()) return;
  $("h-cap-val").textContent = state.max;
  if (!syncHostCap) {
    syncHostCap = bindStepper("h-cap", () => state.max, async (next) => {
      $("h-cap-err").textContent = "";
      try { await act("capacity", { capacity: next }); }
      catch (error) { $("h-cap-err").textContent = error.message; }
    }, () => Math.max(CAPACITY_MIN, state.members.length));
  }
  syncHostCap();
  const others = state.members.filter((m) => m.id !== state.me.id);
  $("handover").replaceChildren(...(others.length
    ? others.map((m) => el("button", { type: "button", on: { click: () => act("host", { memberId: m.id }) } }, m.name))
    : [el("span", { class: "muted" }, "아직 다른 참여자가 없어요.")]));
  if (document.activeElement !== $("p-name") && document.activeElement !== $("p-url")) {
    $("p-name").value = state.place?.name ?? "";
    $("p-url").value = state.place?.url ?? "";
  }
}

const eventTitle = () => `약속 (${state.code})`;

function renderConfirmed() {
  const c = state.confirmed;
  $("confirmed").hidden = !c;
  if (!c) return;
  $("cf-when").textContent = `📅 ${dateLabel(c.date)} ${SLOT_LABEL[c.slot]}`;
  $("cf-place").textContent = state.place ? `📍 ${state.place.name}` : "장소는 방장이 곧 알려 줄 거예요.";
  $("cf-map").hidden = !state.place;
  if (state.place) $("cf-map").href = state.place.url;
  $("cf-google").href = calendarEvent({ title: eventTitle(), date: c.date, slot: c.slot, place: state.place }).google;
  $("settle-start").hidden = !(isHost() && state.phase < 3);
  $("settle-stop").hidden = !(isHost() && state.settling);
}

// ── 사진 ──
const inKakao = /KAKAOTALK/i.test(navigator.userAgent);
const photoUrl = (id, size) => `${API}/${code}/photos/${id}${size === "thumb" ? "?size=thumb" : ""}`;
let picking = false;
const picked = new Set();

function renderPhotos() {
  const show = state.phase >= 1;
  $("photos-card").hidden = !show;
  if (!show) return;
  const photos = state.photos;
  $("ph-count").textContent = `${photos.length}/${PHOTO_MAX}장 · ${(state.photoBytes / 1048576).toFixed(1)}MB/100MB`;
  // 카톡 안의 브라우저는 여러 장 저장·ZIP 다운로드가 잘 안 된다 — 기본 브라우저로 넘긴다.
  // 다른 브라우저는 기기 저장소가 달라 내 토큰을 # 뒤에 실어 보낸다(서버로는 가지 않는다).
  $("open-external").hidden = !inKakao;
  if (inKakao) {
    const target = `${roomUrl(code)}${token ? `#t=${token}` : ""}`;
    $("open-external").href = `kakaotalk://web/openExternal?url=${encodeURIComponent(target)}`;
  }
  $("ph-input").disabled = !state.me;
  $("ph-all").disabled = !photos.length;
  $("ph-pick").disabled = !photos.length;
  $("ph-pick").textContent = picking ? "고르기 그만" : "골라서 받기";
  $("ph-zip").hidden = !picking;
  $("ph-zip").textContent = `선택한 ${picked.size}장 받기`;
  $("ph-zip").disabled = !picked.size;
  $("gallery").classList.toggle("picking", picking);
  const existing = new Map([...$("gallery").children].map((b) => [b.dataset.id, b]));
  $("gallery").replaceChildren(...photos.map((p) => {
    const button = existing.get(p.id) ?? el("button", { type: "button" },
      el("img", { src: photoUrl(p.id, "thumb"), alt: `${nameOf(p.by)}의 사진`, loading: "lazy" }),
      el("span", { class: "pick" }));
    button.dataset.id = p.id;
    button.classList.toggle("picked", picked.has(p.id));
    return button;
  }));
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// 올리기 전에 긴 변 2048px JPEG 와 360px 썸네일로 줄인다 — 다시 그리면 EXIF(촬영 위치)도 빠진다.
async function shrink(file, edge, quality) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = el("canvas", { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return { blob, w: canvas.width, h: canvas.height };
}

async function uploadPhotos(files) {
  const list = [...files];
  let done = 0;
  for (const file of list) {
    $("ph-status").textContent = `올리는 중… ${done + 1}/${list.length}`;
    try {
      const full = await shrink(file, 2048, 0.85);
      const thumb = await shrink(file, 360, 0.75);
      await act("photo", { full: await toBase64(full.blob), thumb: await toBase64(thumb.blob), w: full.w, h: full.h });
      done += 1;
    } catch (error) {
      $("ph-status").textContent = `${done}장 올림 — ${error.message}`;
      return;
    }
  }
  $("ph-status").textContent = `${done}장 올렸어요.`;
}

async function downloadZip(ids) {
  $("ph-status").textContent = "사진을 모으는 중…";
  const files = [];
  for (const [i, id] of ids.entries()) {
    const response = await fetch(photoUrl(id, "full"));
    if (!response.ok) continue;
    files.push({ name: `yaksok-${code}-${String(i + 1).padStart(2, "0")}.jpg`, bytes: new Uint8Array(await response.arrayBuffer()) });
    $("ph-status").textContent = `사진을 모으는 중… ${i + 1}/${ids.length}`;
  }
  const url = URL.createObjectURL(new Blob([zipStore(files)], { type: "application/zip" }));
  el("a", { href: url, download: `yaksok-${code}-사진${files.length}장.zip` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  $("ph-status").textContent = inKakao
    ? `${files.length}장을 묶었어요. 저장이 안 되면 위의 "기본 브라우저로 열기"를 눌러 주세요.`
    : `${files.length}장을 묶어 받았어요.`;
}

let openPhotoId = null;
function openPhoto(id) {
  const photo = state.photos.find((p) => p.id === id);
  if (!photo) return;
  openPhotoId = id;
  $("pd-img").src = photoUrl(id, "full");
  $("pd-open").href = photoUrl(id, "full");
  $("pd-meta").textContent = `${nameOf(photo.by)} · 길게 누르면 저장할 수 있어요`;
  $("pd-del").hidden = !(state.me && (photo.by === state.me.id || isHost()));
  $("photo-dialog").showModal();
}

// ── 정산 ──
let parsedItems = [];

function renderSettle() {
  const show = state.phase === 3;
  $("settle-card").hidden = !show;
  if (!show) return;
  const ids = memberIds();
  const { total, balance, transfers } = settle(ids, state.expenses);
  const me = state.me?.id;
  const perHead = ids.length ? Math.round(total / ids.length) : 0;
  $("st-sum").replaceChildren(
    el("div", {}, "총 ", el("b", {}, won(total)), ` · ${ids.length}명 (평균 ${won(perHead)})`),
    me ? el("div", {}, balance[me] > 0 ? `나는 ${won(balance[me])} 받아요`
      : balance[me] < 0 ? `나는 ${won(-balance[me])} 보내요` : "나는 주고받을 돈이 없어요") : null,
  );
  $("st-transfers").replaceChildren(...(transfers.length ? transfers.map((t) => {
    const mark = state.sent[`${t.from}>${t.to}`] ?? {};
    const to = state.members.find((m) => m.id === t.to);
    const li = el("li", { class: mark.receivedAt ? "done" : "" },
      el("div", {}, `${nameOf(t.from)} → ${nameOf(t.to)} `, el("span", { class: "amt" }, won(t.amount)),
        mark.receivedAt ? " · 받음 ✓" : mark.sentAt ? " · 보냈어요" : ""));
    const buttons = [];
    if (me === t.from) {
      if (to?.pay?.kakaopay) buttons.push(el("a", { class: "button kakaopay", href: to.pay.kakaopay, target: "_blank", rel: "noopener" }, "카카오페이로 보내기"));
      if (to?.pay?.account) {
        buttons.push(el("button", { type: "button", on: { click: async (event) => {
          try { await navigator.clipboard.writeText(`${to.pay.account} ${t.amount}원`); event.target.textContent = "복사했어요"; }
          catch { event.target.textContent = to.pay.account; }
        } } }, "계좌 복사"));
      }
      if (!to?.pay) buttons.push(el("span", { class: "muted" }, `${nameOf(t.to)}님이 받을 곳을 아직 안 적었어요`));
      buttons.push(el("button", { type: "button", on: { click: () => act("sent", { from: t.from, to: t.to, amount: t.amount, done: !mark.sentAt }) } },
        mark.sentAt ? "보냄 취소" : "보냈어요"));
    }
    if (me === t.to) {
      buttons.push(el("button", { type: "button", on: { click: () => act("sent", { from: t.from, to: t.to, amount: t.amount, done: !mark.receivedAt }) } },
        mark.receivedAt ? "받음 취소" : "받았어요"));
    }
    if (buttons.length) li.append(el("div", { class: "row" }, ...buttons));
    return li;
  }) : [el("li", {}, total ? "보낼 돈이 없어요 🎉" : "아래에 결제 항목을 넣으면 누가 누구에게 얼마 보낼지 계산해요.")]));

  $("st-list").replaceChildren(...state.expenses.map((e) => {
    const editable = state.me && (e.by === me || isHost());
    const who = e.participants ?? ids;
    return el("li", {},
      el("div", {}, `${e.title} · `, el("b", {}, won(e.amount)), ` · ${nameOf(e.payer)} 냄${e.source === "parsed" ? " · 캡처" : ""}`),
      el("div", { class: "chips" }, ...state.members.map((m) => el("button", {
        type: "button", disabled: !editable, "aria-pressed": String(who.includes(m.id)),
        title: editable ? "눌러서 이 항목에서 빼거나 넣기" : "",
        on: { click: () => {
          const next = who.includes(m.id) ? who.filter((id) => id !== m.id) : [...who, m.id];
          act("expense", { op: "update", id: e.id, title: e.title, amount: e.amount, payer: e.payer,
            participants: next.length === ids.length ? null : next }).catch((error) => { $("st-err").textContent = error.message; });
        } },
      }, m.name))),
      editable ? el("div", { class: "row" }, el("button", { type: "button", on: { click: () => act("expense", { op: "delete", id: e.id }) } }, "지우기")) : null);
  }));

  $("st-parsed").replaceChildren(...(parsedItems.length ? [el("div", { class: "parsed" },
    el("div", { class: "muted" }, "읽은 결과예요. 맞는지 보고 고친 뒤 넣어 주세요."),
    ...parsedItems.map((item, i) => el("label", {},
      el("input", { type: "checkbox", checked: !item.canceled, on: { change: (ev) => { parsedItems[i].use = ev.target.checked; } } }),
      el("input", { type: "text", value: item.title, on: { input: (ev) => { parsedItems[i].title = ev.target.value; } } }),
      el("input", { type: "number", value: item.amount, on: { input: (ev) => { parsedItems[i].amount = Number(ev.target.value); } } }),
      item.canceled ? el("span", { class: "muted" }, "취소") : null)),
    el("div", { class: "row" },
      el("button", { type: "button", class: "primary", on: { click: addParsed } }, "선택한 항목 넣기"),
      el("button", { type: "button", on: { click: () => { parsedItems = []; renderSettle(); } } }, "버리기")))] : []));

  const mine = state.members.find((m) => m.id === me);
  if (mine && document.activeElement !== $("pay-kakao") && document.activeElement !== $("pay-account")) {
    $("pay-kakao").value = mine.pay?.kakaopay ?? "";
    $("pay-account").value = mine.pay?.account ?? "";
  }
  $("st-pay").hidden = !state.me;
}

async function addParsed() {
  const items = parsedItems.filter((i) => i.use !== false && !(i.canceled && i.use === undefined))
    .map((i) => ({ title: i.title, amount: i.amount, source: "parsed" }));
  if (!items.length) return;
  try {
    await act("expense", { op: "add", items });
    parsedItems = [];
    renderSettle();
  } catch (error) {
    $("st-err").textContent = error.message;
  }
}

// ── 미리보기 카드 ── 방이 바뀌면(version) 참여자 화면이 새로 그려 올린다. 공유 버튼은 이 그림을
// 가리키는 주소(?v=버전)를 그대로 보내므로 카톡이 새 미리보기를 긁는다. 누른 뒤에 그리면 아이폰에서
// 공유 시트가 막힐 수 있어(사용자 제스처가 끊긴다) 미리 올려 둔다.
let ogTimer = null;
let ogBusy = false;
function scheduleOg() {
  if (!state?.me || gone) return;
  clearTimeout(ogTimer);
  if (state.og?.version === state.version) { syncShareUrl(); return; }
  ogTimer = setTimeout(async () => {
    if (ogBusy || Object.keys(pending).length || state.og?.version === state.version) return;
    ogBusy = true;
    try {
      const png = await cardPngBase64(state);
      const data = await api(`/${code}/og`, { method: "POST", body: { version: state.version, png }, token });
      state = data.state;
      syncShareUrl();
    } catch { /* 그새 바뀌었으면(409) 다음 새로고침에서 다시 그린다 */ }
    finally { ogBusy = false; }
  }, 1200);
}

function syncShareUrl() {
  if (!state?.og) return;
  const want = `?v=${state.og.version}`;
  if (location.search !== want) history.replaceState(null, "", `${location.pathname}${want}${location.hash}`);
}

// 공유 버튼(오른쪽 아래 독)이 보내는 문구 — 단계마다 다르다. 주소는 location.href(?v=버전).
function shareText() {
  if (!state) return "";
  const c = state.confirmed;
  const when = c ? `${dateLabel(c.date)} ${SLOT_LABEL[c.slot]}` : "";
  const responded = state.members.filter((m) => m.responded).length;
  switch (state.phase) {
    case 0: return `🫧 약속 방 ${state.code} — 되는 날짜 톡톡 눌러 줘! (${state.max}명 중 ${responded}명 응답)`;
    case 1: return `📅 ${when}로 확정! 장소는 곧 알려 줄게 (방 ${state.code})`;
    case 2: return `📅 ${when} · 📍 ${state.place?.name} — 여기서 만나! 지도: ${state.place?.url}`;
    default: {
      const { transfers } = settle(memberIds(), state.expenses);
      const lines = transfers.map((t) => `${nameOf(t.from)} → ${nameOf(t.to)} ${won(t.amount)}`);
      return `💸 정산해 줘! ${lines.length ? lines.join(", ") : "결제 항목을 넣어 줘"} (방 ${state.code})`;
    }
  }
}
window.blShareText = shareText;

function render() {
  $("room").hidden = false;
  $("r-code").textContent = "약속 방";
  $("r-title").textContent = `🫧 ${state.code}`;
  document.title = `약속 방 ${state.code}`;
  const responded = state.members.filter((m) => m.responded).length;
  $("r-meta").textContent = `${dateLabel(state.period.start)} ~ ${dateLabel(state.period.end)} · ${state.max}명 중 ${responded}명 응답`;
  $("join").hidden = Boolean(state.me);
  const expires = new Date(state.expiresAt);
  $("expires").textContent = `이 방은 ${expires.getMonth() + 1}월 ${expires.getDate()}일에 저절로 터져요 🫧`;
  // 날짜가 잡히면 달력은 접어 둔다(다시 볼 수 있다).
  const later = state.phase >= 1;
  $("cal-toggle").hidden = !later;
  if (!later) calendarOpen = true;
  $("cal-layout").hidden = later && !calendarOpen;
  $("cal-toggle").textContent = calendarOpen ? "📅 날짜 투표 접기" : "📅 날짜 투표 다시 보기";
  renderPhases();
  renderReady();
  renderConfirmed();
  renderSettle();
  renderPhotos();
  renderCalendar();
  renderBest();
  renderMine();
  renderHost();
  scheduleOg();
}
let calendarOpen = false;

function showRoomGone() {
  if (gone) return;
  gone = true;
  forgetRoom(code);
  for (const key of Object.keys(pending)) delete pending[key];
  clearTimeout(flushTimer);
  showGone("🫧", "터트린 방이에요", "방장이 방을 터트려서 기록과 사진이 모두 사라졌어요.");
}

async function refresh() {
  if (inFlight || gone) return;
  try {
    const next = await api(`/${code}`, { token });
    if (token && !next.me) { token = null; forgetRoom(code); }   // 토큰이 더는 이 방의 것이 아니다
    state = next;
    if (token) saveRoom(code, { token });
    render();
  } catch (error) {
    if (error.status === 404) showGone("🔍", "없는 방이에요", "방 코드를 다시 확인해 주세요.");
    else if (error.status === 410) showRoomGone();
  }
}

// 모아 둔 응답을 보낸다. 방이 그새 터졌으면(410·404) 붙들지 않고 바로 "터진 방"으로 — 예전에는
// 여기서 0.6초마다 끝없이 다시 보내며 화면이 계속 방에 머물렀다. 다른 실패는 세 번까지만 다시 한다.
const RETRY_MS = [1500, 4000, 10000];
async function flush() {
  flushTimer = null;
  const votes = { ...pending };
  if (!Object.keys(votes).length || gone) return;
  inFlight = true;
  $("saving").textContent = "저장 중…";
  try {
    const data = await api(`/${code}/vote`, { method: "POST", body: { votes }, token });
    for (const [date, s] of Object.entries(votes)) if (pending[date] === s) delete pending[date];
    flushFailures = 0;
    state = data.state;
    $("saving").textContent = "저장됨";
    render();
  } catch (error) {
    if (error.status === 410 || error.status === 404) { inFlight = false; showRoomGone(); return; }
    flushFailures += 1;
    if (flushFailures > RETRY_MS.length) {
      $("saving").textContent = `저장 못 함: ${error.message} — 날짜를 다시 눌러 주세요.`;
      for (const key of Object.keys(votes)) if (pending[key] === votes[key]) delete pending[key];
      flushFailures = 0;
      inFlight = false;
      refresh();
      return;
    }
    $("saving").textContent = `저장 못 함 — 다시 시도할게요 (${flushFailures}/${RETRY_MS.length})`;
    inFlight = false;
    if (!flushTimer) flushTimer = setTimeout(flush, RETRY_MS[flushFailures - 1]);
    return;
  }
  inFlight = false;
  if (Object.keys(pending).length && !flushTimer) flushTimer = setTimeout(flush, 600);
}

async function act(action, body) {
  try {
    const data = await api(`/${code}/${action}`, { method: "POST", body, token });
    if (data.state) state = data.state;
    if (!gone) render();
    return data;
  } catch (error) {
    if (error.status === 410 || error.status === 404) showRoomGone();
    throw error;
  }
}

// 확정 창
let confirmDate = null;
let confirmSlot = "dinner";
function openConfirm(date, slot) {
  const { lunch, dinner } = dayCounts(allVotes(), memberIds(), date);
  confirmDate = date;
  confirmSlot = slot === "full" && lunch !== dinner ? (lunch > dinner ? "lunch" : "dinner") : slot;
  $("cd-date").textContent = dateLabel(date);
  $("cd-counts").textContent = `점심 ${lunch}명 · 저녁 ${dinner}명 가능 (정원 ${state.max}명)`;
  for (const b of $("cd-slots").children) b.setAttribute("aria-pressed", String(b.dataset.slot === confirmSlot));
  $("confirm-dialog").showModal();
}

// 칠하기. 톡 = 한 칸 순환. 누른 채 끌기 = 첫 칸이 바뀔 상태로 지나간 칸을 모두 칠한다.
// 마우스는 누르는 즉시 끌기, 터치는 잠깐(HOLD_MS) 누르고 있어야 끌기 — 바로 쓸면 스크롤이다.
const HOLD_MS = 220;
const MOVE_SLOP = 8;
function bindPaint() {
  const months = $("months");
  let gesture = null;

  const dayAt = (x, y) => {
    const node = document.elementFromPoint(x, y)?.closest?.(".day");
    return node && months.contains(node) && !node.disabled ? node : null;
  };
  const apply = (button, target) => {
    pending[button.dataset.date] = target;
    drawCell(button);
    gesture.painted.add(button.dataset.date);
  };
  const beginDrag = () => {
    gesture.dragging = true;
    months.classList.add("painting");
    apply(gesture.start, gesture.target);
    navigator.vibrate?.(8);
  };
  const finish = (commit) => {
    if (!gesture) return;
    clearTimeout(gesture.hold);
    months.classList.remove("painting");
    const { dragging, start, target, moved } = gesture;
    if (commit && !dragging && !moved) apply(start, target);   // 톡
    const changed = gesture.painted.size > 0;
    gesture = null;
    if (!changed) return;
    $("saving").textContent = "";
    renderBest();
    renderReady();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 600);
  };

  months.addEventListener("pointerdown", (event) => {
    if (!state?.me || gone || event.button > 0) return;
    const button = event.target.closest(".day");
    if (!button || button.disabled) return;
    gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
      start: button, moved: false,
      target: nextState(myVotes()[button.dataset.date] ?? NONE), dragging: false, painted: new Set(),
    };
    if (event.pointerType === "mouse") { event.preventDefault(); beginDrag(); }
    else gesture.hold = setTimeout(() => gesture && !gesture.moved && beginDrag(), HOLD_MS);
  });
  document.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!gesture.dragging) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > MOVE_SLOP) {
        gesture.moved = true;              // 스크롤하려는 손짓 — 칠하지 않는다
        clearTimeout(gesture.hold);
      }
      return;
    }
    // 브라우저는 빠른 움직임을 프레임마다 하나로 묶어 보낸다 — 묶인 점을 모두 꺼내고,
    // 점과 점 사이도 촘촘히 짚어 빠르게 그어도 지나간 칸을 건너뛰지 않는다.
    const points = event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event];
    for (const p of points) {
      const dx = p.clientX - gesture.lastX, dy = p.clientY - gesture.lastY;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
      for (let i = 1; i <= steps; i += 1) {
        const button = dayAt(gesture.lastX + dx * i / steps, gesture.lastY + dy * i / steps);
        if (button && !gesture.painted.has(button.dataset.date)) apply(button, gesture.target);
      }
      gesture.lastX = p.clientX;
      gesture.lastY = p.clientY;
    }
  });
  document.addEventListener("pointerup", (event) => {
    if (gesture && event.pointerId === gesture.id) finish(true);
  });
  document.addEventListener("pointercancel", (event) => {
    if (gesture && event.pointerId === gesture.id) finish(gesture.dragging);
  });
  // 끌기가 시작된 뒤에는 페이지가 따라 스크롤되지 않게 막는다(passive:false 여야 막힌다).
  months.addEventListener("touchmove", (event) => {
    if (gesture?.dragging) event.preventDefault();
  }, { passive: false });
  // 꾹 누를 때 뜨는 길게 누르기 메뉴·텍스트 선택을 막는다.
  months.addEventListener("contextmenu", (event) => event.preventDefault());
}

function bindRoom() {
  bindPaint();

  $("cal-toggle").addEventListener("click", () => { calendarOpen = !calendarOpen; render(); });

  $("join").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("j-err").textContent = "";
    try {
      const data = await api(`/${code}/join`, { method: "POST", body: { name: $("j-name").value } });
      token = data.token;
      state = data.state;
      saveRoom(code, { token });
      render();
    } catch (error) {
      if (error.status === 410) showRoomGone();
      $("j-err").textContent = error.message;
    }
  });

  for (const b of $("cd-slots").children) {
    b.addEventListener("click", () => {
      confirmSlot = b.dataset.slot;
      for (const other of $("cd-slots").children) other.setAttribute("aria-pressed", String(other === b));
    });
  }
  $("cd-cancel").addEventListener("click", () => $("confirm-dialog").close());
  $("cd-ok").addEventListener("click", async () => {
    $("confirm-dialog").close();
    await act("confirm", { date: confirmDate, slot: confirmSlot }).catch(() => {});
  });

  $("cf-ics").addEventListener("click", () => {
    const c = state.confirmed;
    const { ics } = calendarEvent({ title: eventTitle(), date: c.date, slot: c.slot, place: state.place });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    el("a", { href: url, download: `yaksok-${c.date}.ics` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("settle-start").addEventListener("click", () => act("settle", { settling: true }).catch(() => {}));
  $("settle-stop").addEventListener("click", () => act("settle", { settling: false }).catch(() => {}));

  $("p-save").addEventListener("click", async () => {
    $("p-err").textContent = "";
    try { await act("place", { name: $("p-name").value, url: $("p-url").value }); }
    catch (error) { $("p-err").textContent = error.message; }
  });
  $("p-clear").addEventListener("click", async () => {
    $("p-name").value = ""; $("p-url").value = "";
    await act("place", { url: null }).catch(() => {});
  });

  // 사진
  $("ph-input").addEventListener("change", async (event) => {
    const files = event.target.files;
    if (files?.length) await uploadPhotos(files);
    event.target.value = "";
  });
  $("ph-all").addEventListener("click", () => downloadZip(state.photos.map((p) => p.id)));
  $("ph-pick").addEventListener("click", () => { picking = !picking; picked.clear(); renderPhotos(); });
  $("ph-zip").addEventListener("click", () => downloadZip(state.photos.filter((p) => picked.has(p.id)).map((p) => p.id)));
  $("gallery").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    if (picking) {
      const id = button.dataset.id;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      renderPhotos();
    } else {
      openPhoto(button.dataset.id);
    }
  });
  $("pd-close").addEventListener("click", () => $("photo-dialog").close());
  $("pd-del").addEventListener("click", async () => {
    $("photo-dialog").close();
    await act("photo-delete", { id: openPhotoId }).catch((error) => { $("ph-status").textContent = error.message; });
  });

  // 정산
  $("st-add").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("st-err").textContent = "";
    const amount = cleanAmount($("st-amount").value);
    if (!amount) { $("st-err").textContent = "금액을 숫자로 적어 주세요."; return; }
    try {
      await act("expense", { op: "add", title: $("st-title").value || "결제", amount });
      $("st-title").value = ""; $("st-amount").value = "";
    } catch (error) { $("st-err").textContent = error.message; }
  });
  $("st-shot").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    $("st-err").textContent = "캡처를 읽는 중…";
    try {
      const small = await shrink(file, 1800, 0.9);
      const data = await api(`/${code}/parse`, { method: "POST", body: { data: await toBase64(small.blob), mime: "image/jpeg" }, token });
      parsedItems = data.items.map((i) => ({ ...i, use: !i.canceled }));
      $("st-err").textContent = parsedItems.length ? "" : "결제 금액을 찾지 못했어요. 직접 적어 주세요.";
      renderSettle();
    } catch (error) {
      $("st-err").textContent = error.message;
    }
  });
  $("pay-save").addEventListener("click", async () => {
    $("st-err").textContent = "";
    try { await act("pay", { kakaopay: $("pay-kakao").value, account: $("pay-account").value }); }
    catch (error) { $("st-err").textContent = error.message; }
  });

  $("pop").addEventListener("click", async () => {
    $("pop-err").textContent = "";
    try {
      await api(`/${code}/pop`, { method: "POST", body: { code: $("pop-code").value }, token });
      gone = true;
      forgetRoom(code);
      const burst = el("div", { class: "pop" }, el("span", {}, "🫧"));
      document.body.append(burst);
      setTimeout(() => showGone("🫧", "펑! 방을 터트렸어요", "모든 응답·사진·정산 기록을 지웠어요."), 650);
    } catch (error) {
      $("pop-err").textContent = error.message;
    }
  });

  // 이어하기 링크: 토큰은 # 뒤에 둔다 — 서버 로그·리퍼러로 새지 않는다.
  $("resume").addEventListener("click", async () => {
    const link = `${roomUrl(code)}#t=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      $("resume").textContent = "복사했어요 — 나만 보관하세요";
    } catch {
      $("resume").textContent = link;
    }
  });

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
}

async function openRoom() {
  // 이어하기 링크로 들어왔으면 토큰을 받아 두고 주소에서 지운다.
  const fromHash = /^#t=([\w-]{20,})$/.exec(location.hash)?.[1];
  if (fromHash) {
    saveRoom(code, { token: fromHash });
    history.replaceState(null, "", location.pathname + location.search);
  }
  token = loadRooms()[code]?.token ?? null;
  bindRoom();
  await refresh();
  try {
    const flash = JSON.parse(sessionStorage.getItem("yaksok:flash") ?? "null");
    sessionStorage.removeItem("yaksok:flash");
    if (flash?.code === code && !state?.me) {
      $("j-name").value = flash.name ?? "";
      $("j-err").textContent = flash.error;
    }
  } catch {}
}

if (code) openRoom(); else showHome();
