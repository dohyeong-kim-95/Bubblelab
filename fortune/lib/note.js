// 다그당스 종합 노트 — 겹침 규칙·운세별 한 줄·모순 검사·노트 조립(M4 설계 §3, §4, §6). 순수 모듈(DOM 없음).
// 원본은 fortune/lib/ 하나. 브라우저(노트 화면, 2단계)와 Node 테스트(_infra/fortune-note.test.mjs)가 같이 쓰고,
// 나중에 다그당스 대화(M6)가 같은 함수를 도구로 부른다.
//
// 지키는 것:
//  * 결정적이다 — 모든 정렬에 id 순 동점 처리가 있어 같은 입력이면 같은 노트가 나온다(seed 도 입력에서 만든다).
//  * 노트에 보이는 문장끼리 모순 0건. 서로 다른 운세가 모순 쌍을 내면 그 축은 아예 말하지 않는다(어느 쪽이 맞는지 고르지 않는다).
//  * '또렷해짐'은 실제 값만: 채운 칸 수, 근거 배지, 새로 겹친 특성. 퍼센트·점수·정확도는 문구에 넣지 않는다.
//  * v1 은 템플릿만(LLM 없음) — 한 줄 요약·다그당스 한마디는 아래 표에서 고른다(사용자 결정 2026-11-16).
//  * 입력은 특성 목록뿐이다. 생년월일·명식·사진·질문은 받지도 내보내지도 않는다.
import {
  TRAITS, PALM_ALIAS, PALM_CONF, PALM_AXES, STATES, CARD_STATE, ROLE, SOURCE_NAME, conflicts,
} from "./traits.js";

export const MERGE_RULES = {
  version: "merge-v1",
  sourceCap: { saju: 0.6, palm: 0.6, tarot: 0.3 },
  nearWeight: 0.5,          // 같은 축·같은 극의 다른 id 는 절반만
  overlapMin: 0.55,         // 겹치는 특성으로 짚는 최소 점수
  conflictMin: 0.2,         // 서로 다른 운세가 모순 쌍을 이 값 이상으로 내면 그 축을 노트에서 뺀다
  otherSides: false,        // "다른 면" 표시는 기본에서 뺐다 — 재료(excluded)만 남긴다(대화 M6 용)
  singleMin: 0.45,          // 겹침이 모자랄 때 한 운세 특성으로 채우는 최소값(= 화면 문턱)
  show: 3,
};
export const NOTE_VERSION = "note-v1";
const SLOTS = ["saju", "palm", "tarot"];
const r2 = (x) => Math.round(x * 100) / 100;

// ── 입력 바꾸기 ──

// 손금 결과(palm.m2.v1, 또는 기기에 저장한 {status, traits}) → 공통 형식. 어휘에 없는 id 는 건너뛴다(손금 쪽이 새 id 를 내도 노트가 깨지지 않게).
export function palmTraits(m2) {
  if (!m2 || !(m2.ok === true || m2.status === "ok")) return [];
  const out = [];
  for (const t of m2.traits || []) {
    const id = PALM_ALIAS[t.trait] ?? t.trait;
    if (!TRAITS[id]) continue;
    out.push({ trait: id, label: TRAITS[id].label, kind: "trait", evidence: t.evidence || [], confidence: PALM_CONF[t.confidence] ?? PALM_CONF.low, source: "palm" });
  }
  return out;
}

// 타로 readTarot() 출력 → state. 첫 자리(today·now·마음 3장의 me)만 — block 은 '걸림' 문구로만 쓰고 겹침에 넣지 않는다.
// 거꾸로 나온 카드는 state 를 내지 않는다(역방향은 '조심할 점'이지 지금의 흐름이 아니다 — 사주·손금과 모순이 생길 틈을 두지 않는다).
// valid_until 이 지나면 없음.
export function tarotStates(read, todayISO) {
  if (!read?.cards?.length || (read.valid_until && todayISO && read.valid_until < todayISO)) return [];
  return read.cards.filter((c) => ["now", "today", "me"].includes(c.position) && !c.reversed && CARD_STATE[c.id]).map((c) => ({
    trait: CARD_STATE[c.id], label: STATES[CARD_STATE[c.id]].label, kind: "state",
    evidence: [`tarot:${c.id}@${c.position}`, `${c.name} 카드`], confidence: 0.25, source: "tarot", valid_until: read.valid_until ?? null,
  }));
}

