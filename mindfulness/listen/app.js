(() => {
  "use strict";

  const TRACK_SECONDS = 27.633;
  const ARTWORK_URL = "https://assets.bubblelab.dev/_assets/music/upward-drift/upward_drift_preview.webp";
  const STEPS = [
    { title: "전체로 듣기", hint: "좋고 나쁨을 판단하지 않고, 들리는 만큼만 들어보세요." },
    { title: "변화 듣기", hint: "높이와 음색이 달라지는 순간을 가볍게 알아차려요." },
    { title: "주변까지 듣기", hint: "음악과 몸, 주변의 소리를 함께 느껴보세요." },
  ];

  const introView = document.getElementById("introView");
  const practiceView = document.getElementById("practiceView");
  const completeView = document.getElementById("completeView");
  const threeButton = document.getElementById("threeButton");
  const singleButton = document.getElementById("singleButton");
  const againButton = document.getElementById("againButton");
  const pauseButton = document.getElementById("pauseButton");
  const stopButton = document.getElementById("stopButton");
  const track = document.getElementById("track");
  const elapsedText = document.getElementById("elapsedText");
  const totalText = document.getElementById("totalText");
  const progressFill = document.getElementById("progressFill");
  const stepDots = [...document.querySelectorAll("#stepDots li")];
  const phaseKicker = document.getElementById("phaseKicker");
  const phaseText = document.getElementById("phaseText");
  const phaseHint = document.getElementById("phaseHint");
  const infoDialog = document.getElementById("infoDialog");
  const infoButton = document.getElementById("infoButton");
  const dialogClose = document.getElementById("dialogClose");
  const dialogConfirm = document.getElementById("dialogConfirm");
  const toast = document.getElementById("toast");

  let plan = [];
  let segmentIndex = -1;
  let sessionMode = "three";
  let sessionState = "idle";
  let timerId = 0;
  let timerDeadline = 0;
  let timerRemaining = 0;
  let animationFrame = 0;
  let audioContext = null;
  let wakeLock = null;
  let toastTimer = 0;

  const threePlan = () => [
    { type: "prepare", duration: 5, step: 0 },
    { type: "playing", duration: TRACK_SECONDS, step: 0 },
    { type: "silence", duration: 5, after: 0 },
    { type: "prepare", duration: 4, step: 1 },
    { type: "playing", duration: TRACK_SECONDS, step: 1 },
    { type: "silence", duration: 7, after: 1 },
    { type: "prepare", duration: 4, step: 2 },
    { type: "playing", duration: TRACK_SECONDS, step: 2 },
    { type: "silence", duration: 12, final: true },
  ];
  const singlePlan = () => [
    { type: "prepare", duration: 4, step: 0 },
    { type: "playing", duration: TRACK_SECONDS, step: 0 },
    { type: "silence", duration: 8.4, final: true },
  ];

  function totalDuration() { return plan.reduce((sum, segment) => sum + segment.duration, 0); }
  function formatTime(seconds) {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  }
  function setView(view) {
    document.body.dataset.view = view;
    introView.hidden = view !== "intro";
    practiceView.hidden = view !== "practice";
    completeView.hidden = view !== "complete";
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
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

  function ensureChime() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContext = new AudioCtx();
    }
    if (audioContext?.state === "suspended") audioContext.resume();
  }
  function playChime() {
    if (!audioContext) return;
    const now = audioContext.currentTime + .02;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(523, now);
    oscillator.frequency.exponentialRampToValueAtTime(659, now + .55);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.035, now + .08);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .8);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + .82);
  }

  function currentSegment() { return plan[segmentIndex]; }
  function currentTimerRemaining() {
    if (sessionState === "paused") return timerRemaining;
    return Math.max(0, timerDeadline - performance.now());
  }
  function completedSeconds() {
    return plan.slice(0, Math.max(0, segmentIndex)).reduce((sum, segment) => sum + segment.duration, 0);
  }
  function updateProgress() {
    if (!plan.length || segmentIndex < 0) return;
    const segment = currentSegment();
    const within = segment.type === "playing"
      ? Math.min(segment.duration, track.currentTime || 0)
      : segment.duration - currentTimerRemaining() / 1000;
    const elapsed = Math.min(totalDuration(), completedSeconds() + Math.max(0, within));
    elapsedText.textContent = formatTime(elapsed);
    progressFill.style.width = `${elapsed / totalDuration() * 100}%`;
    if (sessionState === "running") animationFrame = requestAnimationFrame(updateProgress);
  }

  function updateStepDots(step) {
    stepDots.forEach((dot, index) => {
      dot.hidden = sessionMode === "single" && index > 0;
      dot.classList.toggle("active", index === step);
      dot.classList.toggle("done", index < step);
    });
  }
  function updatePhase(segment) {
    document.body.dataset.phase = segment.type;
    if (segment.type === "prepare") {
      updateStepDots(segment.step);
      phaseKicker.textContent = segment.step === 0 ? "잠시 후 시작해요" : `${segment.step + 1}번째 듣기`;
      phaseText.textContent = STEPS[segment.step].title;
      phaseHint.textContent = STEPS[segment.step].hint;
    } else if (segment.type === "playing") {
      updateStepDots(segment.step);
      phaseKicker.textContent = `${segment.step + 1} · listening`;
      phaseText.textContent = STEPS[segment.step].title;
      phaseHint.textContent = STEPS[segment.step].hint;
    } else if (segment.final) {
      phaseKicker.textContent = "after the music";
      phaseText.textContent = "음악이 없는 순간";
      phaseHint.textContent = "지금 가장 가까운 소리를 들어보세요.";
    } else if (segment.after === 0) {
      phaseKicker.textContent = "after the sound";
      phaseText.textContent = "사라진 자리도 들어봐요";
      phaseHint.textContent = "끝난 뒤 무엇이 들리는지 가볍게 알아차려요.";
    } else {
      phaseKicker.textContent = "between the sounds";
      phaseText.textContent = "다음 음악을 기다리지 않아요";
      phaseHint.textContent = "기다림도 지금 일어나는 경험으로 느껴보세요.";
    }
  }

  function scheduleTimer(milliseconds) {
    clearTimeout(timerId);
    timerRemaining = milliseconds;
    timerDeadline = performance.now() + milliseconds;
    timerId = setTimeout(advanceSegment, milliseconds);
  }
  async function enterSegment() {
    const segment = currentSegment();
    if (!segment) {
      finishSession();
      return;
    }
    updatePhase(segment);
    if (segment.type === "playing") {
      track.currentTime = 0;
      try {
        await track.play();
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
      } catch {
        pauseSession();
        showToast("재생을 시작할 수 없어요. 화면을 누른 뒤 다시 이어주세요.");
      }
    } else {
      if (segment.type === "prepare" && segment.step > 0) playChime();
      scheduleTimer(segment.duration * 1000);
    }
  }
  function advanceSegment() {
    if (sessionState !== "running") return;
    clearTimeout(timerId);
    segmentIndex += 1;
    enterSegment();
  }

  async function unlockTrack() {
    const previousVolume = track.volume;
    track.volume = 0;
    try {
      await track.play();
      track.pause();
      track.currentTime = 0;
      track.volume = previousVolume;
      return true;
    } catch {
      track.volume = previousVolume;
      return false;
    }
  }
  function configureMediaSession() {
    if (!("mediaSession" in navigator)) return;
    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: "Upward Drift",
        artist: "세 번 듣기 · Bubble Mindfulness",
        artwork: [{ src: ARTWORK_URL, sizes: "640x640", type: "image/webp" }],
      });
    }
    const setAction = (action, handler) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} };
    setAction("play", () => resumeSession());
    setAction("pause", () => pauseSession());
    setAction("stop", stopSession);
  }

  async function startSession(mode) {
    if (sessionState === "starting") return;
    sessionState = "starting";
    threeButton.disabled = true;
    singleButton.disabled = true;
    ensureChime();
    const unlocked = await unlockTrack();
    threeButton.disabled = false;
    singleButton.disabled = false;
    if (!unlocked) {
      sessionState = "idle";
      showToast("음악을 불러오지 못했어요. 네트워크를 확인해주세요.");
      return;
    }
    sessionMode = mode;
    plan = mode === "three" ? threePlan() : singlePlan();
    segmentIndex = 0;
    sessionState = "running";
    totalText.textContent = formatTime(totalDuration());
    elapsedText.textContent = "0:00";
    progressFill.style.width = "0%";
    pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span><b>일시정지</b>';
    setView("practice");
    configureMediaSession();
    requestWakeLock();
    cancelAnimationFrame(animationFrame);
    enterSegment();
    updateProgress();
  }

  function pauseSession() {
    if (sessionState !== "running") return;
    const segment = currentSegment();
    if (segment.type !== "playing") timerRemaining = currentTimerRemaining();
    sessionState = "paused";
    cancelAnimationFrame(animationFrame);
    if (segment.type === "playing") track.pause();
    else {
      clearTimeout(timerId);
    }
    pauseButton.innerHTML = '<span aria-hidden="true">▶</span><b>계속하기</b>';
    phaseKicker.textContent = "잠시 멈췄어요";
    phaseText.textContent = "주변의 소리로 쉬어가세요";
    phaseHint.textContent = "준비되면 이어서 들을 수 있어요.";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  }
  async function resumeSession() {
    if (sessionState !== "paused") return;
    const segment = currentSegment();
    sessionState = "running";
    updatePhase(segment);
    pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span><b>일시정지</b>';
    if (segment.type === "playing") {
      try { await track.play(); } catch { pauseSession(); return; }
    } else scheduleTimer(timerRemaining);
    updateProgress();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  }
  function togglePause() {
    if (sessionState === "running") pauseSession();
    else if (sessionState === "paused") resumeSession();
  }

  function resetSession() {
    clearTimeout(timerId);
    cancelAnimationFrame(animationFrame);
    track.pause();
    track.currentTime = 0;
    releaseWakeLock();
    sessionState = "idle";
    document.body.dataset.phase = "idle";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
  }
  function stopSession() {
    resetSession();
    setView("intro");
    threeButton.focus();
  }
  function finishSession() {
    clearTimeout(timerId);
    cancelAnimationFrame(animationFrame);
    track.pause();
    releaseWakeLock();
    sessionState = "complete";
    progressFill.style.width = "100%";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    setView("complete");
    againButton.focus();
  }

  track.addEventListener("ended", () => {
    if (sessionState === "running" && currentSegment()?.type === "playing") advanceSegment();
  });
  track.addEventListener("error", () => {
    if (["running", "starting"].includes(sessionState)) showToast("음악을 불러오지 못했어요.");
  });
  threeButton.addEventListener("click", () => startSession("three"));
  singleButton.addEventListener("click", () => startSession("single"));
  againButton.addEventListener("click", () => startSession(sessionMode));
  pauseButton.addEventListener("click", togglePause);
  stopButton.addEventListener("click", stopSession);
  infoButton.addEventListener("click", () => infoDialog.showModal());
  dialogClose.addEventListener("click", () => infoDialog.close());
  dialogConfirm.addEventListener("click", () => infoDialog.close());
  infoDialog.addEventListener("click", (event) => { if (event.target === infoDialog) infoDialog.close(); });
  addEventListener("pagehide", resetSession);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && sessionState === "running") requestWakeLock();
  });
})();
