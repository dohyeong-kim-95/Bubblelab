import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDiscordPayload,
  createDelivery,
  handlePapers,
  handlePapersSink,
  ASK_TTL_MS,
  buildQuery,
  buildScorePrompt,
  CATEGORIES,
  DISCORD_TOTAL_LIMIT,
  KEYWORDS,
  MAX_PICKS,
  PapersDO,
  parseAtom,
  parseScores,
  parseSummary,
  pickPapers,
  postToDiscord,
  SCORE_HIT,
} from "./papers.js";

// arXiv Atom 응답 한 건 (실제 스키마 그대로, 버전 접미사 포함).
const entry = (over = {}) => `
  <entry>
    <id>http://arxiv.org/abs/${over.id ?? "2508.06847"}v${over.v ?? 1}</id>
    <title>${over.title ?? "MOCA-HESP: Bayesian Optimization for Combinatorial Spaces"}</title>
    <summary>${over.summary ?? "We propose a method for expensive black-box optimization over mixed spaces."}</summary>
    <published>${over.published ?? "2026-08-09"}T00:00:00Z</published>
    <author><name>Jane Doe</name></author>
    <author><name>John Roe</name></author>
    <category term="cs.LG" />
    <category term="math.OC" />
  </entry>`;

const feed = (...entries) => `<?xml version="1.0"?><feed>${entries.join("")}</feed>`;

// ── 수집 ───────────────────────────────────────────────────────────────

test("검색식에 카테고리·키워드·날짜창이 모두 들어간다", () => {
  const query = buildQuery(Date.parse("2026-08-22T00:00:00Z"));
  for (const cat of CATEGORIES) assert.ok(query.includes(`cat:${cat}`), `${cat} 누락`);
  for (const word of KEYWORDS) assert.ok(query.includes(`abs:"${word}"`), `${word} 누락`);
  // 이틀 창 — 주말에 arXiv 가 쉬어도 하루치가 통째로 비지 않는다.
  assert.match(query, /submittedDate:\[202608200000 TO 202608220000\]/);
});

test("Atom 을 읽고 개정판 접미사를 떼어 낸다", () => {
  // v1 과 v3 은 같은 논문이다. 버전을 남기면 개정 때마다 다시 보낸다.
  const [paper] = parseAtom(feed(entry({ v: 3 })));
  assert.equal(paper.id, "2508.06847");
  assert.equal(paper.link, "https://arxiv.org/abs/2508.06847");
  assert.match(paper.title, /MOCA-HESP/);
  assert.deepEqual(paper.authors, ["Jane Doe", "John Roe"]);
  assert.deepEqual(paper.categories, ["cs.LG", "math.OC"]);
  assert.equal(paper.published, "2026-08-09");
});

test("망가진 응답은 조용히 빈 배열이 된다", () => {
  for (const input of ["", null, "<feed></feed>", "<entry><id>쓰레기</id></entry>"]) {
    assert.deepEqual(parseAtom(input), []);
  }
});

// ── 채점 ───────────────────────────────────────────────────────────────

test("채점 프롬프트가 내 문제 조건을 담는다", () => {
  const prompt = buildScorePrompt(parseAtom(feed(entry())));
  assert.match(prompt, /800/);            // 예산
  assert.match(prompt, /순서형|ordinal/);  // 변수 종류
  assert.match(prompt, /다목적/);          // 목적 수
  // 후하게 주지 말라는 지침이 빠지면 전부 8점이 된다.
  assert.match(prompt, /후하게 주지 마세요/);
});

test("점수 줄을 읽고 형식이 어긋난 줄은 버린다", () => {
  const papers = parseAtom(feed(entry({ id: "1111.1111" }), entry({ id: "2222.2222" })));
  const scored = parseScores("네, 채점했습니다\n1|9|순서형 다목적 BO\n엉뚱한 줄\n2|3|연속변수 전용", papers);
  assert.equal(scored[0].score, 9);
  assert.equal(scored[0].reason, "순서형 다목적 BO");
  assert.equal(scored[1].score, 3);
});