// ── 겹침(§3) ──

export function mergeNote(sources) {
  const traits = Object.entries(sources).flatMap(([src, list]) => (list || []).filter((t) => t.kind === "trait" && TRAITS[t.trait])
    .map((t) => ({ ...t, source: src, confidence: Math.min(MERGE_RULES.sourceCap[src] ?? 0, t.confidence) })));
  const states = (sources.tarot || []).filter((t) => t.kind === "state" && STATES[t.trait]);
  const used = Object.keys(sources).filter((s) => (sources[s] || []).length);

  // 운세 × id → 가장 높은 확신도
  const best = {};
  for (const t of traits) {
    best[t.source] ??= {};
    if (!best[t.source][t.trait] || best[t.source][t.trait].confidence < t.confidence) best[t.source][t.trait] = t;
  }
  const ids = [...new Set(traits.map((t) => t.trait))];
  const scored = ids.map((id) => {
    const T = TRAITS[id];
    const badges = [];
    for (const src of Object.keys(best)) {
      const direct = best[src][id];
      let near = null;
      if (T.pole) for (const t of Object.values(best[src])) {
        if (t.trait !== id && TRAITS[t.trait].axis === T.axis && TRAITS[t.trait].pole === T.pole && (!near || t.confidence > near.confidence)) near = t;
      }
      const dv = direct?.confidence ?? 0, nv = near ? near.confidence * MERGE_RULES.nearWeight : 0;
      if (dv || nv) badges.push(dv >= nv
        ? { source: src, how: "same", value: dv, evidence: direct.evidence[direct.evidence.length - 1] ?? "" }
        : { source: src, how: "near", value: nv, via: near.trait, evidence: near.evidence[near.evidence.length - 1] ?? "" });
    }
    const score = 1 - badges.reduce((p, b) => p * (1 - b.value), 1);
    return { trait: id, label: T.label, axis: T.axis, pole: T.pole, score: r2(score), badges,
      direct: badges.filter((b) => b.how === "same").length };
  });
  const order = (a, b) => b.badges.length - a.badges.length || b.direct - a.direct || b.score - a.score || a.trait.localeCompare(b.trait);

  // 모순 축 빼기(규칙 6, 1~5 보다 먼저): 서로 다른 운세가 모순 쌍을 각각 conflictMin 이상으로 냈으면
  // 두 id 와 그 축의 id 를 모두 뺀다.
  const excluded = [];
  for (const a of traits) for (const b of traits) {
    if (a.source < b.source && a.confidence >= MERGE_RULES.conflictMin && b.confidence >= MERGE_RULES.conflictMin && conflicts(a.trait, b.trait)) {
      excluded.push({ a: a.trait, a_src: a.source, b: b.trait, b_src: b.source });
    }
  }
  const excludedIds = excludedIdsOf(excluded);
  const ok = (s) => !excludedIds.has(s.trait);
  const overlaps = scored.filter((s) => ok(s) && s.badges.length >= 2 && s.direct >= 1 && s.score >= MERGE_RULES.overlapMin).sort(order);

  // 축마다 하나, 이미 고른 카드와 모순 쌍이면 건너뜀(같은 운세 안의 교차 모순도 여기서 막는다)
  const pickAxis = new Set(), shown = [];
  const fits = (s) => !pickAxis.has(s.axis) && !shown.some((x) => conflicts(x.trait, s.trait));
  const take = (s, type) => { pickAxis.add(s.axis); shown.push({ ...s, type, roles: s.badges.map((b) => ROLE[b.source]) }); };
  for (const s of overlaps) if (shown.length < MERGE_RULES.show && fits(s)) take(s, "overlap");
  // 겹침이 모자라면 한 운세 특성으로 — 사주 → 손금을 번갈아 골라, 운세를 더했을 때 앞서 보이던 특성이 밀려나지 않게.
  const singles = scored.filter((s) => ok(s) && s.direct >= 1 && s.score >= MERGE_RULES.singleMin && !overlaps.includes(s)).sort(order);
  const queues = ["saju", "palm"].map((src) => singles.filter((s) => s.badges[0].source === src));
  for (let k = 0; shown.length < MERGE_RULES.show && queues.some((q) => q.length); k++) {
    const q = queues[k % queues.length];
    while (q.length) { const s = q.shift(); if (fits(s)) { take(s, "single"); break; } }
  }

  // 지금의 흐름(타로, 역할 '요즘') — 점수에 영향 없음. 바탕 카드와 엇갈리면 against 를 남기고 문장은 "요즘은 …"으로만.
  const now = states.map((s) => {
    const lean = STATES[s.trait].lean;
    const against = lean ? shown.find((t) => t.axis === lean[0] && t.pole === -lean[1]) : null;
    return { state: s.trait, label: s.label, role: ROLE.tarot, evidence: s.evidence, against: against ? { trait: against.trait, label: against.label } : null };
  });
  return {
    rules: MERGE_RULES.version, sources_used: used,
    progress: { done: used.length, of: 3, disposition_sources: Object.keys(best).length,
      overlap_count: overlaps.length, badge_count: shown.reduce((n, s) => n + s.badges.length, 0) },
    shown, excluded, now,
  };
}

