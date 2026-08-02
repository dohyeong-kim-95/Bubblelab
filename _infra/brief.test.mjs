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

const pageSource = async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../util/brief/index.html"), "utf8");
};

// 화면과 서버가 같은 지역 목록을 봐야 한다 — 한쪽만 고치면 여기서 걸린다
test("화면의 지역 목록이 서버 허용 목록과 일치한다", async () => {
  const page = await pageSource();
  const block = page.slice(page.indexOf("const REGIONS = ["), page.indexOf("const STORE_KEY"));
  const ids = [...block.matchAll(/\["([a-z]+)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, BRIEF_REGIONS.map((r) => [r.id, r.name]));
});

// 우하단은 공용 독(#bl-dock)이 fixed로 차지한다. 알림 토글이 그 코너에 놓였을 때
// 360x740에서 토글을 눌러도 독의 🔊가 눌렸다 — 우드 스택 음소거 버튼이 공유
// 버튼에 가려 안 눌리던 것과 같은 유형이다. 자리를 되돌리면 여기서 걸린다.
test("알림 토글이 독의 코너를 피해 배치돼 있다", async () => {
  const page = await pageSource();
  const row = page.slice(page.indexOf('class="notify-row"'), page.indexOf('class="notify-help"'));
  assert.ok(row.indexOf('id="notify-btn"') < row.indexOf('class="notify-title"'),
    "토글이 행의 오른쪽으로 돌아갔다 — 우하단 독과 겹친다");
  assert.doesNotMatch(row, /justify-content:\s*space-between/);

  // 독은 fixed라 문서 흐름을 밀어내지 않는다. 아래 여백으로 직접 비켜줘야 한다.
  const bodyRule = page.slice(page.indexOf("body {"), page.indexOf("main {")).replace(/\s+/g, " ");
  const declaration = /padding:([^;]+);/.exec(bodyRule);
  assert.ok(declaration, "본문에 padding 선언이 없다");
  const sides = declaration[1].trim().split(" ");          // 위 좌우 아래 (3값 표기)
  const bottom = parseFloat(sides[sides.length - 1]);
  assert.ok(bottom >= 9,
    `본문 아래 여백이 ${sides[sides.length - 1]} — 독(버튼 3개 ≈ 149px)을 못 비킨다`);
});

// ── 오늘의 운세 총평 (brief ↔ fortune 공유) ──────────────────────
test("운세 문구 목록이 공용 모듈 한 곳에만 있다", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const shared = readFileSync(join(root, "_shared/fortune-common.js"), "utf8");
  const fortunePage = readFileSync(join(root, "util/fortune/index.html"), "utf8");

  // 두 페이지가 같은 문구를 보여주므로 목록을 복사해 두면 언젠가 갈라진다
  assert.match(shared, /서두르지 않아도 괜찮아요/);
  assert.doesNotMatch(fortunePage, /서두르지 않아도 괜찮아요/,
    "fortune 페이지에 문구 목록이 다시 박혔다 — 공용 모듈을 쓰라");

  // 두 페이지 모두 defer 없이, 자기 인라인 스크립트보다 먼저 불러야 한다.
  // defer면 첫 화면을 그릴 때 window.blFortuneLine이 아직 없다.
  for (const [name, page] of [["fortune", fortunePage],
                              ["brief", readFileSync(join(root, "util/brief/index.html"), "utf8")]]) {
    const tag = /<script src="\/_shared\/fortune-common\.js"><\/script>/.exec(page);
    assert.ok(tag, `${name}이 공용 문구 모듈을 불러오지 않는다(또는 defer가 붙었다)`);
    assert.ok(tag.index < page.indexOf('<script>\n  "use strict"') + 1 || tag.index < page.indexOf("const $ ="),
      `${name}에서 공용 모듈이 인라인 스크립트보다 늦게 로드된다`);
  }
});

test("공용 운세 문구는 씨앗으로 고르고 범위를 벗어나지 않는다", async () => {
  const vm = await import("node:vm");
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../_shared/fortune-common.js"), "utf8");
  const win = {};
  win.window = win;
  vm.createContext(win);
  vm.runInContext(source, win);

  assert.equal(win.blFortuneLines.length, 24);
  // 같은 씨앗이면 같은 문구 — 하루 동안 문구가 바뀌면 안 된다
  assert.deepEqual(win.blFortuneLine(12345), win.blFortuneLine(12345));
  for (const seed of [0, -1, 1, 999999, 20300.5, NaN]) {
    const line = win.blFortuneLine(seed);
    assert.ok(line.emoji && line.text, `씨앗 ${seed}에서 빈 문구가 나왔다`);
  }
  // 날짜 씨앗은 하루에 하나씩 증가한다
  const a = win.blFortuneDaySeed(new Date("2026-08-02T10:00:00Z"));
  const b = win.blFortuneDaySeed(new Date("2026-08-03T10:00:00Z"));
  assert.equal(b - a, 1);
});

test("brief에 운세 총평과 항목 설정이 있다", async () => {
  const page = await pageSource();
  // 총평만 — 바이오리듬·분야별은 fortune에 둔다. "여기서 안 한다"는 주석에도
  // 그 말이 나오므로, 실제로 그려지는 마크업(주석 제외)만 본다.
  const markup = page.slice(0, page.indexOf("<script")).replace(/<!--[\s\S]*?-->/g, "");
  assert.match(markup, /id="fo-text"/);
  assert.doesNotMatch(markup, /바이오리듬/);
  assert.doesNotMatch(markup, /f-categories|fortune-category/, "분야별 운세까지 옮겨왔다");

  // 설정 두 개가 화면과 읽어주기에 함께 적용돼야 한다
  assert.match(page, /id="set-weather"/);
  assert.match(page, /id="set-fortune"/);
  assert.match(page, /settings\.weather \? brief\?\.text : ""/);
  assert.match(page, /settings\.fortune \? fortuneSpeech\(\) : ""/);

  // 생년월일은 fortune과 같은 키를 읽고 쓴다 — brief 전용 사본을 만들지 않는다
  assert.match(page, /localStorage\.getItem\(BIRTH_KEY\)/);
  assert.doesNotMatch(page, /"bl-brief-birth"/, "brief 전용 생년월일 사본을 만들었다");
});

// 이 테스트가 없어서 brief가 /_fortune/chart에 잘못된 형식을 보내고도 배포됐다.
// mock으로만 확인하면 400을 못 본다 — 진짜 핸들러에 통과시킨다.
test("brief가 저장한 생년월일이 실제 /_fortune/chart를 통과한다", async () => {
  const vm = await import("node:vm");
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { handleFortuneChart } = await import("./fortune.js");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");

  const win = {};
  win.window = win;
  vm.createContext(win);
  vm.runInContext(readFileSync(join(root, "_shared/fortune-common.js"), "utf8"), win);

  // brief의 생년월일 폼이 저장하는 모양 그대로 (util/brief/index.html birth-save)
  const saved = [
    { y: 1990, m: 5, d: 3, calendar: "solar", lunarLeap: false, gender: "male",
      timeMode: "branch", h: 6, time: null },
    { y: 1990, m: 5, d: 3, calendar: "solar", lunarLeap: false, gender: "unspecified",
      timeMode: "branch", h: null, time: null },                    // 시 모름
    { y: 1988, m: 3, d: 12, calendar: "lunar", lunarLeap: false, gender: "female",
      timeMode: "clock", h: 6, time: "12:00" },                     // fortune이 넣은 시각
  ];
  for (const birth of saved) {
    const body = win.blFortuneChartBody(birth);
    const request = new Request("https://util.bubblelab.dev/_fortune/chart", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // 음력 변환은 KASI 키가 필요하므로 양력만 200을 요구하고, 음력은 형식 오류가
    // 아닌지(=시간 입력 방식 오류가 아닌지)만 본다.
    const response = await handleFortuneChart(request, {});
    const data = await response.json();
    assert.doesNotMatch(String(data.error ?? ""), /시간 입력 방식/,
      `${JSON.stringify(birth)} → 서버가 형식을 거절했다`);
    if (birth.calendar === "solar") {
      assert.equal(response.status, 200, `${JSON.stringify(birth)} → ${data.error}`);
      assert.ok(data.dailyFortunes?.[0]?.text, "총평이 비어 있다");
    }
  }
});

test("brief의 생년월일 폼이 fortune과 같은 키·같은 형태를 쓴다", async () => {
  const page = await pageSource();
  assert.match(page, /const BIRTH_KEY = "bl-fortune-birth"/);
  assert.match(page, /localStorage\.setItem\(BIRTH_KEY/, "brief에서 저장할 수 없다");
  // 요청 본문은 공용 함수로 만든다 — 페이지마다 손으로 만들면 또 어긋난다
  assert.match(page, /window\.blFortuneChartBody\(birth\)/);
  assert.match(page, /window\.blFortuneBranches/, "시진 목록을 따로 들고 있다");
  // fortune에서 시각으로 넣어 둔 값을 시진 입력이 지우지 않는다
  assert.match(page, /keepClock/);
});
