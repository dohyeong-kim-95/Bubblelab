(() => {
  "use strict";

  const PREP_MS = 5000;
  const INHALE_MS = 4000;
  const EXHALE_MS = 6000;
  const REGULAR_CYCLES = 6;
  const SLEEP_CYCLES = 30;
  const SLEEP_FADE_MS = 60000;
  const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const body = document.body;
  const introView = document.getElementById("introView");
  const practiceView = document.getElementById("practiceView");
  const completeView = document.getElementById("completeView");
  const audioOptions = document.getElementById("audioOptions");
  const volume = document.getElementById("volume");
  const volumeOutput = document.getElementById("volumeOutput");
  const previewButton = document.getElementById("previewButton");
  const startButton = document.getElementById("startButton");
  const startSummary = document.getElementById("startSummary");
  const sleepMode = document.getElementById("sleepMode");
  const pauseButton = document.getElementById("pauseButton");
  const stopButton = document.getElementById("stopButton");
  const againButton = document.getElementById("againButton");
  const roundText = document.getElementById("roundText");
  const roundDots = [...document.querySelectorAll("#roundDots i")];
  const phaseKicker = document.getElementById("phaseKicker");
  const phaseText = document.getElementById("phaseText");
  const phaseHint = document.getElementById("phaseHint");
  const infoDialog = document.getElementById("infoDialog");
  const infoButton = document.getElementById("infoButton");
  const dialogClose = document.getElementById("dialogClose");
  const dialogConfirm = document.getElementById("dialogConfirm");
  const toast = document.getElementById("toast");

  let mode = "both";
  let isSleepMode = false;
  let audioContext = null;
  let masterGain = null;
  let scheduledNodes = [];
  let previewNodes = [];
  let sessionStart = 0;
  let fallbackPausedAt = 0;
  let fallbackPausedTotal = 0;
  let animationFrame = 0;
  let sessionState = "idle";
  let lastPhaseKey = "";
  let wakeLock = null;
  let toastTimer = 0;

  const hasAudio = () => mode === "audio" || mode === "both";
  const hasVisual = () => mode === "visual" || mode === "both";
  const cycleCount = () => isSleepMode ? SLEEP_CYCLES : REGULAR_CYCLES;
  const totalBreathMs = () => cycleCount() * (INHALE_MS + EXHALE_MS);
  const dbVolume = () => Math.pow(Number(volume.value) / 100, 1.35) * 0.2;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function setView(view) {
    body.dataset.view = view;
    introView.hidden = view !== "intro";
    practiceView.hidden = view !== "practice";
    completeView.hidden = view !== "complete";
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      audioContext = new AudioCtx();
      masterGain = audioContext.createGain();
      masterGain.gain.value = dbVolume();
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") audioContext.resume();
    masterGain.gain.setTargetAtTime(dbVolume(), audioContext.currentTime, .03);
    return true;
  }

  function stopNodes(nodes) {
    for (const node of nodes) {
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    nodes.length = 0;
  }

  function makeTone(start, duration, fromHz, toHz, gain = 1, target = scheduledNodes) {
    const oscillator = audioContext.createOscillator();
    const color = audioContext.createBiquadFilter();
    const envelope = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(fromHz, start);
    oscillator.frequency.exponentialRampToValueAtTime(toHz, start + duration);
    color.type = "lowpass";
    color.frequency.value = 950;
    color.Q.value = .65;
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0002, gain), start + Math.min(.38, duration * .16));
    envelope.gain.setValueAtTime(Math.max(.0002, gain), start + Math.max(.4, duration - .5));
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(color).connect(envelope).connect(masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration + .03);
    target.push(oscillator, color, envelope);
  }

  function makeDrop(start, pitch = 620, gain = .7, target = scheduledNodes) {
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(pitch, start);
    oscillator.frequency.exponentialRampToValueAtTime(pitch * .62, start + .48);
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + .025);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + .62);
    oscillator.connect(envelope).connect(masterGain);
    oscillator.start(start);
    oscillator.stop(start + .65);
    target.push(oscillator, envelope);
  }

  function scheduleSessionAudio() {
    stopNodes(scheduledNodes);
    const base = audioContext.currentTime + PREP_MS / 1000;
    makeDrop(base - .42, 520, .42);
    makeDrop(base - .16, 720, .33);
    for (let cycle = 0; cycle < cycleCount(); cycle += 1) {
      const start = base + cycle * 10;
      makeTone(start, 4, 196, 294, .58);
      makeTone(start + 4, 6, 294, 174, .52);
    }
    const end = base + cycleCount() * 10;
    if (isSleepMode) {
      const fadeStart = end - SLEEP_FADE_MS / 1000;
      const audibleGain = Math.max(.0001, dbVolume());
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.setValueAtTime(audibleGain, audioContext.currentTime);
      masterGain.gain.setValueAtTime(audibleGain, fadeStart);
      masterGain.gain.exponentialRampToValueAtTime(.0001, end);
    } else {
      makeDrop(end + .08, 440, .32);
      makeDrop(end + .35, 554, .26);
      makeDrop(end + .66, 659, .2);
    }
  }

  function previewSound() {
    if (!ensureAudio()) {
      showToast("이 브라우저에서는 소리를 재생할 수 없어요.");
      return;
    }
    stopNodes(previewNodes);
    const now = audioContext.currentTime + .08;
    makeDrop(now, 560, .38, previewNodes);
    makeTone(now + .45, 1.8, 196, 294, .52, previewNodes);
    makeTone(now + 2.28, 2.5, 294, 174, .46, previewNodes);
    previewButton.setAttribute("aria-label", "소리 미리 듣는 중");
    setTimeout(() => previewButton.removeAttribute("aria-label"), 4900);
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

  function nowMs() {
    if (hasAudio() && audioContext) return audioContext.currentTime * 1000;
    if (sessionState === "paused") return fallbackPausedAt;
    return performance.now() - fallbackPausedTotal;
  }

  function phaseAt(elapsed) {
    if (elapsed < PREP_MS) {
      return { type: "prep", progress: elapsed / PREP_MS, round: -1, phaseElapsed: elapsed };
    }
    const breathElapsed = elapsed - PREP_MS;
    if (breathElapsed >= totalBreathMs()) return { type: "complete", progress: 1, round: cycleCount() };
    const round = Math.floor(breathElapsed / (INHALE_MS + EXHALE_MS));
    const within = breathElapsed % (INHALE_MS + EXHALE_MS);
    if (within < INHALE_MS) return { type: "inhale", progress: within / INHALE_MS, round, phaseElapsed: within };
    return { type: "exhale", progress: (within - INHALE_MS) / EXHALE_MS, round, phaseElapsed: within - INHALE_MS };
  }

  function smoothStep(t) { return t * t * (3 - 2 * t); }

  function updatePhaseCopy(phase) {
    const key = `${phase.type}:${phase.round}`;
    if (key === lastPhaseKey) return;
    lastPhaseKey = key;
    body.dataset.phase = phase.type;

    if (phase.type === "prep") {
      roundText.textContent = "준비";
      phaseKicker.textContent = "잠시 후 시작해요";
      phaseText.textContent = "편안한 자세를 찾아보세요";
      phaseHint.textContent = hasAudio() ? "휴대폰을 내려놓아도 좋아요" : "눈은 감지 않고 버블을 바라봐요";
      return;
    }

    if (isSleepMode) {
      const remainingSeconds = Math.max(0, Math.ceil((totalBreathMs() - phase.round * (INHALE_MS + EXHALE_MS) - phase.phaseElapsed) / 1000));
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      roundText.textContent = `${minutes}:${String(seconds).padStart(2, "0")} 남음`;
    } else {
      roundText.textContent = `${phase.round + 1} / ${REGULAR_CYCLES}`;
    }
    document.getElementById("roundDots").hidden = isSleepMode;
    roundDots.forEach((dot, index) => {
      dot.classList.toggle("done", index < phase.round);
      dot.classList.toggle("current", index === phase.round);
    });
    if (phase.type === "inhale") {
      phaseKicker.textContent = "소리가 올라가요";
      phaseText.textContent = "편안한 만큼 들이마셔요";
      phaseHint.textContent = phase.round === 0 ? "코로 부드럽게 숨을 맞이해요" : "";
    } else {
      phaseKicker.textContent = "소리가 내려가요";
      phaseText.textContent = "천천히 내쉬어요";
      phaseHint.textContent = phase.round === 2 ? "생각이 떠올라도 다음 숨으로 돌아와요" : "";
    }
  }

  function render() {
    if (sessionState !== "running") return;
    const elapsed = Math.max(0, nowMs() - sessionStart);
    const phase = phaseAt(elapsed);
    if (phase.type === "complete") {
      finishSession();
      return;
    }
    updatePhaseCopy(phase);

    if (isSleepMode) {
      const breathElapsed = Math.max(0, elapsed - PREP_MS);
      const fadeProgress = Math.max(0, Math.min(1, (breathElapsed - (totalBreathMs() - SLEEP_FADE_MS)) / SLEEP_FADE_MS));
      body.style.setProperty("--sleep-dim", String(fadeProgress * .82));
    }

    let scale = .72;
    if (phase.type === "inhale") scale = .72 + .28 * smoothStep(phase.progress);
    if (phase.type === "exhale") scale = 1 - .28 * smoothStep(phase.progress);
    if (phase.type === "prep") scale = .74 + Math.sin(phase.progress * Math.PI) * .035;
    if (!REDUCED_MOTION && hasVisual()) body.style.setProperty("--bubble-scale", scale.toFixed(4));
    body.style.setProperty("--phase-progress", `${Math.round(phase.progress * 360)}deg`);
    animationFrame = requestAnimationFrame(render);
  }

  function startSession() {
    stopNodes(previewNodes);
    mode = document.querySelector('input[name="mode"]:checked').value;
    isSleepMode = sleepMode.checked;
    body.dataset.mode = mode;
    body.dataset.sleep = String(isSleepMode);
    document.getElementById("roundDots").hidden = isSleepMode;
    body.removeAttribute("data-sleep-complete");
    body.style.setProperty("--sleep-dim", "0");
    if (hasAudio() && !ensureAudio()) {
      mode = "visual";
      body.dataset.mode = mode;
      showToast("소리를 사용할 수 없어 버블 보기로 시작해요.");
    }
    if (hasAudio()) scheduleSessionAudio();
    sessionState = "running";
    fallbackPausedTotal = 0;
    fallbackPausedAt = 0;
    sessionStart = nowMs();
    lastPhaseKey = "";
    roundDots.forEach((dot) => dot.className = "");
    setView("practice");
    requestWakeLock();
    cancelAnimationFrame(animationFrame);
    render();
  }

  async function togglePause() {
    if (sessionState === "running") {
      sessionState = "paused";
      if (hasAudio() && audioContext) await audioContext.suspend();
      else fallbackPausedAt = performance.now() - fallbackPausedTotal;
      pauseButton.innerHTML = '<span aria-hidden="true">▶</span><b>계속하기</b>';
      phaseKicker.textContent = "잠시 멈췄어요";
      phaseText.textContent = "내 호흡으로 쉬어가세요";
      phaseHint.textContent = "준비되면 이어갈 수 있어요";
      return;
    }
    if (sessionState === "paused") {
      if (hasAudio() && audioContext) await audioContext.resume();
      else fallbackPausedTotal = performance.now() - fallbackPausedAt;
      sessionState = "running";
      pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span><b>일시정지</b>';
      lastPhaseKey = "";
      render();
    }
  }

  function resetSession() {
    cancelAnimationFrame(animationFrame);
    stopNodes(scheduledNodes);
    if (audioContext?.state === "suspended") audioContext.resume();
    releaseWakeLock();
    sessionState = "idle";
    body.removeAttribute("data-phase");
    body.style.removeProperty("--bubble-scale");
    body.style.removeProperty("--phase-progress");
    body.style.removeProperty("--sleep-dim");
    body.removeAttribute("data-sleep");
    body.removeAttribute("data-sleep-complete");
    document.getElementById("roundDots").hidden = false;
    pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span><b>일시정지</b>';
  }

  function stopSession() {
    resetSession();
    setView("intro");
    startButton.focus();
  }

  function finishSession() {
    cancelAnimationFrame(animationFrame);
    releaseWakeLock();
    sessionState = "complete";
    if (isSleepMode) {
      body.dataset.sleepComplete = "true";
      document.getElementById("completeTitle").innerHTML = "이제 조용히<br>쉬어가세요.";
      completeView.querySelector(":scope > p:not(.eyebrow)").innerHTML = "소리는 여기서 천천히 사라졌어요.<br>화면을 보지 않아도 괜찮아요.";
    } else {
      document.getElementById("completeTitle").innerHTML = "잠깐 멈춰<br>있었습니다.";
      completeView.querySelector(":scope > p:not(.eyebrow)").innerHTML = "호흡을 조절하지 않아도 괜찮아요.<br>지금의 몸과 마음을 가볍게 느껴보세요.";
    }
    setView("complete");
    completeView.focus?.();
  }

  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener("change", () => {
      mode = input.value;
      body.dataset.mode = mode;
      audioOptions.hidden = mode === "visual";
    });
  });
  volume.addEventListener("input", () => {
    volumeOutput.textContent = `${volume.value}%`;
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(dbVolume(), audioContext.currentTime, .025);
  });
  sleepMode.addEventListener("change", () => {
    if (sleepMode.checked && document.querySelector('input[name="mode"]:checked').value === "visual") {
      const audioRadio = document.querySelector('input[name="mode"][value="audio"]');
      audioRadio.checked = true;
      mode = "audio";
      body.dataset.mode = mode;
      audioOptions.hidden = false;
      showToast("잠들기 모드에 맞춰 소리 듣기를 켰어요.");
    }
    startSummary.textContent = sleepMode.checked
      ? "5분 · 마지막 1분에 소리가 천천히 사라져요"
      : "4초 들이마시고 · 6초 내쉬기";
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
