import test from "node:test";
import assert from "node:assert/strict";
import { buildTojeong } from "./fortune.js";
import { lunarMonthGanji, lunarMonthLength, tojeongHexagram, yearGanji } from "./tojeong.js";

// 출처에 실린 풀이 예시를 중간값까지 그대로 재현한다(util/README.md 토정비결 참고).
test("풀이 예시 세 개를 태세·월건·일진수까지 재현한다", () => {
  const cases = [
    [{ year: 1972, month: 3, day: 5 }, 2016, "851", [19, 11, 14]],   // sajuplus 작괘 예시
    [{ year: 1976, month: 8, day: 26 }, 2005, "212", [20, 14, 18]],  // chunun
    [{ year: 1952, month: 1, day: 7 }, 2018, "531", [18, 16, 18]],   // 한겨레:온
  ];
  for (const [birth, year, code, numbers] of cases) {
    const r = tojeongHexagram(birth, year);
    assert.equal(r.code, code);
    assert.deepEqual([r.work.taesae.value, r.work.wolgeon.value, r.work.iljin.value], numbers);
    assert.deepEqual(r.assumptions, []);
  }
});

test("월간지는 음력 달 번호로, 정월은 오호둔으로 시작한다", () => {
  assert.deepEqual(yearGanji(2017), { stem: "정", branch: "유" });
  assert.deepEqual(lunarMonthGanji(2017, 1), { stem: "임", branch: "인" });
  assert.deepEqual(lunarMonthGanji(2017, 2), { stem: "계", branch: "묘" });
  assert.deepEqual(lunarMonthGanji(2024, 1), { stem: "병", branch: "인" });   // 갑년 → 병인
  assert.equal(lunarMonthLength(2017, 1), 29);   // KASI: 2017 정월 29일, 2월 30일
  assert.equal(lunarMonthLength(2017, 2), 30);
});

test("세는나이는 음력 출생년으로 센다", () => {
  assert.equal(tojeongHexagram({ year: 1990, month: 12, day: 1 }, 2026).age, 37);
  assert.throws(() => tojeongHexagram({ year: 2027, month: 1, day: 1 }, 2026), /태어나기 전/);
});

test("당년 그 달에 없는 30일은 말일 일진으로 보고 그렇게 했다고 남긴다", () => {
  const r = tojeongHexagram({ year: 1990, month: 2, day: 30 }, 2026);   // 2026 음력 2월은 29일
  assert.deepEqual(r.assumptions, ["missingDay"]);
  assert.equal(r.work.wolgeon.monthLength, 29);
  // 하괘에는 생일 숫자 30을 그대로 더한다.
  assert.equal(r.lower, ((30 + r.work.iljin.value) % 3) || 3);
});

test("윤달생은 평달로 계산하고 표시한다", () => {
  const leap = tojeongHexagram({ year: 2023, month: 2, day: 10, leap: true }, 2026);
  const plain = tojeongHexagram({ year: 2023, month: 2, day: 10 }, 2026);
  assert.equal(leap.code, plain.code);
  assert.deepEqual(leap.assumptions, ["leapBirth"]);
});

test("144괘가 모두 나올 수 있고 범위를 벗어나지 않는다", () => {
  const seen = new Set();
  for (let birthYear = 1950; birthYear < 2000; birthYear += 1) {
    for (let month = 1; month <= 12; month += 1) {
      for (const day of [1, 9, 17, 26]) {
        const r = tojeongHexagram({ year: birthYear, month, day }, 2026);
        assert.ok(r.upper >= 1 && r.upper <= 8 && r.middle >= 1 && r.middle <= 6 && r.lower >= 1 && r.lower <= 3);
        seen.add(r.code);
      }
    }
  }
  for (const year of [2025, 2027, 2028]) {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= 29; day += 1) seen.add(tojeongHexagram({ year: 1980, month, day }, year).code);
    }
  }
  assert.equal(seen.size, 144);
});

test("양력 입력은 음력으로 바꿔 올해·내년 괘를 낸다", () => {
  // 양력 1991-01-05 = 음력 1990-11-20
  const list = buildTojeong({ calendar: "solar", solar: { year: 1991, month: 1, day: 5 } },
    { year: 2026, month: 9, day: 29 });
  assert.deepEqual(list.map((t) => [t.year, t.age]), [[2026, 37], [2027, 38]]);
  assert.deepEqual(list[0].lunarBirth, { year: 1990, month: 11, day: 20, leap: false });
  // 설 전이면 음력으로는 아직 지난해다.
  const early = buildTojeong({ calendar: "solar", solar: { year: 1991, month: 1, day: 5 } },
    { year: 2026, month: 1, day: 10 });
  assert.equal(early[0].year, 2025);
});

// 본문(util/fortune/tojeong/*.json)은 _infra/tojeong-import.mjs 가 쓴다. 손으로 고치면
// 여기서 모양이 어긋난 것을 잡는다.
test("본문 144괘가 모두 있고 총론 9구·달마다 3구에 번역이 붙어 있다", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../util/fortune/tojeong/", import.meta.url);
  const codes = readdirSync(dir).filter((f) => /^\d{3}\.json$/.test(f)).map((f) => f.slice(0, 3)).sort();
  const expected = [];
  for (let u = 1; u <= 8; u += 1) for (let m = 1; m <= 6; m += 1) for (let l = 1; l <= 3; l += 1) expected.push(`${u}${m}${l}`);
  assert.deepEqual(codes, expected);
  for (const code of codes) {
    const data = JSON.parse(readFileSync(new URL(`${code}.json`, dir), "utf8"));
    assert.equal(data.code, code);
    assert.ok(data.title.hanja && data.title.ko, `${code} 괘명`);
    assert.equal(data.summary.length, 9, `${code} 총론`);
    assert.equal(data.months.length, 12, `${code} 달 수`);
    for (const line of [...data.summary, ...data.months.flat()]) {
      assert.ok(line.hanja && line.reading && line.ko, `${code} ${line.hanja}`);
    }
    for (const month of data.months) assert.equal(month.length, 3, `${code} 달마다 3구`);
  }
  const sources = JSON.parse(readFileSync(new URL("sources.json", dir), "utf8"));
  assert.ok(sources.credit, "출처 문구");
  assert.equal(sources.lines, 144 * (9 + 36));
});
