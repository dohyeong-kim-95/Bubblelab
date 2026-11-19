// 곡 목록과 채보(밟을 순서) 생성, 판정·점수 규칙.
// 음원 파일을 두지 않는다 — 곡은 BPM과 씨앗값 뿐이고, 소리는 audio.js가
// 이 채보를 그대로 연주한다(밟는 자리 = 멜로디). 씨앗이 고정이라 같은 곡·
// 같은 난이도는 언제나 같은 채보가 나온다.

/** 씨앗 하나로 굴러가는 난수 (mulberry32) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 5음 음계(반음 단위). 멜로디가 어떻게 튀어도 듣기 싫어지지 않는다.
export const PENTATONIC = [0, 3, 5, 7, 10];

export const SONGS = [
  { id: "neon", title: "네온 골목", bpm: 124, bars: 24, root: 55, seed: 20260809, mood: "밤 산책" },
  { id: "bunny", title: "토끼 발걸음", bpm: 146, bars: 24, root: 58, seed: 71324, mood: "가볍게" },
  { id: "storm", title: "장마 전선", bpm: 168, bars: 26, root: 51, seed: 909111, mood: "몰아치는" },
  { id: "sunrise", title: "새벽 첫차", bpm: 108, bars: 22, root: 53, seed: 4242, mood: "느긋하게" },
];

// sub = 한 박을 몇 칸으로 쪼개나, gap = 노트 사이 최소 칸 수(연타 제한),
// multiplier = 어려운 난이도를 고른 만큼 점수에 얹어 주는 배수.
export const DIFFICULTIES = [
  { id: "easy", name: "쉬움", sub: 1, gap: 1, density: 0.62, jump: 0, multiplier: 0.7 },
  { id: "normal", name: "보통", sub: 2, gap: 2, density: 0.62, jump: 0.04, multiplier: 1 },
  { id: "hard", name: "어려움", sub: 2, gap: 1, density: 0.78, jump: 0.12, multiplier: 1.25 },
];

export const songOf = (id) => SONGS.find((s) => s.id === id) ?? SONGS[0];
export const difficultyOf = (id) => DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];

const LEAD_IN_BEATS = 8; // 첫 노트 전 도입부 (자세 잡을 시간)

/**
 * 채보 생성. 레인(패널) 선택은 "직전 발자리에서 너무 멀지 않게"를 기본으로 두고
 * 가끔 크게 건너뛴다 — 사람 다리로 밟을 수 있는 흐름을 만들기 위해서다.
 * @returns {{ notes: {t:number, panel:string, lane:number}[], beat:number, duration:number, leadIn:number }}
 */
export function buildChart(song, pad, difficulty) {
  const diff = typeof difficulty === "string" ? difficultyOf(difficulty) : difficulty;
  const beat = 60 / song.bpm;
  const slot = beat / diff.sub;
  const lanes = pad.panels.length;
  const random = rng(song.seed ^ (lanes * 7919) ^ (diff.sub * 104729) ^ Math.round(diff.density * 1000));

  const leadIn = LEAD_IN_BEATS * beat;
  const slots = song.bars * 4 * diff.sub;
  const notes = [];
  let last = Math.floor(lanes / 2);
  let sinceNote = 99;

  for (let i = 0; i < slots; i++) {
    sinceNote++;
    // 박 위(정박)는 더 자주, 엇박은 드물게 — 리듬이 흔들리지 않게
    const onBeat = i % diff.sub === 0;
    const chance = diff.density * (onBeat ? 1 : 0.55);
    if (sinceNote < diff.gap) continue;   // 발이 따라올 최소 간격
    if (random() > chance) continue;

    const lane = pickLane(random, lanes, last, diff);
    const t = leadIn + i * slot;
    notes.push({ t, panel: pad.panels[lane].id, lane });

    // 점프: 양발 동시. 너무 붙은 레인끼리는 만들지 않는다.
    if (random() < diff.jump) {
      const other = pickJumpPartner(random, lanes, lane);
      if (other !== null) notes.push({ t, panel: pad.panels[other].id, lane: other });
    }
    last = lane;
    sinceNote = 0;
  }

  const end = notes.length ? notes[notes.length - 1].t : leadIn;
  return { notes, beat, leadIn, duration: end + beat * 4 };
}

function pickLane(random, lanes, last, diff) {
  const weights = [];
  for (let i = 0; i < lanes; i++) {
    const d = Math.abs(i - last);
    // 같은 자리 반복은 낮게, 한두 칸 옆이 가장 자연스럽게
    weights.push(d === 0 ? 0.18 : d === 1 ? 1 : d === 2 ? 0.75 : 0.35 * diff.multiplier);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < lanes; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return lanes - 1;
}

function pickJumpPartner(random, lanes, lane) {
  const options = [];
  for (let i = 0; i < lanes; i++) if (Math.abs(i - lane) >= 2) options.push(i);
  return options.length ? options[Math.floor(random() * options.length)] : null;
}

/* ---------- 판정 ---------- */

// 카메라는 초당 30장만 보므로 스텝 시각에 ±16 ms의 눈금 오차가 깔려 있다.
// 그 아래로 창을 좁히면 실력이 아니라 운이 되니, 퍼펙트를 그 눈금의 서너 배로
// 두는 선까지만 조인다. (판정 자체의 지연은 설정의 «판정 보정»이 되돌린다.)
export const JUDGES = [
  { id: "perfect", name: "퍼펙트", window: 0.06, weight: 1, hue: 45 },
  { id: "great", name: "그레이트", window: 0.11, weight: 0.7, hue: 140 },
  { id: "good", name: "굿", window: 0.18, weight: 0.32, hue: 200 },
];
export const MISS = { id: "miss", name: "미스", weight: 0, hue: 0 };
export const HIT_WINDOW = JUDGES[JUDGES.length - 1].window;

/** 노트 시각과의 시간차(초, 절대값 아님) → 판정 */
export function judgeOf(delta) {
  const d = Math.abs(delta);
  return JUDGES.find((j) => d <= j.window) ?? MISS;
}

/* ---------- 점수 ---------- */

export const MAX_SCORE = 1_000_000;

/**
 * 정확도 95만 + 최대 콤보 5만을 곡 전체에서 나눠 갖고, 난이도 배수를 곱한다.
 * 곡마다 노트 수가 달라도 점수 눈금이 같아 판마다 비교가 된다.
 */
export function computeScore({ counts, maxCombo, total, multiplier = 1 }) {
  if (!total) return 0;
  const earned = JUDGES.reduce((sum, j) => sum + (counts[j.id] ?? 0) * j.weight, 0);
  const accuracy = earned / total;
  const comboRatio = Math.min(1, (maxCombo ?? 0) / total);
  return Math.round((MAX_SCORE * 0.95 * accuracy + MAX_SCORE * 0.05 * comboRatio) * multiplier);
}

/** 등급 — 결과 화면에 크게 뜬다 */
export function rankOf(score) {
  const s = score / MAX_SCORE;
  if (s >= 1) return "SSS";
  if (s >= 0.93) return "SS";
  if (s >= 0.85) return "S";
  if (s >= 0.75) return "A";
  if (s >= 0.6) return "B";
  if (s >= 0.4) return "C";
  return "D";
}
