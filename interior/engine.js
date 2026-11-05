// 인테리어 동선 계산기 — 순수 함수만 둔다(화면·워커·테스트가 같이 쓴다).
//
// 평면 좌표는 cm, 원점은 왼쪽 위, x 는 오른쪽, y 는 아래(도면을 위에서 본 그대로).
// 가구는 중심(x, y)·너비 w·깊이 d·높이 h·회전 rot(0/90/180/270, 시계 방향)이고,
// rot 0 일 때 앞면이 +y(도면 아래)를 본다. 사람은 앞면 앞 ACCESS cm 에 서서 쓴다.
//
// 구역(zones)은 방 이름표이자 울타리다 — 가구에 zone 을 적으면 그 구역(들) 안에서만 움직인다.
//
// 동선 = 할 일(tasks)마다 들르는 가구(stops)를 차례로 걸은 거리 × 주당 횟수.
// 걷는 길은 격자 위 A*(8방향)로 벽·가구를 몸 반지름만큼 부풀려 피한다.

export const ACCESS = 35;        // 앞면에서 사람이 서는 거리
export const BODY = 20;          // 몸 반지름 — 가구·벽 사이 40cm 미만 틈은 못 지나간다
export const WALL_T = 10;        // 벽 두께 기본값
export const WALK_CM_PER_S = 80; // 짐 들고 걷는 속도(0.8 m/s)
export const UNREACHABLE_CM = 5000; // 못 가는 구간의 벌점(50m)

const DEG = { 0: 0, 90: 90, 180: 180, 270: 270 };
export const normRot = (r) => DEG[((Math.round((r ?? 0) / 90) * 90) % 360 + 360) % 360];

/** 회전을 반영한 바닥 크기. */
export function footprint(item) {
  const r = normRot(item.rot);
  return r === 90 || r === 270 ? { w: item.d, d: item.w } : { w: item.w, d: item.d };
}

/** 바닥 사각형 [x0, y0, x1, y1]. */
export function rectOf(item, pad = 0) {
  const f = footprint(item);
  return [item.x - f.w / 2 - pad, item.y - f.d / 2 - pad, item.x + f.w / 2 + pad, item.y + f.d / 2 + pad];
}

/** 앞면이 보는 방향(단위 벡터). */
export function frontDir(rot) {
  return { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] }[normRot(rot)];
}

/** 사람이 서서 쓰는 자리. 통과형(pass)·점 항목은 그 자리 자체. */
export function accessPoint(item) {
  if (item.pass || !item.w || !item.d) return { x: item.x, y: item.y };
  const [fx, fy] = frontDir(item.rot);
  const reach = item.d / 2 + ACCESS; // 깊이 축이 곧 앞 방향이라 회전과 무관
  return { x: item.x + fx * reach, y: item.y + fy * reach };
}

/** 벽 하나를 두께가 있는 사각형으로. */
export function wallRect(wall, pad = 0) {
  const t = (wall.t ?? WALL_T) / 2 + pad;
  return [Math.min(wall.x1, wall.x2) - t, Math.min(wall.y1, wall.y2) - t,
    Math.max(wall.x1, wall.x2) + t, Math.max(wall.y1, wall.y2) + t];
}

const overlap = (a, b, eps = 0.5) => a[0] < b[2] - eps && b[0] < a[2] - eps && a[1] < b[3] - eps && b[1] < a[3] - eps;