// 모순이라 노트에서 뺀 id 모두 — 모순 쌍의 두 id 와 그 축(극이 있으면)의 id 전부. 손금 선별 풀이(palm-lines.js)도 이걸로 그 뜻을 뺀다.
export function excludedIdsOf(excluded) {
  const ids = new Set();
  for (const e of excluded || []) for (const id of [e.a, e.b]) {
    const T = TRAITS[id];
    if (!T) continue;
    for (const U of Object.values(TRAITS)) if (U.id === id || (T.pole && U.axis === T.axis)) ids.add(U.id);
  }
  return ids;
}

// 운세를 하나 더했을 때 실제로 바뀐 것만(부풀리지 않는 '또렷해짐' 재료, §3-3).
export function delta(before, after) {
  const prev = new Map(before.shown.map((s) => [s.trait, s]));
  const changes = [];
  for (const s of after.shown) {
    const p = prev.get(s.trait);
    if (!p) changes.push({ kind: s.type === "overlap" ? "new_overlap" : "new_trait", trait: s.trait, label: s.label, badges: s.badges.map((b) => b.source) });
    else if (s.badges.length > p.badges.length) changes.push({ kind: "more_badges", trait: s.trait, label: s.label, from: p.badges.length, to: s.badges.length, badges: s.badges.map((b) => b.source) });
  }
  // 앞 단계 카드가 빠졌으면 기록만 한다 — 화면은 따로 짚지 않고 밑줄 고정 문장이 덮는다.
  const now = new Set(after.shown.map((s) => s.trait));
  for (const s of before.shown) {
    if (now.has(s.trait)) continue;
    const setAside = after.excluded.some((e) => e.a === s.trait || e.b === s.trait || TRAITS[e.a].axis === s.axis || TRAITS[e.b].axis === s.axis);
    changes.push({ kind: setAside ? "set_aside" : "replaced", trait: s.trait, label: s.label });
  }
  if (after.now.length && !before.now.length) changes.push({ kind: "now_added", label: after.now[0].label });
  return changes;
}

