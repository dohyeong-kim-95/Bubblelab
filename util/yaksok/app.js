// 약속 화면. 규칙은 logic.js, 저장은 서버(/_yaksok, _infra/yaksok.js)가 맡는다.
import {
  CODE_RE, DINNER, FULL, LUNCH, NO, NONE, SLOT_LABEL, STATE_LABEL,
  bestDates, calendarEvent, dateLabel, datesBetween, kstToday, nextState, tally, weekday,
} from "./logic.js";

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

// 방 주소는 /yaksok/<코드> (로컬은 /util/yaksok/<코드>). 끝 조각이 코드면 방이다.
const lastSegment = location.pathname.split("/").filter(Boolean).pop() ?? "";
const code = CODE_RE.test(lastSegment) ? lastSegment : null;
const roomUrl = (c) => new URL(c, location.href.replace(/[^/]*([?#].*)?$/, "")).href;

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
      name.textContent = r.title ?? c;
      const small = document.createElement("span");
      small.className = "muted";
      small.textContent = c;
      a.append(name, small);
      return a;
    }));
  }
  $("create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $("c-err").textContent = "";
    try {
      const data = await api("", { method: "POST", body: { title: $("c-title").value, name: $("c-name").value } });
      saveRoom(data.code, { token: data.token, title: data.state.title });
      location.href = data.code;
    } catch (error) {
      $("c-err").textContent = error.message;
      button.disabled = false;
    }
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
let view = "mine";
const pending = {};          // 아직 서버에 안 보낸 내 응답 { date: state }
let flushTimer = null;
let inFlight = false;

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

function paint(el, top, bottom) {
  const t = document.createElement("span");
  t.className = "half top";
  t.style.setProperty("background", top);
  const b = document.createElement("span");
  b.className = "half bottom";
  b.style.setProperty("background", bottom);
  el.append(t, b);
}

// 모두 보기의 칸 색: 인원 비율만큼 진해진다. 전원이면 가장 진하다.
function heat(color, count, total) {
  if (!count) return "transparent";
  const pct = Math.round(18 + 70 * (count / Math.max(total, 1)));
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// 내 일정 칸: 점심은 위 절반, 저녁은 아래 절반, 불가는 ✕. 드래그 중에도 이 칸만 다시 칠한다
// (달력 전체를 다시 그리면 손가락 아래 요소가 바뀌어 터치 드래그가 끊긴다).
function drawMine(button, s) {
  button.querySelectorAll(".half, .x").forEach((el) => el.remove());
  if (s === FULL || s === LUNCH || s === DINNER) {
    paint(button, s === DINNER ? "transparent" : "var(--lunch)", s === LUNCH ? "transparent" : "var(--dinner)");
  }
  if (s === NO) {
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "✕";
    button.appendChild(x);
  }
  button.setAttribute("aria-label", `${dateLabel(button.dataset.date)} ${STATE_LABEL[s] ?? "미응답"}`);
}

function renderCalendar() {
  const dates = datesBetween(state.period.start, state.period.end);
  const inPeriod = new Set(dates);
  const mine = myVotes();
  const memberIds = state.members.map((m) => m.id);
  const { byDate } = tally(allVotes(), memberIds, dates);
  const total = state.members.length;
  const today = kstToday();
  const confirmed = state.confirmed?.date;

  const months = [];
  for (let d = state.period.start.slice(0, 8) + "01"; d <= state.period.end; ) {
    const [y, m] = d.split("-").map(Number);
    months.push({ y, m });
    d = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }

  const wrap = $("months");
  wrap.replaceChildren();
  for (const { y, m } of months) {
    const box = document.createElement("div");
    box.className = "month";
    const h = document.createElement("h3");
    h.textContent = `${y}년 ${m}월`;
    const grid = document.createElement("div");
    grid.className = "grid";
    ["일", "월", "화", "수", "목", "금", "토"].forEach((w, i) => {
      const cell = document.createElement("div");
      cell.className = "dow" + (i === 0 ? " sun" : i === 6 ? " sat" : "");
      cell.textContent = w;
      grid.appendChild(cell);
    });
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    for (let i = 0; i < weekday(first); i += 1) grid.appendChild(document.createElement("div"));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let day = 1; day <= last; day += 1) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const wd = weekday(date);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "day" + (wd === 0 ? " sun" : wd === 6 ? " sat" : "")
        + (date === today ? " today" : "") + (date === confirmed ? " picked" : "");
      button.dataset.date = date;
      button.disabled = !inPeriod.has(date) || (view === "mine" && !state.me);
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = day;
      if (inPeriod.has(date)) {
        if (view === "mine") {
          drawMine(button, mine[date] ?? NONE);
        } else {
          const t = byDate[date];
          paint(button, heat("var(--lunch)", t.lunch, total), heat("var(--dinner)", t.dinner, total));
          if (t.lunch || t.dinner) {
            const counts = document.createElement("span");
            counts.className = "counts";
            counts.textContent = `${t.lunch}·${t.dinner}`;
            button.appendChild(counts);
          }
          button.setAttribute("aria-label", `${dateLabel(date)} 점심 ${t.lunch}명 저녁 ${t.dinner}명`);
        }
      }
      button.prepend(num);
      grid.appendChild(button);
    }
    box.append(h, grid);
    wrap.appendChild(box);
  }

  $("cal-help").textContent = view === "mine"
    ? (state.me ? "톡 누를 때마다 전일 → 점심만 → 저녁만 → 불가 순서로 바뀌어요." : "참여하면 날짜를 누를 수 있어요.")
    : (state.me?.host ? "칸 위는 점심, 아래는 저녁 인원이에요. 날짜를 누르면 그날로 확정할 수 있어요."
      : "칸 위는 점심, 아래는 저녁 인원이에요. 진할수록 많이 돼요.");
  $("drag-tip").textContent = view === "mine" && state.me
    ? (matchMedia("(pointer: coarse)").matches ? "꾹 누른 채 끌면 여러 날을 한 번에 칠해요." : "누른 채 끌면 여러 날을 한 번에 칠해요.")
    : "";
  const legend = view === "mine"
    ? [["var(--lunch)", "점심"], ["var(--dinner)", "저녁"], ["transparent", "✕ 불가"]]
    : [["var(--lunch)", "점심 인원"], ["var(--dinner)", "저녁 인원"]];
  $("legend").replaceChildren(...legend.map(([color, text]) => {
    const span = document.createElement("span");
    const i = document.createElement("i");
    i.style.setProperty("background", color);
    span.append(i, text);
    return span;
  }));
}