/** 가구가 놓일 수 있는지 — 방 안, 벽·다른 가구와 겹치지 않음, 벽 붙이기 조건. 문제 목록을 돌려준다. */
export function placementProblems(plan, item) {
  const out = [];
  if (item.pass) return out;
  const r = rectOf(item);
  const { w, d } = plan.room;
  if (r[0] < -0.5 || r[1] < -0.5 || r[2] > w + 0.5 || r[3] > d + 0.5) out.push("방 밖");
  for (const wall of plan.walls ?? []) if (overlap(r, wallRect(wall))) { out.push("벽과 겹침"); break; }
  for (const other of plan.items) {
    if (other === item || other.id === item.id || other.pass) continue;
    if (overlap(r, rectOf(other))) out.push(`${other.label ?? other.id}와 겹침`);
  }
  if (item.wall && !backOnWall(plan, item)) out.push("벽에 안 붙음");
  const zones = allowedZones(plan, item);
  if (zones && !zones.some((z) => r[0] >= z.x0 - 0.5 && r[1] >= z.y0 - 0.5 && r[2] <= z.x1 + 0.5 && r[3] <= z.y1 + 0.5)) {
    out.push(`${zones.map((z) => z.label ?? z.id).join("·")} 밖`);
  }
  return out;
}

/** 가구가 있어도 되는 구역들. zone 이 없으면 null(어디든). */
export function allowedZones(plan, item) {
  if (!item.zone) return null;
  const want = [item.zone].flat();
  const zones = (plan.zones ?? []).filter((z) => want.includes(z.id));
  return zones.length ? zones : null;
}

/** 뒷면이 방 경계나 벽 면에 붙어 있는가(뒷변 길이의 70% 이상이 닿아야 한다). */
export function backOnWall(plan, item) {
  const [fx, fy] = frontDir(item.rot);
  const [x0, y0, x1, y1] = rectOf(item);
  // 뒷변: 앞의 반대쪽
  const seg = fy === 1 ? { axis: "y", at: y0, a: x0, b: x1 } : fy === -1 ? { axis: "y", at: y1, a: x0, b: x1 }
    : fx === 1 ? { axis: "x", at: x0, a: y0, b: y1 } : { axis: "x", at: x1, a: y0, b: y1 };
  const need = (seg.b - seg.a) * 0.7;
  const faces = wallFaces(plan);
  let touched = 0;
  for (const f of faces) {
    if (f.axis !== seg.axis || Math.abs(f.at - seg.at) > 2) continue;
    touched += Math.max(0, Math.min(f.b, seg.b) - Math.max(f.a, seg.a));
  }
  return touched >= need;
}

/** 붙을 수 있는 면 목록 — 방 경계 4개 + 벽마다 양쪽 면. side 는 가구가 놓일 쪽(앞이 볼 방향). */
export function wallFaces(plan) {
  const { w, d } = plan.room;
  const faces = [
    { axis: "y", at: 0, a: 0, b: w, side: [0, 1] },
    { axis: "y", at: d, a: 0, b: w, side: [0, -1] },
    { axis: "x", at: 0, a: 0, b: d, side: [1, 0] },
    { axis: "x", at: w, a: 0, b: d, side: [-1, 0] },
  ];
  for (const wall of plan.walls ?? []) {
    const [x0, y0, x1, y1] = wallRect(wall);
    if (wall.y1 === wall.y2) {
      faces.push({ axis: "y", at: y0, a: x0, b: x1, side: [0, -1] }, { axis: "y", at: y1, a: x0, b: x1, side: [0, 1] });
    } else {
      faces.push({ axis: "x", at: x0, a: y0, b: y1, side: [-1, 0] }, { axis: "x", at: x1, a: y0, b: y1, side: [1, 0] });
    }
  }
  return faces;
}

const ROT_FOR_SIDE = (side) => (side[1] === 1 ? 0 : side[1] === -1 ? 180 : side[0] === 1 ? 270 : 90);

/** 가구를 면에 붙여 놓는다(along 은 면 위 위치, 가구 중심 기준). */
export function placeOnFace(item, face, along) {
  const rot = ROT_FOR_SIDE(face.side);
  const f = footprint({ ...item, rot });
  const depth = face.axis === "y" ? f.d : f.w;
  const half = face.axis === "y" ? f.w / 2 : f.d / 2;
  const t = Math.min(Math.max(along, face.a + half), face.b - half);
  const off = face.at + (face.axis === "y" ? face.side[1] : face.side[0]) * depth / 2;
  return face.axis === "y" ? { ...item, rot, x: t, y: off } : { ...item, rot, x: off, y: t };
}

