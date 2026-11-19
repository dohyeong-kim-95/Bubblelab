// 다그당스 상담 노트 — fortune.bubblelab.dev 첫 화면(M4 v2). 역술가가 노트에 실시간으로 써 주는 순서(스크립트, LLM 없음):
//   맞이 → 오늘 궁금한 것 → 타로 한 장 → 생일 → 사주(명식 표·오행 막대·특성) → 손바닥(폴라로이드 + 선) → 종합(형광펜·화살표)
//   → 마무리 + "더 볼까요?"(대운·올해 토정·빠뜨린 칸). 어느 단계든 "다음에 할래요"로 건너뛰고, 건너뛴 칸은 마무리에서 다시 고를 수 있다.
//
// 값은 엔진에서만: 특성·겹침·모순 제외는 lib/note.js, 사주 특성은 /_fortune/chart 의 note(saju-traits), 타로는 lib/tarot.js,
// 손금은 /_fortune/palm/*, 대운은 차트의 lifeCurve, 토정은 tojeong/<괘>.json. 문구는 lib/consult-text.js 한 곳.
// 노트 안 특성 문장끼리 모순 0건 — 손금 줄은 사주와 부딪치지 않는 것(note.js 가 고른 카드)만 쓴다.
//
// 저장은 이 기기만(서버 보관 없음):
//   bl-fortune-birth · bl-fortune-palm(traits + 선별 요약 lines — 사진·좌표 없음) · bl-fortune-tarot-last(7일) — 운세 값
//   bl-fortune-page {v, date, log:[{k, v}]} — 그날 페이지에서 고른 것만(주제·카드 id·건너뜀·더 볼 것). 다시 오면 이 기록으로
//   지난 페이지를 그대로 펼치고(바로 다 쓴 상태) 그 아래에 이어 쓴다.
import { assembleNote, palmTraits, tarotStates, josa, excludedIdsOf } from "../lib/note.js";
import { palmLineSummary, palmLineView, readSummary, clashes } from "../lib/palm-lines.js";
import { TRAITS } from "../lib/traits.js";
import { CARDS, DECKS, deckReady, SPREADS as TAROT_SPREADS, POSITIONS as TAROT_POSITIONS, TOPICS as TAROT_TOPICS, readTarot, drawDeck, cryptoRandomInt, addDays } from "../lib/tarot.js";
import { LOG_KEY, PREF_KEY, addToLog, logEntry, readPref } from "../lib/tarot-log.js";   // 지난 카드 30일·역방향 설정은 타로 탭과 같이 쓴다
import { T, TOPICS, SKIP, STATE_TIP, NO_STATE_TIP, birthWhen } from "../lib/consult-text.js";
import { DANGI_BASE, DANGI_FACES } from "../lib/dangi-art.js";
import { deckForDangi, loadDangi, saveDangi } from "../lib/prefs.js";
import { yearReading, MONTH_NAMES } from "../tojeong-reading.js";
import { drawLines, preparePhoto, shrink, palmStatus, submitPalm, waitPalm, PALM_MSG } from "../palm/palm.js";
import { createPen, el, INK, ELEMENT_INK } from "./pen.js";

const DESK = 22;   // 상담 노트 책상에 펼치는 카드 수
const KEY = { birth: "bl-fortune-birth", palm: "bl-fortune-palm", tarot: "bl-fortune-tarot-last", page: "bl-fortune-page" };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 이번 화면은 쓴다 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};
const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const page = document.getElementById("page");
const faceImg = document.getElementById("dg");
const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const faces = Object.fromEntries(Object.entries(DANGI_FACES).map(([k, f]) => [k, { src: DANGI_BASE + f.file, w: f.w, h: f.h }]));
const pen = createPen(page, { motion, faceImg, faces });

// 다그당스(당이) 켜기/끄기 — 기본 켜짐, 이 기기에 기억(탭 화면 /note/ 와 같은 키, lib/prefs.js).
// 당이 끄기 = 당이 없는 화면 전체(2026-11-17): 곁 그림을 숨기고(html.dg-off) 타로 카드도 1909 옛 그림 덱으로 뽑는다.
// 스위치는 당이 그림 자리와 떨어진 왼쪽 아래에 고정 — 켜고 꺼도 자리가 그대로다(예전엔 꺼지면 오른쪽 끝으로 옮겨 갔다).
// 이미 그린 카드가 있으면 다시 펼친다(이 노트는 기록에서 그대로 다시 그려진다) — 그림·그림 묘사가 바뀐 덱으로 남지 않게.
let dangi = true;
function dangiSwitch() {
  dangi = loadDangi();
  const btn = el("button", "dg-toggle", T.dangiSwitch);
  btn.type = "button";
  btn.id = "dg-toggle";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-label", T.dangiSwitchLabel);
  const apply = () => { document.documentElement.classList.toggle("dg-off", !dangi); btn.setAttribute("aria-checked", String(dangi)); };
  apply();
  btn.addEventListener("click", () => {
    dangi = !dangi;
    apply();
    saveDangi(dangi);
    if (page.querySelector(".pola-card")) location.reload();
  });
  document.body.append(btn);
}

// ── 운세 값(기기 저장 + 차트) ──
let chartP = null;
function chart() {
  const birth = store.get(KEY.birth);
  if (!birth?.y) return Promise.resolve(null);
  chartP ??= fetch("/_fortune/chart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(window.blFortuneChartBody(birth)) })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.note) throw new Error(res.status === 429 ? T.err.rate : T.err.chart);
      return data;
    });
  return chartP;
}
const palmList = () => { const p = store.get(KEY.palm); return p ? palmTraits(p) : null; };
const palmSum = () => readSummary(store.get(KEY.palm)?.lines);   // 옛 저장(traits 만)이면 null
// rev = 거꾸로 나온 카드(v4). 옛 기록(reversed 없음)은 정방향.
function tarotRead(id, date, rev = false) {
  const order = [id, ...CARDS.map((c) => c.id).filter((x) => x !== id)];
  return readTarot({ spread: "one", order, picks: [0], date, flips: order.map((_, i) => (rev && i === 0 ? 1 : 0)), deck: tarotDeck() });
}
// 카드 그림 덱은 당이 켜기/끄기가 정한다(끄면 1909 옛 그림) — 타로 탭의 덱 체크와 같은 값 하나. 덱은 그림·그림 묘사만 바꾼다.
const tarotDeck = () => deckForDangi(dangi, deckReady("classic"));
// 책상에서 뽑은 카드 값: "maj_03" 또는 거꾸로면 "maj_03:r"(페이지 기록에 남는 값 — 옛 기록은 id 만)
const cardVal = (id, rev) => (rev ? `${id}:r` : id);
const parseCard = (v) => ({ id: String(v).replace(/:r$/, ""), rev: /:r$/.test(String(v)) });
const tarotPref = () => readPref(store.get(PREF_KEY));
const logTarot = (read) => { if (read?.cards?.length) store.set(LOG_KEY, addToLog(store.get(LOG_KEY), logEntry(read), todayISO())); };
function tarotValid() {
  const t = store.get(KEY.tarot);
  if (!t?.card_id || !CARDS.some((c) => c.id === t.card_id)) return null;
  if (t.valid_until && t.valid_until < todayISO()) { store.del(KEY.tarot); return null; }
  return t;
}
const tarotList = () => { const t = tarotValid(); return t ? tarotStates(tarotRead(t.card_id, t.date, t.reversed === true), todayISO()) : null; };