function renderBest() {
  const dates = datesBetween(state.period.start, state.period.end);
  const memberIds = state.members.map((m) => m.id);
  const { byDate } = tally(allVotes(), memberIds, dates);
  const best = bestDates(byDate, 3);
  $("best-empty").hidden = best.length > 0;
  $("best").replaceChildren(...best.map((item) => {
    const li = document.createElement("li");
    const text = document.createElement("div");
    const when = document.createElement("div");
    when.textContent = `${dateLabel(item.date)} ${SLOT_LABEL[item.slot]}`;
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = `${item.count}/${state.members.length}명 · 점심 ${item.lunch} 저녁 ${item.dinner}`;
    text.append(when, who);
    li.appendChild(text);
    if (state.me?.host) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "확정";
      button.addEventListener("click", () => openConfirm(item.date, item.slot));
      li.appendChild(button);
    }
    return li;
  }));
}

function renderMembers() {
  $("m-count").textContent = `${state.members.length}/${state.max}`;
  $("members").replaceChildren(...state.members.map((m) => {
    const span = document.createElement("span");
    span.className = m.responded ? "" : "yet";
    span.textContent = `${m.host ? "👑 " : ""}${m.name}${m.responded ? " ✓" : ""}${m.id === state.me?.id ? " (나)" : ""}`;
    return span;
  }));
  $("resume").hidden = !state.me;
  $("resume").parentElement.hidden = !state.me;
}

