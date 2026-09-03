// 화면. 판정은 하나도 하지 않는다 — engine.js 가 돌려준 것을 그리기만 한다.
// (CSP 가 script-src 'self' 라 인라인 스크립트가 없다. 외부 라이브러리도 불러올 수 없어
//  타임라인은 SVG 를 직접 만든다.)

import { GENERATIONS, DEFAULT_GEN, findGen, isRunnable } from "./spec/index.js";
import {
  bankAt, canIssue, createState, findBin, issue, lookupParam, paramClocks,
  refreshStatus, tCK,
} from "./engine.js";
import { ARRAY, buildWaves } from "./waves.js";

const $ = (id) => document.getElementById(id);
const el = { clock: $("clock"), undo: $("undo"), reset: $("reset"), gens: $("gens"), genNote: $("gen-note"),
  sim: $("sim"), bin: $("bin"), tck: $("tck"), refresh: $("refresh"), org: $("org"), grid: $("grid"),
  target: $("target"), palette: $("palette"), why: $("why"), timeline: $("timeline"), params: $("params"),
  zoom: $("zoom"), zoomval: $("zoomval"), laneNote: $("lane-note"), rails: $("rails") };

const SVG = "http://www.w3.org/2000/svg";
const GUTTER = 46;            // 왼쪽 신호 이름 자리
const LANE_H = 24, LANE_GAP = 7, GROUP_HEAD = 18;
const BOX_W = 20, BOX_H = 26, CMD_GAP = 4, CMD_TOP = 22;
let zoom = 4;                 // 클럭 하나가 몇 px 인가
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

let gen = findGen(DEFAULT_GEN);
let bin = findBin(gen, null);
let sim = null;
let picked = { bg: 0, bank: 0 };
let past = [];
let lastEntry = null;
let waveLanes = [];

/* ---------- 만들기 도우미 ---------- */
function node(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids) n.append(kid);
  return n;
}
function svg(tag, props = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(props)) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- 세대 ---------- */
function renderGens() {
  el.gens.replaceChildren(...GENERATIONS.map((g) =>
    node("button", {
      type: "button", class: `gen${isRunnable(g) ? "" : " off"}`, "data-gen": g.id,
      "aria-current": String(g.id === gen.id), text: g.label,
    })));
}

function selectGen(id) {
  gen = findGen(id);
  bin = findBin(gen, null);
  sim = isRunnable(gen) ? createState(gen, bin?.id) : null;
  picked = { bg: 0, bank: 0 };
  past = [];
  lastEntry = null;
  render();
}

/* ---------- 못 돌리는 세대 ---------- */
function renderUnavailable() {
  el.sim.hidden = true;
  el.genNote.replaceChildren(
    node("span", { class: "empty-gen" }, [
      node("b", { text: `${gen.label} 는 지금 돌릴 수 없다. ` }),
      document.createTextNode(gen.status_note),
      ...(gen.org ? [node("br"), node("br"), node("b", { text: "구조 — " }), document.createTextNode(gen.org.note)] : []),
    ]));
  el.genNote.className = "";
  el.clock.textContent = "";
}

/* ---------- 스피드빈 ---------- */
function renderBin() {
  el.bin.replaceChildren(...gen.bins.map((b) =>
    node("option", { value: b.id, selected: b.id === bin.id ? "" : null, text: b.label })));
  el.tck.textContent = `${fmt(tCK(bin))}ns/clk · ${bin.mtps} MT/s`;
}

/* ---------- 리프레시 마감 ---------- */
function renderRefresh() {
  const r = refreshStatus(gen, bin, sim);
  if (!r) { el.refresh.hidden = true; return; }
  el.refresh.hidden = false;
  el.refresh.className = `refresh${r.overdue ? " late" : ""}`;
  const pct = Math.min(100, (r.since / r.period) * 100);
  el.refresh.replaceChildren(
    node("div", { class: "refresh-top" }, [
      node("span", { text: r.overdue ? `리프레시 마감을 ${-r.remaining}clk 넘겼다` : `다음 리프레시까지 ${r.remaining}clk` }),
      node("span", { text: `tREFI ${r.period}clk` }),
    ]),
    node("div", { class: "refresh-bar" }, [node("div", { class: "refresh-fill", style: `width:${pct}%` })]),
    node("p", { class: "note", style: "margin:7px 0 0", text: r.note }),
  );
}