// ── 페이지 기록(다시 펼치기) ──
class Page {
  constructor(date, log, live) { this.date = date; this.log = log; this.i = 0; this.live = live; this.drawn = {}; }
  // kind 의 기록이 있으면 그 값(다시 펼치기), 없으면 undefined — 그때부터는 새로 묻는다
  next(kind) {
    if (this.i < this.log.length && this.log[this.i].k === kind) return this.log[this.i++].v;
    if (!this.live) throw new EndOfPage();                       // 지난 페이지는 기록이 끝난 데서 멈춘다
    if (this.i < this.log.length) this.log.length = this.i;   // 순서가 어긋나면 거기서부터 새로
    pen.instant = !motion;
    return undefined;
  }
  put(kind, v) { this.log.push({ k: kind, v }); this.i = this.log.length; if (this.live) store.set(KEY.page, { v: 1, date: this.date, log: this.log }); }
}
class EndOfPage extends Error {}
// 물음 하나: 기록이 있으면 그 답으로 바로 그리고(동그라미까지), 없으면 그려 놓고 기다린다. draw(preset) — preset 이 undefined 면 새로 묻는다.
async function ask(pg, kind, draw) {
  const v = pg.next(kind);
  if (v !== undefined) { await draw(v); return { v, replay: true }; }
  const got = await draw(undefined);
  pg.put(kind, got);
  return { v: got, replay: false };
}

// 개인정보처리방침 — 원본은 이 노트 옆 privacy/(fortune.bubblelab.dev/privacy/)
function privacyLink(id) {
  const p = el("p", "body small privacy");
  const a = el("a", "link small", T.privacy);
  a.href = "privacy/";
  a.id = id;
  p.append(a);
  return p;
}

// ── 장면 ──
function section(cls = "") { const s = el("section", `nb-block ${cls}`); page.append(s); return s; }
const sep = (b) => b.append(el("hr", "sep"));

async function greet(pg, first, prevDate) {
  const b = section();
  const d = new Date(`${pg.date}T00:00`);
  pen.margin(`${md(pg.date)}\n(${WEEK[d.getDay()]})`, b);
  pen.face("wave");
  if (prevDate) await pen.write(b, prevDate === pg.date ? T.againSame : T.again(md(prevDate)));
  else {
    for (const line of T.hello) await pen.write(b, line);
    if (first) await pen.write(b, T.tapHint, { cls: "body small faint" });
  }
}

async function topic(pg, again) {
  const b = section();
  pen.face("think");
  await pen.write(b, again ? T.topicAgain : T.topicAsk);
  const { v } = await ask(pg, "topic", (preset) => pen.choose(b, TOPICS.map((t) => ({ value: t.id, label: t.label })), { skip: SKIP, preset }));
  const tp = TOPICS.find((t) => t.id === v);
  await pen.write(b, tp ? T.topicPicked(tp.label) : T.topicSkipped);
  return tp;
}

// 타로 — 책상 위에 섞어 둔 22장에서 한 장
async function tarot(pg, tp) {
  const b = section();
  sep(b);
  const kept = tarotValid();
  if (kept && kept.date < pg.date) {
    pen.face("peek");
    const until = md(kept.valid_until);
    const p = await pen.write(b, T.tarotKept(CARDS.find((c) => c.id === kept.card_id).name, until));
    p.dataset.state = tarotStates(tarotRead(kept.card_id, kept.date, kept.reversed === true), todayISO())[0]?.trait ?? "";
    return { kept: true };
  }
  pen.face("peek");
  await pen.write(b, T.tarotAsk);
  if (tp && tp.id !== "today") await pen.write(b, T.tarotFor(tp.label), { cls: "w s" });
  const { v } = await ask(pg, "tarot", async (preset) => {
    // 78장을 섞어 위에서 22장을 펼친다(두 줄 × 11 — 폰 폭에 맞는 장수). 섞기가 고르므로 어느 카드든 나올 확률은 같다.
    // 정/역도 섞을 때 함께 정한다(타로 탭의 '거꾸로 나온 카드도 읽기' 설정을 따른다).
    const deck = drawDeck((n) => cryptoRandomInt(n), { reversals: tarotPref().reversals });
    const order = deck.order.slice(0, DESK), flips = deck.flips.slice(0, DESK);
    const pre = preset ? parseCard(preset).id : null;
    if (pre && !order.includes(pre)) order[0] = pre;   // 다시 펼치기: 그날 뽑은 카드 자리를 비워 보이게
    const desk = el("div", "desk");
    const backs = order.map((_, i) => {
      const c = el("button", "back");
      c.type = "button";
      c.setAttribute("aria-label", `${i + 1}번째 카드`);
      c.style.setProperty("--i", String(i % 11));
      c.style.setProperty("--row", String(Math.floor(i / 11)));
      desk.append(c);
      return c;
    });
    const skip = el("button", "opt skip", SKIP);
    skip.type = "button";
    const row = el("div", "opts"); row.append(skip);
    b.append(desk, row);
    pen.follow(row);
    if (preset !== undefined) {   // 다시 펼치기: 뽑은 자리만 비운다
      for (const c of backs) c.disabled = true;
      row.remove();
      if (preset === null) desk.classList.add("put-away"); else backs[order.indexOf(pre)].classList.add("gone");
      return preset;
    }
    pen.hold();
    const i = await new Promise((resolve) => {
      backs.forEach((c, k) => c.addEventListener("click", () => resolve(k), { once: true }));
      skip.addEventListener("click", () => resolve(-1), { once: true });
    });
    for (const c of backs) c.disabled = true;
    skip.disabled = true;
    if (i < 0) { row.remove(); desk.classList.add("put-away"); return null; }
    backs[i].classList.add("gone");
    row.remove();
    return cardVal(order[i], flips[i] === 1);
  });
  if (!v) { pen.face("think"); await pen.write(b, T.tarotSkipped); return { skipped: true }; }
  const date = pg.date;
  const got = parseCard(v);
  const read = tarotRead(got.id, date, got.rev);
  const c = read.cards[0];
  if (pg.live && !(tarotValid()?.card_id === got.id && tarotValid()?.date === date)) {
    store.set(KEY.tarot, { date, spread: "one", card_id: c.id, position: c.position, reversed: c.reversed, valid_until: read.valid_until });
    logTarot(read);
  }
  const img = el("img", `pola-card${c.reversed ? " rev" : ""}`);
  img.src = c.image; img.alt = `${c.name} 카드`; img.width = DECKS[read.deck].size.w; img.height = DECKS[read.deck].size.h;
  pen.zoomable(img, `${c.name} 카드`);
  await pen.polaroid(b, img, { caption: T.tarotCaption(c.name, md(date)), tilt: 5, id: "pola-tarot" });
  await pen.write(b, T.tarotGot(c.roman, c.name, josa(c.name, "이", "가"), c.reversed), { data: { orientation: c.orientation } });
  await pen.write(b, c.text, { cls: "body" });
  if (c.reassure) await pen.write(b, c.reassure, { cls: "body small" });
  const state = tarotStates(read, date)[0];   // 지난 페이지는 그 페이지 날짜 기준(그날의 '요즘')
  // '요즘'으로 읽을 흐름이 없는 카드(마이너 일부)는 억지로 만들지 않는다 — 풀이만 쓰고 넘어간다
  if (!state) { pg.drawn.tarot = true; return { card: c.id }; }
  const now = await pen.write(b, T.tarotNow(state.label), { id: "tarot-now", data: { state: state.trait } });
  pen.margin(T.tarotMargin(md(read.valid_until)), now, { red: true });
  await pen.mark("underline", now);
  pg.drawn.tarot = true;
  return { card: c.id };
}

