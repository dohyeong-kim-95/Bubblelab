// 스페인어 한 줄을 "부를 수 있는 소리"로 바꾼다. 화면과 _infra/espanol.test.mjs 가
// 같이 쓰는 순수 함수만 둔다 — 저장도 DOM 도 여기서 만지지 않는다.
//
// 목표가 "가사를 안 보고 따라 부르기"라 표기가 아니라 **노래로 나오는 소리**를
// 만든다. 두 가지가 사전식 표기와 다르다.
//
//   ① 연음(enlace) — el amor 는 "엘 아모르"가 아니라 e-la-mor 로 나온다. 줄
//      전체를 한 흐름으로 놓고 음절을 다시 나눈다.
//   ② 모음 충돌(sinalefa) — de amor 는 노래에서 dea-mor 두 박이다. 단어 사이에서
//      모음이 만나면 한 음절로 합친다. 박자 수가 맞아야 따라 부를 수 있다.
//
// 그래서 한 음절 = 한 박이다. 화면은 음절 단위로 띄워 보여 주고, 강세 음절만
// 밝게 준다(스페인어 노래는 강세 자리에 박이 떨어진다).

const ACCENTED = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u" };
const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const WEAK = new Set(["i", "u"]);
// 갈라지지 않는 자음 덩어리. 이것만 다음 음절이 통째로 데려간다(pa-dre, ha-blar).
const TIGHT = new Set([
  "pr", "br", "tr", "dr", "kr", "gr", "fr", "pl", "bl", "kl", "gl", "fl",
]);