test("점수가 안 매겨진 논문은 0점이라 걸러진다", () => {
  const papers = parseAtom(feed(entry({ id: "1111.1111" })));
  assert.equal(parseScores("", papers)[0].score, 0);
});

test("범위를 벗어난 점수는 0~10 으로 조인다", () => {
  const papers = parseAtom(feed(entry({ id: "1111.1111" })));
  assert.equal(parseScores("1|99|과장", papers)[0].score, 10);
});

test("8점 이상은 🎯, 5~7점은 🔍 로 나뉜다", () => {
  const scored = [
    { id: "a", score: 9 }, { id: "b", score: 8 }, { id: "c", score: 6 },
    { id: "d", score: 4 }, { id: "e", score: 0 },
  ];
  const { hits, near } = pickPapers(scored);
  assert.deepEqual(hits.map((p) => p.id), ["a", "b"]);
  assert.deepEqual(near.map((p) => p.id), ["c"]);
});

test("전체 개수는 MAX_PICKS 를 넘지 않는다", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, score: 9 }));
  const { hits, near } = pickPapers([...many, { id: "n", score: 6 }]);
  assert.equal(hits.length, MAX_PICKS);
  assert.equal(near.length, 0, "🎯 로 자리가 다 찼으면 인접은 넣지 않는다");
});

// ── 요약 ───────────────────────────────────────────────────────────────

test("요약의 다섯 항목을 읽는다 (굵게 표시도 허용)", () => {
  const parsed = parseSummary([
    "한줄: 조합 공간에서 다목적 BO 를 한다",
    "**아이디어:** 초타원체로 공간을 쪼갠다",
    "가정: 목적이 서로 독립이다",
    "예산: 500회",
    "걸림돌: 순서형 인코딩을 직접 짜야 한다",
  ].join("\n"));
  assert.equal(parsed["한줄"], "조합 공간에서 다목적 BO 를 한다");
  assert.equal(parsed["아이디어"], "초타원체로 공간을 쪼갠다");
  assert.equal(parsed["예산"], "500회");
  assert.equal(parsed["걸림돌"], "순서형 인코딩을 직접 짜야 한다");
});

// ── 디스코드 ───────────────────────────────────────────────────────────

const paper = (over = {}) => ({
  id: "x", title: "제목", link: "https://arxiv.org/abs/x", score: 9,
  reason: "이유", categories: ["cs.LG"], authors: [], published: "2026-08-22",
  summary: "초록", summary_ko: { "한줄": "한 줄", "가정": "가정", ...over.summary_ko },
  ...over,
});

test("고른 게 있으면 편수를, 없으면 없다고 말한다", () => {
  const some = buildDiscordPayload({ date: "2026-08-22", hits: [paper()], near: [], scanned: 6 });
  assert.match(some.content, /🎯 내 문제에 맞는 논문 1편/);
  assert.match(some.content, /후보 6편 검토/);

  const none = buildDiscordPayload({ date: "2026-08-22", hits: [], near: [paper({ score: 6 })], scanned: 6 });
  assert.match(none.content, /정확히 맞는 논문이 없습니다/);
  assert.match(none.content, /🔍 인접 1편/);
});

test("디스코드 전체 6000자 한도를 넘기지 않는다", () => {
  // 설명이 긴 논문을 잔뜩 넣어도 잘라서 보낸다 — 넘기면 400 으로 통째로 거절당한다.
  const fat = Array.from({ length: 10 }, (_, i) => paper({
    id: `p${i}`, title: "긴 제목 ".repeat(40),
    summary_ko: { "한줄": "긴 설명 ".repeat(200) },
  }));
  const payload = buildDiscordPayload({ date: "2026-08-22", hits: fat, near: [], scanned: 10 });
  const total = payload.content.length + payload.embeds.reduce(
    (sum, e) => sum + e.title.length + e.description.length + e.footer.text.length, 0);
  assert.ok(total <= DISCORD_TOTAL_LIMIT, `합계 ${total}자로 한도를 넘었다`);
  assert.ok(payload.embeds.length <= 10);
  for (const embed of payload.embeds) {
    assert.ok(embed.title.length <= 256, "제목 한도 초과");
    assert.ok(embed.description.length <= 4096, "설명 한도 초과");
  }
});

