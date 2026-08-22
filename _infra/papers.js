// papers — 매일 arXiv 에서 "내 문제에 쓸 수 있는" 최적화 논문을 골라 디스코드로 보낸다.
//
// 왜 이런 모양인가 (실측 근거):
//  · 관심 교집합(다목적 × 순서형/조합 공간 × 저예산)은 **2주에 한 편**꼴이다.
//    2026-07-01~08-22 실측 — "multi-objective Bayesian optimization" 8건,
//    BO+categorical/mixed-variable 4건. 그 조건만 걸면 대부분의 날이 빈다.
//  · 반대로 카테고리 4개 합집합은 하루 147편이라 그대로는 못 읽는다.
//  · 그 사이가 **키워드 선필터를 건 하루 ~6편**이다. LLM 이 전부 채점하기 좋은 크기라
//    선필터는 arXiv 쿼리 자체에 넣고(요청 1회), 채점만 LLM 에 맡긴다.
//
// 그래서 화면에 나가는 것은 두 칸이다 — 🎯 정확히 내 문제 / 🔍 인접.
// 8점 이상이 없는 날은 없다고 말한다. 빈 봉투도, 아무거나 채운 봉투도 보내지 않는다.

// arXiv 는 http 로 붙으면 301 이다. https 로 고정한다.
export const ARXIV_API = "https://export.arxiv.org/api/query";

export const CATEGORIES = ["math.OC", "cs.LG", "cs.NE", "stat.ML"];

// 선필터 키워드. 넓히면 후보가 급격히 는다(하루 6편 → 147편) — 늘릴 때는
// 실제 건수를 재보고 늘린다.
export const KEYWORDS = [
  "multi-objective", "Bayesian optimization", "Pareto", "surrogate model",
  "black-box optimization", "sample-efficient", "acquisition function",
  "combinatorial optimization", "design of experiments",
];

/** 내 문제. 채점·요약 프롬프트가 이걸 기준 삼는다. env.PAPERS_PROFILE 로 덮어쓴다. */
export const RESEARCH_PROFILE = `
- 설계 변수: 순서형(ordinal) 이산 변수. 조합 공간 크기 약 3x10^14.
- 목적: 다목적. y 가 여러 개이고 일부는 최대화, 일부는 최소화한다.
  스칼라화·desirability·Pareto 랭킹 같은 "점수 체계" 설계에 관심이 크다.
- 예산: 총 평가 800회. 평가 한 번이 비싸다 (expensive black-box).
- 관심사: 대리모형(GP·트리·신경망), 획득함수, 배치 제안, 제약 처리,
  그리고 **실무에 옮길 때의 난이도**.
`.trim();

export const SCORE_HIT = 8;    // 🎯 정확히 내 문제
export const SCORE_NEAR = 5;   // 🔍 인접
export const MAX_PICKS = 5;    // 디스코드 임베드 상한(10)의 절반. 하루 5편이면 충분하다.
export const MAX_ARCHIVE = 400;
// 주말·공휴일에 arXiv 가 쉬면 하루치가 빈다. 창을 이틀로 잡고 중복은 ID 로 거른다.
export const LOOKBACK_DAYS = 2;

/** KST 기준 YYYY-MM-DD. */
export function kstDate(at = Date.now()) {
  return new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** arXiv submittedDate 는 UTC YYYYMMDDHHMM 이다. */
function stamp(at) {
  return new Date(at).toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

/**
 * 검색식 한 줄. 카테고리 OR × 키워드 OR × 날짜 범위.
 * **선필터를 여기 넣는 게 핵심**이다 — 요청 1회로 하루치 후보가 손에 들어온다.
 */
export function buildQuery(at = Date.now(), { days = LOOKBACK_DAYS } = {}) {
  const cats = CATEGORIES.map((c) => `cat:${c}`).join(" OR ");
  const words = KEYWORDS.map((k) => `abs:"${k}"`).join(" OR ");
  const from = stamp(at - days * 24 * 60 * 60 * 1000);
  const to = stamp(at);
  return `(${cats}) AND (${words}) AND submittedDate:[${from} TO ${to}]`;
}

const stripTags = (s) => String(s ?? "").replace(/<[^>]*>/g, "");
const unescapeXml = (s) => String(s ?? "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const tidy = (s) => unescapeXml(stripTags(s)).replace(/\s+/g, " ").trim();

function tagOf(entry, tag) {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? tidy(match[1]) : "";
}

/**
 * Atom 응답 → 논문 배열. 의존성을 두지 않으려고 정규식으로 읽는다
 * (필드가 단순하고 arXiv 스키마가 안정적이라 파서를 들일 값어치가 없다).
 */
export function parseAtom(xml) {
  const papers = [];
  for (const [, entry] of String(xml ?? "").matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    // id 는 http://arxiv.org/abs/2508.06847v1 — 버전을 떼야 개정판이 중복되지 않는다.
    const raw = tagOf(entry, "id");
    const id = (raw.match(/abs\/(.+?)(v\d+)?$/) ?? [])[1];
    if (!id) continue;
    papers.push({
      id,
      title: tagOf(entry, "title"),
      summary: tagOf(entry, "summary"),
      published: tagOf(entry, "published").slice(0, 10),
      authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => tidy(m[1])).slice(0, 6),
      categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]),
      link: `https://arxiv.org/abs/${id}`,
    });
  }
  return papers;
}