// ── 격자와 길찾기 ──────────────────────────────────────────

/** 걸을 수 있는 칸 격자. 1 = 막힘. */
export function buildGrid(plan, cell = 10) {
  const cols = Math.ceil(plan.room.w / cell), rows = Math.ceil(plan.room.d / cell);
  const blocked = new Uint8Array(cols * rows);
  const mark = ([x0, y0, x1, y1]) => {
    const c0 = Math.max(0, Math.floor(x0 / cell)), c1 = Math.min(cols - 1, Math.floor(x1 / cell));
    const r0 = Math.max(0, Math.floor(y0 / cell)), r1 = Math.min(rows - 1, Math.floor(y1 / cell));
    for (let r = r0; r <= r1; r++) {
      const cy = (r + 0.5) * cell;
      if (cy <= y0 || cy >= y1) continue;
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * cell;
        if (cx > x0 && cx < x1) blocked[r * cols + c] = 1;
      }
    }
  };
  // 방 경계도 몸 반지름만큼 못 붙는다
  mark([-BODY, -BODY, plan.room.w + BODY, BODY]);
  mark([-BODY, plan.room.d - BODY, plan.room.w + BODY, plan.room.d + BODY]);
  mark([-BODY, -BODY, BODY, plan.room.d + BODY]);
  mark([plan.room.w - BODY, -BODY, plan.room.w + BODY, plan.room.d + BODY]);
  for (const wall of plan.walls ?? []) mark(wallRect(wall, BODY));
  for (const item of plan.items) if (!item.pass && item.w && item.d) mark(rectOf(item, BODY));
  return { cell, cols, rows, blocked };
}

const cellOf = (g, p) => [Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cell))), Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / g.cell)))];

/** 막힌 칸이면 가장 가까운 빈 칸(반경 maxR 칸 안)으로 옮긴다. */
function snapFree(g, c, r, maxR = 6) {
  if (!g.blocked[r * g.cols + c]) return [c, r];
  for (let rad = 1; rad <= maxR; rad++) {
    let best = null, bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows || g.blocked[rr * g.cols + cc]) continue;
      const dd = dc * dc + dr * dr;
      if (dd < bestD) { bestD = dd; best = [cc, rr]; }
    }
    if (best) return best;
  }
  return null;
}

/** 두 점 사이 걷는 거리(cm)와 경로. 못 가면 null. */
export function findPath(g, from, to) {
  const s = cellOf(g, from), t = cellOf(g, to);
  const a = snapFree(g, ...s), b = snapFree(g, ...t);
  if (!a || !b) return null;
  const { cols, rows, blocked, cell } = g;
  const start = a[1] * cols + a[0], goal = b[1] * cols + b[0];
  const n = cols * rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const h = (i) => {
    const dx = Math.abs((i % cols) - b[0]), dy = Math.abs(((i / cols) | 0) - b[1]);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  gScore[start] = 0; heap.push(start, h(start));
  const SQ = Math.SQRT2;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % cols, cr = (cur / cols) | 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (blocked[ni] || closed[ni]) continue;
      // 대각선은 양옆이 다 비어야(모서리를 깎지 않게)
      if (dr && dc && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) continue;
      const ng = gScore[cur] + (dr && dc ? SQ : 1);
      if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; heap.push(ni, ng + h(ni)); }
    }
  }
  if (gScore[goal] === Infinity) return null;
  const pts = [];
  for (let i = goal; i !== -1; i = came[i]) pts.push({ x: ((i % cols) + 0.5) * cell, y: (((i / cols) | 0) + 0.5) * cell });
  pts.reverse();
  // 칸 거리 + 실제 점에서 칸 중심까지의 짧은 끝 구간
  const ends = Math.hypot(from.x - pts[0].x, from.y - pts[0].y) + Math.hypot(to.x - pts.at(-1).x, to.y - pts.at(-1).y);
  return { cm: gScore[goal] * cell + ends, points: [from, ...simplify(pts), to] };
}

