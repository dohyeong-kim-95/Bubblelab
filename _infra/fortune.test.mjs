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
  const sub = await fakeSubscription("https://fcm.googleapis.com/fcm/send/a");

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
  await fortune.fetch(pushReq("POST", { subscription: await fakeSubscription("https://fcm.googleapis.com/fcm/send/live") }));
  await fortune.fetch(pushReq("POST", { subscription: await fakeSubscription("https://fcm.googleapis.com/fcm/send/expired") }));

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

// 같은 탭 화면이 fortune.bubblelab.dev/note/ 와 util.bubblelab.dev/fortune/ 두 자리에서 열린다 — 구독한 자리로 알림을 연다.
test("푸시: 구독 출처는 요청 주소로 정하고(로컬만 화면 힌트), 발송은 구독마다 그 자리 주소 — 출처 없는 옛 구독은 util", async () => {
  const { handleFortunePush, FORTUNE_PUSH_URLS, pushUrlOf } = await import("./fortune.js");
  const storage = new MemoryStorage();
  const vapid = await generateVapidKeys();
  const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
  const fortune = new FortuneDO({ storage }, env);
  env.FORTUNE = { idFromName: () => "global", get: () => ({ fetch: (u, i) => fortune.fetch(new Request(u, i)) }) };
  const subscribe = async (origin, endpoint, extra = {}) => {
    const body = JSON.stringify({ subscription: await fakeSubscription(endpoint), ...extra });
    const res = await handleFortunePush(new Request(`${origin}/_fortune/push`, { method: "POST", headers: { "Content-Type": "application/json" }, body }), env);
    assert.equal(res.status, 200, origin);
  };
  await subscribe("https://fortune.bubblelab.dev", "https://fcm.googleapis.com/fcm/send/fortune");
  await subscribe("https://util.bubblelab.dev", "https://fcm.googleapis.com/fcm/send/util");
  await subscribe("https://util.bubblelab.dev", "https://fcm.googleapis.com/fcm/send/spoof", { site: "fortune" });   // 운영에선 힌트를 믿지 않는다
  await subscribe("http://localhost:8787", "https://fcm.googleapis.com/fcm/send/local-fortune", { site: "fortune" });
  await subscribe("http://localhost:8787", "https://fcm.googleapis.com/fcm/send/local-util");
  // 2026-11-16 이전 구독(출처 없음)
  const legacy = await fakeSubscription("https://fcm.googleapis.com/fcm/send/legacy");
  await storage.put("push:legacy0000000000000000000000000", { endpoint: legacy.endpoint, keys: legacy.keys });
  const sites = Object.fromEntries([...(await storage.list({ prefix: "push:" })).values()].map((v) => [v.endpoint.split("/").pop(), v.site ?? null]));
  assert.deepEqual(sites, { fortune: "fortune", util: "util", spoof: "util", "local-fortune": "fortune", "local-util": "util", legacy: null });

  const sent = {};
  fortune.sendWebPush = async (sub, payload) => { sent[sub.endpoint.split("/").pop()] = JSON.parse(payload).url; return { ok: true }; };
  assert.deepEqual(await (await fortune.fetch(new Request("https://fortune.internal/notify", { method: "POST" }))).json(), { sent: 6 });
  assert.deepEqual(sent, {
    fortune: "https://fortune.bubblelab.dev/note/", util: "https://util.bubblelab.dev/fortune", spoof: "https://util.bubblelab.dev/fortune",
    "local-fortune": "https://fortune.bubblelab.dev/note/", "local-util": "https://util.bubblelab.dev/fortune", legacy: "https://util.bubblelab.dev/fortune",
  });
  assert.equal(pushUrlOf({}), FORTUNE_PUSH_URLS.util);
  // 서비스워커는 주소를 박아 두지 않는다 — 서버가 준 주소, 없으면 등록된 자리(scope)
  const sw = (await import("node:fs")).readFileSync(new URL("../fortune/note/sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(sw, /bubblelab\.dev\/fortune"|"\/fortune"/);
  assert.match(sw, /data\.url \?\? self\.registration\.scope/);
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

// ── 옛 만화 사주 메일 신청(2026-11-18 닫음) ── 집 PC 의 목록·완료 경로만 남는다.
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
const AUTH = { Authorization: "Bearer sink-secret" };
// 옛 메일 접수 신청 하나를 저장소에 심는다(접수창은 닫혀 새로 들어올 수 없다 — 집 PC 경로만 남는다).
async function seedComic(storage, id, email) {
  await storage.put(`comic:req:${id}`, { id, email, birth: { y: 1992, m: 8, d: 20, h: 5, calendar: "solar", lunarLeap: false }, gender: "male", created: `2026-11-1${id.at(-1)}T00:00:00Z` });
  await storage.put(`comic:email:${id}x`, id);
  await storage.put("comic:count", 10);
}


// ── 운세 노트 글꼴 조각 ── 화면 문구·풀이 조각 표의 한글이 처음 받는 core 조각에 다 들어 있어야 한다.
// 빠지면 그 글자 하나 때문에 100KB 남짓한 rest 조각을 더 받는다. 문구를 바꿨으면
// `_src/fortune-fonts/build.py` 를 다시 돌린다.
test("운세 노트: core 글꼴 조각이 화면·조각 표의 한글을 모두 덮고, 라이선스가 함께 있다", async () => {
  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const root = new URL("../", import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), "utf8");
  const css = read("fortune/fonts/fonts.css");
  const rangeOf = (file) => {
    const m = new RegExp(`${file}-[0-9a-f]{10}\\.woff2"\\) format\\("woff2"\\); font-display: swap; unicode-range: ([^;]+);`).exec(css);
    assert.ok(m, `${file} 가 fonts.css 에 없다`);
    const set = new Set();
    for (const part of m[1].split(",")) {
      const [a, b] = part.replace(/U\+/g, "").split("-").map((x) => parseInt(x, 16));
      for (let c = a; c <= (b ?? a); c++) set.add(c);
    }
    return set;
  };
  const hangul = (text) => [...new Set(text)].filter((ch) => ch >= "가" && ch <= "힣");
  const hand = rangeOf("hand-core"), body = rangeOf("body-core");
  // 타로 탭은 tarot/ 모듈이 그린다 — 손글씨는 화면 문구·카드 이름·자리 이름, 본문은 풀이 문장 표까지
  const { CARDS, POSITIONS, SPREADS } = await import("../fortune/lib/tarot.js");
  const tarotHand = [...CARDS.map((c) => c.name), ...Object.values(POSITIONS).map((p) => p.label), ...Object.values(SPREADS).map((x) => x.label)].join("");
  // 상담 노트(fortune 첫 화면) — 다그당스가 쓰는 줄이 손글씨라 스크립트 문구·특성 표시명까지 손글씨 core 에
  const notePage = read("fortune/index.html") + read("fortune/notebook/consult.js") + read("fortune/lib/consult-text.js") + read("fortune/lib/note.js") + read("fortune/lib/traits.js");
  const page = read("fortune/note/index.html") + read("fortune/note/note.js") + read("fortune/note/tarot/page.js") + tarotHand + notePage;
  assert.deepEqual(hangul(page).filter((ch) => !hand.has(ch.codePointAt(0))), [], "손글씨 core 에 없는 글자");
  const tj = readdirSync(new URL("fortune/tojeong/", root)).map((f) => read(`fortune/tojeong/${f}`)).join("");
  const all = page + read("fortune/palm/palm.js") + read("fortune/lib/tarot.js") + read("fortune/lib/tarot-minor.js") + read("fortune/lib/tarot-texts.js") + read("fortune/lib/tarot-log.js") + read("fortune/lib/prefs.js") + read("fortune/lib/tarot-classic.js") + read("_infra/saju-reading.js") + read("_infra/fortune.js") + read("_infra/life-curve.js") + tj;
  assert.deepEqual(hangul(all).filter((ch) => !body.has(ch.codePointAt(0))), [], "본문 core 에 없는 글자");
  for (const f of ["NanumPenScript-OFL.txt", "GowunDodum-OFL.txt", "NotoSerifKR-OFL.txt"]) {
    assert.ok(existsSync(new URL(`fortune/fonts/${f}`, root)), `${f} 라이선스가 없다`);
  }
  assert.ok(existsSync(new URL("fortune/vendor/rough.LICENSE.txt", root)));
  // 페이지는 Google Fonts 같은 바깥 글꼴을 부르지 않는다(CSP font-src 'self')
  assert.doesNotMatch(read("fortune/note/index.html"), /fonts\.googleapis|fonts\.gstatic/);
});

// 신청이 들어와도 사용자가 알 길이 없었다 — 디스코드로 알리되 개인정보는 싣지 않는다.
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const DISCORD = { DISCORD_BOT_TOKEN: "bot-token", DISCORD_CHANNEL_ID: "123" };

// 2026-11-18 메일 접수창을 닫고 신청서(ig-form) 하나로 합쳤다 — 옛 주소로 와도 저장·알림 없이 닫혔다고만 답한다.
test("옛 메일 접수: POST 는 410 closed(신청서 주소), 저장·디스코드 알림 없음, 상태는 닫힘", async () => {
  const { call, storage } = await comicEnv(DISCORD);
  let calls = 0;
  const res = await withFetch(async () => { calls += 1; return new Response("{}"); },
    () => call("POST", "/_fortune/comic-request", { email: "me@example.com", birth: { y: 1992, m: 8, d: 20 }, consent: true }));
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), { error: "closed", form: "https://util.bubblelab.dev/fortune/insta/" });
  assert.equal(calls, 0);
  assert.equal((await storage.list({ prefix: "" })).size, 0);
  assert.deepEqual(await (await call("GET", "/_fortune/comic-request/status")).json(), { open: false, remaining: 0 });
});

