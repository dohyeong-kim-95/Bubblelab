// 브라우저 내장 음성으로 텍스트를 읽어주는 공용 모듈 (Web Speech API).
// 무료·무제한·API 키 없음·서버 부하 0. 대신 목소리는 기기가 가진 것을 쓴다.
//
// 사용법: <script defer src="/_shared/tts.js"></script>
//   window.blSpeakText = () => "읽을 내용";        // 독의 🔊 버튼이 이걸 읽는다
//   window.blTTSConfig = { lang: "ko-KR", rate: 1 };  // 선택
//   blTTS.speak("직접 호출도 가능합니다");
//
// 이 API는 브라우저마다 함정이 많아서 토이가 직접 쓰면 같은 문제를 계속 만난다.
// 아래 일곱 가지를 여기서 한 번만 처리한다:
//   1) getVoices()가 첫 호출에 비어 있다 → voiceschanged를 기다린다
//   2) 크롬은 긴 발화를 ~15초에서 끊는다 → 문장 단위로 쪼개 큐로 잇는다
//   3) 크롬은 재생이 길어지면 큐가 멎는다 → 주기적으로 resume()을 핑한다
//   4) iOS는 첫 재생이 사용자 제스처 안이어야 한다 → 클릭 핸들러에서 await 하지 않는다
//   5) 앞선 발화가 남아 있으면 speak()가 먹지 않는다 → 항상 cancel() 먼저
//   6) 페이지를 떠나도 소리가 계속 난다 → pagehide에서 정리한다
//   7) 한국어 목소리가 아예 없는 기기가 있다 → hasVoice()로 알려준다(조용히 실패 금지)
(() => {
  const synth = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  const supported = !!(synth && Utterance);

  const cfg = () => window.blTTSConfig || {};
  const clamp = (v, lo, hi, fallback) =>
    (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : fallback);

  // ── 이벤트 ────────────────────────────────────────────
  const handlers = {};
  function on(type, cb) {
    (handlers[type] ||= new Set()).add(cb);
    return () => handlers[type]?.delete(cb);
  }
  function emit(type, detail) {
    for (const cb of handlers[type] || []) { try { cb(detail); } catch (_) {} }
  }

  // ── 목소리 ────────────────────────────────────────────
  // getVoices()는 첫 호출에 빈 배열을 주는 브라우저가 많다. voiceschanged를
  // 기다리되, 끝내 안 오는 환경도 있으므로 1초에서 포기하고 있는 대로 쓴다.
  const liveVoices = () => { try { return synth.getVoices() || []; } catch (_) { return []; } };
  const ready = !supported ? Promise.resolve([]) : new Promise((resolve) => {
    if (liveVoices().length) { resolve(liveVoices()); return; }
    let settled = false, timer = 0;                 // finish보다 먼저 선언한다 —
    const finish = () => {                          // 콜백이 즉시 불릴 수도 있다
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", finish);
      resolve(liveVoices());
    };
    synth.addEventListener?.("voiceschanged", finish);
    timer = setTimeout(finish, 1000);
  });

  // lang이 맞는 목소리 중 하나를 고른다. 같은 조건이면 기기 내장(localService)을
  // 우선한다 — 네트워크 목소리는 읽는 텍스트가 기기 밖으로 나가기 때문이다.
  function pickVoice(lang) {
    const want = String(lang || cfg().lang || "ko-KR").toLowerCase().replace("_", "-");
    const base = want.split("-")[0];
    let best = null, bestScore = 0;
    for (const voice of liveVoices()) {
      const code = String(voice.lang || "").toLowerCase().replace("_", "-");
      const score = code === want ? 2 : code.split("-")[0] === base ? 1 : 0;
      if (!score) continue;
      const better = score > bestScore
        || (score === bestScore && voice.localService && !best?.localService);
      if (better) { best = voice; bestScore = score; }
    }
    return best;
  }

  function voices(lang) {
    if (!lang) return liveVoices().slice();
    const base = String(lang).toLowerCase().split("-")[0];
    return liveVoices().filter((v) => String(v.lang || "").toLowerCase().startsWith(base));
  }

  // ── 문장 쪼개기 ───────────────────────────────────────
  // 크롬은 한 번에 들어온 긴 텍스트를 ~15초에서 잘라버린다. 문장 경계에서 나눠
  // 짧은 발화 여러 개로 이어 붙이면 잘리지 않고, 중간에 멈추기도 쉬워진다.
  const MAX_CHARS = 160;
  function chunk(text, max = MAX_CHARS) {
    const limit = Math.max(20, max | 0);
    const out = [];
    for (const line of String(text ?? "").split(/\n+/)) {
      const clean = line.replace(/[^\S\n]+/g, " ").trim();
      if (!clean) continue;
      let mergeable = false;                  // 줄이 바뀌면 앞 조각에 붙이지 않는다
      for (const piece of clean.split(/(?<=[.!?…。？！])\s+/)) {
        const sentence = piece.trim();
        if (!sentence) continue;
        const last = out[out.length - 1];
        if (mergeable && last && last.length + 1 + sentence.length <= limit) {
          out[out.length - 1] = `${last} ${sentence}`;
          continue;
        }
        if (sentence.length <= limit) { out.push(sentence); mergeable = true; continue; }
        // 한 문장이 한도를 넘으면 공백에서 강제로 나눈다
        let rest = sentence;
        while (rest.length > limit) {
          let cut = rest.lastIndexOf(" ", limit);
          if (cut <= 0) cut = limit;
          out.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        if (rest) out.push(rest);
        mergeable = true;
      }
    }
    return out;
  }

  // ── 재생 ──────────────────────────────────────────────
  let queue = [], index = 0, settle = null, pingTimer = 0;

  // 크롬은 재생이 길어지면 큐가 멎는다. 살아 있는 동안 주기적으로 깨운다.
  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (!settle) { stopPing(); return; }
      if (synth.paused) return;              // 사용자가 멈춰 둔 상태는 건드리지 않는다
      try { synth.resume(); } catch (_) {}
    }, 8000);
  }
  function stopPing() { clearInterval(pingTimer); pingTimer = 0; }

  function finish(reason) {
    const done = settle;
    settle = null; queue = []; index = 0;
    stopPing();
    if (!done) return;
    emit("end", { reason });
    done(reason);
  }

  function speakNext(opts) {
    if (!settle) return;
    if (index >= queue.length) { finish("end"); return; }

    const conf = cfg();
    const lang = opts.lang || conf.lang || "ko-KR";
    const voice = opts.voice || pickVoice(lang);
    const utterance = new Utterance(queue[index]);
    // voice에 SpeechSynthesisVoice가 아닌 값이 오면 브라우저가 던진다. 여기서
    // 새어 나가면 재생 상태가 영영 "읽는 중"으로 굳으므로 삼키고 기본 목소리로 간다.
    if (voice) { try { utterance.voice = voice; } catch (_) {} }
    utterance.lang = voice?.lang || lang;    // 목소리를 못 골라도 OS 기본값에 힌트는 준다
    utterance.rate = clamp(opts.rate ?? conf.rate, 0.1, 10, 1);
    utterance.pitch = clamp(opts.pitch ?? conf.pitch, 0, 2, 1);
    utterance.volume = clamp(opts.volume ?? conf.volume, 0, 1, 1);
    utterance.onend = () => {
      index += 1;
      emit("chunk", { index, total: queue.length });
      speakNext(opts);
    };
    utterance.onerror = (event) => {
      // stop()을 부르면 크롬이 interrupted/canceled를 던진다 — 실패가 아니다
      const kind = event?.error;
      if (kind === "interrupted" || kind === "canceled") return;
      emit("error", event);
      finish("error");
    };
    try { synth.speak(utterance); } catch (_) { emit("error", null); finish("error"); }
  }

  // 반환값: "end"(끝까지 읽음) | "stopped" | "error" | "unsupported" | "empty"
  function speak(text, opts = {}) {
    if (!supported) return Promise.resolve("unsupported");
    stop();                                  // 남은 발화가 있으면 speak()가 먹지 않는다
    const parts = chunk(text, opts.maxChars);
    if (!parts.length) return Promise.resolve("empty");
    return new Promise((resolve) => {
      queue = parts;
      index = 0;
      settle = resolve;
      startPing();
      emit("start", { chunks: parts.length });
      speakNext(opts);
    });
  }

  function stop() {
    if (!supported) return;
    // resolve를 먼저 끊는다 — cancel()이 부르는 onerror를 실패로 세지 않기 위해서다
    if (settle) finish("stopped");
    try { synth.cancel(); } catch (_) {}
  }
  function pause() { if (supported && settle) { try { synth.pause(); } catch (_) {} } }
  function resume() { if (supported) { try { synth.resume(); } catch (_) {} } }

  const blTTS = {
    get supported() { return supported; },
    get speaking() { return !!settle; },
    get paused() { return !!(supported && synth.paused); },
    ready,
    voices,
    hasVoice: (lang) => !!pickVoice(lang),
    // 지금 고른 목소리가 기기 내장인지. false면 읽는 텍스트가 기기 밖으로 나갈 수
    // 있으므로, 민감한 입력을 다루는 토이는 이 값을 보고 거부할 수 있다.
    isLocal: (lang) => pickVoice(lang)?.localService === true,
    chunk,
    speak, stop, pause, resume, on,
  };
  window.blTTS = blTTS;

  if (!supported) return;

  // 페이지를 떠난 뒤에도 소리가 이어지면 안 된다. 탭을 가릴 때 멈출지는 선택
  // (브리핑처럼 계속 듣고 싶은 경우 stopOnHide: false).
  addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && cfg().stopOnHide !== false) stop();
  });

  // 클릭 시점에 목소리가 준비돼 있도록 미리 받아 둔다. 아직 로딩 중일 때의 빈
  // 목록을 "목소리 없음"으로 오해하면 안 되므로 완료 여부를 따로 들고 있는다.
  let voicesLoaded = false;
  ready.then(() => { voicesLoaded = true; }, () => { voicesLoaded = true; });

  if (cfg().dock === false) return;

  // 눌렀는데 아무 일도 안 일어나면 사용자는 고장으로 받아들인다. 이유를 말해준다.
  // (share.js가 먼저 떴으면 그 토스트를 그대로 쓴다 — 같은 id·같은 모양)
  let toastTimer = 0;
  function toast(msg) {
    let el = document.getElementById("bl-toast");
    if (!el) {
      const style = document.createElement("style");
      style.textContent = `
  #bl-toast { position: fixed; left: 50%; bottom: 4.2rem; z-index: 9999;
    transform: translateX(-50%); font: .85rem ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace;
    padding: .55rem 1rem; border-radius: 2rem; pointer-events: none;
    color: light-dark(#fff, #123); background: light-dark(#333c46, #dce6f0);
    opacity: 0; transition: opacity .25s; }
  #bl-toast.show { opacity: 1; }`;
      document.head.appendChild(style);
      el = document.createElement("div");
      el.id = "bl-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // 우하단 공용 유틸 독에 등록한다. 독이 아직 안 떴어도 큐에 쌓였다가 그려진다.
  // (홈 10 · 공유 20 · 읽어주기 40 · 토이 50~)
  let dockEl = null;
  const paint = () => { if (dockEl) dockEl.textContent = blTTS.speaking ? "⏹" : "🔊"; };
  on("start", paint);
  on("end", paint);

  (window.blDock = window.blDock || []).push({
    id: "bl-tts",
    icon: "🔊",
    label: "읽어주기",
    order: 40,
    ready: (el) => { dockEl = el; },
    onClick: () => {
      if (blTTS.speaking) { stop(); return; }
      const source = window.blSpeakText;
      const text = (typeof source === "function" ? source() : source) || "";
      if (!text) { toast("읽을 내용이 없어요"); return; }
      // 목소리가 하나도 없으면 speak()는 조용히 아무것도 안 한다. 단 로딩이 끝난
      // 뒤에만 판정한다. lang이 안 맞는 경우는 막지 않는다 — utterance.lang 힌트로
      // OS 기본 목소리가 읽어 주기도 한다.
      if (voicesLoaded && !liveVoices().length) {
        toast("이 기기에 읽어줄 목소리가 없어요");
        return;
      }
      // iOS는 사용자 제스처 안에서 speak()가 불려야 한다 — 여기서 await 하지 않는다
      speak(text);
    },
  });
})();
