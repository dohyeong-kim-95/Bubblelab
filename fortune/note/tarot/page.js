// 운세 노트 타로 탭 — 그리기와 입력만 맡는다. 뽑기·배열·풀이·잇기·맺음은 tarot.js, 지난 카드 기록은 tarot-log.js(둘 다 순수 모듈).
//  * 운세 노트(fortune/note/index.html)의 「타로」 탭 패널에서 mountTarot(panel) 로 한 번 붙인다.
//    패널 안 부품은 data-t="이름" 으로 찾는다(노트 화면의 id 와 겹치지 않게).
//  * 흐름(리딩 7단계, research-v2 §1): 주제 칩·스프레드 4개 → 질문 다듬기 → 섞기(톡 누르면 멈춤) → 세 더미 중 하나 →
//    그 더미 26장 부채꼴에서 고르기 → 한 장씩 직접 뒤집기(한꺼번에 보기 있음) → 카드 잇기 → 한 줄 묶기 → 맺음.
//  * 섞기: crypto.getRandomValues — tarot.js drawDeck 이 순서와 정/역(flips)을 한 번에 정한다. 애니메이션은 보여 주기만 한다.
//  * 같은 날·같은 질문이면 이 기기(localStorage)에 둔 {order, flips, picks} 로 같은 결과를 다시 보여 준다. 다시 뽑기 없음.
//  * 지난 카드 30일(bl-tarot-log)과 설정(bl-tarot-pref)도 이 기기에만. 질문 원문은 '질문도 남기기'를 켰을 때만 기록에 남는다.
//  * 서버로 보내는 것 없음(질문 포함). 인라인 style 없음 — 각도는 style.setProperty 로만.
import {
  DECKS, deckReady, CARD_BY_ID, POSITIONS, SPREADS, SPREAD_ORDER, TOPICS, TEXT_CREDIT, DISCLOSURE,
  classifyQuestion, cryptoRandomInt, drawDeck, readTarot, refineQuestion, storageKey,
} from "../lib/tarot.js";   // 원본은 fortune/lib/ — 이주(M4.5) 동안 _infra/build.mjs 가 util/fortune/lib/ 로 복사해 둔다
import { deckForDangi, loadDangi, saveDangi } from "../lib/prefs.js";
import { LOG_KEY, PREF_KEY, addToLog, forgetQuestions, logEntry, logStats, pruneLog, readPref, statsLines } from "../lib/tarot-log.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const PREFIX = "bl-tarot:";
const PILES = 3;                  // 78장 → 세 더미(26장씩)
const PILE_NAMES = ["첫째 더미", "둘째 더미", "셋째 더미"];
const FLIP_MS = 900;              // 한 장 뒤집는 데 걸리는 시간(약 1초)
const md = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

/**
 * root = 타로 패널. onShare(fn | null) — 풀이가 나오면 공유 문구 함수를 넘기고, 처음으로 돌아가면 null.
 * 두 번 불러도 한 번만 붙는다.
 */