// 세 장으로 더 보기 — 주제가 연애·일이면 마무리의 "더 볼까요?"에 나온다(마음 3장 / 지금·걸림·한 걸음).
// 노트에는 세 장을 한 폴라로이드에 붙이고 자리마다 한 줄 + 풀이, 카드 잇기 한 줄. '요즘'(state)은 처음 한 장 그대로 하나만 —
// 세 장은 state 를 더하지 않는다(research-v2 §6 B안). 기록 값 { s: 스프레드, ids, rev } — 다시 펼치면 같은 카드.
async function tarot3(pg, spreadId) {
  const b = section();
  sep(b);
  pen.face("peek");
  const { v } = await ask(pg, "tarot3", async (preset) => {
    const sp = TAROT_SPREADS[preset?.s ?? spreadId];
    await pen.write(b, T.tarot3Lead(sp.short ?? sp.label));
    await pen.write(b, sp.sub, { cls: "body small faint" });
    if (preset !== undefined) return preset;
    const deck = drawDeck((n) => cryptoRandomInt(n), { reversals: tarotPref().reversals });
    const order = deck.order.slice(0, DESK), flips = deck.flips.slice(0, DESK);
    const desk = el("div", "desk");
    const backs = order.map((_, i) => {
      const c = el("button", "back");
      c.type = "button";
      c.setAttribute("aria-label", `${i + 1}번째 카드`);
      c.style.setProperty("--i", String(i % 11));
      c.style.setProperty("--row", String(Math.floor(i / 11)));
      desk.append(c);
      return c;
    });
    const guide = el("p", "w s", "");
    guide.id = "tarot3-guide";
    const skip = el("button", "opt skip", SKIP);
    skip.type = "button";
    const row = el("div", "opts"); row.append(skip);
    b.append(guide, desk, row);
    pen.follow(row);
    pen.hold();
    const picked = [];
    for (const pos of sp.positions) {
      guide.textContent = T.tarot3Pick(TAROT_POSITIONS[pos].label);
      const ctl = new AbortController();   // 이 자리의 물음이 끝나면 듣던 손을 모두 거둔다
      const i = await new Promise((resolve) => {
        backs.forEach((c, k) => c.addEventListener("click", () => resolve(k), { signal: ctl.signal }));
        skip.addEventListener("click", () => resolve(-1), { signal: ctl.signal });
      });
      ctl.abort();
      if (i < 0) { for (const c of backs) c.disabled = true; row.remove(); guide.remove(); desk.classList.add("put-away"); return null; }
      picked.push(i);
      backs[i].classList.add("gone");
      backs[i].disabled = true;
    }
    for (const c of backs) c.disabled = true;
    row.remove(); guide.remove();
    return { s: sp.id, ids: picked.map((i) => order[i]), rev: picked.map((i) => flips[i]) };
  });
  if (!v) { pen.face("think"); await pen.write(b, T.tarot3Skipped); return { skipped: true }; }
  const rest = CARDS.map((c) => c.id).filter((id) => !v.ids.includes(id));
  const order = [...v.ids, ...rest];
  const read = readTarot({ spread: v.s, order, picks: [0, 1, 2], flips: order.map((_, i) => (i < 3 ? v.rev[i] : 0)), date: pg.date, deck: tarotDeck() });
  if (pg.live) logTarot(read);
  const tri = el("div", "pola-tri");
  for (const c of read.cards) {
    const img = el("img", `pola-card sm${c.reversed ? " rev" : ""}`);
    img.src = c.image; img.alt = `${c.name} 카드${c.reversed ? "(거꾸로)" : ""}`; img.width = DECKS[read.deck].size.w; img.height = DECKS[read.deck].size.h;
    pen.zoomable(img, img.alt);
    tri.append(img);
  }
  await pen.polaroid(b, tri, { caption: T.tarotCaption(TAROT_SPREADS[v.s].short ?? TAROT_SPREADS[v.s].label, md(pg.date)), tilt: -3, x: "mid", id: "pola-tarot3" });
  for (const c of read.cards) {
    await pen.write(b, T.tarot3Card(TAROT_POSITIONS[c.position].label, c.name, c.reversed), { cls: "w s", data: { pos: c.position, id: c.id, orientation: c.orientation } });
    await pen.write(b, c.text, { cls: "body", data: { pos: c.position } });
  }
  if (read.flow.texts[0]) await pen.write(b, read.flow.texts[0], { id: "tarot3-flow" });
  await pen.write(b, read.texts.closing, { cls: "body small" });
  return { cards: read.cards.map((c) => c.id) };
}

