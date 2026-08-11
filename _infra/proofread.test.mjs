import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES, applyAllFixes, applyFix, check, countText, finalOf,
} from "../util/proofread/rules.js";

// 검사기가 한 자리를 어떻게 고치라고 했는지 한 줄로 확인한다.
const fixedText = (text) => applyAllFixes(text, check(text)).text;
const titles = (text) => check(text).map((i) => i.title);

/* ---------- 되 / 돼, 안 / 않 ---------- */

test("되/돼를 준말 규칙대로 고친다", () => {
  assert.equal(fixedText("그렇게 되요"), "그렇게 돼요");
  assert.equal(fixedText("어제 다 됬어"), "어제 다 됐어");
  assert.equal(fixedText("늦게 되서 미안"), "늦게 돼서 미안");
  assert.equal(fixedText("안 되도 괜찮아"), "안 돼도 괜찮아");
  assert.equal(fixedText("그건 안되"), "그건 안 돼");
  assert.equal(fixedText("잘 돼면 좋겠다"), "잘 되면 좋겠다");
});

test("'되도록'은 '되도'가 아니다", () => {
  assert.deepEqual(check("되도록 빨리 갈게"), []);
});

test("'안되면'처럼 말이 이어지면 건드리지 않는다", () => {
  assert.deepEqual(check("안되면 다시 하자"), []);
});

test("않 / 안을 가려낸다", () => {
  assert.equal(fixedText("그러면 않되지"), "그러면 안 되지");
  assert.equal(fixedText("숙제를 않했어"), "숙제를 안 했어");
  // '-지 않-'은 맞는 자리라 그대로 둔다
  assert.deepEqual(check("가지 않았다"), []);
});

test("'~지 안'은 확인 필요로만 알린다", () => {
  const [issue] = check("아직 가지 안았다");
  assert.equal(applyFix("아직 가지 안았다", issue), "아직 가지 않았다");
  assert.equal(issue.soft, true);
  // soft 지적은 '모두 고치기'에 휩쓸리지 않는다
  assert.equal(fixedText("아직 가지 안았다"), "아직 가지 안았다");
});

/* ---------- 왠 / 웬, 낱말 표 ---------- */

test("왠지만 '왠'이고 나머지는 '웬'이다", () => {
  assert.equal(fixedText("웬지 슬프다"), "왠지 슬프다");
  assert.equal(fixedText("이게 왠일이야"), "이게 웬일이야");
  assert.deepEqual(check("왠지 웬만하면 웬 떡이야"), []);
});

test("자주 틀리는 낱말을 표대로 고친다", () => {
  assert.equal(fixedText("몇일 만에 오랫만이야"), "며칠 만에 오랜만이야");
  assert.equal(fixedText("어의없는 역활"), "어이없는 역할");
  assert.equal(fixedText("김치찌게 먹을께"), "김치찌개 먹을게");
  assert.equal(fixedText("삼가해 주세요"), "삼가 주세요");
  assert.equal(fixedText("일일히 확인했읍니다"), "일일이 확인했습니다");
  assert.equal(fixedText("담궈 둔 김치"), "담가 둔 김치");
});

test("맞는 쓰임이 따로 있는 낱말은 확인 필요로 둔다", () => {
  const [issue] = check("나의 바램은");
  assert.equal(issue.soft, true);
  assert.equal(issue.suggestion, "바람");
  assert.match(issue.why, /색이 변하는/);
});

/* ---------- 띄어쓰기 ---------- */

test("의존명사 '수'를 앞말과 띄운다", () => {
  assert.equal(fixedText("나도 할수있다"), "나도 할 수 있다");
  assert.equal(fixedText("갈수밖에 없었다"), "갈 수밖에 없었다");
  assert.equal(fixedText("먹을 수있어"), "먹을 수 있어");
});

