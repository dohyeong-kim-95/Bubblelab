// 오픽 모의고사 화면 흐름: 시작 → 서베이 → 자가평가 → 마이크 확인 → 15문항 → 결과.
// 질문 음성은 브라우저 내장 음성 합성(speechSynthesis), 녹음은 MediaRecorder — 아무것도 서버로 보내지 않는다.
import {
  SURVEY, LEVELS, REPLAY_WINDOW_MS, TOTAL_SECONDS, buildFirst, buildSecond, surveyProblems,
} from "./questions.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["intro", "survey", "self", "setup", "test", "done"];
const st = {
  view: "intro",
  survey: { job: "", student: "", housing: "", picks: [] },
  level: 0,
  seed: Date.now() >>> 0,
  questions: [], used: [], i: 0,
  answers: [],              // [{ blob, url, secs }]
  stream: null, recorder: null, chunks: [], recStart: 0,
  phase: "idle",            // idle → speaking → window → recording
  replayLeft: 1, windowTimer: 0, deadline: 0, tick: 0,
  voice: null,
};

// ---------- 공통 ----------
function show(view) {
  st.view = view;
  for (const v of VIEWS) $(`v-${v}`).hidden = v !== view;
  document.body.classList.toggle("testing", view === "test");
  const order = ["survey", "self", "setup", "test"];
  const at = order.indexOf(view);
  $("steps").hidden = at < 0;
  for (const li of $("steps").children) {
    const k = order.indexOf(li.dataset.step);
    li.classList.toggle("selected", k === at);
    li.classList.toggle("checked", at >= 0 && k < at);
  }
  $("back").hidden = !["survey", "self", "setup"].includes(view);
  $("nav").hidden = false;
  scrollTo(0, 0);
  render();
}

