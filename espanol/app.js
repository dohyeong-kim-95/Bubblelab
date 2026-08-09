// espanol.bubblelab.dev 공용 헬퍼. 페이지들이 함께 쓰는 네 가지만 담는다:
//   ① 스페인어 읽어주기 (공용 _shared/tts.js 위에 얇게)
//   ② localStorage 저장소 (한 접두사 아래로 모아 다른 토이와 섞이지 않게)
//   ③ 훈련 카드 덱 — 단어 + 덩어리 + 시청 일지에서 직접 잡은 표현
//   ④ 라이트너 상자 방식의 복습 일정 계산
//
// 서버가 없다. 기록은 전부 이 브라우저 안에만 있다 — 일지 페이지에서
// 내보내기/가져오기로 기기를 옮긴다.

import { WORDS } from "./data/words.js";
import { CHUNKS } from "./data/chunks.js";

/* ── ① 읽어주기 ───────────────────────────────────────────── */
// 스페인 본토 발음이 기준이라 es-ES 를 먼저 찾고, 없으면 아무 스페인어 목소리나 쓴다.
// (blTTS 가 pickVoice 에서 지역 불일치를 이미 감당한다.)
export const LANG = "es-ES";

export function speak(text, { rate = 0.95 } = {}) {
  const tts = window.blTTS;
  if (!tts) return Promise.resolve("unsupported");
  return tts.speak(text, { lang: LANG, rate });
}

export function hasSpanishVoice() {
  return !!window.blTTS?.supported && window.blTTS.hasVoice("es");
}

// 목소리 목록은 첫 순간에 비어 있는 브라우저가 많다. 준비를 기다린 뒤 판정한다.
export async function voiceReady() {
  try { await window.blTTS?.ready; } catch (_) { /* 목소리 없이도 화면은 돈다 */ }
  return hasSpanishVoice();
}

// 항목 하나를 읽어주는 동그란 버튼. 누르면 재생 중 표시가 켜진다.
export function sayButton(getText, label = "스페인어로 듣기") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "say";
  btn.textContent = "🔊";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = typeof getText === "function" ? getText() : getText;
    if (!text) return;
    btn.dataset.on = "1";
    // iOS는 클릭 핸들러 안에서 speak()가 불려야 소리가 난다 — await 하지 않는다.
    speak(text).then(() => { delete btn.dataset.on; }, () => { delete btn.dataset.on; });
  });
  return btn;
}

// 글로 쓴 페이지(발음·문법)에서 예시마다 버튼을 손으로 달면 본문이 안 읽힌다.
// `data-say` 를 붙인 요소 앞에 버튼을 하나씩 꽂아 준다. 읽을 내용은 속성 값이고,
// 비어 있으면 요소의 글자를 그대로 읽는다.
export function mountSayButtons(root = document) {
  for (const el of root.querySelectorAll("[data-say]")) {
    if (el.dataset.sayReady) continue;          // 두 번 부르면 버튼이 겹친다
    el.dataset.sayReady = "1";
    const text = el.dataset.say || el.textContent.trim();
    if (!text) continue;
    el.before(sayButton(text, `${text} 듣기`));
  }
}

// 목소리가 없는 기기에서 버튼만 잔뜩 두면 고장으로 보인다. 이유를 한 줄 알려준다.
export async function warnIfNoVoice(target) {
  if (!target) return;
  if (await voiceReady()) return;
  const note = document.createElement("p");
  note.className = "note warn";
  note.textContent =
    "이 기기에 스페인어 목소리가 없어서 🔊 버튼이 조용할 수 있어요. " +
    "안드로이드는 설정 → 언어에서 스페인어 음성을 받으면, 아이폰은 설정 → 손쉬운 사용 → 낭독 콘텐츠에서 스페인어 음성을 받으면 들립니다.";
  target.prepend(note);
}

/* ── ② 저장소 ─────────────────────────────────────────────── */
const PREFIX = "bl-es-";

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;               // 사생활 보호 모드 등에서 접근이 막히면 조용히 기본값
    }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (_) {}
  },
};

export const KEYS = {
  srs: "srs",       // { [카드id]: { box, due, seen, right } }
  star: "star",     // 먼저 외우고 싶은 카드 id 목록
  log: "log",       // 시청 일지 항목
  daily: "daily",   // { "2026-08-09": 훈련한 카드 수 }
  rude: "rude",     // 비속어 묶음을 펼쳐 둘지
  watch: "watch",   // { pass: 회차, at: "1:23:45" } — 어디까지 봤나
};

// 내보내기/가져오기가 다루는 키. 새 키를 늘리면 여기도 한 줄 늘린다 —
// 빠뜨리면 기기를 옮길 때 그 기록만 조용히 사라진다.
export const BACKUP_KEYS = Object.values(KEYS);

/* ── 날짜 ─────────────────────────────────────────────────── */
// UTC로 자르면 한국 저녁이 다음 날로 넘어간다. 지역 시간 기준으로 만든다.
export function today(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return today(new Date(y, m - 1, d + days));
}

