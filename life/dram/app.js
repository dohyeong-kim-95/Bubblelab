// 화면. 판정은 하나도 하지 않는다 — engine.js 가 돌려준 것을 그리기만 한다.
// (CSP 가 script-src 'self' 라 인라인 스크립트가 없다. 외부 라이브러리도 불러올 수 없어
//  타임라인은 SVG 를 직접 만든다.)

import { GENERATIONS, DEFAULT_GEN, findGen, isRunnable } from "./spec/index.js";
import { PROVENANCE } from "./spec/common.js";
import {
  bankAt, canIssue, createState, findBin, issue, lookupParam, paramClocks,
  refreshStatus, tCK,
} from "./engine.js";
import { ARRAY, buildWaves } from "./waves.js";
import { explain } from "./explain.js";

const $ = (id) => document.getElementById(id);
const el = { clock: $("clock"), undo: $("undo"), reset: $("reset"), gens: $("gens"), genNote: $("gen-note"),
  sim: $("sim"), bin: $("bin"), tck: $("tck"), refresh: $("refresh"), org: $("org"), grid: $("grid"),
  target: $("target"), palette: $("palette"), why: $("why"), timeline: $("timeline"), params: $("params"),
  zoom: $("zoom"), zoomval: $("zoomval"), laneNote: $("lane-note"), rails: $("rails"), legend: $("legend"), paramsNote: $("params-note"),
  refs: $("refs"), refsBody: $("refs-body"), refsTitle: $("refs-title"),
  refsOpen: $("refs-open"), refsLink: $("refs-link"), refsClose: $("refs-close"),
  param: $("param"), paramTitle: $("param-title"), paramBody: $("param-body"), paramClose: $("param-close") };

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
let focus = null;   // 강조 중인 신호 id

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

/* CSP 가 style-src 'self' 라 **인라인 style 속성은 막힌다** — 마크업의 style= 도,
 * setAttribute("style", …) 도 조용히 버려진다. 반면 el.style.setProperty 같은 CSSOM
 * 조작은 허용되므로, 값이 계산되는 스타일은 반드시 이쪽으로 넣는다.
 * (로컬 정적 서버에는 CSP 가 없어 이 차이가 안 보인다 — _infra 없이 확인하려면
 *  같은 헤더를 걸고 띄워야 한다.) */
function styled(el, props) {
  for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  return el;
}
const fill = (pct) => styled(node("div", { class: "refresh-fill" }), { width: `${pct}%` });

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
    node("div", { class: "refresh-bar" }, [fill(pct)]),
    node("p", { class: "note refresh-note", text: r.note }),
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
      terms.append(node("span", { class: "term", "data-param": p.term === "BL/2" ? "BL" : p.term, text: `${p.term} ${p.ck == null ? "?" : fmt(p.ck)}` }));
    });
    terms.append(node("span", { class: "op", text: "=" }), node("span", { class: "sum", text: `${fmt(w.need)}clk` }));
    kids.push(terms, node("p", { text: w.why }));
  }
  el.why.replaceChildren(...kids);
}

/* ---------- 파형 ----------
 *
 * 신호를 층층이 쌓지 않고 **한 판에 겹쳐 그린다.** 겹쳐야 같은 시각에 무엇이 같이
 * 움직였는지가 보이기 때문이다(WL 이 오를 때 비트라인이 갈라지고, SAE 가 켜지자
 * 그것이 레일까지 벌어진다 — 쌓아 두면 눈이 따라가지 못한다).
 *
 * 겹치면 눈금을 하나로 써야 하므로 묶음마다 공용 축을 쓴다. 그래서 WL 이 VPP 까지
 * 올라가는 것이 다른 신호보다 실제로 높게 보이고, VPP 가 왜 따로 있는지가 드러난다.
 * 대신 비트라인의 ΔV 가 작아지므로 판을 넉넉히 높인다.
 *
 * 색은 신호를 가르기 위한 것이고, 하나를 누르면 그것만 남기고 나머지는 죽인다 —
 * 겹쳐 그린 그림은 결국 한 번에 하나를 따라 읽게 되기 때문이다.
 */
const COLORS = {
  CK_t: "#7b8794", CS_n: "#efeee8", CA: "#f0b64a", DQS_t: "#7aa7f0", DQ: "#56c8e0",
  WL: "#f0b64a", BL: "#56c8e0", SAE: "#a894f0", CSL: "#6fcf8f", Cell: "#f08a9a",
};
const PLOT_H = { iface: 104, array: 190 };
const DIM = 0.16;