// ── 운세별 한 줄(§3-3) ──
// 빠진 축이 아니고, 보이는 카드·이미 고른 한 줄과 모순이 아니고, 다른 운세가 (문턱 아래라도) 반대로 본 특성이 아니어야 한다.
// 위 카드와 같은 특성은 되풀이하지 않는다(다른 후보가 없을 때만 허용). 맞는 게 없으면 특성 없는 문장.
// 입력: saju = {traits, day_master:{name, traits:[…]}|null} (sajuNoteInput), palm·tarot = 공통 형식 목록.
export function oneLiners(note, { saju = null, palm = null, tarot = null } = {}) {
  const banned = new Set(note.excluded.flatMap((e) => [e.a, e.b]));
  const axisOut = new Set(note.excluded.flatMap((e) => [TRAITS[e.a].axis, TRAITS[e.b].axis]));
  const shownIds = new Set(note.shown.map((s) => s.trait));
  const sajuList = saju?.traits || [];
  const out = [];
  const others = (src) => (src === "saju" ? palm || [] : sajuList).map((t) => t.trait);
  const okId = (id, src) => TRAITS[id] && !banned.has(id) && !axisOut.has(TRAITS[id].axis)
    && !note.shown.some((s) => conflicts(s.trait, id)) && !out.some((c) => c.id && conflicts(c.id, id))
    && !others(src).some((o) => conflicts(o, id));
  const pick = (ids, src) => ids.find((x) => okId(x, src) && !shownIds.has(x)) ?? ids.find((x) => okId(x, src));
  if (saju) {
    const id = pick(saju.day_master?.traits || [], "saju");
    out.push(id ? { source: "saju", id, text: `${ROLE.saju}: ${TRAITS[id].label}` }
      : { source: "saju", id: null, text: saju.day_master ? `${ROLE.saju}: ${saju.day_master.name} 일간` : `${ROLE.saju}: 사주 칸에서 자세히 볼 수 있어요` });
  }
  if (palm?.length) {
    const id = pick([...palm].sort((a, b) => b.confidence - a.confidence || a.trait.localeCompare(b.trait)).map((t) => t.trait), "palm");
    out.push(id ? { source: "palm", id, text: `${ROLE.palm}: ${TRAITS[id].label}` }
      : { source: "palm", id: null, text: `${ROLE.palm}: 손금 칸에서 선 모양을 볼 수 있어요` });
  }
  if (tarot?.length) out.push({ source: "tarot", id: tarot[0].trait, state: true, text: `${ROLE.tarot}: ${tarot[0].label}` });
  return out;
}

// ── 모순 검사(결정적, §9-2) ── 노트에 보이는 특성 문장(카드·운세별 한 줄)을 id 로 들고 쌍마다 본다.
// 지금의 흐름(state)은 바탕과 엇갈려도 '요즘'으로만 말하면 통과 — 역할 머리말이 빠지면 모순으로 센다.
export function contradictions(note, lines) {
  const items = [
    ...note.shown.map((s) => ({ where: "card", id: s.trait })),
    ...lines.filter((l) => l.id && !l.state).map((l) => ({ where: `line:${l.source}`, id: l.id })),
  ];
  const bad = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (conflicts(items[i].id, items[j].id)) bad.push([items[i], items[j]]);
  }
  for (const n of note.now) if (n.against && n.role !== ROLE.tarot) bad.push([{ where: "now", id: n.state }, { where: "card", id: n.against.trait }]);
  return bad;
}

// ── 템플릿 문구(v1, LLM 없음) ──

const hasBatchim = (word) => {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
};
// 받침에 따라 조사 고르기: josa("편", "을", "를") → "을" (조사만 돌려준다)
export const josa = (word, withBatchim, without) => (hasBatchim(word) ? withBatchim : without);

