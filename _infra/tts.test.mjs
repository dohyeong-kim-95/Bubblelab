import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(join(ROOT, "_shared/tts.js"), "utf8");

// _shared는 브라우저용 IIFE라 import 할 수 없다. 대신 가짜 speechSynthesis를 넣은
// vm 컨텍스트에서 실제로 실행해 동작을 확인한다 (의존성 없이 node --test로 돈다).
function makeSpeech({ voices = [], autoEnd = true } = {}) {
  const spoken = [];       // 실제로 발화된 utterance
  const calls = [];        // speak/cancel/pause/resume 호출 순서
  let queue = [];

  class FakeUtterance {
    constructor(text) { this.text = text; }
  }

  const synth = {
    paused: false,
    getVoices: () => voices,
    addEventListener() {},
    removeEventListener() {},
    speak(u) {
      calls.push("speak");
      spoken.push(u);
      queue.push(u);
      // 실제 브라우저는 비동기로 끝난다. autoEnd면 마이크로태스크에서 끝내 준다.
      if (autoEnd) queueMicrotask(() => { if (queue.includes(u)) { queue = queue.filter((q) => q !== u); u.onend?.(); } });
    },
    cancel() {
      calls.push("cancel");
      const dropped = queue;
      queue = [];
      for (const u of dropped) u.onerror?.({ error: "interrupted" });
    },
    pause() { calls.push("pause"); synth.paused = true; },
    resume() { calls.push("resume"); synth.paused = false; },
  };

  return { synth, FakeUtterance, spoken, calls, endNext: () => { const u = queue.shift(); u?.onend?.(); } };
}

function load({ speech = makeSpeech(), config } = {}) {
  const listeners = {};
  const win = {
    speechSynthesis: speech?.synth,
    SpeechSynthesisUtterance: speech?.FakeUtterance,
    blTTSConfig: config,
    addEventListener(type, cb) { (listeners[type] ||= []).push(cb); },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    queueMicrotask,
  };
  win.window = win;
  // 토스트가 만드는 DOM만 흉내 낸다 — 붙은 노드를 id로 되찾을 수 있어야 한다
  const nodes = {};
  win.document = {
    hidden: false,
    addEventListener(type, cb) { (listeners[type] ||= []).push(cb); },
    createElement: (tag) => ({
      tagName: tag, id: "", textContent: "",
      classList: { has: new Set(), add(c) { this.has.add(c); }, remove(c) { this.has.delete(c); } },
    }),
    getElementById: (id) => nodes[id] || null,
    head: { appendChild(el) { nodes[el.id] = el; } },
    body: { appendChild(el) { nodes[el.id] = el; } },
  };
  win.nodes = nodes;
  vm.createContext(win);
  vm.runInContext(SOURCE, win);
  return { win, speech, fire: (type, ...args) => (listeners[type] || []).forEach((cb) => cb(...args)) };
}

const voice = (lang, name, localService = true) => ({ lang, name, localService });
const KOREAN = [voice("en-US", "Alex"), voice("ko-KR", "Yuna")];

test("speechSynthesis가 없으면 지원하지 않는다고 알리고 독에 붙지 않는다", () => {
  const { win } = load({ speech: { synth: undefined, FakeUtterance: undefined } });
  assert.equal(win.blTTS.supported, false);
  assert.equal(win.blDock, undefined, "지원하지 않는데 독 버튼을 등록했다");
  // 호출해도 던지지 않아야 한다 — 토이가 감싸지 않고 부를 수 있어야 한다
  assert.doesNotThrow(() => win.blTTS.stop());
});

test("긴 텍스트를 문장 단위로 쪼갠다 (크롬 15초 절단 회피)", () => {
  const { win } = load();
  const long = "가나다라마바사아자차카타파하 ".repeat(30);   // 한 문장 450자
  const parts = win.blTTS.chunk(long);
  assert.ok(parts.length > 1, "긴 문장이 한 조각으로 남았다");
  for (const p of parts) assert.ok(p.length <= 160, `조각이 한도를 넘었다: ${p.length}자`);

  // vm 컨텍스트가 돌려준 배열은 다른 realm의 Array다 — 펼쳐서 호스트 배열로 비교한다
  assert.deepEqual([...win.blTTS.chunk("오늘은 맑습니다. 기온은 28도입니다! 우산은 필요할까요?")],
    ["오늘은 맑습니다. 기온은 28도입니다! 우산은 필요할까요?"], "짧으면 한 조각으로 묶어야 한다");

  assert.deepEqual([...win.blTTS.chunk("   \n  \n ")], [], "빈 텍스트는 빈 배열");
});

