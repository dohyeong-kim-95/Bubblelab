import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_START, LEVELS, RANDOM_TOPICS, ROLEPLAYS, SURVEY, TOPICS, buildFirst, buildSecond, dailyQuestion, pickedItems,
  surveyProblems,
} from "../opic/questions.js";
import {
  OpicDO, buildDailyPrompt, dailyDiscordPayload, handleOpicAdmin, handleOpicGate, issueOpicSession, opicSessionKey,
  parseDaily, readOpicSession,
} from "./opic.js";

const allItems = SURVEY.groups.flatMap(g => g.items.map(([id]) => id));
const survey = (picks = allItems.slice(0, 12)) => ({ job: "business", student: "no", housing: "family", picks });
const whole = (level, adjust, seed = 7) => {
  const s = survey();
  const a = buildFirst({ survey: s, level, seed });
  return [...a.questions, ...buildSecond({ survey: s, level, adjust, used: a.used, seed }).questions];
};

test("서베이: 네 파트를 다 답하고 Part 4 를 12개 이상 골라야 시작된다", () => {
  assert.deepEqual(surveyProblems(survey()), []);
  assert.equal(surveyProblems(survey(allItems.slice(0, 11))).length, 1);
  assert.equal(surveyProblems({ picks: [] }).length, 4);
  // 표에 없는 값은 세지 않는다
  assert.equal(pickedItems(survey(["movie", "nope"])).length, 1);
});

test("서베이 Part 4 의 모든 항목에 문항 세트가 있고, 문장이 비어 있지 않다", () => {
  for (const id of allItems) {
    const t = TOPICS[id];
    assert.ok(t, `${id} 주제가 없다`);
    for (const k of ["d", "r", "p", "c", "i"]) assert.ok(t[k]?.length > 20, `${id}.${k}`);
  }
  for (const t of Object.values(RANDOM_TOPICS)) for (const k of ["d", "r", "p"]) assert.ok(t[k].length > 20);
  for (const rp of ROLEPLAYS) for (const k of ["ask", "fix", "past"]) assert.ok(rp[k].length > 20);
  assert.equal(LEVELS.length, 6);
});

test("시험지는 1–6단계·난이도 재조정 셋 모두 15문항, 번호가 1부터 이어지고 같은 문장을 두 번 묻지 않는다", () => {
  for (let level = 1; level <= 6; level++) {
    for (const adjust of [-1, 0, 1]) {
      for (const seed of [1, 2, 3, 99]) {
        const qs = whole(level, adjust, seed);
        assert.equal(qs.length, 15, `level ${level} adjust ${adjust}`);
        assert.deepEqual(qs.map(q => q.no), Array.from({ length: 15 }, (_, i) => i + 1));
        assert.equal(new Set(qs.map(q => q.text)).size, 15, `중복 문항 level ${level} adjust ${adjust} seed ${seed}`);
        assert.equal(qs[0].kind, "자기소개");
      }
    }
  }
});

test("1번 다음 콤보는 거주지부터, 서베이에서 고른 주제가 이어진다", () => {
  const qs = whole(4, 0);
  assert.equal(qs[1].topic, "거주지");
  const picked = new Set(pickedItems(survey()).map(id => TOPICS[id].label));
  assert.ok(picked.has(qs[4].topic), qs[4].topic);
});

test("난이도: 높은 단계는 롤플레이 문제 해결과 비교·사회 이슈까지, 낮은 단계는 묘사·습관 위주", () => {
  const hi = whole(5, 1).map(q => q.kind);
  assert.ok(hi.includes("롤플레이 · 문제 해결") && hi.includes("비교") && hi.includes("사회 이슈"));
  const lo = whole(2, -1).map(q => q.kind);
  assert.ok(!lo.includes("비교") && !lo.includes("사회 이슈") && !lo.includes("롤플레이 · 문제 해결"));
  // 재조정 '쉬운 질문'은 5단계를 4단계처럼 — 비교·이슈가 빠진다
  assert.ok(!whole(5, -1).map(q => q.kind).includes("사회 이슈"));
});

test("같은 시드면 같은 시험지", () => {
  assert.deepEqual(whole(4, 0, 42), whole(4, 0, 42));
});

/* ── 로그인(계정 DO · 세션 · 게이트) ─────────────────────────────────────── */