test("옛 메일 목록: 시크릿 없이 못 쓰고, 남은 신청은 목록에 보이며 done 하면 메일까지 지워진다", async () => {
  const { call, storage } = await comicEnv();
  await seedComic(storage, "0123456789abcde1", "me@example.com");
  await seedComic(storage, "0123456789abcde2", "you@example.com");
  assert.equal((await call("GET", "/_fortune/comic-requests")).status, 401);
  assert.equal((await call("GET", "/_fortune/comic-requests", undefined, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await call("POST", "/_fortune/comic-requests/0123456789abcdef/done")).status, 401);
  const list = await (await call("GET", "/_fortune/comic-requests", undefined, AUTH)).json();
  assert.deepEqual(list.requests.map((r) => r.email), ["me@example.com", "you@example.com"]);
  assert.equal(list.remaining, 0);
  assert.equal((await call("POST", "/_fortune/comic-requests/0123456789abcde1/done", undefined, AUTH)).status, 200);
  const dump = JSON.stringify([...(await storage.list({ prefix: "" })).entries()]);
  assert.doesNotMatch(dump, /me@example\.com|abcde1x/);
  assert.equal((await call("POST", "/_fortune/comic-requests/0123456789abcde1/done", undefined, AUTH)).status, 404);
  const closed = await comicEnv({ COMIC_SINK_SECRET: undefined });
  assert.equal((await closed.call("GET", "/_fortune/comic-requests", undefined, AUTH)).status, 503);
});

test("옛 메일 목록: 집 PC 의 준비됨/실패 알림은 시크릿이 있어야 하고, 개인정보 없이 디스코드로 간다", async () => {
  const { call, storage } = await comicEnv(DISCORD);
  const id = "0123456789abcde1";
  await seedComic(storage, id, "who@example.com");
  const sent = [];
  await withFetch(async (url, init) => { sent.push(JSON.parse(init.body).content); return new Response("{}"); }, async () => {
    assert.equal((await call("POST", `/_fortune/comic-requests/${id}/ready`, { status: "packaged" })).status, 401);
    assert.equal((await call("POST", `/_fortune/comic-requests/${id}/ready`, { status: "packaged" }, AUTH)).status, 200);
    assert.equal((await call("POST", `/_fortune/comic-requests/${id}/ready`, { status: "failed", reason: "시주 불일치 x@y.com" }, AUTH)).status, 200);
    assert.equal((await call("POST", "/_fortune/comic-requests/0000000000000000/ready", { status: "packaged" }, AUTH)).status, 404);
    for (const text of sent) assert.ok(!text.includes(id) && !text.includes("who@"), text);
  });
  assert.equal(sent.length, 2);   // 준비됨 1 + 실패 1
  assert.match(sent[0], /재료가 준비됐어요/);
  assert.match(sent[1], /멈췄어요 — 시주 불일치 x y\.com/);
});

// ── 만화 사주 신청서(util/fortune/insta) ── 인스타 아이디나 메일 하나, 회차(게시글)마다 10건, admin 이 회차를 연다.
async function igFormEnv(extra = {}) {
  const { handleFortuneIgForm, handleFortuneIgFormAdmin } = await import("./fortune.js");
  const storage = new MemoryStorage();
  const env = { COMIC_SINK_SECRET: "sink-secret", ...extra };
  const fortune = new FortuneDO({ storage }, env);
  const stub = { fetch: (input, init) => fortune.fetch(new Request(input, init)) };
  env.FORTUNE = { idFromName: () => "global", get: () => stub };
  const req = (method, url, body, headers = {}) => new Request(url, {
    method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const call = (method, path, body, headers) => {
    const url = new URL(`https://util.bubblelab.dev${path}`);
    return handleFortuneIgForm(req(method, url, body, headers), env, url);
  };
  const admin = (method, body) => {
    const url = new URL("https://admin.bubblelab.dev/api/fortune/ig-form-round");
    return handleFortuneIgFormAdmin(req(method, url, body), env, url);
  };
  return { storage, call, admin, fortune };
}
const igBody = (handle, extra = {}) => ({
  handle, name: "토끼", birth: { y: 1995, m: 3, d: 9, h: 4 }, gender: "female", consent: true, ...extra,
});
const mailBody = (email, extra = {}) => ({
  contact: "email", email, name: "곰돌이", birth: { y: 1990, m: 1, d: 2, h: null }, gender: "male", consent: true, ...extra,
});
const IG_LINK = "https://util.bubblelab.dev/fortune/get/#AbCdEfGhIjKlMnOpQrStUv";
const IG_LINK2 = "https://util.bubblelab.dev/fortune/get/#ZyXwVuTsRqPoNmLkJiHgFe";

test("신청서: 회차가 없으면 닫혀 있고, 새 회차에서 10건까지(인스타·메일 합쳐) 받고 11번째는 full, 새 회차를 열면 다시 받는다", async () => {
  const { call, admin } = await igFormEnv();
  assert.deepEqual(await (await call("GET", "/_fortune/ig-form/status")).json(), { open: false, remaining: 0, cap: 10 });
  const closed = await call("POST", "/_fortune/ig-form", igBody("first"));
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).error, "closed");
  assert.equal((await (await admin("POST", { action: "new" })).json()).round.n, 1);
  for (let i = 0; i < 10; i++) {
    const res = await call("POST", "/_fortune/ig-form", i % 2 ? igBody(`user_${i}`) : mailBody(`p${i}@example.com`));
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual([out.ok, out.remaining], [true, 9 - i]);
    assert.match(out.receipt, /^[A-Za-z0-9_-]{43}$/);
  }
  const full = await call("POST", "/_fortune/ig-form", igBody("late.one"));
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error, "full");
  assert.deepEqual(await (await call("GET", "/_fortune/ig-form/status")).json(), { open: false, remaining: 0, cap: 10 });
  const round2 = (await (await admin("POST", { action: "new" })).json()).round;
  assert.deepEqual([round2.n, round2.count, round2.open], [2, 0, true]);
  assert.equal((await call("POST", "/_fortune/ig-form", igBody("late.one"))).status, 200);
  await admin("POST", { action: "close" });
  assert.equal((await (await call("POST", "/_fortune/ig-form", igBody("third"))).json()).error, "closed");
  await admin("POST", { action: "open" });
  assert.equal((await (await call("POST", "/_fortune/ig-form", igBody("third"))).json()).remaining, 8);
  const view = await (await admin("GET")).json();
  assert.equal(view.round.count, 2);
  assert.equal(view.pending.length, 12);
  assert.deepEqual(view.pending.slice(0, 3).map((p) => [p.contact, p.to, p.state]),
    [["email", "p0@example.com", "making"], ["instagram", "user_1", "queued"], ["email", "p2@example.com", "queued"]]);
  assert.equal((await admin("POST", { action: "nope" })).status, 400);
});