test("줄이 바뀌면 앞 조각에 붙이지 않는다", () => {
  const { win } = load();
  assert.deepEqual([...win.blTTS.chunk("날씨\n뉴스")], ["날씨", "뉴스"]);
});

test("조각을 순서대로 하나씩 발화한다", async () => {
  const speech = makeSpeech({ voices: KOREAN });
  const { win } = load({ speech });
  const result = await win.blTTS.speak("첫째 문장입니다.\n둘째 문장입니다.\n셋째 문장입니다.");
  assert.equal(result, "end");
  assert.deepEqual(speech.spoken.map((u) => u.text),
    ["첫째 문장입니다.", "둘째 문장입니다.", "셋째 문장입니다."]);
});

test("speak() 전에 항상 cancel() 한다 (남은 발화가 있으면 speak가 먹지 않는다)", async () => {
  const speech = makeSpeech({ voices: KOREAN });
  const { win } = load({ speech });
  await win.blTTS.speak("한 문장.");
  assert.equal(speech.calls[0], "cancel", `첫 호출이 ${speech.calls[0]}였다`);
  assert.equal(speech.calls[1], "speak");
});

test("ko-KR 목소리를 고르고, 같은 조건이면 기기 내장을 우선한다", () => {
  const network = voice("ko-KR", "Google 한국의", false);
  const local = voice("ko-KR", "Yuna", true);
  const { win } = load({ speech: makeSpeech({ voices: [network, local] }) });
  assert.equal(win.blTTS.hasVoice("ko-KR"), true);
  assert.equal(win.blTTS.isLocal("ko-KR"), true, "네트워크 목소리를 골랐다");

  // 정확히 일치하는 코드가 없으면 접두(ko)로 떨어진다
  const { win: win2 } = load({ speech: makeSpeech({ voices: [voice("ko", "generic")] }) });
  assert.equal(win2.blTTS.hasVoice("ko-KR"), true);
});

test("한국어 목소리가 없으면 조용히 실패하지 않고 알려준다", async () => {
  const speech = makeSpeech({ voices: [voice("en-US", "Alex")] });
  const { win } = load({ speech });
  assert.equal(win.blTTS.hasVoice("ko-KR"), false, "없는 목소리를 있다고 했다");
  assert.equal(win.blTTS.isLocal("ko-KR"), false);
  // 목소리가 없어도 OS 기본값에 힌트는 주고 시도한다
  await win.blTTS.speak("읽어봅니다.");
  assert.equal(speech.spoken[0].lang, "ko-KR");
});

test("네트워크 목소리만 있으면 isLocal이 false다 (민감한 텍스트 거부용)", () => {
  const { win } = load({ speech: makeSpeech({ voices: [voice("ko-KR", "Google 한국의", false)] }) });
  assert.equal(win.blTTS.hasVoice("ko-KR"), true);
  assert.equal(win.blTTS.isLocal("ko-KR"), false);
});

test("stop()이 큐를 끊고 stopped로 끝낸다", async () => {
  const speech = makeSpeech({ voices: KOREAN, autoEnd: false });
  const { win } = load({ speech });
  const pending = win.blTTS.speak("첫째.\n둘째.\n셋째.");
  assert.equal(win.blTTS.speaking, true);
  win.blTTS.stop();
  assert.equal(await pending, "stopped");
  assert.equal(win.blTTS.speaking, false);
  assert.equal(speech.spoken.length, 1, "멈춘 뒤에도 다음 조각을 읽었다");
  assert.ok(speech.calls.includes("cancel"));
});

