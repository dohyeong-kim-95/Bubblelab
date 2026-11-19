// 다그당스의 연필 — 노트 한 장(.nb 페이지)에 글자를 한 글자씩 쓰고, 연필 선(rough.js)을 긋고, 폴라로이드를 올려놓는다.
// 상담 순서(무엇을 쓸지)는 consult.js 가 정하고, 여기는 "어떻게 쓰는지"만 맡는다.
//
//  * 쓰는 속도: 손글씨 줄 한 글자 38ms, 풀이 본문 14ms. 화면을 톡 치면 지금 쓰는 것과 밀린 것을 바로 다 쓴다(다음 질문까지).
//  * prefers-reduced-motion 이면 처음부터 바로 다 쓴 상태로(움직임 없음). 다시 펼친 페이지(replay)도 바로 다 쓴다.
//  * 연필 표시(동그라미·밑줄·상자·화살표)는 글꼴이 다 놓인 뒤 자리를 재서 긋고, 글꼴 조각이 늦게 와 줄이 바뀌거나 화면 크기가
//    바뀌면 같은 획(seed)으로 다시 긋는다.
//  * 폴라로이드는 노트 위에 올려놓은 별개의 물건이다 — 놓일 높이만큼 노트 줄(모눈 20px)을 비우고 그 아래 줄부터 이어 쓴다.
//    글자와 절대 겹치지 않는다. 툭 놓이고 → 캡션을 쓰고 → 연필이 아래 줄로 내려간다.
//  * 프로덕션 CSP 를 지킨다: style 속성 문자열 대신 el.style.setProperty 만.
const SVGNS = "http://www.w3.org/2000/svg";
export const INK = { pencil: "#2E2C29", blue: "#2F5DA8", red: "#C8432F", faint: "#7C776E" };
export const ELEMENT_INK = { 목: "#4E8A4B", 화: "#D0583C", 토: "#B98A3E", 금: "#8A8F98", 수: "#3A5C8F" };
const LINE = 20;   // 모눈 한 칸 = 노트 한 줄

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export function pencilTip() {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 26 26");
  s.setAttribute("class", "tip");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = '<g transform="rotate(-38 13 13)"><rect x="4" y="10" width="15" height="6" rx="1" fill="#F2C14E" stroke="#2E2C29" stroke-width="1"/>'
    + '<rect x="1.5" y="10" width="3" height="6" fill="#E9A3A3" stroke="#2E2C29" stroke-width="1"/>'
    + '<path d="M19 10 L24.5 13 L19 16 Z" fill="#E8D3B0" stroke="#2E2C29" stroke-width="1"/><path d="M23 12.2 L24.5 13 L23 13.8 Z" fill="#2E2C29"/></g>';
  return s;
}

