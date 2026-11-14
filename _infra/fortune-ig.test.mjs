import test from "node:test";
import assert from "node:assert/strict";
import {
  HOURS, IG_WINDOW_MS, MSG, cleanName, handleFortuneIg, igEvents, igInDO, igStep, parseBirthText, verifyIgSignature,
} from "./fortune-ig.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(k) { const v = this.data.get(k); return v === undefined ? undefined : structuredClone(v); }
  async put(k, v) { this.data.set(k, structuredClone(v)); }
  async delete(k) { this.data.delete(k); }
  async list({ prefix = "" } = {}) {
    return new Map([...this.data.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}

async function sign(raw, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  return "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("생년월일 글 읽기 — 흔한 꼴은 읽고 이상한 값은 거절", () => {
  for (const t of ["1995-10-28", "1995.10.28", "19951028", "95년 10월 28일", "1995 10 28", "1995년10월28일생"]) {
    assert.deepEqual(parseBirthText(t, 2026), { y: 1995, m: 10, d: 28 }, t);
  }
  assert.deepEqual(parseBirthText("05.3.1", 2026), { y: 2005, m: 3, d: 1 });
  for (const t of ["", "몰라요", "1995-13-01", "1899-01-01", "2030-01-01", "199-1-1", "1995-10"]) assert.equal(parseBirthText(t, 2026), null, t);
});

test("표지 이름 — 12자 안의 글자만, 주소·기호 거절", () => {
  assert.equal(cleanName("  김 도형 "), "김 도형");
  assert.equal(cleanName("다그당스팬"), "다그당스팬");
  for (const bad of ["", "a".repeat(13), "<b>x</b>", "@someone", "http://x", "www.x.com"]) assert.equal(cleanName(bad), null, bad);
});

test("시 버튼 — 12지 + 몰라요 = 13개, 글자 20자 안", () => {
  const q = MSG.hour().quick_replies;
  assert.equal(q.length, 13);
  assert.equal(HOURS[6][1], 6);
  for (const b of q) assert.ok([...b.title].length <= 20, b.title);
  for (const fn of [MSG.consent, MSG.name, MSG.gender, MSG.calendar]) for (const b of fn().quick_replies) assert.ok([...b.title].length <= 20);
});

test("대화 한 바퀴 — 동의 → 이름 → 생일 → 시 → 성별 → 양음 → 확인 → 큐", () => {
  let s = null, r;
  r = igStep(s, { text: "사주" }, 2026); assert.equal(r.state.step, "consent");
  r = igStep(r.state, { payload: "CONSENT_YES" }, 2026); assert.equal(r.state.step, "name");
  r = igStep(r.state, { text: "도형" }, 2026); assert.equal(r.state.step, "birth");
  r = igStep(r.state, { text: "1995-10-28" }, 2026); assert.equal(r.state.step, "hour");
  r = igStep(r.state, { payload: "H_6" }, 2026); assert.equal(r.state.step, "gender");
  r = igStep(r.state, { payload: "G_male" }, 2026); assert.equal(r.state.step, "calendar");
  r = igStep(r.state, { payload: "C_solar" }, 2026); assert.equal(r.state.step, "confirm");
  assert.match(r.replies[0].text, /오시/);
  r = igStep(r.state, { payload: "OK_YES" }, 2026);
  assert.equal(r.state, null);
  assert.deepEqual(r.enqueue, { name: "도형", birth: { y: 1995, m: 10, d: 28, h: 6, calendar: "solar", lunarLeap: false }, gender: "male" });
});

test("대화 — 버튼 대신 아무 글이나 오면 같은 질문을 다시, 취소는 언제든 지운다", () => {
  const st = { step: "hour", name: "", birth: { y: 1995, m: 10, d: 28 } };
  assert.equal(igStep(st, { text: "점심쯤" }, 2026).state.step, "hour");
  assert.equal(igStep(st, { text: "취소" }, 2026).state, null);
  assert.equal(igStep(null, { text: "안녕하세요" }, 2026).state, null);   // 사주 말고는 대화를 열지 않는다
  assert.equal(igStep({ step: "consent" }, { payload: "CONSENT_NO" }, 2026).state, null);
  // 양력인데 없는 날짜(2월 30일)는 생일을 다시 묻는다. 음력 30일은 받는다.
  const feb = { step: "calendar", name: "", birth: { y: 1995, m: 2, d: 30, h: null }, gender: "female" };
  assert.equal(igStep(feb, { payload: "C_solar" }, 2026).state.step, "birth");
  const lunar = igStep(feb, { payload: "C_leap" }, 2026);
  assert.equal(lunar.state.birth.calendar, "lunar"); assert.equal(lunar.state.birth.lunarLeap, true);
});

test("문구 — 다그당스는 문맥대로(말하는 이·그리는 이)만, 받는 사람 생년월일은 디스코드에 안 싣는다", () => {
  assert.match(MSG.invite, /^다그당스예요/);
  assert.doesNotMatch(Object.values(MSG).map((v) => (typeof v === "function" ? JSON.stringify(v({ birth: { y: 1, m: 1, d: 1, h: null }, name: "" }) ?? "") : v)).join(), /촛불/);
});

test("웹훅 본문 → 사주 댓글·DM 만, 우리 계정과 에코는 버린다", () => {
  const body = { object: "instagram", entry: [{
    changes: [
      { field: "comments", value: { id: "c1", text: "사주 부탁해요", from: { id: "u1" } } },
      { field: "comments", value: { id: "c2", text: "귀여워요", from: { id: "u2" } } },
      { field: "comments", value: { id: "c3", text: "사주", from: { id: "ME" } } },
    ],
    messaging: [
      { sender: { id: "u1" }, timestamp: 5, message: { mid: "m", text: "시작" } },
      { sender: { id: "ME" }, message: { mid: "m2", text: "x", is_echo: true } },
      { sender: { id: "u3" }, message: { mid: "m3", text: "", quick_reply: { payload: "H_2" } } },
    ],
  }] };
  assert.deepEqual(igEvents(body, "ME"), [
    { kind: "comment", commentId: "c1", from: "u1" },
    { kind: "message", from: "u1", text: "시작", payload: "", at: 5 },
    { kind: "message", from: "u3", text: "", payload: "H_2", at: igEvents(body, "ME")[2].at },
  ]);
  assert.deepEqual(igEvents({ object: "page" }, "ME"), []);
});

test("웹훅 서명 — 맞는 서명만 통과", async () => {
  const raw = '{"object":"instagram"}';
  assert.equal(await verifyIgSignature(raw, await sign(raw, "s3cret"), "s3cret"), true);
  assert.equal(await verifyIgSignature(raw, await sign(raw, "other"), "s3cret"), false);
  assert.equal(await verifyIgSignature(raw + " ", await sign(raw, "s3cret"), "s3cret"), false);
  assert.equal(await verifyIgSignature(raw, null, "s3cret"), false);
});

// ── DO 안쪽: 가짜 Graph API 로 보낸 DM 을 모은다 ──
function harness(envExtra = {}) {
  const storage = new MemoryStorage();
  const sent = [], notices = [];
  const env = { IG_ACCESS_TOKEN: "tok", ...envExtra };
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); };
  let now = Date.UTC(2026, 10, 14, 3);
  const call = (method, path, body) => igInDO(storage, env,
    new Request(`https://fortune.internal${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
    new URL(`https://fortune.internal${path}`), async (p) => { notices.push(p.content); return true; }, { now, fetcher });
  const msg = (from, text, payload = "") => call("POST", "/ig/events", [{ kind: "message", from, text, payload }]);
  const walk = async (from) => {
    for (const [t, p] of [["시작", ""], ["", "CONSENT_YES"], ["도형", ""], ["1995-10-28", ""], ["", "H_6"], ["", "G_male"], ["", "C_solar"], ["", "OK_YES"]]) await msg(from, t, p);
  };
  return { storage, sent, notices, call, msg, walk, setNow: (t) => { now = t; } };
}

test("DO — 사주 댓글에 비공개 답장 한 통(같은 댓글 재전송은 무시), 대화 끝나면 큐·디스코드(개인정보 없이)", async () => {
  const h = harness();
  await h.call("POST", "/ig/events", [{ kind: "comment", commentId: "c1", from: "u1" }]);
  await h.call("POST", "/ig/events", [{ kind: "comment", commentId: "c1", from: "u1" }]);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].recipient, { comment_id: "c1" });
  await h.walk("u1");
  const list = await (await h.call("GET", "/ig/list")).json();
  assert.equal(list.requests.length, 1);
  assert.equal(list.requests[0].name, "도형");
  assert.equal(list.requests[0].igsid, undefined);          // PC 에는 인스타 id 를 넘기지 않는다
  assert.equal(list.requests[0].windowOpen, true);
  assert.equal(await h.storage.get("ig:conv:u1"), undefined);  // 대화 기록은 큐로 옮기고 지운다
  assert.equal(h.notices.length, 1);
  assert.doesNotMatch(h.notices[0], /1995|도형/);
  assert.match(h.sent.at(-1).message.text, /접수됐어요/);
});