test("신청서: 연락처는 인스타 아이디나 메일 중 정확히 하나 — 둘 다·모르는 종류는 contact, 모양이 틀리면 handle/email, 같은 연락처가 대기 중이면 dup", async () => {
  const { call, admin, storage } = await igFormEnv();
  await admin("POST", { action: "new" });
  for (const [body, error] of [
    [igBody("has space"), "handle"], [igBody("한글아이디"), "handle"], [igBody("a".repeat(31)), "handle"], [igBody(""), "handle"],
    [igBody("ok", { email: "a@example.com" }), "contact"], [mailBody("a@example.com", { handle: "ok" }), "contact"],
    [igBody("ok", { contact: "fax" }), "contact"], [mailBody("not-an-email"), "email"], [mailBody(""), "email"],
    [mailBody(`${"x".repeat(250)}@example.com`), "email"],
    [igBody("ok", { name: "열세글자가넘는아주긴이름이에요" }), "name"], [igBody("ok", { name: "<b>" }), "name"],
    [igBody("ok", { birth: { y: 1995, m: 2, d: 30 } }), "birth"], [igBody("ok", { time: "25:00" }), "birth"],
    [igBody("ok", { consent: false }), "consent"], [mailBody("a@example.com", { consent: "true" }), "consent"],
  ]) {
    const res = await call("POST", "/_fortune/ig-form", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).error, error, JSON.stringify(body));
  }
  const bot = await call("POST", "/_fortune/ig-form", igBody("bot", { website: "x" }));
  assert.deepEqual(await bot.json(), { ok: true, remaining: null });
  assert.equal((await call("POST", "/_fortune/ig-form", igBody("  @Da.Geu_Dang  ", { name: "", time: "07:30", calendar: "lunar" }))).status, 200);
  const dup = await call("POST", "/_fortune/ig-form", igBody("da.geu_dang"));
  assert.equal(dup.status, 409);
  assert.deepEqual(await dup.json(), { error: "dup", message: "이미 접수됐어요" });
  assert.equal((await call("POST", "/_fortune/ig-form", mailBody(" Me@Example.com ", { name: "" }))).status, 200);
  assert.equal((await (await call("POST", "/_fortune/ig-form", mailBody("me@example.COM"))).json()).error, "dup");
  const [ig, mail] = [...(await storage.list({ prefix: "igform:req:" })).values()].sort((a, b) => a.seq - b.seq);
  assert.deepEqual([ig.contact, ig.handle, ig.name, ig.time, ig.birth.h, ig.calendar, ig.birth.calendar],
    ["instagram", "da.geu_dang", "da.geu_dang", "07:30", null, "lunar", "lunar"]);   // 이름을 안 적으면 아이디(12자까지)
  assert.deepEqual([mail.contact, mail.handle, mail.email, mail.name], ["email", "", "me@example.com", ""]);   // 메일은 이름을 지어내지 않는다
  // 메일 원문은 중복 확인 키에 두지 않는다
  assert.ok(![...(await storage.list({ prefix: "igform:email:" })).keys()].some((k) => k.includes("example")));
  assert.equal((await (await admin("GET")).json()).round.count, 2);   // 거절·봇·중복은 자리를 쓰지 않는다
});

test("신청서 → 집 PC: 목록은 시크릿으로만, 아직 만들 것만(메일·접수증 없이, handle 은 늘 있다), ready 는 우리 링크만 받고 지우지 않는다", async () => {
  const { call, admin, storage } = await igFormEnv(DISCORD);
  await admin("POST", { action: "new" });
  const sent = [];
  const fake = async (url, init) => { sent.push(JSON.parse(init.body).content); return new Response("{}"); };
  await withFetch(fake, async () => {
    await call("POST", "/_fortune/ig-form", igBody("first.one"));
    await call("POST", "/_fortune/ig-form", mailBody("second@example.com"));
  });
  assert.equal((await call("GET", "/_fortune/ig-form-requests")).status, 401);
  assert.equal((await call("GET", "/_fortune/ig-form-requests", undefined, { Authorization: "Bearer wrong" })).status, 401);
  const { requests } = await (await call("GET", "/_fortune/ig-form-requests", undefined, AUTH)).json();
  assert.deepEqual(requests.map((r) => [r.contact, r.handle, r.name]), [["instagram", "first.one", "토끼"], ["email", "", "곰돌이"]]);
  assert.match(requests[0].id, /^[0-9a-f]{16}$/);
  for (const r of requests) {
    assert.deepEqual(Object.keys(r).sort(), ["birth", "calendar", "contact", "created", "gender", "handle", "id", "name", "round", "seq", "time"]);
  }
  assert.doesNotMatch(JSON.stringify(requests), /second@|example\.com/);
  const [a, b] = requests;
  for (const link of ["https://evil.example/fortune/get/#AbCdEfGhIjKl", "http://util.bubblelab.dev/fortune/get/#AbCdEfGhIjKl",
    "https://util.bubblelab.dev/fortune/get/#a b", "https://util.bubblelab.dev/fortune/get/x#AbCdEfGh", ""]) {
    const res = await call("POST", `/_fortune/ig-form-requests/${a.id}/ready`, { status: "ready", link }, AUTH);
    assert.equal(res.status, 400, link);
    assert.equal((await res.json()).error, "link");
  }
  assert.equal((await call("POST", `/_fortune/ig-form-requests/${a.id}/ready`, { status: "ready", link: IG_LINK }, { Authorization: "Bearer wrong" })).status, 401);
  // 디스코드가 안 가도 링크는 서버에 남으니 성공(집 PC 가 다시 보내지 않아도 된다)
  const quiet = await withFetch(async () => new Response("nope", { status: 500 }),
    () => call("POST", `/_fortune/ig-form-requests/${b.id}/ready`, { status: "ready", link: IG_LINK, expires: String(Date.now() + 864e5) }, AUTH));
  assert.deepEqual(await quiet.json(), { ok: true });
  await withFetch(fake, async () => {
    // 같은 보고가 다시 와도(집 PC 재시도) 알림은 처음 한 번만 — 여기선 이미 ready 라 알림 없음
    assert.equal((await call("POST", `/_fortune/ig-form-requests/${b.id}/ready`, { status: "ready", link: IG_LINK }, AUTH)).status, 200);
    const failed = await call("POST", `/_fortune/ig-form-requests/${a.id}/ready`, { status: "failed", reason: "점검 실패 <x> @first.one" }, AUTH);
    assert.equal(failed.status, 200);
    await admin("POST", { action: "retry", id: a.id });
    assert.equal((await call("POST", `/_fortune/ig-form-requests/${a.id}/ready`, { status: "ready", link: IG_LINK2 }, AUTH)).status, 200);
  });
  const kept = await storage.get(`igform:req:${b.id}`);
  assert.deepEqual([kept.email, kept.link, kept.name], ["second@example.com", IG_LINK, "곰돌이"]);   // 보낼 때까지 남는다
  assert.ok(kept.expires > Date.now());
  assert.deepEqual(sent, [
    "📸 만화 사주 신청 — 이번 회차 1/10\n집 PC 가 5분 안에 그리기 시작해요(20분쯤).",
    "📸 만화 사주 신청 — 이번 회차 2/10\n집 PC 가 5분 안에 그리기 시작해요(20분쯤).",
    "⚠️ 만화 사주가 멈췄어요 — 점검 실패 x first.one\nadmin 📸 에서 확인해 주세요.",
    "✅ 만화 사주 완성 2건 — admin 📸 에서 보내 주세요",
  ]);
  // 완성된 것은 집 PC 목록에서 빠진다(다시 만들지 않는다)
  assert.deepEqual((await (await call("GET", "/_fortune/ig-form-requests", undefined, AUTH)).json()).requests, []);
  // done 은 보내지 않고 치운다(개인정보·접수증까지)
  assert.deepEqual(await (await call("POST", `/_fortune/ig-form-requests/${a.id}/done`, undefined, AUTH)).json(), { ok: true });
  assert.equal((await call("POST", `/_fortune/ig-form-requests/${a.id}/done`, undefined, AUTH)).status, 404);
  assert.equal((await storage.list({ prefix: "igform:handle:" })).size, 0);
  assert.equal((await storage.list({ prefix: "igform:receipt:" })).size, 1);
});

test("신청서: 디스코드에는 개인정보가 없다 — 새 신청은 몇 번째만, 완성은 건수만, 실패는 사유만", async () => {
  const { call, admin } = await igFormEnv(DISCORD);
  await admin("POST", { action: "new" });
  const sent = [];
  await withFetch(async (url, init) => { sent.push(init.body); return new Response("{}"); }, async () => {
    await call("POST", "/_fortune/ig-form", igBody("dageu", { name: "김비밀", birth: { y: 1987, m: 11, d: 23, h: 2 } }));
    await call("POST", "/_fortune/ig-form", mailBody("secret.person@example.com", { name: "박비밀" }));
    const { requests } = await (await call("GET", "/_fortune/ig-form-requests", undefined, AUTH)).json();
    await call("POST", `/_fortune/ig-form-requests/${requests[0].id}/ready`, { status: "ready", link: IG_LINK }, AUTH);
    await call("POST", `/_fortune/ig-form-requests/${requests[1].id}/ready`, { status: "failed", reason: "형식" }, AUTH);
  });
  assert.equal(sent.length, 4);
  for (const body of sent) {
    assert.deepEqual(JSON.parse(body).allowed_mentions, { parse: [] });
    assert.doesNotMatch(body, /dageu|김비밀|박비밀|secret|example|1987|1990|female|AbCdEf|fortune\/get/);
  }
});