/* ---------- 뱅크 격자 ---------- */
function renderGrid() {
  el.org.textContent = gen.org.label;
  el.grid.style.setProperty("--cols", gen.org.banksPerGroup);
  const cells = [];
  for (let bg = 0; bg < gen.org.bankGroups; bg++) {
    cells.push(node("div", { class: "bglabel", text: `BG${bg}` }));
    for (let bank = 0; bank < gen.org.banksPerGroup; bank++) {
      const b = bankAt(gen, sim, bg, bank);
      const on = picked.bg === bg && picked.bank === bank;
      cells.push(node("button", {
        type: "button", class: `cell${b.state === "active" ? " active" : ""}`,
        "data-bg": bg, "data-bank": bank, "aria-pressed": String(on),
      }, [
        node("b", { text: `B${bank}` }),
        node("span", { class: "row", text: b.state === "active" ? `row ${b.row}` : "idle" }),
      ]));
    }
  }
  el.grid.replaceChildren(...cells);
}

/* ---------- 커맨드 ---------- */
function renderPalette() {
  el.target.textContent = `대상 BG${picked.bg} / B${picked.bank}`;
  el.palette.replaceChildren(...gen.commands.map((def) => {
    const cmd = { op: def.op, ...(def.target === "bank" ? picked : {}) };
    const v = canIssue(gen, bin, sim, cmd);
    const cls = v.stateError ? "blocked" : v.ok ? "" : "wait";
    const hint = v.stateError
      ? v.stateError
      : v.ok ? def.desc : `${v.wait}clk 기다림 — ${v.binding.map((b) => b.label).join(", ")}`;
    return node("button", { type: "button", class: `cmd ${cls}`, "data-op": def.op },
      [node("b", { text: def.label }), node("small", { text: hint })]);
  }));
}

/* ---------- "왜 기다렸나" ---------- */
function renderWhy() {
  if (!lastEntry?.waitedFor?.length) {
    el.why.hidden = !lastEntry;
    if (lastEntry) {
      el.why.hidden = false;
      el.why.replaceChildren(
        node("h3", { text: `${lastEntry.op} @ ${lastEntry.clk}clk` }),
        node("p", { text: "기다린 제약이 없다 — 바로 낼 수 있었다." }));
    }
    return;
  }
  el.why.hidden = false;
  const kids = [node("h3", { text: `${lastEntry.op} 는 ${lastEntry.clk}clk 까지 기다렸다` })];
  for (const w of lastEntry.waitedFor) {
    const terms = node("div", { class: "terms" });
    w.parts.forEach((p, i) => {
      if (i) terms.append(node("span", { class: "op", text: "+" }));
      terms.append(node("span", { class: "term", text: `${p.term} ${p.ck == null ? "?" : fmt(p.ck)}` }));
    });
    terms.append(node("span", { class: "op", text: "=" }), node("span", { class: "sum", text: `${fmt(w.need)}clk` }));
    kids.push(terms, node("p", { text: w.why }));
  }
  el.why.replaceChildren(...kids);
}

/* ---------- 파형 ----------
 *
 * 커맨드가 언제 나갔는지(위)와 그때 회로의 전압이 어떻게 움직였는지(아래)를
 * 같은 시간축에 겹친다. tRCD·tRAS·tRP 가 왜 그 길이인지는 아래쪽 그림에서만 보인다.
 * 다만 어레이 내부는 JEDEC 밖이라 모식도다 — 화면에도 그렇게 적는다.
 */

/* 눈금 간격을 확대율에 맞춰 고른다. 촘촘하면 숫자가 겹치고 성기면 위치를 못 읽는다. */
function niceStep(px) {
  const raw = 54 / px;
  return [1, 2, 5, 10, 20, 50, 100, 200].find((n) => n >= raw) ?? 500;
}