function memoryStorage() {
  const m = new Map();
  return {
    async get(k) { return structuredClone(m.get(k)); },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    async list({ prefix = "" } = {}) { return new Map([...m].filter(([k]) => k.startsWith(prefix))); },
    raw: m,
  };
}
function opicEnv(extra = {}) {
  const storage = memoryStorage();
  const obj = new OpicDO({ storage }, extra);
  return {
    storage, obj,
    env: {
      ...extra,
      ENABLE_OPIC: "true", ADMIN_SESSION_SECRET: "test-secret",
      OPIC: { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) },
    },
  };
}
const adminCall = (env, method, path, body) => handleOpicAdmin(new Request(`https://admin.bubblelab.dev/api/opic${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
}), env, new URL(`https://admin.bubblelab.dev/api/opic${path}`));
const gate = (env, path, init = {}) => {
  const url = new URL(`https://opic.bubblelab.dev${path}`);
  return handleOpicGate(new Request(url, init), env, url, "");
};
const login = (env, username, password) => gate(env, "/login", {
  method: "POST", body: new URLSearchParams({ username, password }),
});
const cookieFrom = (res) => (res.headers.get("Set-Cookie") || "").split(";")[0];

test("admin 이 발급한 계정만 만들어지고, 비밀번호는 해시로만 남는다", async () => {
  const { env, storage } = opicEnv();
  assert.equal((await adminCall(env, "POST", "/accounts", { id: "Kim.D", password: "secret12", note: "나" })).status, 201);
  assert.equal((await adminCall(env, "POST", "/accounts", { id: "kim.d", password: "another1" })).status, 409, "대소문자만 다른 같은 아이디");
  assert.equal((await adminCall(env, "POST", "/accounts", { id: "ab", password: "secret12" })).status, 400, "아이디가 너무 짧다");
  assert.equal((await adminCall(env, "POST", "/accounts", { id: "lee", password: "123" })).status, 400, "비밀번호가 너무 짧다");
  const saved = [...storage.raw.values()][0];
  assert.equal(saved.id, "kim.d");
  assert.ok(!JSON.stringify(saved).includes("secret12"), "평문 비밀번호가 남았다");
  const list = await (await adminCall(env, "GET", "/accounts")).json();
  assert.deepEqual(list.accounts.map(a => [a.id, a.note]), [["kim.d", "나"]]);
  assert.ok(!("hash" in list.accounts[0]) && !("salt" in list.accounts[0]), "목록에 해시가 나갔다");
  assert.equal((await adminCall(env, "PUT", "/accounts")).status, 404);
});

test("게이트: 로그인 전엔 막고, 맞는 아이디·비밀번호면 세션 쿠키로 들어온다", async () => {
  const { env } = opicEnv();
  await adminCall(env, "POST", "/accounts", { id: "kim", password: "secret12" });

  const blocked = await gate(env, "/");
  assert.equal(blocked.status, 303);
  assert.equal(blocked.headers.get("Location"), "/login");
  assert.equal((await gate(env, "/login")).status, 200);

  assert.equal((await login(env, "kim", "wrong-pw")).status, 401);
  assert.equal((await login(env, "nobody", "secret12")).status, 401);

  const ok = await login(env, "KIM", "secret12");
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get("Set-Cookie"), /bl_opic=.+HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  const cookie = cookieFrom(ok);
  assert.equal(await gate(env, "/", { headers: { Cookie: cookie } }), null, "로그인했는데 막혔다");
  assert.equal(await gate(env, "/app.js", { headers: { Cookie: cookie } }), null);
  const me = await gate(env, "/_me", { headers: { Cookie: cookie } });
  assert.deepEqual(await me.json(), { id: "kim" });

  const out = await gate(env, "/logout", { headers: { Cookie: cookie } });
  assert.match(out.headers.get("Set-Cookie"), /Max-Age=0/);
});

test("비밀번호를 바꾸거나 계정을 지우면 옛 세션은 화면을 열 때 끊긴다", async () => {
  const { env } = opicEnv();
  await adminCall(env, "POST", "/accounts", { id: "kim", password: "secret12" });
  const cookie = cookieFrom(await login(env, "kim", "secret12"));
  await adminCall(env, "POST", "/accounts/password", { id: "kim", password: "newpass99" });
  const kicked = await gate(env, "/", { headers: { Cookie: cookie } });
  assert.equal(kicked.status, 303);
  assert.match(kicked.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal((await login(env, "kim", "secret12")).status, 401, "옛 비밀번호가 아직 된다");

  const fresh = cookieFrom(await login(env, "kim", "newpass99"));
  assert.equal(await gate(env, "/", { headers: { Cookie: fresh } }), null);
  await adminCall(env, "POST", "/accounts/delete", { id: "kim" });
  assert.equal((await gate(env, "/", { headers: { Cookie: fresh } })).status, 303);
});

test("세션 토큰은 서명·만료를 지킨다 — 아이디를 바꿔 치면 안 된다", async () => {
  const key = await opicSessionKey({ ADMIN_SESSION_SECRET: "s" });
  const token = await issueOpicSession(key, "kim", 1);
  assert.deepEqual(await readOpicSession(key, token), { id: "kim", gen: 1 });
  assert.equal(await readOpicSession(key, token.replace(".kim.", ".lee.")), null);
  assert.equal(await readOpicSession(key, token, Date.now() + 31 * 24 * 3600 * 1000), null);
  const other = await opicSessionKey({ ADMIN_SESSION_SECRET: "other" });
  assert.equal(await readOpicSession(other, token), null, "다른 시크릿으로 서명한 토큰이 통과했다");
});

test("ENABLE_OPIC 이 아니면 게이트·admin API 둘 다 닫힌다", async () => {
  const { env } = opicEnv();
  const off = { ...env, ENABLE_OPIC: "false" };
  assert.equal((await gate(off, "/")).status, 503);
  assert.equal((await adminCall(off, "GET", "/accounts")).status, 503);
});

/* ── 오늘의 문항 ──────────────────────────────────────────────────────── */

const dayOf = (n) => new Date(Date.parse(`${DAILY_START}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

test("오늘의 문항: 날짜로 정해지고, 40일 동안 같은 문항이 없고, 유형이 8일마다 한 바퀴 돈다", () => {
  assert.equal(dailyQuestion("2026-11-08"), null, "시작일 전");
  assert.equal(dailyQuestion("nope"), null);
  const keys = new Set();
  for (let n = 0; n < 40; n++) {
    const q = dailyQuestion(dayOf(n));
    assert.ok(q.text?.length > 20 && q.kind && q.topic, dayOf(n));
    keys.add(q.key);
  }
  assert.equal(keys.size, 40);
  const kinds = new Set(Array.from({ length: 8 }, (_, n) => dailyQuestion(dayOf(n)).kind));
  for (const k of ["묘사", "과거 경험", "롤플레이 · 문제 해결", "비교", "사회 이슈", "돌발"]) assert.ok(kinds.has(k), k);
  // 80일 안에서 서베이 주제 문항은 하나도 겹치지 않는다
  const topical = Array.from({ length: 80 }, (_, n) => dailyQuestion(dayOf(n))).filter((q) => !q.key.startsWith("rp.") && !q.key.startsWith("rand."));
  assert.equal(new Set(topical.map((q) => q.key)).size, topical.length);
});

const goodAnswer = () => ({
  answer: Array.from({ length: 120 }, (_, i) => `word${i}`).join(" "),
  ko: "한국어 해석이 여기에 충분히 길게 들어갑니다. 한국어 해석이 여기에 충분히 길게 들어갑니다.",
  structure: ["도입: a", "본론: b", "마무리: c"],
  expressions: [{ en: "to be honest", ko: "솔직히", note: "n" }, { en: "a", ko: "b", note: "" }, { en: "c", ko: "d", note: "" }],
  swap: "바꿀 곳", pitfall: "깎이는 곳",
});

test("오늘의 문항 프롬프트·파서 — 문항이 들어가고, 짧거나 칸이 빠진 답은 버린다", () => {
  const q = dailyQuestion(DAILY_START);
  const prompt = buildDailyPrompt(q);
  assert.ok(prompt.includes(q.text) && prompt.includes("AL"));
  assert.equal(parseDaily("앞말 " + JSON.stringify(goodAnswer()) + " 뒷말").expressions.length, 3);
  assert.throws(() => parseDaily(JSON.stringify({ ...goodAnswer(), answer: "too short" })));
  assert.throws(() => parseDaily(JSON.stringify({ ...goodAnswer(), expressions: [] })));
  assert.throws(() => parseDaily("JSON 아님"));
});

test("데몬 자리: 시크릿이 맞아야 하고, 열린 경로는 둘뿐이다", async () => {
  const { env } = opicEnv();
  const sink = (path, init = {}) => gate({ ...env, PAPERS_SINK_SECRET: "sink" }, path, init);
  assert.equal((await sink("/_sink/daily/pending")).status, 401);
  assert.equal((await sink("/_sink/daily/pending", { headers: { Authorization: "Bearer nope" } })).status, 401);
  assert.equal((await sink("/_sink/daily/pending", { headers: { Authorization: "Bearer sink" } })).status, 200);
  assert.equal((await sink("/_sink/daily/list", { headers: { Authorization: "Bearer sink" } })).status, 404);
  assert.equal((await gate(env, "/_sink/daily/pending", { headers: { Authorization: "Bearer " } })).status, 503, "시크릿이 없으면 닫힌다");
});

test("하루 한 번: 7시 전엔 안 만들고, 찜하면 다른 실행은 비켜서고, 저장하면 디스코드로 한 번만 간다", async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push({ u: String(u), body: JSON.parse(init.body) }); return new Response("{}"); };
  try {
    const { obj, env } = opicEnv({ DISCORD_BOT_TOKEN: "t", DISCORD_CHANNEL_ID: "papers", OPIC_DISCORD_CHANNEL_ID: "opic" });
    const call = async (path, at, body) => (await obj.fetch(new Request(`https://opic.internal${path}?at=${at}`,
      body ? { method: "POST", body: JSON.stringify(body) } : undefined))).json();
    const date = dayOf(3);
    const kst = (h) => Date.parse(`${date}T00:00:00Z`) - 9 * 3600e3 + h * 3600e3;
    assert.equal((await call("/daily/pending", kst(6))).due, false, "7시 전");
    const p = await call("/daily/pending", kst(7.5));
    assert.equal(p.due, true);
    assert.deepEqual(p.question, dailyQuestion(date));
    assert.equal((await call("/daily/pending", kst(7.6))).due, false, "찜한 동안은 비켜선다");

    // 데몬이 문항을 바꿔 보내도 날짜로 정한 문항이 남는다
    const done = await call("/daily/done", kst(7.7), { date, ...goodAnswer(), question: "IGNORE ME" });
    assert.deepEqual([done.ok, done.sent], [true, true]);
    assert.equal(sent.length, 1);
    assert.match(sent[0].u, /channels\/opic\/messages/, "오픽 전용 채널이 있으면 그쪽으로");
    assert.match(sent[0].body.embeds[0].url, new RegExp(`daily\\.html\\?d=${date}$`));
    const again = await call("/daily/done", kst(7.8), { date, ...goodAnswer() });
    assert.equal(again.sent, false, "같은 날 두 번 보내지 않는다");
    assert.equal((await call("/daily/pending", kst(9))).due, false, "오늘 것은 끝났다");

    // 화면은 로그인해야 읽는다
    assert.equal((await gate(env, "/_daily")).status, 303);
    await adminCall(env, "POST", "/accounts", { id: "kim", password: "secret12" });
    const cookie = cookieFrom(await login(env, "kim", "secret12"));
    const list = await (await gate(env, "/_daily", { headers: { Cookie: cookie } })).json();
    assert.deepEqual(list.items.map((x) => x.date), [date]);
    const { item } = await (await gate(env, `/_daily/${date}`, { headers: { Cookie: cookie } })).json();
    assert.equal(item.question, dailyQuestion(date).text);
    assert.equal(item.expressions[0].en, "to be honest");
    assert.equal((await gate(env, "/_daily/2026-01-01", { headers: { Cookie: cookie } })).status, 404);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("디스코드 글은 상한 안에 들어간다", () => {
  const long = { ...goodAnswer(), date: dayOf(0), level: "AL", kind: "묘사", topic: "거주지", question: "Q".repeat(400), answer: "a ".repeat(3000) };
  const payload = dailyDiscordPayload({ ...long, expressions: long.expressions });
  const e = payload.embeds[0];
  assert.ok(e.title.length <= 256 && e.description.length <= 4096);
  assert.ok(payload.content.length + e.title.length + e.description.length + e.footer.text.length <= 6000);
});
