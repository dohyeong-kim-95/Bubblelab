import { test } from "node:test";
import assert from "node:assert/strict";
import { weatherLine, weatherLines, airLabel, DEFAULT_PLACES } from "./weather.mjs";

const forecast = (code, max, min, rain, cur = 8) => ({
  current: { temperature_2m: cur },
  daily: { time: ["2026-10-31", "2026-11-01"], weather_code: [code, 3], temperature_2m_max: [max, 10],
    temperature_2m_min: [min, 2], precipitation_probability_max: [rain, 0] },
});

test("날씨 줄: 하늘·기온·비·미세먼지, 비 30% 넘으면 우산, 나쁨이면 마스크", () => {
  assert.equal(weatherLine("청주", forecast(1, 17.4, 4.6, 10, 7.8), { current: { pm10: 25, pm2_5: 20 } }, "2026-10-31"),
    "· 청주 🌤️ 대체로 맑음, 지금 8° (낮 17° / 아침 5°) · 비 10% · 미세먼지 보통");
  assert.equal(weatherLine("용인", forecast(63, 14, 9, 70), { current: { pm10: 90, pm2_5: 10 } }, "2026-10-31"),
    "· 용인 🌧️ 비, 지금 8° (낮 14° / 아침 9°) · 비 70% · 미세먼지 나쁨 ☔ 우산 챙기승! 😷 마스크 챙기승!");
  assert.equal(weatherLine("용인", forecast(0, 20, 10, null), null, "2026-10-31"), "· 용인 ☀️ 맑음, 지금 8° (낮 20° / 아침 10°)");
  assert.equal(weatherLine("청주", forecast(0, 20, 10, 0), null, "2026-11-05"), null); // 오늘 값이 없다
  assert.equal(weatherLine("청주", { daily: { time: ["2026-10-31"], weather_code: [null], temperature_2m_max: [null] } }, null, "2026-10-31"), null); // null 을 맑음으로 읽지 않는다
});

test("미세먼지 등급: PM10·PM2.5 중 나쁜 쪽, 둘 다 없으면 null", () => {
  assert.equal(airLabel(20, 10), "좋음");
  assert.equal(airLabel(20, 40), "나쁨");
  assert.equal(airLabel(200, null), "매우 나쁨");
  assert.equal(airLabel(null, undefined), null);
});

test("날씨 가져오기: 지역마다 한 줄, 한 곳이 실패하면 그 줄만 빠지고, 다 실패하면 []", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("37.2411")) return { ok: false, status: 503 };
    if (url.includes("air-quality")) throw new Error("air down");
    return { ok: true, json: async () => forecast(2, 15, 6, 20) };
  };
  const logs = [];
  const lines = await weatherLines(DEFAULT_PLACES, "2026-10-31", { fetchImpl, log: (...x) => logs.push(x.join(" ")) });
  assert.deepEqual(lines, ["🌡️ 오늘 날씨", "· 청주 ⛅ 구름 조금, 지금 8° (낮 15° / 아침 6°) · 비 20%"]);
  assert.match(logs.join("\n"), /날씨 못 가져옴 용인 날씨 503/);
  assert.ok(urls.every((u) => u.includes("timezone=Asia%2FSeoul")));
  assert.deepEqual(await weatherLines(DEFAULT_PLACES, "2026-10-31", { fetchImpl: async () => { throw new Error("offline"); } }), []);
});
