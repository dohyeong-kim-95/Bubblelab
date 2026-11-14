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
    { date: "2026-07-15", iljin: "경인", tenGod: "정인", method: "natal-daymaster+daily-pillar-v6" },
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
  assert.match(daily.categories.study.comment, /^오늘은 정인 기운이 함께해서/);
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
  assert.equal(data.readingRules.version, "saju-reading-kr-v3");
  assert.ok(data.candidates[0].reading.overview.paragraph.startsWith("계수(癸水) 일간이라"));
  assert.ok(data.compatibility.score >= 30 && data.compatibility.score <= 98);
  assert.equal(data.partner.pillars.day.korean.length, 2);
  assert.deepEqual(data.partner.solarDate, { year: 1988, month: 8, day: 17 });
  assert.equal(data.partner.name, undefined, "이름 같은 부가 정보는 응답에 싣지 않는다");
  assert.equal(data.dailyFortunes[0].method, "natal-daymaster+daily-pillar-v6");
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

// ── 심사 루프(_src/util-fortune-review)에서 나온 대표 실패 유형을 고정한다 ──────────
const everyDay = (fn) => {
  const c = natal();
  for (let i = 0; i < 60; i += 1) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    fn(buildDailyFortune(c, { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, "male"));
  }
};

test("회귀: 분야 근거 절이 여섯 번 똑같이 반복되지 않는다(십성 괄호 풀이는 총평에서만)", () => {
  everyDay((daily) => {
    const leads = Object.values(daily.categories).map((c) => c.comment.split(/서 |서, /)[0]);
    const godLeads = leads.filter((l) => l.includes(daily.tenGod));
    assert.ok(new Set(godLeads).size === godLeads.length || godLeads.length <= 1, godLeads.join(" / "));
    for (const c of Object.values(daily.categories)) assert.doesNotMatch(c.comment, /\(나를|\(내가|\(크게|\(차곡/, "분야 문장에 십성 괄호 풀이");
  });
});

test("회귀: 괄호가 겹치지 않는다 — '일지(…) 충' 같은 라벨 금지", () => {
  everyDay((daily) => {
    for (const c of Object.values(daily.categories)) assert.doesNotMatch(c.comment, /\([^)]*\([^)]*\)[^)]*\)/, c.comment);
  });
});

test("회귀: 근거 하나뿐인 무난은 '조금 ~지만'으로 받는다(근거와 결론이 어긋나지 않게)", () => {
  everyDay((daily) => {
    for (const c of Object.values(daily.categories)) {
      if (c.level === "무난" && /^(오늘 |일진이 |\S+의 기운이 도는)/.test(c.comment) && !c.comment.startsWith("오늘 지지가")) {
        assert.match(c.comment, /(조금 힘이 실리고|살짝 보탬이 되고|한결 수월해지고|조금 신경 쓰일 수 있지만|살짝 걸리는 데가 있지만|조금 거슬릴 수 있지만),/, c.comment);
      }
    }
  });
});

test("회귀: 같은 시진을 좋은 때·조심할 때로 동시에 말하지 않는다", () => {
  everyDay((daily) => assert.notEqual(daily.times.good.branch, daily.times.caution.branch, daily.date));
});

test("회귀: 숫자 조사(8이·2가)와 접속어 반복", async () => {
  const { dailyHeadline } = await import("./fortune.js");
  everyDay((daily) => {
    assert.doesNotMatch(daily.lucky.text, /[013678]가 오늘|[2459]이 오늘/, daily.lucky.text);
    assert.doesNotMatch(daily.text, /다만[^.]*\. 다만/, "다만 연달아");
  });
  for (const god of ["겁재", "상관", "편관"]) {
    assert.doesNotMatch(dailyHeadline(god, false, true), /지만.*지만/, "한 줄에 '지만' 두 번");
  }
});

test("회귀(3차): 분야 근거 절에서 '기운'·'의 기운의'·화개 문구가 겹치지 않는다", () => {
  everyDay((daily) => {
    for (const c of Object.values(daily.categories)) {
      assert.doesNotMatch(c.comment, /기운이 도는 날이라서 기운이|기운이 함께해서 기운이|의 기운의/, c.comment);
      if (daily.text.includes("화개(")) assert.doesNotMatch(c.comment, /화개\(/, "총평에서 이미 화개를 풀었다");
    }
  });
});

test("회귀(4차): 근거 없는 분야의 첫머리가 비문이 아니다('이 분야로는 …' 금지)", () => {
  everyDay((daily) => {
    for (const c of Object.values(daily.categories)) assert.doesNotMatch(c.comment, /^이 분야로는/, c.comment);
  });
});

// ── 만화 사주 선착순 신청 ───────────────────────────────────────────
// 워커 → FortuneDO 를 메모리 저장소 하나로 잇는다(실제 바인딩 대신).
async function comicEnv(extra = {}) {
  const { handleFortuneComic } = await import("./fortune.js");
  const storage = new MemoryStorage();
  const env = { COMIC_SINK_SECRET: "sink-secret", ...extra };
  const fortune = new FortuneDO({ storage }, env);
  const stub = { fetch: (input, init) => fortune.fetch(new Request(input, init)) };
  env.FORTUNE = { idFromName: () => "global", get: () => stub };
  const call = (method, path, body, headers = {}) => {
    const url = new URL(`https://util.bubblelab.dev${path}`);
    return handleFortuneComic(new Request(url, {
      method, headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, url);
  };
  return { storage, call };
}
const comicBody = (email, extra = {}) => ({
  email, birth: { y: 1992, m: 8, d: 20, h: 5 }, gender: "male", consent: true, ...extra,
});
const AUTH = { Authorization: "Bearer sink-secret" };

test("만화 사주: 선착순 10명까지만 받고 11번째부터는 full", async () => {
  const { call } = await comicEnv();
  for (let i = 1; i <= 10; i++) {
    const res = await call("POST", "/_fortune/comic-request", comicBody(`p${i}@example.com`));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, remaining: 10 - i });
  }
  const full = await call("POST", "/_fortune/comic-request", comicBody("late@example.com"));
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error, "full");
  assert.deepEqual(await (await call("GET", "/_fortune/comic-request/status")).json(), { open: false, remaining: 0 });
});

test("만화 사주: 같은 메일은 dup, 대소문자·공백이 달라도 같은 메일", async () => {
  const { call } = await comicEnv();
  assert.equal((await call("POST", "/_fortune/comic-request", comicBody("me@example.com"))).status, 200);
  const dup = await call("POST", "/_fortune/comic-request", comicBody("  ME@Example.com "));
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).error, "dup");
});

