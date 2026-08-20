// life/espanol — 노래로 스페인어. 소리 엔진과 상태 규칙만 본다(화면은 e2e).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { beats, koLine, readLine, splitWords } from "../life/espanol/pronounce.js";
import { glossLine, lookup } from "../life/espanol/words.js";
import {
  INTERVALS, KNOWN_BOX, SONGS_MAX,
  addSong, clearMarks, deckLines, dueLines, emptyState, grade, lineSpan, linesFrom,
  parseLyrics, parseState, progressOf, removeSong, setLineKo, setMark, updateSong,
} from "../life/espanol/store.js";

/* ── 소리 ────────────────────────────────────────────────────────────────
 * 이 도구의 전부다. 표기가 아니라 "노래로 나오는 소리"를 만드는지 본다. */

test("연음 — 단어 경계를 넘어 자음이 넘어간다", () => {
  // el amor 를 "엘 아모르"로 외우면 노래에서 그 말을 못 알아듣는다.
  assert.equal(koLine("el amor"), "에라모르");
  assert.equal(koLine("los ojos"), "로소호스");
  assert.equal(koLine("un beso"), "운 베소");        // 자음 앞에서는 넘어가지 않는다

  // 넘어간 자리에는 이음표를, 그냥 새 단어에는 띄어쓰기를 준다. 둘은 겹치지 않는다.
  const [first, second] = readLine("el amor");
  assert.equal(first.space, false);
  assert.deepEqual([second.space, second.linked], [false, true]);
  assert.deepEqual(readLine("un beso").map((unit) => unit.linked), [false, false, false]);
  assert.equal(readLine("un beso")[1].space, true);
});

test("모음이 만나면 한 박으로 합쳐진다 (sinalefa)", () => {
  assert.equal(beats("de amor"), 2);                 // dea-mor
  assert.equal(koLine("de amor"), "데아모르");
  assert.equal(beats("¿dónde estás?"), 3);           // dón-de-stás
  // 강세가 붙은 모음은 삼키지 않는다 — 박을 잃으면 노래가 어긋난다.
  assert.equal(beats("tú y yo"), 3);
});

test("이중모음은 한 박, 약모음에 강세가 붙으면 깨진다", () => {
  assert.equal(beats("quiero"), 2);
  assert.equal(beats("bien"), 1);
  assert.equal(beats("también"), 2);
  assert.equal(beats("día"), 2);                     // dí-a
  assert.equal(beats("país"), 2);                    // pa-ís
  assert.equal(beats("cuidado"), 3);                 // cui-da-do
});

test("강세는 스페인어 규칙 그대로 — 노래의 박이 여기 떨어진다", () => {
  const at = (word) => readLine(word).findIndex((unit) => unit.stress);
  assert.equal(at("corazón"), 2);                    // 표시가 있으면 그 자리
  assert.equal(at("beso"), 0);                       // 모음으로 끝나면 뒤에서 둘째
  assert.equal(at("cantan"), 0);                     // n 으로 끝나도 뒤에서 둘째
  assert.equal(at("mujer"), 1);                      // 그 밖에는 마지막
  assert.equal(at("verdad"), 1);
});

test("관사·목적격 대명사에는 박이 걸리지 않는다", () => {
  // 줄 전체가 굵어지면 "어디에 박이 떨어지는지"를 볼 수 없다.
  const marked = readLine("El amor no me deja dormir").filter((unit) => unit.stress);
  assert.equal(marked.length, 4);                    // amor · no · deja · dormir
  assert.equal(readLine("me").some((unit) => unit.stress), false);
  assert.equal(readLine("mí").some((unit) => unit.stress), true);   // 표시가 붙으면 강세다
});

