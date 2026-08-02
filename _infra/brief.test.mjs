import test from "node:test";
import assert from "node:assert/strict";
import {
  airGrade, BRIEF_REGIONS, BriefDO, buildBrief, findRegion, handleBriefToday, skyOf,
} from "./brief.js";
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

const pushReq = (method, body) => new Request("https://brief.internal/push", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

async function fakeSubscription(endpoint) {
  const uaPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const p256dh = b64uEncode(new Uint8Array(await crypto.subtle.exportKey("raw", uaPair.publicKey)));
  const auth = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { endpoint, keys: { p256dh, auth } };
}

// 2026-08-02(일) 09:00 KST = 2026-08-02T00:00Z
const NOON_KST = new Date("2026-08-02T00:00:00Z");

const weatherFixture = (overrides = {}) => ({
  current: { temperature_2m: 24.4, weather_code: 0 },
  daily: {
    time: ["2026-08-02", "2026-08-03"],
    weather_code: [1, 3],
    temperature_2m_max: [31.2, 28.6],
    temperature_2m_min: [22.3, 23.1],
    precipitation_probability_max: [10, 70],
  },
  ...overrides,
});

const briefOf = (overrides = {}, air = airGrade(20, 9)) => buildBrief({
  region: findRegion("seoul"), weather: weatherFixture(overrides), air, now: NOON_KST,
});

test("지역 허용 목록 밖의 값은 받지 않는다", () => {
  assert.equal(findRegion("seoul").name, "서울");
  assert.equal(findRegion("pyongyang"), null);
  assert.equal(findRegion(undefined), null);
  // 화면(util/brief/index.html)이 같은 id 목록을 들고 있으므로 중복·오타를 막는다
  assert.equal(new Set(BRIEF_REGIONS.map((r) => r.id)).size, BRIEF_REGIONS.length);
  for (const r of BRIEF_REGIONS) {
    assert.ok(r.lat > 33 && r.lat < 39, `${r.id} 위도가 한국 범위를 벗어난다`);
    assert.ok(r.lon > 124 && r.lon < 132, `${r.id} 경도가 한국 범위를 벗어난다`);
  }
});

test("WMO 코드를 한국어 하늘 상태로 옮긴다", () => {
  assert.equal(skyOf(0).label, "맑음");
  assert.equal(skyOf(63).label, "비");
  assert.equal(skyOf(75).label, "많은 눈");
  // 모르는 코드에서 undefined가 화면에 새면 안 된다
  assert.equal(skyOf(1234).label, "정보 없음");
  assert.equal(skyOf(null).icon, "❔");
});

test("미세먼지는 환경부 등급 경계를 쓰고, 나쁜 쪽을 대표로 삼는다", () => {
  assert.equal(airGrade(30, 15).label, "좋음");       // 두 경계값 모두 '좋음' 상한
  assert.equal(airGrade(31, 15).label, "보통");
  assert.equal(airGrade(80, 35).label, "보통");
  assert.equal(airGrade(150, 75).label, "나쁨");
  assert.equal(airGrade(151, 10).label, "매우 나쁨");
  // PM10은 좋아도 초미세먼지가 나쁘면 나쁨으로 알려야 마스크를 챙긴다
  assert.equal(airGrade(10, 80).label, "매우 나쁨");
  assert.deepEqual(airGrade(null, null), { pm10: null, pm25: null, label: null, icon: "❔" });
});

test("브리핑 문장을 KST 오늘 기준으로 만든다", () => {
  const brief = briefOf();
  assert.equal(brief.date, "2026-08-02");
  assert.equal(brief.weekday, "일");
  assert.equal(brief.current.temp, 24);
  assert.equal(brief.today.max, 31);
  assert.equal(brief.today.min, 22);
  assert.equal(brief.tomorrow.max, 29);
  assert.match(brief.text, /^8월 2일 일요일, 서울 아침 브리핑입니다\./);
  assert.match(brief.text, /지금 기온은 24도/);
  assert.match(brief.text, /낮 최고 31도, 아침 최저 22도/);
  assert.match(brief.text, /내일은 흐림, 최고 29도/);
  // TTS가 읽을 문장이므로 기호가 아니라 말로 적는다
  assert.doesNotMatch(brief.text, /[°%]/);
});

test("비 올 확률이 높으면 우산을 챙기라고 말한다", () => {
  assert.match(briefOf().text, /비 올 확률은 10퍼센트로 낮습니다/);
  const rainy = briefOf({
    daily: { ...weatherFixture().daily, precipitation_probability_max: [70, 10] },
  });
  assert.match(rainy.text, /70퍼센트입니다\. 우산을 챙기세요/);
});

test("미세먼지가 나쁘면 마스크를 안내한다", () => {
  assert.match(briefOf({}, airGrade(20, 9)).text, /미세먼지는 좋음입니다\./);
  assert.match(briefOf({}, airGrade(160, 9)).text, /매우 나쁨입니다\. 외출할 때 마스크/);
});

test("푸시 한 줄 요약과 제목을 함께 만든다", () => {
  const brief = briefOf();
  assert.equal(brief.summary, "지금 24° · 낮 최고 31° · 미세먼지 좋음");
  assert.equal(brief.title, "🌤️ 서울 아침 브리핑");
  // 10%짜리 강수확률은 줄만 길어지므로 한 줄 요약에서 뺀다
  assert.doesNotMatch(brief.summary, /비 /);
  const rainy = briefOf({
    daily: { ...weatherFixture().daily, precipitation_probability_max: [70, 10] },
  });
  assert.match(rainy.summary, /비 70%/);
});

test("값이 비어도 문장이 깨지지 않는다", () => {
  const empty = buildBrief({
    region: findRegion("jeju"), weather: {}, air: airGrade(null, null), now: NOON_KST,
  });
  assert.equal(empty.today, null);
  assert.equal(empty.current.temp, null);
  assert.equal(empty.text, "8월 2일 일요일, 제주 아침 브리핑입니다.");
  assert.equal(empty.summary, "");
  assert.doesNotMatch(empty.text, /null|undefined|NaN/);
});

test("상류 응답의 오늘이 첫 칸이 아니어도 오늘을 고른다", () => {
  // Open-Meteo가 어제부터 주는 경우가 있다 — 인덱스 0을 오늘로 단정하면 어긋난다
  const shifted = briefOf({
    daily: {
      time: ["2026-08-01", "2026-08-02", "2026-08-03"],
      weather_code: [95, 1, 3],
      temperature_2m_max: [40.0, 31.2, 28.6],
      temperature_2m_min: [30.0, 22.3, 23.1],
      precipitation_probability_max: [90, 10, 70],
    },
  });
  assert.equal(shifted.today.date, "2026-08-02");
  assert.equal(shifted.today.max, 31);
  assert.equal(shifted.tomorrow.date, "2026-08-03");
});

// ── 라우트 ────────────────────────────────────────────────────
test("/_brief/today는 알 수 없는 지역을 400으로 막는다", async () => {
  const url = new URL("https://util.bubblelab.dev/_brief/today?region=../../etc");
  const response = await handleBriefToday(new Request(url), {}, url);
  assert.equal(response.status, 400);
});

test("/_brief/today는 상류 실패를 502로 알린다 (조용히 빈 값 금지)", async () => {
  const url = new URL("https://util.bubblelab.dev/_brief/today?region=busan");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  try {
    const response = await handleBriefToday(new Request(url), {}, url);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally { globalThis.fetch = originalFetch; }
});

test("/_brief/today는 미세먼지가 실패해도 날씨만으로 응답한다", async () => {
  const url = new URL("https://util.bubblelab.dev/_brief/today?region=seoul");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (target) => {
    if (String(target).includes("air-quality")) return new Response("nope", { status: 503 });
    return Response.json(weatherFixture());
  };
  try {
    const response = await handleBriefToday(new Request(url), {}, url);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.air.label, null);
    assert.equal(data.current.temp, 24);
    assert.match(response.headers.get("Cache-Control"), /max-age=600/);
  } finally { globalThis.fetch = originalFetch; }
});

// ── 구독 ──────────────────────────────────────────────────────
test("익명 구독을 지역과 함께 저장하고 지운다", async () => {
  const storage = new MemoryStorage();
  const brief = new BriefDO({ storage }, {});
  const sub = await fakeSubscription("https://push.example.com/a");

  const ok = await brief.fetch(pushReq("POST", { subscription: sub, region: "busan" }));
  assert.deepEqual(await ok.json(), { subscribed: true, region: "busan" });
  const [[, stored]] = await storage.list({ prefix: "push:" });
  assert.equal(stored.region, "busan");
  // 저장하는 건 endpoint·키·지역 id뿐이다 (좌표·개인정보 없음)
  assert.deepEqual(Object.keys(stored).sort(), ["endpoint", "keys", "region"]);

  // 같은 기기가 지역을 바꾸면 갱신되지, 구독이 늘지 않는다
  await brief.fetch(pushReq("POST", { subscription: sub, region: "jeju" }));
  assert.equal((await storage.list({ prefix: "push:" })).size, 1);
  assert.equal([...(await storage.list({ prefix: "push:" })).values()][0].region, "jeju");

  const gone = await brief.fetch(pushReq("DELETE", { endpoint: sub.endpoint }));
  assert.equal(gone.status, 200);
  assert.equal((await storage.list({ prefix: "push:" })).size, 0);
});

test("잘못된 구독과 알 수 없는 지역을 방어한다", async () => {
  const storage = new MemoryStorage();
  const brief = new BriefDO({ storage }, {});
  const bad = await brief.fetch(pushReq("POST", { subscription: { endpoint: "http://insecure", keys: {} } }));
  assert.equal(bad.status, 400);
  assert.equal((await storage.list({ prefix: "push:" })).size, 0);

  // 모르는 지역은 거절이 아니라 기본값(서울)로 떨어진다 — 알림은 계속 와야 한다
  const sub = await fakeSubscription("https://push.example.com/b");
  const ok = await brief.fetch(pushReq("POST", { subscription: sub, region: "atlantis" }));
  assert.deepEqual(await ok.json(), { subscribed: true, region: "seoul" });
});

test("알림은 지역별로 한 번만 조회해 구독자에게 보내고 만료분을 지운다", async () => {
  const storage = new MemoryStorage();
  const vapid = await generateVapidKeys();
  const brief = new BriefDO({ storage }, {
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://util.bubblelab.dev",
  });
  await brief.fetch(pushReq("POST",
    { subscription: await fakeSubscription("https://push.example.com/seoul-1"), region: "seoul" }));
  await brief.fetch(pushReq("POST",
    { subscription: await fakeSubscription("https://push.example.com/seoul-2"), region: "seoul" }));
  await brief.fetch(pushReq("POST",
    { subscription: await fakeSubscription("https://push.example.com/expired"), region: "busan" }));

  const upstream = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (target) => {
    const href = String(target);
    if (href.includes("open-meteo")) {
      upstream.push(href);
      return Response.json(href.includes("air-quality")
        ? { current: { pm10: 20, pm2_5: 9 } } : weatherFixture());
    }
    return new Response(null, { status: href.endsWith("/expired") ? 410 : 201 });
  };
  try {
    const response = await brief.fetch(new Request("https://brief.internal/notify", { method: "POST" }));
    assert.equal((await response.json()).sent, 2);
  } finally { globalThis.fetch = originalFetch; }

  // 서울 구독자가 둘이어도 서울 조회는 한 번씩(날씨+대기질)이다
  assert.equal(upstream.filter((u) => u.includes("37.5665")).length, 2);
  assert.equal((await storage.list({ prefix: "push:" })).size, 2);   // 410은 정리됨
});

test("날씨를 못 받은 지역은 빈 알림을 보내지 않고 건너뛴다", async () => {
  const storage = new MemoryStorage();
  const vapid = await generateVapidKeys();
  const brief = new BriefDO({ storage }, {
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  });
  await brief.fetch(pushReq("POST",
    { subscription: await fakeSubscription("https://push.example.com/a"), region: "seoul" }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (target) => (String(target).includes("open-meteo")
    ? new Response("down", { status: 500 })
    : new Response(null, { status: 201 }));
  try {
    const response = await brief.fetch(new Request("https://brief.internal/notify", { method: "POST" }));
    assert.equal((await response.json()).sent, 0);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal((await storage.list({ prefix: "push:" })).size, 1, "실패로 구독을 지우면 안 된다");
});

test("VAPID 설정이 없으면 알림은 조용히 넘어간다 (fail-closed)", async () => {
  const brief = new BriefDO({ storage: new MemoryStorage() }, {});
  const response = await brief.fetch(new Request("https://brief.internal/notify", { method: "POST" }));
  assert.deepEqual(await response.json(), { sent: 0 });
});

// 화면과 서버가 같은 지역 목록을 봐야 한다 — 한쪽만 고치면 여기서 걸린다
test("화면의 지역 목록이 서버 허용 목록과 일치한다", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../util/brief/index.html"), "utf8");
  const block = page.slice(page.indexOf("const REGIONS = ["), page.indexOf("const STORE_KEY"));
  const ids = [...block.matchAll(/\["([a-z]+)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, BRIEF_REGIONS.map((r) => [r.id, r.name]));
});