function renderHost() {
  $("host-card").hidden = !state.me?.host;
  if (!state.me?.host) return;
  const others = state.members.filter((m) => m.id !== state.me.id);
  $("handover").replaceChildren(...(others.length ? others.map((m) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = m.name;
    button.addEventListener("click", async () => {
      await act("host", { memberId: m.id });
    });
    return button;
  }) : [Object.assign(document.createElement("span"), { className: "muted", textContent: "아직 다른 참여자가 없어요." })]));
  if (document.activeElement !== $("p-name") && document.activeElement !== $("p-url")) {
    $("p-name").value = state.place?.name ?? "";
    $("p-url").value = state.place?.url ?? "";
  }
}

function renderConfirmed() {
  const c = state.confirmed;
  $("confirmed").hidden = !c;
  if (!c) return;
  $("cf-when").textContent = `📅 ${dateLabel(c.date)} ${SLOT_LABEL[c.slot]}`;
  $("cf-place").textContent = state.place ? `📍 ${state.place.name}` : "장소는 아직이에요.";
  $("cf-map").hidden = !state.place;
  if (state.place) $("cf-map").href = state.place.url;
  const event = calendarEvent({ title: state.title, date: c.date, slot: c.slot, place: state.place });
  $("cf-google").href = event.google;
}

function render() {
  $("room").hidden = false;
  $("r-code").textContent = `방 코드 ${state.code}`;
  $("r-title").textContent = state.title;
  document.title = `${state.title} — 약속 잡기`;
  const responded = state.members.filter((m) => m.responded).length;
  $("r-meta").textContent = `${dateLabel(state.period.start)} ~ ${dateLabel(state.period.end)} · ${state.members.length}명 중 ${responded}명 응답`;
  $("join").hidden = Boolean(state.me);
  const expires = new Date(state.expiresAt);
  $("expires").textContent = `이 방은 ${expires.getMonth() + 1}월 ${expires.getDate()}일에 저절로 터져요 🫧`;
  renderConfirmed();
  renderCalendar();
  renderBest();
  renderMembers();
  renderHost();
}

async function refresh() {
  if (inFlight || Object.keys(pending).length) return;
  try {
    state = await api(`/${code}`, { token });
    if (token && !state.me) { token = null; forgetRoom(code); }   // 토큰이 더는 이 방의 것이 아니다
    saveRoom(code, { title: state.title, ...(token ? { token } : {}) });
    render();
  } catch (error) {
    if (error.status === 404) showGone("🔍", "없는 방이에요", "방 코드를 다시 확인해 주세요.");
    else if (error.status === 410) { forgetRoom(code); showGone("🫧", "터트린 방이에요", "방장이 방을 터트려서 기록이 모두 사라졌어요."); }
  }
}

async function flush() {
  flushTimer = null;
  const votes = { ...pending };
  if (!Object.keys(votes).length) return;
  inFlight = true;
  $("saving").textContent = "저장 중…";
  try {
    const data = await api(`/${code}/vote`, { method: "POST", body: { votes }, token });
    for (const [date, s] of Object.entries(votes)) if (pending[date] === s) delete pending[date];
    state = data.state;
    $("saving").textContent = "저장됨";
    render();
  } catch (error) {
    $("saving").textContent = `저장 못 함: ${error.message}`;
  } finally {
    inFlight = false;
    if (Object.keys(pending).length && !flushTimer) flushTimer = setTimeout(flush, 600);
  }
}

async function act(action, body) {
  const data = await api(`/${code}/${action}`, { method: "POST", body, token });
  state = data.state ?? state;
  render();
  return data;
}

// 확정 창
let confirmDate = null;
let confirmSlot = "dinner";
function openConfirm(date, slot) {
  const dates = datesBetween(state.period.start, state.period.end);
  const t = tally(allVotes(), state.members.map((m) => m.id), dates).byDate[date];
  confirmDate = date;
  confirmSlot = slot === "full" && t.lunch !== t.dinner ? (t.lunch > t.dinner ? "lunch" : "dinner") : slot;
  $("cd-date").textContent = dateLabel(date);
  $("cd-counts").textContent = `점심 ${t.lunch}명 · 저녁 ${t.dinner}명 가능 (${state.members.length}명 중)`;
  for (const b of $("cd-slots").children) b.setAttribute("aria-pressed", String(b.dataset.slot === confirmSlot));
  $("confirm-dialog").showModal();
}

