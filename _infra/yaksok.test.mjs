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
  async get(k) {
    if (Array.isArray(k)) return new Map(k.filter((x) => this.data.has(x)).map((x) => [x, structuredClone(this.data.get(x))]));
    return this.data.has(k) ? structuredClone(this.data.get(k)) : undefined;
  }
  async put(k, v) {
    if (typeof k === "object") { for (const [kk, vv] of Object.entries(k)) this.data.set(kk, structuredClone(vv)); return; }
    this.data.set(k, structuredClone(v));
  }
  async delete(k) { for (const x of [].concat(k)) this.data.delete(x); }
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
  assert.match(html, /og:title" content="🫧 약속 방 abc123 · 날짜 잡기"/);
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
  assert.match(html, /og:title" content="🫧 약속 방 dinner · 날짜 잡기"/);
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

test("진행 단계: 확정 전 → 장소 전달 → 놀기 → 약속일 지나면 정산", async () => {
  const { phaseOf, dayCounts } = await import("../util/yaksok/logic.js");
  const today = "2026-10-10";
  assert.equal(phaseOf({ confirmed: null, place: null }, today), 0);
  assert.equal(phaseOf({ confirmed: { date: "2026-10-17" }, place: null }, today), 1);
  assert.equal(phaseOf({ confirmed: { date: "2026-10-17" }, place: { url: "x" } }, today), 2);
  assert.equal(phaseOf({ confirmed: { date: "2026-10-10" }, place: { url: "x" } }, today), 2);   // 당일은 놀기
  assert.equal(phaseOf({ confirmed: { date: "2026-10-09" }, place: null }, today), 3);
  assert.deepEqual(dayCounts({ a: { d: FULL }, b: { d: LUNCH }, c: { d: NO } }, ["a", "b", "c"], "d"), { lunch: 2, dinner: 1 });
});

// ── 사진·미리보기·정산·중간 터트리기 ──
const jpeg = (size, fill = 7) => {
  const b = new Uint8Array(size).fill(fill);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return Buffer.from(b).toString("base64");
};
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");

async function threeFriends(env, code = "trio01") {
  const host = (await call(env, "POST", "/_yaksok/rooms", { code, name: "도형", capacity: 3 })).body;
  const b = (await call(env, "POST", `/_yaksok/rooms/${code}/join`, { name: "민지" })).body;
  const c = (await call(env, "POST", `/_yaksok/rooms/${code}/join`, { name: "준호" })).body;
  return { code, host: host.token, b: b.token, c: c.token, day: host.state.period.start };
}

test("사진은 조각으로 저장했다가 원본 그대로 돌려주고, 올린 사람·방장만 지운다", async () => {
  const env = fakeEnv();
  const { code, host, b, c } = await threeFriends(env);
  const big = jpeg(1_300_000);   // 512KB 조각 3개
  const up = await call(env, "POST", `/_yaksok/rooms/${code}/photo`, { full: big, thumb: jpeg(2000), w: 2048, h: 1536 }, b);
  assert.equal(up.status, 200);
  const photo = up.body.state.photos[0];
  assert.equal(photo.chunks, 3);
  const full = await handleYaksokApi(new Request(`https://x/_yaksok/rooms/${code}/photos/${photo.id}`), env, `/_yaksok/rooms/${code}/photos/${photo.id}`);
  assert.equal(full.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await full.arrayBuffer()).toString("base64"), big);
  const thumb = await handleYaksokApi(new Request(`https://x/_yaksok/rooms/${code}/photos/${photo.id}?size=thumb`), env, `/_yaksok/rooms/${code}/photos/${photo.id}`);
  assert.equal((await thumb.arrayBuffer()).byteLength, 2000);

  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/photo`, { full: png(), thumb: jpeg(10) }, b)).status, 400);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/photo-delete`, { id: photo.id }, c)).status, 403);
  const deleted = await call(env, "POST", `/_yaksok/rooms/${code}/photo-delete`, { id: photo.id }, host);
  assert.equal(deleted.body.state.photos.length, 0);
  const keys = [...env.rooms.get(code).storage.data.keys()];
  assert.deepEqual(keys.filter((k) => k.startsWith("p:")), []);
});

