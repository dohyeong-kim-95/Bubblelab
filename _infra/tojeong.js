// 토정비결 작괘(作卦) — 음력 생년월일과 보는 해로 144괘 중 하나를 고른다.
//
//   세는나이 = 당년 − 음력 출생년 + 1
//   상괘 = (세는나이 + 태세수) mod 8          0 → 8
//   중괘 = (당년 생월 날수 30|29 + 월건수) mod 6   0 → 6
//   하괘 = (음력 생일 + 일진수) mod 3          0 → 3
//
// 연·월·일 간지는 모두 **보는 해(당년)** 의 것이다. 세 수는 서로 다른 수표를 쓴다 —
// 태세 = 중천수+중천수, 월건 = 선천수+선천수, 일진 = 선천수(간)+중천수(지). 출처와 풀이
// 예시 대조는 util/README.md. 월간지는 절기가 아니라 음력 달 번호로 붙인다.
//
// 전통 출처가 규칙을 두지 않은 두 경우는 기본값으로 계산하고 `assumptions` 에 적어
// 화면이 밝힌다: 윤달생은 평달로, 당년 그 달에 없는 30일은 그달 말일의 일진으로.
import manseryeok from "manseryeok";

const { calculateFourPillars, lunarToSolar } = manseryeok;

const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];

const PRENATAL_STEM = { 갑: 9, 기: 9, 을: 8, 경: 8, 병: 7, 신: 7, 정: 6, 임: 6, 무: 5, 계: 5 };
const PRENATAL_BRANCH = { 자: 9, 오: 9, 축: 8, 미: 8, 인: 7, 신: 7, 묘: 6, 유: 6, 진: 5, 술: 5, 사: 4, 해: 4 };
const MIDDLE_STEM = { 갑: 11, 기: 11, 을: 10, 경: 10, 병: 9, 신: 9, 정: 8, 임: 8, 무: 7, 계: 7 };
const MIDDLE_BRANCH = { 진: 11, 술: 11, 축: 11, 미: 11, 신: 10, 유: 10, 해: 9, 자: 9, 인: 8, 묘: 8, 사: 7, 오: 7 };

export const TOJEONG_RULES = {
  version: "tojeong-v1",
  age: "세는나이(음력 출생년 기준)",
  numbers: "태세 중천수+중천수 · 월건 선천수+선천수 · 일진 선천수+중천수",
  monthPillar: "음력 달 번호(정월 = 인월)",
  leapBirth: "윤달생은 평달로 본다",
  missingDay: "당년 그 달에 없는 30일은 말일(29일)의 일진을 쓴다",
};

function mod(value, n) {
  const r = value % n;
  return r === 0 ? n : r;
}

export function yearGanji(year) {
  return { stem: STEMS[((year - 4) % 10 + 10) % 10], branch: BRANCHES[((year - 4) % 12 + 12) % 12] };
}

// 음력 n월(평달)의 월간지. 정월은 인월이고, 월간은 연간에서 오호둔(五虎遁)으로 시작한다.
export function lunarMonthGanji(year, month) {
  const yearStem = STEMS.indexOf(yearGanji(year).stem);
  const firstStem = ((yearStem % 5) * 2 + 2) % 10;
  return { stem: STEMS[(firstStem + month - 1) % 10], branch: BRANCHES[(2 + month - 1) % 12] };
}

export function lunarMonthLength(year, month) {
  try {
    lunarToSolar(year, month, 30, false);
    return 30;
  } catch {
    return 29;
  }
}

function dayGanjiOfLunar(year, month, day) {
  const solar = lunarToSolar(year, month, day, false);
  const r = calculateFourPillars({ ...solar, hour: 12, minute: 0 });
  return { stem: r.day.heavenlyStem, branch: r.day.earthlyBranch, solar };
}

const ganjiText = (g) => g.stem + g.branch;

/**
 * @param {{year:number, month:number, day:number, leap?:boolean}} lunarBirth 음력 생년월일
 * @param {number} targetYear 보는 해(음력 연도)
 */
export function tojeongHexagram(lunarBirth, targetYear) {
  const assumptions = [];
  if (lunarBirth.leap) assumptions.push("leapBirth");

  const age = targetYear - lunarBirth.year + 1;
  if (age < 1) throw new RangeError("태어나기 전 해의 토정비결은 볼 수 없습니다.");

  const taesaeGanji = yearGanji(targetYear);
  const taesae = MIDDLE_STEM[taesaeGanji.stem] + MIDDLE_BRANCH[taesaeGanji.branch];

  const monthLength = lunarMonthLength(targetYear, lunarBirth.month);
  const wolgeonGanji = lunarMonthGanji(targetYear, lunarBirth.month);
  const wolgeon = PRENATAL_STEM[wolgeonGanji.stem] + PRENATAL_BRANCH[wolgeonGanji.branch];

  let ganjiDay = lunarBirth.day;
  if (ganjiDay > monthLength) {
    ganjiDay = monthLength;
    assumptions.push("missingDay");
  }
  const iljinGanji = dayGanjiOfLunar(targetYear, lunarBirth.month, ganjiDay);
  const iljin = PRENATAL_STEM[iljinGanji.stem] + MIDDLE_BRANCH[iljinGanji.branch];

  const upper = mod(age + taesae, 8);
  const middle = mod(monthLength + wolgeon, 6);
  const lower = mod(lunarBirth.day + iljin, 3);
  return {
    code: `${upper}${middle}${lower}`,
    upper, middle, lower,
    year: targetYear,
    age,
    lunarBirth: { year: lunarBirth.year, month: lunarBirth.month, day: lunarBirth.day, leap: !!lunarBirth.leap },
    work: {
      taesae: { ganji: ganjiText(taesaeGanji), value: taesae },
      wolgeon: { ganji: ganjiText(wolgeonGanji), value: wolgeon, monthLength },
      iljin: { ganji: ganjiText(iljinGanji), value: iljin, solarDate: iljinGanji.solar },
    },
    assumptions,
    rules: TOJEONG_RULES,
  };
}