test("요약이 없으면 초록으로 대신한다", () => {
  const payload = buildDiscordPayload({
    date: "2026-08-22", hits: [paper({ summary_ko: {}, summary: "원문 초록" })], near: [], scanned: 1,
  });
  assert.match(payload.embeds[0].description, /원문 초록/);
});

test("점수에 따라 🎯 와 🔍 아이콘이 붙는다", () => {
  const payload = buildDiscordPayload({
    date: "2026-08-22", hits: [paper({ score: SCORE_HIT })], near: [paper({ id: "y", score: 6 })], scanned: 2,
  });
  assert.match(payload.embeds[0].title, /^🎯/);
  assert.match(payload.embeds[1].title, /^🔍/);
});

test("429 를 만나면 Retry-After 만큼 기다렸다 한 번 더 보낸다", async () => {
  const calls = [];
  let waited = 0;
  const fetchImpl = async () => {
    calls.push(1);
    return calls.length === 1
      ? new Response("rate limited", { status: 429, headers: { "Retry-After": "2" } })
      : new Response(null, { status: 204 });
  };
  await postToDiscord("https://hook", { content: "x" }, { fetchImpl, sleep: (ms) => { waited = ms; } });
  assert.equal(calls.length, 2);
  assert.equal(waited, 2000, "Retry-After 를 안 지키면 다시 429 를 맞는다");
});

// ── 저장소·파이프라인 (PapersDO) ───────────────────────────────────────

function storageStub() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async delete(keys) { for (const key of [].concat(keys)) map.delete(key); },
    async list({ prefix, reverse, limit }) {
      let rows = [...map.entries()].filter(([key]) => key.startsWith(prefix)).sort();
      if (reverse) rows.reverse();
      if (limit) rows = rows.slice(0, limit);
      return new Map(rows);
    },
  };
}