test("이미 띄어 쓴 자리는 지적하지 않는다", () => {
  assert.deepEqual(check("나도 할 수 있다"), []);
  assert.deepEqual(check("갈 수밖에 없었다"), []);
});

test("'수'가 낱말의 일부인 자리는 건드리지 않는다", () => {
  assert.deepEqual(check("갈수록 좋아진다"), []);
  assert.deepEqual(check("실수 없이 해냈다"), []);
  assert.deepEqual(check("별수 없지"), []);
});

test("'것 같다'는 띄우되 '그것·이것'은 붙여 둔다", () => {
  assert.equal(fixedText("비 올것같다"), "비 올 것 같다");
  assert.equal(fixedText("그것같은 일"), "그것 같은 일");
  assert.deepEqual(check("비가 올 것 같다"), []);
  assert.deepEqual(check("그것 같은 일"), []);
});

test("때문·와 같이·에 대한을 띄운다", () => {
  assert.equal(fixedText("너때문에 늦었어"), "너 때문에 늦었어");
  assert.equal(fixedText("아까와같이 해줘"), "아까와 같이 해줘");
  assert.equal(fixedText("그일에대해 이야기하자"), "그일에 대해 이야기하자");
  assert.deepEqual(check("그때문에 늦었어"), []);
});

/* ---------- 문체 · 문장부호 ---------- */

test("이중피동을 한 번으로 줄인다", () => {
  assert.equal(fixedText("그렇게 보여진다"), "그렇게 보인다");
  assert.equal(fixedText("잊혀진 계절"), "잊힌 계절");
  assert.equal(fixedText("결정되어졌다"), "결정됐다");
});

test("번역투는 고치지 않고 알리기만 한다", () => {
  const [issue] = check("공부에 있어서 중요한 것");
  assert.equal(issue.kind, "style");
  assert.equal(issue.suggestion, null);
  assert.equal(applyFix("공부에 있어서 중요한 것", issue), "공부에 있어서 중요한 것");
});

test("문장부호 둘레의 공백을 다듬는다", () => {
  assert.equal(fixedText("안녕 , 반가워"), "안녕, 반가워");
  assert.equal(fixedText("안녕.반가워"), "안녕. 반가워");
  assert.equal(fixedText("정말  좋다"), "정말 좋다");
  assert.equal(fixedText("좋다   \n다음 줄"), "좋다\n다음 줄");
});

test("줄 첫머리 들여쓰기는 공백 반복으로 보지 않는다", () => {
  assert.deepEqual(check("    들여 쓴 문단입니다."), []);
});

/* ---------- 오탐 방지 ---------- */

test("멀쩡한 글은 건드리지 않는다", () => {
  const clean = [
    "오늘은 오랜만에 친구를 만나 김치찌개를 먹었다.",
    "되도록 빨리 끝내려고 했지만 생각처럼 되지 않았다.",
    "갈수록 실력이 늘어서 나도 할 수 있다는 생각이 들었다.",
    "돼지고기 두 근을 사서 냉장고에 넣어 두었다.",
    "간간히 간을 본 국이 번번히 짜서 다시 끓였다.",
    "선생님께 여쭤보니 웬만하면 그냥 두라고 하셨다.",
    "별수 없이 실수를 인정하고 처음부터 다시 했다.",
    "아이를 낳은 뒤로 몸이 예전 같지 않다고 하셨다.",
    "그것 같은 일이 또 생길 줄은 몰랐다.",
  ].join("\n\n");
  assert.deepEqual(check(clean), []);
});

/* ---------- 엔진 자체 ---------- */

test("겹치는 지적은 하나만 남는다", () => {
  const issues = check("할수있을것같다");
  const spans = issues.map((i) => [i.start, i.end]);
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i][0] >= spans[i - 1][1], `${spans[i - 1]}와 ${spans[i]}가 겹친다`);
  }
});

