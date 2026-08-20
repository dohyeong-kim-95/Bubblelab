// 곡·줄·복습 일정의 규칙. 화면과 _infra/espanol.test.mjs 가 같이 쓰는 순수 함수만
// 둔다 — 저장은 localStorage(app.js)이고 서버로 나가는 것은 없다.
//
// 가사는 사용자가 직접 붙여넣은 것이고 이 브라우저 밖으로 나가지 않는다.
// 리포에도, 워커에도 가사를 두지 않는다.

export const STORAGE_KEY = "bl_espanol_v1";
export const SONGS_MAX = 40;
export const LINES_MAX = 160;
export const TITLE_MAX = 60;
export const ARTIST_MAX = 40;
export const LINE_MAX = 120;
export const KO_MAX = 120;

// 상자별로 다음에 다시 나올 때까지의 날수. 틀리면 1번 상자로 내려온다.
export const INTERVALS = [0, 1, 2, 4, 8, 16];
// 이 상자까지 올라온 줄을 "가사 없이 알아듣는 줄"로 센다 — 하루 뒤에도, 이틀 뒤에도
// 맞혀야 도달한다. 한 번 맞힌 것을 익혔다고 세면 진행률이 거짓말을 한다.
export const KNOWN_BOX = 3;
// 한 번에 새로 꺼내는 줄 수. 처음 보는 줄을 스무 개씩 밀어넣으면 그날로 끝난다.
export const FRESH_PER_SESSION = 8;

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

export function addDays(date, days) {
  const stamp = new Date(`${date}T00:00:00Z`);
  stamp.setUTCDate(stamp.getUTCDate() + days);
  return stamp.toISOString().slice(0, 10);
}

export const emptyState = () => ({ v: 1, songs: [] });

/* ── 가사 ──────────────────────────────────────────────────────────────── */

/** 붙여넣은 덩어리를 줄로 나눈다. [Coro]·(x2) 같은 표시는 노래가 아니라 안내다. */
export function parseLyrics(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => clean(line, LINE_MAX))
    .filter((line) => line && !/^[[(].*[\])]$/.test(line))
    .slice(0, LINES_MAX);
}

const makeLine = (es) => ({ id: crypto.randomUUID(), es, ko: "", box: 0, due: "", t: null });

/**
 * 가사를 다시 붙여넣어도 진도가 날아가지 않게 한다 — 같은 문장이면 상자·뜻·
 * 시각을 그대로 물려준다. 후렴처럼 같은 줄이 여러 번이면 나온 순서대로 짝짓는다.
 */
export function linesFrom(text, previous = []) {
  const pool = new Map();
  for (const line of previous) {
    const key = line.es.toLowerCase();
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(line);
  }
  return parseLyrics(text).map((es) => {
    const kept = pool.get(es.toLowerCase())?.shift();
    return kept ? { ...kept, es } : makeLine(es);
  });
}

export function makeSong(fields = {}, now = new Date()) {
  const title = clean(fields.title, TITLE_MAX);
  if (!title) throw new Error("제목을 적어주세요");
  const lines = linesFrom(fields.lyrics);
  if (!lines.length) throw new Error("가사를 한 줄이라도 붙여넣어 주세요");
  return {
    id: crypto.randomUUID(),
    title,
    artist: clean(fields.artist, ARTIST_MAX),
    createdAt: now.toISOString(),
    lines,
  };
}

/* ── 상태 ──────────────────────────────────────────────────────────────── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseLine(value) {
  const es = clean(value?.es, LINE_MAX);
  if (!es) return null;
  const box = Number.isInteger(value?.box) ? Math.min(Math.max(value.box, 0), INTERVALS.length - 1) : 0;
  return {
    id: typeof value?.id === "string" && value.id ? value.id : crypto.randomUUID(),
    es,
    ko: clean(value?.ko, KO_MAX),
    box,
    due: DATE.test(value?.due ?? "") ? value.due : "",
    t: Number.isFinite(value?.t) && value.t >= 0 ? value.t : null,
  };
}

/** 저장된 값을 그대로 믿지 않는다. 형식이 어긋난 곡·줄은 버리고 나머지로 시작한다. */
export function parseState(raw) {
  let value;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return emptyState(); }
  if (!value || value.v !== 1 || !Array.isArray(value.songs)) return emptyState();
  const songs = value.songs.map((song) => {
    const title = clean(song?.title, TITLE_MAX);
    const lines = (Array.isArray(song?.lines) ? song.lines : [])
      .map(parseLine).filter(Boolean).slice(0, LINES_MAX);
    if (!title || !lines.length) return null;
    return {
      id: typeof song?.id === "string" && song.id ? song.id : crypto.randomUUID(),
      title,
      artist: clean(song?.artist, ARTIST_MAX),
      createdAt: typeof song?.createdAt === "string" ? song.createdAt : new Date().toISOString(),
      lines,
    };
  }).filter(Boolean).slice(0, SONGS_MAX);
  return { v: 1, songs };
}