/* 눈금 간격을 확대율에 맞춰 고른다. 촘촘하면 숫자가 겹치고 성기면 위치를 못 읽는다. */
function niceStep(px) {
  const raw = 54 / px;
  return [1, 2, 5, 10, 20, 50, 100, 200].find((n) => n >= raw) ?? 500;
}

/* 버스(CA·DQ)는 값이 아니라 "유효한 구간"이 뜻이라 타이밍도 관례대로 육각형으로 그린다.
 * 채워진 막대로 그리면 겹쳐 놓았을 때 뒤의 선을 다 가린다. */
function busPoints(x, yv, s, e, hi, lo, mid) {
  const t = Math.min(0.5, (e - s) / 4);
  return [[s, mid], [s + t, hi], [e - t, hi], [e, mid], [e - t, lo], [s + t, lo]]
    .map(([c, v]) => `${x(c)},${yv(v)}`).join(" ");
}

function square(x, yv, from, to, hi) {
  const pts = [];
  for (let c = from; c < to; c += 1) {
    pts.push(`${x(c)},${yv(hi)}`, `${x(c + 0.5)},${yv(hi)}`, `${x(c + 0.5)},${yv(0)}`, `${x(c + 1)},${yv(0)}`);
  }
  return pts.join(" ");
}

function renderLegend(waves) {
  if (!waves) { el.legend.replaceChildren(); return; }
  const rows = [];
  for (const g of waves.groups) {
    const chips = waves.lanes.filter((l) => l.group === g.id).map((l) => {
      const dot = styled(node("i", { class: "dot" }), { background: COLORS[l.id] ?? "var(--ink)" });
      return node("button", {
        type: "button", class: "chip", "data-lane": l.id,
        "aria-pressed": String(focus === l.id),
      }, [dot, node("span", { text: l.label })]);
    });
    rows.push(node("div", { class: "legend-row" }, [
      node("span", { class: "legend-name", text: g.label }),
      node("div", { class: "chips" }, chips),
    ]));
  }
  el.legend.replaceChildren(...rows);
}