// 생일 — 노트 줄 끝 빈칸에 바로 적는다. 다 적으면 "다 적었어요"에 동그라미.
function birthBlanks(b, preset) {
  const box = el("div", "fill");
  const cal = el("div", "fillrow small-opts");
  let calendar = preset?.calendar === "lunar" ? "lunar" : "solar";
  const calBtns = [["solar", "양력"], ["lunar", "음력"]].map(([v, label]) => {
    const x = el("button", "opt mini", label); x.type = "button"; x.dataset.cal = v; x.setAttribute("aria-pressed", String(v === calendar)); cal.append(x); return x;
  });
  const leap = el("label", "mini leap"); const leapBox = el("input"); leapBox.type = "checkbox"; leapBox.checked = preset?.lunarLeap === true;
  leap.append(leapBox, " 윤달"); leap.hidden = calendar !== "lunar"; cal.append(leap);
  for (const x of calBtns) x.addEventListener("click", () => { calendar = x.dataset.cal; for (const y of calBtns) y.setAttribute("aria-pressed", String(y === x)); leap.hidden = calendar !== "lunar"; });
  const inp = (label, max, cls = "") => { const i = el("input", `bl ${cls}`); i.inputMode = "numeric"; i.maxLength = max; i.autocomplete = "off"; i.setAttribute("aria-label", label); i.addEventListener("input", () => { i.value = i.value.replace(/\D/g, "").slice(0, max); }); return i; };
  const y = inp("태어난 해", 4, "w4"), m = inp("월", 2), d = inp("일", 2);
  const row1 = el("div", "fillrow"); row1.append(y, "년", m, "월", d, "일");
  const hh = inp("시", 2), mm = inp("분", 2);
  const unknown = el("button", "opt mini", T.birthTimeUnknown); unknown.type = "button"; unknown.setAttribute("aria-pressed", "false");
  unknown.addEventListener("click", () => { const on = unknown.getAttribute("aria-pressed") !== "true"; unknown.setAttribute("aria-pressed", String(on)); hh.disabled = mm.disabled = on; });
  const row2 = el("div", "fillrow"); row2.append(`${T.birthTime} `, hh, "시", mm, "분 ", unknown);
  const confirm = el("div", "opts confirm");
  const ok = el("button", "opt", T.birthDone); ok.type = "button";
  const skip = el("button", "opt skip", SKIP); skip.type = "button";
  confirm.append(ok, skip);
  box.append(cal, row1, row2, confirm);
  b.append(box);
  if (preset) {
    y.value = preset.y; m.value = preset.m; d.value = preset.d;
    if (preset.timeMode === "clock" && preset.time) { hh.value = +preset.time.slice(0, 2); mm.value = +preset.time.slice(3, 5); } else unknown.setAttribute("aria-pressed", "true");
  }
  const read = () => {
    const now = new Date();
    const yy = +y.value, mo = +m.value, dd = +d.value;
    if (!(yy >= 1920 && yy <= now.getFullYear())) return { error: T.err.year(now.getFullYear()) };
    if (!(mo >= 1 && mo <= 12)) return { error: T.err.month };
    const days = calendar === "lunar" ? 30 : new Date(yy, mo, 0).getDate();
    if (!(dd >= 1 && dd <= days)) return { error: T.err.day(mo, days) };
    if (calendar === "solar" && new Date(yy, mo - 1, dd) > now) return { error: T.err.future };
    let time = null;
    if (unknown.getAttribute("aria-pressed") !== "true" && hh.value !== "") {
      const h = +hh.value, mi = mm.value === "" ? 0 : +mm.value;
      if (!(h >= 0 && h <= 23) || !(mi >= 0 && mi <= 59)) return { error: T.err.time };
      time = `${pad(h)}:${pad(mi)}`;
    }
    const hr = time ? +time.slice(0, 2) : null;
    const branch = time ? (hr === 23 || hr === 0 ? 0 : Math.floor((hr + 1) / 2)) : null;
    return { birth: { y: yy, m: mo, d: dd, calendar, lunarLeap: calendar === "lunar" && leapBox.checked, gender: "unspecified", timeMode: time ? "clock" : "branch", h: branch, time } };
  };
  const lock = () => { for (const i of box.querySelectorAll("input, button")) i.disabled = true; };
  const wait = () => new Promise((resolve) => {
    ok.addEventListener("click", () => resolve("done"), { once: true });
    skip.addEventListener("click", () => resolve(null), { once: true });
  });
  return { box, ok, skip, read, lock, wait };
}

async function birth(pg, hadCard) {
  const b = section();
  const known = store.get(KEY.birth);
  if (known?.y && pg.drawn.sajuOld) { pen.face("cal"); await pen.write(b, T.birthKept(birthWhen(known))); await pen.write(b, T.sajuKept); return { kept: true }; }
  const prior = pg.next("birth");
  pen.face("wait");
  await pen.write(b, hadCard ? T.birthLead : T.birthLeadNoCard);
  await pen.write(b, T.birthAsk);
  if (prior === null) {   // 다시 펼치기: 건너뛴 자리
    const bl = birthBlanks(b, null); bl.lock(); bl.box.classList.add("not");
    await pen.mark("circle", bl.skip, { color: INK.blue });
    await pen.write(b, T.birthSkipped);
    return { skipped: true };
  }
  if (known?.y) {   // 생일은 안다 — 적힌 빈칸으로 보여 주고 바로 명식
    const bl = birthBlanks(b, known); bl.lock();
    await pen.mark("circle", bl.ok, { color: INK.blue });
    if (prior === undefined) pg.put("birth", "given");
    return saju(b, known, pg);
  }
  const bl = birthBlanks(b, null);
  pen.follow(bl.box);
  let errLine = null;
  for (;;) {
    pen.hold();
    const v = await bl.wait();
    errLine?.remove(); errLine = null;
    if (v === null) {
      bl.lock(); bl.box.classList.add("not");
      await pen.mark("circle", bl.skip, { color: INK.blue });
      pg.put("birth", null);
      await pen.write(b, T.birthSkipped);
      return { skipped: true };
    }
    const { birth: got, error } = bl.read();
    if (error) { errLine = await pen.write(b, error, { cls: "w s err" }); continue; }
    store.set(KEY.birth, got);
    chartP = null;
    bl.lock();
    const busy = await pen.write(b, T.birthBusy, { cls: "body small faint" });
    try {
      await chart();
    } catch (e) {
      busy.remove();
      store.del(KEY.birth);
      chartP = null;
      for (const i of bl.box.querySelectorAll("input, button")) i.disabled = false;
      errLine = await pen.write(b, e.message, { cls: "w s err" });
      continue;
    }
    busy.remove();
    await pen.mark("circle", bl.ok, { color: INK.blue });
    pg.put("birth", "given");
    return saju(b, got, pg);
  }
}

// 사주 — 명식을 표로 긋고, 오행을 칠하며, 특성을 써 준다
async function saju(b, birthV, pg) {
  pen.face("cal");
  sep(b);
  let data;
  try { data = await chart(); } catch (e) { await pen.write(b, e.message, { cls: "w s err" }); return { error: true }; }
  const c0 = data.candidates[0];
  await pen.write(b, T.sajuStart(birthWhen(birthV)));
  const grid = el("div", "mj");
  const cols = [["시", "hour"], ["일", "day"], ["월", "month"], ["년", "year"]];
  for (const [h] of cols) grid.append(el("div", "h", h));
  const cells = {};
  for (const row of ["stem", "branch"]) for (const [, k] of cols) {
    const p = c0.pillars[k];
    const cell = el("div", `c${k === "day" && row === "stem" ? " me" : ""}`);
    if (p) cell.append(row === "stem" ? p.stem.hanja : p.branch.hanja, el("small", null, row === "stem" ? p.stem.korean : p.branch.korean));
    else cell.append("?", el("small", null, "모름"));
    grid.append(cell);
    cells[`${k}-${row}`] = cell;
  }
  b.append(grid);
  pen.follow(grid);
  await pen.mark("grid", grid);
  await pen.mark("circle", cells["day-stem"], { color: INK.red });
  const dm = c0.reading.dayMaster;
  await pen.write(b, T.sajuMe(dm.name, dm.image));
  const counts = c0.reading.elements.counts;
  const bars = el("div", "ohaeng");
  const rows = [];
  for (const e of ["목", "화", "토", "금", "수"]) {
    const r = el("div", "orow");
    const holder = el("span", "obar");
    r.append(el("span", null, e), holder, el("span", null, String(counts[e])));
    bars.append(r);
    rows.push([e, holder, r]);
  }
  b.append(bars);
  pen.follow(bars);
  for (const [e, holder] of rows) await pen.mark("bar", holder, { color: ELEMENT_INK[e], n: counts[e] });
  const excess = c0.reading.elements.excess;
  if (excess?.length) pen.margin(T.manyMargin(excess.join("·")), rows.find(([e]) => e === excess[0])[2], { red: true });
  const n = assembleNote({ saju: data.note });
  await pen.write(b, T.sajuBase);
  if (!n.cards.length) {
    await pen.write(b, T.sajuNoCards, { cls: "w s" });
    const line = n.lines.find((l) => l.source === "saju");
    if (line?.id) { const p = await pen.write(b, `· ${TRAITS[line.id].label}`, { cls: "w trait", data: { trait: line.id, src: "saju" } }); await pen.mark("underline", p); }
  }
  for (const c of n.cards) {
    const p = await pen.write(b, `· ${c.label}`, { cls: "w trait", id: `saju-${c.trait}`, data: { trait: c.trait, src: "saju" } });
    await pen.mark("underline", p);
  }
  if (data.note.hour_known === false) await pen.write(b, T.sajuHourHint, { cls: "body small faint" });
  pg.drawn.saju = true;
  return { ok: true };
}