/** arXiv 후보 조회. 하루 1회, 요청 1회 — 3초/요청 한도에 걸릴 일이 없다. */
export async function fetchCandidates({ at = Date.now(), fetchImpl = fetch, max = 60 } = {}) {
  const url = new URL(ARXIV_API);
  url.searchParams.set("search_query", buildQuery(at));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  url.searchParams.set("max_results", String(max));
  const response = await fetchImpl(url, { headers: { Accept: "application/atom+xml" } });
  if (!response.ok) throw new Error(`arXiv 조회 실패 (HTTP ${response.status})`);
  return parseAtom(await response.text());
}

/* ── 채점 ────────────────────────────────────────────────────────────────
 * 후보 전부를 **한 번의 호출로** 비교 채점한다. 편마다 부르면 서로를 못 보고
 * 매기게 되어 점수가 들쭉날쭉해진다(같은 날 6편의 상대 순위가 필요하다).
 */

export function buildScorePrompt(papers, profile = RESEARCH_PROFILE) {
  const list = papers.map((p, i) =>
    `[${i + 1}] ${p.title}\n${p.summary.slice(0, 1200)}`).join("\n\n");
  return `당신은 아래 문제를 실제로 풀고 있는 연구자의 조수입니다.

# 내 문제
${profile}

# 채점 기준 (relevance 1~10)
- 9~10: 이 논문의 방법을 내 문제에 거의 그대로 적용할 수 있다.
- 7~8 : 핵심 요소(순서형/조합 공간, 다목적, 저예산 중 둘 이상)가 맞는다.
- 5~6 : 하나만 맞거나, 아이디어만 옮겨올 수 있다.
- 1~4 : 최적화 논문이지만 내 상황과는 멀다.

**연속변수 전용, 예산이 수만 회 이상, 단일 목적만 다루는 논문은 후하게 주지 마세요.**

# 논문
${list}

# 출력
논문마다 한 줄씩, 다른 말 없이:
번호|점수|한국어로 25자 이내의 이유
예: 1|8|순서형 공간 다목적 BO, 예산 500회`;
}

/** 채점 응답 파싱. 형식이 어긋난 줄은 버린다(모델이 가끔 말을 덧붙인다). */
export function parseScores(text, papers) {
  const scores = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const match = line.match(/^\s*\[?(\d+)\]?\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(.*)$/);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    if (!papers[index]) continue;
    scores.set(papers[index].id, {
      score: Math.max(0, Math.min(10, Number(match[2]))),
      reason: match[3].trim().slice(0, 80),
    });
  }
  return papers.map((paper) => ({
    ...paper,
    score: scores.get(paper.id)?.score ?? 0,
    reason: scores.get(paper.id)?.reason ?? "",
  }));
}

/** 점수순으로 자르고 두 칸으로 나눈다. */
export function pickPapers(scored, { max = MAX_PICKS } = {}) {
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const hits = ranked.filter((p) => p.score >= SCORE_HIT).slice(0, max);
  const near = ranked
    .filter((p) => p.score >= SCORE_NEAR && p.score < SCORE_HIT)
    .slice(0, Math.max(0, max - hits.length));
  return { hits, near };
}

