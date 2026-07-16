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

  function beginRelease(thought) {
    clearTimers();
    floatingThought.textContent = thought;
    input.value = "";
    charCount.textContent = "0";
    inputError.textContent = "";
    releaseMessage.textContent = "잠시 바라봐요. 바꾸지 않아도 괜찮아요.";
    setView("release");

    thoughtBubble.classList.remove("is-floating");
    void thoughtBubble.offsetWidth;
    thoughtBubble.classList.add("is-floating");

    timers.push(setTimeout(() => {
      if (state === "release") releaseMessage.textContent = "생각과 나 사이에 작은 거리를 두어봐요.";
    }, REDUCED_MOTION ? 900 : 3000));
    timers.push(setTimeout(() => {
      if (state === "release") releaseMessage.textContent = "붙잡지 않아도, 밀어내지 않아도 괜찮아요.";
    }, REDUCED_MOTION ? 1800 : 6200));
    timers.push(setTimeout(finishRelease, REDUCED_MOTION ? 3300 : 10500));
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
    if (["floatAway", "gentlyFade"].includes(event.animationName)) finishRelease();
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