// 손바닥 — 노트 위 폴라로이드(카메라 미리보기 → 찍은 사진 + 선), 그 아래 줄에 선 → 특성
async function palm(pg, openP) {
  const b = section("palm-sec");
  sep(b);
  const kept = palmList();
  const prior = pg.next("palm");
  if (kept && (pg.drawn.palmOld || prior === "yes")) {
    pg.drawn.palm = true;
    // 지난 페이지에 적은 손금을 오늘 다시 쓰지 않는 칸 — 그래도 사진 바꾸기 진입점은 둔다(지난 페이지 자체엔 없음)
    if (pg.drawn.palmOld) { pen.face("think"); await pen.write(b, T.palmKept); return withRedo(b, pg, { kept: true }); }
    await pen.write(b, T.palmKept, { cls: "w s" });
    return withRedo(b, pg, palmLines(b, kept, null, palmSum()));
  }
  if (prior === null) { await pen.write(b, T.palmAsk); await pen.choose(b, [{ value: "yes", label: T.palmYes }], { preset: null, skip: SKIP }); await pen.write(b, T.palmSkipped); return { skipped: true }; }
  if (kept) {   // 손금은 봤는데 이 페이지엔 아직 안 적었다
    pg.put("palm", "yes");
    await pen.write(b, T.palmKept, { cls: "w s" });
    return withRedo(b, pg, palmLines(b, kept, null, palmSum()));
  }
  const open = await openP;
  pen.face("think");
  if (!open) { await pen.write(b, T.palmRest); return { rest: true }; }
  await pen.write(b, T.palmAsk);
  await pen.write(b, T.palmConsent, { cls: "body small" });
  b.append(privacyLink("palm-privacy"));
  const v = await pen.choose(b, [{ value: "yes", label: T.palmYes }], { skip: SKIP });
  if (v === null) { pg.put("palm", null); await pen.write(b, T.palmSkipped); return { skipped: true }; }
  for (;;) {
    const got = await shootPalm(b);
    if (got.skip) { pg.put("palm", null); await pen.write(b, T.palmSkipped); return { skipped: true }; }
    if (got.result) {
      savePalm(got.result);
      pg.put("palm", "yes");
      return withRedo(b, pg, palmLines(b, palmList() ?? [], got.pola, palmSum()));
    }
    await pen.write(b, got.error, { cls: "w s err" });
    const again = await pen.choose(b, [{ value: "again", label: T.palmRetry }], { skip: SKIP });
    if (again === null) { pg.put("palm", null); await pen.write(b, T.palmSkipped); return { skipped: true }; }
  }
}

// 읽은 손금을 기기에 — 사진·선 좌표 없이 특성과 선별 요약만. 새로 읽으면 옛 것을 통째로 바꾼다.
function savePalm(r) {
  store.set(KEY.palm, { schema: "bl-fortune-palm.v1", saved_at: new Date().toISOString(), hand: r.hand?.detected ?? null, status: "ok",
    traits: (r.traits || []).map((t) => ({ trait: t.trait, confidence: t.confidence, evidence: Array.isArray(t.evidence) ? t.evidence.slice(-1) : [] })),
    lines: palmLineSummary(r) });
}

// 손금 칸 끝의 「다른 사진으로 다시 보기」 — 손금을 본 칸이면(새로 읽었든, 저장된 것을 다시 펼쳤든) 늘 보인다.
// 노트는 한 줄로 이어 쓰므로 누른 순간 바로 끼어들지 않고 같은 palmRedo 흐름으로 보낸다:
//   "더 볼까요?"를 기다리는 중이면 그 물음에 「손바닥 사진 바꾸기」를 고른 것으로(페이지 기록도 같다),
//   다른 칸을 쓰는 중이면 다음 "더 볼까요?"에서, 노트를 다 쓴 뒤면 그 아래에 바로.
// 손금방이 쉬면(집 PC 꺼짐) 버튼 대신 쉬는 안내 한 줄.
let palmOpenP = Promise.resolve(true);
const redo = { want: false, kick: null, idle: null };
async function withRedo(b, pg, linesP) {
  const r = await linesP;
  if (!pg.live) return r;
  if (!(await palmOpenP)) { await pen.write(b, T.palmRedoRest, { cls: "body small faint", id: "palm-redo-rest" }); return r; }
  const row = el("div", "opts redo-row");
  const btn = el("button", "opt redo-btn", T.palmRedoBtn);
  btn.type = "button";
  row.append(btn);
  b.append(row);
  pen.follow(row);
  await pen.mark("box", btn, { color: INK.blue });   // 연필 상자 — 글씨만으로는 누르는 곳인지 안 보인다
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    for (const x of page.querySelectorAll(".redo-btn")) x.disabled = true;
    btn.classList.add("picked");
    if (redo.idle) { const go = redo.idle; redo.idle = null; go(); return; }
    redo.want = true;
    redo.kick?.();
  });
  return r;
}
const redoReset = () => { for (const x of page.querySelectorAll(".redo-btn")) { x.disabled = false; x.classList.remove("picked"); } };