function renderTimeline() {
  const h = sim.history;
  const waves = buildWaves(gen, bin, sim, picked);
  waveLanes = waves ? waves.lanes : [];
  const end = waves ? waves.end : Math.max(sim.clk, 24) + 6;
  const x = (clk) => GUTTER + clk * zoom;
  const width = GUTTER + end * zoom + 16;
  const parts = [];
  const line = (id, pts, color, dash) => {
    const el2 = svg("polyline", {
      points: pts, fill: "none", stroke: color, "stroke-width": focus === id ? 2.2 : 1.4,
      "stroke-linejoin": "round", "stroke-dasharray": dash ?? null,
      opacity: focus && focus !== id ? DIM : 1,
    });
    parts.push(el2);
    // 선이 얇아 손가락으로 못 짚는다 — 보이지 않는 굵은 선을 겹쳐 과녁으로 쓴다.
    parts.push(svg("polyline", {
      points: pts, fill: "none", stroke: "transparent", "stroke-width": 14,
      "pointer-events": "stroke", "data-lane": id,
    }));
  };

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

  let y = ARROW_TOP + levels * 17 + 16;
  const plots = [];
  if (waves) {
    for (const g of waves.groups) {
      const lanes = waves.lanes.filter((l) => l.group === g.id);
      const vmax = Math.max(...lanes.map((l) => l.vmax));
      plots.push({ ...g, lanes, vmax, top: y, height: PLOT_H[g.id] });
      y += PLOT_H[g.id] + 28;
    }
  }
  const height = y + 4;

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

  // 겹쳐 그린 파형
  for (const g of plots) {
    const H = g.height;
    const yv = (v) => g.top + H - (v / g.vmax) * H;
    parts.push(svg("text", { x: 2, y: g.top - 10, fill: "var(--muted)", "font-size": 9 }, `${g.label} · ${g.note}`));
    // 빈 곳을 누르면 강조가 풀리도록 판 전체를 과녁으로 깔아 둔다(맨 아래에).
    parts.push(svg("rect", { x: 0, y: g.top - 2, width, height: H + 4, fill: "transparent", "data-lane": "" }));

    const rails = waves.rails;
    const marks = g.id === ARRAY
      ? [[0, "0"], [rails.VBLP, `VDD/2 ${fmt(rails.VBLP)}`], [rails.VDD, `VDD ${rails.VDD}`], [rails.VPP, `VPP ${rails.VPP}`]]
      : [[0, "0"], [rails.VDD, `VDD ${rails.VDD}`]];
    for (const [v, label] of marks) {
      parts.push(svg("line", {
        x1: GUTTER, y1: yv(v), x2: x(end), y2: yv(v), stroke: "var(--line)", "stroke-width": 1,
        "stroke-dasharray": v === 0 ? null : "2 4",
      }));
      parts.push(svg("text", { x: 2, y: yv(v) + 3, fill: "var(--line)", "font-size": 8 }, label));
    }

    for (const l of g.lanes) {
      const color = COLORS[l.id] ?? "var(--ink)";
      if (l.kind === "pair") {
        l.series.forEach((s, si) => line(l.id, s.points.map(([c, v]) => `${x(c)},${yv(v)}`).join(" "), color, si === 1 ? "5 3" : null));
      } else if (l.kind === "wave") {
        line(l.id, l.points.map(([c, v]) => `${x(c)},${yv(v)}`).join(" "), color);
      } else if (l.kind === "clock") {
        // 클럭 사각파는 촘촘해서 확대해야 읽힌다 — 좁을 때 그리면 잉크 덩어리가 된다.
        if (zoom >= 8) line(l.id, square(x, yv, 0, end, l.vmax), color);
        else parts.push(svg("text", { x: GUTTER + 4, y: yv(l.vmax * 0.5) + 3, fill: color, "font-size": 9, opacity: focus && focus !== l.id ? DIM : 0.85 }, "CK — 확대하면 사각파가 보인다"));
      } else if (l.kind === "toggle") {
        for (const [s, e2] of l.ranges) {
          if (zoom >= 8) line(l.id, square(x, yv, s, e2, l.vmax), color);
          else line(l.id, busPoints(x, yv, s, e2, l.vmax, 0, l.vmax / 2), color);
        }
      } else if (l.kind === "band") {
        for (const [s, e2] of l.ranges) line(l.id, busPoints(x, yv, s, e2, l.vmax, 0, l.vmax / 2), color);
      }
    }
  }

  // 지금 시각
  parts.push(svg("line", { x1: x(sim.clk), y1: 16, x2: x(sim.clk), y2: height, stroke: "var(--ink)", "stroke-width": 1, "stroke-dasharray": "2 2" }));

  el.timeline.setAttribute("width", width);
  el.timeline.setAttribute("height", height);
  el.timeline.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.timeline.replaceChildren(...parts);
  renderLegend(waves);

  const r = waves?.rails;
  el.rails.textContent = r
    ? `VDD ${r.VDD}V · VPP ${r.VPP}V · 비트라인 프리차지 ${fmt(r.VBLP)}V · 전하공유 ΔV ${Math.round(r.dV * 1000)}mV — ${r.note}`
    : "";
  el.zoomval.textContent = `${zoom}px/clk`;
}

/* 하나를 고르면 그것만 남기고 나머지를 죽인다. 같은 것을 다시 누르면 전부 돌아온다. */
function setFocus(id) {
  focus = id && focus !== id ? id : null;
  const l = waveLanes.find((w) => w.id === focus);
  el.laneNote.replaceChildren(...(l
    ? [node("b", { text: `${l.label} — ` }), document.createTextNode(l.note),
       ...(l.group === ARRAY ? [node("br"), node("span", { class: "dim", text: "어레이 내부는 JEDEC 이 정하지 않는다 — 모식도다." })] : [])]
    : [document.createTextNode("신호를 누르면 그것만 남기고 나머지는 흐려진다.")]));
  renderTimeline();
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
  const srcs = names.map((n) => describe(n)?.p.src).filter(Boolean);
  const majority = srcs.length && srcs.every((s) => s === srcs[0]) ? srcs[0] : null;
  el.paramsNote.replaceChildren(...(majority
    ? [node("b", { text: `아래 값은 전부 ${PROVENANCE[majority].label}이다. ` }), document.createTextNode(PROVENANCE[majority].note.replace(/\*\*/g, ""))]
    : [document.createTextNode("값마다 출처가 줄 끝에 붙는다.")]));
  el.params.replaceChildren(...names.map((name) => {
    const d = describe(name);
    const known = d?.ck != null;
    return node("div", { class: `prow${known ? "" : " unknown"}`, "data-param": name }, [
      node("b", { text: name }),
      node("span", { class: "val" }, known
        ? [document.createTextNode(`${d.ck}clk`), node("em", { text: ` (${d.form})` })]
        : [node("em", { text: "값 없음" })]),
      node("span", {}, [
        node("span", { class: "why", text: d?.p.why ?? "" }),
        /* 표 전체가 모의값이면 줄마다 같은 태그를 달지 않는다 — 위의 한 줄이 이미 말한다.
         * 다른 출처가 섞이는 순간에만 그 줄에 태그가 뜬다(그때는 눈에 띄어야 한다). */
        ...(d?.p.src && d.p.src !== majority ? [node("span", { class: "srctag", text: PROVENANCE[d.p.src].label })] : []),
        ...(d?.p.verify ? [node("span", { class: "flag", text: "? 스펙과 대조 필요" })] : []),
      ]),
    ]);
  }));
}

