// 찻집 음악과 효과음 (Web Audio).
//
// 음악은 두 겹:
//   1) 곡(샘플러): tools/music/scores/*.txt 로 작곡한 곡(game/audio/songs.json)을
//      CC0 악기 샘플(game/audio/samples.json)로 연주한다. 그 무드의 곡과 악기가 다 불러와졌을 때만.
//   2) 합성(대체): 불러오기 전·실패·곡이 아직 없는 무드는 아래 합성 음악으로 연주한다 (파일 0바이트).
//
// 무드 (audio.mood(name)) — 바뀔 때는 박 경계에서 새 마디를 시작하며 크로스페이드
//   title  : 타이틀 화면. 곡 「새벽 두 시」 / 합성: 찻집과 같은 방식, D♭ 장조
//   shop   : 잔잔한 찻집. 곡 「찻집의 밤」 / 합성: 느린 7화음 패드 + 드문드문 오르골
//   memory : 기억 장면. 곡 「유자차의 겨울」 / 합성: 더 느리고 피아노 같은 음색, 아련한 진행 (Dm9 → B♭maj7 → Fmaj7/A → Csus4)
//   sleep  : 손님이 잠들 때. 곡 「잘 자요」 / 합성: 아주 낮은 드론과 몇 안 되는 음 (Fmaj9 ↔ B♭maj9/F)
// 방 소리: 아주 작은 갈색 잡음 (난로·빗소리 같은 바닥)
// 출력: master(음소거) → 리미터(DynamicsCompressor) → 스피커
//
// API 와 연결 방법은 docs/music/README.md

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const LEVEL = 0.55;
const SAMPLER_GAIN = 0.9;   // 샘플러 음 세기 1 일 때 gain
const REC_GAIN = 0.9;       // 녹음 효과음
const CLICK_GAIN = 0.03;    // 버튼 소리 (예전 오르골 탭 0.05 + 에코보다 훨씬 작게)
const WEATHER_GAIN = 0.18;  // 빗소리 (파일은 RMS -24dB 로 맞춰 둠 → 출력에서 BGM 아래)
const POUR_GAIN = 0.16;     // 차 따르기 물줄기
const DRIP_GAIN = 0.05;     // 따르기 끝의 방울
const PURR_GAIN = 0.25;     // 고양이 골골 (잡음을 거르고 끊어서 원래 작음)
const ICE_GAIN = 0.07;      // 얼음 퐁당 + 달그락
const LIFT_GAIN = 0.07;     // 거름망 건지기
const BREW_GAIN = 0.035;    // 우리는 동안의 보글거림 (아주 작게)

/** 디코드된 버퍼에서 첫 소리 위치(초). mp3 디코더가 앞에 붙이는 무음을 건너뛰기 위함 */
function firstSound(buf) {
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const th = peak * 0.02;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > th) return Math.max(0, i - Math.floor(buf.sampleRate * 0.002)) / buf.sampleRate;
  return 0;
}

const MOODS = {
  shop: {
    bar: 8,
    tone: 1400, // 음악 버스 저역 통과 필터
    chords: [
      [53, 57, 60, 64], // Fmaj7
      [52, 55, 59, 62], // Em7
      [50, 53, 57, 60], // Dm7
      [48, 52, 55, 59], // Cmaj7
    ],
  },
  memory: {
    bar: 11,
    tone: 2400,
    chords: [
      [38, 50, 53, 57, 64], // Dm9
      [34, 50, 53, 57, 60], // B♭maj7(9)
      [33, 48, 53, 57, 64], // Fmaj7/A
      [36, 48, 53, 55, 62], // Csus4(9)
    ],
  },
  title: {   // 타이틀 화면 — 합성 대체는 찻집과 같은 방식, D♭ 장조
    bar: 8,
    tone: 1400,
    chords: [
      [49, 53, 56, 60], // D♭maj7
      [53, 56, 60, 63], // Fm7
      [54, 58, 61, 65], // G♭maj7
      [56, 61, 63, 68], // A♭sus4
    ],
  },
  sleep: {
    bar: 14,
    tone: 650,
    chords: [
      [41, 53, 57, 60, 67], // Fmaj9
      [41, 50, 53, 58, 65], // B♭maj9/F
    ],
  },
};
export const MOOD_NAMES = Object.keys(MOODS);

export class Audio {
  /** base: game/audio/ 폴더의 상대경로 (게임 페이지 기준 'audio/') */
  constructor({ base = 'audio/', room = true } = {}) {
    this.room = room;     // 방 소리 (검증 때 끄고 효과음만 잴 수 있게)
    this.ctx = null;
    this.on = true;
    this.timer = null;
    this.cur = 'shop';
    this.pending = null;
    this.base = base;
    this.songs = {};
    this.inst = {};       // 악기 이름 → { def, ready }
    this.buffers = {};    // 파일 → { buf, offset }
    this.sfxRec = {};     // 녹음 효과음 이름 → { buf, start, dur, fade, gain }
    this.engine = null;   // 지금 무드를 연주 중인 곡 (null = 합성)
    this.motif = {};      // 무드 → 고른 기억 모티프 이름 (없으면 기본)
    this.loops = {};      // 반복 효과음 이름 → 핸들
    this.ambience = {};   // 환경음 이름 → { buf, loopStart, loopEnd }
    this.weatherWant = null;  // 원하는 날씨 (불러오기 전에 불려도 기억)
    this.weatherNow = null;   // 지금 울리는 날씨 { name, src, gain }
    this.lastTap = 0;
    this.lastPurr = -9;
    this.lastIce = -9;
    this.ready = Promise.resolve();
  }

