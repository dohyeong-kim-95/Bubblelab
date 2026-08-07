// estate/index.html의 "확정월" 산술만 떼어내 검증한다. 신고 지연 구간을 가르는
// 기준이라 연/월 경계에서 조용히 틀리면 화면 전체가 한 달씩 밀린다.
// 페이지는 의존성 없는 단일 파일이라 import할 수 없어, 해당 구간만 잘라 평가한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "estate", "index.html"), "utf8");

// 잘라낼 구간의 양 끝. 이 표식이 사라지면 테스트가 즉시 실패한다(조용히 통과 X).
const FROM = "function monthsBack(n) {";
const TO = "const confirmedMonthsBack =";

function helpers(nowYm) {
  const start = HTML.indexOf(FROM);
  const end = HTML.indexOf("\n", HTML.indexOf(TO));
  assert.ok(start > 0, `index.html에서 ${FROM} 를 찾지 못했습니다`);
  assert.ok(end > start, `index.html에서 ${TO} 를 찾지 못했습니다`);
  // 구간 안의 다른 정의(median·perPy 등)는 순수 함수라 그대로 평가해도 안전하다.
  // kstNowYm은 이 구간보다 앞에 정의돼 있어 잘려 나가므로, 인자로 주입한 것이 쓰인다.
  const source = HTML.slice(start, end);
  return new Function(
    "kstNowYm",
    `${source}\nreturn { monthsBack, latestConfirmedYm, confirmedMonthsBack, PROVISIONAL_MONTHS };`,
  )(() => nowYm);
}

test("최신 확정월은 이번 달의 두 달 전이다", () => {
  const h = helpers("202608");
  assert.equal(h.PROVISIONAL_MONTHS, 2);
  assert.equal(h.latestConfirmedYm(), "202606");
});

test("연초에도 확정월이 전년도로 정확히 넘어간다", () => {
  assert.equal(helpers("202601").latestConfirmedYm(), "202511");
  assert.equal(helpers("202602").latestConfirmedYm(), "202512");
  assert.equal(helpers("202603").latestConfirmedYm(), "202601");
  assert.equal(helpers("202612").latestConfirmedYm(), "202610");
});

test("확정 구간 n개월은 확정월로 끝나고 길이가 n이다", () => {
  const h = helpers("202608");
  const six = h.confirmedMonthsBack(6);
  assert.equal(six.length, 6);
  assert.equal(six.at(-1), "202606", "잠정월(202607·202608)이 들어가면 안 된다");
  assert.deepEqual(six, ["202601", "202602", "202603", "202604", "202605", "202606"]);
});

test("확정 구간도 연 경계를 넘는다", () => {
  assert.deepEqual(helpers("202602").confirmedMonthsBack(3), ["202510", "202511", "202512"]);
});