export const NOTE_TEXT = {
  title: "내 노트",
  overlapHeader: "바탕과 습관이 같은 말을 해요",
  footer: "두 운세가 같은 말을 하거나, 서로 부딪치지 않는 것만 모았어요. 재미로 보는 풀이예요. 같은 생일·같은 손이면 같은 노트가 나와요.",
  hourHint: "태어난 시간을 알면 사주 칸이 조금 더 자세해져요.",
  // 카드가 하나도 안 나온 노트(사주만 넣은 노트의 0.3% 쯤 — 일간 특성이 같은 사주 안 반대 기운에 깎인 경우 등).
  // 비어 있다고 깎아내리지 않고, 아래 운세별 한 줄로 안내한다(설계 §6-4 "1/3 노트도 그 자체로 읽을 만하다").
  noCards: "아직 카드로 꺼낼 만큼 힘 있는 특성은 없어요. 아래 운세별 한 줄부터 읽어 보세요.",
  greeting: "어디부터 볼까요? 카드 한 장은 생일 없이도 볼 수 있어요.",
  // 세 칸을 다 채운 순간의 말풍선 — 위 한마디(closing)와 겹치지 않게 따로 둔다
  allDone: "세 칸을 다 채웠어요. 노트의 표시를 누르면 어느 운세가 어디서 짚었는지 보여요.",
  palmResting: "손금 보기는 지금 잠시 쉬고 있어요. 다른 칸부터 채워도 괜찮아요.",
  // 빈 칸(§6-2) — 무엇을 넣으면 무엇이 보이는지와 드는 수고만. 가짜 미리보기·자물쇠 없음.
  slots: {
    tarot: { icon: "🃏", name: "타로", effort: "카드 한 장 · 10초 · 생일 필요 없음", fills: "\"지금 어떤 때인지\" 칸이 채워져요" },
    saju: { icon: "📅", name: "사주", effort: "생년월일 · 30초", fills: "\"타고난 모습\" 칸이 채워져요" },
    palm: { icon: "✋", name: "손금", effort: "손바닥 사진 한 장 · 30초쯤 기다림", fills: "사주가 본 모습을 손금도 짚는지 맞춰 봐요" },
  },
  // 다그당스 한마디 폴백 — 채운 칸 수(1~3)마다 두 문장, seed 로 고른다. 특성 낱말을 넣지 않아 어떤 노트와도 부딪치지 않는다.
  closing: {
    1: ["한 칸만 채워도 노트는 노트예요. 보고 싶은 칸이 생기면 그때 더 채우면 돼요.",
      "첫 칸이 채워졌어요. 오늘은 이 한 장을 천천히 읽어 보셔도 충분해요."],
    2: ["두 칸이 모였어요. 서로 부딪치지 않는 말만 골라 적었어요.",
      "노트가 두 칸 찼어요. 마음에 걸리는 줄이 있으면 그 운세 칸을 다시 열어 보세요."],
    3: ["세 칸을 다 채웠어요. 오늘은 여기까지 보고, 카드는 일주일 뒤에 새로 뽑을 수 있어요.",
      "세 칸이 다 모였어요. 바탕과 습관, 요즘을 한 장에 적어 두었어요."],
  },
};
export const HEADLINE_MAX = 40;
export const CLOSING_MAX = 90;

// FNV-1a 32비트 — 같은 노트면 같은 문장을 고르는 seed
function seedOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// 한 줄 요약(②) 폴백: "{카드1 이음꼴}, {카드2 끝꼴} 사람" — 40자를 넘으면 뒤 카드부터 덜어 낸다.
export function headlineOf(note) {
  const cards = note.shown;
  for (let n = Math.min(cards.length, MERGE_RULES.show); n >= 1; n--) {
    const parts = cards.slice(0, n).map((c, i) => (i === n - 1 ? TRAITS[c.trait].short.adn : TRAITS[c.trait].short.and));
    const text = `${parts.slice(0, -1).join(", ")}${n > 1 ? ", " : ""}${parts[n - 1]} 사람`;
    if (text.length <= HEADLINE_MAX) return { text, traits: cards.slice(0, n).map((c) => c.trait) };
  }
  if (note.now.length) return { text: `요즘은 ${note.now[0].label}`, traits: [] };
  return null;
}

// 변화 한 줄(§6-4) — delta 에서만 고른다. 겹침이 없으면 "또렷해졌다"는 말을 쓰지 않는다.
export function deltaLine(before, after, changes = delta(before, after)) {
  const added = after.sources_used.filter((s) => !before.sources_used.includes(s));
  const prevNames = before.sources_used.filter((s) => s !== "tarot").map((s) => SOURCE_NAME[s]);
  const grew = changes.find((c) => c.kind === "new_overlap" || c.kind === "more_badges");
  const newName = added.filter((s) => s !== "tarot").map((s) => SOURCE_NAME[s]).join("·");
  if (grew && newName && prevNames.length) {
    const count = ["", "한", "두", "세"][grew.badges.length] || "여러";
    return { kind: grew.kind, text: `${prevNames.join("·")}만으로 본 모습 → ${newName}까지 더하니 「${grew.label}」${josa(grew.label, "을", "를")} ${count} 군데서 짚었어요.` };
  }
  const fresh = changes.find((c) => c.kind === "new_trait" && c.badges.some((b) => added.includes(b)));
  if (fresh) {
    const name = SOURCE_NAME[fresh.badges.find((b) => added.includes(b))];
    return { kind: "new_trait", text: `${name}${josa(name, "은", "는")} 「${fresh.label}」 쪽을 새로 보여 줬어요.` };
  }
  const now = changes.find((c) => c.kind === "now_added");
  if (now) return { kind: "now_added", text: `지금은 「${now.label}」${josa(now.label, "이라는", "라는")} 칸이 채워졌어요.` };
  return null;   // set_aside·replaced 는 따로 말하지 않는다 — 밑줄 고정 문장이 덮는다
}