test("글자를 소리로 — c·g·qu·ll·ñ·h 규칙", () => {
  assert.equal(koLine("hola"), "오라");               // h 는 언제나 묵음
  assert.equal(koLine("cinco"), "신꼬");              // c 는 e·i 앞에서만 ㅅ
  assert.equal(koLine("que"), "께");                 // qu 의 u 는 소리가 없다
  assert.equal(koLine("guitarra"), "기따라");
  assert.equal(koLine("jugar"), "후가르");
  assert.equal(koLine("llamar"), "야마르");
  assert.equal(koLine("año"), "아뇨");
  assert.equal(koLine("zapato"), "사빠또");
  assert.equal(koLine("blanco"), "브란꼬");           // 자음 덩어리도 두 박이다
  assert.equal(beats("blanco"), 2);
});

test("문장부호는 소리에 없다", () => {
  assert.deepEqual(splitWords("¿Dónde estás, amor?"), ["dónde", "estás", "amor"]);
  assert.equal(koLine("¡Vamos!"), koLine("vamos"));
  assert.deepEqual(readLine(""), []);
});

test("빈 줄·모르는 글자에도 터지지 않는다", () => {
  assert.deepEqual(readLine("   "), []);
  assert.equal(typeof koLine("123 ??? %%%"), "string");
});

/* ── 사전 ────────────────────────────────────────────────────────────── */

test("아는 낱말에 뜻이 붙고, 덩어리가 낱말보다 먼저다", () => {
  const found = glossLine("Te quiero más que ayer");
  assert.equal(found[0].es, "te quiero");            // te·quiero 를 따로 풀지 않는다
  assert.ok(!found.some((entry) => entry.es === "te"));
  assert.ok(found.some((entry) => entry.es === "ayer"));
});

test("덩어리가 낱말 안에 묻혀 있으면 찾은 것이 아니다", () => {
  // muévete 안의 "vete" 를 잡으면 "가 버려" 라는 엉뚱한 뜻이 붙는다.
  const found = glossLine("Muévete suavecito").map((entry) => entry.es);
  assert.ok(!found.includes("vete"), `낱말 안에서 덩어리를 잡았다: ${found.join(" ")}`);
  assert.ok(found.includes("muévete"));
  // 낱말로 서 있으면 그대로 찾는다.
  assert.ok(glossLine("Vete ya").some((entry) => entry.es === "vete"));
});

test("강세 표시를 빼먹고 적어도 찾는다", () => {
  assert.equal(lookup("corazon"), lookup("corazón"));
  assert.equal(lookup("Corazón,"), "심장·마음");
  assert.equal(lookup("zzzz"), null);
});

