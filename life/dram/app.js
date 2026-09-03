// 화면. 판정은 하나도 하지 않는다 — engine.js 가 돌려준 것을 그리기만 한다.
// (CSP 가 script-src 'self' 라 인라인 스크립트가 없다. 외부 라이브러리도 불러올 수 없어
//  타임라인은 SVG 를 직접 만든다.)

import { GENERATIONS, DEFAULT_GEN, findGen, isRunnable } from "./spec/index.js";
import {
  bankAt, busSpan, canIssue, createState, findBin, issue, lookupParam, paramClocks,
  refreshStatus, tCK,
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const el = { clock: $("clock"), undo: $("undo"), reset: $("reset"), gens: $("gens"), genNote: $("gen-note"),
  sim: $("sim"), bin: $("bin"), tck: $("tck"), refresh: $("refresh"), org: $("org"), grid: $("grid"),
  target: $("target"), palette: $("palette"), why: $("why"), timeline: $("timeline"), params: $("params") };

const SVG = "http://www.w3.org/2000/svg";
const PX_PER_CK = 4;          // 타임라인의 클럭 하나가 몇 px 인가
const GUTTER = 34;            // 왼쪽 레인 이름 자리
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

let gen = findGen(DEFAULT_GEN);
let bin = findBin(gen, null);
let sim = null;
let picked = { bg: 0, bank: 0 };
let past = [];
let lastEntry = null;

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

/* ---------- 타임라인 ---------- */
function renderTimeline() {
  const h = sim.history;
  const spans = h.map((e) => busSpan(gen, bin, e));
  const lastClk = Math.max(sim.clk, ...spans.map((s) => (s ? s.start + s.len : 0)), 24);
  const width = GUTTER + (lastClk + 8) * PX_PER_CK;
  const arrows = h.flatMap((e) => e.waitedFor.map((w) => ({ e, w })));
  const levels = Math.min(arrows.length, 4);
  const x = (clk) => GUTTER + clk * PX_PER_CK;

  /* 커맨드 상자를 겹치지 않게 레인에 앉힌다. 커맨드 버스가 직렬이라 간격이 1클럭까지
   * 좁아질 수 있는데, 4px 로는 글자가 겹쳐 무엇이 언제 나갔는지 못 읽는다. */
  const BOX_W = 20, BOX_H = 26, LANE_GAP = 4;
  const laneEnd = [];
  const lanes = h.map((e) => {
    const left = x(e.clk) - BOX_W / 2;
    let lane = laneEnd.findIndex((end) => left >= end);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = left + BOX_W + 2;
    return lane;
  });
  const laneCount = Math.max(laneEnd.length, 1);
  const CMD_TOP = 22;
  const DQ_TOP = CMD_TOP + laneCount * (BOX_H + LANE_GAP) + 8;
  const ARROW_TOP = DQ_TOP + 30;
  const height = ARROW_TOP + Math.max(levels, 1) * 17 + 8;

  const g = svg("svg");
  const parts = [];

  // 클럭 눈금 — 100clk 마다 굵게
  const step = lastClk > 260 ? 50 : lastClk > 90 ? 20 : 10;
  for (let c = 0; c <= lastClk + 4; c += step) {
    parts.push(svg("line", { x1: x(c), y1: 16, x2: x(c), y2: ARROW_TOP - 4, stroke: "var(--line)", "stroke-width": 1 }));
    parts.push(svg("text", { x: x(c) + 2, y: 12, fill: "var(--muted)", "font-size": 9 }, String(c)));
  }

  // 레인 이름
  parts.push(svg("text", { x: 2, y: CMD_TOP + 14, fill: "var(--muted)", "font-size": 9 }, "CMD"));
  parts.push(svg("text", { x: 2, y: DQ_TOP + 12, fill: "var(--muted)", "font-size": 9 }, "DQ"));

  // DQ 버스 — 읽기는 채우고 쓰기는 테두리만. 버스가 얼마나 비어 있는지가 한눈에 보인다.
  spans.forEach((s) => {
    if (!s) return;
    parts.push(svg("rect", {
      x: x(s.start), y: DQ_TOP, width: Math.max(2, s.len * PX_PER_CK), height: 16, rx: 2,
      fill: s.kind === "read" ? "var(--muted)" : "none",
      stroke: "var(--muted)", "stroke-width": 1,
    }));
  });

  // 커맨드 — 상자 안에 커맨드 이름과 대상 뱅크를 함께 적는다
  h.forEach((e, i) => {
    const cx = x(e.clk);
    const top = CMD_TOP + lanes[i] * (BOX_H + LANE_GAP);
    // 상자가 레인에 내려앉으면 실제 클럭 위치를 놓치기 쉬워, 눈금까지 실선으로 잇는다.
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
    const y = ARROW_TOP + (i % Math.max(levels, 1)) * 17;
    parts.push(svg("line", { x1: x(from.clk), y1: y, x2: x(e.clk), y2: y, stroke: "var(--muted)", "stroke-width": 1 }));
    for (const c of [from.clk, e.clk]) {
      parts.push(svg("line", { x1: x(c), y1: y - 4, x2: x(c), y2: y + 4, stroke: "var(--muted)", "stroke-width": 1 }));
    }
    parts.push(svg("text", {
      x: (x(from.clk) + x(e.clk)) / 2, y: y - 3, fill: "var(--ink)", "font-size": 9, "text-anchor": "middle",
    }, `${w.label} ${fmt(w.need)}`));
  });

  // 지금 시각
  parts.push(svg("line", { x1: x(sim.clk), y1: 16, x2: x(sim.clk), y2: height, stroke: "var(--ink)", "stroke-width": 1, "stroke-dasharray": "2 2" }));

  g.append(...parts);
  el.timeline.setAttribute("width", width);
  el.timeline.setAttribute("height", height);
  el.timeline.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.timeline.replaceChildren(...g.childNodes);
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
