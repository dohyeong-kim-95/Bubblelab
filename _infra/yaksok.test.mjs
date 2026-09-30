import test from "node:test";
import assert from "node:assert/strict";
import { YaksokDO, handleYaksokApi, ogTags, renderRoomPage } from "./yaksok.js";
import {
  DINNER, FULL, LUNCH, NO, NONE, bestDates, calendarEvent, candidatePeriod, datesBetween,
  naverMapUrl, nextState, tally,
} from "../util/yaksok/logic.js";

// ── 규칙 ──
test("탭할 때마다 전일 → 점심 → 저녁 → 불가 → 전일 로 돈다", () => {
  const seen = [];
  let s = NONE;
  for (let i = 0; i < 5; i += 1) seen.push(s = nextState(s));
  assert.deepEqual(seen, [FULL, LUNCH, DINNER, NO, FULL]);
});

test("후보 기간은 오늘부터 다음 달 말일까지다 (해 넘김·윤년 포함)", () => {
  assert.deepEqual(candidatePeriod("2026-10-01"), { start: "2026-10-01", end: "2026-11-30" });
  assert.deepEqual(candidatePeriod("2026-12-15"), { start: "2026-12-15", end: "2027-01-31" });
  assert.deepEqual(candidatePeriod("2028-01-31"), { start: "2028-01-31", end: "2028-02-29" });
});

test("점심칸은 전일+점심만, 저녁칸은 전일+저녁만을 센다", () => {
  const dates = ["2026-10-10", "2026-10-11"];
  const votes = {
    a: { "2026-10-10": FULL, "2026-10-11": NO },
    b: { "2026-10-10": LUNCH, "2026-10-11": DINNER },
    c: { "2026-10-10": DINNER },
  };
  const { byDate, responded } = tally(votes, ["a", "b", "c", "d"], dates);
  assert.deepEqual(byDate["2026-10-10"], { lunch: 2, dinner: 2, no: 0 });
  assert.deepEqual(byDate["2026-10-11"], { lunch: 0, dinner: 1, no: 1 });
  assert.deepEqual(responded, ["a", "b", "c"]);
  const best = bestDates(byDate);
  assert.deepEqual(best.map((b) => [b.date, b.count, b.slot]), [["2026-10-10", 2, "full"], ["2026-10-11", 1, "dinner"]]);
});

test("네이버 지도 링크만 받는다", () => {
  assert.equal(naverMapUrl("https://naver.me/abcd1234"), "https://naver.me/abcd1234");
  assert.ok(naverMapUrl("https://map.naver.com/p/entry/place/123"));
  assert.equal(naverMapUrl("http://naver.me/abcd"), null);
  assert.equal(naverMapUrl("https://naver.me.evil.com/x"), null);
  assert.equal(naverMapUrl("javascript:alert(1)"), null);
});

test("확정 약속을 캘린더 링크·파일로 낸다", () => {
  const dinner = calendarEvent({ title: "동기 모임", date: "2026-10-17", slot: "dinner", place: { name: "을지로" } });
  assert.match(dinner.google, /dates=20261017T180000%2F20261017T210000/);
  assert.match(dinner.ics, /DTSTART;TZID=Asia\/Seoul:20261017T180000/);
  const allDay = calendarEvent({ title: "여행", date: "2026-10-31", slot: "full" });
  assert.match(allDay.ics, /DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101/);
});

// ── 서버: 메모리 저장소 위의 DO 로 실제 API 흐름 ──
class MemoryStorage {
  constructor() { this.data = new Map(); this.alarm = null; }
  async get(k) { return this.data.has(k) ? structuredClone(this.data.get(k)) : undefined; }
  async put(k, v) { this.data.set(k, structuredClone(v)); }
  async deleteAll() { this.data.clear(); }
  async setAlarm(t) { this.alarm = t; }
}

function fakeEnv() {
  const rooms = new Map();
  return {
    rooms,
    YAKSOK: {
      idFromName: (name) => name,
      get: (id) => {
        if (!rooms.has(id)) rooms.set(id, new YaksokDO({ storage: new MemoryStorage() }, {}));
        const room = rooms.get(id);
        return { fetch: (url, init) => room.fetch(new Request(url, init)) };
      },
    },
  };
}

