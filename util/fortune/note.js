// 운세 노트의 그리기 부품 — 연필 선(rough.js)·동그라미·화살표·명식 표·오행 막대·인생 곡선·
// 형광펜 문단·쓰는 동작. index.html 의 인라인 스크립트보다 먼저(일반 스크립트로) 불러
// window.Note 로 쓴다. 데이터는 전부 서버 응답(_infra/fortune.js 등)에서 오고 여기서는 그리기만 한다.
//
// 지키는 것:
//  * 같은 생년월일이면 같은 획 — rough.js 시드를 생년월일에서 뽑는다(Note.seedOf).
//  * 프로덕션 CSP 를 가정해 style 속성을 쓰지 않는다. 계산된 값은 el.style.setProperty 로만.
//  * 손글씨는 제목·라벨·주석에만. 본문은 고운돋움.
//  * prefers-reduced-motion 이면 움직임 없이 다 그려진 상태로.
(() => {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const INK = { pencil: "#2E2C29", faint: "#7C776E", red: "#C8432F", blue: "#2F5DA8", hl: "rgba(255,212,0,.45)" };
  const EL = { 목: "#4E8A4B", 화: "#D0583C", 토: "#B98A3E", 금: "#8A8F98", 수: "#3A5C8F" };
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── 시드 ── 생년월일(시·성별 포함) → 정수. 획마다 번호를 더해 서로 다르게.
  let SEED = 1, serial = 0;
  function seedOf(birth) {
    const key = birth ? `${birth.y}-${birth.m}-${birth.d}-${birth.h ?? ""}-${birth.time ?? ""}-${birth.gender ?? ""}` : "note";
    let h = 2166136261;
    for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 2147483000) + 1;
  }
  function setSeed(birth) { SEED = seedOf(birth); serial = 0; }
  const o = (extra = {}) => ({ seed: (SEED + (++serial) * 7919) % 2147483647 || 1, ...extra });
  const rc = (svg) => window.rough.svg(svg, { options: { roughness: 1.2, bowing: 1, stroke: INK.pencil, strokeWidth: 1.2 } });

  const svgEl = (w, h, cls) => {
    const s = document.createElementNS(SVGNS, "svg");
    if (w) s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    if (cls) s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    return s;
  };
  const sv = (tag, attrs = {}) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  function rel(el, box) {
    const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }
  function overlayOf(box) {
    let s = box.querySelector(":scope > svg.overlay");
    if (!s) { s = svgEl(null, null, "overlay"); box.appendChild(s); }
    return s;
  }

  // ── 부품 ──
  // 낱말 둘레에 연필 동그라미. host 크기를 재서 그린다(다시 부르면 다시 그린다).
  function ring(host, color = INK.pencil, extra = {}) {
    host.querySelector(":scope > svg.ring")?.remove();
    const r = host.getBoundingClientRect();
    if (!r.width) return null;
    const pad = host.classList.contains("pen") ? 0 : 20;
    const w = r.width + pad, h = r.height + (pad ? 10 : 0);
    const s = svgEl(w, h, "ring");
    const shape = host.classList.contains("pen")
      ? rc(s).rectangle(3, 3, w - 6, h - 6, o({ stroke: color, strokeWidth: 1.3, ...extra }))
      : rc(s).ellipse(w / 2, h / 2, w - 4, h - 2, o({ stroke: color, strokeWidth: 1.3, roughness: 1.1, ...extra }));
    s.appendChild(shape);
    host.prepend(s);
    return shape;
  }
  function arrow(svg, pts, color = INK.pencil) {
    const r = rc(svg);
    const g = sv("g");
    g.appendChild(pts.length > 2 ? r.curve(pts, o({ stroke: color, strokeWidth: 1.25, roughness: .9 }))
      : r.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], o({ stroke: color, strokeWidth: 1.25 })));
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (const side of [-1, 1]) {
      const t = ang + Math.PI + side * 0.45;
      g.appendChild(r.line(b[0], b[1], b[0] + 9 * Math.cos(t), b[1] + 9 * Math.sin(t), o({ stroke: color, strokeWidth: 1.25, roughness: .6 })));
    }
    svg.appendChild(g);
    return g;
  }
  // 두 점 사이를 한쪽으로 휜 곡선 화살표로(가운데 점을 수직으로 bend 만큼 민다)
  function bentArrow(svg, from, to, color, bend = .28) {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const mx = from[0] + dx / 2 - dy * bend, my = from[1] + dy / 2 + dx * bend;
    const q = (t) => [(1 - t) ** 2 * from[0] + 2 * (1 - t) * t * mx + t * t * to[0], (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * my + t * t * to[1]];
    return arrow(svg, [from, q(.25), q(.5), q(.75), to], color);
  }

  // 문단: marks(key=형광펜, caution=물결)와 용어 버튼을 끼워 넣는다. 글은 textContent 로만.
  function paragraph(text, marks = [], { terms = [], className } = {}) {
    const p = document.createElement("p");
    if (className) p.className = className;
    const spans = [];
    for (const m of marks || []) {
      const at = text.indexOf(m.text);
      if (at < 0 || !m.text) continue;
      if (spans.some((s) => at < s.end && at + m.text.length > s.start)) continue;
      spans.push({ start: at, end: at + m.text.length, cls: m.kind === "caution" ? "warn" : "hl" });
    }
    spans.sort((a, b) => a.start - b.start);
    const usedTerms = new Set();
    const addText = (parent, str) => {
      let rest = str;
      while (rest) {
        let hit = null;
        for (const t of terms) {
          if (usedTerms.has(t.word)) continue;
          const i = rest.indexOf(t.word);
          if (i >= 0 && (!hit || i < hit.i)) hit = { i, t };
        }
        if (!hit) { parent.append(rest); return; }
        parent.append(rest.slice(0, hit.i));
        const b = document.createElement("button");
        b.type = "button"; b.className = "term"; b.dataset.term = hit.t.key ?? hit.t.word;
        if (hit.t.id) b.id = hit.t.id;
        b.textContent = hit.t.word;
        parent.append(b);
        usedTerms.add(hit.t.word);
        rest = rest.slice(hit.i + hit.t.word.length);
      }
    };
    let pos = 0;
    for (const s of spans) {
      addText(p, text.slice(pos, s.start));
      const span = document.createElement("span");
      span.className = s.cls;
      addText(span, text.slice(s.start, s.end));
      p.append(span);
      pos = s.end;
    }
    addText(p, text.slice(pos));
    return p;
  }

  // ── 움직임 기록 ── 하나의 시간표로 지연을 주고 쌓아 두었다가, 탭하면 한꺼번에 끝낸다.
  function Motion() {
    const list = [];
    const on = !reduced();
    return {
      on, list,
      stroke(g, delay, dur) {
        if (!on || !g) return;
        const paths = g.tagName === "path" ? [g] : [...g.querySelectorAll("path")];
        const lens = paths.map((p) => { try { return p.getTotalLength(); } catch { return 0; } });
        const total = lens.reduce((a, b) => a + b, 0) || 1;
        let t = delay;
        paths.forEach((p, i) => {
          const len = lens[i] || 1;
          const d = dur * len / total;
          p.style.setProperty("stroke-dasharray", `${len} ${len}`);
          list.push(p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { delay: t, duration: Math.max(1, d), fill: "both", easing: "linear" }));
          t += d;
        });
      },
      fade(el, delay, dur = 280) {
        if (!on || !el) return null;
        const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { delay, duration: dur, fill: "both" });
        list.push(a);
        return a;
      },
      write(el, delay, dur) {
        if (!on || !el) return;
        list.push(el.animate([{ clipPath: "inset(-10% 100% -10% 0)" }, { clipPath: "inset(-10% 0 -10% 0)" }],
          { delay, duration: dur, fill: "both", easing: "steps(6, end)" }));
      },
      add(a) { if (on && a) list.push(a); return a; },
      finish() { for (const a of list) { try { a.finish(); } catch { /* 이미 끝남 */ } } },
      cancel() { for (const a of list) { try { a.cancel(); } catch { /* */ } } list.length = 0; },
      done() { return Promise.all(list.map((a) => a.finished.catch(() => null))); },
    };
  }

  // ── 명식 표 ── 머리 40px + 4칸×60px, 줄 80px — 모눈(20px)에 맞춘다.
  const COLS = [["hour", "시"], ["day", "일"], ["month", "월"], ["year", "년"]];
  function chartTable(pillars, { term } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "chartwrap";
    const grid = document.createElement("div");
    grid.className = "chart";
    grid.setAttribute("role", "table");
    grid.setAttribute("aria-label", "사주 명식 표");
    const head = document.createElement("div");
    head.className = "colh hand h-s faint";
    head.append(term ? term("명식") : "명식");
    grid.append(head);
    for (const [, n] of COLS) {
      const c = document.createElement("div");
      c.className = "colh hand h-s faint";
      c.append(term ? term(n, "기둥") : n);
      grid.append(c);
    }
    const cells = [];
    for (const row of ["stem", "branch"]) {
      const rh = document.createElement("div");
      rh.className = "rowh hand h-s faint";
      rh.append(term ? term(row === "stem" ? "천간" : "지지") : (row === "stem" ? "천간" : "지지"));
      grid.append(rh);
      for (const [key] of COLS) {
        const x = pillars[key]?.[row];
        const me = key === "day" && row === "stem";
        const cell = document.createElement("div");
        cell.className = `cell${me ? " me" : ""}${x ? "" : " none"}`;
        cell.setAttribute("role", "cell");
        const god = document.createElement("div");
        god.className = "god";
        god.textContent = !x ? "" : me ? "나" : x.tenGod;
        const ch = document.createElement("div");
        ch.className = "ch";
        const k = document.createElement("span");
        k.className = "k";
        k.textContent = x ? x.korean : "?";
        ch.append(k);
        if (x) {
          const hj = document.createElement("span");
          hj.className = "hj";
          hj.textContent = x.hanja;
          ch.append(hj, svgEl(30, 6, "mark"));
          cell.dataset.el = x.element;
        }
        cell.dataset.order = { year: 0, month: 1, day: 2, hour: 3 }[key] * 2 + (row === "branch" ? 1 : 0);
        if (row === "stem") cell.append(god, ch); else cell.append(ch, god);
        if (x) cell.setAttribute("aria-label", `${key === "day" && row === "stem" ? "나 " : ""}${x.korean}(${x.hanja}) ${x.element} ${x.tenGod}`);
        grid.append(cell);
        cells.push(cell);
      }
    }
    wrap.append(grid);
    const note = document.createElement("span");
    note.className = "note hand h-s blue me-note";
    note.textContent = "자, 이 글자가 당신이에요";
    wrap.append(note);
    const legend = document.createElement("div");
    legend.className = "legend small";
    legend.append("밑줄 색이 오행이에요 — ");
    for (const e of Object.keys(EL)) {
      const s = document.createElement("span");
      s.className = `el-${e}`;
      s.textContent = `${e} `;
      legend.append(s);
    }
    wrap.append(legend);
    const parts = { wrap, cells, note, legend, lines: [], arrow: null, marks: [] };
    parts.draw = () => drawChart(parts);
    return parts;
  }
  function drawChart(parts) {
    const { wrap, cells, note } = parts;
    wrap.querySelector(":scope > svg.overlay")?.remove();
    // 표가 모눈 칸에 맞게 — 종이(.page) 기준 위쪽을 20px 의 배수로
    const page = wrap.closest(".page");
    if (page) {
      wrap.style.setProperty("margin-top", "64px");
      const off = wrap.getBoundingClientRect().top - page.getBoundingClientRect().top;
      wrap.style.setProperty("margin-top", `${64 + ((20 - (Math.round(off) % 20)) % 20)}px`);
    }
    const ov = overlayOf(wrap);
    const r = rc(ov);
    const W = 280, top = 40, H = 160;
    parts.lines = [r.line(0, top, W, top, o()), r.line(0, top + 80, W, top + 80, o({ stroke: INK.faint })), r.line(0, top + H, W, top + H, o())];
    for (let i = 1; i <= 4; i++) parts.lines.push(r.line(40 + (i - 1) * 60, top - 6, 40 + (i - 1) * 60, top + H + 4, o({ stroke: i === 1 ? INK.pencil : INK.faint, strokeWidth: 1 })));
    parts.lines.forEach((l) => ov.appendChild(l));
    parts.marks = [];
    for (const c of cells) {
      const m = c.querySelector("svg.mark");
      if (!m) continue;
      m.replaceChildren();
      const g = rc(m).line(1, 3, 29, 3.5, o({ stroke: EL[c.dataset.el], strokeWidth: 2.2, roughness: 1.6 }));
      m.appendChild(g);
      parts.marks.push(g);
    }
    // "이 글자가 당신이에요" — 표 위 오른쪽에서 일간 칸으로
    const me = wrap.querySelector(".cell.me .k");
    if (me) {
      note.hidden = false;
      const mr = rel(me, wrap);
      note.style.setProperty("left", `${Math.min(150, Math.max(0, wrap.clientWidth - note.offsetWidth))}px`);
      note.style.setProperty("top", "-50px");
      const nr = rel(note, wrap);
      parts.arrow = bentArrow(ov, [nr.x + 10, nr.y + nr.h], [mr.x + mr.w + 1, mr.y + 8], INK.blue, -.25);
    } else note.hidden = true;
  }

  // ── 오행 막대 ── 색연필 빗금으로 칠한다. 0개는 빨간 점선 상자 + 메모.
  function elementBars(counts) {
    const box = document.createElement("div");
    box.className = "bars";
    const rows = [];
    for (const e of Object.keys(EL)) {
      const n = counts[e] ?? 0;
      const lab = document.createElement("span");
      lab.className = `hand h-sub el-${e}`;
      lab.textContent = e;
      const bar = document.createElement("div");
      bar.className = "bar";
      const num = document.createElement("span");
      num.className = `n hand h-sub${n === 0 ? " red" : ""}`;
      num.textContent = String(n);
      box.append(lab, bar, num);
      rows.push({ e, n, bar });
    }
    const parts = { box, rows, shapes: [] };
    parts.draw = () => {
      parts.shapes = [];
      const bw = rows[0].bar.getBoundingClientRect().width;
      if (!bw) return;
      const max = Math.max(3, ...rows.map((r) => r.n));
      const unit = Math.min(56, (bw - 12) / (max + .2));
      for (const r of rows) {
        r.bar.replaceChildren();
        const s = svgEl(bw, 26);
        r.bar.append(s);
        const g = r.n === 0
          ? rc(s).rectangle(2, 5, unit * .9, 16, o({ stroke: INK.red, strokeWidth: 1, strokeLineDash: [3, 4], roughness: .8 }))
          : rc(s).rectangle(2, 5, unit * r.n, 16, o({ fill: EL[r.e], fillStyle: "hachure", hachureGap: 3.2, hachureAngle: -50, fillWeight: 1.4, stroke: EL[r.e], strokeWidth: .9 }));
        s.append(g);
        let note = null;
        if (r.n === 0) {
          note = document.createElement("span");
          note.className = "note hand h-s red";
          note.textContent = "여기 봐요, 하나도 없어요";
          note.style.setProperty("left", `${Math.round(unit + 12)}px`);
          r.bar.append(note);
        }
        parts.shapes.push({ g, dashed: r.n === 0, note });
      }
    };
    return parts;
  }

  // ── 인생 곡선 ── star-history 식 손그림 차트. 이름표는 곡선·점·서로와 겹치지 않는 자리를 찾아 둔다.
  function lifeCurve(curve, { onPick } = {}) {
    const host = document.createElement("div");
    host.className = "curve-plot";
    const parts = { host, curve, selected: curve.currentIndex >= 0 ? curve.currentIndex : curve.sections.length - 1 };
    parts.draw = () => drawCurve(parts, onPick);
    parts.pick = (i) => parts.select?.(i);
    return parts;
  }
  function boxesHit(a, b, pad = 2) {
    return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  }
  function drawCurve(parts, onPick) {
    const { host, curve } = parts;
    host.replaceChildren();
    const W = Math.max(240, host.getBoundingClientRect().width || 320);
    const H = 262, L = 30, R = 14, T = 58, B = 30;
    const maxAge = Math.max(90, curve.sections.at(-1).to);
    const X = (a) => L + (a / maxAge) * (W - L - R);
    const Y = (s) => T + (1 - s / 100) * (H - T - B);
    const s = svgEl(W, H);
    s.setAttribute("height", H);
    s.setAttribute("role", "img");
    s.removeAttribute("aria-hidden");
    s.setAttribute("aria-label", `인생 곡선 — ${[curve.best?.label, curve.worst?.label ?? "앞으로는 고른 흐름"].filter(Boolean).join(", ")}`);
    host.append(s);
    const r = rc(s);
    const P = { ticks: [], dots: [], marks: [], labels: [] };
    const text = (x, y, t, cls = "", anchor = "middle") => {
      const e = sv("text", { x, y, "text-anchor": anchor });
      if (cls) e.setAttribute("class", cls);
      e.textContent = t;
      s.append(e);
      return e;
    };
    // 축 + 화살촉
    const axes = sv("g");
    axes.append(r.line(L, H - B, W - 4, H - B, o({ strokeWidth: 1.3 })), r.line(L, H - B, L, T - 26, o({ strokeWidth: 1.3 })));
    for (const [x, y, dx, dy] of [[W - 4, H - B, -1, 0], [L, T - 26, 0, 1]]) {
      for (const k of [-1, 1]) axes.append(r.line(x, y, x + dx * 8 + (dy ? k * 5 : 0), y + dy * 8 + (dx ? k * 5 : 0), o({ strokeWidth: 1.3, roughness: .7 })));
    }
    s.append(axes);
    P.axes = axes;
    for (let a = 0; a <= 80; a += (W < 300 ? 20 : 10)) P.ticks.push(text(X(a), H - B + 18, a));
    P.ticks.push(text(W - 4, H - B - 8, "나이", "", "end"));
    for (const v of [50, 100]) P.ticks.push(text(L - 6, Y(v) + 5, v, "", "end"));
    P.ticks.push(text(L + 6, T - 22, "기운", "", "start"));

    const pts = [];
    curve.sections.forEach((sec) => pts.push([X(sec.from), Y(sec.score)], [X(sec.to), Y(sec.score)]));
    const best = curve.best && curve.sections[curve.best.index];
    const worst = curve.worst && curve.sections[curve.worst.index];
    if (best) {   // 형광펜 띠 — 곡선 밑에 깔리게 먼저
      const hl = sv("path", { d: `M${X(best.from) + 1} ${Y(best.score) - .5} L${X(best.to) - 1} ${Y(best.score) + 1}`, stroke: INK.hl, "stroke-width": 13, fill: "none" });
      s.append(hl);
      P.marks.push(hl);
    }
    const poly = [[pts[0][0], H - B], ...pts, [pts.at(-1)[0], H - B]];
    // 빗금은 연하게 — 곡선(진한 연필)이 먼저 읽히게
    P.fill = r.polygon(poly, o({ stroke: "none", fill: "rgba(46,44,41,.2)", fillStyle: "hachure", hachureGap: 8, hachureAngle: -41, fillWeight: .6 }));
    s.append(P.fill);
    P.line = r.linearPath(pts, o({ strokeWidth: 1.9, roughness: 1 }));
    s.append(P.line);

    // ── 이름표 자리 찾기 ──
    // 장애물: 계단 곡선의 선분(가로·세로), 세운 점, 별, 이미 놓은 이름표와 화살표, 축 라벨.
    // 후보 자리를 순서대로 대 보고 하나도 안 걸리는 첫 자리에 둔다(곡선 위쪽 후보가 먼저).
    const segs = [[[L, T - 26], [L, H - B]], [[L, H - B], [W - 4, H - B]]];   // 축도 장애물
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    const segHits = (b, pad = 3) => segs.some(([[x1, y1], [x2, y2]]) => {
      const minx = Math.min(x1, x2) - pad, maxx = Math.max(x1, x2) + pad, miny = Math.min(y1, y2) - pad, maxy = Math.max(y1, y2) + pad;
      return b.x < maxx && b.x + b.w > minx && b.y < maxy && b.y + b.h > miny;
    });
    const taken = [];
    const free = (b) => b.x >= 2 && b.x + b.w <= W - 2 && b.y >= 0 && b.y + b.h <= H - B - 2
      && !segHits(b) && !taken.some((t) => boxesHit(b, t, 3));
    // 화살표는 세운 점(작은 점)은 지나가도 되고, 글자·별만 피한다
    const pathFree = (ptsOnPath) => ptsOnPath.every(([x, y]) => !taken.some((t) => !t.dot && x > t.x - 2 && x < t.x + t.w + 2 && y > t.y - 2 && y < t.y + t.h + 2));
    for (const y of curve.yearly) {
      const cx = X(y.age + .5), cy = Y(y.score);
      const c = r.circle(cx, cy, 3.4, o({ fill: INK.pencil, fillStyle: "solid", stroke: "none", roughness: .5 }));
      s.append(c);
      P.dots.push(c);
      taken.push({ x: cx - 3, y: cy - 3, w: 6, h: 6, dot: true });
    }
    taken.push({ x: L - 30, y: T - 40, w: 70, h: 22 });           // "기운" 축 라벨
    taken.push({ x: L - 30, y: Y(100) - 12, w: 26, h: 16 }, { x: L - 26, y: Y(50) - 12, w: 22, h: 16 });
    const measure = (label, cls) => {
      const t = text(0, 0, label, cls, "start");
      const bb = t.getBBox();
      return { t, w: bb.width, h: bb.height || 18 };
    };
    const place = (label, cls, candidates, extraOk = () => true) => {
      const { t, w, h } = measure(label, cls);
      let pick = null;
      for (const [x, y] of candidates) {
        const b = { x, y: y - h * .78, w, h };
        if (free(b) && extraOk(b)) { pick = b; break; }
      }
      const placed = !!pick;
      if (!pick) { const [x, y] = candidates[0]; pick = { x: Math.min(Math.max(2, x), W - w - 2), y: y - h * .78, w, h }; }
      t.setAttribute("x", pick.x);
      t.setAttribute("y", pick.y + h * .78);
      taken.push(pick);
      P.labels.push(t);
      return { el: t, box: pick, placed };
    };
    // 후보 목록이 다 막히면 판 전체를 촘촘히 훑어 점수가 가장 좋은 빈자리를 고른다.
    const curveYAt = (x) => { const sec = curve.sections.find((q) => x >= X(q.from) && x <= X(q.to)); return sec ? Y(sec.score) : H - B; };
    const search = (label, cls, cost, extraOk = () => true, underOk = false) => {
      const { t, w, h } = measure(label, cls);
      let pick = null, bestCost = Infinity;
      for (let y = 12 + h * .78; y <= H - B - 4; y += 6) {
        for (let x = 2; x <= W - w - 2; x += 8) {
          const b = { x, y: y - h * .78, w, h };
          if (!free(b) || !extraOk(b)) continue;
          const under = !underOk && b.y + b.h > curveYAt(b.x + b.w / 2) ? 60 : 0;   // 빗금 안은 웬만하면 피한다
          const c = cost(b) + under;
          if (c < bestCost) { bestCost = c; pick = b; }
        }
      }
      const placed = !!pick;
      if (!pick) pick = { x: 2, y: 12, w, h };
      t.setAttribute("x", pick.x);
      t.setAttribute("y", pick.y + h * .78);
      taken.push(pick);
      P.labels.push(t);
      return { el: t, box: pick, placed };
    };
    const around = (cx, cy, w, offsets) => offsets.flatMap(([dy, side]) => side === "c" ? [[cx - w / 2, cy + dy]]
      : side === "l" ? [[cx - w - 14, cy + dy]] : [[cx + 14, cy + dy]]);
    // 별 자리는 먼저 비워 둔다(메모가 별을 덮지 않게)
    if (best) { const sx = (X(best.from) + X(best.to)) / 2, sy = Math.max(T - 12, Y(best.score) - 18); taken.push({ x: sx - 9, y: sy - 9, w: 18, h: 18 }); }
    // 지금 여기 — 메모는 곡선 위 빈자리에, 화살표는 길고 확실히 휘게
    const cur = curve.sections[curve.currentIndex];
    if (cur) {
      const nx = X(curve.age), ny = Y(cur.score);
      const label = `지금 여기예요 (${Math.floor(curve.age)}세)`;
      const m = measure(label, "blue"); m.t.remove();
      const w = m.w;
      // 화살표는 메모 아래 모서리에서 지금 자리까지, 확실히 휘게. 화살표가 다른 이름표·점을 지나지 않는 자리만.
      const arrowFor = (b) => {
        let from;
        if (ny > b.y + b.h) from = [Math.min(Math.max(nx, b.x + 12), b.x + b.w - 12), b.y + b.h + 3];   // 메모가 위
        else if (nx > b.x + b.w) from = [b.x + b.w + 4, b.y + b.h / 2];                               // 메모가 왼쪽
        else if (nx < b.x) from = [b.x - 4, b.y + b.h / 2];                                           // 메모가 오른쪽
        else from = [Math.min(Math.max(nx, b.x + 12), b.x + b.w - 12), b.y - 3];                     // 메모가 아래
        const fromX = from[0];
        const to = [nx - (fromX < nx ? 3 : -3), ny + (from[1] < ny ? -6 : 6)];
        const bend = (fromX < nx) === (from[1] < ny) ? .32 : -.32;
        const dx = to[0] - from[0], dy = to[1] - from[1];
        const mx = from[0] + dx / 2 - dy * bend, my = from[1] + dy / 2 + dx * bend;
        const path = [];
        for (let t = .08; t < .86; t += .06) path.push([(1 - t) ** 2 * from[0] + 2 * (1 - t) * t * mx + t * t * to[0], (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * my + t * t * to[1]]);
        return { from, to, bend, path, len: Math.hypot(dx, dy) };
      };
      const cands = [];
      for (const dy of [-64, -78, -50, -92, -106, -40]) {
        for (const dx of [-w - 24, -w + 8, -w / 2, 14, -w - 52, 36]) cands.push([nx + dx, ny + dy]);
      }
      const ok = (b) => {
        const a = arrowFor(b);
        return a.len >= 46 && pathFree(a.path.filter(([x, y]) => Math.hypot(x - nx, y - ny) > 10)) && !a.path.some(([x, y]) => segHits({ x: x - 1, y: y - 1, w: 2, h: 2 }, 0) && Math.hypot(x - nx, y - ny) > 12);
      };
      let got = place(label, "blue", cands, ok);
      if (!got.placed) {
        P.labels.pop().remove(); taken.pop();
        // 화살표가 50~110px 이고 메모가 점보다 위에 있을수록 좋다
        got = search(label, "blue", (b) => { const a = arrowFor(b); return Math.abs(a.len - 75) + (b.y + b.h > ny ? 40 : 0); }, ok);
      }
      P.nowNote = got.el;
      P.nowNoteInfo = got;
      const a = arrowFor(got.box);
      P.nowArrow = bentArrow(s, a.from, a.to, INK.blue, a.bend);
      for (const [x, y] of a.path) taken.push({ x: x - 4, y: y - 4, w: 8, h: 8 });   // 다른 이름표가 화살표를 덮지 않게
    }
    // 별 + "여기가 제일 좋아요"
    if (best) {
      const cx = (X(best.from) + X(best.to)) / 2, cy = Math.max(T - 12, Y(best.score) - 18);
      const star = [];
      for (let i = 0; i < 10; i++) { const rr = i % 2 ? 3.4 : 8; const a = -Math.PI / 2 + i * Math.PI / 5; star.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
      const st = r.polygon(star, o({ strokeWidth: 1.2, roughness: .9 }));
      s.append(st);
      P.marks.push(st);
      taken.push({ x: cx - 9, y: cy - 9, w: 18, h: 18 });
      const w = measure("여기가 제일 좋아요", "ink"); w.t.remove();
      const offs = [];
      for (const dy of [5, -9, 19, -23, 33, -37]) offs.push([dy, "l"], [dy, "r"]);
      offs.push([40, "c"], [56, "c"]);
      P.bestLabel = place("여기가 제일 좋아요", "ink", around(cx, cy, w.w, offs));
      if (!P.bestLabel.placed) {
        P.labels.pop().remove(); taken.pop();
        P.bestLabel = search("여기가 제일 좋아요", "ink", (b) => Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy));
      }
      // 이름표가 별에서 멀리 밀려났으면 연필 선 하나로 잇는다
      const lb = P.bestLabel.box;
      const ex = cx < lb.x ? lb.x - 3 : cx > lb.x + lb.w ? lb.x + lb.w + 3 : cx;
      const ey = cy < lb.y ? lb.y - 2 : cy > lb.y + lb.h ? lb.y + lb.h + 2 : lb.y + lb.h / 2;
      if (Math.hypot(ex - cx, ey - cy) > 34) {
        const k = 11 / Math.hypot(ex - cx, ey - cy);
        const lead = r.line(ex, ey, cx + (ex - cx) * k, cy + (ey - cy) * k, o({ stroke: INK.faint, strokeWidth: 1, roughness: .8 }));
        s.append(lead);
        P.marks.push(lead);
      }
    }
    // 조심: 빨간 물결 + "조심할 때"
    if (worst) {
      const y0 = Y(worst.score) + 7;
      let d = `M${X(worst.from) + 2} ${y0}`;
      for (let x = X(worst.from) + 2, k = 0; x < X(worst.to) - 3; x += 3.5, k++) d += ` L${x + 3.5} ${y0 + (k % 2 ? -2.2 : 2.2)}`;
      const g = sv("g");
      g.append(sv("path", { d, stroke: INK.red, "stroke-width": 1.4, fill: "none", "stroke-linejoin": "round" }));
      s.append(g);
      P.marks.push(g);
      taken.push({ x: X(worst.from), y: y0 - 4, w: X(worst.to) - X(worst.from), h: 8 });
      const cx = (X(worst.from) + X(worst.to)) / 2, cy = Y(worst.score);
      const w = measure("조심할 때", "red"); w.t.remove();
      const offs = [];
      for (const dy of [-8, -22, -36, -50]) offs.push([dy, "c"], [dy, "l"], [dy, "r"]);
      for (const dy of [30, 44]) offs.push([dy, "c"], [dy, "l"], [dy, "r"]);   // 곡선 밑(빗금 안)은 마지막에
      P.worstLabel = place("조심할 때", "red", around(cx, cy, w.w, offs));
      if (!P.worstLabel.placed) {
        P.labels.pop().remove(); taken.pop();
        P.worstLabel = search("조심할 때", "red", (b) => Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy), undefined, true);
      }
    }
    // 선택(파란 볼펜) 층
    const sel = sv("g");
    s.append(sel);
    // 구간 누르기
    const select = (i) => {
      parts.selected = i;
      sel.replaceChildren();
      const sec = curve.sections[i];
      sel.append(r.line(X(sec.from) + 1, Y(sec.score) - 1, X(sec.to) - 1, Y(sec.score) - 1, o({ stroke: INK.blue, strokeWidth: 2.2, roughness: .8 })),
        r.line(X(sec.from) + 1, H - B + 4, X(sec.to) - 1, H - B + 4, o({ stroke: INK.blue, strokeWidth: 1.6, roughness: .6 })));
      onPick?.(i, sec);
    };
    parts.select = select;
    curve.sections.forEach((sec, i) => {
      const hit = sv("rect", { class: "hit", x: X(sec.from), y: 0, width: Math.max(1, X(sec.to) - X(sec.from)), height: H,
        tabindex: 0, role: "button", "aria-label": `${Math.round(sec.from)}세부터 ${sec.ganji} ${sec.kind === "before" ? "대운 전" : "대운"} 풀이 보기` });
      hit.addEventListener("click", () => select(i));
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); } });
      s.append(hit);
    });
    select(parts.selected);
    parts.P = P;
    // 검증용 표시: 이름표가 후보 자리 중 하나에 깔끔히 놓였는지(1) 겹침을 감수했는지(0)
    host.dataset.labels = [["best", P.bestLabel], ["worst", P.worstLabel], ["now", P.nowNoteInfo]]
      .filter(([, v]) => v).map(([k, v]) => `${k}:${v.placed ? 1 : 0}`).join(" ");
    // 겹침 검사 결과(테스트·검증용): 이름표끼리·이름표와 곡선이 겹치면 true
    parts.overlaps = () => {
      const boxes = P.labels.map((l) => l.getBBox());
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) if (boxesHit(boxes[i], boxes[j], 0)) return true;
        const b = boxes[i];
        if (segHits({ x: b.x, y: b.y, w: b.width, h: b.height }, 0)) return true;
      }
      return false;
    };
    return P;
  }

  // ── 바이오리듬 한 줄 ── 가운데 0 선 + 색연필 빗금 막대
  function bioBar(svgHost, v, color) {
    svgHost.replaceChildren();
    const w = svgHost.getBoundingClientRect().width || 300;
    const s = svgEl(w, 30);
    svgHost.append(s);
    const r = rc(s);
    s.append(r.line(4, 15, w - 4, 15, o({ stroke: INK.faint, strokeWidth: 1 })), r.line(w / 2, 4, w / 2, 26, o({ stroke: INK.faint, strokeWidth: 1 })));
    const len = Math.abs(v) * (w / 2 - 8);
    if (len > 1) {
      const x = v >= 0 ? w / 2 : w / 2 - len;
      s.append(r.rectangle(x, 8, len, 14, o({ fill: color, fillStyle: "hachure", hachureGap: 3.4, hachureAngle: -50, fillWeight: 1.3, stroke: color, strokeWidth: .9 })));
    }
    return s;
  }

  // 체크 상자(동의·알림): 상자 + 켜지면 V
  function checkbox(button, on) {
    button.replaceChildren();
    const s = svgEl(26, 26);
    const r = rc(s);
    s.append(r.rectangle(3, 3, 20, 20, o({ strokeWidth: 1.2 })));
    if (on) s.append(r.linearPath([[7, 13], [12, 19], [22, 4]], o({ stroke: INK.blue, strokeWidth: 2 })));
    button.append(s);
    button.setAttribute("aria-checked", String(on));
  }

  window.Note = { INK, EL, setSeed, seedOf, rc, o, svgEl, sv, rel, overlayOf, ring, arrow, bentArrow,
    paragraph, Motion, chartTable, elementBars, lifeCurve, bioBar, checkbox, boxesHit, reduced };
})();