// 내 일정 칠하기. 톡 = 한 칸 순환. 누른 채 끌기 = 첫 칸이 바뀔 상태로 지나간 칸을 모두 칠한다.
// 마우스는 누르는 즉시 끌기, 터치는 잠깐(HOLD_MS) 누르고 있어야 끌기 — 바로 쓸면 스크롤이다.
const HOLD_MS = 220;
const MOVE_SLOP = 8;
function bindPaint() {
  const months = $("months");
  let gesture = null;   // { id, x, y, start, target, dragging, painted:Set, hold }

  const dayAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest?.(".day");
    return el && months.contains(el) && !el.disabled ? el : null;
  };
  const apply = (button, target) => {
    pending[button.dataset.date] = target;
    drawMine(button, target);
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
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 600);
  };

  months.addEventListener("pointerdown", (event) => {
    if (view !== "mine" || !state?.me || event.button > 0) return;
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
  months.addEventListener("contextmenu", (event) => { if (view === "mine") event.preventDefault(); });
}

function bindRoom() {
  $("tab-mine").addEventListener("click", () => { view = "mine"; syncTabs(); renderCalendar(); });
  $("tab-all").addEventListener("click", () => { view = "all"; syncTabs(); renderCalendar(); });
  function syncTabs() {
    $("tab-mine").setAttribute("aria-pressed", String(view === "mine"));
    $("tab-all").setAttribute("aria-pressed", String(view === "all"));
  }

  // 모두 보기: 방장이 날짜를 누르면 확정 창.
  $("months").addEventListener("click", (event) => {
    const button = event.target.closest(".day");
    if (!button || button.disabled || view !== "all") return;
    if (state.me?.host) openConfirm(button.dataset.date, "full");
  });
  bindPaint();

  $("join").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("j-err").textContent = "";
    try {
      const data = await api(`/${code}/join`, { method: "POST", body: { name: $("j-name").value } });
      token = data.token;
      state = data.state;
      saveRoom(code, { token, title: state.title });
      render();
    } catch (error) {
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
    await act("confirm", { date: confirmDate, slot: confirmSlot });
  });

  $("cf-ics").addEventListener("click", () => {
    const c = state.confirmed;
    const { ics } = calendarEvent({ title: state.title, date: c.date, slot: c.slot, place: state.place });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = `yaksok-${c.date}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("p-save").addEventListener("click", async () => {
    $("p-err").textContent = "";
    try { await act("place", { name: $("p-name").value, url: $("p-url").value }); }
    catch (error) { $("p-err").textContent = error.message; }
  });
  $("p-clear").addEventListener("click", async () => {
    $("p-name").value = ""; $("p-url").value = "";
    await act("place", { url: null });
  });

  $("pop").addEventListener("click", async () => {
    $("pop-err").textContent = "";
    try {
      await act("pop", { title: $("pop-title").value });
      forgetRoom(code);
      const burst = document.createElement("div");
      burst.className = "pop";
      burst.innerHTML = "<span>🫧</span>";
      document.body.appendChild(burst);
      setTimeout(() => showGone("🫧", "펑! 방을 터트렸어요", "모든 응답과 기록을 지웠어요."), 650);
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
      prompt("이 링크를 복사해 두세요 (나만 보관)", link);
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
    history.replaceState(null, "", location.pathname);
  }
  token = loadRooms()[code]?.token ?? null;
  bindRoom();
  await refresh();
}

// 공유(오른쪽 아래 독): 방 주소가 그대로 나가고 카톡이 방 이름 미리보기를 붙인다.
window.blShareText = () => (state && !state.confirmed
  ? `🫧 ${state.title} — 되는 날짜 톡톡 눌러 줘!`
  : state ? `🫧 ${state.title} 약속 잡혔어!` : "");

if (code) openRoom(); else showHome();