/* ── ③ 훈련 덱 ────────────────────────────────────────────── */
// 카드 id 는 내용에서 바로 나온다 — 순번을 쓰면 데이터에 한 줄 끼워 넣을 때
// 예전 기록이 다른 카드로 밀려 버린다.
export const wordId = (word) => `w:${word.es}`;
export const chunkId = (chunk) => `c:${chunk.es}`;

export function deck({ includeRude = false } = {}) {
  const cards = [
    ...WORDS.map((word) => ({
      id: wordId(word),
      es: word.es,
      ko: word.ko,
      pr: word.pr,
      hint: word.ex ? `${word.ex} — ${word.exKo}` : "",
      kind: "word",
      group: word.groupTitle,
    })),
    ...CHUNKS.filter((chunk) => includeRude || !chunk.rude).map((chunk) => ({
      id: chunkId(chunk),
      es: chunk.es,
      ko: chunk.ko,
      pr: chunk.pr,
      hint: chunk.when,
      kind: "chunk",
      group: chunk.groupTitle,
    })),
    ...store.get(KEYS.log, [])
      .filter((entry) => entry.es && entry.ko)
      .map((entry) => ({
        id: `l:${entry.id}`,
        es: entry.es,
        ko: entry.ko,
        pr: "",
        hint: entry.note || (entry.at ? `${entry.at} 장면에서 들었다` : ""),
        kind: "caught",
        group: "내가 잡은 표현",
      })),
  ];
  // 같은 표현을 일지에도 적어 두면 카드가 둘이 된다. 먼저 온 것(데이터 쪽)을 남긴다.
  const seen = new Set();
  return cards.filter((card) => {
    const key = card.es.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── ④ 복습 일정 (라이트너 상자) ──────────────────────────── */
// 상자 1~5. 맞히면 한 칸 올라가고 다음 복습이 멀어진다. 틀리면 1번으로 내려온다.
// SM-2 같은 정교한 알고리즘을 쓰지 않는 이유: 하루 10분짜리 습관에는 이 정도가
// 충분하고, 저장 형태가 단순해야 내보내기/가져오기가 안 깨진다.
export const INTERVALS = [0, 1, 2, 4, 8, 16];

export function cardState(srs, id) {
  return srs[id] || { box: 0, due: "", seen: 0, right: 0 };
}

export function isDue(srs, id, day = today()) {
  const state = cardState(srs, id);
  if (!state.box) return true;            // 한 번도 안 본 카드는 늘 대기 중
  return !state.due || state.due <= day;
}

export function grade(srs, id, correct, day = today()) {
  const state = cardState(srs, id);
  const box = correct ? Math.min(5, (state.box || 0) + 1) : 1;
  srs[id] = {
    box,
    due: addDays(day, INTERVALS[box]),
    seen: (state.seen || 0) + 1,
    right: (state.right || 0) + (correct ? 1 : 0),
  };
  return srs[id];
}

export function progress(srs, cards) {
  let learning = 0, known = 0;
  for (const card of cards) {
    const box = cardState(srs, card.id).box;
    if (box >= 4) known += 1;
    else if (box >= 1) learning += 1;
  }
  return { total: cards.length, learning, known, fresh: cards.length - learning - known };
}

/* ── 연속 학습일 ──────────────────────────────────────────── */
export function streakOf(daily, day = today()) {
  let streak = 0;
  let cursor = day;
  // 오늘 아직 안 했으면 어제까지의 연속을 보여준다 (오늘 하면 그대로 이어진다).
  if (!daily[cursor]) cursor = addDays(cursor, -1);
  while (daily[cursor]) { streak += 1; cursor = addDays(cursor, -1); }
  return streak;
}

/* ── 잡동사니 ─────────────────────────────────────────────── */
// 날짜에서 같은 수가 나오게 — "오늘의 단어"가 하루 동안 바뀌지 않는다.
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickDaily(list, count, day = today()) {
  if (!list.length) return [];
  const out = [];
  const used = new Set();
  let seed = seedOf(day);
  while (out.length < Math.min(count, list.length)) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const index = seed % list.length;
    if (used.has(index)) continue;
    used.add(index);
    out.push(list[index]);
  }
  return out;
}

export function shuffle(list, seed = Date.now()) {
  const out = list.slice();
  let state = seedOf(String(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 오늘 훈련한 카드 수를 더한다. 홈의 연속 학습일이 이 값을 읽는다.
export function countToday(n = 1) {
  const daily = store.get(KEYS.daily, {});
  const day = today();
  daily[day] = (daily[day] || 0) + n;
  // 기록이 무한정 자라지 않게 최근 400일만 남긴다.
  const keys = Object.keys(daily).sort();
  while (keys.length > 400) delete daily[keys.shift()];
  store.set(KEYS.daily, daily);
  return daily[day];
}
