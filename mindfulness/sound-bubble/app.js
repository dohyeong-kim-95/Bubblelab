(() => {
  "use strict";

  const SESSION_SECONDS = 120;
  const PREP_SECONDS = 5;
  const BUBBLES = [
    { start: 5, duration: 7.2, pitch: 174 },
    { start: 18, duration: 7.8, pitch: 196 },
    { start: 32, duration: 7.1, pitch: 185 },
    { start: 46, duration: 8, pitch: 164 },
    { start: 61, duration: 7.4, pitch: 196 },
    { start: 76, duration: 8.1, pitch: 174 },
    { start: 92, duration: 7.6, pitch: 185 },
    { start: 108, duration: 6.8, pitch: 164 }
  ];

  const body = document.body;
  const introView = document.getElementById("introView");
  const practiceView = document.getElementById("practiceView");
  const completeView = document.getElementById("completeView");
  const placementCopy = document.getElementById("placementCopy");
  const previewButton = document.getElementById("previewButton");
  const volume = document.getElementById("volume");
  const volumeOutput = document.getElementById("volumeOutput");
  const startButton = document.getElementById("startButton");
  const againButton = document.getElementById("againButton");
  const pauseButton = document.getElementById("pauseButton");
  const stopButton = document.getElementById("stopButton");
  const elapsedText = document.getElementById("elapsedText");
  const progressFill = document.getElementById("progressFill");
  const soundBubble = document.getElementById("soundBubble");
  const phaseKicker = document.getElementById("phaseKicker");
  const phaseText = document.getElementById("phaseText");
  const phaseHint = document.getElementById("phaseHint");
  const infoDialog = document.getElementById("infoDialog");
  const infoButton = document.getElementById("infoButton");
  const dialogClose = document.getElementById("dialogClose");
  const dialogConfirm = document.getElementById("dialogConfirm");
  const toast = document.getElementById("toast");

  let listenMode = "speaker";
  let audioContext = null;
  let masterGain = null;
  let compressor = null;
  let reverb = null;
  let scheduledNodes = [];
  let previewNodes = [];
  let sessionStart = 0;
  let sessionState = "idle";
  let animationFrame = 0;
  let lastPhase = "";
  let wakeLock = null;
  let toastTimer = 0;

  const level = () => Math.pow(Number(volume.value) / 100, 1.45) * .3;

  function setView(view) {
    body.dataset.view = view;
    introView.hidden = view !== "intro";
    practiceView.hidden = view !== "practice";
    completeView.hidden = view !== "complete";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function createImpulse(context, seconds = 2.4, decay = 2.8) {
    const length = Math.floor(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  async function ensureAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      audioContext = new AudioCtx();
      masterGain = audioContext.createGain();
      compressor = audioContext.createDynamicsCompressor();
      reverb = audioContext.createConvolver();
      reverb.buffer = createImpulse(audioContext);
      compressor.threshold.value = -22;
      compressor.knee.value = 18;
      compressor.ratio.value = 3;
      compressor.attack.value = .02;
      compressor.release.value = .35;
      masterGain.connect(compressor).connect(audioContext.destination);
      reverb.connect(masterGain);
    }
    if (audioContext.state === "suspended") await audioContext.resume();
    masterGain.gain.setTargetAtTime(level(), audioContext.currentTime, .04);
    return true;
  }

  function stopNodes(nodes) {
    for (const node of nodes) {
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    nodes.length = 0;
  }

  function makeSpatialNode(start, duration, index) {
    if (listenMode === "headphones" && typeof audioContext.createPanner === "function") {
      const panner = audioContext.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.maxDistance = 8;
      panner.rolloffFactor = .7;
      const side = index % 2 === 0 ? -.22 : .22;
      if (panner.positionX) {
        panner.positionX.setValueAtTime(side, start);
        panner.positionX.linearRampToValueAtTime(-side * .35, start + duration);
        panner.positionY.setValueAtTime(-.72, start);
        panner.positionY.linearRampToValueAtTime(1.35, start + duration);
        panner.positionZ.setValueAtTime(-.7, start);
        panner.positionZ.linearRampToValueAtTime(-3.2, start + duration);
      } else {
        panner.setPosition(side, -.72, -.7);
      }
      return panner;
    }
    if (typeof audioContext.createStereoPanner === "function") {
      const panner = audioContext.createStereoPanner();
      const side = index % 2 === 0 ? -.08 : .08;
      panner.pan.setValueAtTime(side, start);
      panner.pan.linearRampToValueAtTime(-side, start + duration);
      return panner;
    }
    return audioContext.createGain();
  }

  function makeBubble(start, duration, basePitch, index, target) {
    const fundamental = audioContext.createOscillator();
    const overtone = audioContext.createOscillator();
    const overtoneGain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const envelope = audioContext.createGain();
    const spatial = makeSpatialNode(start, duration, index);
    const reverbSend = audioContext.createGain();

    fundamental.type = "sine";
    fundamental.frequency.setValueAtTime(basePitch, start);
    fundamental.frequency.exponentialRampToValueAtTime(basePitch * 2.08, start + duration * .82);
    fundamental.frequency.exponentialRampToValueAtTime(basePitch * 2.18, start + duration);

    overtone.type = "sine";
    overtone.frequency.setValueAtTime(basePitch * 2.01, start);
    overtone.frequency.exponentialRampToValueAtTime(basePitch * 4.22, start + duration);
    overtoneGain.gain.value = .075;

    filter.type = "lowpass";
    filter.Q.value = .45;
    filter.frequency.setValueAtTime(520, start);
    filter.frequency.exponentialRampToValueAtTime(2600, start + duration * .72);
    filter.frequency.exponentialRampToValueAtTime(1900, start + duration);

    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(.34, start + .8);
    envelope.gain.setValueAtTime(.34, start + duration * .42);
    envelope.gain.exponentialRampToValueAtTime(.12, start + duration * .72);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);

    reverbSend.gain.setValueAtTime(.035, start);
    reverbSend.gain.linearRampToValueAtTime(.18, start + duration * .72);
    reverbSend.gain.linearRampToValueAtTime(.24, start + duration);

    fundamental.connect(filter);
    overtone.connect(overtoneGain).connect(filter);
    filter.connect(envelope).connect(spatial);
    spatial.connect(masterGain);
    spatial.connect(reverbSend).connect(reverb);
    fundamental.start(start);
    overtone.start(start);
    fundamental.stop(start + duration + .04);
    overtone.stop(start + duration + .04);
    target.push(fundamental, overtone, overtoneGain, filter, envelope, spatial, reverbSend);
  }

  function scheduleSession() {
    stopNodes(scheduledNodes);
    const base = audioContext.currentTime + .08;
    sessionStart = base;
    BUBBLES.forEach((bubble, index) => {
      makeBubble(base + bubble.start, bubble.duration, bubble.pitch, index, scheduledNodes);
    });
  }

  async function previewSound() {
    if (!await ensureAudio()) {
      showToast("이 브라우저에서는 소리를 만들 수 없어요.");
      return;
    }
    stopNodes(previewNodes);
    makeBubble(audioContext.currentTime + .08, 7.2, 174, 0, previewNodes);
    previewButton.setAttribute("aria-label", "소리방울 미리 듣는 중");
    setTimeout(() => previewButton.removeAttribute("aria-label"), 7400);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  function phaseAt(elapsed) {
    if (elapsed < PREP_SECONDS) return { type: "prep", progress: elapsed / PREP_SECONDS };
    const index = BUBBLES.findIndex((bubble) => elapsed >= bubble.start && elapsed < bubble.start + bubble.duration);
    if (index >= 0) {
      const bubble = BUBBLES[index];
      return { type: "listening", index, progress: (elapsed - bubble.start) / bubble.duration };
    }
    return { type: "silence", progress: 0 };
  }

  function updateCopy(phase) {
    const key = phase.type === "listening" ? `${phase.type}:${phase.index}` : phase.type;
    if (key === lastPhase) return;
    lastPhase = key;
    body.dataset.phase = phase.type;
    if (phase.type === "prep") {
      phaseKicker.textContent = "잠시 후 시작해요";
      phaseText.textContent = listenMode === "speaker" ? "휴대폰을 턱 아래에 놓아보세요" : "눈을 감거나 먼 곳을 바라봐요";
      phaseHint.textContent = "소리를 쫓지 않고, 들리는 만큼만 들어요.";
    } else if (phase.type === "listening") {
      phaseKicker.textContent = "a sound bubble";
      phaseText.textContent = "소리가 변하고 멀어지는 것을 들어봐요";
      phaseHint.textContent = phase.index === 0 ? "음높이와 음색이 어떻게 달라지는지 느껴보세요." : "어디쯤 있는지 정확히 찾지 않아도 괜찮아요.";
    } else {
      phaseKicker.textContent = "after the sound";
      phaseText.textContent = "사라진 뒤의 고요도 들어봐요";
      phaseHint.textContent = "다음 소리를 기다리지 않고, 지금 들리는 것을 느껴요.";
    }
  }

  function render() {
    if (sessionState !== "running") return;
    const elapsed = Math.max(0, audioContext.currentTime - sessionStart);
    if (elapsed >= SESSION_SECONDS) {
      finishSession();
      return;
    }
    const phase = phaseAt(elapsed);
    updateCopy(phase);
    const rounded = Math.floor(elapsed);
    elapsedText.textContent = `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
    progressFill.style.width = `${Math.min(100, elapsed / SESSION_SECONDS * 100)}%`;

    if (phase.type === "listening") {
      const eased = phase.progress * phase.progress * (3 - 2 * phase.progress);
      const opacity = phase.progress < .2 ? .2 + phase.progress * 4 : Math.max(.05, 1 - (phase.progress - .2) / .8);
      soundBubble.style.opacity = String(opacity);
      soundBubble.style.transform = `translate3d(0,${32 - eased * 105}px,0) scale(${.78 - eased * .24})`;
      soundBubble.style.filter = `blur(${Math.max(0, (phase.progress - .72) * 8)}px)`;
    } else {
      soundBubble.removeAttribute("style");
    }
    animationFrame = requestAnimationFrame(render);
  }

  async function startSession() {
    stopNodes(previewNodes);
    if (!await ensureAudio()) {
      showToast("이 브라우저에서는 소리를 만들 수 없어요.");
      return;
    }
    listenMode = document.querySelector('input[name="listenMode"]:checked').value;
    scheduleSession();
    sessionState = "running";
    lastPhase = "";
    elapsedText.textContent = "0:00";
    progressFill.style.width = "0%";
    pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span><b>일시정지</b>';
    setView("practice");
    requestWakeLock();
    cancelAnimationFrame(animationFrame);
    render();
  }

  async function togglePause() {
    if (sessionState === "running") {
      sessionState = "paused";
      await audioContext.suspend();
      cancelAnimationFrame(animationFrame);
      pauseButton.innerHTML = '<span aria-hidden="true">▶</span><b>계속하기</b>';
      phaseKicker.textContent = "잠시 멈췄어요";
      phaseText.textContent = "주변의 소리로 쉬어가세요";
      phaseHint.textContent = "준비되면 이어서 들을 수 있어요.";
    } else if (sessionState === "paused") {
      await audioContext.resume();
      sessionState = "running";
      lastPhase = "";
      pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span><b>일시정지</b>';
      render();
    }
  }

  function resetSession() {
    cancelAnimationFrame(animationFrame);
    if (audioContext?.state === "suspended") audioContext.resume();
    stopNodes(scheduledNodes);
    releaseWakeLock();
    sessionState = "idle";
    body.dataset.phase = "idle";
    soundBubble.removeAttribute("style");
  }

  function stopSession() {
    resetSession();
    setView("intro");
    startButton.focus();
  }

  function finishSession() {
    cancelAnimationFrame(animationFrame);
    releaseWakeLock();
    stopNodes(scheduledNodes);
    sessionState = "complete";
    body.dataset.phase = "silence";
    setView("complete");
    againButton.focus();
  }

  document.querySelectorAll('input[name="listenMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      listenMode = input.value;
      stopNodes(previewNodes);
      placementCopy.innerHTML = listenMode === "speaker"
        ? '<span class="placement-icon" aria-hidden="true">◌</span><p><strong>휴대폰을 손바닥에 올려보세요.</strong><small>피부에 붙이지 않고 턱 아래 15~20cm에 편안히 둡니다.</small></p>'
        : '<span class="placement-icon" aria-hidden="true">⌒</span><p><strong>이어폰을 편안하게 착용하세요.</strong><small>좌우와 거리의 변화가 조금 더 섬세하게 들립니다.</small></p>';
    });
  });
  volume.addEventListener("input", () => {
    volumeOutput.textContent = `${volume.value}%`;
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(level(), audioContext.currentTime, .04);
  });
  previewButton.addEventListener("click", previewSound);
  startButton.addEventListener("click", startSession);
  againButton.addEventListener("click", startSession);
  pauseButton.addEventListener("click", togglePause);
  stopButton.addEventListener("click", stopSession);
  infoButton.addEventListener("click", () => infoDialog.showModal());
  dialogClose.addEventListener("click", () => infoDialog.close());
  dialogConfirm.addEventListener("click", () => infoDialog.close());
  infoDialog.addEventListener("click", (event) => { if (event.target === infoDialog) infoDialog.close(); });
  addEventListener("pagehide", () => {
    cancelAnimationFrame(animationFrame);
    stopNodes(scheduledNodes);
    stopNodes(previewNodes);
    releaseWakeLock();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && sessionState === "running") requestWakeLock();
  });
})();