export function createPen(page, { motion = true, faceImg = null, faces = {} } = {}) {
  let instant = !motion;          // 다시 펼치기·움직임 줄이기: 바로 다 쓴 상태
  let fast = false;               // 톡 쳐서 건너뛰는 중(다음 질문까지)
  let wake = null;                // 기다리는 타이머를 바로 깨운다
  let seed = 11;
  const marks = [], polas = [], margins = [];
  const overlay = document.createElementNS(SVGNS, "svg");
  overlay.setAttribute("class", "nb-overlay");
  overlay.setAttribute("aria-hidden", "true");
  page.append(overlay);
  const rc = window.rough.svg(overlay);
  const tip = pencilTip();

  const now = () => instant || fast;
  const sleep = (ms) => (now() ? Promise.resolve() : new Promise((r) => {
    const t = setTimeout(r, ms);
    wake = () => { clearTimeout(t); r(); };
  }));
  page.addEventListener("click", (e) => {
    if (e.target.closest("button, input, label, a, select, .zoomable")) return;
    fast = true;
    wake?.();
  });

  const box0 = () => page.getBoundingClientRect();
  const rel = (n) => { const r = n.getBoundingClientRect(), b = box0(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }; };
  const opt = (m, extra = {}) => ({ stroke: m.color, strokeWidth: 1.6, roughness: 1.3, bowing: 1.2, seed: m.seed, ...extra });

  // 지금 쓰는 곳이 화면 아래(다그당스 자리)에 가리지 않게 따라 내려간다
  function follow(n) {
    const r = n.getBoundingClientRect();
    const limit = innerHeight - 150;
    if (r.bottom > limit) scrollBy({ top: r.bottom - limit, behavior: now() ? "auto" : "smooth" });
  }

  // ── 글자 쓰기 ──
  async function write(parent, text, { cls = "w", id, data = {}, speed } = {}) {
    const p = el("p", cls);
    if (id) p.id = id;
    for (const [k, v] of Object.entries(data)) if (v != null) p.dataset[k] = v;
    parent.append(p);
    if (now()) { p.textContent = text; follow(p); return p; }
    const node = document.createTextNode("");
    p.append(node, tip);
    const ms = speed ?? (/\bbody\b/.test(cls) ? 14 : 38);
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      if (now()) { node.data = text; break; }
      node.data += chars[i];
      if (i % 4 === 0) follow(p);
      await sleep(ms);
    }
    tip.remove();
    follow(p);
    return p;
  }

  // ── 연필 표시 ──
  function geometry(m) {
    const g = (() => {
      if (m.kind === "circle") { const b = rel(m.el); return rc.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w + 20, b.h + 10, opt(m)); }
      if (m.kind === "underline") {
        const range = document.createRange(); range.selectNodeContents(m.el);
        const last = [...range.getClientRects()].at(-1), b = box0();
        if (!last) return null;
        const y = last.bottom - b.top - 2;
        return rc.line(m.el.getBoundingClientRect().left - b.left, y, last.right - b.left, y, opt(m, { strokeWidth: 1.2 }));
      }
      if (m.kind === "box") { const b = rel(m.el); return rc.rectangle(b.x, b.y, b.w, b.h, opt(m)); }
      if (m.kind === "grid") {
        const b = rel(m.el), grp = document.createElementNS(SVGNS, "g");
        grp.append(rc.rectangle(b.x, b.y, b.w, b.h, opt(m, { strokeWidth: 1.2 })));
        const bb = box0();
        const head = m.el.querySelector(".h").getBoundingClientRect().bottom - bb.top;
        const mid = m.el.querySelectorAll(".c")[4].getBoundingClientRect().top - bb.top;
        const thin = opt({ ...m, color: INK.faint }, { strokeWidth: 1 });
        grp.append(rc.line(b.x, head, b.x + b.w, head, thin), rc.line(b.x, mid, b.x + b.w, mid, thin));
        for (let i = 1; i < 4; i++) grp.append(rc.line(b.x + (b.w * i) / 4, b.y, b.x + (b.w * i) / 4, b.y + b.h, thin));
        return grp;
      }
      if (m.kind === "bar") {
        const b = rel(m.el), W = Math.max(6, (m.n / 4) * (b.w - 4));
        return m.n ? rc.rectangle(b.x + 2, b.y + 3, W, b.h - 6, opt(m, { fill: m.color, fillStyle: "hachure", hachureGap: 3.2, fillWeight: 1.4, roughness: 1.4 })) : null;
      }
      if (m.kind === "arrow") {   // 여백에서 두 줄을 잇는 화살표(위 → 아래)
        const a = rel(m.el), z = rel(m.el2), grp = document.createElementNS(SVGNS, "g");
        const x = 26, y0 = a.y + a.h / 2, y1 = z.y + z.h / 2;
        grp.append(rc.curve([[a.x - 2, y0], [x - 6, y0 + 8], [x - 16, (y0 + y1) / 2], [x - 6, y1 - 8], [z.x - 4, y1]], opt(m, { strokeWidth: 2 })),
          rc.linearPath([[z.x - 14, y1 - 8], [z.x - 4, y1], [z.x - 14, y1 + 7]], opt(m, { strokeWidth: 2 })));
        return grp;
      }
      if (m.kind === "link") {   // 폴라로이드 → 노트 줄(빈 줄로 나와 본문 왼쪽 끝을 따라 내려간다)
        const a = rel(m.el), z = rel(m.el2), grp = document.createElementNS(SVGNS, "g");
        const x0 = a.x + 8, y0 = a.y + a.h - 16, xl = z.x - 8, y1 = z.y + z.h / 2;
        grp.append(rc.curve([[x0, y0], [xl + 30, y0 + 20], [xl, y0 + 36], [xl - 2, y1 - 14], [z.x - 2, y1]], opt(m)),
          rc.linearPath([[z.x - 11, y1 - 7], [z.x - 2, y1], [z.x - 11, y1 + 6]], opt(m)));
        return grp;
      }
      return null;
    })();
    if (g) g.dataset.mark = m.kind;
    return g;
  }
  async function mark(kind, target, { el2 = null, color = INK.pencil, n = 0 } = {}) {
    const m = { kind, el: target, el2, color, n, seed: seed++, g: null };
    marks.push(m);
    m.g = geometry(m);
    if (!m.g) return m;
    overlay.append(m.g);
    if (!now()) {
      const paths = [...m.g.querySelectorAll("path")];
      for (const p of paths) {
        const L = p.getTotalLength();
        p.style.setProperty("stroke-dasharray", `${L}`);
        p.style.setProperty("stroke-dashoffset", `${L}`);
      }
      m.g.getBoundingClientRect();
      for (const p of paths) {
        p.style.setProperty("transition", "stroke-dashoffset .5s ease-out");
        p.style.setProperty("stroke-dashoffset", "0");
      }
      await sleep(520);
    }
    return m;
  }

  // ── 여백 메모 ──
  function margin(text, at, { red = false } = {}) {
    const m = el("div", `mg${red ? " red" : ""}`, text);
    page.append(m);
    margins.push({ m, at });
    placeMargin(margins.at(-1));
    return m;
  }
  function placeMargin({ m, at }) { m.style.setProperty("top", `${rel(at).y}px`); }

  // ── 폴라로이드 ──
  function placePola(p) {
    p.card.style.setProperty("top", "0px");
    const c = p.card.getBoundingClientRect();
    const lines = Math.ceil((c.height + 16) / LINE);
    p.space.style.setProperty("height", `${lines * LINE}px`);
    const top = rel(p.space).y;
    p.card.style.setProperty("top", `${top + (lines * LINE - c.height) / 2 + (p.card.offsetHeight - c.height) / 2}px`);
  }
  async function polaroid(parent, inner, { caption = "", tilt = 4, x = "right", id } = {}) {
    const space = el("div", "pola-space");
    parent.append(space);
    const card = el("figure", `pola ${x}`);
    if (id) card.id = id;
    card.style.setProperty("--tilt", `${tilt}deg`);
    const cap = el("figcaption", "cap");
    card.append(el("span", "tape"), inner, cap);
    page.append(card);
    const p = { space, card, cap };
    polas.push(p);
    placePola(p);
    follow(space);
    if (!now()) { card.classList.add("drop"); await sleep(380); }
    await setCaption(p, caption);
    return p;
  }
  async function setCaption(p, text) {
    p.cap.textContent = "";
    if (now()) { p.cap.textContent = text; return; }
    const node = document.createTextNode("");
    p.cap.append(node, tip);
    for (const ch of text) { if (now()) { node.data = text; break; } node.data += ch; await sleep(45); }
    tip.remove();
  }

  // ── 사진 크게 보기 ── 폴라로이드 속 사진·카드(zoomable 로 표시한 것)를 누르면 화면 가득 띄운다.
  // 다시 누르거나(사진 위든 바깥이든) 닫기·Esc 로 닫힌다. 크기는 CSS(.zoom)만 — style 속성 없이.
  let zoomed = null;
  function zoomable(node, label) {
    node.classList.add("zoomable");
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${label} 크게 보기`);
    return node;
  }
  function zoomOpen(src) {
    zoomClose(false);
    const box = el("div", "zoom");
    box.id = "zoom";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", src.getAttribute("aria-label") || "크게 보기");
    let big;
    if (src.tagName === "CANVAS") {   // 손바닥 사진은 기기 밖으로 내보내지 않는다 — 주소 없이 그림만 옮겨 그린다
      big = document.createElement("canvas");
      big.width = src.width; big.height = src.height;
      big.getContext("2d").drawImage(src, 0, 0);
    } else {
      big = document.createElement("img");
      big.src = src.currentSrc || src.src;
      big.alt = src.alt || "";
    }
    big.className = `zoom-img${src.classList.contains("rev") ? " rev" : ""}`;
    const close = el("button", "zoom-close", "닫기");
    close.type = "button";
    box.append(big, close);
    box.addEventListener("click", (e) => { e.stopPropagation(); zoomClose(); });
    document.body.append(box);
    document.documentElement.classList.add("zoom-on");
    close.focus({ preventScroll: true });
    zoomed = { box, src };
  }
  function zoomClose(refocus = true) {
    if (!zoomed) return;
    const { box, src } = zoomed;
    zoomed = null;
    box.remove();
    document.documentElement.classList.remove("zoom-on");
    if (refocus && src.isConnected) src.focus({ preventScroll: true });
  }
  page.addEventListener("click", (e) => { const z = e.target.closest(".zoomable"); if (z) zoomOpen(z); });
  page.addEventListener("keydown", (e) => {
    const z = e.target.closest?.(".zoomable");
    if (z && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); zoomOpen(z); }
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") zoomClose(); });

  // ── 동그라미 고르기 ── options: [{value, label}], preset 이 있으면(다시 펼치기) 바로 그 자리에 동그라미
  async function choose(parent, options, { preset, skip = null, cls = "" } = {}) {
    const row = el("div", `opts ${cls}`);
    const all = [...options, ...(skip ? [{ value: null, label: skip, skip: true }] : [])];
    const btns = all.map((o) => {
      const b = el("button", `opt${o.skip ? " skip" : ""}`, o.label);
      b.type = "button";
      b.dataset.value = o.value ?? "";
      row.append(b);
      return b;
    });
    parent.append(row);
    follow(row);
    let picked;
    if (preset !== undefined) picked = all.find((o) => (o.value ?? null) === preset) ?? all.at(-1);
    else {
      fast = false;
      picked = await new Promise((resolve) => btns.forEach((b, i) => b.addEventListener("click", () => resolve(all[i]), { once: true })));
    }
    const i = all.indexOf(picked);
    for (const b of btns) { b.disabled = true; if (b !== btns[i]) b.classList.add("not"); }
    btns[i].classList.add("picked");
    await mark("circle", btns[i], { color: INK.blue });
    return picked.value ?? null;
  }

  // ── 다시 그리기(글꼴이 늦게 오거나 화면 크기가 바뀌면) ──
  function relayout() {
    // 놓인 줄이 걷혀 나간 폴라로이드·여백 메모는 같이 치운다(손바닥 사진 바꾸기)
    for (let i = polas.length - 1; i >= 0; i--) if (!polas[i].space.isConnected) { polas[i].card.remove(); polas.splice(i, 1); }
    for (let i = margins.length - 1; i >= 0; i--) if (!margins[i].at.isConnected) { margins[i].m.remove(); margins.splice(i, 1); }
    for (const p of polas) if (p.card.isConnected) placePola(p);
    for (const m of margins) placeMargin(m);
    for (const m of marks) {
      if (!m.g) continue;
      if (!m.el.isConnected || (m.el2 && !m.el2.isConnected)) { m.g.remove(); m.g = null; continue; }
      const g = geometry(m);
      if (g) { m.g.replaceWith(g); m.g = g; }
    }
  }
  let pending = 0;
  const soon = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(relayout); };
  document.fonts?.addEventListener?.("loadingdone", soon);
  addEventListener("resize", soon);

  function face(name) {
    const f = faces[name];
    if (faceImg && f) { faceImg.src = f.src; faceImg.width = f.w; faceImg.height = f.h; faceImg.dataset.face = name; }
  }

  return {
    write, mark, margin, polaroid, setCaption, choose, relayout, face, follow, sleep, zoomable, zoomClose,
    get instant() { return instant; }, set instant(v) { instant = v; if (!v) fast = false; },
    get fast() { return fast; }, set fast(v) { fast = v; if (v) wake?.(); },
    hold() { fast = false; },          // 사용자 입력을 기다릴 때 — 다음 글은 다시 천천히
  };
}
