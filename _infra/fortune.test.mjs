import test from "node:test";
import assert from "node:assert/strict";
import { buildChart, buildDailyFortune, FortuneDO, handleFortuneChart, selectLunarConversion } from "./fortune.js";
import { b64uEncode, generateVapidKeys } from "./webpush.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) {
    const value = this.data.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix = "" } = {}) {
    return new Map([...this.data.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}

const pushReq = (method, body) => new Request("https://fortune.internal/push", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

// 복호화 가능한(유효한 P-256) 구독 키를 생성한다.
async function fakeSubscription(endpoint) {
  const uaPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const p256dh = b64uEncode(new Uint8Array(await crypto.subtle.exportKey("raw", uaPair.publicKey)));
  const auth = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { endpoint, keys: { p256dh, auth } };
}

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
    { date: "2026-07-15", iljin: "경인", tenGod: "정인", method: "natal-daymaster+daily-pillar-v3" },
  );
  assert.match(daily.text, /배우고 도움받는 흐름/);
  const levels = Object.fromEntries(Object.entries(daily.categories).map(([key, value]) => [key, value.level]));
  // 재물·직업·연애는 v2 판정 그대로여야 한다(가중치를 옮기지 않았다).
  assert.deepEqual({ wealth: levels.wealth, career: levels.career, love: levels.love },
    { wealth: "무난", career: "원활", love: "무난" });
  assert.deepEqual(Object.keys(daily.categories), ["wealth", "career", "love", "health", "social", "study"]);
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

test("stores and removes an anonymous push subscription", async () => {
  const storage = new MemoryStorage();
  const fortune = new FortuneDO({ storage }, {});
  const sub = await fakeSubscription("https://push.example.com/a");

  const ok = await fortune.fetch(pushReq("POST", { subscription: sub }));
  assert.equal(ok.status, 200);
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);

  // 같은 endpoint 재구독은 중복을 만들지 않는다
  await fortune.fetch(pushReq("POST", { subscription: sub }));
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);

  const gone = await fortune.fetch(pushReq("DELETE", { endpoint: sub.endpoint }));
  assert.equal(gone.status, 200);
  assert.equal((await storage.list({ prefix: "push:" })).size, 0);
});

test("rejects an invalid subscription", async () => {
  const storage = new MemoryStorage();
  const fortune = new FortuneDO({ storage }, {});
  const bad = await fortune.fetch(pushReq("POST", { subscription: { endpoint: "http://insecure", keys: {} } }));
  assert.equal(bad.status, 400);
  assert.equal((await storage.list({ prefix: "push:" })).size, 0);
});