// 같은 방향으로 이어지는 점은 빼서 선을 가볍게 한다.
function simplify(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out.at(-1), b = pts[i], c = pts[i + 1];
    if (Math.sign(b.x - a.x) === Math.sign(c.x - b.x) && Math.sign(b.y - a.y) === Math.sign(c.y - b.y)
      && Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-6) continue;
    out.push(b);
  }
  out.push(pts.at(-1));
  return out;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(v, k) {
    const K = this.k, V = this.v;
    let i = K.length; K.push(k); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0];
    const lk = K.pop(), lv = V.pop();
    if (K.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < K.length && K[l] < mk) { m = l; mk = K[l]; }
        if (r < K.length && K[r] < mk) { m = r; mk = K[r]; }
        if (m === i) break;
        K[i] = K[m]; V[i] = V[m]; i = m;
      }
      K[i] = lk; V[i] = lv;
    }
    return top;
  }
}

// ── 동선 점수 ──────────────────────────────────────────────

/** 할 일마다 구간 거리를 재서 주당 총 거리로. withPaths 면 그릴 경로도 담는다. */
export function evaluate(plan, { cell = 10, withPaths = false } = {}) {
  const g = buildGrid(plan, cell);
  const byId = new Map(plan.items.map((it) => [it.id, it]));
  const legCache = new Map();
  const tasks = [];
  let weeklyCm = 0, unreachable = 0;
  for (const task of plan.tasks ?? []) {
    const legs = [];
    let cm = 0;
    for (let i = 0; i + 1 < task.stops.length; i++) {
      const a = byId.get(task.stops[i]), b = byId.get(task.stops[i + 1]);
      if (!a || !b) { legs.push({ from: task.stops[i], to: task.stops[i + 1], cm: UNREACHABLE_CM, missing: true }); cm += UNREACHABLE_CM; unreachable++; continue; }
      const key = `${a.id}>${b.id}`;
      let leg = legCache.get(key);
      if (!leg) {
        const p = findPath(g, accessPoint(a), accessPoint(b));
        leg = p ? { cm: p.cm, points: p.points } : { cm: UNREACHABLE_CM, points: null, blocked: true };
        legCache.set(key, leg);
      }
      if (leg.blocked) unreachable++;
      cm += leg.cm;
      legs.push({ from: a.id, to: b.id, cm: leg.cm, blocked: !!leg.blocked, ...(withPaths && { points: leg.points }) });
    }
    const perWeek = task.perWeek ?? 1;
    weeklyCm += cm * perWeek;
    tasks.push({ id: task.id, label: task.label, perWeek, cm, weeklyCm: cm * perWeek, legs });
  }
  const problems = [];
  for (const it of plan.items) {
    const p = placementProblems(plan, it);
    if (p.length) problems.push({ id: it.id, label: it.label, problems: p });
  }
  return { weeklyCm, weeklyMin: weeklyCm / WALK_CM_PER_S / 60, unreachable, tasks, problems };
}

// ── 최적화 ────────────────────────────────────────────────

/** 시드가 있는 난수(같은 시드면 같은 결과 — 테스트와 "다시 돌리기"가 재현된다). */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const clonePlan = (plan) => ({ ...plan, items: plan.items.map((it) => ({ ...it })) });
const valid = (plan, item) => placementProblems(plan, item).length === 0;

/**
 * 담금질(simulated annealing)로 움직일 수 있는 가구(fixed 가 아닌 것)를 옮긴다.
 * 비용 = 주당 걷는 거리 + 못 가는 구간 벌점. 놓을 수 없는 자리는 아예 받지 않는다.
 * onProgress(i, best) 는 가끔 불린다. 돌려주는 것은 가장 좋았던 배치.
 */