test("설정(rate·pitch·lang)이 발화에 반영되고 범위를 벗어나면 잘린다", async () => {
  const speech = makeSpeech({ voices: KOREAN });
  const { win } = load({ speech, config: { rate: 1.4, pitch: 0.8 } });
  await win.blTTS.speak("한 문장.");
  assert.equal(speech.spoken[0].rate, 1.4);
  assert.equal(speech.spoken[0].pitch, 0.8);
  assert.equal(speech.spoken[0].voice.name, "Yuna");

  const speech2 = makeSpeech({ voices: KOREAN });
  const { win: win2 } = load({ speech: speech2 });
  await win2.blTTS.speak("한 문장.", { rate: 99, pitch: -5 });
  assert.equal(speech2.spoken[0].rate, 10, "rate 상한을 넘겼다");
  assert.equal(speech2.spoken[0].pitch, 0, "pitch 하한을 넘겼다");
});

test("빈 텍스트는 발화하지 않는다", async () => {
  const speech = makeSpeech({ voices: KOREAN });
  const { win } = load({ speech });
  assert.equal(await win.blTTS.speak("   "), "empty");
  assert.equal(speech.spoken.length, 0);
});

test("페이지를 떠나거나 탭을 가리면 멈춘다", async () => {
  const speech = makeSpeech({ voices: KOREAN, autoEnd: false });
  const { win, fire } = load({ speech });
  const pending = win.blTTS.speak("첫째.\n둘째.");
  fire("pagehide");
  assert.equal(await pending, "stopped");

  const speech2 = makeSpeech({ voices: KOREAN, autoEnd: false });
  const { win: win2, fire: fire2 } = load({ speech: speech2 });
  const pending2 = win2.blTTS.speak("첫째.\n둘째.");
  win2.document.hidden = true;
  fire2("visibilitychange");
  assert.equal(await pending2, "stopped");
});

test("stopOnHide: false면 탭을 가려도 계속 읽는다 (브리핑용)", async () => {
  const speech = makeSpeech({ voices: KOREAN, autoEnd: false });
  const { win, fire } = load({ speech, config: { stopOnHide: false } });
  win.blTTS.speak("첫째.\n둘째.");
  win.document.hidden = true;
  fire("visibilitychange");
  assert.equal(win.blTTS.speaking, true, "브리핑이 탭 전환에서 끊겼다");
  win.blTTS.stop();
});

test("독에 읽어주기 버튼을 등록하고, dock:false면 안 한다", () => {
  const { win } = load({ speech: makeSpeech({ voices: KOREAN }) });
  const entry = win.blDock.find((d) => d.id === "bl-tts");
  assert.ok(entry, "독에 등록되지 않았다");
  assert.equal(entry.order, 40, "홈 10 · 공유 20 · 읽어주기 40 · 토이 50~");
  assert.ok(entry.label, "아이콘만 있고 스크린리더용 이름이 없다");

  const { win: quiet } = load({ speech: makeSpeech({ voices: KOREAN }), config: { dock: false } });
  assert.equal(quiet.blDock, undefined);
});

test("독 버튼이 blSpeakText를 읽고, 다시 누르면 멈춘다", async () => {
  const speech = makeSpeech({ voices: KOREAN, autoEnd: false });
  const { win } = load({ speech });
  const entry = win.blDock.find((d) => d.id === "bl-tts");
  const el = { textContent: "🔊" };
  entry.ready(el);

  entry.onClick();                                   // 문구가 없으면 읽지 않는다
  assert.equal(speech.spoken.length, 0);

  win.blSpeakText = () => "오늘의 브리핑입니다.";
  entry.onClick();
  assert.equal(speech.spoken[0].text, "오늘의 브리핑입니다.");
  assert.equal(el.textContent, "⏹", "재생 중인데 아이콘이 안 바뀌었다");

  entry.onClick();                                   // 두 번째 클릭 = 멈춤
  assert.equal(win.blTTS.speaking, false);
  assert.equal(el.textContent, "🔊");
});