function renderTimeline() {
  const h = sim.history;
  const waves = buildWaves(gen, bin, sim, picked);
  const end = waves ? waves.end : Math.max(sim.clk, 24) + 6;
  const x = (clk) => GUTTER + clk * zoom;
  const width = GUTTER + end * zoom + 16;
  const parts = [];

  /* 커맨드 상자를 겹치지 않게 레인에 앉힌다. 커맨드 버스가 직렬이라 간격이 1클럭까지
   * 좁아지는데, 그 폭으로는 글자가 겹쳐 무엇이 언제 나갔는지 못 읽는다. */
  const laneEnd = [];
  const cmdLane = h.map((e) => {
    const left = x(e.clk) - BOX_W / 2;
    let n = laneEnd.findIndex((edge) => left >= edge);
    if (n === -1) { n = laneEnd.length; laneEnd.push(0); }
    laneEnd[n] = left + BOX_W + 2;
    return n;
  });
  const laneCount = Math.max(laneEnd.length, 1);
  const arrows = h.flatMap((e) => e.waitedFor.map((w) => ({ e, w })));
  const levels = Math.max(Math.min(arrows.length, 4), 1);
  const ARROW_TOP = CMD_TOP + laneCount * (BOX_H + CMD_GAP) + 6;
  let y = ARROW_TOP + levels * 17 + 14;

  const groups = [];
  if (waves) {
    for (const g of waves.groups) {
      const lanes = waves.lanes.filter((l) => l.group === g.id);
      groups.push({ ...g, lanes, top: y + GROUP_HEAD });
      y += GROUP_HEAD + lanes.reduce((sum, l) => sum + LANE_H * l.h + LANE_GAP, 0);
    }
  }
  const height = y + 6;

  // 클럭 눈금
  const step = niceStep(zoom);
  for (let c = 0; c <= end; c += step) {
    parts.push(svg("line", { x1: x(c), y1: 16, x2: x(c), y2: height - 4, stroke: "var(--line)", "stroke-width": 1 }));
    parts.push(svg("text", { x: x(c) + 2, y: 12, fill: "var(--muted)", "font-size": 9 }, String(c)));
  }
  parts.push(svg("text", { x: 2, y: CMD_TOP + 14, fill: "var(--muted)", "font-size": 9 }, "CMD"));

  // 커맨드
  h.forEach((e, i) => {
    const cx = x(e.clk);
    const top = CMD_TOP + cmdLane[i] * (BOX_H + CMD_GAP);
    parts.push(svg("line", { x1: cx, y1: 16, x2: cx, y2: top, stroke: "var(--muted)", "stroke-width": 1 }));
    parts.push(svg("rect", { x: cx - BOX_W / 2, y: top, width: BOX_W, height: BOX_H, rx: 3, fill: "var(--ink)" }));
    parts.push(svg("text", { x: cx, y: top + 11, fill: "var(--bg)", "font-size": 9, "text-anchor": "middle" }, e.op.slice(0, 5)));
    parts.push(svg("text", { x: cx, y: top + 21, fill: "var(--bg)", "font-size": 8, "text-anchor": "middle" },
      e.bg == null ? "all" : `${e.bg}/${e.bank}`));
  });

  // 제약 화살표 — 무엇이 이 커맨드를 여기까지 밀었는가
  arrows.forEach(({ e, w }, i) => {
    const from = h.find((p) => p.id === w.fromId);
    if (!from) return;
    const ay = ARROW_TOP + (i % levels) * 17;
    parts.push(svg("line", { x1: x(from.clk), y1: ay, x2: x(e.clk), y2: ay, stroke: "var(--muted)", "stroke-width": 1 }));
    for (const c of [from.clk, e.clk]) {
      parts.push(svg("line", { x1: x(c), y1: ay - 4, x2: x(c), y2: ay + 4, stroke: "var(--muted)", "stroke-width": 1 }));
    }
    parts.push(svg("text", {
      x: (x(from.clk) + x(e.clk)) / 2, y: ay - 3, fill: "var(--ink)", "font-size": 9, "text-anchor": "middle",
    }, `${w.label} ${fmt(w.need)}`));
  });

  // 파형
  for (const g of groups) {
    parts.push(svg("text", { x: 2, y: g.top - 6, fill: "var(--muted)", "font-size": 9 }, `${g.label} · ${g.note}`));
    let top = g.top;
    for (const l of g.lanes) {
      const H = LANE_H * l.h;
      /* **눈금은 레인마다 제 vmax 다.** 묶음 전체를 VPP 로 재면 비트라인이 눌려 버린다.
       * 대신 각 레인의 윗 레일을 글자로 적어 어디까지 올라간 것인지 헷갈리지 않게 한다. */
      const yv = (v) => top + H - (v / l.vmax) * H;
      parts.push(svg("line", { x1: GUTTER, y1: yv(0), x2: x(end), y2: yv(0), stroke: "var(--line)", "stroke-width": 1 }));
      /* 이름과 눈금은 **왼쪽 칸에** 적는다. 파형 위에 얹으면 정작 봐야 할 선을 가린다
       * (처음에 그렇게 그렸다가 SAE·Cell 의 높은 구간이 글자에 묻혔다). */
      parts.push(svg("text", { x: 2, y: top + H / 2 - 1, fill: "var(--muted)", "font-size": 9 }, l.label));
      if (l.group === ARRAY) {
        const railName = l.vmax === waves.rails.VPP ? "VPP" : "VDD";
        parts.push(svg("text", { x: 2, y: top + H / 2 + 9, fill: "var(--line)", "font-size": 8 }, `0–${railName}`));
      }
      parts.push(svg("rect", { x: 0, y: top - 3, width: GUTTER - 2, height: H + 6, fill: "transparent", "data-lane": l.id, style: "cursor:pointer" }));

      if (l.kind === "pair") {
        // VDD/2 기준선. 두 선이 여기서 갈라져 나가는 것이 센싱의 전부다.
        parts.push(svg("line", {
          x1: GUTTER, y1: yv(l.guide), x2: x(end), y2: yv(l.guide),
          stroke: "var(--line)", "stroke-width": 1, "stroke-dasharray": "2 3",
        }));
        parts.push(svg("text", { x: x(end) - 2, y: yv(l.guide) - 3, fill: "var(--muted)", "font-size": 8, "text-anchor": "end" }, `VDD/2 ${fmt(l.guide)}V`));
        l.series.forEach((s, si) => {
          parts.push(svg("polyline", {
            points: s.points.map(([c, v]) => `${x(c)},${yv(v)}`).join(" "),
            fill: "none", stroke: "var(--ink)", "stroke-width": 1.4, "stroke-linejoin": "round",
            "stroke-dasharray": si === 1 ? "4 2" : null,
          }));
        });
      } else if (l.kind === "wave") {
        parts.push(svg("polyline", {
          points: l.points.map(([c, v]) => `${x(c)},${yv(v)}`).join(" "),
          fill: "none", stroke: "var(--ink)", "stroke-width": 1.4, "stroke-linejoin": "round",
        }));
      } else if (l.kind === "clock") {
        // 클럭 사각파는 촘촘해서 확대해야 읽힌다 — 좁을 때 그리면 잉크 덩어리가 된다.
        if (zoom >= 8) {
          const pts = [];
          for (let c = 0; c <= end; c += 1) pts.push(`${x(c)},${yv(l.vmax)}`, `${x(c + 0.5)},${yv(l.vmax)}`, `${x(c + 0.5)},${yv(0)}`, `${x(c + 1)},${yv(0)}`);
          parts.push(svg("polyline", { points: pts.join(" "), fill: "none", stroke: "var(--muted)", "stroke-width": 1 }));
        } else {
          parts.push(svg("text", { x: GUTTER + 4, y: top + H - 7, fill: "var(--muted)", "font-size": 9 }, "확대하면 사각파가 보인다"));
        }
      } else if (l.kind === "toggle") {
        parts.push(svg("line", { x1: GUTTER, y1: yv(l.vmax / 2), x2: x(end), y2: yv(l.vmax / 2), stroke: "var(--line)", "stroke-width": 1, "stroke-dasharray": "1 4" }));
        for (const [s, e2] of l.ranges) {
          if (zoom >= 8) {
            const pts = [];
            for (let c = s; c < e2; c += 1) pts.push(`${x(c)},${yv(l.vmax)}`, `${x(c + 0.5)},${yv(l.vmax)}`, `${x(c + 0.5)},${yv(0)}`, `${x(c + 1)},${yv(0)}`);
            parts.push(svg("polyline", { points: pts.join(" "), fill: "none", stroke: "var(--ink)", "stroke-width": 1.2 }));
          } else {
            parts.push(svg("rect", { x: x(s), y: yv(l.vmax), width: Math.max(2, (e2 - s) * zoom), height: H, fill: "none", stroke: "var(--ink)", "stroke-width": 1 }));
          }
        }
      } else if (l.kind === "band") {
        for (const [s, e2, kind] of l.ranges) {
          parts.push(svg("rect", {
            x: x(s), y: yv(l.vmax), width: Math.max(2, (e2 - s) * zoom), height: H, rx: 2,
            fill: kind === "write" ? "none" : "var(--muted)", stroke: "var(--muted)", "stroke-width": 1,
          }));
        }
      }
      top += H + LANE_GAP;
    }
  }

  // 지금 시각
  parts.push(svg("line", { x1: x(sim.clk), y1: 16, x2: x(sim.clk), y2: height, stroke: "var(--ink)", "stroke-width": 1, "stroke-dasharray": "2 2" }));

  el.timeline.setAttribute("width", width);
  el.timeline.setAttribute("height", height);
  el.timeline.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.timeline.replaceChildren(...parts);
  waveLanes = waves ? waves.lanes : [];

  const r = waves?.rails;
  el.rails.textContent = r
    ? `VDD ${r.VDD}V · VPP ${r.VPP}V · 비트라인 프리차지 ${fmt(r.VBLP)}V · 전하공유 ΔV ${Math.round(r.dV * 1000)}mV — ${r.note}`
    : "";
  el.zoomval.textContent = `${zoom}px/clk`;
}

