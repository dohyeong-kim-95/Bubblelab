import test from "node:test";
import assert from "node:assert/strict";
import { buildChart, buildDailyFortune, handleFortuneChart, selectLunarConversion } from "./fortune.js";

test("calculates a known four-pillars example at an exact KST time", () => {
  const chart = buildChart({
    year: 1992, month: 10, day: 24,
    timeMode: "clock", time: "05:30",
  });
  assert.equal(chart.ambiguous, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(chart.candidates[0].pillars).map(([key, value]) => [key, value?.korean])),
    { year: "임신", month: "경술", day: "계유", hour: "을묘" },
  );
});

test("uses a selected two-hour branch without inventing an exact saved time", () => {
  const chart = buildChart({
    year: 1992, month: 10, day: 24,
    timeMode: "branch", branch: 3,
  });
  assert.equal(chart.ambiguous, false);
  assert.equal(chart.candidates[0].pillars.hour.korean, "을묘");
  assert.equal(chart.candidates[0].timeLabel, "묘시 시작 기준");
});

test("omits the hour pillar when birth time is unknown", () => {
  const chart = buildChart({
    year: 1992, month: 10, day: 24,
    timeMode: "branch", branch: null,
  });
  assert.equal(chart.candidates[0].pillars.hour, null);
  assert.equal(chart.candidates[0].pillars.day.korean, "계유");
});

test("returns both charts when a selected shichen contains an exact solar-term boundary", () => {
  // 2024 입춘은 KST 2월 4일 17:27로 유시(17~19시) 안에 있다.
  const chart = buildChart({
    year: 2024, month: 2, day: 4,
    timeMode: "branch", branch: 9,
  });
  assert.equal(chart.ambiguous, true);
  assert.equal(chart.candidates.length, 2);
  assert.deepEqual(
    chart.candidates.map((candidate) => candidate.pillars.year.korean),
    ["계묘", "갑진"],
  );
});

test("rejects impossible dates and malformed times", () => {
  assert.throws(() => buildChart({
    year: 2026, month: 2, day: 30, timeMode: "clock", time: "12:00",
  }), /실재하지 않는/);
  assert.throws(() => buildChart({
    year: 2026, month: 2, day: 10, timeMode: "clock", time: "25:00",
  }), /올바르지/);
});

test("builds a deterministic daily fortune from the natal chart and KST date", () => {
  const chart = buildChart({
    year: 1992, month: 10, day: 24,
    timeMode: "clock", time: "05:30",
  });
  const daily = buildDailyFortune(chart.candidates[0], { year: 2026, month: 7, day: 15 });
  assert.deepEqual(
    { date: daily.date, iljin: daily.iljin, tenGod: daily.tenGod, method: daily.method },
    { date: "2026-07-15", iljin: "경인", tenGod: "정인", method: "natal-daymaster+daily-pillar-v1" },
  );
  assert.match(daily.text, /배우고 도움받는 흐름/);
  assert.deepEqual(
    Object.fromEntries(Object.entries(daily.categories).map(([key, value]) => [key, value.level])),
    { wealth: "무난", career: "원활", love: "무난" },
  );
});

test("uses selected gender only as a supporting traditional spouse-star signal", () => {
  const candidate = buildChart({
    year: 1992, month: 10, day: 24,
    timeMode: "clock", time: "05:30",
  }).candidates[0];
  const date = { year: 2026, month: 7, day: 1 };
  assert.equal(buildDailyFortune(candidate, date).categories.love.level, "무난");
  assert.equal(buildDailyFortune(candidate, date, "male").categories.love.level, "원활");
  assert.equal(buildDailyFortune(candidate, date, "female").categories.love.level, "무난");
});

test("selects the requested normal or leap lunar date from KASI XML", () => {
  const xml = `<response><header><resultCode>00</resultCode></header><body><items>
    <item><lunYear>2023</lunYear><lunMonth>02</lunMonth><lunDay>01</lunDay><lunLeapmonth>평</lunLeapmonth><solYear>2023</solYear><solMonth>02</solMonth><solDay>20</solDay></item>
    <item><lunYear>2023</lunYear><lunMonth>02</lunMonth><lunDay>01</lunDay><lunLeapmonth>윤</lunLeapmonth><solYear>2023</solYear><solMonth>03</solMonth><solDay>22</solDay></item>
  </items></body></response>`;
  assert.deepEqual(selectLunarConversion(xml, { year: 2023, month: 2, day: 1, leap: false }),
    { year: 2023, month: 2, day: 20 });
  assert.deepEqual(selectLunarConversion(xml, { year: 2023, month: 2, day: 1, leap: true }),
    { year: 2023, month: 3, day: 22 });
  assert.equal(selectLunarConversion(xml, { year: 2023, month: 3, day: 1, leap: true }), null);
});

test("converts a lunar birth date before building the chart", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("getSolCalInfo")) return new Response(
      `<response><header><resultCode>00</resultCode></header><body><items><item>
        <lunYear>2015</lunYear><lunMonth>01</lunMonth><lunDay>01</lunDay><lunLeapmonth>평</lunLeapmonth>
        <solYear>2015</solYear><solMonth>02</solMonth><solDay>19</solDay>
      </item></items></body></response>`,
    );
    return new Response(`<response><header><resultCode>99</resultCode></header></response>`);
  };
  try {
    const request = new Request("https://example.test/_fortune/chart", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: 2015, month: 1, day: 1, calendar: "lunar", lunarLeap: false,
        timeMode: "clock", time: "12:00",
      }),
    });
    const response = await handleFortuneChart(request, { KASI_SERVICE_KEY: "test-key" });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(data.solarDate, { year: 2015, month: 2, day: 19 });
    assert.equal(data.inputCalendar, "lunar");
    assert.equal(data.inputDate.leap, false);
    assert.equal(data.birthDate, "2015-02-19");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