/* ── 요약 ────────────────────────────────────────────────────────────────
 * 적용 관점으로 고정한다. "무슨 아이디어인가" 보다 **"내가 쓸 수 있나"** 가
 * 출퇴근길에 알고 싶은 것이라, 가정·필요 예산·걸림돌을 항목으로 못박는다.
 */

export function buildSummaryPrompt(paper, profile = RESEARCH_PROFILE) {
  return `아래 논문을 "내 문제에 쓸 수 있는가" 관점으로 정리하세요.

# 내 문제
${profile}

# 논문
${paper.title}

${paper.summary}

# 출력 형식 (한국어, 각 항목 한 줄. 표제어는 그대로 두세요)
한줄: (이 논문이 하는 일 한 문장)
아이디어: (핵심 방법 1~2문장)
가정: (이 방법이 성립하려면 무엇이 전제돼야 하는가)
예산: (논문이 몇 회 평가로 검증했는가. 안 적혀 있으면 "명시 없음")
걸림돌: (내 문제에 옮길 때 막힐 지점. 없으면 "특별히 없음")

각 줄은 120자를 넘기지 마세요. 초록에 없는 내용을 지어내지 마세요.`;
}

const FIELDS = ["한줄", "아이디어", "가정", "예산", "걸림돌"];

export function parseSummary(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const match = line.match(/^\s*\**\s*(한줄|아이디어|가정|예산|걸림돌)\s*\**\s*[:：]\s*(.+)$/);
    if (match) out[match[1]] = match[2].replace(/\*\*/g, "").trim().slice(0, 200);
  }
  return out;
}

/* ── LLM ─────────────────────────────────────────────────────────────────
 * podcast-ai.js 와 같은 뜻의 env 교체 방식을 쓰되, 그쪽 프롬프트 빌더에
 * 묶이지 않게 여기서 얇게 부른다(그건 팟캐스트 대본 전용이다).
 */
export async function callLLM(env, prompt, { fetchImpl = fetch } = {}) {
  const key = env.PAPERS_LLM_API_KEY || env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY (또는 PAPERS_LLM_API_KEY) 가 없습니다");
  const model = env.PAPERS_LLM_MODEL || "gemini-flash-latest";
  const base = env.PAPERS_LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

  const response = await fetchImpl(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM 호출 실패 (HTTP ${response.status})`);
  }
  const body = await response.json();
  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) throw new Error("LLM 이 빈 응답을 돌려줬습니다");
  return text;
}

/* ── 디스코드 ────────────────────────────────────────────────────────────
 * 한도: 임베드 10개 · 설명 4096자 · 제목 256자 · **전체 합 6000자**.
 * 전체 합이 가장 먼저 걸리므로 담으면서 세고, 넘치면 그 자리에서 멈춘다.
 */
export const DISCORD_TOTAL_LIMIT = 6000;
const clip = (s, n) => (String(s ?? "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ""));

function describe(paper) {
  const summary = paper.summary_ko ?? {};
  const lines = FIELDS
    .filter((field) => summary[field])
    .map((field) => `**${field}** ${summary[field]}`);
  if (!lines.length) lines.push(clip(paper.summary, 300));
  if (paper.reason) lines.push(`_${paper.reason}_`);
  return clip(lines.join("\n"), 4096);
}

export function buildDiscordPayload(digest) {
  const { date, hits = [], near = [], scanned = 0 } = digest;
  const head = hits.length
    ? `**${date}** · 🎯 내 문제에 맞는 논문 ${hits.length}편`
    : `**${date}** · 🎯 오늘은 정확히 맞는 논문이 없습니다`;
  const tail = near.length ? ` · 🔍 인접 ${near.length}편` : "";
  const content = `${head}${tail}  (후보 ${scanned}편 검토)`;

  const embeds = [];
  let total = content.length;
  for (const paper of [...hits, ...near]) {
    const mark = paper.score >= SCORE_HIT ? "🎯" : "🔍";
    const title = clip(`${mark} ${paper.title}`, 256);
    const description = describe(paper);
    const footer = { text: clip(`${paper.score}점 · ${paper.categories.slice(0, 3).join(", ")}`, 2048) };
    const cost = title.length + description.length + footer.text.length;
    if (embeds.length >= 10 || total + cost > DISCORD_TOTAL_LIMIT) break;
    total += cost;
    embeds.push({ title, url: paper.link, description, footer });
  }
  return { content, embeds };
}

/**
 * 보낼 곳을 고른다. 봇 토큰이 있으면 봇으로, 없으면 웹훅으로.
 *
 * 둘 다 REST 로 같은 payload 를 보내고 rate limit 규칙도 같아서, 다른 건
 * 주소와 Authorization 헤더뿐이다. **OAuth 는 어느 쪽도 런타임에 쓰지 않는다** —
 * 봇은 초대 링크(scope=bot)로 한 번 설치한 뒤 봇 토큰으로 부르고, 웹훅은
 * URL 자체가 자격증명이다. OAuth 인증 코드 플로우가 필요한 건 **남의** 서버·
 * 계정을 대신할 때(webhook.incoming 등)이고 여기 해당하지 않는다.
 *
 * 봇을 쓰면 채널 여러 개·메시지 수정·스레드·나중의 슬래시 명령이 열린다.
 */
export function createDelivery(env) {
  const token = env.DISCORD_BOT_TOKEN;
  const channel = env.DISCORD_CHANNEL_ID;
  if (token && channel) {
    return {
      kind: "bot",
      url: `https://discord.com/api/v10/channels/${channel}/messages`,
      headers: { Authorization: `Bot ${token}` },
    };
  }
  if (env.DISCORD_WEBHOOK_URL) {
    return { kind: "webhook", url: env.DISCORD_WEBHOOK_URL, headers: {} };
  }
  return null;
}

