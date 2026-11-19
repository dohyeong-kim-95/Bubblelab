// 곡을 그 자리에서 합성한다 (음원 파일 없음).
// 드럼·베이스는 BPM에 맞춰 깔고, 멜로디는 채보의 노트를 그대로 연주한다 —
// 그래서 제때 밟으면 밟는 소리와 멜로디가 같은 박에 떨어진다.
import { PENTATONIC } from "./chart.js";

const midiToHz = (n) => 440 * 2 ** ((n - 69) / 12);

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.4), ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
}

export function createBand(ctx, { song, chart, master }) {
  const noise = noiseBuffer(ctx);
  const out = master ?? ctx.destination;

  // 소리 하나 = 소스 + 감쇠 엔벨로프. at은 언제나 ctx.currentTime 기준 절대 시각.
  const env = (node, at, peak, decay) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    node.connect(g).connect(out);
    return g;
  };

  const kick = (at) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(130, at);
    o.frequency.exponentialRampToValueAtTime(44, at + 0.11);
    env(o, at, 0.5, 0.24);
    o.start(at); o.stop(at + 0.3);
  };

  const percussion = (at, { peak, decay, cutoff }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = cutoff;
    src.connect(filter);
    env(filter, at, peak, decay);
    src.start(at); src.stop(at + decay + 0.05);
  };

  const snare = (at) => percussion(at, { peak: 0.22, decay: 0.14, cutoff: 1400 });
  const hat = (at, open) =>
    percussion(at, { peak: open ? 0.09 : 0.06, decay: open ? 0.16 : 0.045, cutoff: 7800 });

  const tone = (at, midi, { type, peak, decay, cutoff }) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(midiToHz(midi), at);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, at);
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.4, at + decay);
    o.connect(filter);
    env(filter, at, peak, decay);
    o.start(at); o.stop(at + decay + 0.05);
  };

  const bass = (at, midi) => tone(at, midi, { type: "sawtooth", peak: 0.16, decay: 0.26, cutoff: 620 });
  const lead = (at, midi) => tone(at, midi, { type: "square", peak: 0.1, decay: 0.22, cutoff: 2600 });

  // ── 이벤트 미리 깔기 ──
  // t = 곡 안에서의 시각(초), play(at) = 그 소리를 절대 시각 at에 예약한다.
  const events = [];
  const beat = chart.beat;
  const beats = Math.ceil(chart.duration / beat) + 1;
  for (let b = 0; b < beats; b++) {
    const t = b * beat;
    const bar = Math.floor(b / 4), inBar = b % 4;
    events.push({ t, play: kick });
    if (inBar === 1 || inBar === 3) events.push({ t, play: snare });
    events.push({ t, play: (at) => hat(at, false) });
    events.push({ t: t + beat / 2, play: (at) => hat(at, inBar === 3) });
    // 베이스는 마디마다 근음 → 4도 → 근음 → 단3도 위
    const step = [0, 5, 0, 3][bar % 4];
    events.push({ t, play: (at) => bass(at, song.root + step) });
  }
  for (const note of chart.notes) {
    const degree = PENTATONIC[note.lane % PENTATONIC.length];
    const octave = 12 * (1 + Math.floor(note.lane / PENTATONIC.length));
    const midi = song.root + octave + degree;
    events.push({ t: note.t, play: (at) => lead(at, midi) });
  }
  events.sort((a, b) => a.t - b.t);

  let origin = 0; // 곡의 t=0에 해당하는 ctx 시각
  let cursor = 0;

  return {
    /** @param {number} at 곡을 시작할 ctx.currentTime */
    start(at) {
      origin = at;
      cursor = 0;
    },
    /** 게임 루프에서 매 프레임 호출 — 0.3초 앞까지 미리 예약한다 */
    pump() {
      const until = ctx.currentTime - origin + 0.3;
      while (cursor < events.length && events[cursor].t <= until) {
        const ev = events[cursor++];
        const at = origin + ev.t;
        if (at > ctx.currentTime) ev.play(at); // 이미 지난 것은 버린다(끊김 방지)
      }
    },
    /** 밟은 순간의 짧은 클릭 — 카메라가 먹었다는 촉감 */
    step(strong = true) {
      percussion(ctx.currentTime + 0.001, {
        peak: strong ? 0.14 : 0.07, decay: 0.05, cutoff: 3200,
      });
    },
  };
}
