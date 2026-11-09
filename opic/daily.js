// 오늘의 문항 — 게이트 뒤 `_daily`(목록)·`_daily/날짜`(하나)를 읽어 보여 준다. 음성은 기기 내장 speechSynthesis.
const $ = (id) => document.getElementById(id);
const st = { dates: [], voice: null, item: null };

function pickVoice() {
  const all = speechSynthesis.getVoices();
  const en = all.filter((v) => /^en[-_]US/i.test(v.lang));
  st.voice = en.find((v) => /female|samantha|google us|jenny|aria/i.test(v.name)) || en[0] || all.find((v) => /^en/i.test(v.lang)) || null;
}

function speak(text, button) {
  if (!("speechSynthesis" in window)) { $("tts-note").hidden = false; return; }
  const playing = button?.dataset.playing === "1";
  speechSynthesis.cancel();
  document.querySelectorAll("[data-playing='1']").forEach((b) => { b.dataset.playing = "0"; b.textContent = b.dataset.label; });
  if (playing) return;   // 같은 버튼을 다시 누르면 멈춤
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = Number($("rate").value) || 0.95;
  if (st.voice) u.voice = st.voice;
  if (button) {
    button.dataset.label ??= button.textContent;
    button.dataset.playing = "1"; button.textContent = "■ 멈춤";
    u.onend = u.onerror = () => { button.dataset.playing = "0"; button.textContent = button.dataset.label; };
  }
  speechSynthesis.speak(u);
}

const fmt = (d) => {
  const [y, m, day] = d.split("-").map(Number);
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${m}월 ${day}일 (${w})`;
};

async function show(date) {
  const res = await fetch(`_daily/${date}`, { cache: "no-store" });
  if (!res.ok) return;
  const { item } = await res.json();
  st.item = item;
  $("level").textContent = `${item.level} 목표`;
  $("kind").textContent = item.kind;
  $("topic").textContent = item.topic;
  $("question").textContent = item.question;
  $("answer").textContent = item.answer;
  $("ko").textContent = item.ko;
  $("structure").replaceChildren(...item.structure.map((s) => Object.assign(document.createElement("li"), { textContent: s })));
  $("expr").replaceChildren(...item.expressions.map((e) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "▶"; b.setAttribute("aria-label", `${e.en} 듣기`);
    b.addEventListener("click", () => speak(e.en, b));
    li.append(b, Object.assign(document.createElement("b"), { textContent: e.en }),
      Object.assign(document.createElement("span"), { textContent: e.ko }),
      Object.assign(document.createElement("small"), { textContent: e.note }));
    return li;
  }));
  $("swap").textContent = item.swap; $("swap-box").hidden = !item.swap;
  $("pitfall").textContent = item.pitfall; $("pit-box").hidden = !item.pitfall;
  $("card").hidden = false;
  $("pick").value = date;
  const i = st.dates.indexOf(date);
  $("prev").disabled = i >= st.dates.length - 1;
  $("next").disabled = i <= 0;
  history.replaceState(null, "", `?d=${date}`);
  speechSynthesis?.cancel?.();
}

async function init() {
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.addEventListener?.("voiceschanged", pickVoice); }
  const res = await fetch("_daily", { cache: "no-store" });
  const items = res.ok ? (await res.json()).items : [];
  st.dates = items.map((x) => x.date);   // 최신이 앞
  if (!items.length) { $("empty").hidden = false; $("prev").disabled = $("next").disabled = true; return; }
  $("pick").replaceChildren(...items.map((x) => Object.assign(document.createElement("option"), { value: x.date, textContent: `${fmt(x.date)} · ${x.kind} · ${x.topic}` })));
  const want = new URLSearchParams(location.search).get("d");
  show(st.dates.includes(want) ? want : st.dates[0]);
}

$("pick").addEventListener("change", (e) => show(e.target.value));
$("prev").addEventListener("click", () => { const i = st.dates.indexOf($("pick").value); if (st.dates[i + 1]) show(st.dates[i + 1]); });
$("next").addEventListener("click", () => { const i = st.dates.indexOf($("pick").value); if (i > 0) show(st.dates[i - 1]); });
$("play-q").addEventListener("click", (e) => st.item && speak(st.item.question, e.currentTarget));
$("play-a").addEventListener("click", (e) => st.item && speak(st.item.answer, e.currentTarget));
$("toggle-ko").addEventListener("click", (e) => {
  const open = $("ko").hidden;
  $("ko").hidden = !open;
  e.currentTarget.textContent = open ? "해석 숨기기" : "해석 보기";
  e.currentTarget.setAttribute("aria-expanded", String(open));
});
init();