test("지적은 글 순서대로 나온다", () => {
  const issues = check("웬지 몇일 되서 안절부절하다");
  const starts = issues.map((i) => i.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(issues.length >= 3);
});

test("found는 원문에서 잘라낸 그 자리다", () => {
  const text = "이건 정말 어의없는 일이다";
  for (const issue of check(text)) {
    assert.equal(text.slice(issue.start, issue.end), issue.found);
  }
});

test("분류를 골라 검사할 수 있다", () => {
  const text = "몇일  뒤에 보여진다";
  const kinds = new Set(check(text, { kinds: ["style"] }).map((i) => i.kind));
  assert.deepEqual([...kinds], ["style"]);
  assert.ok(check(text).length > check(text, { kinds: ["style"] }).length);
});

test("한 자리에 두 가지가 겹쳐 있어도 한 번에 다 고친다", () => {
  // '보여질것같아요'는 이중피동과 띄어쓰기가 겹쳐 첫 회에는 하나만 잡힌다
  assert.equal(fixedText("좋은 결과가 보여질것같아요"), "좋은 결과가 보일 것 같아요");
});

test("모두 고치기를 한 글에는 확실한 지적이 남지 않는다", () => {
  const text = "웬지 몇일 되서 할수있을것같다  .";
  const { text: fixed, fixed: count } = applyAllFixes(text, check(text));
  assert.ok(count > 0);
  assert.deepEqual(check(fixed).filter((i) => !i.soft && i.suggestion != null), []);
});

test("규칙 id는 겹치지 않는다", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("모든 규칙에 분류와 설명이 있다", () => {
  for (const rule of RULES) {
    assert.ok(["spell", "space", "style", "format"].includes(rule.kind), rule.id);
    assert.ok(rule.title && rule.why, `${rule.id}에 제목이나 설명이 없다`);
    assert.ok(rule.re.flags.includes("g"), `${rule.id}의 정규식에 g 플래그가 없다`);
  }
});

/* ---------- 글자수 ---------- */

test("공백 포함·제외 글자 수를 센다", () => {
  const c = countText("안녕 하세요");
  assert.equal(c.chars, 6);
  assert.equal(c.charsNoSpace, 5);
  assert.equal(c.words, 2);
});

test("이모지는 보이는 대로 한 글자다", () => {
  assert.equal(countText("👍").chars, 1);
  assert.equal(countText("👨‍👩‍👧").chars, 1); // 가족 이모지는 코드포인트 5개짜리 한 글자
});

test("바이트는 두 기준을 함께 센다", () => {
  const c = countText("한글a");
  assert.equal(c.bytesUtf8, 7); // 한글 3바이트 + 3바이트 + a 1바이트
  assert.equal(c.bytes2, 5);    // 옛 2바이트 기준
});

test("문장·문단·줄을 센다", () => {
  const c = countText("첫 문장이다. 둘째 문장!\n같은 문단\n\n다른 문단");
  assert.equal(c.sentences, 4);
  assert.equal(c.paragraphs, 2);
  assert.equal(c.lines, 4);
});

test("원고지는 200자에 한 장이다", () => {
  assert.equal(countText("").manuscript, 0);
  assert.equal(countText("가".repeat(1)).manuscript, 1);
  assert.equal(countText("가".repeat(200)).manuscript, 1);
  assert.equal(countText("가".repeat(201)).manuscript, 2);
});

test("빈 글은 모두 0이다", () => {
  const c = countText("");
  for (const [key, value] of Object.entries(c)) assert.equal(value, 0, `${key}가 0이 아니다`);
  assert.deepEqual(check(""), []);
});

test("문장부호만 뺀 글자 수도 센다", () => {
  assert.equal(countText("안녕, 반가워!").charsNoMark, 5);
});

test("받침 번호를 읽는다", () => {
  assert.equal(finalOf("할"), 8); // ㄹ
  assert.equal(finalOf("하"), 0); // 받침 없음
  assert.equal(finalOf("a"), -1); // 한글 음절이 아님
});
