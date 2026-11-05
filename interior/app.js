// 인테리어 동선 계산기 — 화면. 계산은 전부 engine.js, 여기는 그리기·조작·저장만.
// three.js 는 CDN 없이 /_shared/vendor/ 셀프호스팅. 1 단위 = 1m (도면 cm / 100).
import * as THREE from "/_shared/vendor/three.module.min.js";
import {
  accessPoint, evaluate, footprint, normalizePlan, normRot, placementProblems, placeOnFace, wallFaces, WALK_CM_PER_S,
} from "./engine.js";
import { llmPrompt } from "./prompt.js";

const $ = (id) => document.getElementById(id);
const STORE = "interior.plan.v1";
const M = 0.01; // cm → m
const TASK_COLORS = ["#e4572e", "#2e86ab", "#e0a100", "#8a4fd8", "#2fa36b", "#d6336c", "#5c7cfa", "#a0522d"];
const KIND_COLORS = {
  laundry: "#7fb7e6", kitchen: "#f2b880", storage: "#c9a77c", cleaning: "#9ad1a5", furniture: "#c7c2d6", door: "#f06595",
};

let plan = null;
let base = null;              // 비교 기준 점수(cm)
let hiddenTasks = new Set();
let selected = null;          // item id
let lowWalls = true;
const undoStack = [];

// ── 저장 ─────────────────────────────────────────────
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ plan, base, hidden: [...hiddenTasks] })); } catch { /* */ } };
async function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "null");
    if (raw?.plan) { plan = normalizePlan(raw.plan); base = raw.base ?? null; hiddenTasks = new Set(raw.hidden ?? []); return; }
  } catch { /* 깨졌으면 예시로 */ }
  plan = normalizePlan(await (await fetch("./plans/sample.json")).json());
}
function pushUndo() {
  undoStack.push(JSON.stringify(plan));
  if (undoStack.length > 50) undoStack.shift();
  $("undo").disabled = false;
}

let toastTimer;
function toast(text, ms = 2500) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ── 색(테마 토큰을 three 가 읽을 수 있는 rgb 로) ──────────────
const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function tokenColor(name) {
  const el = document.createElement("span");
  el.style.setProperty("color", `var(${name})`);
  document.body.append(el);
  const css = getComputedStyle(el).color;
  el.remove();
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = "#000"; probe.fillStyle = css; probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(r / 255, g / 255, b / 255);
}

// ── 장면 ─────────────────────────────────────────────
const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-4, 10, -6);
scene.add(sun);

const world = new THREE.Group();   // 도면이 바뀌면 통째로 다시 만든다(가구 몇십 개라 싸다)
const pathsGroup = new THREE.Group();
scene.add(world, pathsGroup);
const itemMeshes = new Map();       // id → mesh
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const orbit = { theta: -0.6, phi: 0.95, radius: 14, target: new THREE.Vector3() };
function placeCamera() {
  const { theta, phi, radius, target } = orbit;
  camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
}
function fitCamera() {
  orbit.target.set(plan.room.w * M / 2, 0, plan.room.d * M / 2);
  const span = Math.max(plan.room.w, plan.room.d) * M;
  const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  orbit.radius = span * (aspect < 1.2 ? 1.45 / Math.min(1, aspect) : 1.7);
}

function labelSprite(text, { size = 0.22, bg = "rgba(255,255,255,.88)", fg = "#15171c" } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const font = "600 40px Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  c.width = w; c.height = 60;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, w, 60, 30); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText(text, w / 2, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(size * w / 60, size, 1);
  sp.renderOrder = 10;
  return sp;
}