/** 낱말만 뽑는다. 문장부호(¿ ¡ … )는 소리에 영향을 주지 않는다. */
export function splitWords(line) {
  return String(line ?? "").toLowerCase().match(/[a-záéíóúüñ']+/g) ?? [];
}

/* ── 글자 → 소리 ──────────────────────────────────────────────────────────
 * 스페인어는 적힌 대로 읽어서 규칙이 짧다. 다만 c·g·qu·ll·y 처럼 다음 글자를
 * 봐야 정해지는 것들이 있어 한 글자씩 앞을 보며 훑는다. */
function phonemes(word) {
  const letters = [...word.replace(/'/g, "")];
  const out = [];
  const soft = (index) => "eiéí".includes(letters[index] ?? "");
  const vowel = (letter, accent) => ({ t: "V", s: ACCENTED[letter] ?? letter, accent });

  for (let i = 0; i < letters.length; i += 1) {
    const letter = letters[i];
    const next = letters[i + 1];
    if (letter in ACCENTED || VOWELS.has(letter)) {
      // ü 는 gü 에서 이미 반모음으로 먹었다 (아래 g 처리).
      out.push(vowel(letter, letter in ACCENTED && letter !== "ü"));
      continue;
    }
    switch (letter) {
      case "c":
        if (next === "h") { out.push({ t: "C", s: "ch" }); i += 1; }
        else out.push({ t: "C", s: soft(i + 1) ? "s" : "k" });
        break;
      case "q":
        // qu + e/i 는 언제나 /k/ 다. u 는 소리가 없다.
        if (next === "u") { out.push({ t: "C", s: "k" }); i += 1; }
        else out.push({ t: "C", s: "k" });
        break;
      case "g":
        if (next === "u" && soft(i + 2)) { out.push({ t: "C", s: "g" }); i += 1; }
        else if (next === "ü") { out.push({ t: "C", s: "g" }, { t: "V", s: "u", accent: false }); i += 1; }
        else out.push({ t: "C", s: soft(i + 1) ? "h" : "g" });
        break;
      case "h": break;                                   // 언제나 묵음
      case "j": out.push({ t: "C", s: "h" }); break;
      case "l":
        if (next === "l") { out.push({ t: "C", s: "y" }); i += 1; }
        else out.push({ t: "C", s: "l" });
        break;
      case "r":
        // 첫소리 r 과 rr 은 굴리는 소리다. 한글로는 둘 다 ㄹ 이지만 구분해 둔다.
        if (next === "r") { out.push({ t: "C", s: "rr" }); i += 1; }
        else out.push({ t: "C", s: out.length === 0 ? "rr" : "r" });
        break;
      case "ñ": out.push({ t: "C", s: "ny" }); break;
      case "v": out.push({ t: "C", s: "b" }); break;
      case "z": out.push({ t: "C", s: "s" }); break;
      case "x": out.push({ t: "C", s: "k" }, { t: "C", s: "s" }); break;
      case "w": out.push({ t: "C", s: "w" }); break;
      case "y":
        // 뒤에 모음이 있으면 반자음(yo·ya), 없으면 그냥 이(y·muy·hoy).
        if (next && (VOWELS.has(next) || next in ACCENTED)) out.push({ t: "C", s: "y" });
        else out.push({ t: "V", s: "i", accent: false });
        break;
      default:
        if (/[bdfkmnpst]/.test(letter)) out.push({ t: "C", s: letter });
        break;                                            // 모르는 글자는 버린다
    }
  }
  return out;
}

/* 모음들을 핵(음절 하나가 될 덩어리)으로 묶는다. 약모음(i·u)에 강세 표시가
 * 붙으면 이중모음이 깨진다 — día 는 di-a 두 음절이다. */
function nuclei(list) {
  const groups = [];
  let current = null;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item.t !== "V") { current = null; continue; }
    const previous = current?.at(-1);
    // 약모음(i·u)이 강세 없이 붙어 있으면 한 음절이다 — bien·quiero·también.
    // 깨지는 것은 **약모음 쪽에** 강세가 붙었을 때뿐이다 (día, país).
    const joinable = current
      && ((WEAK.has(item.s) && !item.accent) || (WEAK.has(previous.s) && !previous.accent))
      // 이미 이중모음이면 삼중모음(iai·uai)까지만 받는다
      && current.length < 3;
    if (joinable) current.push(item);
    else { current = [item]; groups.push({ vowels: current, at: i }); }
  }
  return groups;
}

// 강세를 받지 않는 말들(관사·전치사·접속사·목적격 대명사). 이것까지 굵게 하면
// 줄 전체가 굵어져서 "어디에 박이 떨어지는지"가 보이지 않는다. 표시가 붙은 꼴
// (él·tú·sí·qué)은 여기 없으므로 그대로 강세를 받는다.
const TONELESS = new Set([
  "el", "la", "lo", "los", "las", "un", "unos", "unas",
  "me", "te", "se", "le", "les", "nos", "os",
  "mi", "tu", "su", "mis", "tus", "sus",
  "de", "del", "a", "al", "en", "con", "por", "para", "sin",
  "y", "e", "o", "u", "ni", "que", "si", "al",
]);

/** 강세가 떨어지는 핵의 번호. 노래에서 박이 걸리는 자리다. */
function stressIndex(word, groups) {
  if (!groups.length) return -1;
  const marked = groups.findIndex((group) => group.vowels.some((vowel) => vowel.accent));
  if (marked >= 0) return marked;
  if (TONELESS.has(word)) return -1;
  const last = word.at(-1) ?? "";
  // 모음·n·s 로 끝나면 뒤에서 둘째, 아니면 마지막. (스페인어 강세 규칙 전부다.)
  const penultimate = VOWELS.has(ACCENTED[last] ?? last) || last === "n" || last === "s";
  return penultimate && groups.length > 1 ? groups.length - 2 : groups.length - 1;
}

/* ── 한 줄을 한 흐름으로 ──────────────────────────────────────────────── */
function stream(line) {
  const items = [];
  let nucleus = 0;
  for (const [index, word] of splitWords(line).entries()) {
    const list = phonemes(word);
    const groups = nuclei(list);
    const stressed = stressIndex(word, groups);
    for (const [order, group] of groups.entries()) {
      // 핵마다 번호를 매겨 둔다. 같은 번호는 한 음절 안에 있어야 한다
      // (이중모음 quie-ro 를 끼-에-로 셋으로 세면 박자가 어긋난다).
      for (const vowel of group.vowels) {
        vowel.nucleus = nucleus;
        if (order === stressed) vowel.stress = true;
      }
      nucleus += 1;
    }
    for (const [order, item] of list.entries()) {
      items.push({ ...item, word: index, first: order === 0 });
    }
  }
  return items;
}

/* 자음 덩어리를 앞뒤 음절에 나눠 준다. 하나면 뒤로, 둘이면 갈라지되 pr·bl 같은
 * 덩어리는 통째로 뒤로 — 스페인어 음절 나누기 규칙 그대로다. */
function splitCluster(run) {
  if (run.length <= 1) return [[], run];
  const pair = run.slice(-2).map((item) => item.s).join("");
  if (run.length === 2) return TIGHT.has(pair) ? [[], run] : [run.slice(0, 1), run.slice(1)];
  return TIGHT.has(pair) ? [run.slice(0, -2), run.slice(-2)] : [run.slice(0, -1), run.slice(-1)];
}

/**
 * 줄 전체를 음절(=박)로 나눈다. 단어 경계를 넘어 소리가 이어진다.
 * 각 음절: { onset, vowels, coda, stress, space, linked }
 */
function syllabify(line) {
  const items = stream(line);
  const slots = [];
  let run = [];
  for (const item of items) {
    if (item.t === "C") { run.push(item); continue; }
    const last = slots.at(-1);
    const previous = last?.vowels.at(-1);
    const sameNucleus = previous && run.length === 0 && item.nucleus === previous.nucleus;
    // sinalefa — 앞 음절이 모음으로 끝나고 다음 단어가 모음으로 시작하면 한 박이다.
    const sinalefa = previous
      && run.length === 0
      && item.word !== previous.word
      && !item.accent && !previous.accent;
    if (sameNucleus || sinalefa) {
      // 같은 모음이 겹치면 하나로 부른다 (la alma → 랄마).
      if (previous.s !== item.s || sameNucleus) last.vowels.push(item);
      if (item.stress) last.stress = true;
      continue;
    }
    if (last) {
      const [coda, onset] = splitCluster(run);
      last.coda = coda;
      slots.push({ onset, vowels: [item], coda: [], stress: Boolean(item.stress) });
    } else {
      slots.push({ onset: run, vowels: [item], coda: [], stress: Boolean(item.stress) });
    }
    run = [];
  }
  if (slots.length) slots.at(-1).coda = run;

  // 띄어 읽는 자리와 이어 붙는 자리. 둘은 같은 자리에 올 수 없다 — 한 박은
  // 새 단어로 시작하거나(띄기), 앞 단어에서 소리를 물려받거나(이음표) 둘 중 하나다.
  for (const [index, slot] of slots.entries()) {
    const start = slot.onset[0] ?? slot.vowels[0];
    // 앞 단어의 자음이 이 박을 열었다 — el amor 의 la, los ojos 의 so.
    const carried = Boolean(slot.onset.length) && slot.onset[0].word !== slot.vowels[0].word;
    slot.space = index > 0 && Boolean(start.first) && !carried;
    slot.linked = index > 0 && !slot.space && carried;
  }
  return slots;
}

/* ── 소리 → 한글 ──────────────────────────────────────────────────────────
 * 한글은 스페인어보다 음절이 잘게 쪼개져 그대로 옮기면 박자가 늘어난다
 * (blan-co 두 박이 "블랑꼬" 세 글자). 그래서 글자가 아니라 **음절 덩어리**를
 * 돌려주고, 화면이 덩어리 사이만 띄운다. */
const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ",
  "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ",
  "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ",
  "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

const syllable = (cho, jung, jong = "") => String.fromCharCode(
  0xac00 + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong));

// 첫소리. p·t·k 는 된소리다 — 거센소리로 적으면 스페인어처럼 들리지 않는다.
const ONSET = {
  b: "ㅂ", p: "ㅃ", t: "ㄸ", d: "ㄷ", k: "ㄲ", g: "ㄱ", f: "ㅍ", s: "ㅅ", h: "ㅎ",
  ch: "ㅊ", m: "ㅁ", n: "ㄴ", l: "ㄹ", r: "ㄹ", rr: "ㄹ", ny: "ㄴ", y: "ㅇ", w: "ㅇ",
};
// 받침으로 붙는 것과, 한 글자를 더 써야 하는 것. 둘 다 같은 덩어리 안에 남는다.
const CODA_JONG = { n: "ㄴ", m: "ㅁ", l: "ㄹ", k: "ㄱ", g: "ㄱ" };
const CODA_TAIL = { s: "스", r: "르", rr: "르", d: "드", b: "브", f: "프", h: "흐", ch: "츠", y: "이" };
const PLAIN = { a: "ㅏ", e: "ㅔ", i: "ㅣ", o: "ㅗ", u: "ㅜ" };
const AFTER_Y = { a: "ㅑ", e: "ㅖ", i: "ㅣ", o: "ㅛ", u: "ㅠ" };

function render(slot) {
  const onset = [...slot.onset];
  // ll·y·ñ 는 뒤따르는 모음에 반모음으로 녹는다 (llamar→야마르, año→아뇨).
  let glide = false;
  const lastOnset = onset.at(-1);
  if (lastOnset && (lastOnset.s === "y" || lastOnset.s === "ny")) {
    glide = true;
    if (lastOnset.s === "y") onset.pop();                 // ll·y 는 ㅇ 자리만 남는다
  }

  // 한 핵 안의 모음은 글자를 나눠 적는다 — quiero 를 "꼐"로 적으면 정확하지만
  // 읽는 속도가 죽는다. "끼에" 로 적되 두 글자를 한 덩어리로 묶어 한 박임을 보인다.
  const table = glide ? AFTER_Y : PLAIN;
  const lead = onset.slice(0, -1).map((item) => syllable(ONSET[item.s] ?? "ㅇ", "ㅡ")).join("");
  const chars = slot.vowels.map((vowel, index) => ({
    cho: index === 0 ? ONSET[onset.at(-1)?.s] ?? "ㅇ" : "ㅇ",
    jung: (index === 0 ? table : PLAIN)[vowel.s] ?? "ㅏ",
    jong: "",
  }));
  if (!chars.length) return lead;

  let tail = "";
  for (const [index, item] of slot.coda.entries()) {
    // 받침으로 붙는 것 하나만 마지막 글자에 얹고, 나머지는 글자를 더 쓴다.
    if (index === 0 && CODA_JONG[item.s]) chars.at(-1).jong = CODA_JONG[item.s];
    else if (CODA_TAIL[item.s]) tail += CODA_TAIL[item.s];
    else if (CODA_JONG[item.s]) tail += syllable("ㅇ", "ㅡ", CODA_JONG[item.s]);
  }
  return lead + chars.map((char) => syllable(char.cho, char.jung, char.jong)).join("") + tail;
}

/**
 * 한 줄의 소리. 음절(박) 하나가 원소 하나다.
 *   ko      한글 덩어리
 *   stress  강세 — 박이 떨어지는 자리
 *   space   앞에서 띄어 읽는다 (물려받은 소리가 없는 단어 경계)
 *   linked  앞 단어의 자음을 물려받아 시작한다 (연음) — 가사만 봐서는 안 보이는 자리
 */
export function readLine(line) {
  return syllabify(line).map((slot) => ({
    ko: render(slot),
    stress: Boolean(slot.stress),
    space: Boolean(slot.space),
    linked: Boolean(slot.linked),
  }));
}

/** 화면·테스트가 한눈에 보는 문자열. 박 사이는 붙이고 띄어 읽는 곳만 띄운다. */
export function koLine(line) {
  return readLine(line)
    .map((unit, index) => (unit.space && index ? " " : "") + unit.ko)
    .join("");
}

/** 노래는 박 수가 맞아야 따라 부를 수 있다 — 줄마다 몇 박인지. */
export const beats = (line) => readLine(line).length;