test("만화 사주: 동의·메일·생년월일이 없거나 틀리면 거절, 숨은 칸이 차 있으면 저장하지 않는다", async () => {
  const { call, storage } = await comicEnv();
  const cases = [
    [comicBody("a@example.com", { consent: undefined }), "consent"],
    [comicBody("a@example.com", { consent: "true" }), "consent"],
    [comicBody("not-an-email"), "email"],
    [comicBody(`${"x".repeat(250)}@example.com`), "email"],
    [comicBody("a@example.com", { birth: { y: 1992, m: 2, d: 30 } }), "birth"],
    [comicBody("a@example.com", { birth: { y: 1800, m: 1, d: 1 } }), "birth"],
    [comicBody("a@example.com", { birth: { y: 1992, m: 1, d: 1, h: 12 } }), "birth"],
  ];
  for (const [body, error] of cases) {
    const res = await call("POST", "/_fortune/comic-request", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).error, error);
  }
  const bot = await call("POST", "/_fortune/comic-request", comicBody("bot@example.com", { website: "http://spam" }));
  assert.equal(bot.status, 200);
  assert.equal((await storage.list({ prefix: "comic:" })).size, 0, "봇 신청이 저장됐다");
});

test("만화 사주: 목록·완료는 시크릿 없이 못 쓰고, 상태에는 개인정보가 없다", async () => {
  const { call } = await comicEnv();
  await call("POST", "/_fortune/comic-request", comicBody("me@example.com"));
  assert.equal((await call("GET", "/_fortune/comic-requests")).status, 401);
  assert.equal((await call("GET", "/_fortune/comic-requests", undefined, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await call("POST", "/_fortune/comic-requests/0123456789abcdef/done")).status, 401);
  const status = await (await call("GET", "/_fortune/comic-request/status")).text();
  assert.deepEqual(JSON.parse(status), { open: true, remaining: 9 });
  assert.doesNotMatch(status, /example|1992|male/);
  // 시크릿이 설정되지 않은 배포에서는 목록 자체가 닫힌다
  const closed = await comicEnv({ COMIC_SINK_SECRET: undefined });
  assert.equal((await closed.call("GET", "/_fortune/comic-requests", undefined, AUTH)).status, 503);
});

test("만화 사주: done 하면 메일·생년월일이 지워지고 받은 수만 남는다(자리는 다시 나지 않는다)", async () => {
  const { call, storage } = await comicEnv();
  await call("POST", "/_fortune/comic-request", comicBody("me@example.com"));
  await call("POST", "/_fortune/comic-request", comicBody("you@example.com"));
  const list = await (await call("GET", "/_fortune/comic-requests", undefined, AUTH)).json();
  assert.equal(list.requests.length, 2);
  const mine = list.requests.find((r) => r.email === "me@example.com");
  assert.deepEqual(Object.keys(mine).sort(), ["birth", "created", "email", "gender", "id"]);
  assert.deepEqual(mine.birth, { y: 1992, m: 8, d: 20, h: 5, calendar: "solar", lunarLeap: false });
  const done = await call("POST", `/_fortune/comic-requests/${mine.id}/done`, undefined, AUTH);
  assert.equal(done.status, 200);
  const dump = JSON.stringify([...(await storage.list({ prefix: "" })).entries()]);
  assert.doesNotMatch(dump, /me@example\.com/);
  assert.equal((await storage.get("comic:count")), 2);
  const after = await (await call("GET", "/_fortune/comic-requests", undefined, AUTH)).json();
  assert.deepEqual(after.requests.map((r) => r.email), ["you@example.com"]);
  assert.equal(after.remaining, 8);
  assert.equal((await call("POST", `/_fortune/comic-requests/${mine.id}/done`, undefined, AUTH)).status, 404);
});

// ── 운세 노트 글꼴 조각 ── 화면 문구·풀이 조각 표의 한글이 처음 받는 core 조각에 다 들어 있어야 한다.
// 빠지면 그 글자 하나 때문에 100KB 남짓한 rest 조각을 더 받는다. 문구를 바꿨으면
// `_src/util-fortune-fonts/build.py` 를 다시 돌린다.
test("운세 노트: core 글꼴 조각이 화면·조각 표의 한글을 모두 덮고, 라이선스가 함께 있다", async () => {
  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const root = new URL("../", import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), "utf8");
  const css = read("util/fortune/fonts/fonts.css");
  const rangeOf = (file) => {
    const m = new RegExp(`${file.replace(".", "\\.")}"\\) format\\("woff2"\\); font-display: swap; unicode-range: ([^;]+);`).exec(css);
    assert.ok(m, `${file} 가 fonts.css 에 없다`);
    const set = new Set();
    for (const part of m[1].split(",")) {
      const [a, b] = part.replace(/U\+/g, "").split("-").map((x) => parseInt(x, 16));
      for (let c = a; c <= (b ?? a); c++) set.add(c);
    }
    return set;
  };
  const hangul = (text) => [...new Set(text)].filter((ch) => ch >= "가" && ch <= "힣");
  const hand = rangeOf("hand-core.woff2"), body = rangeOf("body-core.woff2");
  const page = read("util/fortune/index.html") + read("util/fortune/note.js");
  assert.deepEqual(hangul(page).filter((ch) => !hand.has(ch.codePointAt(0))), [], "손글씨 core 에 없는 글자");
  const tj = readdirSync(new URL("util/fortune/tojeong/", root)).map((f) => read(`util/fortune/tojeong/${f}`)).join("");
  const all = page + read("_infra/saju-reading.js") + read("_infra/fortune.js") + read("_infra/life-curve.js") + tj;
  assert.deepEqual(hangul(all).filter((ch) => !body.has(ch.codePointAt(0))), [], "본문 core 에 없는 글자");
  for (const f of ["NanumPenScript-OFL.txt", "GowunDodum-OFL.txt", "NotoSerifKR-OFL.txt"]) {
    assert.ok(existsSync(new URL(`util/fortune/fonts/${f}`, root)), `${f} 라이선스가 없다`);
  }
  assert.ok(existsSync(new URL("util/fortune/vendor/rough.LICENSE.txt", root)));
  // 페이지는 Google Fonts 같은 바깥 글꼴을 부르지 않는다(CSP font-src 'self')
  assert.doesNotMatch(read("util/fortune/index.html"), /fonts\.googleapis|fonts\.gstatic/);
});