function flatLabel(text, color) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = "700 64px Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  const w = Math.ceil(ctx.measureText(text).width) + 8;
  c.width = w; c.height = 80;
  ctx.font = "700 64px Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = color; ctx.textBaseline = "middle";
  ctx.fillText(text, 4, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const h = 0.32;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * w / 80, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function buildWorld() {
  world.clear(); itemMeshes.clear();
  const ink = tokenColor("--ink"), line = tokenColor("--line"), field = tokenColor("--field"), muted = tokenColor("--muted");
  scene.background = tokenColor("--bg");
  const { w, d } = plan.room;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w * M, d * M), new THREE.MeshStandardMaterial({ color: field, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(w * M / 2, 0, d * M / 2);
  world.add(floor);
  // 구역: 옅은 판 + 바닥 글씨
  const grid = new THREE.GridHelper(Math.max(w, d) * M, Math.max(w, d) / 50, line, line);
  grid.position.set(Math.max(w, d) * M / 2, 0.001, Math.max(w, d) * M / 2);
  grid.material.transparent = true; grid.material.opacity = 0.35;
  world.add(grid);
  for (const z of plan.zones ?? []) {
    const lbl = flatLabel(z.label, `#${muted.getHexString()}`);
    lbl.position.set((z.x0 + 12) * M + lbl.geometry.parameters.width / 2, 0.003, (z.y0 + 22) * M);
    world.add(lbl);
  }
  // 벽: 바깥 네 면 + 안쪽 벽
  const wallH = lowWalls ? 1.0 : 2.4;
  const wallMat = new THREE.MeshStandardMaterial({ color: ink.clone().lerp(field, 0.35), roughness: 0.9 });
  const T = 10;
  const walls = [
    { x1: 0, y1: -T / 2, x2: w, y2: -T / 2, t: T }, { x1: 0, y1: d + T / 2, x2: w, y2: d + T / 2, t: T },
    { x1: -T / 2, y1: -T, x2: -T / 2, y2: d + T, t: T }, { x1: w + T / 2, y1: -T, x2: w + T / 2, y2: d + T, t: T },
    ...(plan.walls ?? []),
  ];
  for (const wl of walls) {
    const t = wl.t ?? 10;
    const lx = Math.abs(wl.x2 - wl.x1) || t, lz = Math.abs(wl.y2 - wl.y1) || t;
    const m = new THREE.Mesh(new THREE.BoxGeometry((wl.x1 === wl.x2 ? t : lx + t) * M, wallH, (wl.y1 === wl.y2 ? t : lz + t) * M), wallMat);
    m.position.set((wl.x1 + wl.x2) / 2 * M, wallH / 2, (wl.y1 + wl.y2) / 2 * M);
    world.add(m);
  }
  // 가구
  for (const it of plan.items) {
    if (it.pass || !it.w || !it.d) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24), new THREE.MeshStandardMaterial({ color: KIND_COLORS[it.kind] ?? "#f06595" }));
      pin.position.set(it.x * M, 0.01, it.y * M);
      pin.userData.id = it.id;
      const lbl = labelSprite(it.label, { size: 0.2 });
      lbl.position.set(0, 0.35, 0);
      pin.add(lbl);
      world.add(pin); itemMeshes.set(it.id, pin);
      continue;
    }
    const color = new THREE.Color(it.color ?? KIND_COLORS[it.kind] ?? "#c7c2d6");
    const h = Math.max(0.05, (it.h ?? 80) * M);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(it.w * M, h, it.d * M),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
    body.position.y = h / 2;
    body.userData.id = it.id;
    g.add(body);
    // 앞면 표시: 앞쪽 아래 띠
    const strip = new THREE.Mesh(new THREE.BoxGeometry(it.w * M * 0.9, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.55) }));
    strip.position.set(0, 0.04, it.d * M / 2 + 0.011);
    g.add(strip);
    if (it.fixed) {
      const lock = labelSprite("📌", { size: 0.18, bg: "rgba(0,0,0,0)" });
      lock.position.set(it.w * M / 2 - 0.08, h + 0.12, 0);
      g.add(lock);
    }
    const lbl = labelSprite(it.label, { size: 0.2 });
    lbl.position.set(0, h + 0.18, 0);
    g.add(lbl);
    g.userData.id = it.id; g.userData.body = body;
    world.add(g);
    itemMeshes.set(it.id, g);
    placeMesh(it);
  }
  markSelection();
}

function placeMesh(it) {
  const g = itemMeshes.get(it.id);
  if (!g) return;
  g.position.set(it.x * M, it.pass ? 0.01 : 0, it.y * M);
  if (!it.pass) g.rotation.y = -normRot(it.rot) * Math.PI / 180;
}

function markSelection() {
  for (const [id, g] of itemMeshes) {
    const body = g.userData.body;
    if (!body) continue;
    const bad = placementProblems(plan, plan.items.find((x) => x.id === id)).length > 0;
    body.material.emissive = new THREE.Color(bad ? 0x992222 : id === selected ? 0x443300 : 0x000000);
  }
}