test("접수증: 신청하면 토큰을 주고(서버엔 해시만), 본문으로 물으면 대기 n번째 → 만드는 중 → 완성(링크) → 보낸 뒤에도 완성 → 만료", async () => {
  const { call, admin, storage } = await igFormEnv();
  await admin("POST", { action: "new" });
  const tokens = [];
  for (const body of [igBody("one"), mailBody("two@example.com"), igBody("three")]) {
    tokens.push((await (await call("POST", "/_fortune/ig-form", body)).json()).receipt);
  }
  const dump = JSON.stringify([...(await storage.list({ prefix: "" })).entries()]);
  for (const t of tokens) assert.ok(!dump.includes(t), "토큰 원문이 저장됐다");
  const ask = async (token) => (await call("POST", "/_fortune/ig-form/receipt", { token })).json();
  assert.deepEqual(await ask(tokens[0]), { state: "making" });
  assert.deepEqual(await ask(tokens[1]), { state: "queued", position: 2 });
  assert.deepEqual(await ask(tokens[2]), { state: "queued", position: 3 });
  // 토큰은 주소에 싣지 않는다 — GET 은 받지 않고, 모양이 틀리면 400, 모르는 토큰은 unknown
  assert.equal((await call("GET", `/_fortune/ig-form/receipt?token=${tokens[0]}`)).status, 405);
  assert.equal((await call("POST", "/_fortune/ig-form/receipt", { token: "short" })).status, 400);
  assert.deepEqual(await ask("A".repeat(43)), { state: "unknown" });
  const { requests } = await (await call("GET", "/_fortune/ig-form-requests", undefined, AUTH)).json();
  const [one, two] = requests;
  await call("POST", `/_fortune/ig-form-requests/${one.id}/ready`, { status: "failed", reason: "x" }, AUTH);
  assert.deepEqual(await ask(tokens[0]), { state: "delayed" });
  assert.deepEqual(await ask(tokens[1]), { state: "making" });   // 멈춘 건은 줄에서 빠진다
  assert.deepEqual(await ask(tokens[2]), { state: "queued", position: 2 });
  const expires = Date.now() + 7 * 864e5;
  await call("POST", `/_fortune/ig-form-requests/${two.id}/ready`, { status: "ready", link: IG_LINK, expires: String(expires) }, AUTH);
  assert.deepEqual(await ask(tokens[1]), { state: "ready", link: IG_LINK, expires });
  // 보냄 → 이름·생년월일·메일은 지우고 접수증엔 링크·만료만
  assert.deepEqual(await (await admin("POST", { action: "sent", id: two.id })).json(), { ok: true });
  assert.deepEqual(await ask(tokens[1]), { state: "ready", link: IG_LINK, expires });
  const after = JSON.stringify([...(await storage.list({ prefix: "" })).entries()]);
  assert.doesNotMatch(after, /two@example|곰돌이|1990/);
  assert.equal(await storage.get(`igform:req:${two.id}`), undefined);
  // 링크 기한이 지나면 만료
  const [rkey, rec] = [...(await storage.list({ prefix: "igform:receipt:" })).entries()].find(([, v]) => v.sent);
  await storage.put(rkey, { ...rec, expires: Date.now() - 1 });
  assert.deepEqual(await ask(tokens[1]), { state: "expired" });
  // 만료 뒤 30일이 지나면 admin 화면을 열 때 접수증 기록도 지운다
  await storage.put(rkey, { ...rec, expires: Date.now() - 31 * 864e5 });
  await admin("GET");
  assert.equal(await storage.get(rkey), undefined);
  assert.deepEqual(await ask(tokens[1]), { state: "unknown" });
});