export function mountTarot(root, { onShare = () => {} } = {}) {
  if (root.dataset.mounted) return;
  const $ = (name) => root.querySelector(`[data-t="${name}"]`);
  const DATE = todayKST();

  // ── 저장(이 기기에만) ── 오늘이 아닌 당일 기록은 열 때 지운다. 지난 카드 기록은 30일.
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } },
    set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 못 해도 화면은 그대로 */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* 무시 */ } },
    prune() {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k?.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${DATE}:`)) localStorage.removeItem(k);
        }
      } catch { /* 무시 */ }
    },
  };
  loadDangi();   // 옛 타로 설정의 덱 칸을 먼저 옮긴다 — 아래 readPref·savePref 는 deck 없는 값만 읽고 쓴다
  let pref = readPref(store.get(PREF_KEY));
  const savePref = () => store.set(PREF_KEY, pref);
  // 그림 덱은 읽을 때마다 당이 설정에서 — 다른 탭(상담 노트)에서 바꿔도 다음 뽑기부터 따른다
  const deck = () => deckForDangi(loadDangi(), deckReady("classic"));

  const SECTIONS = ["start", "ask-box", "crisis", "shuffle-box", "pick-box", "result", "log"];
  function show(...ids) { for (const id of SECTIONS) $(id).hidden = !ids.includes(id); if (root.offsetParent) window.scrollTo(0, 0); }

  let state = null;   // { spread, question, key, order, flips, pile, picks }
  let chosen = null;  // 주제 칩에서 고른 주제

  // ── 처음: 주제 칩 + 스프레드 4개 ──
  function drawStart() {
    $("topics").replaceChildren(...TOPICS.map((t) => {
      const b = el("button", `chip${chosen === t.id ? " on" : ""}`, t.label);
      b.type = "button";
      b.dataset.topic = t.id;
      b.setAttribute("aria-pressed", String(chosen === t.id));
      b.addEventListener("click", () => { chosen = chosen === t.id ? null : t.id; drawStart(); });
      return b;
    }));
    const rec = TOPICS.find((t) => t.id === chosen)?.spread;
    $("spreads").replaceChildren(...SPREAD_ORDER.map((id) => {
      const sp = SPREADS[id];
      const b = el("button", `spread-pick${rec === id ? " rec" : ""}`);
      b.type = "button";
      b.dataset.spread = id;
      const name = el("span", "hand h-sub", sp.label);
      b.append(name, el("span", "small", sp.sub));
      if (rec === id) b.append(el("span", "rec-tag small", "이 고민에 맞아요"));
      b.addEventListener("click", () => {
        if (!sp.question) return begin(id, null);
        $("ask-title").textContent = sp.short ?? sp.label;
        $("ask-sub").textContent = sp.sub;
        const ex = TOPICS.find((t) => t.id === chosen && t.example);
        $("question").placeholder = ex ? `예) ${ex.example}` : "예) 이직을 준비하려면 무엇부터 해야 할까";
        root.dataset.spread = id;
        show("ask-box");
        $("question").focus();
      });
      return b;
    }));
  }

  // ── 질문 다듬기(예/아니오 끝말이면 바꾼 예) ──
  function refine() {
    const r = refineQuestion($("question").value);
    $("refine").hidden = !r.yesNo;
    $("refine-tip").textContent = r.tip ?? "";
    $("refine-ex-row").hidden = !r.example;
    $("refine-ex").textContent = r.example ?? "";
  }

  function begin(spread, question) {
    const q = SPREADS[spread].question ? (question ?? "").trim() : "";
    const key = storageKey({ spread, date: DATE, question: q });
    const saved = store.get(key);
    if (saved?.order && saved?.picks) {
      try {
        const r = readTarot({ spread, order: saved.order, picks: saved.picks, flips: saved.flips ?? null, date: DATE, question: q || null, deck: deck() });
        return render(r, { again: true });
      } catch { /* 깨진 기록이면 새로 */ }
    }
    if (q && classifyQuestion(q).action === "crisis") {
      $("crisis-text").textContent = classifyQuestion(q).message;
      return show("crisis");
    }
    const { order, flips } = drawDeck((n) => cryptoRandomInt(n), { reversals: pref.reversals });
    state = { spread, question: q || null, key, order, flips, pile: null, picks: [] };
    shuffle();
  }

  // ── 섞기 → 세 더미 ── 순서는 이미 정해졌다. 섞는 모습은 보여 주기만 하고, 톡 누르면 멈춘다.
  function shuffle() {
    const deck = $("deck");
    deck.hidden = false;
    deck.disabled = false;
    deck.classList.toggle("shuffling", !reduced());
    $("piles").hidden = true;
    $("shuffle-guide").textContent = "카드를 섞고 있어요. 마음이 정해지면 톡 눌러 멈춰 주세요.";
    show("shuffle-box");
  }
  function stopShuffle() {
    const deck = $("deck");
    deck.classList.remove("shuffling");
    deck.disabled = true;
    deck.hidden = true;
    $("shuffle-guide").textContent = "세 더미로 나눴어요. 마음 가는 더미 하나를 골라 주세요.";
    $("piles").replaceChildren(...PILE_NAMES.map((name, k) => {
      const b = el("button", "pile");
      b.type = "button";
      b.dataset.pile = String(k);
      b.setAttribute("aria-label", name);
      b.append(el("span", "card-back"), el("span", "card-back"), el("span", "card-back"), el("span", "lab small", name));
      b.addEventListener("click", () => choosePile(k));
      return b;
    }));
    $("piles").hidden = false;
  }
  function choosePile(k) {
    state.pile = k;
    drawSlots();
    drawFan();
    guide();
    show("pick-box");
  }

  function drawSlots() {
    $("slots").replaceChildren(...SPREADS[state.spread].positions.map((k) => {
      const li = el("li", "slot");
      li.dataset.pos = k;
      li.append(el("span", "lab", POSITIONS[k].label), el("span", "desc", POSITIONS[k].desc), el("span", "hole"));
      return li;
    }));
  }

  // 고른 더미(order 의 26장 구간)를 두 줄 × 13장 부채꼴로. 고른 자리 번호 = order 의 번호(정직하게 그 카드).
  function drawFan() {
    const fan = $("fan");
    fan.className = "fan";
    fan.replaceChildren();
    const per = Math.ceil(state.order.length / PILES / 2);
    const from = state.pile * per * 2, to = Math.min(state.order.length, from + per * 2);
    const half = Math.max(80, (fan.clientWidth || 300) / 2 - 32);
    const span = Math.min(28, Math.asin(Math.min(1, half / 240)) * 180 / Math.PI);
    for (let r = 0; r < 2; r++) {
      const row = el("div", `row r${r}`);
      for (let i = 0; i < per; i++) {
        const idx = from + r * per + i;
        if (idx >= to) break;
        const b = el("button", "fan-card");
        b.type = "button";
        b.dataset.idx = String(idx);
        b.setAttribute("aria-label", `${idx - from + 1}번째 카드`);
        b.style.setProperty("--a", `${(-span + (2 * span * i) / (per - 1)).toFixed(2)}deg`);
        b.append(el("span", "card-back"));
        b.addEventListener("click", () => pick(idx, b));
        row.append(b);
      }
      fan.append(row);
    }
  }

  function guide() {
    const pos = SPREADS[state.spread].positions;
    const n = state.picks.length;
    $("pick-guide").textContent = n >= pos.length ? "카드를 펼칠게요."
      : pos.length === 1 ? "마음 가는 카드 한 장을 골라 주세요."
      : `${["첫", "두", "세"][n]} 번째 — '${POSITIONS[pos[n]].label}' 자리 카드를 골라 주세요.`;
  }

  function pick(idx, btn) {
    const pos = SPREADS[state.spread].positions;
    if (state.picks.length >= pos.length || state.picks.includes(idx)) return;
    state.picks.push(idx);
    btn.classList.add("taken");
    btn.disabled = true;
    const slot = $("slots").children[state.picks.length - 1];
    slot.classList.add("filled");
    slot.querySelector(".hole").append(el("span", "card-back"));
    guide();
    if (state.picks.length === pos.length) {
      $("fan").classList.add("done");
      const result = readTarot({ spread: state.spread, order: state.order, picks: state.picks, flips: state.flips, date: DATE, question: state.question, deck: deck() });
      store.set(state.key, { order: state.order, flips: state.flips, picks: state.picks });
      setTimeout(() => render(result, { again: false }), reduced() ? 0 : 450);
    }
  }

  // ── 풀이 ── 처음 보는 결과는 엎어 둔 채로 — 한 장씩 눌러 뒤집는다(앞 카드부터). 다시 온 결과는 펼친 채로.
  function render(r, { again }) {
    $("again").hidden = !again;
    $("spread-name").textContent = SPREADS[r.spread].short ?? SPREADS[r.spread].label;
    $("spread-sub").textContent = SPREADS[r.spread].sub;
    const qLine = $("q-line");
    qLine.hidden = !r.question;
    qLine.textContent = r.question ? `물어본 것: ${r.question.raw}` : "";
    $("guard-notes").replaceChildren(...r.guard.notes.map((t) => el("li", null, t)));
    $("guard-notes").hidden = !r.guard.notes.length;

    const solo = r.cards.length === 1;
    const boxes = r.cards.map((c) => {
      const box = el("article", `reading${solo ? " solo" : ""}${c.reversed ? " rev" : ""}`);
      box.dataset.id = c.id;
      box.dataset.pos = c.position;
      box.dataset.orientation = c.orientation;
      const face = el("button", "face");
      face.type = "button";
      face.setAttribute("aria-label", `${POSITIONS[c.position].label} 자리 카드 뒤집기`);
      face.append(el("span", "card-back"));
      const img = el("img", "card-img");
      img.src = c.image;
      img.alt = `${c.name} 카드${c.reversed ? "(거꾸로)" : ""} — ${c.symbol}`;
      img.width = DECKS[r.deck].size.w;    // 자리를 미리 잡아(1:1.7) 그림이 늦게 와도 글이 밀리지 않게
      img.height = DECKS[r.deck].size.h;
      img.decoding = "async";
      face.append(img);
      const body = el("div", "body");
      body.append(el("span", "pos", POSITIONS[c.position].label), el("span", "pos-desc small", POSITIONS[c.position].desc));
      const reveal = el("div", "reveal");
      const nm = el("span", "nm hand h-sub");
      if (c.roman) nm.append(el("span", "rn", c.roman));
      nm.append(document.createTextNode(c.name));
      reveal.append(nm);
      if (c.reversed) reveal.append(el("p", "rev-note", c.note));
      reveal.append(el("p", "meaning small", c.meaning));
      const sym = el("ul", "syms small");
      for (const [w, m] of c.symbols) { const li = el("li"); li.append(el("b", null, w), document.createTextNode(` — ${m}`)); sym.append(li); }
      reveal.append(sym);
      if (c.reassure) reveal.append(el("p", "calm", c.reassure));
      reveal.append(el("p", "txt", c.text));
      body.append(reveal);
      box.append(face, body);
      return box;
    });
    $("readings").replaceChildren(...boxes);
    const flow = $("flow");
    flow.replaceChildren(flow.firstElementChild, ...r.flow.texts.map((t) => el("p", "flow-line", t)));
    flow.hidden = !r.flow.texts.length;
    $("summary").hidden = !r.texts.summary;
    $("summary").textContent = r.texts.summary ?? "";
    $("closing").textContent = r.texts.closing;
    $("disclosure").textContent = DISCLOSURE;
    $("credit").textContent = `그림: ${r.credit.art}. ${TEXT_CREDIT}`;
    onShare(() => `오늘 고른 타로 카드는 '${r.cards.map((c) => `${c.name}${c.reversed ? "(거꾸로)" : ""}`).join(" · ")}' — 운세 노트에서 한 장 골라 보세요`);

    let next = 0;
    const finish = () => {
      $("flip-guide").hidden = true;
      $("after").hidden = false;
      store.set(LOG_KEY, addToLog(store.get(LOG_KEY), logEntry(r, { keepQuestion: pref.keepQuestion }), DATE));
      drawLog();
      $("log").hidden = false;
    };
    const open = (i, animate) => {
      const box = boxes[i];
      box.classList.add("open");
      box.querySelector(".face").disabled = true;
      if (animate) box.classList.add("flipping");
      next = i + 1;
      boxes[next]?.querySelector(".face").removeAttribute("disabled");
      boxes[next]?.classList.add("next");
      box.classList.remove("next");
      if (next >= boxes.length) finish();
    };
    if (again || reduced()) {
      boxes.forEach((_, i) => open(i, false));
    } else {
      $("after").hidden = true;
      $("flip-guide").hidden = false;
      boxes.forEach((b, i) => {
        const f = b.querySelector(".face");
        f.disabled = i !== 0;
        if (i === 0) b.classList.add("next");
        f.addEventListener("click", () => { if (i === next) open(i, true); }, { once: false });
      });
      $("flip-all").onclick = () => { for (let i = next; i < boxes.length; i++) open(i, false); };
    }
    show("result");
    if (again || reduced()) $("log").hidden = false;
  }

  // ── 지난 카드 30일 ── 달력(날마다 칸) + 이번 달 자주 나온 카드·무늬. 칸을 누르면 그날 카드.
  function drawLog() {
    const log = pruneLog(store.get(LOG_KEY), DATE);
    store.set(LOG_KEY, log);
    const st = logStats(log, DATE);
    const cal = $("cal");
    cal.replaceChildren(...st.days.map((d) => {
      const li = el("li");
      const b = el("button", `day${d.entries.length ? " has" : ""}${d.date === DATE ? " today" : ""}`);
      b.type = "button";
      b.dataset.date = d.date;
      b.append(el("span", "d", String(Number(d.date.slice(8, 10)))));
      if (d.entries.length) b.append(el("span", "dot", String(d.entries.reduce((n, e) => n + e.ids.length, 0))));
      b.setAttribute("aria-label", `${md(d.date)} — ${d.entries.length ? `${d.entries.length}번 펼침` : "없음"}`);
      b.addEventListener("click", () => dayList(d));
      li.append(b);
      return li;
    }));
    $("day-list").textContent = "";
    $("stats").replaceChildren(...statsLines(st).map((t) => el("li", null, t)));
  }
  function dayList(d) {
    const names = (e) => e.ids.map((id, i) => `${cardName(id)}${e.rev[i] ? "(거꾸로)" : ""}`).join(" · ");
    $("day-list").textContent = d.entries.length
      ? `${md(d.date)}: ${d.entries.map((e) => `${SPREADS[e.spread].short ?? SPREADS[e.spread].label} — ${names(e)}${e.q ? ` (물어본 것: ${e.q})` : ""}`).join(" / ")}`
      : `${md(d.date)}에는 펼친 카드가 없어요.`;
  }
  const cardName = (id) => CARD_BY_ID[id].name;

  function restart() {
    state = null;
    $("fan").replaceChildren();
    $("slots").replaceChildren();
    $("question").value = "";
    $("q-count").textContent = "0 / 200";
    refine();
    onShare(null);
    drawStart();
    show("start");
  }

  // ── 연결 ──
  store.prune();
  $("pref-rev").checked = pref.reversals;
  // 카드 그림 덱(당이 ↔ 1909 옛 그림) — 그림이 78장 다 있을 때만 보인다. 뽑기·뜻은 같고 그림과 그림 묘사만 바뀐다.
  // 이 체크는 당이 켜기/끄기(bl-fortune-dangi, lib/prefs.js)를 그대로 보여 주고 바꾼다 — 체크 = 당이 끔(2026-11-17).
  $("pref-deck-row").hidden = !deckReady("classic");
  $("pref-deck").checked = deck() === "classic";
  $("pref-deck").addEventListener("change", (e) => saveDangi(!e.target.checked));
  $("pref-q").checked = pref.keepQuestion;
  $("pref-rev").addEventListener("change", (e) => { pref = { ...pref, reversals: e.target.checked }; savePref(); });
  $("pref-q").addEventListener("change", (e) => {
    pref = { ...pref, keepQuestion: e.target.checked };
    savePref();
    if (!pref.keepQuestion) store.set(LOG_KEY, forgetQuestions(store.get(LOG_KEY)));   // 끄면 이미 남은 질문도 지운다
  });
  $("question").addEventListener("input", (e) => { $("q-count").textContent = `${e.target.value.length} / 200`; refine(); });
  $("refine-ex").addEventListener("click", () => { $("question").value = $("refine-ex").textContent; $("q-count").textContent = `${$("question").value.length} / 200`; refine(); });
  $("ask-form").addEventListener("submit", (e) => { e.preventDefault(); begin(root.dataset.spread || "three", $("question").value); });
  $("deck").addEventListener("click", stopShuffle);
  $("restart").addEventListener("click", restart);
  $("crisis-back").addEventListener("click", restart);
  $("open-log").addEventListener("click", () => { drawLog(); $("log-back").hidden = false; show("log"); });
  $("log-back").addEventListener("click", () => { $("log-back").hidden = true; show("start"); });
  $("log-clear").addEventListener("click", () => { store.del(LOG_KEY); drawLog(); });
  drawStart();
  show("start");
  root.dataset.mounted = "1";   // 연결이 끝난 뒤에 표시(테스트·다른 화면이 이 값을 보고 누른다)
}