export function optimize(plan, { iterations = 1500, seed = 1, cell = 20, onProgress } = {}) {
  const rand = rng(seed);
  const cost = (p) => evaluate(p, { cell }).weeklyCm;
  let cur = clonePlan(plan);
  let curCost = cost(cur);
  let best = clonePlan(cur), bestCost = curCost;
  const movable = cur.items.map((it, i) => (it.fixed || it.pass ? -1 : i)).filter((i) => i >= 0);
  if (!movable.length) return { plan: best, startCm: curCost, bestCm: bestCost, accepted: 0 };
  const allFaces = wallFaces(cur);
  // 구역이 있는 가구는 그 구역에 걸치는 면만 후보로 — 아니면 거의 다 거절돼 헛돈다
  // (면을 구역 폭으로 잘라 둔다 — 긴 벽의 작은 방 몫을 고를 확률이 너무 낮지 않게)
  const facesFor = new Map(movable.map((i) => {
    const zones = allowedZones(cur, cur.items[i]);
    if (!zones) return [i, allFaces];
    const fs = [];
    for (const z of zones) for (const f of allFaces) {
      const [lo, hi, at0, at1] = f.axis === "y" ? [z.x0, z.x1, z.y0, z.y1] : [z.y0, z.y1, z.x0, z.x1];
      if (f.at < at0 - 1 || f.at > at1 + 1) continue;
      const a = Math.max(f.a, lo), b = Math.min(f.b, hi);
      if (b - a > 20) fs.push({ ...f, a, b });
    }
    return [i, fs.length ? fs : allFaces];
  }));
  const randomSpot = (it) => {
    const zones = allowedZones(cur, it);
    const z = zones ? zones[Math.floor(rand() * zones.length)] : { x0: 0, y0: 0, x1: cur.room.w, y1: cur.room.d };
    return { x: z.x0 + rand() * (z.x1 - z.x0), y: z.y0 + rand() * (z.y1 - z.y0) };
  };
  const t0 = Math.max(curCost * 0.03, 100), t1 = 5;
  let accepted = 0;
  for (let i = 0; i < iterations; i++) {
    const T = t0 * Math.pow(t1 / t0, i / iterations);
    const idx = movable[Math.floor(rand() * movable.length)];
    const old = cur.items[idx];
    let next;
    const roll = rand();
    if (old.wall) {
      if (roll < 0.35) {
        const faces = facesFor.get(idx);
        const f = faces[Math.floor(rand() * faces.length)];
        next = placeOnFace(old, f, Math.round((f.a + rand() * (f.b - f.a)) / 5) * 5);
      } else {
        // 지금 붙은 벽을 따라 미끄러뜨린다
        const step = (rand() < 0.5 ? -1 : 1) * (10 + Math.round(rand() * 9) * 10) * (roll < 0.8 ? 1 : 3);
        next = normRot(old.rot) % 180 === 0 ? { ...old, x: old.x + step } : { ...old, y: old.y + step };
      }
    } else if (roll < 0.15) {
      next = { ...old, rot: normRot(old.rot + 90) };
    } else if (roll < 0.25) {
      const spot = randomSpot(old);
      next = { ...old, x: Math.round(spot.x / 5) * 5, y: Math.round(spot.y / 5) * 5 };
    } else {
      const step = () => (rand() < 0.5 ? -1 : 1) * (10 + Math.round(rand() * 9) * 10);
      next = rand() < 0.5 ? { ...old, x: old.x + step() } : { ...old, y: old.y + step() };
    }
    // (벽에 붙인 자리는 반올림하지 않는다 — 깊이가 64cm 면 2cm 가 벽에 박혀 전부 거절됐다)
    cur.items[idx] = next;
    if (!valid(cur, next)) { cur.items[idx] = old; continue; }
    const c = cost(cur);
    if (c <= curCost || rand() < Math.exp((curCost - c) / T)) {
      curCost = c; accepted++;
      if (c < bestCost) { bestCost = c; best = clonePlan(cur); }
    } else {
      cur.items[idx] = old;
    }
    if (onProgress && i % 50 === 0) onProgress(i, bestCost);
  }
  return { plan: best, startCm: cost(plan), bestCm: bestCost, accepted };
}

