import test from "node:test";
import assert from "node:assert/strict";
import { buildChart } from "./fortune.js";
import { hiddenStems, twelveShinsal, twelveStage, yearPillar } from "./saju-detail.js";

// 1992-10-24 05:30 KST = 임신·경술·계유·을묘 (fortune.test.mjs 와 같은 예)
const TODAY = { year: 2026, month: 9, day: 28 };
const chart = (gender) => buildChart({
  year: 1992, month: 10, day: 24, timeMode: "clock", time: "05:30", gender,
}, TODAY);

test("12운성: 양간은 순행, 음간은 역행, 무·기는 병·정을 따른다", () => {
  assert.deepEqual(["해", "자", "축", "인", "묘"].map((b) => twelveStage("갑", b)),
    ["장생", "목욕", "관대", "건록", "제왕"]);
  assert.deepEqual(["오", "사", "진", "묘", "인"].map((b) => twelveStage("을", b)),
    ["장생", "목욕", "관대", "건록", "제왕"]);
  assert.equal(twelveStage("무", "사"), twelveStage("병", "사"));
  assert.equal(twelveStage("기", "유"), "장생");
});

test("12신살: 삼합 생지가 지살, 도화(년살)·역마·화개가 정통 자리에 온다", () => {
  for (const [base, dohwa, yeokma, hwagae] of [
    ["인", "묘", "신", "술"], ["신", "유", "인", "진"], ["사", "오", "해", "축"], ["해", "자", "사", "미"],
  ]) {
    assert.equal(twelveShinsal(base, base), "지살");
    assert.equal(twelveShinsal(base, dohwa), "년살");
    assert.equal(twelveShinsal(base, yeokma), "역마살");
    assert.equal(twelveShinsal(base, hwagae), "화개살");
  }
  assert.equal(twelveShinsal("오", "해"), "겁살");
});

test("지장간은 여기·중기·본기 순이고 본기가 지지 오행과 같다", () => {
  assert.deepEqual(hiddenStems("인").map((h) => h.stem), ["무", "병", "갑"]);
  assert.deepEqual(hiddenStems("자").map((h) => h.stem), ["임", "계"]);
});

test("원국 명식에 신살·12운성·오행 분포가 붙는다", () => {
  const detail = chart().candidates[0].detail;
  assert.equal(detail.rules.version, "shinsal-kr-v1");
  assert.deepEqual(detail.elements, { 목: 2, 화: 0, 토: 1, 금: 3, 수: 2 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(detail.pillars).map(([k, p]) => [k, p.stage])),
    { year: "사", month: "쇠", day: "병", hour: "장생" },
  );
  const names = Object.fromEntries(detail.shinsal.map((s) => [s.name, s.pillars]));
  assert.deepEqual(names.천을귀인, ["hour"]);      // 계 → 사·묘
  assert.deepEqual(names.문창귀인, ["hour"]);      // 계 → 묘
  assert.deepEqual(names.홍염살, ["year"]);        // 계 → 신
  assert.deepEqual(names.공망, ["month"]);         // 계유 → 술·해 공망
  assert.deepEqual(names.귀문관살, ["year", "hour"]); // 묘신
  assert.deepEqual(names.도화살, ["day"]);         // 신자진 → 유
  assert.equal(names.백호살, undefined);
});

test("대운은 성별이 있을 때만, 현재 대운을 정밀 시작일로 고른다", () => {
  assert.equal(chart().candidates[0].detail.luck, null);
  const luck = chart("male").candidates[0].detail.luck;
  assert.equal(luck.forward, true);                // 임(양)년 남자 → 순행
  assert.equal(luck.pillars[0].ganji, "신해");     // 경술 다음
  assert.equal(luck.pillars[luck.current].ganji, "계축");
});

test("세운은 입춘 뒤 간지로 잡는다", () => {
  assert.equal(yearPillar(2026).ganji, "병오");
  const annual = chart().candidates[0].detail.annual;
  assert.deepEqual([annual.ganji, annual.tenGod, annual.stage], ["병오", "정재", "절"]);
});