function render() {
  const next = $("next"), hint = $("hint");
  hint.textContent = "";
  next.disabled = false;
  if (st.view === "intro") next.textContent = "시작하기";
  if (st.view === "survey") {
    const left = surveyProblems(st.survey);
    next.textContent = "다음";
    next.disabled = left.length > 0;
    hint.textContent = left[0] || "";
  }
  if (st.view === "self") { next.textContent = "다음"; next.disabled = !st.level; hint.textContent = st.level ? "" : "단계를 골라 주세요."; }
  if (st.view === "setup") { next.textContent = "시험 시작"; next.disabled = !st.stream; hint.textContent = st.stream ? "" : "마이크를 먼저 켜 주세요."; }
  if (st.view === "test") {
    next.textContent = st.i === st.questions.length - 1 && st.i === 14 ? "종료" : "다음";
    next.disabled = st.phase !== "recording";
    hint.textContent = st.phase === "recording" ? "답을 마치면 다음" : "";
  }
  if (st.view === "done") { next.textContent = "다시 응시"; }
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- 서베이 ----------
function radioGroup(name, part) {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend"); lg.textContent = part.title; fs.append(lg);
  for (const [value, label] of part.options) {
    const l = document.createElement("label"); l.className = "opt";
    const inp = Object.assign(document.createElement("input"), { type: "radio", name, value });
    inp.checked = st.survey[name] === value;
    inp.addEventListener("change", () => { st.survey[name] = value; render(); });
    const sp = document.createElement("span"); sp.textContent = label;
    l.append(inp, sp); fs.append(l);
  }
  return fs;
}

function buildSurvey() {
  const root = $("survey-form"); root.replaceChildren();
  root.append(radioGroup("job", SURVEY.job), radioGroup("student", SURVEY.student), radioGroup("housing", SURVEY.housing));
  const counter = document.createElement("p"); counter.className = "picks"; root.append(counter);
  const updateCount = () => {
    const n = st.survey.picks.length;
    counter.innerHTML = "";
    counter.append("Part 4 — 아래에서 ", Object.assign(document.createElement("span"), { className: "n", textContent: `${n}개` }), ` 선택 (${SURVEY.minPicks}개 이상)`);
    counter.classList.toggle("ok", n >= SURVEY.minPicks);
  };
  for (const g of SURVEY.groups) {
    const fs = document.createElement("fieldset");
    const lg = document.createElement("legend"); lg.textContent = g.title; fs.append(lg);
    for (const [id, label] of g.items) {
      const l = document.createElement("label"); l.className = "opt";
      const inp = Object.assign(document.createElement("input"), { type: "checkbox", value: id });
      inp.checked = st.survey.picks.includes(id);
      inp.addEventListener("change", () => {
        st.survey.picks = inp.checked ? [...st.survey.picks, id] : st.survey.picks.filter(x => x !== id);
        updateCount(); render();
      });
      const sp = document.createElement("span"); sp.textContent = label;
      l.append(inp, sp); fs.append(l);
    }
    root.append(fs);
  }
  updateCount();
}

// ---------- 자가평가 ----------
function buildSelf() {
  const fs = $("self-form");
  fs.querySelectorAll(".opt").forEach(n => n.remove());
  for (const { level, text } of LEVELS) {
    const l = document.createElement("label"); l.className = "opt level";
    const inp = Object.assign(document.createElement("input"), { type: "radio", name: "level", value: String(level) });
    inp.checked = st.level === level;
    inp.addEventListener("change", () => { st.level = level; render(); });
    const box = document.createElement("div"); box.className = "lvl";
    const no = document.createElement("span"); no.className = "no"; no.textContent = level;
    const tx = document.createElement("span"); tx.textContent = text;
    box.append(no, tx); l.append(inp, box); fs.append(l);
  }
}

// ---------- 마이크·음성 ----------
function pickVoice() {
  const all = speechSynthesis.getVoices();
  const en = all.filter(v => /^en[-_]US/i.test(v.lang));
  st.voice = en.find(v => /female|samantha|google us|jenny|aria/i.test(v.name)) || en[0]
    || all.find(v => /^en/i.test(v.lang)) || null;
  $("voice-name").textContent = st.voice ? `목소리: ${st.voice.name}` : "영어 음성이 없으면 기기 기본 음성으로 읽어요.";
}

function speak(text, { onEnd, onProgress } = {}) {
  if (!("speechSynthesis" in window)) { onEnd?.(); return false; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.95;
  if (st.voice) u.voice = st.voice;
  const words = text.split(/\s+/).length;
  const est = Math.max(2, words / 2.4) * 1000;   // 말하는 길이 추정(진행 막대용)
  const t0 = performance.now();
  let raf = 0, ended = false, guard = 0;
  const step = () => { onProgress?.(Math.min(1, (performance.now() - t0) / est)); raf = requestAnimationFrame(step); };
  const end = () => {
    if (ended) return; ended = true;
    clearTimeout(guard); cancelAnimationFrame(raf); onProgress?.(1); onEnd?.();
  };
  u.onstart = () => { raf = requestAnimationFrame(step); };
  u.onend = u.onerror = end;
  // 일부 브라우저(긴 문장의 Chrome, 백그라운드 탭의 iOS)는 onend 를 안 보낸다 — 시험이 멈추지 않게 넉넉한 시간 뒤 끝낸다
  guard = setTimeout(end, est * 2 + 4000);
  try { speechSynthesis.speak(u); } catch { clearTimeout(guard); return false; }
  return true;
}

async function micOn() {
  $("setup-err").hidden = true;
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    $("setup-err").textContent = "마이크를 쓸 수 없어요. 브라우저 설정에서 이 사이트의 마이크를 허용해 주세요.";
    $("setup-err").hidden = false; return;
  }
  $("mic-on").textContent = "🎤 마이크 켜짐"; $("mic-on").disabled = true; $("rec-test").disabled = false;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser(); an.fftSize = 512;
  ctx.createMediaStreamSource(st.stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  const loop = () => {
    an.getByteTimeDomainData(buf);
    let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    $("gauge").style.width = `${Math.min(100, peak / 64 * 100)}%`;
    requestAnimationFrame(loop);
  };
  loop();
  render();
}

function mimeType() {
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}

function startRecorder(onStop) {
  const type = mimeType();
  const rec = new MediaRecorder(st.stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => onStop(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }));
  rec.start(1000);
  return rec;
}

function recTest() {
  const b = $("rec-test"); b.disabled = true; b.textContent = "● 녹음 중… 5";
  let n = 5;
  const iv = setInterval(() => { n--; b.textContent = `● 녹음 중… ${n}`; }, 1000);
  const rec = startRecorder((blob) => {
    clearInterval(iv);
    const a = $("rec-test-audio"); a.src = URL.createObjectURL(blob); a.hidden = false;
    b.disabled = false; b.textContent = "● 다시 녹음해 보기";
  });
  setTimeout(() => rec.state !== "inactive" && rec.stop(), 5000);
}

// ---------- 시험 ----------
function startTest() {
  const first = buildFirst({ survey: st.survey, level: st.level, seed: st.seed });
  st.questions = first.questions; st.used = first.used; st.i = 0; st.answers = [];
  st.deadline = Date.now() + TOTAL_SECONDS * 1000;
  $("clock").hidden = false;
  clearInterval(st.tick);
  st.tick = setInterval(clockTick, 500); clockTick();
  show("test");
  loadQuestion();
}

function clockTick() {
  const left = Math.max(0, (st.deadline - Date.now()) / 1000);
  $("clock").textContent = fmt(left);
  $("clock").classList.toggle("low", left < 300);
  if (st.phase === "recording") $("rec-time").textContent = fmt((Date.now() - st.recStart) / 1000);
  if (left <= 0 && st.view === "test") finish(true);
}

function prompts() {
  const ol = $("prompts"); ol.replaceChildren();
  for (let k = 0; k < 15; k++) {
    const li = document.createElement("li"); li.textContent = k + 1;
    if (k < st.i) li.className = "visited";
    if (k === st.i) li.className = "active";
    ol.append(li);
  }
}

function setBanner(kind) {
  const b = $("rec-banner");
  b.classList.toggle("alert-wait", kind !== "rec");
  $("rec-label").textContent = { wait: "대기 중", speak: "질문 듣는 중", window: "다시 듣기 가능 (5초)", rec: "녹음 중" }[kind];
  if (kind !== "rec") $("rec-time").textContent = "";
}

function loadQuestion() {
  st.phase = "idle"; st.replayLeft = 1;
  $("qno").firstChild.textContent = `Question ${st.i + 1} `;
  $("play").hidden = false; $("replay").disabled = true;
  $("track").style.width = "0%"; $("pb-label").textContent = "▶ 를 눌러 질문을 들으세요";
  setBanner("wait"); prompts(); render();
}

function playQuestion(again = false) {
  const q = st.questions[st.i];
  clearTimeout(st.windowTimer);
  st.phase = "speaking"; $("play").hidden = true; $("replay").disabled = true;
  $("avatar").classList.add("talking"); setBanner("speak");
  $("pb-label").textContent = again ? "다시 듣는 중" : "질문 재생 중"; render();
  const done = () => {
    $("avatar").classList.remove("talking");
    if (st.replayLeft > 0) openReplayWindow(); else beginRecording();
  };
  if (!speak(q.text, { onEnd: done, onProgress: (p) => { $("track").style.width = `${p * 100}%`; } })) {
    $("pb-label").textContent = q.text; done();      // 음성 합성이 없는 브라우저 — 글자로라도
  }
}

function openReplayWindow() {
  st.phase = "window"; $("replay").disabled = false; setBanner("window");
  $("pb-label").textContent = "5초 안에 ↻ 로 한 번 더 들을 수 있어요"; render();
  st.windowTimer = setTimeout(() => { if (st.phase === "window") beginRecording(); }, REPLAY_WINDOW_MS);
}

function beginRecording() {
  clearTimeout(st.windowTimer);
  st.phase = "recording"; $("replay").disabled = true;
  $("pb-label").textContent = "답변을 말하세요";
  st.recStart = Date.now();
  const idx = st.i;
  st.recorder = startRecorder((blob) => {
    st.answers[idx] = { blob, url: URL.createObjectURL(blob), secs: st.answers[idx]?.secs ?? 0 };
  });
  setBanner("rec"); clockTick(); render();
}

function stopRecording() {
  const secs = (Date.now() - st.recStart) / 1000;
  st.answers[st.i] = { ...(st.answers[st.i] || {}), secs };
  if (st.recorder && st.recorder.state !== "inactive") st.recorder.stop();
}

function nextQuestion() {
  stopRecording();
  st.phase = "idle";
  if (st.i === 6) { $("adjust").hidden = false; $("adjust-ok").focus(); return; }
  if (st.i >= st.questions.length - 1) { finish(false); return; }
  st.i++; loadQuestion();
}

function afterAdjust() {
  const adjust = Number(document.querySelector("input[name=adj]:checked")?.value || 0);
  const second = buildSecond({ survey: st.survey, level: st.level, adjust, used: st.used, seed: st.seed });
  st.questions = [...st.questions.slice(0, 7), ...second.questions];
  $("adjust").hidden = true;
  st.i++; loadQuestion();
}

function finish(timeout) {
  if (st.phase === "recording") stopRecording();
  speechSynthesis?.cancel?.();
  clearInterval(st.tick); clearTimeout(st.windowTimer);
  st.phase = "idle"; $("clock").hidden = true;
  // 마지막 녹음 blob 은 onstop 이 비동기로 채운다 — 한 박자 뒤에 그린다
  setTimeout(() => { buildResult(timeout); show("done"); }, 400);
}

const CHECKS = [
  "자기소개를 30초 안에 끝내고 다음 질문으로 넘어갈 준비가 됐다",
  "묘사 문항에서 큰 그림 → 세부 → 느낌 순서로 문단을 만들었다",
  "과거 경험 문항에서 과거 시제를 끝까지 유지했다",
  "롤플레이 질문하기에서 질문을 3–4개 했다",
  "문제 해결 롤플레이에서 상황 설명과 대안 2–3개를 말했다",
  "비교 문항에서 과거와 현재를 둘 다 구체적으로 말했다",
  "답변마다 1분 30초 – 2분 정도를 채웠다",
  "같은 표현(like, really, very)을 반복하지 않고 연결어(however, so, on top of that)를 썼다",
  "막힐 때 침묵하지 않고 필러(Let me think…)로 이어 갔다",
];

function buildResult(timeout) {
  const ul = $("answers"); ul.replaceChildren();
  const done = st.answers.filter(Boolean);
  const total = done.reduce((s, a) => s + (a.secs || 0), 0);
  $("done-sum").textContent = `${done.length}문항 답변 · 말한 시간 합계 ${fmt(total)}${timeout ? " · 40분이 다 돼서 끝났어요" : ""}`;
  st.questions.forEach((q, k) => {
    const a = st.answers[k];
    const li = document.createElement("li");
    const meta = document.createElement("div"); meta.className = "meta";
    const b = document.createElement("b"); b.textContent = `Q${q.no}`;
    const kind = document.createElement("span"); kind.textContent = `${q.topic} · ${q.kind}`;
    const len = document.createElement("span"); len.className = "len";
    len.textContent = a ? fmt(a.secs) : "—";
    if (a && q.no > 1 && a.secs < 60) len.classList.add("short");
    meta.append(b, kind, len);
    const det = document.createElement("details");
    const sm = document.createElement("summary"); sm.textContent = "질문 보기";
    const tx = document.createElement("p"); tx.className = "text"; tx.lang = "en"; tx.textContent = q.text;
    det.append(sm, tx);
    li.append(meta, det);
    if (a?.url) {
      const au = document.createElement("audio"); au.controls = true; au.preload = "metadata"; au.src = a.url;
      const ext = (a.blob?.type || "").includes("mp4") ? "m4a" : "webm";
      const dl = Object.assign(document.createElement("a"), { className: "dl", href: a.url, download: `opic-q${q.no}.${ext}`, textContent: "저장" });
      li.append(au, dl);
    } else {
      const p = document.createElement("p"); p.className = "none"; p.textContent = "녹음 없음"; li.append(p);
    }
    ul.append(li);
  });
  const ck = $("checklist"); ck.replaceChildren();
  for (const c of CHECKS) {
    const li = document.createElement("li"); const l = document.createElement("label");
    const inp = Object.assign(document.createElement("input"), { type: "checkbox" });
    const sp = document.createElement("span"); sp.textContent = c;
    l.append(inp, sp); li.append(l); ck.append(li);
  }
  window.blShareText = () => `오픽 모의고사 ${done.length}문항, 말한 시간 ${fmt(total)}! 같이 연습해요`;
}

// ---------- 이벤트 ----------
$("next").addEventListener("click", () => {
  if (st.view === "intro") {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      $("intro-err").textContent = "이 브라우저는 녹음을 지원하지 않아요. 최신 Chrome·Safari 로 열어 주세요.";
      $("intro-err").hidden = false; return;
    }
    buildSurvey(); show("survey");
  } else if (st.view === "survey") { buildSelf(); show("self"); }
  else if (st.view === "self") show("setup");
  else if (st.view === "setup") startTest();
  else if (st.view === "test") nextQuestion();
  else if (st.view === "done") { st.seed = Date.now() >>> 0; show("survey"); buildSurvey(); }
});
$("back").addEventListener("click", () => {
  const prev = { survey: "intro", self: "survey", setup: "self" }[st.view];
  if (prev === "survey") buildSurvey();
  if (prev) show(prev);
});
$("mic-on").addEventListener("click", micOn);
$("rec-test").addEventListener("click", recTest);
$("tts-test").addEventListener("click", () => speak("Hello. I'm going to ask you some questions. Please answer as naturally as you can."));
$("play").addEventListener("click", () => playQuestion(false));
$("replay").addEventListener("click", () => { if (st.phase === "window" && st.replayLeft > 0) { st.replayLeft--; playQuestion(true); } });
$("adjust-ok").addEventListener("click", afterAdjust);
addEventListener("beforeunload", (e) => { if (st.view === "test" || (st.view === "done" && st.answers.length)) e.preventDefault(); });

if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.addEventListener?.("voiceschanged", pickVoice); }
show("intro");
// 로그인한 아이디(게이트가 /_me 로 알려 준다) — 실패해도 화면은 그대로 쓴다
fetch("_me", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => { if (d?.id) $("me").textContent = d.id; }).catch(() => {});
