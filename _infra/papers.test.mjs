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
  CLAIM_TTL_MS,
  CHAT_HISTORY_LIMIT,
  GATEWAY_ALIVE_MS,
  COMMENT_PER_PAPER,
  parseReview,
  parseReviewRequest,
  parseSearchRequest,
  REVIEW_FIELDS,
  searchArxiv,
  buildReviewPrompt,
  handlePapersComments,
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
  // 닷새 창 — 주말과 색인 지연을 함께 넘는다. 시작점은 그 날 0시로 내려서
  // 창의 첫날이 반나절만 걸리는 일이 없어야 한다.
  assert.match(query, /submittedDate:\[202608170000 TO 202608220000\]/);
});

test("창의 시작은 시각과 무관하게 그 날 0시다", () => {
  // 오후에 돌든 새벽에 돌든 첫날은 통째로 들어와야 한다. 예전엔 시각까지
  // 맞추는 바람에 토요일 실행이 후보 0편으로 끝났다.
  const noon = buildQuery(Date.parse("2026-08-22T14:30:00Z"));
  assert.match(noon, /submittedDate:\[202608170000 TO 202608221430\]/);
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

/** 디스코드 발송만 받는 fetch. 채점·요약은 이제 엣지에서 돌지 않는다. */
function discordStub() {
  const sent = [];
  const impl = async (input, init) => {
    sent.push({ url: String(input), body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return { impl, sent };
}

const env = (over = {}) => ({ DISCORD_WEBHOOK_URL: "https://hook", ...over });

// 2026-08-22 08:00 KST = 전날 23:00 UTC. 생성 시각(07시 KST)을 넘긴 시점이다.
const MORNING = Date.parse("2026-08-21T23:00:00Z");

test("데몬이 만들어 온 하루치를 보관하고 디스코드로 보낸다", async () => {
  const storage = storageStub();
  const stub = discordStub();
  const result = await new PapersDO({ storage }, env()).completeDigest(
    { date: "2026-08-22", scanned: 2, ids: ["1111.1111", "2222.2222"], hits: [paper({ id: "1111.1111", title: "MOCA-HESP" })], near: [] },
    { at: MORNING, fetchImpl: stub.impl },
  );

  assert.equal(result.hits, 1);
  assert.equal(result.scanned, 2);
  assert.equal(stub.sent.length, 1);
  assert.match(stub.sent[0].body.embeds[0].title, /MOCA-HESP/);
  // 고른 것뿐 아니라 **본 것 전부**를 기억해야 내일 다시 채점하지 않는다.
  assert.deepEqual(await storage.get("seen"), ["1111.1111", "2222.2222"]);
});

test("고른 게 없으면 보내지 않지만 본 것은 기억한다", async () => {
  const storage = storageStub();
  const stub = discordStub();
  const result = await new PapersDO({ storage }, env()).completeDigest(
    { date: "2026-08-22", scanned: 3, ids: ["3333.3333"], hits: [], near: [] },
    { at: MORNING, fetchImpl: stub.impl },
  );

  // "오늘은 없습니다" 를 매일 보내면 그것부터 안 읽게 된다.
  assert.equal(result.skipped, "고를 만한 논문 없음");
  assert.equal(stub.sent.length, 0);
  assert.deepEqual(await storage.get("seen"), ["3333.3333"]);
});

test("요약이 빠진 편은 초록으로 대체해서 보낸다", async () => {
  // 데몬에서 요약 한 편이 실패해도 그 편을 빼지 않는다.
  const stub = discordStub();
  await new PapersDO({ storage: storageStub() }, env()).completeDigest(
    { date: "2026-08-22", hits: [paper({ summary: "expensive black-box", summary_ko: undefined })], near: [] },
    { at: MORNING, fetchImpl: stub.impl },
  );
  assert.match(stub.sent[0].body.embeds[0].description, /expensive black-box/);
});

test("보낼 곳이 없으면 받아 놓고 조용히 넘어가지 않는다", async () => {
  await assert.rejects(
    () => new PapersDO({ storage: storageStub() }, env({ DISCORD_WEBHOOK_URL: "" }))
      .completeDigest({ date: "2026-08-22", hits: [paper()], near: [] }, { at: MORNING }),
    /보낼 곳이 없습니다/,
  );
});

// ── 하루치를 언제 만들지는 엣지가 정한다 (claimDigest) ──────────────────

test("아침이 지났고 오늘 것이 없으면 만들라고 한다", async () => {
  const pending = await new PapersDO({ storage: storageStub() }, env())
    .claimDigest({ at: MORNING });
  assert.equal(pending.due, true);
  assert.equal(pending.date, "2026-08-22");
  assert.deepEqual(pending.seen, []);
});

test("생성 시각 전에는 만들지 않는다", async () => {
  // 06:00 KST. arXiv 하루치가 아직 다 모이지 않았다.
  const early = Date.parse("2026-08-21T21:00:00Z");
  const pending = await new PapersDO({ storage: storageStub() }, env()).claimDigest({ at: early });
  assert.equal(pending.due, false);
});

test("오늘 것이 이미 있으면 다시 만들지 않는다", async () => {
  const storage = storageStub();
  await storage.put("digest:2026-08-22", { date: "2026-08-22" });
  const pending = await new PapersDO({ storage }, env()).claimDigest({ at: MORNING });
  assert.equal(pending.due, false);
});

test("고를 게 없던 날도 다시 만들지 않는다", async () => {
  // 보관본만 기준으로 삼으면 못 고른 날은 저장되는 게 없어서, 1분마다 도는
  // 데몬이 하루 종일 같은 하루치를 다시 만들며 arXiv 를 찌른다.
  const storage = storageStub();
  const instance = new PapersDO({ storage }, env());
  const result = await instance.completeDigest(
    { date: "2026-08-22", scanned: 31, ids: [], hits: [], near: [] },
    { at: MORNING, fetchImpl: discordStub().impl },
  );
  assert.equal(result.skipped, "고를 만한 논문 없음");
  assert.equal(await storage.get("digest:2026-08-22"), undefined, "빈 보관본을 남겼다");
  assert.equal((await instance.claimDigest({ at: MORNING + 60_000 })).due, false);

  // 다음 날은 당연히 다시 만든다.
  assert.equal((await instance.claimDigest({ at: MORNING + 24 * 60 * 60 * 1000 })).due, true);
});

test("한 번 집어가면 만드는 동안 다른 실행이 또 집어가지 않는다", async () => {
  // 데몬은 1분마다 도는데 채점·요약은 몇 분씩 걸린다. 찜하지 않으면 같은
  // 하루치를 여러 번 만들고 디스코드로도 여러 번 나간다.
  const storage = storageStub();
  const instance = new PapersDO({ storage }, env());
  assert.equal((await instance.claimDigest({ at: MORNING })).due, true);
  assert.equal((await instance.claimDigest({ at: MORNING + 60_000 })).due, false);
  // 찜이 만료되면 다시 집어간다 — 데몬이 죽어도 영영 막히지 않는다.
  assert.equal((await instance.claimDigest({ at: MORNING + CLAIM_TTL_MS + 1 })).due, true);
});

test("peek 은 보기만 하고 집어가지 않는다", async () => {
  const instance = new PapersDO({ storage: storageStub() }, env());
  assert.equal((await instance.claimDigest({ at: MORNING, claim: false })).due, true);
  assert.equal((await instance.claimDigest({ at: MORNING })).due, true, "peek 이 자리를 찜했다");
});

test("보낼 곳이 없으면 만들라고 하지도 않는다", async () => {
  // 만들고 나서 보낼 곳이 없다고 실패하면 구독 호출이 그대로 낭비된다.
  const pending = await new PapersDO({ storage: storageStub() }, env({ DISCORD_WEBHOOK_URL: "" }))
    .claimDigest({ at: MORNING });
  assert.equal(pending.due, false);
  assert.match(pending.reason, /보낼 곳이 없습니다/);
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
  const stub = discordStub();
  const result = await new PapersDO({ storage: storageStub() },
    { DISCORD_BOT_TOKEN: "t", DISCORD_CHANNEL_ID: "9" },
  ).completeDigest({ date: "2026-08-22", hits: [paper()], near: [] }, { at: MORNING, fetchImpl: stub.impl });
  assert.equal(result.via, "bot");
  assert.match(stub.sent[0].url, /channels\/9\/messages$/);
});

// ── 밖으로 열린 경로 ────────────────────────────────────────────────────

test("밖에서는 읽기만 되고 하루치를 만드는 경로는 닫혀 있다", async () => {
  // 열려 있으면 아무나 남의 디스코드로 발송을 시킬 수 있다.
  const calls = [];
  const env = {
    PAPERS: {
      idFromName: () => "id",
      get: () => ({ fetch: (req) => { calls.push(new URL(req.url).pathname); return Response.json({ ok: true }); } }),
    },
  };
  const ask = (method, path) =>
    handlePapers(new Request(`https://life.bubblelab.dev${path}`, { method }), env,
      new URL(`https://life.bubblelab.dev${path}`));

  assert.equal((await ask("POST", "/_papers/digest/done")).status, 404, "발송 경로가 밖으로 열려 있다");
  assert.equal((await ask("GET", "/_papers/digest/pending")).status, 404);
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
    new Request("https://life.bubblelab.dev/_papers/asks", { headers }), env_,
    new URL("https://life.bubblelab.dev/_papers/asks"));

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
    new Request("https://life.bubblelab.dev/_papers/run", { method: "POST", headers: { Authorization: "Bearer s" } }),
    env_, new URL("https://life.bubblelab.dev/_papers/run"));
  assert.equal(response.status, 404, "sink 인증으로 /run 을 부를 수 있으면 안 된다");
});

// ── 댓글 ────────────────────────────────────────────────────────────────

test("댓글을 쌓고 지운다", async () => {
  const storage = storageStub();
  const instance = new PapersDO({ storage }, env());

  await instance.addComment({ paperId: "2608.19808", text: "  이건 800회로는 안 되겠다  ", at: 1000 });
  const second = await instance.addComment({ paperId: "2608.19808", text: "그래도 스칼라화는 참고", at: 2000 });
  assert.deepEqual(second.comments.map((c) => c.text),
    ["이건 800회로는 안 되겠다", "그래도 스칼라화는 참고"], "앞뒤 공백이 남았다");

  const after = await instance.removeComment({ paperId: "2608.19808", id: second.comments[0].id });
  assert.equal(after.comments.length, 1);

  // 마지막 하나를 지우면 키까지 지운다 — 빈 배열이 목록에 남으면 안 된다.
  await instance.removeComment({ paperId: "2608.19808", id: after.comments[0].id });
  const body = await (await instance.fetch(new Request("https://papers/comments"))).json();
  assert.deepEqual(body.comments, {});
});

test("빈 댓글은 받지 않는다", async () => {
  const instance = new PapersDO({ storage: storageStub() }, env());
  const response = await instance.fetch(new Request("https://papers/comments", {
    method: "POST", body: JSON.stringify({ paperId: "1111.1111", text: "   " }),
  }));
  assert.equal(response.status, 400);
});

test("한 논문에 무한정 쌓이지 않고 오래된 것부터 밀린다", async () => {
  const instance = new PapersDO({ storage: storageStub() }, env());
  for (let i = 0; i < COMMENT_PER_PAPER + 3; i++) {
    await instance.addComment({ paperId: "1111.1111", text: `메모 ${i}`, at: 1000 + i });
  }
  const { comments } = await instance.addComment({ paperId: "1111.1111", text: "마지막", at: 9999 });
  assert.equal(comments.length, COMMENT_PER_PAPER);
  assert.equal(comments.at(-1).text, "마지막");
  assert.equal(comments[0].text, "메모 4", "오래된 것이 아니라 최근 것이 밀려났다");
});

test("로그인하지 않으면 댓글을 읽지도 쓰지도 못한다", async () => {
  // 이 경로는 LIFE 게이트보다 앞에서 처리된다 — 여기서 막지 않으면 주소만
  // 알면 남이 내 메모를 읽고 쓸 수 있다.
  const calls = [];
  const papersEnv = {
    PAPERS: {
      idFromName: () => "id",
      get: () => ({ fetch: (req) => { calls.push(new URL(req.url).pathname); return Response.json({ ok: true }); } }),
    },
  };
  const call = (owner, method = "GET", path = "/_papers/comments") =>
    handlePapersComments(new Request(`https://life.bubblelab.dev${path}`, {
      method, body: method === "POST" ? "{}" : undefined,
    }), papersEnv, new URL(`https://life.bubblelab.dev${path}`), owner);

  assert.equal((await call(false)).status, 401);
  assert.equal((await call(false, "POST")).status, 401);
  assert.deepEqual(calls, [], "인증 없이 DO 까지 갔다");

  assert.equal((await call(true)).status, 200);
  assert.equal((await call(true, "POST", "/_papers/comments/delete")).status, 200);
  assert.deepEqual(calls, ["/comments", "/comments/delete"]);

  // 엉뚱한 하위 경로를 DO 로 흘려보내지 않는다.
  assert.equal((await call(true, "POST", "/_papers/comments/../run")).status, 404);
});

// ── 채널 대화 ───────────────────────────────────────────────────────────

const chatEnv = (over = {}) => env({ DISCORD_BOT_TOKEN: "t", DISCORD_CHAT_CHANNEL_ID: "77", ...over });

test("오간 말을 기억하고 최근 것만 남긴다", async () => {
  const storage = storageStub();
  const instance = new PapersDO({ storage }, chatEnv());
  for (let i = 0; i < CHAT_HISTORY_LIMIT; i++) {
    await instance.chatRemember({ question: `묻기 ${i}`, answer: `답 ${i}` });
  }
  const { history } = await instance.chatHistory();
  assert.equal(history.length, CHAT_HISTORY_LIMIT);
  assert.deepEqual(history.at(-2).role, "user");
  assert.equal(history.at(-1).text, `답 ${CHAT_HISTORY_LIMIT - 1}`);
});

test("대화 기억은 sink secret 뒤에 있다", async () => {
  // 오간 말에 내 문제 설명과 판단이 들어 있다. 밖으로 열면 안 된다.
  const calls = [];
  const papersEnv = {
    PAPERS_SINK_SECRET: "s",
    PAPERS: {
      idFromName: () => "id",
      get: () => ({ fetch: (req) => { calls.push(new URL(req.url).pathname); return Response.json({ ok: true }); } }),
    },
  };
  const call = (auth) => handlePapersSink(
    new Request("https://life.bubblelab.dev/_papers/chat/history", { headers: auth ? { Authorization: "Bearer s" } : {} }),
    papersEnv, new URL("https://life.bubblelab.dev/_papers/chat/history"));

  assert.equal((await call(false)).status, 401);
  assert.deepEqual(calls, []);
  assert.equal((await call(true)).status, 200);
  assert.deepEqual(calls, ["/chat/history"]);
});

test("검색 요청은 첫 줄에서만 읽는다", async () => {
  assert.equal(parseSearchRequest("SEARCH: ordinal bayesian optimization"), "ordinal bayesian optimization");
  assert.equal(parseSearchRequest("네, 찾아볼게요.\nSEARCH: multi-objective"), "multi-objective");
  assert.equal(parseSearchRequest("검색은 필요 없습니다. 이건 이미 아는 내용이에요."), null);
});

test("검색어의 줄바꿈·따옴표를 걷어내고 관련도순으로 훑는다", async () => {
  let asked;
  const papers = await searchArxiv('ordinal "multi-objective"\nBO', {
    fetchImpl: async (url) => { asked = new URL(url); return new Response(feed(entry({ id: "9999.9999" }))); },
  });
  // 따옴표가 남으면 검색식이 깨지고, 기간 제한을 걸면 "옛날 거라도" 가 안 된다.
  assert.equal(asked.searchParams.get("search_query"), 'all:"ordinal multi-objective BO"');
  assert.equal(asked.searchParams.get("sortBy"), "relevance");
  assert.ok(!asked.searchParams.get("search_query").includes("submittedDate"));
  assert.equal(papers[0].id, "9999.9999");
});

test("빈 검색어로는 arXiv 를 부르지 않는다", async () => {
  const papers = await searchArxiv("   ", { fetchImpl: () => { throw new Error("불렀다"); } });
  assert.deepEqual(papers, []);
});

// ── 리뷰 ────────────────────────────────────────────────────────────────

test("리뷰 요청에서 arXiv 번호만 집어낸다", () => {
  assert.equal(parseReviewRequest("REVIEW: 2608.19808"), "2608.19808");
  assert.equal(parseReviewRequest("REVIEW: https://arxiv.org/abs/2508.06847v2"), "2508.06847");
  assert.equal(parseReviewRequest("이건 이미 아는 내용이라 리뷰가 필요 없습니다"), null);
});

test("여러 줄로 쓴 항목을 하나로 모은다", () => {
  // 모델이 항목 아래에 문단을 이어 쓴다. 첫 줄만 받으면 대부분이 잘려 나간다.
  const parsed = parseReview([
    "무엇을 한 논문인가: 고리형 펩타이드 설계를",
    "실행가능성 인지 DPO 로 미세조정한다.",
    "**핵심 방법**: 난이도 그룹 로버스트 최적화.",
    "내 문제 적용: 800회로는 선호쌍을 못 만든다.",
  ].join("\n"));

  assert.equal(parsed["무엇을 한 논문인가"], "고리형 펩타이드 설계를 실행가능성 인지 DPO 로 미세조정한다.");
  assert.equal(parsed["핵심 방법"], "난이도 그룹 로버스트 최적화.");
  assert.equal(parsed["내 문제 적용"], "800회로는 선호쌍을 못 만든다.");
  assert.ok(!("실험 설계" in parsed), "빈 항목이 들어갔다");
});

test("리뷰를 최신순으로 쌓고 논문 정보를 같이 남긴다", async () => {
  const storage = storageStub();
  const instance = new PapersDO({ storage }, env());
  const paper = { id: "2608.19808", title: "FAR-DPO", link: "https://arxiv.org/abs/2608.19808",
    published: "2026-08-20", authors: ["Guofeng Zhang"] };

  await instance.saveReview({ paper, review: { "핵심 방법": "먼저" }, at: 1000 });
  await instance.saveReview({ paper: { ...paper, id: "1111.1111", title: "나중" },
    review: { "핵심 방법": "나중" }, at: 2000 });

  const body = await (await instance.fetch(new Request("https://papers/reviews"))).json();
  assert.deepEqual(body.reviews.map((r) => r.title), ["나중", "FAR-DPO"]);
  assert.equal(body.reviews[1].authors[0], "Guofeng Zhang");
  // 형식에 없는 표제어는 버린다 — 화면이 아는 항목만 그린다.
  assert.deepEqual(Object.keys(body.reviews[0].review), ["핵심 방법"]);
});

test("빈 리뷰는 저장하지 않는다", async () => {
  const instance = new PapersDO({ storage: storageStub() }, env());
  const response = await instance.fetch(new Request("https://papers/reviews", {
    method: "POST", body: JSON.stringify({ paper: { id: "1111.1111" }, review: { "엉뚱한 항목": "값" } }),
  }));
  assert.equal(response.status, 400);
});

test("리뷰는 읽기만 LIFE 세션으로 열고 쓰기는 데몬만 한다", async () => {
  const calls = [];
  const papersEnv = {
    PAPERS: {
      idFromName: () => "id",
      get: () => ({ fetch: (req) => { calls.push(`${req.method} ${new URL(req.url).pathname}`); return Response.json({ ok: true }); } }),
    },
  };
  const call = (owner, method) => handlePapersComments(
    new Request("https://life.bubblelab.dev/_papers/reviews", { method, body: method === "POST" ? "{}" : undefined }),
    papersEnv, new URL("https://life.bubblelab.dev/_papers/reviews"), owner);

  assert.equal((await call(false, "GET")).status, 401);
  // 세션이 있어도 이 문으로는 못 쓴다 — 쓰기는 sink secret 경로다.
  assert.equal((await call(true, "POST")).status, 404);
  assert.equal((await call(true, "GET")).status, 200);
  assert.deepEqual(calls, ["GET /reviews"]);
});

test("리뷰 프롬프트는 초록만 보고 쓰라고 못박는다", () => {
  const prompt = buildReviewPrompt({ title: "T", summary: "S", link: "L", published: "2026-08-20", authors: [] });
  assert.match(prompt, /초록만 보고 씁니다/);
  assert.match(prompt, /800회/);
  for (const field of REVIEW_FIELDS) assert.ok(prompt.includes(field), `${field} 누락`);
});

// ── 두 길이 겹치지 않게 ─────────────────────────────────────────────────

/** 디스코드 채널 조회/발송을 흉내낸다. 최신순으로 준다(실제 API 와 같게). */
function channelStub(rows, posted = []) {
  return async (input, init) => {
    if (init?.method === "POST") { posted.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    return Response.json(rows);
  };
}

const chatEnv2 = (over = {}) => env({ DISCORD_BOT_TOKEN: "t", DISCORD_CHAT_CHANNEL_ID: "77", ...over });

test("상주가 듣고 있으면 폴링은 비켜선다", async () => {
  // 둘 다 답하면 같은 말에 두 번 답한다.
  const storage = storageStub();
  await storage.put("chat:last", "100");
  const instance = new PapersDO({ storage }, chatEnv2());
  await instance.chatAlive({ at: 1_000_000 });

  const rows = [{ id: "101", content: "질문", author: {} }];
  const busy = await instance.chatPoll({ at: 1_000_000 + 60_000, fetchImpl: channelStub(rows) });
  assert.deepEqual(busy.messages, []);
  assert.match(busy.reason, /상주/);

  // 신호가 상하면 폴링이 이어받는다 — PC 를 꺼도 대화가 죽지 않는다.
  const took = await instance.chatPoll({ at: 1_000_000 + GATEWAY_ALIVE_MS + 1, fetchImpl: channelStub(rows) });
  assert.deepEqual(took.messages.map((m) => m.text), ["질문"]);
});

test("처음 켠 순간에는 밀린 대화에 답하지 않는다", async () => {
  const storage = storageStub();
  const rows = [{ id: "300", content: "옛날 글", author: {} }];
  const result = await new PapersDO({ storage }, chatEnv2()).chatPoll({ fetchImpl: channelStub(rows) });
  assert.deepEqual(result.messages, []);
  assert.equal(await storage.get("chat:last"), "300");
});

test("폴링도 봇 말을 빼고 오래된 순서로 준다", async () => {
  const storage = storageStub();
  await storage.put("chat:last", "100");
  const rows = [
    { id: "103", content: "옛날 거라도", author: {} },
    { id: "102", content: "찾았습니다", author: { bot: true } },
    { id: "101", content: "순서형 BO 없나?", author: {} },
  ];
  const result = await new PapersDO({ storage }, chatEnv2()).chatPoll({ fetchImpl: channelStub(rows) });
  assert.deepEqual(result.messages.map((m) => m.text), ["순서형 BO 없나?", "옛날 거라도"]);
  assert.equal(result.cursor, "103");
});

test("폴링은 답한 뒤에 커서를 옮긴다", async () => {
  const storage = storageStub();
  await storage.put("chat:last", "100");
  const posted = [];
  const instance = new PapersDO({ storage }, chatEnv2());

  await instance.chatPoll({ fetchImpl: channelStub([{ id: "101", content: "질문", author: {} }]) });
  assert.equal(await storage.get("chat:last"), "100", "읽기만 했는데 커서가 움직였다");

  await instance.chatReply({ cursor: "101", question: "질문", answer: "답" }, { fetchImpl: channelStub([], posted) });
  assert.equal(posted[0].content, "답");
  assert.equal(await storage.get("chat:last"), "101");
});

test("인텐트가 꺼져 내용이 비어 오면 그렇다고 알린다", async () => {
  const storage = storageStub();
  await storage.put("chat:last", "100");
  const result = await new PapersDO({ storage }, chatEnv2())
    .chatPoll({ fetchImpl: channelStub([{ id: "101", content: "", author: {} }]) });
  assert.equal(result.needsIntent, true);
  assert.match(result.reason, /Message Content/);
});
