/**
 * Web Audio API를 활용한 사운드 효과 서비스
 * 외부 오디오 파일 없이 프로그래매틱하게 사운드를 생성합니다.
 */
export class AudioService {
  static _ctx = null;
  static _muted = false;
  static _bgmNode = null;
  static _bgmGain = null;

  static get ctx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  static get muted() {
    return this._muted;
  }

  static toggleMute() {
    this._muted = !this._muted;
    if (this._bgmGain) {
      this._bgmGain.gain.value = this._muted ? 0 : 0.08;
    }
    localStorage.setItem('avalon_muted', this._muted ? '1' : '0');
    return this._muted;
  }

  static init() {
    this._muted = localStorage.getItem('avalon_muted') === '1';
  }

  /** 투표 완료 효과음 */
  static playVoteSound() {
    if (this._muted) return;
    this._resumeCtx();
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  }

  /** 미션 성공 효과음 */
  static playSuccessSound() {
    if (this._muted) return;
    this._resumeCtx();
    const ctx = this.ctx;
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  /** 미션 실패 효과음 */
  static playFailSound() {
    if (this._muted) return;
    this._resumeCtx();
    const ctx = this.ctx;
    [300, 250].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.2;
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  /** 페이즈 전환 효과음 */
  static playPhaseTransition() {
    if (this._muted) return;
    this._resumeCtx();
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  }

  /** 다크 판타지 앰비언트 BGM */
  static startBGM() {
    if (this._bgmNode) return;
    this._resumeCtx();
    const ctx = this.ctx;
    const nodes = [];

    const masterGain = ctx.createGain();
    masterGain.gain.value = this._muted ? 0 : 0.08;
    masterGain.connect(ctx.destination);
    this._bgmGain = masterGain;

    // --- 레이어 1: 딥 드론 (A1 + E2) ---
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 55; // A1
    drone.connect(masterGain);
    drone.start();
    nodes.push(drone);

    const droneFifth = ctx.createOscillator();
    droneFifth.type = 'sine';
    droneFifth.frequency.value = 82.4; // E2
    const fifthGain = ctx.createGain();
    fifthGain.gain.value = 0.5;
    droneFifth.connect(fifthGain);
    fifthGain.connect(masterGain);
    droneFifth.start();
    nodes.push(droneFifth);

    // --- 레이어 2: 다크 패드 (필터드 톱니파) ---
    const pad = ctx.createOscillator();
    pad.type = 'sawtooth';
    pad.frequency.value = 110; // A2
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 400;
    padFilter.Q.value = 2;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.15;
    pad.connect(padFilter);
    padFilter.connect(padGain);
    padGain.connect(masterGain);
    pad.start();
    nodes.push(pad);

    // 패드 필터 스윕 LFO (느린 움직임)
    const padLfo = ctx.createOscillator();
    padLfo.type = 'sine';
    padLfo.frequency.value = 0.05; // 20초 주기
    const padLfoGain = ctx.createGain();
    padLfoGain.gain.value = 200;
    padLfo.connect(padLfoGain);
    padLfoGain.connect(padFilter.frequency);
    padLfo.start();
    nodes.push(padLfo);

    // --- 레이어 3: 고음 글래스 톤 ---
    const glass = ctx.createOscillator();
    glass.type = 'sine';
    glass.frequency.value = 880; // A5
    const glassGain = ctx.createGain();
    glassGain.gain.value = 0.02;
    glass.connect(glassGain);
    glassGain.connect(masterGain);
    glass.start();
    nodes.push(glass);

    // 글래스 볼륨 트레몰로
    const glassLfo = ctx.createOscillator();
    glassLfo.type = 'sine';
    glassLfo.frequency.value = 0.08;
    const glassLfoGain = ctx.createGain();
    glassLfoGain.gain.value = 0.015;
    glassLfo.connect(glassLfoGain);
    glassLfoGain.connect(glassGain.gain);
    glassLfo.start();
    nodes.push(glassLfo);

    // --- 레이어 4: 서브베이스 펄스 ---
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 27.5; // A0
    const subGain = ctx.createGain();
    subGain.gain.value = 0.3;
    sub.connect(subGain);
    subGain.connect(masterGain);
    sub.start();
    nodes.push(sub);

    // 마스터 볼륨 브리딩 LFO
    const masterLfo = ctx.createOscillator();
    masterLfo.type = 'sine';
    masterLfo.frequency.value = 0.07;
    const masterLfoGain = ctx.createGain();
    masterLfoGain.gain.value = 0.015;
    masterLfo.connect(masterLfoGain);
    masterLfoGain.connect(masterGain.gain);
    masterLfo.start();
    nodes.push(masterLfo);

    this._bgmNode = nodes;
  }

  static stopBGM() {
    if (!this._bgmNode) return;
    const t = this.ctx.currentTime;
    if (this._bgmGain) {
      this._bgmGain.gain.linearRampToValueAtTime(0, t + 1.0);
    }
    const nodesToStop = this._bgmNode;
    setTimeout(() => {
      for (const node of nodesToStop) {
        try { node.stop(); } catch {}
      }
    }, 1200);
    this._bgmNode = null;
    this._bgmGain = null;
  }

  static _resumeCtx() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
}