  /**
   * 첫 탭에서 불러야 한다 (브라우저 자동재생 정책). 두 번째부터는 resume 만 한다.
   * ctx 를 넘기면 그 컨텍스트에 연주한다 (OfflineAudioContext 검증용 — 이때는 타이머를 돌리지 않으니
   * scheduleUntil(t) 로 직접 채운다).
   */
  start(ctx = null) {
    if (this.ctx) { this.#resume(); return; }
    const offline = !!ctx;
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    this.ctx = ctx;

    // 리미터: 여러 음·효과음이 겹쳐도 깨지지 않게
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.on ? LEVEL : 0;
    this.master.connect(this.limiter);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.9;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass'; this.tone.frequency.value = MOODS[this.cur].tone;
    this.musicBus.connect(this.tone).connect(this.master);

    // 에코
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const echoLp = ctx.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 1800;
    this.echo.connect(echoLp).connect(fb).connect(this.echo);
    echoLp.connect(this.musicBus);

    // 리버브: 코드로 만든 작은 방 IR (파일 0바이트)
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.#roomIR(2.2);
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.9;
    this.verb.connect(verbOut).connect(this.musicBus);
    // 효과음용 긴 잔향 (꿈속처럼 먼 소리) — 음악 필터를 거치지 않고 바로 master 로
    this.farVerb = ctx.createConvolver();
    this.farVerb.buffer = this.#roomIR(3.6);
    this.farVerb.connect(this.master);

    // 무드마다 버스 하나씩 (dry → 음악 버스, wet → 에코, rev → 리버브). 크로스페이드는 이 gain 들로.
    this.buses = {};
    for (const name of MOOD_NAMES) {
      const dry = ctx.createGain(); const wet = ctx.createGain(); const rev = ctx.createGain();
      dry.gain.value = wet.gain.value = rev.gain.value = name === this.cur ? 1 : 0;
      dry.connect(this.musicBus); wet.connect(this.echo); rev.connect(this.verb);
      this.buses[name] = { dry, wet, rev };
    }

    if (this.room) this.#roomTone();
    this.bar = 0;
    this.barLen = MOODS[this.cur].bar;
    this.barStart = ctx.currentTime + 0.1;
    this.nextBar = this.barStart;
    this.ready = this.#load().catch((e) => { console.warn('[audio] 샘플을 못 불러와 합성 음악으로 연주', e); });
    if (!offline) {
      this.timer = setInterval(() => this.scheduleUntil(this.ctx.currentTime + 1), 200);
      this.#mobileHooks();
      this.#unlock();
    }
  }

  setOn(on) {
    this.on = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? LEVEL : 0, this.ctx.currentTime, 0.3);
  }

  /**
   * 무드 바꾸기: 'title' | 'shop' | 'memory' | 'sleep'. start() 전에 불러도 된다 (시작 무드가 됨).
   * 지금 마디의 다음 박(마디의 1/4)에서 새 무드의 첫 마디가 시작되고, 앞 무드는 3초쯤에 걸쳐 사라진다.
   * opts.motif: 곡의 모티프 변주 이름 (예: mood('memory', { motif: 'harin-2' })). 없거나 모르는 이름이면 기본.
   *   같은 무드에서 모티프만 바꾸면 다음 마디부터 바뀐다.
   * opts.when (또는 숫자 하나): 검증용 시각 (기본: 지금).
   */
  mood(name, opts = {}) {
    if (!MOODS[name]) throw new Error(`알 수 없는 무드: ${name}`);
    const { motif = null, when = null } = typeof opts === 'number' ? { when: opts } : (opts ?? {});
    this.motif[name] = motif;
    if (!this.ctx) { this.cur = name; this.pending = null; return; }
    const target = this.pending?.name ?? this.cur;
    if (name === target) return;
    if (name === this.cur) {            // 아직 안 바뀐 전환을 취소
      this.pending = null;
      return;
    }
    const now = (when ?? this.ctx.currentTime) + 0.05;
    const beat = this.barLen / 4;
    let t = this.barStart + Math.ceil((now - this.barStart) / beat) * beat;
    t = Math.max(t, this.barStart + beat);
    if (t < this.nextBar) this.nextBar = t;   // 지금 마디를 그 박에서 끊고 새 마디로
    this.pending = { name };
  }

  get currentMood() { return this.pending?.name ?? this.cur; }

  /** t 초까지 음을 예약한다. 실시간에서는 타이머가 부르고, 오프라인 검증에서는 직접 부른다. */
  scheduleUntil(horizon) {
    const ctx = this.ctx;
    if (!ctx) return;
    // 타이머가 오래 밀렸으면 지난 마디를 한꺼번에 몰아 치지 않는다
    if (this.nextBar < ctx.currentTime - 0.05) this.nextBar = ctx.currentTime + 0.05;
    while (this.nextBar < horizon) {
      const t = this.nextBar;
      if (this.pending) { this.#crossfade(this.cur, this.pending.name, t); this.cur = this.pending.name; this.pending = null; this.bar = 0; this.engine = undefined; }
      // 곡이 준비됐으면 곡으로, 아니면 합성으로 (합성 → 곡 전환도 마디 경계에서)
      const song = this.#songFor(this.cur);
      if (song !== this.engine) {
        if (this.engine !== undefined) this.bar = 0;
        this.engine = song;
        this.tone.frequency.setTargetAtTime(this.#toneFor(this.cur), t, 0.8);
      }
      let len;
      if (song) len = this.#songBar(song, t);
      else {
        const m = MOODS[this.cur];
        const chord = m.chords[this.bar % m.chords.length];
        if (this.cur === 'shop' || this.cur === 'title') this.#shopBar(chord, t, m.bar, this.buses[this.cur]);
        else if (this.cur === 'memory') this.#memoryBar(chord, t, m.bar);
        else this.#sleepBar(chord, t, m.bar);
        len = m.bar;
      }
      this.barStart = t;
      this.barLen = len;
      this.nextBar = t + len;
      this.bar++;
    }
  }

  #crossfade(from, to, t) {
    const a = this.buses[from], b = this.buses[to];
    for (const g of [a.dry.gain, a.wet.gain, a.rev.gain]) { g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.9); }
    for (const g of [b.dry.gain, b.wet.gain, b.rev.gain]) { g.cancelScheduledValues(t); g.setTargetAtTime(1, t, 0.6); }
    this.tone.frequency.cancelScheduledValues(t);
    this.tone.frequency.setTargetAtTime(this.#toneFor(to), t, 1.2);
  }

  #toneFor(mood) { return this.#songFor(mood)?.tone ?? MOODS[mood].tone; }

  // ── 곡 (샘플러) ─────────────────────────────────────────────
  async #load() {
    const get = async (f) => {
      const r = await fetch(this.base + f);
      if (!r.ok) throw new Error(`${f} ${r.status}`);
      return r;
    };
    const [songs, samples] = await Promise.all([get('songs.json').then((r) => r.json()), get('samples.json').then((r) => r.json())]);
    for (const [name, def] of Object.entries(samples.instruments)) this.inst[name] = { def, ready: false };
    // 지금 무드의 곡에 쓰이는 악기부터
    const order = Object.keys(samples.instruments).sort((a, b) => !!songs[this.cur]?.tracks[b] - !!songs[this.cur]?.tracks[a]);
    // 음을 박 순서로 한 줄에 모아 둔다: [박, 악기, MIDI, 길이, 세기×볼륨]. 트랙 "piano.rh" 의 악기는 piano
    const flatten = (tracks) => Object.entries(tracks)
      .flatMap(([tr, t]) => t.notes.map(([b, m, l, v]) => [b, tr.split('.')[0], m, l, v * t.vol]))
      .sort((x, y) => x[0] - y[0]);
    for (const [name, s] of Object.entries(songs)) {
      s.flat = flatten(s.tracks);
      s.variants = {};
      for (const [motif, v] of Object.entries(s.motifs ?? {})) s.variants[motif] = flatten({ ...s.tracks, ...v.tracks });
      this.songs[name] = s;
    }
    const sfx = Promise.all([
      ...Object.entries(samples.sfx ?? {}).map(async ([name, d]) => {
        const buf = await this.#decode(await (await get(d.file)).arrayBuffer());
        this.sfxRec[name] = { ...d, buf };
      }),
      ...Object.entries(samples.ambience ?? {}).map(async ([name, d]) => {
        const buf = await this.#decode(await (await get(d.file)).arrayBuffer());
        this.ambience[name] = { ...d, buf };
        if (this.weatherWant === name && !this.weatherNow) this.weather(name);
      }),
    ]);
    for (const name of order) {
      const { def } = this.inst[name];
      await Promise.all(def.zones.map(async (z) => {
        const buf = await this.#decode(await (await get(z.file)).arrayBuffer());
        this.buffers[z.file] = { buf, offset: firstSound(buf) };
      }));
      this.inst[name].ready = true;
    }
    await sfx;
  }