// 신청이 들어와도 사용자가 알 길이 없었다 — 디스코드로 알리되 개인정보는 싣지 않는다.
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const DISCORD = { DISCORD_BOT_TOKEN: "bot-token", DISCORD_CHANNEL_ID: "123" };

test("만화 사주: 새 신청은 디스코드에 알리고, 메일·생년월일은 싣지 않는다", async () => {
  const { call } = await comicEnv(DISCORD);
  const sent = [];
  await withFetch(async (url, init) => { sent.push({ url: String(url), init }); return new Response("{}"); }, async () => {
    const res = await call("POST", "/_fortune/comic-request", comicBody("secret.person@example.com"));
    assert.equal(res.status, 200);
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://discord.com/api/v10/channels/123/messages");
  const body = sent[0].init.body;
  assert.match(JSON.parse(body).content, /1번째 \(남은 자리 9\/10\)/);
  for (const leak of ["secret.person", "example.com", "1992", "male"]) assert.ok(!body.includes(leak), `알림에 ${leak} 이 실렸다`);
});

test("만화 사주: 디스코드가 실패해도 신청은 저장되고 성공으로 답한다", async () => {
  const { call, storage } = await comicEnv(DISCORD);
  const res = await withFetch(async () => new Response("nope", { status: 500 }),
    () => call("POST", "/_fortune/comic-request", comicBody("a@example.com")));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, remaining: 9 });
  assert.equal((await storage.list({ prefix: "comic:req:" })).size, 1);
});