/** arXiv → 채점 → 요약 × N 순서로 답하는 fetch. 호출 기록을 남긴다. */
function pipelineStub({ entries, scores, sent = [] }) {
  const calls = { arxiv: 0, llm: 0, discord: 0 };
  const impl = async (input, init) => {
    const href = String(input);
    if (href.includes("export.arxiv.org")) {
      calls.arxiv++;
      return new Response(feed(...entries));
    }
    if (href.includes("generativelanguage")) {
      calls.llm++;
      // 첫 호출이 채점, 이후는 편별 요약.
      const text = calls.llm === 1 ? scores : "한줄: 요약된 한 줄\n가정: 어떤 가정";
      return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    calls.discord++;
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  };
  return { impl, calls, sent };
}

const env = (over = {}) => ({
  GEMINI_API_KEY: "k", DISCORD_WEBHOOK_URL: "https://hook", ...over,
});

test("후보를 받아 채점하고 골라서 디스코드로 보낸다", async () => {
  const stub = pipelineStub({
    entries: [entry({ id: "1111.1111" }), entry({ id: "2222.2222" })],
    scores: "1|9|순서형 다목적\n2|2|연속변수 전용",
  });
  const storage = storageStub();
  const result = await new PapersDO({ storage }, env()).run({ fetchImpl: stub.impl });

  assert.equal(result.hits, 1);
  assert.equal(result.scanned, 2);
  assert.equal(stub.calls.arxiv, 1, "arXiv 는 하루 한 번만 부른다");
  // 채점 1회 + 고른 1편 요약 1회. 후보 전부를 요약하면 호출이 배로 는다.
  assert.equal(stub.calls.llm, 2);
  assert.equal(stub.calls.discord, 1);
  assert.match(stub.sent[0].embeds[0].description, /요약된 한 줄/);
});

test("이미 보낸 논문은 다시 채점하지도 보내지도 않는다", async () => {
  const storage = storageStub();
  const first = pipelineStub({ entries: [entry({ id: "1111.1111" })], scores: "1|9|좋음" });
  await new PapersDO({ storage }, env()).run({ fetchImpl: first.impl });

  // 다음 날 같은 논문이 개정판(v2)으로 다시 올라온다.
  const second = pipelineStub({ entries: [entry({ id: "1111.1111", v: 2 })], scores: "1|9|좋음" });
  const result = await new PapersDO({ storage }, env()).run({ fetchImpl: second.impl });

  assert.equal(result.skipped, "새 논문 없음");
  assert.equal(second.calls.llm, 0, "새 논문이 없는데 LLM 을 불렀다");
  assert.equal(second.calls.discord, 0);
});

test("점수가 낮으면 아무것도 보내지 않고, 본 것은 기억한다", async () => {
  const storage = storageStub();
  const stub = pipelineStub({ entries: [entry({ id: "3333.3333" })], scores: "1|2|무관" });
  const result = await new PapersDO({ storage }, env()).run({ fetchImpl: stub.impl });

  // "오늘은 없습니다" 를 매일 보내면 그것부터 안 읽게 된다.
  assert.equal(result.skipped, "고를 만한 논문 없음");
  assert.equal(stub.calls.discord, 0);
  // 그래도 기억은 해야 내일 같은 논문을 또 채점하지 않는다.
  assert.deepEqual(await storage.get("seen"), ["3333.3333"]);
});

test("요약 하나가 실패해도 나머지는 보낸다", async () => {
  let llm = 0;
  const sent = [];
  const impl = async (input, init) => {
    const href = String(input);
    if (href.includes("export.arxiv.org")) return new Response(feed(entry({ id: "4444.4444" })));
    if (href.includes("generativelanguage")) {
      llm++;
      if (llm === 1) return Response.json({ candidates: [{ content: { parts: [{ text: "1|9|좋음" }] } }] });
      return new Response("quota", { status: 429 });   // 요약만 실패
    }
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  };
  const result = await new PapersDO({ storage: storageStub() }, env()).run({ fetchImpl: impl });
  assert.equal(result.hits, 1);
  assert.match(sent[0].embeds[0].description, /expensive black-box/, "초록으로 대체되지 않았다");
});

test("dry 실행은 저장은 하되 디스코드로는 보내지 않는다", async () => {
  const storage = storageStub();
  const stub = pipelineStub({ entries: [entry({ id: "5555.5555" })], scores: "1|9|좋음" });
  await new PapersDO({ storage }, env()).run({ fetchImpl: stub.impl, dryRun: true });
  assert.equal(stub.calls.discord, 0);
  assert.ok(await storage.get("latest"));
});

test("보관본을 최신순으로 돌려준다", async () => {
  const storage = storageStub();
  const instance = new PapersDO({ storage }, env());
  for (const date of ["2026-08-20", "2026-08-21", "2026-08-22"]) {
    await storage.put(`digest:${date}`, { date, hits: [], near: [] });
  }
  const body = await (await instance.fetch(new Request("https://papers/archive?limit=2"))).json();
  assert.deepEqual(body.digests.map((d) => d.date), ["2026-08-22", "2026-08-21"]);
});

test("웹훅이 없으면 실패로 알린다 (조용히 넘어가지 않는다)", async () => {
  const stub = pipelineStub({ entries: [entry({ id: "6666.6666" })], scores: "1|9|좋음" });
  await assert.rejects(
    () => new PapersDO({ storage: storageStub() }, env({ DISCORD_WEBHOOK_URL: "" })).run({ fetchImpl: stub.impl }),
    /보낼 곳이 없습니다/,
  );
});

test("웹훅이 없으면 LLM 을 태우기 전에 멈춘다", async () => {
  // 맨 끝에서 확인하면 조회·채점·요약 비용을 다 쓰고 나서 실패한다.
  const stub = pipelineStub({ entries: [entry({ id: "7777.7777" })], scores: "1|9|좋음" });
  await assert.rejects(
    () => new PapersDO({ storage: storageStub() }, env({ DISCORD_WEBHOOK_URL: "" })).run({ fetchImpl: stub.impl }),
    /보낼 곳이 없습니다/,
  );
  assert.equal(stub.calls.llm, 0, "LLM 을 부르고 나서 실패했다");
  assert.equal(stub.calls.arxiv, 0, "arXiv 까지 불렀다");
});

// ── 보낼 곳 (봇 토큰 / 웹훅) ────────────────────────────────────────────
//
// OAuth 는 어느 쪽도 런타임에 쓰지 않는다. 봇은 초대 링크로 한 번 설치한 뒤
// 봇 토큰으로 부르고, 웹훅은 URL 자체가 자격증명이다.

test("봇 토큰이 있으면 봇 API 로, 없으면 웹훅으로 보낸다", () => {
  const bot = createDelivery({ DISCORD_BOT_TOKEN: "t", DISCORD_CHANNEL_ID: "123", DISCORD_WEBHOOK_URL: "https://hook" });
  assert.equal(bot.kind, "bot", "봇 토큰이 있으면 봇이 우선이다");
  assert.equal(bot.url, "https://discord.com/api/v10/channels/123/messages");
  assert.equal(bot.headers.Authorization, "Bot t");

  const hook = createDelivery({ DISCORD_WEBHOOK_URL: "https://hook" });
  assert.equal(hook.kind, "webhook");
  assert.deepEqual(hook.headers, {}, "웹훅은 Authorization 헤더를 쓰지 않는다");
});

test("토큰만 있고 채널이 없으면 봇으로 보지 않는다", () => {
  // 채널 ID 없이 봇 토큰만 있으면 보낼 곳을 특정할 수 없다.
  assert.equal(createDelivery({ DISCORD_BOT_TOKEN: "t" }), null);
  assert.equal(createDelivery({ DISCORD_CHANNEL_ID: "123" }), null);
  assert.equal(createDelivery({}), null);
});

test("봇 경로도 같은 payload 와 429 규칙을 쓴다", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  await postToDiscord(createDelivery({ DISCORD_BOT_TOKEN: "t", DISCORD_CHANNEL_ID: "9" }),
    { content: "안녕", embeds: [] }, { fetchImpl });
  assert.match(seen[0].url, /channels\/9\/messages$/);
  assert.equal(seen[0].auth, "Bot t");
  assert.equal(seen[0].body.content, "안녕");
});