  #decode(arr) {
    // 옛 Safari 는 콜백 방식만 지원
    return new Promise((ok, fail) => {
      const p = this.ctx.decodeAudioData(arr, ok, fail);
      if (p?.then) p.then(ok, fail);
    });
  }

  #songFor(mood) {
    const s = this.songs[mood];
    if (!s) return null;
    for (const tr of Object.keys(s.tracks)) if (!this.inst[tr.split('.')[0]]?.ready) return null;
    return s;
  }

  /** 곡의 한 마디를 예약하고 마디 길이(초)를 돌려준다. 반복 구간 끝에 닿으면 구간 시작으로. */
  #songBar(s, t) {
    const spb = 60 / s.tempo;
    const bpb = s.beatsPerBar;
    let p = this.bar * bpb;
    const [ls, le] = s.loop;
    if (p >= le) p = ls + ((p - ls) % (le - ls));
    const bus = this.buses[this.cur];
    const motif = this.motif[this.cur];
    const notes = (motif && s.variants[motif]) || s.flat;
    for (const [b, inst, m, l, v] of notes) {
      if (b < p) continue;
      if (b >= p + bpb) break;
      const jitter = (Math.random() - 0.5) * 0.016;          // 사람 손 같은 아주 작은 흔들림
      const vel = Math.max(0.02, v + (Math.random() - 0.5) * 0.04);
      this.#note(inst, m, t + (b - p) * spb + Math.max(0, jitter), l * spb, vel, bus);
    }
    return bpb * spb;
  }

  /** 샘플러 한 음: 같은 세기 층에서 가장 가까운 샘플을 골라 playbackRate 로 음정 이동 */
  #note(inst, midiNote, t, dur, vel, bus) {
    const { def } = this.inst[inst];
    const layers = Object.entries(def.layers).sort((a, b) => a[1] - b[1]);
    const layer = (layers.find(([, max]) => vel <= max) ?? layers.at(-1))[0];
    let zone = null;
    for (const z of def.zones) if (z.layer === layer && (!zone || Math.abs(z.root - midiNote) < Math.abs(zone.root - midiNote))) zone = z;
    const sample = this.buffers[zone.file];
    if (!sample) return;
    const ctx = this.ctx;
    const rate = 2 ** ((midiNote - zone.root) / 12);
    const src = ctx.createBufferSource();
    src.buffer = sample.buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const peak = SAMPLER_GAIN * vel ** 1.3;
    const atk = def.attack ?? 0.004;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + Math.max(atk, dur));
    g.gain.setTargetAtTime(0, t + Math.max(atk, dur), def.release / 3);
    src.connect(g);
    g.connect(bus.dry);
    g.connect(bus.rev);
    const left = (sample.buf.duration - sample.offset) / rate;
    src.start(t, sample.offset);
    src.stop(t + Math.min(left, dur + def.release * 2));
  }

  /** 작은 방 잔향: 스테레오 잡음에 지수 감쇠 + 고역이 먼저 사라지게 (간단한 1차 저역 통과를 점점 세게) */
  #roomIR(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const k = 0.6 - 0.5 * x;                  // 뒤로 갈수록 어둡게
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-5.5 * x) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
      }
    }
    return ir;
  }

  // ── 무드별 마디 ─────────────────────────────────────────────
  #shopBar(chord, t, bar, bus) {
    this.#pad(chord, t, bar, 0.022, bus.dry);
    const n = 3 + Math.floor(Math.random() * 4);   // 한 마디에 오르골 3~6음
    for (let i = 0; i < n; i++) {
      const note = chord[Math.floor(Math.random() * chord.length)] + 24 + (Math.random() < 0.3 ? 12 : 0);
      this.#bell(note, t + 0.5 + Math.random() * (bar - 1.5), 0.07, bus.dry, bus.wet);
    }
  }

  #memoryBar(chord, t, bar) {
    const bus = this.buses.memory;
    const [bass, ...upper] = chord;
    // 왼손: 낮은 근음 + 옥타브, 오른손: 느린 분산화음, 위에 한두 음 선율
    this.#piano(bass, t, 0.11, 7, bus);
    this.#piano(bass + 12, t + 0.03, 0.06, 6, bus);
    const arp = [0, 1, 2, 3, 2, 1].map((i) => upper[i]);
    const step = bar / 8;
    arp.forEach((n, i) => this.#piano(n, t + step * (i + 1) + (Math.random() - 0.5) * 0.08, 0.055, 4.5, bus));
    const mel = upper.filter((_, i) => i !== 0).map((n) => n + 12);
    const k = 1 + (Math.random() < 0.6 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const n = mel[Math.floor(Math.random() * mel.length)];
      this.#piano(n, t + bar * (0.3 + 0.35 * i) + Math.random() * 0.6, 0.06, 5, bus);
    }
    this.#pad(upper, t, bar, 0.008, bus.dry, 'sine');   // 아주 옅은 바닥
  }

  #sleepBar(chord, t, bar) {
    const bus = this.buses.sleep;
    const ctx = this.ctx;
    // 낮은 드론: 근음과 5도, 천천히 숨 쉬듯
    for (const [n, v] of [[chord[0] - 12, 0.05], [chord[0], 0.03], [chord[0] + 7, 0.012]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = midi(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 4);
      g.gain.linearRampToValueAtTime(v * 0.7, t + bar - 2);
      g.gain.linearRampToValueAtTime(0, t + bar + 3);
      o.connect(g).connect(bus.dry);
      o.start(t); o.stop(t + bar + 3.1);
    }
    this.#pad(chord.slice(1, 4), t + 1, bar - 1, 0.006, bus.dry, 'sine');
    // 한 마디에 한두 음만, 낮게
    const n = Math.random() < 0.5 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const note = chord[1 + Math.floor(Math.random() * (chord.length - 1))] + 12;
      this.#piano(note, t + 3 + i * (bar * 0.4) + Math.random() * 1.5, 0.035, 6, bus);
    }
  }

  // ── 악기 ────────────────────────────────────────────────────
  #pad(chord, t, bar, vol, dest, type = 'triangle') {
    const ctx = this.ctx;
    for (const n of chord) {
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = midi(n);
        o.detune.value = det;
        const gn = ctx.createGain();
        gn.gain.setValueAtTime(0, t);
        gn.gain.linearRampToValueAtTime(vol, t + 2.5);
        gn.gain.linearRampToValueAtTime(vol * 0.8, t + bar - 1);
        gn.gain.linearRampToValueAtTime(0, t + bar + 1.5);
        o.connect(gn).connect(dest);
        o.start(t); o.stop(t + bar + 1.6);
      }
    }
  }

  #bell(note, t, vol, dest, wet = this.echo) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = midi(note);
    const o2 = ctx.createOscillator();
    o2.type = 'sine'; o2.frequency.value = midi(note) * 3.01;  // 맑은 배음
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o.connect(gn); o2.connect(g2).connect(gn);
    gn.connect(dest);
    if (wet) gn.connect(wet);
    o.start(t); o2.start(t); o.stop(t + 2.3); o2.stop(t + 2.3);
  }

  /** 피아노 비슷한 음: 배음을 겹치고, 높은 배음일수록 빨리 사라지게 + 망치 소리 같은 밝은 어택 */
  #piano(note, t, vol, len, bus) {
    const ctx = this.ctx;
    const f = midi(note);
    const out = ctx.createGain();
    out.gain.value = vol;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(f * 8, 6000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 200), t + len * 0.6);
    const partials = [[1, 1, 1], [2.003, 0.45, 0.6], [3.008, 0.22, 0.4], [4.02, 0.1, 0.25]];
    for (const [ratio, amp, life] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      o.detune.value = (Math.random() - 0.5) * 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.006);
      g.gain.setTargetAtTime(amp * 0.35, t + 0.006, 0.25 * life);        // 첫 소리 뒤 빠르게 한 번 줄고
      g.gain.setTargetAtTime(0, t + 0.4, (len / 5) * life);              // 길게 사라짐
      o.connect(g).connect(lp);
      o.start(t); o.stop(t + len + 0.5);
    }
    lp.connect(out);
    out.connect(bus.dry);
    const send = ctx.createGain(); send.gain.value = 0.5;
    out.connect(send).connect(bus.wet);
  }

  #noise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  #roomTone() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {          // 갈색 잡음
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const gn = ctx.createGain(); gn.gain.value = 0.05;
    src.connect(gn).connect(this.master);
    src.start();
  }

  // ── 효과음 ─────────────────────────────────────────────────
  /**
   * 한 번: tap · untap · clue · miss · success · pour · bell · page · item · beep · purr · ice · lift
   * 반복: water · brew — 핸들 { stop() } 을 돌려준다. audio.stopSfx(이름) 로도 멈춤. 이미 울리는 중이면 같은 핸들.
   * 모르는 이름·start 전에는 아무 소리 없이 null.
   * opts: 숫자면 시각(when, 검증용), 객체면 { size(ice: 0 작은 조각 ~ 1 큰 덩이), when }.
   */
  sfx(kind, opts = null) {
    if (!this.ctx) return null;
    this.#resume();
    const o = typeof opts === 'number' ? { when: opts } : (opts ?? {});
    const t = o.when ?? this.ctx.currentTime;
    const m = this.master;
    if (kind === 'water') return this.#water(t);
    if (kind === 'brew') return this.#brew(t);
    if (kind === 'ice') this.#ice(t, Number.isFinite(o.size) ? Math.max(0, Math.min(1, o.size)) : 0.5);
    if (kind === 'lift') this.#lift(t);
    if (kind === 'tap') this.#click(81, t, 1);
    if (kind === 'untap') this.#click(76, t, 0.8);
    if (kind === 'clue') { this.#click(81, t, 0.9); this.#click(88, t + 0.06, 0.8); }
    if (kind === 'miss') { this.#bell(69, t, 0.05, m); this.#bell(67, t + 0.14, 0.04, m); }
    if (kind === 'success') [72, 76, 79, 84, 88].forEach((n, i) => this.#bell(n, t + i * 0.11, 0.07, m));
    if (kind === 'pour') this.#pour(t);
    if (kind === 'bell') { if (!this.#playRec('bell', t)) this.#doorBell(t); }
    if (kind === 'page') this.#page(t);   // 짧은 종이 스침 (UI 소리라 짧고 작게)
    if (kind === 'item') this.#item(t);
    if (kind === 'beep') this.#beep(t);
    if (kind === 'purr') this.#purr(t);
    return null;
  }

  /** 반복 효과음 멈추기 (fade 초에 걸쳐). 안 울리고 있으면 아무 일 없음 */
  stopSfx(kind, fade = 0.5, when = null) {
    this.loops[kind]?.stop(fade, when);
  }

  /**
   * 고양이 골골: 0.6~1초. 잡음을 25~29Hz 로 톡톡 끊어(성대가 떨리는 박자) 낮게 걸러 냄.
   * 내쉬는 숨(크게) → 들이쉬는 숨(작게). 폰 스피커에서도 들리게 150~400Hz 를 살림.
   * 0.35초 안에 다시 누르면 무시, 1초 안이면 더 작게 → 연타해도 시끄럽지 않음.
   */
  #purr(t) {
    const since = t - this.lastPurr;
    if (since >= 0 && since < 0.35) return;
    this.lastPurr = t;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const len = 0.6 + Math.random() * 0.4;
    const rate = 25 + Math.random() * 4;
    const n = Math.floor(sr * len);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const split = 0.55 + Math.random() * 0.1;     // 내쉼 / 들이쉼 경계
    let lp = 0, ph = Math.random();
    for (let i = 0; i < n; i++) {
      const x = i / n;
      ph += (rate * (1 + 0.04 * Math.sin(x * 9))) / sr;
      const pulse = Math.max(0, Math.sin(2 * Math.PI * ph)) ** 3;        // 톡톡 끊기는 진동
      const breath = x < split ? Math.sin((Math.PI * x) / split) : 0.45 * Math.sin((Math.PI * (x - split)) / (1 - split));
      lp += 0.08 * ((Math.random() * 2 - 1) - lp);                       // 낮게 거른 잡음
      d[i] = lp * pulse * breath;
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.Q.value = 1; body.gain.value = 6;
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.value = PURR_GAIN * (since < 1 ? 0.6 : 1) * (0.85 + Math.random() * 0.3);
    src.connect(body).connect(lpf).connect(g).connect(this.master);
    src.start(t);
  }

  /**
   * 얼음 한 조각이 유리잔 차에: 퐁당(물속 공기 방울이 위로 미끄러지는 낮은 사인) + 달그락(잔에 닿는 짧은 유리 소리).
   * 0.3초 안팎. size 가 클수록 퐁당이 낮고 조금 크게, 유리 소리도 살짝 낮게. 매번 음정·세기·간격이 조금씩 다름.
   * 0.12초 안에 또 넣으면 더 작게 (한 줌 넣을 때 시끄럽지 않게).
   */
  #ice(t, size) {
    const ctx = this.ctx;
    const quick = t - this.lastIce < 0.12;
    this.lastIce = t;
    const jit = (a) => 1 + (Math.random() - 0.5) * a;
    const vol = ICE_GAIN * (0.75 + 0.4 * size) * jit(0.3) * (quick ? 0.6 : 1);
    const out = ctx.createGain(); out.gain.value = vol;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.3;
    out.connect(lp).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.25;
    lp.connect(send).connect(this.verb);
    // 퐁당: 물에 들어가는 순간의 작은 철벅(잡음 15ms) + 공기 방울 (사인이 위로 미끄러짐)
    const splash = ctx.createBufferSource(); splash.buffer = this.#noise(0.03);
    const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 1400 * jit(0.3); sbp.Q.value = 1.2;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.35, t + 0.002);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    splash.connect(sbp).connect(sg).connect(out);
    splash.start(t); splash.stop(t + 0.03);
    const f0 = (520 - 260 * size) * jit(0.12);         // 작은 조각 ~520Hz, 큰 덩이 ~260Hz
    const bub = (s, f, a, len) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * 2.1, s + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(a, s + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, s + len);
      o.connect(g).connect(out);
      o.start(s); o.stop(s + len + 0.01);
    };
    const pt = t + 0.01;
    bub(pt, f0, 1, 0.11 + 0.04 * size);
    bub(pt + 0.05 + Math.random() * 0.04, f0 * 1.6 * jit(0.1), 0.35, 0.06);   // 뒤따르는 작은 방울
    // 달그락: 유리잔에 닿는 소리 — 맞지 않는 배음 셋, 짧게. 잔에 한 번, 가끔 한 번 더 작게
    const glass = (s, a) => {
      const base = (2350 - 400 * size) * jit(0.06);
      for (const [r, amp, d] of [[1, 1, 0.12], [1.53, 0.5, 0.08], [2.41, 0.25, 0.05]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * r;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(amp * a, s + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0005, s + d);
        o.connect(g).connect(out);
        o.start(s); o.stop(s + d + 0.01);
      }
    };
    const ct = t + 0.13 + Math.random() * 0.05;
    glass(ct, 0.22);
    if (Math.random() < 0.5) glass(ct + 0.07 + Math.random() * 0.03, 0.09);
  }

  /**
   * 거름망을 물에서 건지기: 물이 빠지며 나는 짧은 찰랑(잡음이 위로 쓸림) + 떨어지는 방울 3~5개(점점 뜸하고 작게).
   * 전체 0.6초 안팎, 처음 0.15초가 몸통.
   */
  #lift(t) {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = LIFT_GAIN * (0.85 + Math.random() * 0.3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; lp.Q.value = 0.3;
    out.connect(lp).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.3;
    lp.connect(send).connect(this.verb);
    const dur = 0.16 + Math.random() * 0.04;
    const src = ctx.createBufferSource(); src.buffer = this.#noise(dur + 0.02);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    const f0 = 700 * (0.9 + Math.random() * 0.2);
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.002, t + dur);
    src.connect(bp).connect(g).connect(out);
    src.start(t); src.stop(t + dur + 0.02);
    let s = t + dur * 0.7, gap = 0.07, a = 0.5;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const f = 900 + Math.random() * 700;
      o.frequency.setValueAtTime(f, s); o.frequency.exponentialRampToValueAtTime(f * 1.7, s + 0.04);
      const dg = ctx.createGain();
      dg.gain.setValueAtTime(0, s); dg.gain.linearRampToValueAtTime(a, s + 0.003);
      dg.gain.exponentialRampToValueAtTime(0.0005, s + 0.06);
      o.connect(dg).connect(out);
      o.start(s); o.stop(s + 0.07);
      s += gap * (0.8 + Math.random() * 0.4); gap *= 1.5; a *= 0.7;
    }
  }

  /**
   * 우리는 동안의 아주 작은 보글거림 (반복). 낮고 둥근 공기 방울이 드문드문 + 아주 옅은 끓는 잡음.
   * 4.3초 버퍼를 반복 (끝 0.1초엔 방울을 두지 않아 이음매가 깨끗).
   */
  #brew(t) {
    if (this.loops.brew) return this.loops.brew;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const L = Math.floor(sr * 4.3);
    const buf = ctx.createBuffer(1, L, sr);
    const d = buf.getChannelData(0);
    for (let k = 0; k < 26; k++) {
      const start = Math.floor(Math.random() * (L - sr * 0.12));
      const f0 = 220 + Math.random() * 380;
      const dur = 0.03 + Math.random() * 0.05;
      const amp = 0.25 + Math.random() * 0.75;
      let ph = 0;
      for (let i = 0; i < dur * sr && start + i < L; i++) {
        const u = i / (dur * sr);
        ph += (2 * Math.PI * f0 * (1 + 1.2 * u)) / sr;
        d[start + i] += Math.sin(ph) * amp * Math.min(1, u * 20) * (1 - u) ** 2;
      }
    }
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(BREW_GAIN, t + 0.6);
    out.connect(this.master);
    const a = ctx.createBufferSource(); a.buffer = buf; a.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    a.connect(lp).connect(out);
    const b = ctx.createBufferSource(); b.buffer = this.#noise(3.1); b.loop = true;   // 옅은 끓는 소리
    const bbp = ctx.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = 600; bbp.Q.value = 0.7;
    const bg = ctx.createGain(); bg.gain.value = 0.06;
    b.connect(bbp).connect(bg).connect(out);
    a.start(t); b.start(t);
    return this.#loopHandle('brew', out, [a, b], t);
  }

  /** 반복 효과음 핸들: stop(fade) 하면 지금 크기에서 부드럽게 0 으로 */
  #loopHandle(kind, out, srcs, t) {
    const ctx = this.ctx;
    const handle = {
      stop: (fade = 0.5, when = null) => {
        if (this.loops[kind] !== handle) return;
        delete this.loops[kind];
        const now = Math.max(when ?? ctx.currentTime, t + 0.01);
        const f = Math.max(0.02, fade);
        const g = out.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else g.cancelScheduledValues(now);
        g.setTargetAtTime(0, now, f / 4);
        for (const s of srcs) s.stop(now + f + 0.05);
      },
    };
    this.loops[kind] = handle;
    return handle;
  }

  /** 심전도 같은 작은 전자음 한 번 — 병원보다는 꿈속에서 멀리 들리는 느낌: 마른 소리는 작고 긴 잔향이 크다 */
  #beep(t) {
    const ctx = this.ctx;
    const len = 0.32;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + 0.02);
    out.gain.setValueAtTime(1, t + len);
    out.gain.linearRampToValueAtTime(0, t + len + 0.09);
    for (const [f, a] of [[987.8, 1], [1975.5, 0.12]]) {     // B5 + 옥타브 위 아주 조금
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = a;
      o.connect(g).connect(out);
      o.start(t); o.stop(t + len + 0.12);
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    out.connect(lp);
    const dry = ctx.createGain(); dry.gain.value = 0.02;
    const wet = ctx.createGain(); wet.gain.value = 0.1;
    lp.connect(dry).connect(this.master);
    lp.connect(wet).connect(this.farVerb);
  }

  /** 잔 씻는 물소리 (합성, 반복). 흐르는 물 = 대역 잡음이 천천히 출렁임, 그 위에 작은 물방울 소리 */
  #water(t) {
    if (this.loops.water) return this.loops.water;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    // 흐름: 5.2초 잡음. 출렁임은 버퍼 길이에 정수 주기로 맞춰 이음매 없이 반복
    const L1 = Math.floor(sr * 5.2);
    const flow = ctx.createBuffer(1, L1, sr);
    const fd = flow.getChannelData(0);
    for (let i = 0; i < L1; i++) {
      const x = i / L1;
      const env = 0.6 + 0.25 * Math.sin(2 * Math.PI * 3 * x) + 0.15 * Math.sin(2 * Math.PI * 7 * x + 1.3);
      fd[i] = (Math.random() * 2 - 1) * env;
    }
    // 물방울: 3.7초 버퍼 (흐름과 길이가 달라 반복이 덜 들림). 끝 0.1초엔 두지 않아 이음매가 깨끗
    const L2 = Math.floor(sr * 3.7);
    const drops = ctx.createBuffer(1, L2, sr);
    const dd = drops.getChannelData(0);
    const count = 34;
    for (let k = 0; k < count; k++) {
      const start = Math.floor(Math.random() * (L2 - sr * 0.12));
      const f0 = 500 + Math.random() * 1100;
      const dur = 0.025 + Math.random() * 0.04;
      const amp = 0.15 + Math.random() * 0.35;
      let ph = 0;
      for (let i = 0; i < dur * sr && start + i < L2; i++) {
        const u = i / (dur * sr);
        ph += (2 * Math.PI * f0 * (1 + 0.8 * u)) / sr;     // 위로 짧게 미끄러지는 "똑"
        dd[start + i] += Math.sin(ph) * amp * (1 - u) ** 2;
      }
    }
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + 0.35);
    out.connect(this.master);
    const a = ctx.createBufferSource(); a.buffer = flow; a.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const ga = ctx.createGain(); ga.gain.value = 0.09;
    a.connect(bp).connect(hp).connect(ga).connect(out);
    const b = ctx.createBufferSource(); b.buffer = drops; b.loop = true;
    const gb = ctx.createGain(); gb.gain.value = 0.11;
    b.connect(gb).connect(out);
    gb.connect(this.verb);   // 물방울만 방 잔향 조금
    a.start(t); b.start(t);
    return this.#loopHandle('water', out, [a, b], t);
  }

  /**
   * 버튼 소리: 40~70ms 의 작고 둥근 음 하나. 백 번 눌러도 거슬리지 않게
   * — 배음은 옥타브 하나만 아주 조금, 에코 없음, 저역 통과로 끝을 둥글게,
   * — 매번 음정 ±12센트·세기 ±15% 흔들림, 아주 빨리 연타하면(<90ms) 조금 더 작게.
   */
  #click(note, t, level) {
    const ctx = this.ctx;
    const quick = t - this.lastTap < 0.09;
    this.lastTap = t;
    const vol = CLICK_GAIN * level * (0.85 + Math.random() * 0.3) * (quick ? 0.6 : 1);
    const f = midi(note) * 2 ** (((Math.random() - 0.5) * 24) / 1200);
    const len = 0.045 + Math.random() * 0.02;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.3;
    for (const [mul, a] of [[1, 1], [2, 0.08]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f * mul;
      const ga = ctx.createGain(); ga.gain.value = a;
      o.connect(ga).connect(g);
      o.start(t); o.stop(t + len + 0.01);
    }
    g.connect(lp).connect(this.master);
  }

  // ── 날씨 (환경음) ───────────────────────────────────────────
  /**
   * 'rain' | null. BGM 아래에 깔리고, fade 초에 걸쳐 서서히 들어오고 나간다.
   * start() 전·불러오기 전에 불러도 기억해 두었다가 준비되면 시작한다.
   */
  weather(name, fade = 4, when = null) {
    this.weatherWant = name ?? null;
    if (!this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    const cur = this.weatherNow;
    if (cur?.name === name) return;
    if (cur) {                                   // 지금 날씨는 사라지게
      const g = cur.gain.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, fade / 4);
      cur.src.stop(t + fade + 0.1);
      this.weatherNow = null;
    }
    const amb = name && this.ambience[name];
    if (!amb) return;                            // 아직 안 불러왔으면 불러온 뒤 시작
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = amb.buf;
    src.loop = true;
    src.loopStart = amb.loopStart;
    src.loopEnd = amb.loopEnd;
    // 창 너머 실내에서 듣는 느낌: 고역을 깎고 아주 낮은 웅웅거림도 덜어 냄
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800; lp.Q.value = 0.4;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(WEATHER_GAIN, t, fade / 4);
    src.connect(hp).connect(lp).connect(gain).connect(this.master);
    src.start(t, amb.loopStart);
    this.weatherNow = { name, src, gain };
  }

  // ── 차 따르기 (미니게임) ─────────────────────────────────────
  /**
   * 따르는 소리 핸들. setLevel(0~1) = 잔에 찬 정도(높을수록 음정이 올라감),
   * setFlow(0~1) = 물줄기 세기(0 이면 방울만 똑똑, 점점 뜸해짐), stop(fade) = 끝.
   * 각 메서드의 마지막 인자 when 은 검증용 시각.
   * opts: { thick: true } = 우유처럼 더 낮고 부드러운 소리 (공명이 낮고 넓고, 튀는 소리·꼬르륵이 적음).
   *       숫자면 시작 시각(검증용).
   */
  pour(opts = null) {
    const ctx = this.ctx;
    if (!ctx) return { setLevel() {}, setFlow() {}, stop() {} };
    this.#resume();
    const o = typeof opts === 'number' ? { when: opts } : (opts ?? {});
    const thick = !!o.thick;
    const t0 = o.when ?? ctx.currentTime;
    const state = { level: 0, flow: 0, stopped: false, nextDrip: t0, dryFor: 0 };
    // 물줄기: 잡음 → 잔의 공명(두 개의 띠 통과) — 잔이 차면 공명 주파수가 올라간다
    const src = ctx.createBufferSource();
    src.buffer = this.#noise(2.3); src.loop = true;
    const out = ctx.createGain(); out.gain.value = 1;
    if (thick) {           // 우유: 높은 쪽을 깎아 부드럽게
      const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 1400; soft.Q.value = 0.3;
      out.gain.value = 1.3;  // 깎인 만큼 조금 보충
      out.connect(soft).connect(this.master);
    } else out.connect(this.master);
    const flowGain = ctx.createGain(); flowGain.gain.value = 0;
    const res1 = ctx.createBiquadFilter(); res1.type = 'bandpass'; res1.Q.value = thick ? 3 : 5;
    const res2 = ctx.createBiquadFilter(); res2.type = 'bandpass'; res2.Q.value = thick ? 4 : 7;
    const body = ctx.createBiquadFilter(); body.type = 'bandpass'; body.Q.value = 0.8; body.frequency.value = thick ? 900 : 1800;  // 물 튀는 넓은 소리
    const g1 = ctx.createGain(); g1.gain.value = 0.9;
    const g2 = ctx.createGain(); g2.gain.value = thick ? 0.3 : 0.5;
    const gb = ctx.createGain(); gb.gain.value = thick ? 0.12 : 0.25;
    src.connect(res1).connect(g1).connect(flowGain);
    src.connect(res2).connect(g2).connect(flowGain);
    src.connect(body).connect(gb).connect(flowGain);
    flowGain.connect(out);
    // 꼬르륵: 공명 주파수를 불규칙하게 흔듦
    const wob = ctx.createOscillator(); wob.type = 'sine'; wob.frequency.value = thick ? 3.5 : 6.5;
    const wob2 = ctx.createOscillator(); wob2.type = 'sine'; wob2.frequency.value = thick ? 1.4 : 2.3;
    const wd = ctx.createGain(); wd.gain.value = thick ? 15 : 40;
    const wd2 = ctx.createGain(); wd2.gain.value = thick ? 10 : 25;
    wob.connect(wd); wob2.connect(wd2);
    for (const d of [wd, wd2]) { d.connect(res1.frequency); d.connect(res2.frequency); }
    const pitch = (level) => (thick ? 230 : 320) * 2 ** (level * 1.9);   // 빈 잔 320Hz → 가득 ~1200Hz (우유 230 → ~860)
    const setPitch = (t) => {
      res1.frequency.setTargetAtTime(pitch(state.level), t, 0.08);
      res2.frequency.setTargetAtTime(pitch(state.level) * 2.4, t, 0.08);
    };
    setPitch(t0);
    src.start(t0); wob.start(t0); wob2.start(t0);

    const drip = (t) => {        // 방울 하나: 위로 짧게 미끄러지는 "똑" (잔이 찰수록 높게)
      const o = ctx.createOscillator(); o.type = 'sine';
      const f = pitch(state.level) * (1.6 + Math.random() * 0.5);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(DRIP_GAIN * (0.7 + Math.random() * 0.3), t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g); g.connect(out); g.connect(this.verb);
      o.start(t); o.stop(t + 0.1);
    };
    // 물줄기가 0 이면 방울을 예약: 처음엔 촘촘히(0.25초), 점점 뜸하게(최대 1.4초)
    const scheduleDrips = (until) => {
      if (state.stopped || state.flow > 0.05) return;
      while (state.nextDrip < until) {
        drip(state.nextDrip);
        state.dryFor++;
        state.nextDrip += Math.min(1.4, 0.25 * 1.35 ** state.dryFor) * (0.8 + Math.random() * 0.4);
      }
    };
    const timer = this.ctx instanceof (globalThis.OfflineAudioContext ?? Object) ? null
      : setInterval(() => scheduleDrips(ctx.currentTime + 0.5), 150);

    const h = {
      setLevel: (v, w = null) => {
        state.level = Math.max(0, Math.min(1, v));
        setPitch(w ?? ctx.currentTime);
      },
      setFlow: (v, w = null) => {
        const t = w ?? ctx.currentTime;
        const was = state.flow;
        state.flow = Math.max(0, Math.min(1, v));
        flowGain.gain.setTargetAtTime(POUR_GAIN * state.flow ** 0.7, t, 0.06);
        if (state.flow <= 0.05 && was > 0.05) { state.dryFor = 0; state.nextDrip = t + 0.12; }
        scheduleDrips(t + (timer ? 0.5 : 2));    // 실시간: 0.5초치 + 타이머가 이어서 (물줄기가 다시 오면 금방 멈춤) / 오프라인 검증: 2초치
      },
      stop: (fade = 0.3, w = null) => {
        if (state.stopped) return;
        state.stopped = true;
        if (timer) clearInterval(timer);
        const t = Math.max(w ?? ctx.currentTime, t0 + 0.01);
        const g = out.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
        g.setTargetAtTime(0, t, Math.max(0.02, fade) / 4);
        for (const n of [src, wob, wob2]) n.stop(t + fade + 0.1);
      },
    };
    return h;
  }

  /** 녹음 효과음 (samples.json 의 sfx). 아직 안 불러왔으면 false → 합성으로 */
  #playRec(name, t) {
    const r = this.sfxRec[name];
    if (!r) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = r.buf;
    const g = ctx.createGain();
    const gain = REC_GAIN * r.gain;
    g.gain.setValueAtTime(gain, t);
    if (r.fade) { g.gain.setValueAtTime(gain, t + r.dur - r.fade); g.gain.linearRampToValueAtTime(0, t + r.dur); }
    src.connect(g).connect(this.master);
    src.start(t, r.start, r.dur);
    return true;
  }

  #pour(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.#noise(1.2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1300, t + 1.1);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.12, t + 0.1);
    gn.gain.linearRampToValueAtTime(0, t + 1.2);
    src.connect(bp).connect(gn).connect(this.master);
    src.start(t);
  }

  /** 문에 달린 작은 종: 맞지 않는 배음(종 특유의 쇳소리) + 추가 두세 번 흔들림 */
  #doorBell(t) {
    const ctx = this.ctx;
    const f = 1480;
    const hits = [[0, 0.09], [0.13, 0.06], [0.3, 0.035], [0.52, 0.018]];
    for (const [dt, vol] of hits) {
      const s = t + dt;
      const out = ctx.createGain(); out.gain.value = vol;
      out.connect(this.master);
      out.connect(this.echo);
      for (const [ratio, amp, decay] of [[1, 1, 1.4], [2.32, 0.5, 0.9], [4.25, 0.3, 0.5], [6.8, 0.15, 0.25]]) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f * ratio * (1 + (Math.random() - 0.5) * 0.004);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(amp, s + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, s + decay);
        o.connect(g).connect(out);
        o.start(s); o.stop(s + decay + 0.05);
      }
    }
  }

  /** 종이 한 장 넘기는 소리: 높은 대역 잡음이 쓸려 올라갔다가 톡 내려앉음 */
  #page(t) {
    const ctx = this.ctx;
    const dur = 0.07 + Math.random() * 0.02;
    const src = ctx.createBufferSource(); src.buffer = this.#noise(dur + 0.02);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    const f0 = 1500 * (0.9 + Math.random() * 0.2);
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f0 * 1.8, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
    const g = ctx.createGain();
    const vol = CLICK_GAIN * 1.6 * (0.85 + Math.random() * 0.3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(bp).connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }


  /** 꿈 조각: 위에서 반짝이며 내려오는 음 + 천천히 피어나는 화음 */
  #item(t) {
    const ctx = this.ctx;
    [96, 91, 88, 84].forEach((n, i) => this.#bell(n, t + i * 0.07, 0.035, this.master));
    const chord = [65, 69, 72, 76]; // Fmaj7
    for (const n of chord) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = midi(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + 0.2);
      g.gain.linearRampToValueAtTime(0.02, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(g); g.connect(this.master); g.connect(this.echo);
      o.start(t + 0.2); o.stop(t + 3.3);
    }
    this.#bell(84, t + 0.45, 0.06, this.master);
  }

  // ── 모바일 ─────────────────────────────────────────────────
  #resume() {
    const ctx = this.ctx;
    if (!ctx || !ctx.resume || ctx.state === 'running' || ctx.state === 'closed') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    ctx.resume().catch(() => {});
  }

  /** iOS: 사용자 탭 안에서 빈 버퍼를 한 번 재생해야 소리가 풀린다 */
  #unlock() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
    this.#resume();
  }

  #mobileHooks() {
    if (typeof document === 'undefined') return;
    // 탭할 때마다 (iOS 는 전화·다른 앱 소리 뒤에 'interrupted' 로 멈춰 있을 수 있음)
    const poke = () => this.#resume();
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, poke, { capture: true, passive: true });
    // 화면이 숨겨지면 멈추고, 돌아오면 다시
    const vis = () => {
      if (document.hidden) { if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
      else this.#resume();
    };
    document.addEventListener('visibilitychange', vis);
    addEventListener('pagehide', () => { if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); });
    addEventListener('pageshow', vis);
  }
}