test("만화 사주: 디스코드 설정이 없으면 알림을 보내지 않는다", async () => {
  const { call } = await comicEnv();
  let calls = 0;
  await withFetch(async () => { calls += 1; return new Response("{}"); },
    () => call("POST", "/_fortune/comic-request", comicBody("a@example.com")));
  assert.equal(calls, 0);
});

test("만화 사주: 집 PC 의 준비됨/실패 알림은 시크릿이 있어야 하고, 개인정보 없이 디스코드로 간다", async () => {
  const { call } = await comicEnv(DISCORD);
  const sent = [];
  await withFetch(async (url, init) => { sent.push(JSON.parse(init.body).content); return new Response("{}"); }, async () => {
    await call("POST", "/_fortune/comic-request", comicBody("who@example.com"));
    const { requests } = await (await call("GET", "/_fortune/comic-requests", undefined, AUTH)).json();
    const id = requests[0].id;
    assert.equal((await call("POST", `/_fortune/comic-requests/${id}/ready`, { status: "packaged" })).status, 401);
    assert.equal((await call("POST", `/_fortune/comic-requests/${id}/ready`, { status: "packaged" }, AUTH)).status, 200);
    assert.equal((await call("POST", `/_fortune/comic-requests/${id}/ready`, { status: "failed", reason: "시주 불일치 x@y.com" }, AUTH)).status, 200);
    assert.equal((await call("POST", "/_fortune/comic-requests/0000000000000000/ready", { status: "packaged" }, AUTH)).status, 404);
    for (const text of sent) assert.ok(!text.includes(id) && !text.includes("who@"), text);
  });
  assert.equal(sent.length, 3);   // 신청 1 + 준비됨 1 + 실패 1
  assert.match(sent[1], /재료가 준비됐어요/);
  assert.match(sent[2], /멈췄어요 — 시주 불일치 x y\.com/);
});