// 길: 바닥에 납작한 띠
function drawPaths(result) {
  pathsGroup.clear();
  result.tasks.forEach((t, i) => {
    if (hiddenTasks.has(t.id)) return;
    const mat = new THREE.MeshBasicMaterial({ color: TASK_COLORS[i % TASK_COLORS.length], transparent: true, opacity: 0.85, depthWrite: false });
    const lift = 0.004 + i * 0.0015;
    for (const leg of t.legs) {
      if (!leg.points) continue;
      for (let k = 0; k + 1 < leg.points.length; k++) {
        const a = leg.points[k], b = leg.points[k + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y) * M;
        if (len < 1e-3) continue;
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.06, 0.06), mat);
        seg.rotation.x = -Math.PI / 2;
        seg.rotation.z = -Math.atan2(b.y - a.y, b.x - a.x);
        seg.position.set((a.x + b.x) / 2 * M, lift, (a.y + b.y) / 2 * M);
        pathsGroup.add(seg);
      }
    }
  });
  // 서는 자리
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x15171c, transparent: true, opacity: 0.5 });
  for (const it of plan.items) {
    if (it.pass) continue;
    const p = accessPoint(it);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(p.x * M, 0.02, p.y * M);
    pathsGroup.add(dot);
  }
}

// ── 점수판 ────────────────────────────────────────────
const fmtM = (cm) => `${(cm / 100).toFixed(cm < 1000 ? 1 : 0)}m`;
let lastResult = null;
function refresh() {
  const r = evaluate(plan, { withPaths: true });
  lastResult = r;
  if (base == null) base = r.weeklyCm;
  $("plan-name").textContent = plan.name;
  $("score").textContent = `${(r.weeklyCm / 100).toFixed(0)}m`;
  $("score-sub").textContent = `한 주에 약 ${Math.round(r.weeklyMin)}분 걸음`;
  const diff = r.weeklyCm - base;
  const delta = $("delta");
  delta.textContent = Math.abs(diff) < 50 ? "" : `${diff < 0 ? "▼" : "▲"} ${fmtM(Math.abs(diff))} (${Math.round(Math.abs(diff) / base * 100)}%) 기준 대비`;
  delta.className = `delta ${diff < 0 ? "good" : "bad"}`;
  const list = $("tasks");
  list.replaceChildren(...r.tasks.map((t, i) => {
    const li = document.createElement("li");
    li.classList.toggle("off", hiddenTasks.has(t.id));
    const sw = document.createElement("span");
    sw.className = "sw"; sw.style.setProperty("background", TASK_COLORS[i % TASK_COLORS.length]);
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    const blocked = t.legs.some((l) => l.blocked || l.missing);
    lbl.textContent = `${t.label} · 주 ${t.perWeek}회${blocked ? " · ⚠ 못 가는 길" : ""}`;
    if (blocked) lbl.classList.add("warn");
    lbl.title = t.legs.map((l) => `${nameOf(l.from)} → ${nameOf(l.to)} ${fmtM(l.cm)}`).join("\n");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `${fmtM(t.cm)} × ${t.perWeek} = ${fmtM(t.weeklyCm)}`;
    li.append(sw, lbl, num);
    li.addEventListener("click", () => {
      hiddenTasks.has(t.id) ? hiddenTasks.delete(t.id) : hiddenTasks.add(t.id);
      save(); refresh();
    });
    return li;
  }));
  $("problems").textContent = r.problems.length ? `⚠ ${r.problems.map((p) => `${p.label}: ${p.problems.join(", ")}`).join(" / ")}` : "";
  drawPaths(r);
  markSelection();
  showSelection();
  save();
}
const nameOf = (id) => plan.items.find((x) => x.id === id)?.label ?? id;

function showSelection() {
  const it = plan.items.find((x) => x.id === selected);
  $("sel").hidden = !it;
  if (!it) return;
  const f = footprint(it);
  $("sel-title").textContent = it.label;
  $("sel-meta").textContent = `${it.w}×${it.d}×${it.h ?? 0}cm · 바닥 ${f.w}×${f.d} · 중심 (${Math.round(it.x)}, ${Math.round(it.y)}) · ${normRot(it.rot)}°${it.wall ? " · 벽붙이" : ""}`;
  $("pin").textContent = it.fixed ? "📌 고정 풀기" : "📌 고정";
  $("rotate").disabled = !!it.fixed || !!it.pass;
  $("sel-problems").textContent = placementProblems(plan, it).join(", ");
}

// ── 조작 ─────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointers = new Map();
let drag = null; // { mode: "item"|"orbit"|"pinch", ... }

function toNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function floorPoint(e) {
  toNdc(e);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(floorPlane, p) ? { x: p.x / M, y: p.z / M } : null;
}
function pickItem(e) {
  toNdc(e);
  const hits = ray.intersectObjects([...itemMeshes.values()], true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.id) o = o.parent;
    if (o && !(o instanceof THREE.Sprite)) return o.userData.id;
    if (o) return o.userData.id;
  }
  return null;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  renderer.domElement.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    if (drag?.mode === "item") finishItemDrag(true);
    const [a, b] = [...pointers.values()];
    drag = { mode: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, radius: orbit.radius };
    return;
  }
  const id = pickItem(e);
  const it = id && plan.items.find((x) => x.id === id);
  if (it) {
    selected = id;
    markSelection(); showSelection();
    if (it.fixed) { drag = { mode: "orbit", x: e.clientX, y: e.clientY, moved: false }; toast("📌 고정된 가구예요 — 아래에서 고정을 풀면 옮길 수 있어요"); return; }
    const p = floorPoint(e);
    drag = { mode: "item", id, start: JSON.stringify(plan), off: p ? { x: it.x - p.x, y: it.y - p.y } : { x: 0, y: 0 }, moved: false };
  } else {
    drag = { mode: "orbit", x: e.clientX, y: e.clientY, moved: false, tap: true };
  }
});

let pending = false;
function scheduleRefresh() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; refresh(); });
}

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  if (drag.mode === "pinch" && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    orbit.radius = Math.min(60, Math.max(2, drag.radius * drag.dist / Math.max(1, dist)));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pan(mid.x - drag.mid.x, mid.y - drag.mid.y);
    drag.mid = mid;
    return;
  }
  if (drag.mode === "orbit") {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    if (e.shiftKey || e.buttons === 2 || e.buttons === 4) pan(dx, dy);
    else {
      orbit.theta -= dx * 0.008;
      orbit.phi = Math.min(1.45, Math.max(0.02, orbit.phi - dy * 0.006));
    }
    return;
  }
  if (drag.mode === "item") {
    const p = floorPoint(e);
    if (!p) return;
    const it = plan.items.find((x) => x.id === drag.id);
    const nx = Math.round((p.x + drag.off.x) / 5) * 5, ny = Math.round((p.y + drag.off.y) / 5) * 5;
    if (nx === it.x && ny === it.y) return;
    it.x = Math.min(plan.room.w, Math.max(0, nx)); it.y = Math.min(plan.room.d, Math.max(0, ny));
    drag.moved = true;
    placeMesh(it);
    scheduleRefresh();
  }
});

function pan(dx, dy) {
  const k = orbit.radius * 0.0016;
  const right = new THREE.Vector3(Math.cos(orbit.theta), 0, -Math.sin(orbit.theta));
  const fwd = new THREE.Vector3(-Math.sin(orbit.theta), 0, -Math.cos(orbit.theta));
  orbit.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
}

// 벽붙이 가구는 놓을 때 가장 가까운 벽 면(60cm 안)에 등을 붙인다.
function snapToWall(it) {
  let best = null, bestD = 60;
  for (const f of wallFaces(plan)) {
    const along = f.axis === "y" ? it.x : it.y;
    if (along < f.a - 20 || along > f.b + 20) continue;
    const cand = placeOnFace(it, f, along);
    const dd = Math.hypot(cand.x - it.x, cand.y - it.y);
    if (dd < bestD) { bestD = dd; best = cand; }
  }
  if (best) Object.assign(it, { x: best.x, y: best.y, rot: best.rot });
}

function finishItemDrag(cancel) {
  const it = plan.items.find((x) => x.id === drag.id);
  if (cancel) { plan = JSON.parse(drag.start); buildWorld(); drag = null; refresh(); return; }
  if (drag.moved) {
    if (it.wall) snapToWall(it);
    undoStack.push(drag.start); if (undoStack.length > 50) undoStack.shift();
    $("undo").disabled = false;
    placeMesh(it);
    refresh();
    const probs = placementProblems(plan, it);
    if (probs.length) toast(`⚠ ${it.label}: ${probs.join(", ")}`);
  }
  drag = null;
}

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  if (drag.mode === "item") { finishItemDrag(false); return; }
  if (drag.mode === "pinch") { if (pointers.size === 0) drag = null; return; }
  if (drag.mode === "orbit" && drag.tap && !drag.moved) { selected = null; markSelection(); showSelection(); }
  if (pointers.size === 0) drag = null;
}
renderer.domElement.addEventListener("pointerup", endPointer);
renderer.domElement.addEventListener("pointercancel", endPointer);
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();
  orbit.radius = Math.min(60, Math.max(2, orbit.radius * Math.exp(e.deltaY * 0.001)));
}, { passive: false });