test("사전에 같은 낱말을 두 번 적지 않는다", () => {
  // 객체 리터럴의 중복 키는 조용히 덮인다 — 뒤에 적은 뜻만 남고 앞엣것은 사라진다.
  // 파싱된 뒤에는 알 수 없으므로 파일 원문을 읽어 센다.
  const source = readFileSync(new URL("../life/espanol/words.js", import.meta.url), "utf8");
  const section = (name, end) =>
    source.slice(source.indexOf(`export const ${name} = {`), source.indexOf(end));
  const twice = (keys) => keys.filter((key, index) => keys.indexOf(key) !== index);

  assert.deepEqual(twice([...section("WORDS", "/* 낱말 하나로는").matchAll(/([a-záéíóúüñ]+): "/g)]
    .map(([, key]) => key)), []);
  assert.deepEqual(twice([...section("PHRASES", "const STRIP =").matchAll(/"([a-záéíóúüñ ]+)":/g)]
    .map(([, key]) => key)), []);
});

test("레게톤·라틴팝 어휘도 사전에 있다", () => {
  // 이 갈래는 축소사(-ito)와 명령형, -ando 꼴이 유난히 많다.
  for (const word of ["despacito", "suavecito", "pasito", "oído", "cintura",
    "muévete", "acércate", "bailando", "sintiendo", "peligroso"]) {
    assert.ok(lookup(word), `${word} 이 사전에 없다`);
  }
  // 낱말과 뜻만 싣는다 — 특정 곡의 구절은 리포에 들어오지 않는다.
  assert.equal(lookup("despacito"), "천천히·살살");
});

test("표시 하나로 뜻이 갈리는 짝은 섞이지 않는다", () => {
  // 표시를 지우고 찾는 보조 규칙이 있어서, 짝을 둘 다 담아 두지 않으면
  // el(관사)에 él(그) 의 뜻이 붙는다.
  assert.notEqual(lookup("el"), lookup("él"));
  assert.notEqual(lookup("se"), lookup("sé"));
  assert.notEqual(lookup("mas"), lookup("más"));
  assert.notEqual(lookup("si"), lookup("sí"));
  assert.notEqual(lookup("tu"), lookup("tú"));
});

/* ── 가사와 진도 ────────────────────────────────────────────────────── */

test("붙여넣은 덩어리에서 노래가 아닌 줄은 뺀다", () => {
  const lines = parseLyrics("[Coro]\n  Te quiero  \n\n(x2)\nNo me olvides\n");
  assert.deepEqual(lines, ["Te quiero", "No me olvides"]);
});

test("가사를 다시 붙여넣어도 익힌 줄의 진도는 남는다", () => {
  const first = linesFrom("Te quiero\nNo me olvides");
  const learned = [{ ...first[0], box: 4, due: "2026-09-01", ko: "사랑해" }, first[1]];
  const again = linesFrom("Te quiero\nUna línea nueva\nNo me olvides", learned);
  assert.equal(again[0].box, 4);
  assert.equal(again[0].ko, "사랑해");
  assert.equal(again[0].id, first[0].id);            // 같은 줄이면 카드도 같은 카드다
  assert.equal(again[1].box, 0);
  assert.equal(again[2].id, first[1].id);
});

const seed = (lyrics = "Te quiero\nTe quiero\nNo me olvides") =>
  addSong(emptyState(), { title: "연습곡", artist: "아무개", lyrics });

test("후렴은 한 장으로 친다 — 같은 줄을 네 번 묻지 않는다", () => {
  const state = seed();
  const song = state.songs[0];
  assert.equal(song.lines.length, 3);
  assert.equal(deckLines(song).length, 2);
  // 한 장을 올리면 같은 문장 전부가 함께 올라간다.
  const graded = grade(state, song.id, song.lines[0].id, true, "2026-08-20");
  assert.deepEqual(graded.songs[0].lines.map((line) => line.box), [1, 1, 0]);
});

test("맞히면 상자가 오르고 틀리면 1번으로 내려온다", () => {
  let state = seed();
  const { id } = state.songs[0];
  const lineId = state.songs[0].lines[0].id;
  for (let round = 0; round < 3; round += 1) state = grade(state, id, lineId, true, "2026-08-20");
  const line = state.songs[0].lines[0];
  assert.equal(line.box, 3);
  assert.equal(line.due, "2026-08-24");              // 상자 3 = 나흘 뒤
  state = grade(state, id, lineId, false, "2026-08-24");
  assert.equal(state.songs[0].lines[0].box, 1);
  assert.equal(state.songs[0].lines[0].due, "2026-08-25");
  assert.equal(INTERVALS.length - 1, 5);
});

test("오늘 할 줄 — 기한이 된 복습 + 새 줄 몇 개", () => {
  let state = seed(Array.from({ length: 20 }, (_, index) => `Línea número ${index}`).join("\n"));
  const song = () => state.songs[0];
  const { id } = song();
  assert.equal(dueLines(song(), "2026-08-20").length, 8);       // 처음 보는 줄은 여덟 개까지
  state = grade(state, id, song().lines[0].id, true, "2026-08-20");
  assert.equal(dueLines(song(), "2026-08-20").length, 8);       // 오늘 맞힌 줄은 오늘 안 나온다
  assert.ok(dueLines(song(), "2026-08-21").some((line) => line.id === song().lines[0].id));
});

test("진행률은 하루 넘겨 살아남은 줄만 센다", () => {
  let state = seed("Uno\nDos");
  const { id } = state.songs[0];
  const lineId = state.songs[0].lines[0].id;
  state = grade(state, id, lineId, true, "2026-08-20");
  assert.equal(progressOf(state.songs[0], "2026-08-20").known, 0);
  for (let round = 0; round < 2; round += 1) state = grade(state, id, lineId, true, "2026-08-20");
  assert.equal(state.songs[0].lines[0].box, KNOWN_BOX);
  assert.equal(progressOf(state.songs[0], "2026-08-20").known, 1);
  assert.equal(progressOf(state.songs[0], "2026-08-20").total, 2);
});

test("음원 구간 — 끝은 다음으로 찍은 줄이고, 마지막 줄은 곡 끝까지다", () => {
  let state = seed("Uno\nDos\nTres");
  const { id, lines } = state.songs[0];
  state = setMark(state, id, lines[0].id, 12.34);
  state = setMark(state, id, lines[2].id, 20);
  const song = state.songs[0];
  assert.deepEqual(lineSpan(song, lines[0].id), { start: 12.3, end: 20 });
  assert.deepEqual(lineSpan(song, lines[2].id), { start: 20, end: null });
  assert.equal(lineSpan(song, lines[1].id), null);   // 안 찍은 줄은 구간이 없다
  assert.equal(progressOf(song).marked, 2);
  assert.equal(clearMarks(state, id).songs[0].lines.every((line) => line.t === null), true);
});

test("제목만 고쳐도 가사와 진도는 그대로다", () => {
  let state = seed("Uno\nDos");
  const { id } = state.songs[0];
  state = grade(state, id, state.songs[0].lines[0].id, true, "2026-08-20");
  state = updateSong(state, id, { title: "새 제목", artist: "다른 가수" });
  assert.equal(state.songs[0].title, "새 제목");
  assert.equal(state.songs[0].lines.length, 2);
  assert.equal(state.songs[0].lines[0].box, 1);
});

test("빈 제목·빈 가사는 저장되지 않는다", () => {
  assert.throws(() => addSong(emptyState(), { title: "  ", lyrics: "Uno" }), /제목/);
  assert.throws(() => addSong(emptyState(), { title: "제목", lyrics: "\n\n[Coro]\n" }), /가사/);
  assert.throws(() => updateSong(seed(), "없는곡", { title: "제목" }), /없어요/);
});

test("저장된 값이 망가져 있어도 나머지로 시작한다", () => {
  assert.deepEqual(parseState("{{{"), emptyState());
  assert.deepEqual(parseState(JSON.stringify({ v: 9, songs: [] })), emptyState());
  const state = parseState(JSON.stringify({
    v: 1,
    songs: [
      { title: "쓸 만한 곡", lines: [{ es: "Uno", box: 99, due: "어제", t: -5 }, { es: "  " }] },
      { title: "", lines: [{ es: "Uno" }] },          // 제목이 없으면 버린다
      { title: "줄이 없는 곡", lines: [] },
    ],
  }));
  assert.equal(state.songs.length, 1);
  const [line] = state.songs[0].lines;
  assert.equal(state.songs[0].lines.length, 1);
  assert.equal(line.box, INTERVALS.length - 1);       // 범위를 넘는 상자는 잘라 넣는다
  assert.equal(line.due, "");
  assert.equal(line.t, null);
  assert.ok(line.id);
});

test("곡 수 상한과 지우기", () => {
  let state = emptyState();
  for (let index = 0; index < SONGS_MAX; index += 1) {
    state = addSong(state, { title: `곡 ${index}`, lyrics: "Uno" });
  }
  assert.throws(() => addSong(state, { title: "한 곡 더", lyrics: "Uno" }), /40곡/);
  const target = state.songs[0].id;
  assert.equal(removeSong(state, target).songs.length, SONGS_MAX - 1);
});

test("줄의 뜻은 손으로도 적는다", () => {
  const state = seed("Uno\nDos");
  const { id, lines } = state.songs[0];
  const next = setLineKo(state, id, lines[0].id, "  하나  ");
  assert.equal(next.songs[0].lines[0].ko, "하나");
});