// ── 도면 JSON 검사 ────────────────────────────────────────

/** LLM 이 써 준 도면을 받기 전에 형태를 고친다/거절한다. 문제가 있으면 throw. */
export function normalizePlan(raw) {
  const p = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!p || typeof p !== "object") throw new Error("도면이 객체가 아닙니다");
  const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${name} 이 숫자가 아닙니다`); return n; };
  const room = { w: num(p.room?.w, "room.w"), d: num(p.room?.d, "room.d") };
  if (room.w < 100 || room.d < 100 || room.w > 5000 || room.d > 5000) throw new Error("room 크기는 100~5000cm");
  const walls = (p.walls ?? []).map((w, i) => {
    const wall = { x1: num(w.x1, `walls[${i}].x1`), y1: num(w.y1, `walls[${i}].y1`), x2: num(w.x2, `walls[${i}].x2`), y2: num(w.y2, `walls[${i}].y2`) };
    if (wall.x1 !== wall.x2 && wall.y1 !== wall.y2) throw new Error(`walls[${i}] 는 가로나 세로여야 합니다`);
    if (w.t != null) wall.t = num(w.t, `walls[${i}].t`);
    return wall;
  });
  const zoneIds = new Set();
  const zones = (p.zones ?? []).map((z, i) => {
    const id = String(z.id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error(`zones[${i}].id 는 영문·숫자·_- 로`);
    zoneIds.add(id);
    const x0 = num(z.x0, `${id}.x0`), y0 = num(z.y0, `${id}.y0`), x1 = num(z.x1, `${id}.x1`), y1 = num(z.y1, `${id}.y1`);
    return { id, label: String(z.label ?? id).slice(0, 20), x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  });
  const ids = new Set();
  const items = (p.items ?? []).map((it, i) => {
    const id = String(it.id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error(`items[${i}].id 는 영문·숫자·_- 로`);
    if (ids.has(id)) throw new Error(`id 중복: ${id}`);
    ids.add(id);
    return {
      id, label: String(it.label ?? id).slice(0, 30), kind: String(it.kind ?? "furniture").slice(0, 20),
      x: num(it.x, `${id}.x`), y: num(it.y, `${id}.y`),
      w: num(it.w ?? 0, `${id}.w`), d: num(it.d ?? 0, `${id}.d`), h: num(it.h ?? 80, `${id}.h`),
      rot: normRot(num(it.rot ?? 0, `${id}.rot`)),
      ...(it.fixed && { fixed: true }), ...(it.wall && { wall: true }), ...(it.pass && { pass: true }),
      ...(it.zone && { zone: [it.zone].flat().map(String).filter((z) => {
        if (!zoneIds.has(z)) throw new Error(`${id}.zone "${z}" 이 zones 에 없습니다`);
        return true;
      }) }),
      ...(typeof it.color === "string" && /^#[0-9a-f]{6}$/i.test(it.color) && { color: it.color }),
    };
  });
  const tasks = (p.tasks ?? []).map((t, i) => {
    const stops = (t.stops ?? []).map(String);
    for (const s of stops) if (!ids.has(s)) throw new Error(`tasks[${i}] 의 stop "${s}" 이 items 에 없습니다`);
    if (stops.length < 2) throw new Error(`tasks[${i}] 는 들를 곳이 2개 이상이어야 합니다`);
    return { id: String(t.id ?? `t${i}`), label: String(t.label ?? t.id ?? `할 일 ${i + 1}`).slice(0, 30), perWeek: Math.max(0, num(t.perWeek ?? 1, `tasks[${i}].perWeek`)), stops };
  });
  return { name: String(p.name ?? "우리 집").slice(0, 40), room, walls, zones, items, tasks };
}