test("admin 📸: 완성된 것은 연락처와 같은 문구(메일은 제목까지)를 보여 주고, 보냄·다시·치우기는 그 신청만", async () => {
  const { call, admin, storage } = await igFormEnv();
  await admin("POST", { action: "new" });
  await call("POST", "/_fortune/ig-form", igBody("insta.person", { name: "토끼" }));
  await call("POST", "/_fortune/ig-form", mailBody("mail@example.com", { name: "" }));
  await call("POST", "/_fortune/ig-form", igBody("stuck"));
  const { requests } = await (await call("GET", "/_fortune/ig-form-requests", undefined, AUTH)).json();
  const [ig, mail, stuck] = requests;
  assert.equal((await admin("POST", { action: "sent", id: ig.id })).status, 409);   // 아직 링크가 없다
  await call("POST", `/_fortune/ig-form-requests/${ig.id}/ready`, { status: "ready", link: IG_LINK }, AUTH);
  await call("POST", `/_fortune/ig-form-requests/${mail.id}/ready`, { status: "ready", link: IG_LINK2 }, AUTH);
  await call("POST", `/_fortune/ig-form-requests/${stuck.id}/ready`, { status: "failed", reason: "점검 실패" }, AUTH);
  const view = (await (await admin("GET")).json()).pending;
  assert.deepEqual(view.map((p) => [p.to, p.state]), [["insta.person", "ready"], ["mail@example.com", "ready"], ["stuck", "failed"]]);
  assert.deepEqual(view[0].message, { subject: "다그당스 만화 사주가 나왔어요",
    text: `토끼님 만화 사주 나왔승! 🐴\n👉 ${IG_LINK}\n(7일 동안 받을 수 있어요)` });
  assert.equal(view[1].message.text, `만화 사주 나왔승! 🐴\n👉 ${IG_LINK2}\n(7일 동안 받을 수 있어요)`);   // 이름이 없으면 이름 없이
  assert.equal(view[2].failed, "점검 실패");
  for (const bad of [{ action: "sent" }, { action: "sent", id: "nope" }, { action: "drop", id: "../x" }]) {
    assert.equal((await admin("POST", bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await admin("POST", { action: "sent", id: "0000000000000000" })).status, 404);
  await admin("POST", { action: "retry", id: stuck.id });
  assert.deepEqual((await (await call("GET", "/_fortune/ig-form-requests", undefined, AUTH)).json()).requests.map((r) => [r.handle, r.failed]),
    [["stuck", undefined]]);   // 서버 표시만 지운다(집 PC 의 FAILED 파일은 사람이 지운다)
  await admin("POST", { action: "drop", id: stuck.id });
  await admin("POST", { action: "sent", id: ig.id });
  assert.deepEqual((await (await admin("GET")).json()).pending.map((p) => p.to), ["mail@example.com"]);
  // 보낸 뒤에는 같은 아이디가 다음 회차에 다시 신청할 수 있다
  assert.equal(await storage.get("igform:handle:insta.person"), undefined);
  assert.equal(await storage.get("igform:handle:stuck"), undefined);
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

// 2026-11-15 같은 별점·글·별명의 후기가 20초 간격으로 두 번 쌓였다 — 10분 안의 똑같은 후기는 저장·알림 없이 ok.
test("후기: 10분 안에 똑같은 후기가 또 오면 저장도 알림도 하지 않고, 하나라도 다르거나 10분이 지나면 받는다", async () => {
  const { call, storage } = await reviewEnv(DISCORD);
  const sent = [];
  const body = { rating: 5, text: "그림이 너무 귀여워요!", nick: "곰돌이" };
  await withFetch(async (url, init) => { sent.push(JSON.parse(init.body).content); return new Response("{}"); }, async () => {
    assert.deepEqual(await (await call("POST", "/_fortune/review", body)).json(), { ok: true });
    assert.deepEqual(await (await call("POST", "/_fortune/review", { ...body, text: "  그림이 너무 귀여워요!  " })).json(), { ok: true });
    assert.equal((await storage.list({ prefix: "review:item:" })).size, 1);
    assert.equal(await storage.get("review:count"), 1);
    assert.equal(sent.length, 1);
    // 별점·별명이 다르면 다른 후기다
    await call("POST", "/_fortune/review", { ...body, rating: 4 });
    await call("POST", "/_fortune/review", { ...body, nick: "" });
    assert.equal((await storage.list({ prefix: "review:item:" })).size, 3);
    // 10분이 지난 똑같은 후기는 다시 받는다
    for (const [key, item] of await storage.list({ prefix: "review:item:" })) {
      await storage.put(key, { ...item, created: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
    }
    await call("POST", "/_fortune/review", body);
    assert.equal((await storage.list({ prefix: "review:item:" })).size, 4);
    assert.equal(await storage.get("review:count"), 4);
    assert.equal(sent.length, 4);
  });
});

test("후기 admin: 목록은 최신순, 하나를 지우면 review:count 도 준다", async () => {
  const { handleFortuneReviewAdmin } = await import("./fortune.js");
  const { call, storage } = await reviewEnv();
  const env = { FORTUNE: { idFromName: () => "global", get: () => ({ fetch: (u, i) => fortune.fetch(new Request(u, i)) }) } };
  const fortune = new FortuneDO({ storage }, {});
  const admin = (method, query = "") => {
    const url = new URL(`https://admin.bubblelab.dev/api/fortune/reviews${query}`);
    return handleFortuneReviewAdmin(new Request(url, { method }), env, url);
  };
  for (const [i, text] of ["첫 번째 후기예요", "두 번째 후기예요", "세 번째 후기예요"].entries()) {
    await call("POST", "/_fortune/review", { rating: i + 3, text });
    await new Promise((r) => setTimeout(r, 2));   // 키(작성 시각)가 겹치지 않게
  }
  let res = await admin("GET");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  let { reviews } = await res.json();
  assert.deepEqual(reviews.map((r) => r.text), ["세 번째 후기예요", "두 번째 후기예요", "첫 번째 후기예요"]);
  res = await admin("DELETE", `?id=${encodeURIComponent(reviews[1].id)}`);
  assert.deepEqual(await res.json(), { ok: true, count: 2 });
  assert.equal(await storage.get("review:count"), 2);
  ({ reviews } = await (await admin("GET")).json());
  assert.deepEqual(reviews.map((r) => r.text), ["세 번째 후기예요", "첫 번째 후기예요"]);
  assert.equal((await admin("DELETE", "?id=nope")).status, 404);
  assert.equal((await admin("DELETE")).status, 400);
  assert.equal((await admin("POST")).status, 405);
  assert.equal(await admin("GET", "").then((r) => r.status), 200);
  const other = new URL("https://admin.bubblelab.dev/api/other");
  assert.equal(await handleFortuneReviewAdmin(new Request(other), env, other), null);
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

// 회귀(2026-11-14): 워커 앞단 공통 한도(64KB)에 막혀 링크 파일 올리기가 전부 413 이었다.
test("다운로드 링크: 워커 앞단 본문 한도가 파일 올리기(최대 12MB)를 막지 않는다", async () => {
  const { shareBodyLimit, SHARE_MAX_BYTES } = await import("./fortune-share.js");
  const { validateMutationRequest } = await import("./security.js");
  const { readFileSync } = await import("node:fs");
  const path = "/_fortune/share/AAAAAAAAAAAAAAAAAAAAAA/saju_comic.pdf";
  const put = (len) => new Request(`https://util.bubblelab.dev${path}`, { method: "PUT", headers: { "Content-Length": String(len) } });
  assert.equal(validateMutationRequest(put(3 * 1024 * 1024), shareBodyLimit(path)), null);
  assert.equal(validateMutationRequest(put(SHARE_MAX_BYTES + 1), shareBodyLimit(path)).status, 413);
  assert.equal(shareBodyLimit("/_fortune/share"), null);
  assert.equal(shareBodyLimit("/_fortune/review"), null);
  assert.match(readFileSync(new URL("./worker.js", import.meta.url), "utf8"), /shareBodyLimit\(path\)/);
});

// ── 손금 베타(util/fortune/palm) ── 사진은 R2 에 잠깐, 집 PC 가 한 번에 한 건 가져가 결과를 올린다.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
async function palmEnv(extra = {}) {
  const { handleFortunePalm } = await import("./fortune.js");
  const storage = new MemoryStorage();
  const bucket = new FakeR2();
  const env = { COMIC_SINK_SECRET: "sink-secret", FORTUNE_BUCKET: bucket, ENABLE_PALM: "true", ...extra };
  const fortune = new FortuneDO({ storage }, env);
  env.FORTUNE = { idFromName: () => "global", get: () => ({ fetch: (i, n) => fortune.fetch(new Request(i, n)) }) };
  const call = (method, path, body, headers = {}) => {
    const url = new URL(`https://util.bubblelab.dev${path}`);
    return handleFortunePalm(new Request(url, { method, headers, ...(body === undefined ? {} : { body }) }), env, url);
  };
  const upload = (hand = "right", body = JPEG, type = "image/jpeg") => call("POST", `/_fortune/palm/jobs${hand ? `?hand=${hand}` : ""}`, body, { "Content-Type": type });
  const beat = () => call("POST", "/_fortune/palm/heartbeat", undefined, AUTH);
  const claim = async () => (await (await call("POST", "/_fortune/palm/claim", undefined, AUTH)).json()).job;
  const job = async (id) => (await call("GET", `/_fortune/palm/jobs/${id}`)).json();
  const result = (id, body) => call("POST", `/_fortune/palm/jobs/${id}/result`, JSON.stringify(body), { ...AUTH, "Content-Type": "application/json" });
  return { storage, bucket, call, upload, beat, claim, job, result };
}
const palmOk = (id, extra = {}) => ({
  schema: "palm.m2.v1", job_id: id, ok: true, status: "ok",
  hand: { declared: "right", detected: "right", mismatch: false },
  image: { w: 1350, h: 1800, coords: "normalized_0_1", exif_rotated: true },
  lines: { life: { drawn: true, color: "#e4572e", pieces: [[[0.4, 0.5], [0.41, 0.6]]] } },
  reading: { markdown: "### 한눈에\n좋아요", checks_passed: true, lang: "ko" }, traits: [], photo: { hints: [], tip: null }, ...extra,
});
const palmFail = (id, code, retryable = false) => ({
  schema: "palm.m2.v1", job_id: id, ok: false, status: retryable ? "error" : "rejected",
  error: { code, message: "손바닥이 아닌 쪽(손등 등)이 찍힌 것 같아요.", retryable },
});
async function withClock(start, fn) {
  const real = Date.now;
  let now = start;
  Date.now = () => now;
  try { return await fn((ms) => { now += ms; }); } finally { Date.now = real; }
}

test("손금: ENABLE_PALM 이 \"true\" 가 아니면 화면·집 PC 경로가 전부 503 이다(fail-closed)", async () => {
  for (const flag of [undefined, "false", "1"]) {
    const { call, upload } = await palmEnv({ ENABLE_PALM: flag });
    assert.equal((await call("GET", "/_fortune/palm/status")).status, 503);
    assert.equal((await upload()).status, 503);
    assert.equal((await call("POST", "/_fortune/palm/claim", undefined, AUTH)).status, 503);
  }
  const { call } = await palmEnv({ FORTUNE_BUCKET: undefined });
  assert.equal((await call("GET", "/_fortune/palm/status")).status, 503);
  const wrangler = (await import("node:fs")).readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  // 2026-11-16 사용자 품질 확인용으로 켰다 — 대신 확인이 끝날 때까지 운세 노트 첫 화면에는 링크를 달지 않는다.
  assert.match(wrangler, /"ENABLE_PALM": "(true|false)"/, "배포 설정에 ENABLE_PALM 을 명시한다");
  const home = (await import("node:fs")).readFileSync(new URL("../fortune/note/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(home, /href="palm\//, "품질 확인 전까지 운세 노트 첫 화면에 손금 링크 금지");
});

test("손금: 사진은 손·형식·크기를 보고 받고, 집 PC 가 꺼져 있으면 받지 않고 R2 에도 남기지 않는다", async () => {
  const { palmBodyLimit, PALM } = await import("./fortune.js");
  const { validateMutationRequest } = await import("./security.js");
  const { call, upload, beat, bucket, job } = await palmEnv();
  assert.equal((await upload("both")).status, 400);
  assert.equal((await upload("right", JPEG, "image/gif")).status, 415);
  assert.equal((await upload("right", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).status, 400, "JPEG·PNG 머리가 아니면 거절");
  assert.equal((await upload("right", new Uint8Array(PALM.maxBytes + 1).fill(0xff))).status, 413);
  const path = "/_fortune/palm/jobs";
  const big = new Request(`https://util.bubblelab.dev${path}`, { method: "POST", headers: { "Content-Length": String(PALM.maxBytes + 1) } });
  assert.equal(validateMutationRequest(big, palmBodyLimit(path)).status, 413);
  assert.equal(palmBodyLimit(path), PALM.maxBytes, "워커 공통 64KB 한도를 사진 경로만 넘긴다");
  assert.equal(palmBodyLimit("/_fortune/palm/status"), null);
  assert.match((await import("node:fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8"), /palmBodyLimit\(path\)/);

  const off = await upload();
  assert.equal(off.status, 503);
  assert.equal((await off.json()).error, "offline");
  assert.equal(bucket.data.size, 0, "거절한 사진은 R2 에서 바로 지운다");
  assert.deepEqual(await (await call("GET", "/_fortune/palm/status")).json(), { online: false, queue: 0 });

  await beat();
  const made = await (await upload("left")).json();
  assert.match(made.id, /^[0-9a-f]{16}$/);
  assert.equal(made.position, 0);
  assert.ok(bucket.data.has(`palm/${made.id}`));
  assert.deepEqual(await job(made.id), { state: "queued", online: true, position: 0 });
  assert.equal((await call("GET", "/_fortune/palm/jobs/0123456789abcdef")).status, 404);
  assert.equal((await upload("right", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "image/png")).status, 200, "PNG 도 받는다");
});

test("손금: 왼손·오른손은 묻지 않는다 — hand 가 없거나 auto 면 auto 로 집 PC 에 넘긴다(m2_run 이 사진에서 알아봄)", async () => {
  const { upload, beat, claim } = await palmEnv();
  await beat();
  assert.equal((await upload("")).status, 200, "hand 없이");
  assert.equal((await upload("auto")).status, 200);
  assert.equal((await upload("AUTO")).status, 400);
  assert.equal((await claim()).hand, "auto");
});

test("손금: 집 PC 는 시크릿으로 한 번에 한 건 가져가 사진을 받고, 결과를 올리면 사진이 바로 지워진다", async () => {
  const { call, upload, beat, claim, job, result, bucket, storage } = await palmEnv();
  await beat();
  const a = (await (await upload("right")).json()).id;
  const b = (await (await upload("left")).json()).id;
  assert.equal((await job(b)).position, 1);
  assert.equal((await call("POST", "/_fortune/palm/claim")).status, 401);
  assert.equal((await call("POST", "/_fortune/palm/claim", undefined, { Authorization: "Bearer nope" })).status, 401);
  assert.equal((await call("GET", `/_fortune/palm/jobs/${a}/photo`, undefined, AUTH)).status, 409, "가져가기 전에는 사진을 안 준다");
  assert.equal((await call("POST", `/_fortune/palm/jobs/${a}/result`, JSON.stringify(palmOk(a)))).status, 401);

  const got = await claim();
  assert.deepEqual(got, { id: a, hand: "right", attempt: 1 });
  assert.equal(await claim(), null, "한 건이 도는 동안은 다음 것을 주지 않는다");
  assert.equal((await job(a)).state, "running");
  const photo = await call("GET", `/_fortune/palm/jobs/${a}/photo`, undefined, AUTH);
  assert.equal(photo.status, 200);
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), JPEG);

  assert.equal((await result(a, { ...palmOk(a), schema: "palm.m1" })).status, 400);
  assert.equal((await result(a, palmOk(b))).status, 400, "job_id 가 다르면 거절");
  const ok = await result(a, palmOk(a, { render_jpg_b64: "AAAA" }));
  assert.deepEqual(await ok.json(), { ok: true, state: "done" });
  assert.equal(bucket.data.has(`palm/${a}`), false, "결과를 올리면 R2 사진을 바로 지운다");
  const done = await job(a);
  assert.equal(done.state, "done");
  assert.equal(done.result.reading.markdown, "### 한눈에\n좋아요");
  assert.equal("render_jpg_b64" in done.result, false, "그림은 서버에 남기지 않는다");
  assert.equal(JSON.stringify([...storage.data.values()]).includes("AAAA"), false);
  assert.equal((await result(a, palmOk(a))).status, 409, "끝난 일에 두 번 올리지 못한다");
  assert.equal((await call("DELETE", `/_fortune/palm/jobs/${a}/photo`, undefined, AUTH)).status, 200, "지우기는 몇 번 불러도 된다");

  assert.equal((await claim()).id, b);
  const rejected = await (await result(b, palmFail(b, "NOT_PALM"))).json();
  assert.equal(rejected.state, "failed");
  assert.equal((await job(b)).result.error.code, "NOT_PALM", "거절 문구는 화면이 그대로 쓴다");
  assert.equal(bucket.data.size, 0);
});

test("손금: 임대가 끝나거나 TIMEOUT 이면 한 번만 다시 하고, 그다음은 TIMEOUT 실패 — 사진도 지운다", async () => {
  await withClock(1_000_000, async (tick) => {
    const { upload, beat, claim, job, result, bucket, call } = await palmEnv();
    await beat();
    const id = (await (await upload()).json()).id;
    assert.equal((await claim()).attempt, 1);
    tick(121_000);                                   // 집 PC 가 죽어 임대가 끝났다
    assert.equal((await job(id)).state, "queued");
    assert.equal((await claim()).attempt, 2);
    tick(121_000);
    const gone = await job(id);
    assert.equal(gone.state, "failed");
    assert.equal(gone.result.error.code, "TIMEOUT");
    assert.equal(bucket.data.has(`palm/${id}`), false);

    // 데몬이 90초에 끊고 TIMEOUT 을 올리는 경우도 같은 셈
    await beat();
    const t = (await (await upload()).json()).id;
    await claim();
    assert.equal((await (await result(t, palmFail(t, "TIMEOUT", true))).json()).state, "queued");
    assert.ok(bucket.data.has(`palm/${t}`), "다시 할 거라 사진은 남긴다");
    assert.equal((await claim()).attempt, 2);
    assert.equal((await (await result(t, palmFail(t, "TIMEOUT", true))).json()).state, "failed");
    assert.equal(bucket.data.has(`palm/${t}`), false);

    // 도는 동안은 하트비트가 오래돼도 "쉬어요"가 아니다
    await beat();
    const r = (await (await upload()).json()).id;
    await claim();
    tick(70_000);
    assert.equal((await job(r)).online, true);
    await result(r, palmOk(r));
    assert.equal((await (await call("GET", "/_fortune/palm/status")).json()).online, true, "결과를 올린 것도 소식이다");
    tick(61_000);
    assert.equal((await (await call("GET", "/_fortune/palm/status")).json()).online, false, "1분 소식이 없으면 쉬어요");
  });
});

test("손금: 차례는 10건까지, 아무도 안 가져가면 15분 뒤 실패, 결과는 한 시간 뒤 지워진다", async () => {
  await withClock(5_000_000, async (tick) => {
    const { upload, beat, claim, job, result, bucket } = await palmEnv();
    await beat();
    const ids = [];
    for (let i = 0; i < 10; i++) ids.push((await (await upload()).json()).id);
    const busy = await upload();
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).error, "busy");
    assert.equal(bucket.data.size, 10);
    tick(16 * 60_000);
    await beat();
    for (const id of ids) assert.equal((await job(id)).result.error.code, "TIMEOUT");
    assert.equal(bucket.data.size, 0, "기다리다 끝난 사진도 지운다");

    const id = (await (await upload()).json()).id;
    await claim();
    await result(id, palmOk(id));
    tick(59 * 60_000);
    assert.equal((await job(id)).state, "done");
    tick(2 * 60_000);
    assert.equal((await job(id)).state, undefined);
  });
});

// ── 글꼴 조각: 동적 글(손금 풀이·궁합 이름)도 같은 글꼴로 ──
// 2026-11-16 손금 풀이의 '옅'이 네모로 나왔다. 조각 이름이 늘 같아(body-core.woff2) 폰에 30일 캐시된 옛 조각과
// 새 fonts.css 가 섞였고, 새 css 가 "core 에 있다"고 한 글자를 옛 core 파일이 .notdef 로 그렸다.
// 그래서 이름에 내용 해시를 붙이고, 모든 한글 음절이 어떤 조각의 unicode-range 에 들고 그 woff2 에 실제 글리프가 있는지 본다.
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT",
  "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];
/** woff2 를 풀어 cmap(코드포인트 → 글리프 번호)과 글리프 수를 돌려준다(WOFF2 §5, cmap 형식 4·12). */
async function woff2Cmap(bytes) {
  const { brotliDecompressSync } = await import("node:zlib");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0), 0x774f4632, "wOF2");
  const numTables = dv.getUint16(12);
  let o = 48;
  const b128 = () => { let v = 0; for (;;) { const b = dv.getUint8(o++); v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = dv.getUint8(o++);
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = String.fromCharCode(...bytes.subarray(o, o + 4)); o += 4; }
    const orig = b128(), ver = flags >> 6;
    const transformed = tag === "glyf" || tag === "loca" ? ver === 0 : ver !== 0;
    tables.push({ tag, length: transformed ? b128() : orig });
  }
  const data = brotliDecompressSync(bytes.subarray(o, o + dv.getUint32(20)));
  let at = 0;
  const t = {};
  for (const tb of tables) { t[tb.tag] = data.subarray(at, at + tb.length); at += tb.length; }
  const view = (u) => new DataView(u.buffer, u.byteOffset, u.byteLength);
  const numGlyphs = view(t.maxp).getUint16(4);
  const cm = view(t.cmap), map = new Map();
  for (let i = 0, n = cm.getUint16(2); i < n; i++) {
    const off = cm.getUint32(4 + i * 8 + 4), fmt = cm.getUint16(off);
    if (fmt === 12) {
      for (let g = 0, ng = cm.getUint32(off + 12); g < ng; g++) {
        const r = off + 16 + g * 12, start = cm.getUint32(r), end = cm.getUint32(r + 4), gid = cm.getUint32(r + 8);
        for (let c = start; c <= end; c++) map.set(c, gid + c - start);
      }
    } else if (fmt === 4) {
      const seg = cm.getUint16(off + 6) / 2, ends = off + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ros = deltas + seg * 2;
      for (let k = 0; k < seg; k++) {
        const end = cm.getUint16(ends + k * 2), start = cm.getUint16(starts + k * 2), delta = cm.getInt16(deltas + k * 2), ro = cm.getUint16(ros + k * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid = ro ? cm.getUint16(ros + k * 2 + ro + (c - start) * 2) : c;
          if (gid) gid = (gid + delta) & 0xffff;
          if (!map.has(c)) map.set(c, gid);
        }
      }
    }
  }
  return { map, numGlyphs };
}

test("글꼴 조각: 이름에 내용 해시가 붙고(옛 캐시와 안 섞임), 한글 11,172자가 본문·손글씨 조각에 빠짐없이 한 번씩 든다", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const dir = new URL("../fortune/fonts/", import.meta.url);
  const css = readFileSync(new URL("fonts.css", dir), "utf8");
  const faces = [...css.matchAll(/font-family: "(\w+)"; src: url\("([^"]+)"\)[^;]*; font-display: swap; unicode-range: ([^;]+);/g)]
    .map(([, family, file, range]) => ({ family, file, range }));
  const files = new Set(faces.map((f) => f.file));
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".woff2")).sort(), [...files].sort(), "fonts.css 가 부르지 않는 조각·없는 조각");
  for (const f of files) {
    const m = /-([0-9a-f]{10})\.woff2$/.exec(f);
    assert.ok(m, `${f} 이름에 해시가 없다`);
    assert.equal(createHash("sha256").update(readFileSync(new URL(f, dir))).digest("hex").slice(0, 10), m[1], `${f} 해시가 내용과 다르다`);
  }
  const page = readFileSync(new URL("../fortune/note/index.html", import.meta.url), "utf8");
  const preloads = [...page.matchAll(/rel="preload" href="fonts\/([^"]+)"/g)].map((m) => m[1]);
  assert.equal(preloads.length, 2);
  for (const p of preloads) assert.ok(files.has(p) && /-core-/.test(p), `preload ${p} 가 지금 기본 조각이 아니다`);
  const cover = (range) => range.split(",").flatMap((part) => {
    const [a, b] = part.replace(/U\+/g, "").split("-").map((x) => parseInt(x, 16));
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  });
  for (const family of ["NoteBody", "NoteHand"]) {
    const seen = new Map();
    for (const f of faces.filter((x) => x.family === family)) for (const c of cover(f.range)) if (c >= 0xac00 && c <= 0xd7a3) {
      assert.ok(!seen.has(c), `${family} ${String.fromCodePoint(c)} 가 두 조각에 있다`);
      seen.set(c, f.file);
    }
    assert.equal(seen.size, 11172, `${family} 가 덮지 못한 한글이 있다`);
  }
});

test("글꼴 조각: 기본 조각에 없던 한글(옅·뷁·똠·쀍·햏·갃)도 그 글자를 맡은 woff2 에 실제 글리프가 있다(.notdef 아님)", async () => {
  const { readFileSync } = await import("node:fs");
  const dir = new URL("../fortune/fonts/", import.meta.url);
  const css = readFileSync(new URL("fonts.css", dir), "utf8");
  const faces = [...css.matchAll(/font-family: "(\w+)"; src: url\("([^"]+)"\)[^;]*; font-display: swap; unicode-range: ([^;]+);/g)]
    .map(([, family, file, range]) => ({ family, file, range }));
  const inRange = (range, c) => range.split(",").some((part) => {
    const [a, b] = part.replace(/U\+/g, "").split("-").map((x) => parseInt(x, 16));
    return c >= a && c <= (b ?? a);
  });
  const cache = new Map();
  for (const family of ["NoteBody", "NoteHand"]) {
    const core = faces.find((f) => f.family === family && /-core-/.test(f.file));
    for (const ch of "옅뷁똠쀍햏갃") {
      const c = ch.codePointAt(0);
      const face = faces.filter((f) => f.family === family && inRange(f.range, c)).at(-1);   // 같은 이름이면 나중 것이 먼저 쓰인다
      assert.ok(face, `${family} 에 ${ch} 를 맡은 조각이 없다`);
      if (ch !== "옅") assert.notEqual(face, core, `${ch} 는 기본 조각 밖 글자로 시험한다`);
      if (!cache.has(face.file)) cache.set(face.file, await woff2Cmap(readFileSync(new URL(face.file, dir))));
      const { map, numGlyphs } = cache.get(face.file);
      const gid = map.get(c);
      assert.ok(gid > 0 && gid < numGlyphs, `${family} ${face.file} 이 ${ch} 를 .notdef 로 그린다`);
    }
  }
});

// ── 손금 이름표 ── 선 시작점이 붙어 있어도(생명선·두뇌선이 붙어 시작하는 손이 흔하다) 겹치지 않고 사진 안에.
test("손금 이름표: 시작점이 겹치는 선들도 이름표가 서로 겹치지 않고 사진 밖으로 나가지 않는다", async () => {
  const { anchorsOf, placeLabels, labelsOverlap } = await import("../fortune/palm/labels.js");
  const line = (x0, y0, dx, dy, n = 40) => [Array.from({ length: n }, (_, i) => [x0 + dx * i / n, y0 + dy * i / n])];
  const check = (W, H, lines, w = W / 7, h = W / 21) => {
    const spots = placeLabels(lines.map((pieces, i) => ({ key: `k${i}`, w, h, anchors: anchorsOf(pieces, W, H) })), W, H, { gap: 8, margin: 6 });
    for (const s of spots) {
      assert.ok(s.x >= 6 && s.y >= 6 && s.x + s.w <= W - 6 && s.y + s.h <= H - 6, `${s.key} 가 사진 밖 ${JSON.stringify(s)}`);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      assert.ok(!labelsOverlap(spots[i], spots[j]), `${spots[i].key}·${spots[j].key} 겹침`);
    }
    return spots;
  };
  // 2026-11-16 사용자 사진: 생명선 (0.6002,0.5821)·두뇌선 (0.609,0.5898) 에서 시작
  check(1350, 1800, [line(0.6002, 0.5821, -0.11, 0.29), line(0.609, 0.5898, -0.38, 0.13), line(0.62, 0.575, 0.2, -0.1)]);
  // 네 선이 한 점에서
  check(1350, 1800, [line(0.5, 0.5, -0.3, 0), line(0.5, 0.5, 0.3, 0), line(0.5, 0.5, 0, 0.3), line(0.5, 0.5, 0, -0.3)]);
  // 사진 가장자리에서 시작
  check(1350, 1800, [line(0, 0, 0.2, 0.2), line(1, 1, -0.2, -0.2), line(1, 0, -0.2, 0.2), line(0, 1, 0.2, -0.2)]);
  // 짧은 선 둘이 같은 점에서(옮겨 갈 자리가 적어도)
  check(600, 800, [line(0.4, 0.4, 0.01, 0.01, 3), line(0.4, 0.4, 0.01, 0.01, 3)]);
});

// ── 접수증 「완성되면 알림 받기」 — 토큰·구독은 본문으로만, 처음 ready 때 한 번 보내고 지운다 ──
async function receiptPushEnv() {
  const vapid = await generateVapidKeys();
  const ctx = await igFormEnv({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey });
  // 서버 저장소에 쓰인 모든 키·값을 남긴다 — 토큰 원문이 한 번이라도 쓰였는지 본다(지운 뒤 확인으로는 못 잡는다)
  const writes = [];
  const put = ctx.storage.put.bind(ctx.storage);
  ctx.storage.put = async (key, value) => { writes.push(JSON.stringify([key, value])); return put(key, value); };
  const neverStored = (tokens) => {
    for (const t of tokens) assert.ok(!writes.some((w) => w.includes(t)), "토큰 원문이 서버 저장소에 쓰였다");
  };
  await ctx.admin("POST", { action: "new" });
  const pushes = [];
  ctx.fortune.sendWebPush = async (sub, payload, _vapid, opts) => { pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts }); return { ok: true }; };
  const apply = async (body) => (await (await ctx.call("POST", "/_fortune/ig-form", body)).json()).receipt;
  const ids = async () => (await (await ctx.call("GET", "/_fortune/ig-form-requests", undefined, AUTH)).json()).requests.map((r) => r.id);
  const subscribe = (token, subscription) => ctx.call("POST", "/_fortune/ig-form/receipt/push", { token, subscription });
  return { ...ctx, pushes, apply, ids, subscribe, writes, neverStored };
}
const fcm = (n) => fakeSubscription(`https://fcm.googleapis.com/fcm/send/receipt-${n}`);

test("접수증 알림: 본문 검사 — GET·주소 토큰 거절, 틀린 토큰·구독은 400, 모르는 토큰 404, VAPID 없으면 503", async () => {
  const { call, apply, subscribe } = await receiptPushEnv();
  const token = await apply(igBody("push.one"));
  const sub = await fcm(1);
  assert.equal((await call("GET", `/_fortune/ig-form/receipt/push?token=${token}`)).status, 405);
  assert.equal((await subscribe("short", sub)).status, 400);
  assert.equal((await subscribe(token, { ...sub, endpoint: "https://evil.example/push" })).status, 400);
  assert.equal((await subscribe(token, { endpoint: sub.endpoint, keys: { p256dh: "x", auth: "y" } })).status, 400);
  assert.equal((await subscribe(token, null)).status, 400);
  assert.equal((await subscribe("A".repeat(43), sub)).status, 404);
  assert.equal((await call("POST", "/_fortune/ig-form/receipt/push", { token, subscription: sub }, { "Content-Length": "5000" })).status, 413);
  assert.deepEqual(await (await subscribe(token, sub)).json(), { ok: true });
  const { call: bare, admin } = await igFormEnv();
  await admin("POST", { action: "new" });
  const t2 = (await (await bare("POST", "/_fortune/ig-form", igBody("no.vapid"))).json()).receipt;
  assert.equal((await bare("POST", "/_fortune/ig-form/receipt/push", { token: t2, subscription: sub })).status, 503);
});

test("접수증 알림: 기기 2대까지(같은 기기는 바꿔 끼움), 처음 ready 때 한 번만 보내고 지운다 — 주소엔 토큰 없음, 다시 보고해도 안 보낸다", async () => {
  const { storage, call, pushes, apply, ids, subscribe, neverStored } = await receiptPushEnv();
  const token = await apply(igBody("push.two"));
  const [id] = await ids();
  const [a, b, c] = [await fcm("a"), await fcm("b"), await fcm("c")];
  for (const s of [a, b, a, c]) assert.equal((await subscribe(token, s)).status, 200);
  const rec = await storage.get(`igform:push:${id}`);
  assert.deepEqual(rec.subs.map((s) => s.endpoint.split("-").pop()), ["a", "c"]);   // b 는 밀려났고 a 는 한 번만
  assert.deepEqual(Object.keys(rec), ["subs"]);   // 구독만 — 토큰은 키(id)를 해시로 찾았을 뿐
  const ready = () => call("POST", `/_fortune/ig-form-requests/${id}/ready`, { status: "ready", link: IG_LINK }, AUTH);
  assert.deepEqual(await (await ready()).json(), { ok: true });
  assert.equal(pushes.length, 2);
  for (const p of pushes) {
    assert.deepEqual(p.payload, { title: "만화 사주가 완성됐어요", body: "접수증에서 바로 보고 내려받을 수 있어요.",
      url: "https://util.bubblelab.dev/fortune/receipt/", tag: "comic-ready" });   // 토큰 없이 — 화면이 기기 저장소로 복원
  }
  assert.equal(await storage.get(`igform:push:${id}`), undefined);
  assert.equal((await ready()).status, 200);
  assert.equal(pushes.length, 2, "재보고에 다시 보냈다");
  // 완성된 뒤에는 새로 구독하지 않는다(접수증이 바로 완성을 보여 준다)
  assert.equal((await subscribe(token, a)).status, 409);
  assert.equal(await storage.get(`igform:push:${id}`), undefined);
  // 회귀: 서버 저장소에 토큰 원문이 한 번도 쓰이지 않았고, 알림 본문에도 없다
  neverStored([token]);
  assert.ok(!JSON.stringify(pushes).includes(token));
});

test("접수증 알림: 보내기가 실패·예외여도 ready 는 성공하고 구독은 지운다, 멈춤(failed) 보고에는 보내지 않는다", async () => {
  const { storage, call, fortune, pushes, apply, ids, subscribe, neverStored } = await receiptPushEnv();
  const token = await apply(igBody("push.three"));
  const [id] = await ids();
  await subscribe(token, await fcm("x"));
  await subscribe(token, await fcm("y"));
  assert.equal((await call("POST", `/_fortune/ig-form-requests/${id}/ready`, { status: "failed", reason: "점검" }, AUTH)).status, 200);
  assert.equal(pushes.length, 0);
  assert.ok(await storage.get(`igform:push:${id}`), "멈춤에도 구독은 남아 다시 그린 뒤 보낸다");
  let calls = 0;
  fortune.sendWebPush = async () => { calls += 1; if (calls === 1) throw new Error("network"); return { ok: false, gone: true, status: 410 }; };
  const res = await call("POST", `/_fortune/ig-form-requests/${id}/ready`, { status: "ready", link: IG_LINK }, AUTH);
  assert.deepEqual([res.status, await res.json()], [200, { ok: true }]);
  assert.equal(calls, 2);
  assert.equal(await storage.get(`igform:push:${id}`), undefined);
  neverStored([token]);
});

test("접수증 알림: 보냄·치우기·done 이면 구독도 지운다, 토큰 원문은 한 번도 저장되지 않는다", async () => {
  const { storage, call, admin, apply, ids, subscribe, neverStored } = await receiptPushEnv();
  const tokens = [await apply(igBody("p.sent")), await apply(igBody("p.drop")), await apply(igBody("p.done"))];
  const [sentId, dropId, doneId] = await ids();
  for (const t of tokens) assert.equal((await subscribe(t, await fcm(t.slice(0, 6)))).status, 200);
  assert.equal((await storage.list({ prefix: "igform:push:" })).size, 3);
  // 보냄 — 보통은 ready 때 이미 지워졌지만, 남아 있어도 보냄이 지우는지 본다(링크만 직접 붙인다)
  await storage.put(`igform:req:${sentId}`, { ...(await storage.get(`igform:req:${sentId}`)), link: IG_LINK, expires: Date.now() + 864e5 });
  await admin("POST", { action: "sent", id: sentId });
  await admin("POST", { action: "drop", id: dropId });
  await call("POST", `/_fortune/ig-form-requests/${doneId}/done`, undefined, AUTH);
  assert.equal((await storage.list({ prefix: "igform:push:" })).size, 0);
  neverStored(tokens);
});

test("내일 확인 캘린더(.ics): text/calendar·no-store, 다음 날 10:00 KST 15분·알람, 접수증 기본 주소만(토큰 없음)", async () => {
  const { reminderIcs } = await import("./fortune-igform.js");
  const { call, apply } = await receiptPushEnv();
  const token = await apply(igBody("cal.one"));
  const res = await call("GET", "/_fortune/ig-form/reminder.ics");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Disposition"), /^inline; filename="[a-z-]+\.ics"$/);
  const text = await res.text();
  assert.ok(!text.includes(token));
  assert.doesNotMatch(text, /#[A-Za-z0-9_-]{20,}/);
  assert.equal((await call("POST", "/_fortune/ig-form/reminder.ics", {})).status, 405);
  // 2026-11-18 23:30 KST(14:30 UTC) → 11-19 10:00 KST, 자정 넘은 00:30 KST(15:30 UTC) → 11-20
  const ics = reminderIcs(Date.UTC(2026, 10, 18, 14, 30));
  assert.match(ics, /\r\nDTSTART:20261119T010000Z\r\nDTEND:20261119T011500Z\r\n/);
  assert.match(reminderIcs(Date.UTC(2026, 10, 18, 15, 30)), /DTSTART:20261120T010000Z/);
  assert.match(ics, /\r\nSUMMARY:만화 사주 확인하기\r\n/);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\n[^]*TRIGGER:PT0M\r\nEND:VALARM/);
  assert.match(ics, /\r\nURL:https:\/\/util\.bubblelab\.dev\/fortune\/receipt\/\r\n/);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `75옥텟 넘는 줄: ${line}`);
});

test("admin 📸 새 회차 정원: cap 1~10 정수만(없음·범위 밖·소수·문자는 10), 신청서 남은 자리·마감·디스코드 N/cap 이 따른다", async () => {
  const { call, admin } = await igFormEnv(DISCORD);
  const capOf = async (cap) => (await (await admin("POST", cap === undefined ? { action: "new" } : { action: "new", cap })).json()).round.cap;
  for (const [cap, want] of [[undefined, 10], [0, 10], [11, 10], [-3, 10], [2.5, 10], ["x", 10], [null, 10], [true, 10], [1, 1], [10, 10], ["4", 4]]) {
    assert.equal(await capOf(cap), want, JSON.stringify(cap));
  }
  assert.equal(await capOf(3), 3);
  assert.deepEqual(await (await call("GET", "/_fortune/ig-form/status")).json(), { open: true, remaining: 3, cap: 3 });
  const sent = [];
  await withFetch(async (url, init) => { sent.push(JSON.parse(init.body).content); return new Response("{}"); }, async () => {
    for (const h of ["cap.a", "cap.b", "cap.c"]) assert.equal((await call("POST", "/_fortune/ig-form", igBody(h))).status, 200);
    const full = await call("POST", "/_fortune/ig-form", igBody("cap.d"));
    assert.equal(full.status, 409);
    assert.equal((await full.json()).error, "full");
  });
  assert.deepEqual(sent.map((s) => s.split("\n")[0]), ["📸 만화 사주 신청 — 이번 회차 1/3", "📸 만화 사주 신청 — 이번 회차 2/3", "📸 만화 사주 신청 — 이번 회차 3/3"]);
  assert.deepEqual(await (await call("GET", "/_fortune/ig-form/status")).json(), { open: false, remaining: 0, cap: 3 });
  // 닫았다 열어도 정원은 그 회차 값 그대로, 새 회차는 다시 고른다
  await admin("POST", { action: "close" });
  assert.equal((await (await admin("POST", { action: "open", cap: 9 })).json()).round.cap, 3);
  assert.equal(await capOf(undefined), 10);
});

test("admin 📸 화면: 정원 고르기(1~10, 기본 10)가 새 회차 요청에 실리고, 인라인 스크립트·innerHTML 없이", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../admin/app.js", import.meta.url), "utf8");
  const select = /<select id="igform-cap"[^>]*>([^]*?)<\/select>/.exec(html);
  assert.ok(select, "정원 select 가 없다");
  assert.deepEqual([...select[1].matchAll(/<option( selected)?>(\d+)<\/option>/g)].map((m) => Number(m[2])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(select[1], /<option selected>10<\/option>/);
  assert.match(js, /igformAction\('new', btn, null, \{ cap: Number\(cap\.value\) \}\)/);
  const igPart = js.slice(js.indexOf("// ── 만화 사주 신청서 (📸)"), js.indexOf("loadStats();", js.indexOf("// ── 만화 사주 신청서 (📸)")));
  assert.doesNotMatch(igPart, /innerHTML|insertAdjacentHTML|on[a-z]+=/);
});