test("봇 토큰으로 하루치를 보낸다", async () => {
  const stub = pipelineStub({ entries: [entry({ id: "8888.8888" })], scores: "1|9|좋음" });
  const result = await new PapersDO({ storage: storageStub() },
    { GEMINI_API_KEY: "k", DISCORD_BOT_TOKEN: "t", DISCORD_CHANNEL_ID: "9" }
  ).run({ fetchImpl: stub.impl });
  assert.equal(result.via, "bot");
  assert.equal(stub.calls.discord, 1);
});

// ── 밖으로 열린 경로 ────────────────────────────────────────────────────

test("밖에서는 읽기만 되고 /run 은 닫혀 있다", async () => {
  // 열려 있으면 아무나 arXiv 조회·LLM 호출을 돌리고 남의 디스코드로 보낼 수 있다.
  const calls = [];
  const env = {
    PAPERS: {
      idFromName: () => "id",
      get: () => ({ fetch: (req) => { calls.push(new URL(req.url).pathname); return Response.json({ ok: true }); } }),
    },
  };
  const ask = (method, path) =>
    handlePapers(new Request(`https://papers.bubblelab.dev${path}`, { method }), env,
      new URL(`https://papers.bubblelab.dev${path}`));

  assert.equal((await ask("POST", "/_papers/run")).status, 404, "/run 이 밖으로 열려 있다");
  assert.equal((await ask("GET", "/_papers/run")).status, 404);
  assert.equal((await ask("POST", "/_papers/latest")).status, 404, "쓰기 메서드가 통과했다");
  assert.deepEqual(calls, [], "거부해야 할 요청이 DO 까지 갔다");

  assert.equal((await ask("GET", "/_papers/latest")).status, 200);
  assert.equal((await ask("GET", "/_papers/archive")).status, 200);
  assert.deepEqual(calls, ["/latest", "/archive"]);
});

// ── 질문 큐 (디스코드 → 집 PC) ──────────────────────────────────────────