// 손바닥 사진 바꾸기(마무리 "더 볼까요?" 또는 손금 칸의 버튼) — 다시 찍거나 다른 사진을 골라 새로 읽는다. 새로 읽으면 이 페이지의 옛 손금 칸과
// 종합(형광펜·여백 메모 포함)을 걷어 내고 새 결과로 바꾼다. 건너뛰면 옛 결과 그대로. 사진은 이번에도 남기지 않는다.
async function palmRedo() {
  const b = section("palm-sec");
  sep(b);
  pen.face("think");
  await pen.write(b, T.palmRedoLead);
  const prev = page.querySelector("#pola-palm");
  const keep = async () => { if (prev?.isConnected) prev.id = "pola-palm"; await pen.write(b, T.palmRedoKeep); redoReset(); return false; };
  for (;;) {
    const got = await shootPalm(b, { prev });
    if (got.skip) return keep();
    if (got.result) {
      savePalm(got.result);
      const turn = [...page.querySelectorAll("hr.page-turn")].at(-1);   // 지난 페이지(다른 날)는 기록이라 건드리지 않는다
      const mine = (n) => !turn || Boolean(turn.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
      for (const old of page.querySelectorAll(".palm-sec, .sum-sec")) if (old !== b && mine(old)) old.remove();
      for (const t of page.querySelectorAll(".trait.hl")) if (mine(t)) t.classList.remove("hl");
      pen.relayout();   // 걷어 낸 줄에 붙어 있던 폴라로이드·화살표·여백 메모도 같이 치운다
      await pen.write(b, T.palmRedone, { cls: "w s", id: "palm-redone" });
      await withRedo(b, { live: true }, palmLines(b, palmList() ?? [], got.pola, palmSum()));
      return true;
    }
    await pen.write(b, got.error, { cls: "w s err" });
    const again = await pen.choose(b, [{ value: "again", label: T.palmRetry }], { skip: SKIP });
    if (again === null) return keep();
  }
}

// 카메라(폴라로이드 안 미리보기) → 찍기/갤러리 → 올리고 기다리기 → 사진 위에 선
async function shootPalm(b, { prev = null } = {}) {
  pen.face("think");
  await pen.write(b, T.palmShoot, { cls: "w s" });
  const video = el("video", "pola-video");
  video.muted = true; video.playsInline = true; video.autoplay = true;
  video.setAttribute("aria-label", "카메라 미리보기");
  prev?.removeAttribute("id");   // 사진 바꾸기: 새 폴라로이드가 #pola-palm — 옛 것은 새로 읽으면 걷어 낸다
  const p = await pen.polaroid(b, video, { caption: "", tilt: -3, x: "mid", id: "pola-palm" });
  const bar = el("div", "cam-bar");
  const file = el("input"); file.type = "file"; file.accept = "image/*"; file.id = "palm-file"; file.className = "palm-file";
  const gallery = el("label", "opt mini gallery", T.palmGallery); gallery.htmlFor = "palm-file";
  const shutter = el("button", "shutter"); shutter.type = "button"; shutter.id = "palm-shutter"; shutter.setAttribute("aria-label", "찍기");
  const skip = el("button", "opt skip", SKIP); skip.type = "button";
  bar.append(gallery, shutter, skip, file);
  b.append(bar);
  pen.follow(bar);
  let stream = null;
  const stop = () => { if (stream) for (const t of stream.getTracks()) t.stop(); stream = null; video.srcObject = null; };
  addEventListener("pagehide", stop, { once: true });
  const md = navigator.mediaDevices;
  let why = null;
  if (!md?.getUserMedia || !isSecureContext) why = T.palmNoCamera;
  else {
    try {
      stream = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } } });
      video.srcObject = stream;
      video.play?.().catch(() => {});
    } catch (e) { why = e?.name === "NotAllowedError" ? T.palmBlocked : T.palmNoCamera; }
  }
  if (why) { shutter.hidden = true; p.card.classList.add("nocam"); await pen.write(b, why, { cls: "body small faint", id: "palm-nocam-why" }); }
  pen.hold();
  const shot = await new Promise((resolve) => {
    shutter.addEventListener("click", async () => {
      if (!stream || !video.videoWidth) return;
      try { resolve(await shrink(video, video.videoWidth, video.videoHeight)); } catch { resolve({ error: PALM_MSG.BAD_IMAGE }); }
    });
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      try { resolve(await preparePhoto(f)); } catch { resolve({ error: PALM_MSG.BAD_IMAGE }); }
    });
    skip.addEventListener("click", () => resolve({ skip: true }), { once: true });
  });
  stop();
  bar.remove();
  if (shot.skip) { p.card.remove(); p.space.remove(); return { skip: true }; }
  if (shot.error) { p.card.remove(); p.space.remove(); return { error: shot.error }; }
  const canvas = el("canvas", "pola-photo");
  canvas.width = shot.canvas.width; canvas.height = shot.canvas.height;
  canvas.getContext("2d").drawImage(shot.canvas, 0, 0);
  pen.zoomable(canvas, "손바닥 사진");
  video.replaceWith(canvas);
  pen.relayout();
  const sent = await submitPalm(shot.blob);
  if (sent.error) { p.card.remove(); p.space.remove(); return { error: T.palmErr[sent.error] ?? T.palmErr.internal }; }
  pen.face("wait");
  const waitLine = await pen.write(b, T.palmReading, { cls: "body small faint", id: "palm-wait" });
  const done = await waitPalm(sent.id, (state, ahead) => { waitLine.textContent = state === "running" || !ahead ? T.palmReading : T.palmAhead(ahead); });
  waitLine.remove();
  if (!done.ok) { p.card.remove(); p.space.remove(); return { error: done.message || PALM_MSG[done.code] || PALM_MSG.INTERNAL }; }
  drawLines(canvas, done.result);
  const drawn = ["life", "head", "heart", "fate"].filter((k) => done.result.lines?.[k]?.drawn && !(k === "fate" && done.result.merged_life_fate));
  const side = { left: "왼손", right: "오른손" }[done.result.hand?.detected];
  await pen.setCaption(p, T.palmCaption(side, drawn.length));
  return { result: done.result, pola: p };
}

// 선마다 한 단락(lib/palm-lines.js) → 정리한 특성 줄. 사주와 모순이라 노트가 뺀 특성은 선 단락에서도 뺀다.
// sum 이 없으면(옛 저장 — traits 만) 특성 줄만 쓰고, 선마다 풀이는 다음에 손바닥을 보여 주면 적는다고 한 줄.
async function palmLines(b, list, pola, sum) {
  pen.face("think");
  const data = await chart().catch(() => null);
  const n = assembleNote({ saju: data?.note ?? null, palm: list });
  // 사주·타로가 같이 본 카드는 이미 정해진 말이라 먼저 놓고, 손금만 본 카드는 선 단락과 같은 기준으로 고른다 —
  // 선 단락에서 빠진 뜻(또는 쓴 글과 반대 방향인 뜻)은 '정리하면' 줄에도 쓰지 않는다.
  const palmOnly = (c) => c.badges.every((x) => x.source === "palm");
  const { paras, dropped, dirs } = palmLineView(sum, { hide: excludedIdsOf(n.merge.excluded), shown: n.cards.filter((c) => !palmOnly(c)).map((c) => c.trait) });
  let first = null;
  for (const p of paras) {
    const h = await pen.write(b, p.name, { cls: `w s pl ${p.seen}`, id: `palm-line-${p.key}`, data: { line: p.key, seen: p.seen } });
    h.style.setProperty("--lc", p.color);
    h.append(el("span", "pl-chip", p.chip));
    first ??= h;
    await pen.write(b, p.body, { cls: "body pl-body", data: { line: p.key, from: p.from }, speed: 9 });
  }
  if (!sum) await pen.write(b, T.palmNoLines, { cls: "body small faint", id: "palm-no-lines" });
  const cards = n.cards.filter((c) => c.badges.some((x) => x.source === "palm"))
    .filter((c) => !palmOnly(c) || !paras.length || (!dropped.has(c.trait) && (paras.some((p) => p.meanings.includes(c.label)) || !clashes(c.label, dirs))));
  if (!cards.length) { await pen.write(b, T.palmNoTraits); return { ok: true }; }
  if (paras.length) await pen.write(b, T.palmSumUp, { cls: "w s", id: "palm-sum-up" });
  for (const c of cards) {
    const why = c.badges.find((x) => x.source === "palm").evidence;
    if (why && !paras.length) await pen.write(b, `${why} →`, { cls: "w s" });
    const p = await pen.write(b, c.label, { cls: "w trait", id: `palm-${c.trait}`, data: { trait: c.trait, src: "palm" } });
    first ??= p;
    await pen.mark("underline", p);
  }
  if (pola && first) await pen.mark("link", pola.card, { el2: first, color: INK.red });
  return { ok: true };
}

