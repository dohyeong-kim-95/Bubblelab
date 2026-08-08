// 랜딩 검색의 규칙 엔진 테스트. 화면 없이 규칙만 본다 —
// 어떤 질의가 어떤 규칙으로 어떤 카드를 찾아야 하는지가 전부다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES, SYNONYMS, chosungOf, jamoOf, layoutJamo, normalize, searchCards,
} from "../_shared/search-rules.js";

const card = (site, name, label, title = label, desc = "") =>
  ({ site, name, label, title, desc });

const INDEX = [
  card("util", "util", "util", "util", "달력·운세·사진·변환·플래너 같은 작은 도구들"),
  card("slop", "slop", "slop", "slop", "방금 만든 것들"),
  card("util", "ladder", "사다리타기", "🪜 사다리타기"),
  card("util", "lotto", "로또번호 추첨기"),
  card("util", "image-convert", "이미지 형식 변환", "🖼️ 이미지 형식 변환"),
  card("util", "photo", "네컷사진", "📸 네컷사진"),
  card("util", "stars", "별자리 배경화면"),
  card("slop", "dino", "공룡 점프", "공룡 점프 — 판다 구경"),
  card("slop", "zone", "인생 포토존"),           // '포토'가 말 가운데 들어간 미끼
  card("assets", "wallpaper", "Wallpaper", "🖼️ Wallpaper · Bubblelab Assets"),
];

const top = (q) => searchCards(INDEX, q)[0];
const names = (q) => searchCards(INDEX, q).map((h) => h.entry.name);

test("규칙 이름은 점수가 센 순서로 정의돼 있다", () => {
  const scores = RULES.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
});

test("빈 질의는 아무것도 내지 않는다 (기본 화면 유지)", () => {
  for (const q of ["", "   ", null, undefined]) assert.deepEqual(searchCards(INDEX, q), []);
});

test("정확·앞부분·부분 일치가 이 순서로 이긴다", () => {
  assert.equal(top("lotto").rule, "exact");
  assert.equal(top("사다").rule, "prefix");
  assert.equal(top("사다").entry.name, "ladder");
  assert.equal(top("다리타기").rule, "part");
  assert.equal(top("다리타기").entry.name, "ladder");
});

test("초성으로 찾는다", () => {
  assert.equal(chosungOf("사다리타기"), "ㅅㄷㄹㅌㄱ");
  const hit = top("ㅅㄷㄹ");
  assert.equal(hit.entry.name, "ladder");
  assert.equal(hit.rule, "chosung");
  assert.equal(hit.label, "초성 일치");
});

test("한 글자를 덜 쳐도 자모로 찾는다", () => {
  assert.equal(jamoOf("사다리"), "ㅅㅏㄷㅏㄹㅣ");
  assert.equal(jamoOf("괜"), "ㄱㅗㅐㄴ");        // 겹모음은 친 순서대로 펴진다
  assert.equal(jamoOf("값"), "ㄱㅏㅂㅅ");        // 겹받침도 마찬가지
  const hit = top("사다ㄹ");
  assert.equal(hit.entry.name, "ladder");
  assert.equal(hit.rule, "jamo");
});

test("한/영을 안 바꾸고 쳐도 찾는다", () => {
  assert.equal(layoutJamo("tkek"), "ㅅㅏㄷㅏ");
  assert.equal(layoutJamo("사다리"), "", "한글만 있으면 규칙을 건너뛴다");
  const hit = top("tkekfl");                     // '사다리'
  assert.equal(hit.entry.name, "ladder");
  assert.equal(hit.rule, "layout");
});

test("비슷한 말 표로 찾는다", () => {
  const hit = top("제비뽑기");                    // 제목에도 폴더 이름에도 없는 말
  assert.equal(hit.entry.name, "ladder");
  assert.equal(hit.rule, "synonym");
  assert.equal(top("월페이퍼").entry.name, "wallpaper");
  assert.equal(top("바탕화면").entry.name, "wallpaper");
});

test("짧은 비슷한 말은 부분 일치로 번지지 않는다", () => {
  // '사진'은 '포토'로도 찾지만, 두 자짜리라 말 가운데에 걸리면 안 된다
  // ('뽑기'가 '꺼내기'에 걸려 엉뚱한 카드를 끌고 온 적이 있다)
  const hits = names("사진");
  assert.ok(hits.includes("photo"), "정작 사진 카드를 못 찾았다");
  assert.ok(!hits.includes("zone"), "짧은 비슷한 말이 말 가운데에 걸렸다");
});

test("비슷한 말 표는 서로 오가는 묶음이다", () => {
  for (const group of SYNONYMS) {
    assert.ok(group.length >= 2, `묶음이 한 낱말뿐이다: ${group}`);
    assert.equal(new Set(group.map(normalize)).size, group.length, `묶음에 중복: ${group}`);
  }
});

test("띄어쓴 낱말은 모두 맞아야 한다", () => {
  const hits = names("네컷 사진");
  assert.equal(hits[0], "photo");
  assert.ok(!hits.includes("stars"), "한 낱말만 맞는 카드가 섞였다");
  assert.deepEqual(names("사다리 로또"), [], "둘 다 맞는 카드는 없다");
});

test("카테고리 이름으로 그 카테고리와 소속 카드를 함께 낸다", () => {
  const hits = searchCards(INDEX, "util");
  assert.equal(hits[0].entry.name, "util", "카테고리 카드가 맨 위");
  assert.equal(hits[0].rule, "exact");
  assert.ok(hits.length > 1, "소속 카드도 함께 나와야 한다");
  assert.ok(hits.slice(1).every((h) => h.entry.site === "util"));
});

test("카테고리 설명으로도 찾히지만 제목 일치보다 약하다", () => {
  const hits = searchCards(INDEX, "달력");
  assert.equal(hits[0].entry.name, "util");      // 설명에만 있는 카테고리
  assert.ok(hits.every((h) => h.score > 0));
});

test("대소문자·띄어쓰기·붙임표를 무시한다", () => {
  assert.equal(normalize("Image-Convert"), "imageconvert");
  for (const q of ["image-convert", "IMAGE CONVERT", "imageconvert"]) {
    assert.equal(top(q).entry.name, "image-convert", `"${q}"로 못 찾았다`);
  }
});

test("못 찾으면 빈 배열이다 (아무거나 내지 않는다)", () => {
  assert.deepEqual(searchCards(INDEX, "zzzz없는것"), []);
});

test("같은 질의는 언제나 같은 순서를 낸다", () => {
  const once = names("사");
  assert.deepEqual(names("사"), once);
  assert.deepEqual(searchCards([...INDEX].reverse(), "사").map((h) => h.entry.name), once);
});

test("limit으로 개수를 자른다", () => {
  assert.equal(searchCards(INDEX, "util", { limit: 2 }).length, 2);
});
