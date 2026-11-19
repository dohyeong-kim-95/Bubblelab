// 손금 선별 풀이 — 판독 결과(palm.m2.v1)에서 선마다(생명선·두뇌선·감정선·운명선 + 손 모양) 찾았는지·모양·풀이를 뽑아
// 노트에 한 단락씩 쓴다. 순수 모듈(DOM 없음). 상담 노트(fortune/notebook)와 손금 화면(fortune/palm/palm.js)이 같이 쓰는
// 문구 원본은 여기 하나다. 검사: _infra/fortune-palm-lines.test.mjs.
//
// 지키는 것:
//  * 기기에 남기는 요약(palmLineSummary)은 글뿐이다 — 선마다 보인 정도·모양 표지(예: "heart.shape=curved_down")·특성 id·
//    판독이 쓴 그 선의 풀이 한 단락. 사진·선 좌표(pieces)·이미지 크기는 담지 않는다(개인정보 원칙).
//  * 해요체(승으로 끝내는 말투 없음), 금칙(BANNED_RE) 없음. 판독이 쓴 단락이 이 검사에 걸리거나 너무 길면 아래 표로 쓴 단락으로 바꾼다.
//  * 모순 0건: 노트가 모순이라 뺀 특성(excludedIds)과, 노트 카드·앞 선의 뜻과 모순 쌍인 뜻(손금 안에서도 두뇌선 '신중하게 시작' ↔
//    손 모양 '먼저 움직임'처럼 생긴다)은 뺀다. 순서는 노트 카드 → 생명·두뇌·감정·운명선 → 손 모양(사진 기울기에 민감해 맨 뒤).
//    뜻이 하나라도 빠진 선은 판독 단락을 쓰지 않고 표로 쓴 단락(남은 뜻만)으로 바꾼다.
//    특성 id 가 아니라 글로도 본다(PALM_TEXT_AXES): 앞 단락이 '차분히 쌓아 가는' 이면 뒤의 '먼저 움직이고 밀고 나가는' 은 뺀다.
//  * 못 찾은 선은 짧고 담담하게 — 사진 탓·사람 탓을 하지 않는다. 운명선은 원래 흐린 사람이 많다고 덧붙인다.
import { TRAITS, PALM_ALIAS, BANNED_RE, conflicts } from "./traits.js";

export const PALM_LINES_VERSION = "palm-lines-v1";
export const LINE_KEYS = ["life", "head", "heart", "fate"];
export const PALM_LINE_NAME = { life: "생명선", head: "두뇌선", heart: "감정선", fate: "운명선", hand: "손 모양" };
export const PALM_LINE_COLOR = { life: "#e4572e", head: "#2e6ede", heart: "#d63384", fate: "#229650", hand: "#7C776E" };
const TEXT_MAX = 360;   // 판독 단락 한 개의 최대 글자 수(넘으면 표로 쓴 단락)

// 모양 표지(판독 traits 의 기계용 근거 "palm:<선>.<항목>=<값>") → 노트 문장(해요체). 표는 palm-lab m2_run.py 의 TRAITS·HAND_TYPE 과 짝.
// 값마다 [이어 쓰는 꼴, 끝맺는 꼴] — 한 선의 모양 여러 개를 한 문장으로 잇는다.
const SHAPE = {
  "heart.ends_under": { index: ["끝이 검지 아래까지 올라가고", "끝이 검지 아래까지 올라가요"], index_outside: ["끝이 검지 아래까지 올라가고", "끝이 검지 아래까지 올라가요"],
    between_index_middle: ["끝이 검지와 중지 사이에서 멈추고", "끝이 검지와 중지 사이에서 멈춰요"], middle: ["끝이 중지 아래에서 멈추고", "끝이 중지 아래에서 멈춰요"] },
  "heart.shape": { curved_up: ["끝이 손가락 쪽으로 올라가고", "끝이 손가락 쪽으로 올라가요"], straight: ["곧게 뻗어 있고", "곧게 뻗어 있어요"],
    curved_down: ["끝이 아래로 살짝 휘고", "끝이 아래로 살짝 휘어요"] },
  "head.slope": { straight: ["손바닥을 곧게 가로지르고", "손바닥을 곧게 가로질러요"], gentle: ["완만하게 내려가고", "완만하게 내려가요"],
    steep: ["손목 쪽으로 깊게 내려가고", "손목 쪽으로 깊게 내려가요"] },
  "head.length": { long: ["길게 이어지고", "길게 이어져요"], sydney: ["손바닥 끝까지 길게 이어지고", "손바닥 끝까지 길게 이어져요"],
    short: ["손바닥 가운데쯤에서 멈추고", "손바닥 가운데쯤에서 멈춰요"] },
  "head.start_relation_with_life": { joined: ["생명선과 붙어서 시작하고", "생명선과 붙어서 시작해요"],
    slightly_apart: ["생명선과 조금 떨어져서 시작하고", "생명선과 조금 떨어져서 시작해요"], wide_apart: ["생명선과 떨어져서 시작하고", "생명선과 떨어져서 시작해요"] },
  "life.curve": { wide: ["손바닥 안쪽으로 넓게 감싸고", "손바닥 안쪽으로 넓게 감싸요"], narrow: ["엄지에 가깝게 감싸고", "엄지에 가깝게 감싸요"] },
  "fate.visible": { clear: ["손목 쪽에서 위로 또렷하게 올라가고", "손목 쪽에서 위로 또렷하게 올라가요"] },
  "hand.simian_crease": { yes: ["감정선과 두뇌선이 한 줄로 이어져 있고", "감정선과 두뇌선이 한 줄로 이어져 있어요"] },
};
// 모양 여러 개 → 한 문장(앞은 이어 쓰는 꼴, 마지막만 끝맺는 꼴)
const joinShapes = (pairs) => (pairs.length ? `${[...pairs.slice(0, -1).map((p) => p[0]), pairs.at(-1)[1]].join(", ")}.` : "");
const HAND_SHAPE = { palm: { square: "손바닥이 네모나고", long: "손바닥이 길고" }, fingers: { short: ["손가락이 짧고", "손가락이 짧은 편이에요"], long: ["손가락이 길고", "손가락이 긴 편이에요"] } };