// 종합 — 사주 줄과 손금 줄이 같은 말을 하면 형광펜과 여백 화살표로 잇는다
async function summary() {
  const data = await chart().catch(() => null);
  const n = assembleNote({ saju: data?.note ?? null, palm: palmList(), tarot: tarotList() });
  if (!(n.progress.filled.includes("saju") && n.progress.filled.includes("palm"))) return n;
  const b = section("sum-sec");
  sep(b);
  pen.face("cheer");
  await pen.write(b, T.sumLead);
  const over = n.cards.filter((c) => c.type === "overlap");
  const pairs = over.map((c) => [page.querySelector(`.trait[data-src="saju"][data-trait="${c.trait}"]`), page.querySelector(`.trait[data-src="palm"][data-trait="${c.trait}"]`), c])
    .filter(([a, z]) => a && z);
  if (pairs.length) {
    for (const [a, z] of pairs) {
      a.classList.add("hl"); z.classList.add("hl");
      await pen.mark("arrow", a, { el2: z, color: INK.red });
      pen.margin(T.sameMargin, z, { red: true });
    }
    await pen.write(b, T.sumSame, { id: "sum-line" });
    await pen.write(b, T.sumSameLine(pairs[0][2].label), { cls: "w s" });
  } else await pen.write(b, T.sumNone, { id: "sum-line" });
  // 바탕(사주)과 요즘(타로)을 한 줄로 — 이미 있는 역할(바탕·요즘)과 lean 만 쓴다(새 규칙 없음). 원소 말은 쓰지 않는다.
  const base = n.cards.find((c) => c.badges.some((x) => x.source === "saju"));
  if (n.now.length && base) {
    await pen.write(b, n.now[0].against ? T.sumBaseAgainst(base.label, n.now[0].label) : T.sumBase(base.label, n.now[0].label),
      { cls: "w s", id: "sum-base", data: { state: n.now[0].state, trait: base.trait } });
  } else if (n.now.length) await pen.write(b, T.sumNow(n.now[0].label), { cls: "w s", data: { state: n.now[0].state } });
  return n;
}

// 마무리 — 한 줄 요약, 요즘 한마디, "더 볼까요?"
async function wrap(pg, state) {
  const data = await chart().catch(() => null);
  const n = assembleNote({ saju: data?.note ?? null, palm: palmList(), tarot: tarotList() });
  const b = section();
  sep(b);
  pen.face("done");
  if (n.headline && n.cards.length) {
    await pen.write(b, T.wrapLead);
    const box = el("p", "boxed", n.headline.text);
    box.id = "headline";
    b.append(box);
    pen.follow(box);
    await pen.mark("box", box, { color: INK.blue });
  }
  const st = n.now[0]?.state;
  await pen.write(b, st ? STATE_TIP[st] : NO_STATE_TIP);
  const done = [["tarot", "타로"], ["saju", "사주"], ["palm", "손금"]].filter(([k]) => n.progress.filled.includes(k)).map(([, v]) => `${v}✓`);
  if (done.length) pen.margin(T.doneMargin(done), b.querySelector("p"));
  const seen = new Set();
  for (;;) {
    const opts = [];
    const birthKnown = Boolean(store.get(KEY.birth)?.y && data);
    if (birthKnown && !seen.has("luck")) opts.push({ value: "luck", label: T.more.luck });
    if (birthKnown && !seen.has("tojeong") && data?.tojeong?.length) opts.push({ value: "tojeong", label: T.more.tojeong });
    if (!tarotValid() && !seen.has("tarot")) opts.push({ value: "tarot", label: T.more.tarot });
    const three = TAROT_TOPICS.find((t) => t.id === state.topic && (t.id === "love" || t.id === "work"));
    if (three && tarotValid() && !seen.has("tarot3")) opts.push({ value: "tarot3", label: T.more.tarot3 });
    if (!birthKnown && !seen.has("birth")) opts.push({ value: "birth", label: T.more.birth });
    if (birthKnown && !palmList() && state.palmOpen && !seen.has("palm")) opts.push({ value: "palm", label: T.more.palm });
    // 손금 칸의 버튼이 이 보기로 들어오므로, 손금이 있으면 늘 둔다(한 번 건너뛴 뒤에도)
    if (palmList() && state.palmOpen) opts.push({ value: "palmRedo", label: T.more.palmRedo });
    opts.push({ value: "stop", label: T.more.stop });
    const q = section();
    pen.face("done");
    await pen.write(q, T.moreAsk);
    const asked = ask(pg, "more", (preset) => pen.choose(q, preset === "palmRedo" && !opts.some((o) => o.value === "palmRedo")
      ? [...opts.slice(0, -1), { value: "palmRedo", label: T.more.palmRedo }, opts.at(-1)] : opts, { preset }));
    redo.kick = () => q.querySelector('.opt[data-value="palmRedo"]:not(:disabled)')?.click();
    if (redo.want) redo.kick();
    const { v, replay } = await asked;
    redo.kick = null;
    if (v === "palmRedo") redo.want = false;
    if (!v || v === "stop") break;
    seen.add(v);
    if (v === "luck") await luck(data);
    if (v === "tojeong") await tojeong(data);
    if (v === "tarot") await tarot(pg, null);
    if (v === "tarot3") await tarot3(pg, three?.spread ?? "three");
    if (v === "birth") { await birth(pg, Boolean(tarotValid())); return wrap(pg, state); }
    if (v === "palm") { await palm(pg, Promise.resolve(state.palmOpen)); await summary(); return wrap(pg, state); }
    // 다시 펼칠 땐 위 손금 칸이 이미 새로 읽은 것(기기엔 마지막 결과만 있다) — 한 줄만 적고 넘어간다
    if (v === "palmRedo" && replay) {
      if (pg.next("palmRedo") === "yes") await pen.write(section(), T.palmRedoAgain, { cls: "w s" });
      else await pen.write(section(), T.palmRedoKeep, { cls: "w s" });
      continue;
    }
    if (v === "palmRedo") {
      const ok = await palmRedo();
      pg.put("palmRedo", ok ? "yes" : null);
      if (ok) { await summary(); return wrap(pg, state); }
    }
  }
  const end = section();
  await pen.write(end, T.bye);
  end.append(el("p", "foot", T.footer));
  const tabs = el("p", "body small tabs-link");
  const ta = el("a", "link small", T.tabs); ta.href = "note/"; ta.id = "tabs-link";
  tabs.append(ta);
  end.append(tabs, privacyLink("end-privacy"));
  const clear = el("button", "link small clear", T.clear);
  clear.type = "button";
  clear.addEventListener("click", () => { for (const k of Object.values(KEY)) store.del(k); location.reload(); });
  end.append(clear);
  pen.follow(clear);
  if (!pg.live) return;
  // 노트를 다 쓴 뒤에 손금 칸의 버튼을 누르면 그 아래에 바로 — 다시 펼칠 땐 기록대로
  const after = pg.next("palmRedo");
  if (after !== undefined) {
    await pen.write(section(), after === "yes" ? T.palmRedoAgain : T.palmRedoKeep, { cls: "w s" });
    if (after === "yes") return wrap(pg, state);
  }
  const go = async () => {
    redo.want = false;
    const ok = await palmRedo();
    pg.put("palmRedo", ok ? "yes" : null);
    if (ok) { await summary(); return wrap(pg, state); }
    redo.idle = go;
  };
  if (redo.want) return go();
  redo.idle = go;
}