// 입력 묶음 → 노트 재료와 입력 목록(공통 형식)
function inputsOf({ saju = null, palm = null, tarot = null }) {
  const sources = {};
  if (saju) sources.saju = saju.traits || [];
  if (palm) sources.palm = palm;
  if (tarot?.length) sources.tarot = tarot;
  return { sources, filled: SLOTS.filter((s) => (s === "saju" ? Boolean(saju) : s === "palm" ? Boolean(palm) : Boolean(tarot?.length))) };
}

// 노트 한 장 조립(§4-2 ①~⑧). 입력은 특성 목록뿐:
//   saju  — sajuNoteInput(chart) 출력 {traits, day_master, hour_known} | null
//   palm  — palmTraits(…) 출력(공통 형식 배열) | null   (빈 배열 = 손금은 봤는데 특성이 없음)
//   tarot — tarotStates(…) 출력 | null
//   opts.before — 운세를 하나 더하기 전의 입력(같은 모양). 있으면 변화 한 줄을 붙인다.
//   opts.palmOpen — 손금방이 열려 있는지(/_fortune/palm/status). 닫혀 있으면 손금 빈 칸에 쉬는 중이라고 적는다.
export function assembleNote(input, { before = null, palmOpen = true } = {}) {
  const { sources, filled } = inputsOf(input);
  const note = mergeNote(sources);
  const lines = oneLiners(note, input);
  const stage = filled.length;
  const headline = headlineOf(note);
  const cards = note.shown.map((s) => ({
    trait: s.trait, label: s.label, type: s.type,
    header: s.type === "overlap" ? NOTE_TEXT.overlapHeader : ROLE[s.badges[0].source],
    badges: s.badges.map((b) => ({ source: b.source, name: SOURCE_NAME[b.source], role: ROLE[b.source], how: b.how, evidence: b.evidence })),
  }));
  const now = note.now.map((n) => ({ state: n.state, label: n.label, text: `요즘은 ${n.label}${josa(n.label, "이에요", "예요")}.` }));
  const closings = NOTE_TEXT.closing[stage];
  const closing = closings
    ? closings[seedOf(`${stage}|${note.shown.map((s) => s.trait).join(",")}|${note.now.map((n) => n.state).join(",")}`) % closings.length]
    : NOTE_TEXT.greeting;
  const empty = SLOTS.filter((s) => !filled.includes(s)).map((s) => ({
    source: s, ...NOTE_TEXT.slots[s], open: s !== "palm" || palmOpen, ...(s === "palm" && !palmOpen ? { resting: NOTE_TEXT.palmResting } : {}),
  }));
  let change = null;
  if (before) {
    const prev = mergeNote(inputsOf(before).sources);
    change = deltaLine(prev, note);
  }
  return {
    version: NOTE_VERSION, rules: MERGE_RULES.version,
    progress: { done: stage, of: 3, dots: "●".repeat(stage) + "○".repeat(3 - stage), filled },
    title: NOTE_TEXT.title,
    headline, cards, lines, now, closing, empty, change,
    hour_hint: input.saju && input.saju.hour_known === false ? NOTE_TEXT.hourHint : null,
    no_cards: !cards.length && (filled.includes("saju") || filled.includes("palm")) ? NOTE_TEXT.noCards : null,
    footer: NOTE_TEXT.footer,
    merge: note,   // 대화(M6)·검사용 재료 — excluded(빠진 축)는 화면에 내지 않는다
  };
}