async function call(env, method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Yaksok-Token"] = token;
  const response = await handleYaksokApi(new Request(`https://util.bubblelab.dev${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env, path);
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function newRoom(env, code = "dinner") {
  const created = await call(env, "POST", "/_yaksok/rooms", { code, name: "도형" });
  assert.equal(created.status, 201);
  return created.body;
}

test("방 코드는 사람이 정하고, 같은 코드는 같은 방이다 — 이미 있으면 409 exists", async () => {
  const env = fakeEnv();
  const upper = await call(env, "POST", "/_yaksok/rooms", { code: " DINNER ", name: "도형" });
  assert.equal(upper.status, 201);
  assert.equal(upper.body.code, "dinner");
  const again = await call(env, "POST", "/_yaksok/rooms", { code: "dinner", name: "다른기기" });
  assert.equal(again.status, 409);
  assert.equal(again.body.exists, true);
  assert.equal((await call(env, "POST", "/_yaksok/rooms", { code: "ab!", name: "a" })).status, 400);
  assert.equal((await call(env, "POST", "/_yaksok/rooms", { code: "abcdefg", name: "a" })).status, 400);
});

test("방을 만들면 방장 토큰을 받고, 서버는 토큰 해시만 가진다", async () => {
  const env = fakeEnv();
  const { code, token, state } = await newRoom(env);
  assert.equal(code, "dinner");
  assert.equal(state.me.host, true);
  const stored = await env.rooms.get(code).storage.get("room");
  assert.ok(!JSON.stringify(stored).includes(token));
  assert.equal(stored.members[0].tokenHash.length, 64);
  // 링크만 있는 사람도 볼 수는 있다
  const seen = await call(env, "GET", `/_yaksok/rooms/${code}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.me, null);
  assert.equal(seen.body.members[0].tokenHash, undefined);
});

test("참여는 10명까지, 같은 닉네임은 안 된다", async () => {
  const env = fakeEnv();
  const { code } = await newRoom(env);
  const dup = await call(env, "POST", `/_yaksok/rooms/${code}/join`, { name: "도형" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.duplicate, true);
  assert.match(dup.body.error, /이어하기 링크/);
  for (let i = 2; i <= 10; i += 1) {
    assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/join`, { name: `친구${i}` })).status, 201);
  }
  const full = await call(env, "POST", `/_yaksok/rooms/${code}/join`, { name: "열한번째" });
  assert.equal(full.body.duplicate, undefined);
  assert.equal(full.status, 409);
  assert.match(full.body.error, /10명/);
});

test("투표는 참여자만, 후보 기간 안에서만, 0 은 응답 지우기", async () => {
  const env = fakeEnv();
  const { code, token, state } = await newRoom(env);
  const day = state.period.start;
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { [day]: FULL } })).status, 401);
  const voted = await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { [day]: LUNCH } }, token);
  assert.equal(voted.body.state.votes.m1[day], LUNCH);
  assert.equal(voted.body.state.members[0].responded, true);
  const outside = await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { "2000-01-01": FULL } }, token);
  assert.equal(outside.status, 400);
  const bad = await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { [day]: 9 } }, token);
  assert.equal(bad.status, 400);
  const cleared = await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { [day]: NONE } }, token);
  assert.equal(cleared.body.state.votes.m1, undefined);
  assert.equal(cleared.body.state.members[0].responded, false);
});

test("확정·장소·방장 넘기기는 방장만, 확정하면 만료가 약속일 기준으로 옮겨진다", async () => {
  const env = fakeEnv();
  const { code, token, state } = await newRoom(env);
  const friend = (await call(env, "POST", `/_yaksok/rooms/${code}/join`, { name: "민지" })).body;
  const date = datesBetween(state.period.start, state.period.end)[3];
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/confirm`, { date, slot: "dinner" }, friend.token)).status, 403);
  const confirmed = await call(env, "POST", `/_yaksok/rooms/${code}/confirm`, { date, slot: "dinner" }, token);
  assert.deepEqual([confirmed.body.state.confirmed.date, confirmed.body.state.confirmed.slot], [date, "dinner"]);
  const dayAfter = new Date(Date.parse(`${date}T00:00:00+09:00`) + 31 * 86400000).getTime();
  assert.equal(confirmed.body.state.expiresAt, dayAfter);
  assert.equal(env.rooms.get(code).storage.alarm, dayAfter);

  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/place`, { name: "을지로", url: "https://example.com" }, token)).status, 400);
  const placed = await call(env, "POST", `/_yaksok/rooms/${code}/place`, { name: "을지로 노가리집", url: "https://naver.me/xyz12345" }, token);
  assert.equal(placed.body.state.place.name, "을지로 노가리집");

  const handed = await call(env, "POST", `/_yaksok/rooms/${code}/host`, { memberId: friend.state.me.id }, token);
  assert.equal(handed.body.state.me.host, false);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/confirm`, { date: null }, token)).status, 403);
});

test("터트리려면 방 코드를 똑같이 적어야 하고, 터지면 기록이 사라지고 410 이 된다", async () => {
  const env = fakeEnv();
  const { code, token } = await newRoom(env);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/pop`, { code: "lunch1" }, token)).status, 400);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/pop`, { code: "DINNER" }, token)).status, 200);
  const storage = env.rooms.get(code).storage;
  assert.equal(await storage.get("room"), undefined);
  assert.equal((await call(env, "GET", `/_yaksok/rooms/${code}`)).status, 410);
  // 터진 코드는 표시가 남아 있는 동안 다시 만들 수 없고, 알람이 표시까지 지운다
  const reuse = await call(env, "POST", "/_yaksok/rooms", { code, name: "누군가" });
  assert.equal(reuse.status, 409);
  assert.equal(reuse.body.popped, true);
  await env.rooms.get(code).alarm();
  assert.equal(storage.data.size, 0);
});