/** 전송. 429 는 Retry-After 만큼 한 번만 기다렸다 다시 보낸다. */
export async function postToDiscord(delivery, payload, { fetchImpl = fetch, sleep } = {}) {
  const target = typeof delivery === "string" ? { url: delivery, headers: {} } : delivery;
  const send = () => fetchImpl(target.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...target.headers },
    body: JSON.stringify(payload),
  });
  let response = await send();
  if (response.status === 429) {
    const wait = Number(response.headers.get("Retry-After") ?? 1) * 1000;
    await (sleep ? sleep(wait) : new Promise((done) => setTimeout(done, wait)));
    response = await send();
  }
  if (!response.ok) throw new Error(`디스코드 전송 실패 (HTTP ${response.status})`);
  return true;
}

/* ── 파이프라인 ──────────────────────────────────────────────────────────
 *
 * 전부 DO 안에서 돈다. 인스턴스가 하나라 같은 날 두 번 돌아도 겹치지 않고,
 * "이미 보낸 논문" 목록을 읽고 쓰는 사이에 끼어들 것이 없다.
 */

/** 보낸 논문 ID 보관 개수. 개정판(v2)이 며칠 뒤 다시 올라오는 것까지 막을 만큼. */
export const SEEN_LIMIT = 600;

export function normalizeDigest(digest) {
  const trim = (paper) => ({
    id: String(paper.id ?? "").slice(0, 32),
    title: String(paper.title ?? "").slice(0, 300),
    link: String(paper.link ?? "").slice(0, 200),
    score: Number(paper.score) || 0,
    reason: String(paper.reason ?? "").slice(0, 120),
    categories: (paper.categories ?? []).slice(0, 6).map((c) => String(c).slice(0, 24)),
    authors: (paper.authors ?? []).slice(0, 6).map((a) => String(a).slice(0, 60)),
    published: String(paper.published ?? "").slice(0, 10),
    // 초록을 남긴다 — LLM 요약이 실패한 편은 이걸로 대체해서 보낸다.
    summary: String(paper.summary ?? "").slice(0, 600),
    summary_ko: Object.fromEntries(
      FIELDS.filter((f) => digestField(paper, f)).map((f) => [f, digestField(paper, f)]),
    ),
  });
  return {
    date: String(digest.date ?? "").slice(0, 10),
    ts: Number(digest.ts) || Date.now(),
    scanned: Number(digest.scanned) || 0,
    hits: (digest.hits ?? []).map(trim),
    near: (digest.near ?? []).map(trim),
  };
}

const digestField = (paper, field) => String(paper?.summary_ko?.[field] ?? "").slice(0, 200);