test("사진은 방마다 50장까지", async () => {
  const env = fakeEnv();
  const { code, host } = await threeFriends(env);
  for (let i = 0; i < 50; i += 1) {
    assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/photo`, { full: jpeg(100), thumb: jpeg(10) }, host)).status, 200);
  }
  const over = await call(env, "POST", `/_yaksok/rooms/${code}/photo`, { full: jpeg(100), thumb: jpeg(10) }, host);
  assert.equal(over.status, 409);
  assert.match(over.body.error, /50장/);
});

test("미리보기 이미지는 지금 버전을 그린 것만 받고, OG 가 버전 붙은 주소로 가리킨다", async () => {
  const env = fakeEnv();
  const { code, b, day } = await threeFriends(env);
  const before = (await call(env, "GET", `/_yaksok/rooms/${code}`, undefined, b)).body;
  await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { [day]: 1 } }, b);
  const stale = await call(env, "POST", `/_yaksok/rooms/${code}/og`, { version: before.version, png: png() }, b);
  assert.equal(stale.status, 409);
  const now = (await call(env, "GET", `/_yaksok/rooms/${code}`, undefined, b)).body;
  const saved = await call(env, "POST", `/_yaksok/rooms/${code}/og`, { version: now.version, png: png() }, b);
  assert.equal(saved.body.state.og.version, now.version);
  assert.equal(saved.body.state.version, now.version, "그림을 올려도 버전은 그대로");
  const image = await handleYaksokApi(new Request(`https://x/_yaksok/rooms/${code}/og.png`), env, `/_yaksok/rooms/${code}/og.png`);
  assert.equal(image.headers.get("content-type"), "image/png");
  const html = await renderRoomPage("<!--yaksok-og-->", env, code);
  assert.match(html, new RegExp(`og:image" content="https://util.bubblelab.dev/_yaksok/rooms/${code}/og.png\\?v=${now.version}"`));
});

test("정산: 원 단위 나머지는 앞사람부터 1원씩, 항목별로 뺀 사람은 그 항목을 안 낸다, 송금은 최소로", async () => {
  const { settle } = await import("../util/yaksok/logic.js");
  const r = settle(["a", "b", "c"], [
    { amount: 100000, payer: "a", participants: null },            // 33,334 / 33,333 / 33,333
    { amount: 30000, payer: "b", participants: ["a", "b"] },       // 술: c 제외
  ]);
  assert.equal(r.total, 130000);
  assert.deepEqual(r.balance, { a: 100000 - 33334 - 15000, b: 30000 - 33333 - 15000, c: -33333 });
  assert.equal(Object.values(r.balance).reduce((x, y) => x + y, 0), 0);
  assert.deepEqual(r.transfers, [{ from: "c", to: "a", amount: 33333 }, { from: "b", to: "a", amount: 18333 }]);
});

test("정산 항목·보냈어요·받았어요와 송금 정보(참여자에게만)", async () => {
  const env = fakeEnv();
  const { code, host, b, c, day } = await threeFriends(env);
  await call(env, "POST", `/_yaksok/rooms/${code}/confirm`, { date: day, slot: "dinner" }, host);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/settle`, {}, b)).status, 403);
  const settling = await call(env, "POST", `/_yaksok/rooms/${code}/settle`, { settling: true }, host);
  assert.equal(settling.body.state.phase, 3);

  const added = await call(env, "POST", `/_yaksok/rooms/${code}/expense`,
    { op: "add", items: [{ title: "삼겹살", amount: "90,000원" }, { title: "노래방", amount: 30000, source: "parsed" }] }, b);
  assert.equal(added.status, 200);
  const [meat, song] = added.body.state.expenses;
  assert.deepEqual([meat.amount, meat.payer, song.source], [90000, "m2", "parsed"]);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/expense`, { op: "delete", id: meat.id }, c)).status, 403);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/expense`, { op: "add", amount: 0 }, c)).status, 400);
  const updated = await call(env, "POST", `/_yaksok/rooms/${code}/expense`,
    { op: "update", id: song.id, title: "노래방", amount: 30000, participants: ["m2", "m3"] }, host);
  assert.deepEqual(updated.body.state.expenses[1].participants, ["m2", "m3"]);

  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/pay`, { kakaopay: "https://evil.com/x" }, b)).status, 400);
  await call(env, "POST", `/_yaksok/rooms/${code}/pay`, { kakaopay: "https://qr.kakaopay.com/Ej7abc", account: "토스뱅크 1000 민지" }, b);
  const asMember = (await call(env, "GET", `/_yaksok/rooms/${code}`, undefined, c)).body;
  assert.equal(asMember.members[1].pay.kakaopay, "https://qr.kakaopay.com/Ej7abc");
  const asStranger = (await call(env, "GET", `/_yaksok/rooms/${code}`)).body;
  assert.equal(asStranger.members[1].pay, undefined);

  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/sent`, { from: "m1", to: "m2" }, c)).status, 403);
  const sent = await call(env, "POST", `/_yaksok/rooms/${code}/sent`, { from: "m3", to: "m2", amount: 40000 }, c);
  assert.ok(sent.body.state.sent["m3>m2"].sentAt);
  const got = await call(env, "POST", `/_yaksok/rooms/${code}/sent`, { from: "m3", to: "m2" }, b);
  assert.ok(got.body.state.sent["m3>m2"].receivedAt);
});

test("캡처 파싱: Gemini 결과를 다듬어 후보로만 돌려주고, 키가 없으면 503, 하루 30번", async () => {
  const env = fakeEnv();
  const { code, b } = await threeFriends(env);
  const img = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString("base64");
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/parse`, { data: img, mime: "image/jpeg" }, b)).status, 503);

  const room = env.rooms.get(code);
  let asked = null;
  room.env = {
    GEMINI_API_KEY: "k",
    fetchImpl: async (url, init) => {
      asked = { url, body: JSON.parse(init.body), key: init.headers["x-goog-api-key"] };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [
        { title: "을지로 노가리", amount: 48000, at: "2026-10-17 21:10" },
        { title: "을지로 노가리", amount: 48000, at: "2026-10-17 21:10" },   // 겹친 캡처
        { title: "편의점", amount: 5500, canceled: true },
        { title: "이상한 값", amount: -3 },
      ] }) }] } }] });
    },
  };
  const parsed = await call(env, "POST", `/_yaksok/rooms/${code}/parse`, { data: img, mime: "image/jpeg" }, b);
  assert.equal(parsed.status, 200);
  assert.deepEqual(parsed.body.items.map((i) => [i.title, i.amount, i.canceled]),
    [["을지로 노가리", 48000, false], ["편의점", 5500, true]]);
  assert.equal(asked.key, "k");
  assert.equal(asked.body.contents[0].parts[1].inline_data.mime_type, "image/jpeg");
  assert.equal((await room.storage.get("room")).expenses.length, 0, "파싱만으로는 정산에 들어가지 않는다");

  const saved = await room.storage.get("room");
  saved.parseCount = 30;
  await room.storage.put("room", saved);
  assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/parse`, { data: img, mime: "image/jpeg" }, b)).status, 429);
});

test("OG 제목·설명은 단계를 따른다", async () => {
  const { ogDescription } = await import("./yaksok.js");
  const base = { code: "trio01", max: 3, members: [{ responded: true }, { responded: false }], place: { name: "을지로" },
    confirmed: { date: "2026-10-17", slot: "dinner" } };
  assert.match(ogDescription({ ...base, phase: 0, confirmed: null }), /3명 중 1명 응답/);
  assert.match(ogDescription({ ...base, phase: 1 }), /10월 17일\(토\) 저녁 확정/);
  assert.match(ogDescription({ ...base, phase: 2 }), /📍 을지로/);
  assert.match(ogDescription({ ...base, phase: 3 }), /정산 중/);
});

test("단계마다 중간에 터트려도 사진·정산까지 전부 지워지고, 남은 사람은 410 을 받는다", async () => {
  for (const stage of ["voting", "confirmed", "settling"]) {
    const env = fakeEnv();
    const { code, host, b, day } = await threeFriends(env, `pop${stage.slice(0, 3)}`);
    await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { [day]: 1 } }, b);
    if (stage !== "voting") {
      await call(env, "POST", `/_yaksok/rooms/${code}/confirm`, { date: day, slot: "full" }, host);
      await call(env, "POST", `/_yaksok/rooms/${code}/photo`, { full: jpeg(700_000), thumb: jpeg(100) }, b);
    }
    if (stage === "settling") {
      await call(env, "POST", `/_yaksok/rooms/${code}/settle`, { settling: true }, host);
      await call(env, "POST", `/_yaksok/rooms/${code}/expense`, { op: "add", amount: 30000 }, b);
    }
    assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/pop`, { code }, b)).status, 403, `${stage}: 방장만`);
    assert.equal((await call(env, "POST", `/_yaksok/rooms/${code}/pop`, { code }, host)).status, 200, stage);
    assert.deepEqual([...env.rooms.get(code).storage.data.keys()], ["popped"], `${stage}: 표시만 남는다`);
    const late = await call(env, "POST", `/_yaksok/rooms/${code}/vote`, { votes: { [day]: 2 } }, b);
    assert.equal(late.status, 410, `${stage}: 늦게 온 저장은 410`);
  }
});