// ── 버튼 ─────────────────────────────────────────────
$("rotate").addEventListener("click", () => {
  const it = plan.items.find((x) => x.id === selected);
  if (!it || it.fixed) return;
  pushUndo();
  it.rot = normRot(it.rot + 90);
  if (it.wall) snapToWall(it);
  placeMesh(it); refresh();
});
$("pin").addEventListener("click", () => {
  const it = plan.items.find((x) => x.id === selected);
  if (!it) return;
  pushUndo();
  if (it.fixed) delete it.fixed; else it.fixed = true;
  buildWorld(); refresh();
});
$("deselect").addEventListener("click", () => { selected = null; markSelection(); showSelection(); });
$("undo").addEventListener("click", () => {
  const prev = undoStack.pop();
  if (!prev) return;
  plan = JSON.parse(prev);
  $("undo").disabled = !undoStack.length;
  buildWorld(); refresh();
});
$("reset-base").addEventListener("click", () => { base = lastResult?.weeklyCm ?? null; refresh(); toast("지금 배치를 비교 기준으로 잡았어요"); });
$("view").addEventListener("click", () => {
  const top = orbit.phi > 0.1;
  orbit.phi = top ? 0.02 : 0.95;
  if (top) orbit.theta = 0;
  $("view").textContent = top ? "🧊 입체로" : "⬇ 위에서";
});
$("walls").addEventListener("click", () => {
  lowWalls = !lowWalls;
  $("walls").textContent = lowWalls ? "🧱 벽 낮게" : "🧱 벽 높게";
  buildWorld();
});

let worker = null;
$("optimize").addEventListener("click", () => {
  if (worker) { worker.terminate(); worker = null; endOptimize(); toast("최적화를 멈췄어요"); return; }
  const before = lastResult?.weeklyCm ?? 0;
  worker = new Worker(new URL("./opt-worker.js", import.meta.url), { type: "module" });
  const bar = $("progress");
  bar.hidden = false; bar.firstElementChild.style.setProperty("width", "0%");
  $("optimize").textContent = "■ 멈추기";
  const iterations = 2500;
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") { bar.firstElementChild.style.setProperty("width", `${Math.round(data.ratio * 100)}%`); return; }
    const after = evaluate(data.plan).weeklyCm;
    if (after < before - 1) {
      pushUndo();
      plan = data.plan;
      buildWorld(); refresh();
      toast(`✨ 주 ${fmtM(before)} → ${fmtM(after)} — 마음에 안 들면 ↶ 되돌리기`, 4000);
    } else {
      toast("더 줄일 배치를 못 찾았어요 — 고정(📌)이나 구역을 풀어 보세요", 4000);
    }
    endOptimize();
  };
  worker.onerror = (e) => { toast(`최적화 오류: ${e.message}`); endOptimize(); };
  worker.postMessage({ plan, iterations, seed: (Date.now() % 100000) + 1 });
});
function endOptimize() {
  worker?.terminate(); worker = null;
  $("progress").hidden = true;
  $("optimize").textContent = "✨ 동선 최적화";
}

// JSON 대화상자
const dlg = $("json-dlg");
$("open-json").addEventListener("click", () => {
  $("json-text").value = JSON.stringify(plan, null, 2);
  $("json-err").textContent = "";
  dlg.showModal();
});
function loadText(text) {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const next = normalizePlan(cleaned);
    pushUndo();
    plan = next; base = null; selected = null; hiddenTasks.clear();
    fitCamera(); buildWorld(); refresh();
    dlg.close();
    toast(`「${plan.name}」 불러왔어요 — 가구 ${plan.items.length}개, 할 일 ${plan.tasks.length}개`);
  } catch (err) {
    $("json-err").textContent = `⚠ ${err.message}`;
  }
}
$("json-load").addEventListener("click", () => loadText($("json-text").value));
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} 복사했어요`); }
  catch { $("json-text").value = text; $("json-text").select(); toast("복사가 막혀서 글상자에 넣었어요 — 직접 복사해 주세요"); }
}
$("json-copy").addEventListener("click", () => copy(JSON.stringify(plan, null, 2), "도면 JSON"));
$("json-prompt").addEventListener("click", () => copy(llmPrompt(plan), "LLM 요청문"));
$("json-sample").addEventListener("click", async () => {
  $("json-text").value = JSON.stringify(await (await fetch("./plans/sample.json")).json(), null, 2);
});

// ── 시작 ─────────────────────────────────────────────
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => buildWorld());

await load();
resize();
fitCamera();
buildWorld();
refresh();
renderer.setAnimationLoop(() => { placeCamera(); renderer.render(scene, camera); });
// 시험용 손잡이 — 화면 검사(E2E)가 점수를 읽는다
window.interior = { get plan() { return plan; }, get result() { return lastResult; }, WALK_CM_PER_S };