export class PapersDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async #seen() {
    return new Set((await this.state.storage.get("seen")) ?? []);
  }

  async #remember(ids) {
    const seen = [...(await this.#seen()), ...ids];
    await this.state.storage.put("seen", seen.slice(-SEEN_LIMIT));
  }

  async #save(digest) {
    await this.state.storage.put(`digest:${digest.date}`, digest);
    await this.state.storage.put("latest", digest);
    const stored = await this.state.storage.list({ prefix: "digest:" });
    if (stored.size <= MAX_ARCHIVE) return;
    const keys = [...stored.keys()].sort();
    await this.state.storage.delete(keys.slice(0, stored.size - MAX_ARCHIVE));
  }

  /**
   * 하루치를 만들어 보낸다. 새 논문이 없으면 **아무것도 보내지 않는다** —
   * "오늘은 없습니다" 를 매일 보내면 그것부터 안 읽게 된다.
   */
  async run({ at = Date.now(), fetchImpl = fetch, dryRun = false } = {}) {
    const env = this.env;
    const profile = env.PAPERS_PROFILE || RESEARCH_PROFILE;

    // 보낼 곳부터 본다. 맨 끝에서 확인하면 조회·채점·요약을 전부 태우고 나서
    // 보낼 곳이 없다고 실패하게 된다 — LLM 호출이 그대로 낭비된다.
    const delivery = createDelivery(env);
    if (!delivery && !dryRun) {
      throw new Error("보낼 곳이 없습니다 — DISCORD_WEBHOOK_URL 또는 DISCORD_BOT_TOKEN+DISCORD_CHANNEL_ID");
    }

    const candidates = await fetchCandidates({ at, fetchImpl });
    const seen = await this.#seen();
    const fresh = candidates.filter((paper) => !seen.has(paper.id));
    if (!fresh.length) return { skipped: "새 논문 없음", scanned: candidates.length };

    const scored = parseScores(
      await callLLM(env, buildScorePrompt(fresh, profile), { fetchImpl }),
      fresh,
    );
    const { hits, near } = pickPapers(scored);

    // 요약은 실제로 보낼 것에만 붙인다 — 후보 전부에 붙이면 호출이 6배가 된다.
    for (const paper of [...hits, ...near]) {
      try {
        paper.summary_ko = parseSummary(
          await callLLM(env, buildSummaryPrompt(paper, profile), { fetchImpl }),
        );
      } catch {
        // 요약 하나가 실패해도 나머지는 보낸다. 초록으로 대체된다.
      }
    }

    const digest = normalizeDigest({ date: kstDate(at), ts: at, scanned: candidates.length, hits, near });
    // 고른 게 없어도 본 것은 기억한다 — 내일 같은 논문을 다시 채점하지 않는다.
    await this.#remember(fresh.map((p) => p.id));

    if (!hits.length && !near.length) return { skipped: "고를 만한 논문 없음", scanned: candidates.length };

    await this.#save(digest);
    if (!dryRun) await postToDiscord(delivery, buildDiscordPayload(digest), { fetchImpl });
    return {
      date: digest.date, hits: hits.length, near: near.length,
      scanned: candidates.length, via: delivery?.kind ?? "dry",
    };
  }

  async #archive(limit) {
    const stored = await this.state.storage.list({ prefix: "digest:", reverse: true, limit });
    return [...stored.values()];
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/run" && request.method === "POST") {
      const dryRun = url.searchParams.get("dry") === "1";
      try {
        return Response.json(await this.run({ dryRun }));
      } catch (error) {
        return Response.json({ error: String(error.message ?? error) }, { status: 502 });
      }
    }

    if (url.pathname === "/latest" && request.method === "GET") {
      return Response.json((await this.state.storage.get("latest")) ?? { empty: true });
    }

    if (url.pathname === "/archive" && request.method === "GET") {
      const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 14));
      return Response.json({ digests: await this.#archive(limit) });
    }

    return new Response("not found", { status: 404 });
  }
}

/** 워커의 scheduled 훅이 부른다. */
export async function runDailyPapers(env) {
  const id = env.PAPERS.idFromName("main");
  const response = await env.PAPERS.get(id).fetch(new Request("https://papers/run", { method: "POST" }));
  const body = await response.text();
  if (!response.ok) console.error("papers 일일 실행 실패", body);
  else console.log("papers", body);
}

/** `/_papers/*` 조회. 게이트는 worker 가 담당한다. */
export async function handlePapers(request, env, url) {
  const id = env.PAPERS.idFromName("main");
  const path = url.pathname.replace(/^\/_papers/, "") || "/latest";
  const response = await env.PAPERS.get(id).fetch(
    new Request(`https://papers${path}${url.search}`, { method: request.method }),
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