/* ---------- 파라미터 표 ---------- */
function describe(name) {
  const p = lookupParam(gen, bin, name);
  const ck = paramClocks(gen, bin, name);
  if (!p) return null;
  const bits = [];
  if (p.ns != null) bits.push(`${fmt(p.ns)}ns`);
  if (p.ck != null) bits.push(`${p.ck}clk`);
  const form = bits.length === 2 ? `max(${bits.join(", ")})` : bits[0] ?? "—";
  return { p, ck, form };
}

function renderParams() {
  const names = [...new Set([...Object.keys(gen.params), ...gen.bins.flatMap((b) => Object.keys(b.params ?? {}))])];
  el.params.replaceChildren(...names.map((name) => {
    const d = describe(name);
    const known = d?.ck != null;
    return node("div", { class: `prow${known ? "" : " unknown"}` }, [
      node("b", { text: name }),
      node("span", { class: "val" }, known
        ? [document.createTextNode(`${d.ck}clk`), node("em", { text: ` (${d.form})` })]
        : [node("em", { text: "값 없음" })]),
      node("span", {}, [
        node("span", { class: "why", text: d?.p.why ?? "" }),
        ...(d?.p.verify ? [node("span", { class: "flag", text: "? 스펙과 대조 필요" })] : []),
      ]),
    ]);
  }));
}