// 대운 — 인생 곡선은 탭 화면(/note/)과 같은 손그림 부품(window.Note.lifeCurve, note/note.js)으로 노트에 바로 그린다.
// 사본을 두지 않는다: 이름표 자리 찾기·별·조심 물결·지금 화살표가 한 곳에서 같이 고쳐지게. 구간을 누르면 그 대운 풀이를 아래 한 줄에.
async function drawLifeCurve(b, lc) {
  const N = window.Note;
  const wrapBox = el("div", "nb-curve");
  wrapBox.id = "nb-curve";
  const pick = el("p", "body small curve-pick");
  pick.id = "curve-pick";
  pick.setAttribute("aria-live", "polite");
  let ready = false;   // 처음 그릴 때 고르는 '지금' 구간은 아래에 따로 적으니 비워 둔다
  N.setSeed(store.get(KEY.birth));
  const parts = N.lifeCurve(lc, {
    onPick(i, s) {
      if (!ready) return;
      pick.textContent = `${T.luckPick(Math.round(s.from), Math.max(Math.round(s.from), Math.round(s.to) - 1), s.ganji, s.kind === "luck")} ${s.text}`;
      pen.relayout();
    },
  });
  wrapBox.append(parts.host);
  b.append(wrapBox, pick);
  parts.draw();
  ready = true;
  // 노트 모눈(한 줄 20px)에 맞춰 높이를 올림 — 아래 글이 줄 위에 앉게
  wrapBox.style.setProperty("height", `${Math.ceil(parts.host.getBoundingClientRect().height / 20) * 20}px`);
  pen.follow(wrapBox);
  if (!pen.instant && !pen.fast) {
    const M = N.Motion(), P = parts.P;
    M.stroke(P.axes, 0, 240);
    P.ticks.forEach((t, i) => M.fade(t, 100 + i * 15, 120));
    M.stroke(P.fill, 200, 600);
    M.stroke(P.line, 240, 650);
    P.dots.forEach((d, i) => M.fade(d, 850 + i * 25, 80));
    P.marks.forEach((m) => (m.tagName === "g" ? M.stroke(m, 900, 240) : M.fade(m, 900, 200)));
    P.labels.forEach((l) => M.fade(l, 950, 200));
    M.stroke(P.nowArrow, 1100, 320);
    const skip = () => M.finish();
    page.addEventListener("click", skip, { once: true });
    await Promise.race([M.done(), pen.sleep(1500)]);
    page.removeEventListener("click", skip);
  }
  return parts;
}
async function luck(data) {
  const b = section("deep");
  pen.face("cal");
  let lc = data.candidates[0].lifeCurve;
  if (!lc) {   // 대운은 성별이 있어야 센다 — 한 번만 묻고 생일 기록에 같이 둔다(다시 펼칠 땐 이미 있어 묻지 않는다)
    await pen.write(b, T.luckGender);
    const g = await pen.choose(b, Object.entries(T.luckGenders).map(([value, label]) => ({ value, label })), { skip: SKIP });
    if (!g) return;
    store.set(KEY.birth, { ...store.get(KEY.birth), gender: g });
    chartP = null;
    data = await chart().catch(() => null);
    lc = data?.candidates?.[0]?.lifeCurve;
    if (!lc) { await pen.write(b, T.luckNone, { cls: "w s err" }); return; }
  }
  await pen.write(b, T.luckLead);
  await drawLifeCurve(b, lc);
  const cur = lc.sections[lc.currentIndex] ?? lc.sections[0];
  const now = await pen.write(b, T.luckNow(Math.round(cur.from), Math.floor(cur.to), cur.ganji));
  await pen.mark("underline", now);
  await pen.write(b, cur.text, { cls: "body" });
  const next = lc.sections[lc.currentIndex + 1];
  if (next) await pen.write(b, T.luckNext(Math.round(next.from), next.ganji), { cls: "w s" });
}
// 올해 토정비결 — 괘 본문(tojeong/<괘>.json)의 총론과 이번 달 한 줄
async function tojeong(data) {
  const tj = data.tojeong[0];
  const b = section("deep");
  pen.face("cal");
  await pen.write(b, T.tojeongLead(tj.year));
  let d;
  try { d = await fetch(`tojeong/${tj.code}.json`).then((r) => (r.ok ? r.json() : Promise.reject())); } catch { await pen.write(b, T.tojeongFail, { cls: "w s err" }); return; }
  const yr = yearReading(d);
  const t = await pen.write(b, T.tojeongTitle(d.title.reading, d.title.ko));
  await pen.mark("underline", t);
  await pen.write(b, yr.paragraph, { cls: "body" });
  const mi = Math.max(0, Math.min(11, (data.lunarToday?.month ?? 1) - 1));
  await pen.write(b, T.tojeongMonth(MONTH_NAMES[mi]), { cls: "w s" });
  await pen.write(b, yr.months[mi].text, { cls: "body" });
}

// ── 시작 ──
async function run() {
  dangiSwitch();
  await (document.fonts?.ready ?? Promise.resolve());
  const today = todayISO();
  const saved = store.get(KEY.page);
  const state = { palmOpen: true };
  const openP = palmStatus().then((s) => (state.palmOpen = s?.online === true));
  palmOpenP = openP;
  const first = !saved && !store.get(KEY.birth) && !store.get(KEY.palm) && !store.get(KEY.tarot);
  const drawnOld = {};
  // 지난 페이지(다른 날)는 그대로 펼친다 — 바로 다 쓴 상태로
  if (saved?.log?.length && saved.date !== today) {
    page.classList.add("has-old");
    const old = new Page(saved.date, saved.log.slice(), false);
    pen.instant = true;
    try { await consult(old, state, openP, { prev: null, first: false, old: true }); } catch (e) { if (!(e instanceof EndOfPage)) throw e; }
    Object.assign(drawnOld, { sajuOld: Boolean(old.drawn.saju), palmOld: Boolean(palmList()) && old.log.some((x) => x.k === "palm" && x.v === "yes") });
    const hr = el("hr", "page-turn"); page.append(hr);
  }
  const same = saved?.date === today ? saved.log.slice() : [];
  const pg = new Page(today, same, true);
  Object.assign(pg.drawn, drawnOld);
  pen.instant = same.length > 0 || !motion;
  await consult(pg, state, openP, { prev: saved?.log?.length ? saved.date : null, first });
  document.documentElement.dataset.ready = "1";
}

async function consult(pg, state, openP, { prev, first, old = false }) {
  await greet(pg, first, prev);
  const tp = await topic(pg, Boolean(prev));
  state.topic = tp?.id ?? null;
  const t = await tarot(pg, tp);
  await birth(pg, Boolean(t.card || t.kept));
  await palm(pg, openP);
  await summary();
  if (old) {   // 지난 페이지는 마무리의 "더 볼까" 기록까지만 다시 그린다(새로 묻지 않는다)
    while (pg.i < pg.log.length && pg.log[pg.i].k === "more") {
      const v = pg.log[pg.i++].v;
      const data = await chart().catch(() => null);
      if (v === "luck" && data) await luck(data);
      if (v === "tojeong" && data) await tojeong(data);
      if (v === "tarot3") await tarot3(pg, null);
    }
    return;
  }
  await wrap(pg, state);
}

run().catch((e) => { console.error(e); document.documentElement.dataset.ready = "error"; });