export const PALM_LINE_TEXT = {
  seen: { clear: "또렷하게 보여요.", faint: "조금 옅게 보이지만 모양은 읽혀요." },
  chip: { clear: "또렷해요", faint: "옅어요", no: "안 보였어요", unclear: "흐릿했어요" },
  missing: (name) => `${name}은 이번 사진에서는 또렷하게 잡히지 않았어요. 다음에 밝은 쪽을 보고 찍으면 더 잘 보여요.`,
  fateMissing: "운명선은 이번 사진에서는 잡히지 않았어요. 운명선은 원래 흐리거나 짧은 분이 많아서 마음 쓰지 않으셔도 돼요.",
  merged: "생명선과 겹쳐 지나가서 같은 색으로 그렸어요.",
  meaning: (labels) => `그래서 ${labels.join(", ")}으로 읽혀요.`,
  plain: "모양으로 따로 짚을 만한 건 없어요.",
};

// ── 판독 단락 꺼내기: reading.markdown 의 "**생명선** …" 줄 ──
function paragraphs(md) {
  const out = {};
  for (const raw of String(md || "").split("\n")) {
    const m = /^\s*\*\*(생명선|두뇌선|감정선|운명선)\*\*\s*(.+)$/.exec(raw);
    if (!m) continue;
    const key = LINE_KEYS.find((k) => PALM_LINE_NAME[k] === m[1]);
    if (!out[key]) out[key] = m[2].replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[:：\-–—·]\s*/, "").trim();
  }
  return out;
}
// 노트에 그대로 써도 되는 판독 단락인지(말투·금칙·길이)
const SEUNG = /(?<![스짐상계명전우결기대])승(?=[.?!~,」』"'`)\s\\]|$)/;
export function textOk(t) {
  return typeof t === "string" && t.length >= 8 && t.length <= TEXT_MAX && /요[.!]?\s*[^\s]{0,3}$/.test(t)
    && !SEUNG.test(t) && !BANNED_RE.test(t) && !/입니다|됩니다|<|>|https?:/.test(t);
}

/** 손금 초안 id → 공통 id */
export const traitId = (id) => PALM_ALIAS[id] ?? id;

/**
 * palm.m2.v1 → 기기에 남겨도 되는 선별 요약. 실패 결과면 null.
 * { v, hand, merged, lines: [{ key, seen: clear|faint|no|unclear, marks: ["heart.shape=curved_down"], traits: [id], text: string|null }] }
 * 손 모양(hand)은 표지가 있을 때만 마지막에 붙는다.
 */
export function palmLineSummary(m2) {
  if (!m2 || m2.ok !== true || !m2.lines) return null;
  const paras = m2.reading?.checks_passed === false ? {} : paragraphs(m2.reading?.markdown);
  const merged = m2.merged_life_fate === true;
  const traits = Array.isArray(m2.traits) ? m2.traits : [];
  const marksOf = (prefix) => {
    const marks = [], ids = [];
    for (const t of traits) {
      const ev = Array.isArray(t.evidence) ? t.evidence : [];
      const own = ev.filter((e) => typeof e === "string" && e.startsWith(`palm:${prefix}`)).map((e) => e.slice(5));
      if (!own.length) continue;
      for (const m of own) if (!marks.includes(m)) marks.push(m);
      if (typeof t.trait === "string" && !ids.includes(t.trait)) ids.push(t.trait);
    }
    return { marks, ids };
  };
  const lines = LINE_KEYS.map((key) => {
    const L = m2.lines[key] || {};
    const drawn = L.drawn === true;
    const seen = drawn ? (L.visible === "faint" ? "faint" : "clear") : (L.visible === "no" ? "no" : "unclear");
    const { marks, ids } = drawn ? marksOf(`${key}.`) : { marks: [], ids: [] };
    const text = drawn && textOk(paras[key]) ? paras[key] : null;
    return { key, seen, marks, traits: ids, text };
  });
  const hand = marksOf("hand_shape.");
  const simian = marksOf("simian_crease=");
  if (hand.marks.length || simian.marks.length) {
    lines.push({ key: "hand", seen: "clear", marks: [...hand.marks, ...simian.marks.map((m) => `hand.${m}`)], traits: [...hand.ids, ...simian.ids], text: null });
  }
  return { v: 1, rules: PALM_LINES_VERSION, hand: ["left", "right"].includes(m2.hand?.detected) ? m2.hand.detected : null, merged, lines };
}

/** 기기에서 읽은 요약이 쓸 만한지(옛 저장·손으로 고친 값은 null). */
export function readSummary(x) {
  if (!x || x.v !== 1 || !Array.isArray(x.lines)) return null;
  const lines = x.lines.filter((l) => l && (LINE_KEYS.includes(l.key) || l.key === "hand") && ["clear", "faint", "no", "unclear"].includes(l.seen))
    .map((l) => ({ key: l.key, seen: l.seen, marks: (Array.isArray(l.marks) ? l.marks : []).filter((m) => typeof m === "string").slice(0, 8),
      traits: (Array.isArray(l.traits) ? l.traits : []).filter((m) => typeof m === "string").slice(0, 8), text: textOk(l.text) ? l.text : null }));
  return lines.length ? { v: 1, rules: x.rules ?? PALM_LINES_VERSION, hand: ["left", "right"].includes(x.hand) ? x.hand : null, merged: x.merged === true, lines } : null;
}

// 선 하나의 모양 → [이어 쓰는 꼴, 끝맺는 꼴] 목록
function shapePairs(line) {
  if (line.key === "hand") {
    const v = Object.fromEntries(line.marks.map((m) => m.split("=")));
    const out = [];
    const pa = HAND_SHAPE.palm[v["hand_shape.palm"]], fi = HAND_SHAPE.fingers[v["hand_shape.fingers"]];
    if (pa && fi) out.push([`${pa} ${fi[0]}`, `${pa} ${fi[1]}`]);
    if (v["hand.simian_crease"] === "yes") out.push(SHAPE["hand.simian_crease"].yes);
    return out;
  }
  const out = [];
  for (const m of line.marks) {
    const [k, v] = m.split("=");
    const p = SHAPE[k]?.[v];
    if (p && !out.some((q) => q[1] === p[1])) out.push(p);
  }
  return out;
}

// ── 같은 축 반대 방향 문장 막기(글 기준) ──
// 특성 id 끼리의 모순(traits.js conflicts)만 보면 판독이 직접 쓴 단락은 못 잡는다 — 두뇌선 단락 "생각을 차분히 쌓아 가는 편이에요"
// (특성은 thinking.deep 이라 속도 축이 아님)와 손 모양 "먼저 움직이고 밀고 나가는 편" 이 한 손금 안에 같이 나온 적이 있다(2026-11-16).
// 그래서 단락 글 자체에서 축의 방향을 읽는다. 축: pace(속도) — -1 살피고 차분히·신중하게, +1 먼저 움직이고 빠르게 밀고 나감.
// 새로 걸리는 말이 나오면 여기 한 줄 더한다(검사: _infra/fortune-palm-lines.test.mjs 「같은 축 반대 방향」).
export const PALM_TEXT_AXES = {
  pace: {
    [-1]: /차분히|차분하게 (?:쌓|생각|살피|따지|정리하고 움직|시작)|신중|살피|살펴|천천히|조심스럽|꼼꼼히 따져|쌓아 가|쌓아가|따져 보고|둘러보고|돌다리/,
    [1]: /먼저 움직|밀고 나가|밀어붙|행동이 빠르|빠르게 (?:움직|결정|행동|실행|밀)|결정이 빠르|추진력|과감|망설이지 않|바로 (?:움직|실행|행동|뛰어)|일단 (?:해 보|부딪|움직)|앞뒤 재지 않/,
  },
};
/** 글 → 축마다 방향 모음 { pace: Set(-1|1) } (말이 없으면 빈 칸) */
export function textDirs(text) {
  const out = {};
  for (const [axis, poles] of Object.entries(PALM_TEXT_AXES)) {
    for (const pole of [-1, 1]) if (poles[pole].test(String(text || ""))) (out[axis] ??= new Set()).add(pole);
  }
  return out;
}
/** 이미 쓴 방향(dirs)과 반대 방향이 글에 있으면 true */
export function clashes(text, dirs) {
  const d = textDirs(text);
  return Object.entries(d).some(([axis, poles]) => [...poles].some((p) => dirs[axis]?.has(-p)));
}
const addDirs = (dirs, text) => { for (const [axis, poles] of Object.entries(textDirs(text))) for (const p of poles) (dirs[axis] ??= new Set()).add(p); };

/**
 * 요약 → 노트 단락과 뺀 뜻. opts.hide: 노트가 모순이라 뺀 특성 id(공통 어휘) 모음 — 상담 노트는 note.js 의 excludedIdsOf 를 넘긴다.
 * opts.shown: 같은 화면에 이미 보이는 특성 id(노트 카드) — 이것과 모순인 뜻·반대 방향 글은 뺀다.
 * 선 순서(생명·두뇌·감정·운명 → 손 모양)대로 한 단락씩 정하고, 앞 단락 글이 정한 방향과 반대인 판독 단락은 표로 쓴 단락으로,
 * 반대인 뜻은 뺀다. 반환: { paras, dropped: Set(뺀 특성 id), dirs: 화면에 쓴 방향 }
 */
export function palmLineView(summary, { hide = new Set(), shown = [] } = {}) {
  const s = readSummary(summary);
  if (!s) return { paras: [], dropped: new Set(hide), dirs: {} };
  const kept = [...shown];
  const drop = new Set(hide);
  const dirs = {};
  for (const id of shown) addDirs(dirs, TRAITS[id]?.label);
  const done = new Map();
  for (const line of [...s.lines].sort((a, b) => (a.key === "hand") - (b.key === "hand"))) {
    const name = PALM_LINE_NAME[line.key];
    const base = { key: line.key, name, color: PALM_LINE_COLOR[line.key], seen: line.seen, chip: PALM_LINE_TEXT.chip[line.seen] };
    if (line.seen === "no" || line.seen === "unclear") {
      done.set(line, { ...base, shapes: [], meanings: [], body: line.key === "fate" ? PALM_LINE_TEXT.fateMissing : PALM_LINE_TEXT.missing(name), from: "missing" });
      continue;
    }
    const ids = line.traits.map(traitId);
    for (const id of ids) {
      if (drop.has(id) || kept.includes(id)) continue;
      if (kept.some((k) => conflicts(k, id)) || clashes(TRAITS[id]?.label, dirs)) drop.add(id); else kept.push(id);
    }
    const pairs = shapePairs(line);
    const shapes = pairs.map((p) => p[1]);
    const meanings = [...new Set(ids.filter((id) => TRAITS[id] && !drop.has(id)).map((id) => TRAITS[id].label))];
    const blocked = ids.some((id) => drop.has(id));
    let para;
    if (line.text && !blocked && !clashes(line.text, dirs)) para = { ...base, shapes, meanings, body: line.text, from: "reading" };
    else {
      const parts = [];
      if (line.key !== "hand") parts.push(PALM_LINE_TEXT.seen[line.seen]);
      if (line.key === "fate" && s.merged) parts.push(PALM_LINE_TEXT.merged);
      if (pairs.length) parts.push(joinShapes(pairs));
      if (meanings.length) parts.push(PALM_LINE_TEXT.meaning(meanings));
      else if (!shapes.length) parts.push(PALM_LINE_TEXT.plain);
      para = { ...base, shapes, meanings, body: `${name}은 ${parts.join(" ")}`, from: "table" };
    }
    addDirs(dirs, para.body);
    done.set(line, para);
  }
  return { paras: s.lines.map((line) => done.get(line)), dropped: drop, dirs };
}

/** 단락만 — [{ key, name, color, seen, chip, shapes: [문장], meanings: [~한 편], body, from: "reading"|"table"|"missing" }] */
export function palmLineParas(summary, opts) {
  return palmLineView(summary, opts).paras;
}

// 검사용 — 표로 쓸 수 있는 모든 문장
export function allPalmLineTexts() {
  const out = [...Object.values(PALM_LINE_TEXT.seen), ...Object.values(PALM_LINE_TEXT.chip), PALM_LINE_TEXT.fateMissing, PALM_LINE_TEXT.merged, PALM_LINE_TEXT.plain,
    ...LINE_KEYS.map((k) => PALM_LINE_TEXT.missing(PALM_LINE_NAME[k])), PALM_LINE_TEXT.meaning(["한 가지를 깊고 넓게 생각하는 편"])];
  for (const tbl of Object.values(SHAPE)) for (const [a, b] of Object.values(tbl)) out.push(a, b);
  for (const p of Object.values(HAND_SHAPE.palm)) for (const f of Object.values(HAND_SHAPE.fingers)) out.push(`${p} ${f[1]}`);
  return out;
}