/* ---------- 파라미터 한 장 ----------
 *
 * "tXX 를 설명할 수 있는가"에 필요한 것을 한자리에 모은다. 손으로 쓴 설명문은
 * why/breaks 둘뿐이고, 나머지(어느 자리에 걸리는가·빈이 바뀌면·무엇과 짝인가)는
 * explain.js 가 규칙 표에서 뽑아낸다 — 규칙을 고치면 설명이 저절로 따라온다.
 */
function section(title, kids, cls = "") {
  return node("div", { class: `ex-sec ${cls}`.trim() }, [node("h3", { text: title }), ...kids]);
}

function placeCard(place, name) {
  const head = node("div", { class: "place-top" }, [
    node("b", { text: `${place.from} → ${place.to}` }),
    node("span", { class: "scope", text: place.kind === "window" ? `최근 ${place.count}번째부터 · 랭크 전체` : place.scopeLabel }),
  ]);
  const kids = [head, node("p", { class: "sub", text: place.why })];
  if (place.total) {
    // 이 파라미터 혼자가 아니라 여러 항의 합인 자리 — 어디에 끼어 있는지 보여 준다.
    const terms = node("div", { class: "terms" });
    place.total.parts.forEach((p, i) => {
      if (i) terms.append(node("span", { class: "op", text: "+" }));
      terms.append(node("span", { class: `term${p.term === name ? " me" : ""}`, text: `${p.term} ${p.ck == null ? "?" : fmt(p.ck)}` }));
    });
    terms.append(node("span", { class: "op", text: "=" }), node("span", { class: "term", text: `${fmt(place.total.total)}clk` }));
    kids.push(terms);
  }
  return node("div", { class: "place" }, kids);
}

function openParam(name) {
  const card = explain(gen, bin, name);
  if (!card) return;
  el.paramTitle.replaceChildren(
    document.createTextNode(name),
    node("span", { class: "val", text: card.clocks == null ? "값 없음" : `${card.clocks}clk` }),
    ...(card.family ? [node("span", { class: "fam", text: card.family.label })] : []),
  );

  const body = [];
  if (card.places.length) {
    body.push(section("어느 자리에 걸리는가", card.places.map((p) => placeCard(p, name))));
  } else {
    body.push(section("어느 자리에 걸리는가", [node("p", { class: "sub", text: "규칙에 직접 쓰이지 않는다 — 다른 값의 재료로 쓰인다." })]));
  }
  body.push(section("왜 존재하나", [node("p", { text: card.param.why })]));
  if (card.param.breaks) {
    body.push(section("안 지키면", [node("p", { text: card.param.breaks })], "ex-break"));
  }
  if (card.binding) {
    const chips = node("div", { class: "binrow-ex" });
    for (const b of card.bins) {
      chips.append(node("span", { class: "binchip" }, [
        document.createTextNode(`${b.bin.label.replace(/^모의 /, "")} ${b.clocks ?? "—"}clk`),
        ...(b.winner ? [node("em", { text: ` ${b.winner === "ns" ? "ns 가 이김" : "클럭이 이김"}` })] : []),
      ]));
    }
    body.push(section("빈이 바뀌면", [node("p", { class: "sub", text: card.binding.text }), chips]));
  }
  if (card.siblings.length) {
    const kids = [node("p", { class: "sub", text: card.family.note })];
    for (const s of card.siblings) {
      kids.push(node("div", { class: "sib" }, [
        node("div", { class: "sib-top" }, [
          node("button", { type: "button", "data-param": s.name, text: s.name }),
          node("span", { class: "num", text: s.clocks == null ? "값 없음" : `${s.clocks}clk` }),
        ]),
        // 커맨드 쌍이 같고 범위만 다른 둘 — 이 차이가 뱅크그룹을 이해하는 자리다.
        ...(s.pairedBy ? [node("p", { class: "pair" }, [
          document.createTextNode(`${s.pairedBy.from} → ${s.pairedBy.to} 로 자리가 같고 범위만 다르다 — `),
          node("b", { text: `${name}: ${s.pairedBy.mine} / ${s.name}: ${s.pairedBy.theirs}` }),
        ])] : []),
        node("p", { class: "swhy", text: s.why }),
      ]));
    }
    body.push(section(`같은 무리 — ${card.family.label}`, kids));
  }
  el.paramBody.replaceChildren(...body);
  if (!el.param.open) el.param.showModal();
}