function papersDO(storage = storageStub()) {
  const instance = new PapersDO({ storage }, env());
  const call = (path, method = "GET", body) => instance.fetch(new Request(`https://papers${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { storage, call };
}

test("질문을 넣고 데몬이 가져간다", async () => {
  const p = papersDO();
  assert.equal((await p.call("/ask", "POST", { id: "a", token: "t", question: "되나?" })).status, 200);
  const { asks } = await (await p.call("/asks")).json();
  assert.equal(asks.length, 1);
  assert.equal(asks[0].question, "되나?");
  assert.equal(asks[0].token, "t");
});

test("id·토큰·질문이 하나라도 없으면 거절한다", async () => {
  const p = papersDO();
  for (const bad of [{ id: "a", token: "t" }, { id: "a", question: "q" }, { token: "t", question: "q" },
                     { id: "a", token: "t", question: "   " }]) {
    assert.equal((await p.call("/ask", "POST", bad)).status, 400);
  }
});

test("처리한 질문은 목록에서 빠진다", async () => {
  const p = papersDO();
  await p.call("/ask", "POST", { id: "a", token: "t", question: "q1" });
  await p.call("/ask", "POST", { id: "b", token: "t", question: "q2" });
  await p.call("/asks/done", "POST", { ids: ["a"] });
  const { asks } = await (await p.call("/asks")).json();
  assert.deepEqual(asks.map((x) => x.id), ["b"]);
});

test("토큰이 죽은 질문은 건네주지도, 남기지도 않는다", async () => {
  // interaction 토큰은 15분이면 죽는다. 그 뒤에 답해 봐야 PATCH 가 실패한다.
  const p = papersDO();
  await p.storage.put("ask:old", { id: "old", token: "t", question: "옛날 질문", at: Date.now() - ASK_TTL_MS - 1000 });
  await p.call("/ask", "POST", { id: "new", token: "t", question: "새 질문" });

  const { asks } = await (await p.call("/asks")).json();
  assert.deepEqual(asks.map((x) => x.id), ["new"], "죽은 질문을 데몬에 건넸다");

  // done 을 부를 때 같이 걷어낸다 — 안 그러면 저장소에 영영 쌓인다.
  await p.call("/asks/done", "POST", { ids: ["new"] });
  assert.equal([...p.storage.map.keys()].filter((k) => k.startsWith("ask:")).length, 0);
});

test("데몬 경로는 secret 없이 못 연다", async () => {
  const calls = [];
  const base = {
    PAPERS: { idFromName: () => "id", get: () => ({ fetch: (req) => { calls.push(new URL(req.url).pathname); return Response.json({ asks: [] }); } }) },
  };
  const ask = (env_, headers = {}) => handlePapersSink(
    new Request("https://papers.bubblelab.dev/_papers/asks", { headers }), env_,
    new URL("https://papers.bubblelab.dev/_papers/asks"));

  assert.equal((await ask({ ...base })).status, 503, "secret 미설정이면 열려선 안 된다");
  assert.equal((await ask({ ...base, PAPERS_SINK_SECRET: "s" })).status, 401, "인증 없이 통과했다");
  assert.equal((await ask({ ...base, PAPERS_SINK_SECRET: "s" }, { Authorization: "Bearer wrong" })).status, 401);
  assert.deepEqual(calls, [], "거부해야 할 요청이 DO 까지 갔다");

  assert.equal((await ask({ ...base, PAPERS_SINK_SECRET: "s" }, { Authorization: "Bearer s" })).status, 200);
  assert.deepEqual(calls, ["/asks"]);
});

test("데몬 경로 밖은 sink 로 통과하지 않는다", async () => {
  const env_ = { PAPERS_SINK_SECRET: "s", PAPERS: { idFromName: () => "id", get: () => ({ fetch: () => Response.json({}) }) } };
  const response = await handlePapersSink(
    new Request("https://papers.bubblelab.dev/_papers/run", { method: "POST", headers: { Authorization: "Bearer s" } }),
    env_, new URL("https://papers.bubblelab.dev/_papers/run"));
  assert.equal(response.status, 404, "sink 인증으로 /run 을 부를 수 있으면 안 된다");
});