// 노트에 보이는 모든 문장(검사·스냅샷용) — 카드, 한 줄 요약, 운세별 한 줄, 지금의 흐름, 한마디, 변화 한 줄, 빈 칸, 밑줄
export function noteTexts(n) {
  return [
    n.headline?.text, ...n.cards.map((c) => c.label), ...n.cards.flatMap((c) => c.badges.map((b) => b.evidence)),
    ...n.lines.map((l) => l.text), ...n.now.map((x) => x.text), n.closing, n.change?.text, n.hour_hint, n.no_cards,
    ...n.empty.flatMap((e) => [e.effort, e.fills, e.resting]), n.footer,
  ].filter(Boolean);
}

// ── 다음 칸 말풍선(§6-3) — 결과 끝에 말풍선 1개 + 버튼 1개. 노트의 실제 상태에서만 고른다. ──
// done: 방금 끝낸 운세. input: 끝낸 뒤의 입력 묶음, before: 끝내기 전의 입력 묶음. to = 버튼이 갈 칸(saju|palm|note).
export function nextNudge(done, input, { before = null, palmOpen = true } = {}) {
  const n = assembleNote(input, { palmOpen });
  if (n.progress.done === 3) return { say: NOTE_TEXT.allDone, button: { label: "노트 보기", to: "note" } };
  const has = (s) => n.progress.filled.includes(s);
  const toNote = { label: "노트 보기", to: "note" };
  const toBirth = { label: "생일 적기", to: "saju" };
  const changes = before ? delta(mergeNote(inputsOf(before).sources), n.merge) : [];
  const card = (src) => n.cards.find((c) => c.badges.some((b) => b.source === src));
  if (done === "tarot") {
    const state = n.now[0]?.label;
    if (!has("saju") && state) return { say: `지금은 「${state}」${josa(state, "이에요", "예요")}. 이런 때를 지나는 내가 원래 어떤 사람인지는 생일로 볼 수 있어요.`, button: toBirth };
    return { say: "노트에 「요즘」 칸을 채웠어요.", button: toNote };
  }
  if (done === "saju") {
    if (!has("palm")) {
      if (!palmOpen) return { say: NOTE_TEXT.palmResting, button: toNote };
      const c = n.cards.find((x) => PALM_AXES.includes(TRAITS[x.trait].axis));
      return c
        ? { say: `사주는 「${c.label}」${josa(c.label, "이라고", "라고")} 했어요. 손바닥 선도 같은 말을 하는지 볼까요?`, button: { label: "손금 보기", to: "palm" } }
        : { say: "손바닥 선으로는 살아오며 드러난 습관을 볼 수 있어요.", button: { label: "손금 보기", to: "palm" } };
    }
    const grew = changes.find((c) => c.kind === "new_overlap" || c.kind === "more_badges");
    return grew
      ? { say: `사주를 넣으니 「${grew.label}」${josa(grew.label, "이", "가")} 두 군데서 짚였어요.`, button: toNote }
      : { say: "사주 칸을 채웠어요. 노트에 한 칸 더 채웠어요.", button: toNote };
  }
  if (done === "palm") {
    if (!has("saju")) {
      const c = card("palm");
      return c
        ? { say: `손금은 「${c.label}」${josa(c.label, "이라고", "라고")} 했어요. 사주도 같은 말을 할지 생일로 맞춰 볼까요?`, button: toBirth }
        : { say: "손금 칸을 채웠어요. 사주도 같이 보면 노트가 더 채워져요.", button: toBirth };
    }
    const grew = changes.find((c) => (c.kind === "new_overlap" || c.kind === "more_badges") && c.badges.includes("palm"));
    if (grew) return { say: `손금도 「${grew.label}」${josa(grew.label, "을", "를")} 짚었어요. 사주와 손금이 같은 말을 했어요.`, button: toNote };
    const fresh = changes.find((c) => c.kind === "new_trait" && c.badges.includes("palm"));
    return fresh
      ? { say: `손에 드러난 습관으로는 「${fresh.label}」${josa(fresh.label, "이", "가")} 보였어요. 노트에 한 칸 더 채웠어요.`, button: toNote }
      : { say: "노트에 한 칸 더 채웠어요.", button: toNote };
  }
  return { say: NOTE_TEXT.greeting, button: null };
}