test("만료 알람은 기한이 지났을 때만 지우고, 미뤄졌으면 다시 건다", async () => {
  const env = fakeEnv();
  const { code } = await newRoom(env);
  const room = env.rooms.get(code);
  await room.alarm();
  assert.ok(await room.storage.get("room"), "기한 전이면 남는다");
  const saved = await room.storage.get("room");
  saved.expiresAt = Date.now() - 1;
  await room.storage.put("room", saved);
  await room.alarm();
  assert.equal(room.storage.data.size, 0);
});

test("없는 방·잘못된 코드·잘못된 메서드", async () => {
  const env = fakeEnv();
  assert.equal((await call(env, "GET", "/_yaksok/rooms/zzzzzz")).status, 404);
  assert.equal((await call(env, "GET", "/_yaksok/rooms/ABC!!!")).status, 404);
  assert.equal((await call(env, "GET", "/_yaksok/rooms")).status, 405);
  assert.equal((await call(env, "POST", "/_yaksok/rooms", { code: "abc123", name: "" })).status, 400);
});

test("미리보기 OG 에 방 코드를 넣는다", async () => {
  const env = fakeEnv();
  const created = await call(env, "POST", "/_yaksok/rooms", { code: "abc123", name: "<b>" });
  const html = await renderRoomPage("<head><!--yaksok-og--></head>", env, created.body.code);
  assert.match(html, /og:title" content="🫧 약속 방 abc123"/);
  assert.match(html, new RegExp(`og:url" content="https://util.bubblelab.dev/yaksok/${created.body.code}"`));
  assert.match(ogTags(null, "zzzzzz"), /og:image" content="https:\/\/util.bubblelab.dev\/yaksok\/og.png"/);
});

test("워커: 방 주소는 화면에 OG 를 끼워 no-store·noindex 로 내주고, 끝 슬래시는 떼고, 꺼지면 503", async () => {
  const { default: worker } = await import("./worker.js");
  const env = fakeEnv();
  const { code } = await newRoom(env);
  const asked = [];
  Object.assign(env, {
    ENABLE_YAKSOK: "true",
    ASSETS: {
      fetch: async (request) => {
        asked.push(new URL(request.url).pathname);
        return new Response("<html><head><!--yaksok-og--></head></html>", { headers: { "Content-Type": "text/html" } });
      },
    },
  });
  const ctx = { waitUntil() {} };
  const page = await worker.fetch(new Request(`https://util.bubblelab.dev/yaksok/${code}`), env, ctx);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  const html = await page.text();
  assert.match(html, /og:title" content="🫧 약속 방 dinner"/);
  assert.deepEqual(asked, ["/util/yaksok/"]);

  const slash = await worker.fetch(new Request(`https://util.bubblelab.dev/yaksok/${code}/`), env, ctx);
  assert.equal(slash.status, 301);
  assert.equal(new URL(slash.headers.get("location")).pathname, `/yaksok/${code}`);

  // 파일(app.js·og.png)은 방 주소로 오인하지 않는다
  asked.length = 0;
  await worker.fetch(new Request("https://util.bubblelab.dev/yaksok/og.png"), env, ctx);
  assert.deepEqual(asked, ["/util/yaksok/og.png"]);

  delete env.ENABLE_YAKSOK;
  assert.equal((await worker.fetch(new Request(`https://util.bubblelab.dev/yaksok/${code}`), env, ctx)).status, 503);
});

test("정원은 만들 때 2~20명으로 정하고, 방장이 바꾸되 이미 들어온 인원 밑으로는 못 줄인다", async () => {
  const env = fakeEnv();
  assert.equal((await call(env, "POST", "/_yaksok/rooms", { code: "cap001", name: "a", capacity: 1 })).status, 400);
  assert.equal((await call(env, "POST", "/_yaksok/rooms", { code: "cap001", name: "a", capacity: 21 })).status, 400);
  const created = await call(env, "POST", "/_yaksok/rooms", { code: "cap003", name: "방장", capacity: 3 });
  assert.equal(created.body.state.max, 3);
  const { token } = created.body;
  const b = await call(env, "POST", "/_yaksok/rooms/cap003/join", { name: "b" });
  assert.equal((await call(env, "POST", "/_yaksok/rooms/cap003/join", { name: "c" })).status, 201);
  const full = await call(env, "POST", "/_yaksok/rooms/cap003/join", { name: "d" });
  assert.equal(full.status, 409);
  assert.match(full.body.error, /정원 3명/);

  assert.equal((await call(env, "POST", "/_yaksok/rooms/cap003/capacity", { capacity: 5 }, b.body.token)).status, 403);
  const shrink = await call(env, "POST", "/_yaksok/rooms/cap003/capacity", { capacity: 2 }, token);
  assert.equal(shrink.status, 400);
  assert.match(shrink.body.error, /3명/);
  const grown = await call(env, "POST", "/_yaksok/rooms/cap003/capacity", { capacity: 4 }, token);
  assert.equal(grown.body.state.max, 4);
  assert.equal((await call(env, "POST", "/_yaksok/rooms/cap003/join", { name: "d" })).status, 201);
});