/* ---------- 참고문헌 ----------
 *
 * 값이 대표값인 이상 **어디를 보면 확인할 수 있는지**가 값만큼 중요하다.
 * 대조가 필요한 값 목록은 손으로 적지 않고 spec 의 verify 표시에서 뽑는다 —
 * 손으로 적으면 값을 고칠 때 목록이 따라오지 않아 금방 거짓말이 된다.
 */
function renderRefs() {
  el.refsTitle.textContent = `참고문헌 — ${gen.label}`;
  const items = (gen.refs ?? []).map((r) => node("div", { class: "ref" }, [
    node("div", { class: "ref-top" }, [
      node("span", { class: "ref-kind", text: r.kind }),
      node("span", { class: "ref-title", text: r.title }),
      ...(r.doc ? [node("span", { class: "ref-doc", text: r.doc })] : []),
    ]),
    node("p", { class: "ref-where", text: r.where }),
    ...(r.url ? [node("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: `${r.url} ↗` })] : []),
  ]));

  /* 숫자가 전부 모의값이라는 것을 셈으로 보인다. 말로 주장하는 것과 개수를 세어
   * 보이는 것은 다르다 — 나중에 다른 출처가 섞이면 이 줄이 먼저 달라진다. */
  const all = [
    ...Object.entries(gen.params ?? {}),
    ...(gen.bins ?? []).flatMap((b) => Object.entries(b.params ?? {})),
    // 전압 레일도 값이다 — 파형의 세로축이 여기서 나오므로 셈에서 빼지 않는다.
    ...Object.entries(gen.rails?.src ?? {}).map(([name, src]) => [name, { src }]),
  ].filter(([, p]) => p.src);
  if (all.length) {
    const counts = Object.entries(PROVENANCE)
      .map(([key, meta]) => [meta, all.filter(([, p]) => p.src === key).length])
      .filter(([, n]) => n > 0);
    items.unshift(node("div", { class: "ref-clean" }, [
      node("h3", { text: "숫자는 전부 모의값이다" }),
      node("p", { text: `이 화면의 값 ${all.length}개가 모두 모의값이다. 부품 데이터시트의 값도, 사내·NDA 자료의 값도 들어 있지 않다.` }),
      node("p", { text: "구조(커맨드·상태 전이·규칙·뱅크 구성)는 표준에서, 파형의 모양은 널리 알려진 원리에서 온다. 숫자만 그림을 그리려고 둔 것이고, 관계는 실제와 맞춰 뒀다." }),
      ...counts.map(([meta, n]) => node("p", { class: "src-line" }, [
        node("b", { text: `${meta.label} ${n}개 — ` }),
        document.createTextNode(meta.note.replace(/\*\*/g, "")),
      ])),
    ]));
  }

  const unsure = Object.entries(gen.params ?? {}).filter(([, p]) => p.verify).map(([n]) => n)
    .concat(gen.bins?.flatMap((b) => Object.entries(b.params ?? {}).filter(([, p]) => p.verify).map(([n]) => `${n}(${b.id})`)) ?? []);
  if (unsure.length) {
    items.push(node("div", { class: "ref-verify" }, [
      node("h3", { text: `대조가 필요한 값 ${unsure.length}개` }),
      node("p", {}, [
        document.createTextNode("표기 방식에 이견이 있을 수 있어 스펙과 맞춰 봐야 하는 값이다 — "),
        node("code", { text: unsure.join(", ") }),
        document.createTextNode(". 화면의 파라미터 표에서 ? 로 표시된다."),
      ]),
    ]));
  }
  el.refsBody.replaceChildren(...items);
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

el.timeline.addEventListener("click", (e) => {
  const id = e.target.getAttribute?.("data-lane");
  if (id == null) return;
  setFocus(id);
});
el.legend.addEventListener("click", (e) => {
  const id = e.target.closest("[data-lane]")?.dataset.lane;
  if (id) setFocus(id);
});

for (const host of [el.params, el.why, el.paramBody]) {
  host.addEventListener("click", (e) => {
    const name = e.target.closest("[data-param]")?.dataset.param;
    if (name) openParam(name);
  });
}
el.paramClose.addEventListener("click", () => el.param.close());

for (const b of [el.refsOpen, el.refsLink]) {
  b.addEventListener("click", () => { renderRefs(); el.refs.showModal(); });
}
el.refsClose.addEventListener("click", () => el.refs.close());

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