// ── 만화 사주 후기 ──
async function reviewEnv(extra = {}) {
  const { handleFortuneReview } = await import("./fortune.js");
  const storage = new MemoryStorage();
  const env = { COMIC_SINK_SECRET: "sink-secret", ...extra };
  const fortune = new FortuneDO({ storage }, env);
  const stub = { fetch: (input, init) => fortune.fetch(new Request(input, init)) };
  env.FORTUNE = { idFromName: () => "global", get: () => stub };
  const call = (method, path, body, headers = {}) => {
    const url = new URL(`https://util.bubblelab.dev${path}`);
    return handleFortuneReview(new Request(url, { method, headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, url);
  };
  return { storage, call };
}

test("후기: 별점 1~5·글 5~500자만 받고, 봇 칸은 티 없이 버리고, 목록은 시크릿으로만", async () => {
  const { call, storage } = await reviewEnv();
  for (const [body, error] of [
    [{ rating: 0, text: "좋았어요 정말" }, "rating"], [{ rating: 6, text: "좋았어요 정말" }, "rating"],
    [{ rating: 5, text: "좋아" }, "text"], [{ rating: 5, text: "가".repeat(501) }, "text"],
  ]) {
    const res = await call("POST", "/_fortune/review", body);
    assert.equal(res.status, 400); assert.equal((await res.json()).error, error);
  }
  const bot = await call("POST", "/_fortune/review", { rating: 5, text: "광고 광고 광고", website: "http://spam" });
  assert.deepEqual(await bot.json(), { ok: true });
  assert.equal((await storage.list({ prefix: "review:item:" })).size, 0);
  const ok = await call("POST", "/_fortune/review", { rating: 4, text: "  만화로 보니 술술 읽혀요  ", nick: "  아주아주아주긴별명입니다요  ", publish: "yes" });
  assert.deepEqual(await ok.json(), { ok: true });
  assert.equal((await call("GET", "/_fortune/reviews")).status, 401);
  const list = await (await call("GET", "/_fortune/reviews", undefined, AUTH)).json();
  assert.equal(list.count, 1);
  assert.equal(list.reviews[0].text, "만화로 보니 술술 읽혀요");
  assert.equal(list.reviews[0].nick.length, 12);
  assert.equal(list.reviews[0].publish, false);   // true 만 동의로 본다
});

test("후기: 새 후기는 별점과 앞부분만 디스코드로 간다", async () => {
  const { call } = await reviewEnv(DISCORD);
  const sent = [];
  await withFetch(async (url, init) => { sent.push(JSON.parse(init.body).content); return new Response("{}"); },
    () => call("POST", "/_fortune/review", { rating: 3, text: "가".repeat(120), nick: "곰" }));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /★★★☆☆ — 곰/);
  assert.match(sent[0], /…$/);
});

// 개인정보(신청 목록·후기)는 논문·오픽과 같은 키로 열리면 안 된다 — 키를 나눴다(2026-11-14).
test("만화 사주·후기 목록은 COMIC_SINK_SECRET 으로만 열리고 PAPERS_SINK_SECRET 으로는 안 열린다", async () => {
  const { call } = await comicEnv({ PAPERS_SINK_SECRET: "papers-secret" });
  assert.equal((await call("GET", "/_fortune/comic-requests", undefined, { Authorization: "Bearer papers-secret" })).status, 401);
  assert.equal((await call("GET", "/_fortune/comic-requests", undefined, AUTH)).status, 200);
  const r = await reviewEnv({ PAPERS_SINK_SECRET: "papers-secret" });
  assert.equal((await r.call("GET", "/_fortune/reviews", undefined, { Authorization: "Bearer papers-secret" })).status, 401);
});

// ── 만화 사주 다운로드 링크(인스타 DM 신청분) ──
class FakeR2 {
  constructor() { this.data = new Map(); }
  async put(k, v) { this.data.set(k, new Uint8Array(v)); }
  async get(k) { return this.data.has(k) ? { body: this.data.get(k) } : null; }
  async delete(k) { this.data.delete(k); }
  async list({ prefix }) { return { objects: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
}
async function shareEnv() {
  const { handleFortuneShare } = await import("./fortune.js");
  const storage = new MemoryStorage();
  const bucket = new FakeR2();
  const env = { COMIC_SINK_SECRET: "sink-secret", FORTUNE_BUCKET: bucket };
  const fortune = new FortuneDO({ storage }, env);
  env.FORTUNE = { idFromName: () => "global", get: () => ({ fetch: (i, n) => fortune.fetch(new Request(i, n)) }) };
  const call = (method, path, body, headers = {}) => {
    const url = new URL(`https://util.bubblelab.dev${path}`);
    return handleFortuneShare(new Request(url, { method, headers, ...(body === undefined ? {} : { body }) }), env, url);
  };
  return { storage, bucket, call };
}

test("다운로드 링크: 시크릿으로만 만들고 올리며, 토큰으로 읽고, 정해진 파일만 받는다", async () => {
  const { call, bucket } = await shareEnv();
  assert.equal((await call("POST", "/_fortune/share", JSON.stringify({ title: "x" }))).status, 401);
  const made = await (await call("POST", "/_fortune/share", JSON.stringify({ title: "촛불 켠 사람" }), AUTH)).json();
  assert.match(made.token, /^[A-Za-z0-9_-]{22}$/);
  const t = made.token;
  assert.equal((await call("PUT", `/_fortune/share/${t}/saju-01.jpg`, new Uint8Array([1, 2, 3]))).status, 401);
  assert.equal((await call("PUT", `/_fortune/share/${t}/saju-01.jpg`, new Uint8Array([1, 2, 3]), AUTH)).status, 200);
  assert.equal((await call("PUT", `/_fortune/share/${t}/evil.html`, new Uint8Array([1]), AUTH)).status, 404);
  const meta = await (await call("GET", `/_fortune/share/${t}`)).json();
  assert.deepEqual(meta.files, ["saju-01.jpg"]);
  assert.equal(meta.title, "촛불 켠 사람");
  const img = await call("GET", `/_fortune/share/${t}/saju-01.jpg`);
  assert.equal(img.headers.get("Content-Type"), "image/jpeg");
  assert.match(img.headers.get("Cache-Control"), /no-store/);
  assert.equal((await call("GET", "/_fortune/share/AAAAAAAAAAAAAAAAAAAAAA")).status, 410);
  assert.equal((await call("GET", "/_fortune/share/../x")).status, 404);
  assert.equal((await call("DELETE", `/_fortune/share/${t}`, undefined, AUTH)).status, 200);
  assert.equal((await call("GET", `/_fortune/share/${t}`)).status, 410);
  assert.equal(bucket.data.size, 0);
});

test("다운로드 링크: 7일이 지나면 410 이고 R2 파일까지 지워진다", async () => {
  const { call, bucket, storage } = await shareEnv();
  const { token } = await (await call("POST", "/_fortune/share", JSON.stringify({ title: "a" }), AUTH)).json();
  await call("PUT", `/_fortune/share/${token}/saju_comic.pdf`, new Uint8Array([9]), AUTH);
  const item = await storage.get(`share:${token}`);
  item.expires = Date.now() - 1; await storage.put(`share:${token}`, item);
  assert.equal((await call("GET", `/_fortune/share/${token}/saju_comic.pdf`)).status, 410);
  assert.equal(bucket.data.size, 0);
  assert.equal(await storage.get(`share:${token}`), undefined);
});
