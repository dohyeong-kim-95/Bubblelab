(() => {
  "use strict";

  const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const introView = document.getElementById("introView");
  const releaseView = document.getElementById("releaseView");
  const completeView = document.getElementById("completeView");
  const form = document.getElementById("thoughtForm");
  const input = document.getElementById("thoughtInput");
  const charCount = document.getElementById("charCount");
  const inputError = document.getElementById("inputError");
  const inputShell = document.querySelector(".input-shell");
  const thoughtBubble = document.getElementById("thoughtBubble");
  const floatingThought = document.getElementById("floatingThought");
  const releaseMessage = document.getElementById("releaseMessage");
  const cancelButton = document.getElementById("cancelButton");
  const againButton = document.getElementById("againButton");
  const infoDialog = document.getElementById("infoDialog");
  const infoButton = document.getElementById("infoButton");
  const dialogClose = document.getElementById("dialogClose");
  const dialogConfirm = document.getElementById("dialogConfirm");

  let timers = [];
  let state = "intro";
  let flightEnded = false;

  function setView(view) {
    state = view;
    document.body.dataset.view = view;
    introView.hidden = view !== "intro";
    releaseView.hidden = view !== "release";
    completeView.hidden = view !== "complete";
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function forgetThought() {
    floatingThought.textContent = "";
    input.value = "";
    charCount.textContent = "0";
  }

  function showInputError(message) {
    inputError.textContent = message;
    inputShell.classList.remove("shake");
    void inputShell.offsetWidth;
    inputShell.classList.add("shake");
    input.focus();
  }

  function finishRelease() {
    if (state !== "release") return;
    clearTimers();
    thoughtBubble.classList.remove("is-floating");
    forgetThought();
    setView("complete");
    againButton.focus();
  }

  function endFlight() {
    if (state !== "release" || flightEnded) return;
    flightEnded = true;
    floatingThought.textContent = "";
    releaseMessage.textContent = "이제 지금의 호흡과 감각으로 돌아와요.";
    timers.push(setTimeout(finishRelease, REDUCED_MOTION ? 450 : 750));
  }

  function beginRelease(thought) {
    clearTimers();
    flightEnded = false;
    floatingThought.textContent = thought;
    input.value = "";
    charCount.textContent = "0";
    inputError.textContent = "";
    releaseMessage.textContent = "이건 지금 떠오른 하나의 생각이에요.";
    setView("release");

    thoughtBubble.classList.remove("is-floating");
    thoughtBubble.dataset.direction = Math.random() < .5 ? "left" : "right";
    void thoughtBubble.offsetWidth;
    thoughtBubble.classList.add("is-floating");

    timers.push(setTimeout(() => {
      if (state === "release") releaseMessage.textContent = "조금 떨어져 바라봐요.";
    }, REDUCED_MOTION ? 500 : 900));
    timers.push(setTimeout(() => {
      if (state === "release") releaseMessage.textContent = "붙잡지 않아도, 밀어내지 않아도 괜찮아요.";
    }, REDUCED_MOTION ? 1050 : 1900));
    timers.push(setTimeout(endFlight, REDUCED_MOTION ? 2000 : 4100));
  }

  function returnToIntro() {
    clearTimers();
    thoughtBubble.classList.remove("is-floating");
    forgetThought();
    setView("intro");
    requestAnimationFrame(() => input.focus());
  }

  input.addEventListener("input", () => {
    charCount.textContent = String([...input.value].length);
    if (input.value.trim()) inputError.textContent = "";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const thought = input.value.trim();
    if (!thought) {
      showInputError("떠오르는 생각을 한 줄 적어주세요.");
      return;
    }
    beginRelease(thought);
  });

  thoughtBubble.addEventListener("animationend", (event) => {
    if (["floatAway", "gentlyFade"].includes(event.animationName)) endFlight();
  });
  cancelButton.addEventListener("click", returnToIntro);
  againButton.addEventListener("click", returnToIntro);

  infoButton.addEventListener("click", () => infoDialog.showModal());
  dialogClose.addEventListener("click", () => infoDialog.close());
  dialogConfirm.addEventListener("click", () => infoDialog.close());
  infoDialog.addEventListener("click", (event) => {
    if (event.target === infoDialog) infoDialog.close();
  });

  addEventListener("pagehide", () => {
    clearTimers();
    forgetThought();
  });
})();