export const songById = (state, songId) => state.songs.find((song) => song.id === songId) ?? null;

const mapSong = (state, songId, change) => ({
  ...state,
  songs: state.songs.map((song) => (song.id === songId ? change(song) : song)),
});

const mapLine = (state, songId, lineId, change) => mapSong(state, songId, (song) => ({
  ...song,
  lines: song.lines.map((line) => (line.id === lineId ? change(line) : line)),
}));

export function addSong(state, fields, now = new Date()) {
  if (state.songs.length >= SONGS_MAX) throw new Error(`노래는 ${SONGS_MAX}곡까지예요`);
  return { ...state, songs: [makeSong(fields, now), ...state.songs] };
}

export function updateSong(state, songId, fields) {
  const song = songById(state, songId);
  if (!song) throw new Error("그런 노래가 없어요");
  const title = clean(fields.title, TITLE_MAX);
  if (!title) throw new Error("제목을 적어주세요");
  // 가사를 새로 넘겼을 때만 줄을 다시 만든다 (제목만 고치는 경우가 더 잦다).
  const lines = fields.lyrics === undefined ? song.lines : linesFrom(fields.lyrics, song.lines);
  if (!lines.length) throw new Error("가사를 한 줄이라도 붙여넣어 주세요");
  return mapSong(state, songId, (found) => ({
    ...found, title, artist: clean(fields.artist, ARTIST_MAX), lines,
  }));
}

export const removeSong = (state, songId) => ({
  ...state, songs: state.songs.filter((song) => song.id !== songId),
});

export const setLineKo = (state, songId, lineId, ko) =>
  mapLine(state, songId, lineId, (line) => ({ ...line, ko: clean(ko, KO_MAX) }));

/**
 * 누른 순간과 그 줄이 실제로 시작한 순간은 다르다 — 듣고 손이 움직이는 데 걸리는
 * 만큼 늦다. 그만큼 앞을 찍는다. 조금 이른 것은 앞 소절이 살짝 들리는 정도지만,
 * 늦으면 첫 음절이 잘려 나가 따라 부를 수가 없다.
 */
export const REACTION_LEAD = 0.4;

/** 음원에서 이 줄이 시작하는 시각. 찍어 두면 그 줄만 반복 재생할 수 있다. */
export const setMark = (state, songId, lineId, seconds) =>
  mapLine(state, songId, lineId, (line) => ({
    // 곡 맨 앞에서 누르면 빼기만으로 음수가 된다 — 0 으로 잡아 두지 않으면
    // 찍은 것이 통째로 사라진다(음수는 "안 찍음"으로 읽힌다).
    ...line, t: Number.isFinite(seconds) ? Math.round(Math.max(0, seconds) * 10) / 10 : null,
  }));

export const clearMarks = (state, songId) =>
  mapSong(state, songId, (song) => ({ ...song, lines: song.lines.map((line) => ({ ...line, t: null })) }));

/** 반복 재생할 구간. 끝은 다음으로 찍힌 줄이고, 없으면 곡 끝까지다. */
export function lineSpan(song, lineId) {
  const marked = song.lines.filter((line) => line.t !== null).sort((a, b) => a.t - b.t);
  const index = marked.findIndex((line) => line.id === lineId);
  if (index < 0) return null;
  return { start: marked[index].t, end: marked[index + 1]?.t ?? null };
}

/* ── 복습 ──────────────────────────────────────────────────────────────── */

/**
 * 연습에 쓰는 줄. 후렴처럼 똑같은 줄이 여러 번 나오면 한 장으로 친다 —
 * 같은 문장을 네 번 물어보면 연습이 아니라 벌이다.
 */
export function deckLines(song) {
  const seen = new Set();
  return song.lines.filter((line) => {
    const key = line.es.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dueLines(song, today = kstDate()) {
  const deck = deckLines(song);
  const review = deck.filter((line) => line.box > 0 && line.due && line.due <= today);
  const fresh = deck.filter((line) => line.box === 0).slice(0, FRESH_PER_SESSION);
  return [...review, ...fresh];
}

export function grade(state, songId, lineId, ok, today = kstDate()) {
  return mapSong(state, songId, (song) => {
    const target = song.lines.find((line) => line.id === lineId);
    if (!target) return song;
    const box = ok ? Math.min(target.box + 1, INTERVALS.length - 1) : 1;
    const due = addDays(today, INTERVALS[box]);
    // 같은 문장(후렴)은 한꺼번에 올린다 — 덱에서 한 장으로 쳤으니 기록도 하나여야 한다.
    const key = target.es.toLowerCase();
    return {
      ...song,
      lines: song.lines.map((line) => (line.es.toLowerCase() === key ? { ...line, box, due } : line)),
    };
  });
}

export function progressOf(song, today = kstDate()) {
  const deck = deckLines(song);
  return {
    total: deck.length,
    known: deck.filter((line) => line.box >= KNOWN_BOX).length,
    due: dueLines(song, today).length,
    marked: deck.filter((line) => line.t !== null).length,
  };
}