// 눌렀는데 아무 반응이 없으면 사용자는 고장으로 받아들인다 (조용히 실패 금지)
test("읽을 게 없거나 목소리가 없으면 이유를 알려준다", async () => {
  const withVoice = load({ speech: makeSpeech({ voices: KOREAN, autoEnd: false }) });
  withVoice.win.blDock.find((d) => d.id === "bl-tts").onClick();   // blSpeakText 없음
  assert.match(withVoice.win.nodes["bl-toast"]?.textContent ?? "", /읽을 내용/);

  // 목소리가 하나도 없는 기기(일부 데스크톱 리눅스)에서는 speak()가 조용히 무시된다
  const noVoice = load({ speech: makeSpeech({ voices: [], autoEnd: false }) });
  noVoice.win.blSpeakText = "오늘의 브리핑입니다.";
  await noVoice.win.blTTS.ready;                     // 목록 로딩이 끝난 뒤에만 판정한다
  noVoice.win.blDock.find((d) => d.id === "bl-tts").onClick();
  assert.equal(noVoice.speech.spoken.length, 0);
  assert.match(noVoice.win.nodes["bl-toast"]?.textContent ?? "", /목소리가 없어요/);
});

test("목소리 목록을 아직 못 받았으면 없다고 단정하지 않는다", () => {
  // getVoices()는 첫 호출에 빈 배열인 브라우저가 많다. 로딩 중 클릭을 "목소리 없음"
  // 으로 처리하면 멀쩡한 기기에서 읽기를 거부하게 된다.
  const speech = makeSpeech({ voices: [], autoEnd: false });
  const { win } = load({ speech });
  win.blSpeakText = "오늘의 브리핑입니다.";
  win.blDock.find((d) => d.id === "bl-tts").onClick();   // ready 결과가 오기 전
  assert.equal(speech.spoken.length, 1, "로딩 중인데 읽기를 거부했다");
});

test("쓸 수 없는 목소리를 넘겨도 재생 상태가 굳지 않는다", async () => {
  // 브라우저는 SpeechSynthesisVoice가 아닌 값을 voice에 넣으면 던진다. 예외가 새면
  // settle이 남아 speaking이 영영 true가 되고 독 아이콘이 ⏹에서 안 돌아온다.
  const speech = makeSpeech({ voices: KOREAN });
  Object.defineProperty(speech.FakeUtterance.prototype, "voice", {
    set() { throw new TypeError("Failed to convert value to 'SpeechSynthesisVoice'"); },
    get() { return null; },
  });
  const { win } = load({ speech });
  assert.equal(await win.blTTS.speak("한 문장입니다.", { voice: { lang: "ko-KR" } }), "end");
  assert.equal(win.blTTS.speaking, false, "재생 상태가 굳었다");
  assert.equal(speech.spoken.length, 1, "기본 목소리로도 읽지 못했다");
});

test("토스트는 share.js가 이미 만든 것을 재사용한다 (id 충돌 금지)", () => {
  const { win } = load({ speech: makeSpeech({ voices: KOREAN, autoEnd: false }) });
  const existing = { id: "bl-toast", textContent: "", classList: { add() {}, remove() {} } };
  win.nodes["bl-toast"] = existing;                  // share.js가 먼저 뜬 상황
  win.blDock.find((d) => d.id === "bl-tts").onClick();
  assert.match(existing.textContent, /읽을 내용/, "기존 토스트를 두고 새로 만들었다");
});

// 공용 UI 규칙 — home-button.test.mjs와 같은 소스 계약 검사
test("유틸 버튼은 스스로 자리를 잡지 않고 독에 등록한다", () => {
  assert.match(SOURCE, /window\.blDock\s*=\s*window\.blDock\s*\|\|\s*\[\]/,
    "로드 순서에 안전한 큐 방식으로 등록하지 않는다");
  assert.doesNotMatch(SOURCE, /#bl-tts\s*\{[^}]*position:\s*fixed/,
    "스스로 고정 배치한다 — 다른 공용 버튼을 덮는다");
});

test("iOS 제스처 제약 때문에 클릭 핸들러에서 await 하지 않는다", () => {
  const code = SOURCE.slice(SOURCE.indexOf("onClick: () =>"))
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");   // 주석 제외
  assert.doesNotMatch(code.slice(0, 400), /\bawait\b/,
    "클릭 안에서 await 하면 iOS가 사용자 제스처로 안 쳐서 소리가 안 난다");
});