/* ---------- 전체 ---------- */
function render() {
  renderGens();
  if (!isRunnable(gen)) return renderUnavailable();
  el.genNote.className = "note";
  el.genNote.textContent = gen.status_note;
  el.sim.hidden = false;
  el.clock.textContent = `${sim.clk}clk`;
  renderBin();
  renderRefresh();
  renderGrid();
  renderPalette();
  renderWhy();
  renderTimeline();
  renderParams();
}

/* ---------- 입력 ---------- */
el.gens.addEventListener("click", (e) => {
  const id = e.target.closest("[data-gen]")?.dataset.gen;
  if (id) selectGen(id);
});

el.bin.addEventListener("change", () => {
  bin = findBin(gen, el.bin.value);
  sim = createState(gen, bin.id);
  past = [];
  lastEntry = null;
  render();
});

el.grid.addEventListener("click", (e) => {
  const cell = e.target.closest("[data-bg]");
  if (!cell) return;
  picked = { bg: Number(cell.dataset.bg), bank: Number(cell.dataset.bank) };
  render();
});

el.palette.addEventListener("click", (e) => {
  const op = e.target.closest("[data-op]")?.dataset.op;
  if (!op) return;
  const def = gen.commands.find((c) => c.op === op);
  const cmd = { op, ...(def.target === "bank" ? picked : {}) };
  const r = issue(gen, bin, sim, cmd);
  if (r.error) { lastEntry = null; renderPalette(); return; }
  past.push(sim);
  sim = r.state;
  lastEntry = sim.history[sim.history.length - 1];
  render();
});

el.zoom.addEventListener("input", () => { zoom = Number(el.zoom.value); renderTimeline(); });

/* 신호 이름을 누르면 그 선이 무엇인지 말해 준다 — 폰에서는 hover 가 없다. */
el.timeline.addEventListener("click", (e) => {
  const id = e.target.getAttribute?.("data-lane");
  if (!id) return;
  const l = waveLanes.find((w) => w.id === id);
  if (!l) return;
  el.laneNote.replaceChildren(
    node("b", { text: `${l.label} — ` }),
    document.createTextNode(l.note),
    ...(l.group === ARRAY ? [node("br"), node("span", { class: "dim", text: "어레이 내부는 JEDEC 이 정하지 않는다 — 모식도다." })] : []),
  );
});

el.undo.addEventListener("click", () => {
  if (!past.length) return;
  sim = past.pop();
  lastEntry = sim.history[sim.history.length - 1] ?? null;
  render();
});

el.reset.addEventListener("click", () => {
  sim = createState(gen, bin.id);
  past = [];
  lastEntry = null;
  render();
});

sim = createState(gen, bin.id);
render();