test("notifyDaily sends to every subscriber and prunes expired ones", async () => {
  const storage = new MemoryStorage();
  const vapid = await generateVapidKeys();
  const fortune = new FortuneDO({ storage }, {
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://util.bubblelab.dev",
  });
  await fortune.fetch(pushReq("POST", { subscription: await fakeSubscription("https://push.example.com/live") }));
  await fortune.fetch(pushReq("POST", { subscription: await fakeSubscription("https://push.example.com/expired") }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint) => new Response(null, {
    status: String(endpoint).endsWith("/expired") ? 410 : 201,
  });
  try {
    const response = await fortune.fetch(new Request("https://fortune.internal/notify", { method: "POST" }));
    const data = await response.json();
    assert.equal(data.sent, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  // 410(만료) 구독은 정리되고 살아있는 구독만 남는다
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);
});

test("notifyDaily is a no-op without VAPID configuration", async () => {
  const storage = new MemoryStorage();
  const fortune = new FortuneDO({ storage }, {});
  const response = await fortune.fetch(new Request("https://fortune.internal/notify", { method: "POST" }));
  assert.deepEqual(await response.json(), { sent: 0 });
});

// ── v3: 풀이 문장은 근거 조각을 골라 잇는다 — 문장보다 "어떤 조각이 골라졌나"를 고정한다.
const natal = () => buildChart({ year: 1992, month: 10, day: 24, timeMode: "clock", time: "05:30" }).candidates[0];

test("daily v3: 오늘 십성과 합충이 본문 조각을 고르고, 해요체 문단이 된다", () => {
  const daily = buildDailyFortune(natal(), { year: 2026, month: 7, day: 15 });
  assert.equal(daily.picks[0], "god:정인");
  assert.match(daily.text, /경인\(庚寅\)일이에요/);
  assert.match(daily.text, /정인\(나를 돕고 가르치는 기운\)이라서/);
  assert.doesNotMatch(daily.text, /니다\./, "해요체로 통일");
  for (const category of Object.values(daily.categories)) {
    assert.doesNotMatch(category.comment, /니다\./);
    assert.ok(category.comment.length > 20);
  }
});

test("daily v3: 학업은 정인 날 원활, 근거에 god:정인 이 잡힌다", () => {
  const daily = buildDailyFortune(natal(), { year: 2026, month: 7, day: 15 });
  assert.equal(daily.categories.study.level, "원활");
  assert.ok(daily.categories.study.reasons.includes("god:정인"));
  assert.match(daily.categories.study.comment, /^오늘 들어온 정인/);
});

test("daily v3: 근거가 엇갈리면 무난이고 두 신호를 함께 밝힌다", () => {
  // 계유 일주, 2026-07-15 경인일: 정인(+1)이지만 일지 유와 인이 원진, 명식 신과 인이 충.
  const daily = buildDailyFortune(natal(), { year: 2026, month: 7, day: 15 });
  const social = daily.categories.social;
  assert.ok(social.reasons.includes("natal:충") && social.reasons.includes("day:원진"));
  assert.notEqual(social.level, "원활");
});

test("daily v3: 행운 표시는 가장 모자란 오행에서, 숫자는 일간 음양으로 고른다", () => {
  const daily = buildDailyFortune(natal(), { year: 2026, month: 7, day: 15 });
  // 명식 목2 화0 토1 금3 수2 + 경인(금·목) → 화가 0으로 가장 모자라다.
  assert.equal(daily.lucky.element, "화");
  assert.equal(daily.lucky.direction, "남쪽");
  assert.equal(daily.lucky.number, 2, "경(양간) 날은 하도 생수");
});

test("daily v3: 조심할 시간은 일진 지지와 충하는 시진, 좋은 시간은 일지와 육합하는 시진", () => {
  const daily = buildDailyFortune(natal(), { year: 2026, month: 7, day: 15 });
  assert.equal(daily.times.caution.branch, "신");   // 인 ↔ 신 충
  assert.equal(daily.times.good.branch, "진");      // 유 ↔ 진 육합
  assert.match(daily.times.caution.text, /^신시\(15~17시\)는/);
});

test("chart: 후보마다 풀이가 붙고, partner 가 오면 궁합과 상대 팔자만 싣는다", async () => {
  const body = {
    year: 1992, month: 10, day: 24, timeMode: "clock", time: "05:30", gender: "male",
    partner: { year: 1988, month: 8, day: 17, timeMode: "branch", branch: 4, gender: "female" },
  };
  const response = await handleFortuneChart(new Request("https://util.bubblelab.dev/_fortune/chart", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), {});
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.readingRules.version, "saju-reading-kr-v1");
  assert.ok(data.candidates[0].reading.overview.paragraph.startsWith("계수(癸水) 일간이라"));
  assert.ok(data.compatibility.score >= 30 && data.compatibility.score <= 98);
  assert.equal(data.partner.pillars.day.korean.length, 2);
  assert.deepEqual(data.partner.solarDate, { year: 1988, month: 8, day: 17 });
  assert.equal(data.partner.name, undefined, "이름 같은 부가 정보는 응답에 싣지 않는다");
  assert.equal(data.dailyFortunes[0].method, "natal-daymaster+daily-pillar-v3");
});

test("headline: brief 용 한 문장 — 해요체, 40자 안팎, 합·충에 따라 꼬리가 갈린다", async () => {
  const { dailyHeadline } = await import("./fortune.js");
  const daily = buildDailyFortune(natal(), { year: 2026, month: 7, day: 15 });
  assert.equal(daily.headline, dailyHeadline("정인", false, true));
  assert.match(daily.headline, /이지만, 일정 변화엔 여유를 두세요\.$/);
  for (const god of ["비견", "겁재", "식신", "상관", "편재", "정재", "편관", "정관", "편인", "정인"]) {
    for (const [h, c] of [[false, false], [true, false], [false, true], [true, true]]) {
      const line = dailyHeadline(god, h, c);
      assert.match(line, /요\.$/, line);
      assert.ok(line.length >= 14 && line.length <= 48, `${line} (${line.length}자)`);
    }
  }
});