test("DO — 하루 상한, 같은 사람 중복, 하루 지난 대화 정리", async () => {
  const h = harness({ IG_DAILY_CAP: "1" });
  await h.walk("u1");
  await h.msg("u1", "사주");
  assert.equal(h.sent.at(-1).message.text, MSG.dup);
  await h.walk("u2");
  assert.equal(h.sent.at(-1).message.text, MSG.full);
  assert.equal((await (await h.call("GET", "/ig/list")).json()).requests.length, 1);
  await h.msg("u9", "사주");
  assert.ok(await h.storage.get("ig:conv:u9"));
  h.setNow(Date.UTC(2026, 10, 15, 4));
  await h.msg("u8", "안녕");
  assert.equal(await h.storage.get("ig:conv:u9"), undefined);
});

test("DO — ready 뒤 send 가 링크 DM 을 보내고 개인정보를 지운다, 24시간 창이 닫혔으면 거절", async () => {
  const h = harness();
  await h.walk("u1");
  const [req] = (await (await h.call("GET", "/ig/list")).json()).requests;
  assert.equal((await h.call("POST", `/ig/send/${req.id}`)).status, 409);            // 아직 준비 전
  const link = "https://util.bubblelab.dev/fortune/get/#QCzh-tdyi6QCLnHGcQh7cg";
  await h.call("POST", `/ig/ready/${req.id}`, { status: "packaged", link });
  assert.match(h.notices.at(-1), /링크가 준비됐어요/);
  h.setNow(Date.UTC(2026, 10, 14, 3) + IG_WINDOW_MS + 1);
  assert.equal((await h.call("POST", `/ig/send/${req.id}`)).status, 409);            // 창 닫힘
  h.setNow(Date.UTC(2026, 10, 14, 4));
  const ok = await h.call("POST", `/ig/send/${req.id}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(h.sent.at(-1).recipient, { id: "u1" });
  assert.match(h.sent.at(-1).message.text, /QCzh-tdyi6QCLnHGcQh7cg/);
  assert.equal(h.storage.data.size > 0, true);
  assert.equal((await h.call("GET", "/ig/list")).status, 200);
  assert.equal((await (await h.call("GET", "/ig/list")).json()).requests.length, 0);
  assert.equal(await h.storage.get("ig:user:u1"), undefined);
});

test("DO — 큐에 있는 동안 상대가 말하면 24시간 창이 다시 열리고, 취소하면 지운다", async () => {
  const h = harness();
  await h.walk("u1");
  const [req] = (await (await h.call("GET", "/ig/list")).json()).requests;
  h.setNow(Date.UTC(2026, 10, 15, 2));
  await h.msg("u1", "언제 와요?");
  assert.equal((await h.storage.get(`ig:req:${req.id}`)).lastUserAt, Date.UTC(2026, 10, 15, 2));
  await h.msg("u1", "취소");
  assert.equal(await h.storage.get(`ig:req:${req.id}`), undefined);
  assert.equal(h.sent.at(-1).message.text, MSG.cancelled);
});

test("워커 경로 — 구독 확인 토큰·서명·시크릿·링크 모양 검사", async () => {
  const env = { IG_APP_SECRET: "app", IG_VERIFY_TOKEN: "vt", COMIC_SINK_SECRET: "pc" };
  const go = (path, init) => handleFortuneIg(new Request(`https://util.bubblelab.dev${path}`, init), env, new URL(`https://util.bubblelab.dev${path}`));
  const ok = await go("/_fortune/ig/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123");
  assert.equal(await ok.text(), "123");
  assert.equal((await go("/_fortune/ig/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1")).status, 403);
  assert.equal((await go("/_fortune/ig/webhook", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await go("/_fortune/ig-requests")).status, 401);
  assert.equal((await go("/_fortune/ig-requests/0123456789abcdef/ready", {
    method: "POST", headers: { Authorization: "Bearer pc" }, body: JSON.stringify({ status: "packaged", link: "https://evil.example/x" }),
  })).status, 400);
  const off = await handleFortuneIg(new Request("https://u/_fortune/ig/webhook", { method: "POST" }), {}, new URL("https://u/_fortune/ig/webhook"));
  assert.equal(off.status, 503);   // 시크릿이 없으면 꺼져 있다
});
