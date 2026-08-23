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
// 하루치를 만드는 시각(KST). arXiv 신규 공지가 13~14시 KST 라 그 다음 날 아침이면
// 하루치가 다 모여 있다.
export const DIGEST_HOUR_KST = 7;
/* ── 채널 대화 ────────────────────────────────────────────────────────────
 * 슬래시 명령 없이 전용 채널에 그냥 쓰면 답한다. 듣는 길이 **둘**이다.
 *
 *   상주(`gateway.mjs`)  즉시 답한다. 봇 토큰이 집 PC 에 있어야 한다.
 *   폴링(1분 cron)       1~2분 뒤에 답한다. 토큰이 엣지에만 있어도 된다.
 *
 * **둘 다 돌면 같은 말에 두 번 답한다.** 그래서 상주가 "듣고 있다" 를 1분마다
 * 알리고(`chat:alive`), 그게 신선하면 폴링이 비켜선다. 설정을 바꿔 가며 고르지
 * 않아도 되고, PC 를 끄면 저절로 폴링이 이어받는다.
 *
 * 봇이 채널 글을 읽으려면 개발자 포털에서 **Message Content 인텐트**를 켜야 한다
 * (서버 100개 미만이면 심사 없이 토글만 켜면 된다).
 */
export const CHAT_HISTORY_LIMIT = 12;   // 오가는 말 12개까지 기억한다
export const CHAT_ANSWER_LIMIT = 1800;  // 디스코드 메시지 상한 2000자 안쪽
export const CHAT_SEARCH_MAX = 8;       // 한 번 검색에 물어다 줄 논문 수
// 상주 데몬의 "듣고 있다" 신호가 이보다 오래되면 폴링이 이어받는다. 데몬은
// 1분마다 알리므로 두 번 놓쳐야 넘어간다 — 잠깐의 끊김으로 둘 다 답하지 않게.
export const GATEWAY_ALIVE_MS = 150 * 1000;

/* ── 리뷰 ────────────────────────────────────────────────────────────────
 * 다이제스트의 다섯 줄은 "읽을지 말지" 를 정하는 용도다. 읽기로 한 논문은
 * 그것만으로 부족해서, 한 편을 붙들고 쓴 글을 따로 남긴다.
 *
 * **여기 남는 것은 내가 직접 붙들고 이해한 논문뿐이다.** 봇은 쓰지 못한다 —
 * 기계가 만든 요약을 여기 쌓으면 다이제스트와 다를 게 없고, "내가 읽은 것" 이라는
 * 이 목록의 뜻이 사라진다. 쓰는 길은 `/paper` 하나다(`.claude/commands/paper.md`).
 */
export const REVIEW_FIELDS = [
  "무엇을 한 논문인가", "핵심 방법", "전제와 가정", "실험 설계",
  "내 문제 적용", "따라 해볼 것", "한계와 의심",
];
export const MAX_REVIEWS = 200;

// 댓글. 논문 하나에 여러 개를 쌓을 수 있게 두되, 한 논문에 무한정 쌓이지 않게 막는다.
export const COMMENT_TEXT_LIMIT = 1000;
export const COMMENT_PER_PAPER = 20;
// 찜의 수명. 채점 1회 + 요약 최대 5회이고 각 호출의 상한이 3분이라 최악이 18분이다
// — 그보다 넉넉해야 정상 실행 중에 다른 실행이 끼어들지 않는다.
export const CLAIM_TTL_MS = 30 * 60 * 1000;
/* arXiv 는 주말에 쉬고, 색인에 하루 남짓 더 걸린다. 2026-08-22(토) 23시 KST 에
 * 재어 보니 색인된 최신 논문이 08-20 이었다 — 이틀 창이면 그 날 다이제스트가
 * 통째로 빈다. 닷새면 주말과 색인 지연을 함께 넘고, 이미 보낸 것은 `seen` 이
 * ID 로 거르므로 창을 넓혀도 같은 논문이 두 번 가지 않는다. */
export const LOOKBACK_DAYS = 5;

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
  // 시작점은 그 날 0시로 내린다. 시각까지 맞추면 창의 첫날이 반나절만 걸려
  // 아침에 올라온 논문을 놓친다.
  const from = stamp(at - days * 24 * 60 * 60 * 1000).slice(0, 8) + "0000";
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

/**
 * 아무 말로나 arXiv 를 뒤진다. 하루치 수집(`fetchCandidates`)과 다른 함수인 이유:
 * 저쪽은 **날짜 창 + 키워드 선필터**가 핵심이고, 이쪽은 **기간 제한이 없고**
 * 관련도순이다 — "옛날 거라도" 를 위해서다.
 *
 * 이게 있어야 하는 진짜 이유는 따로 있다. 도구 없이 부르는 `claude` 에게 논문을
 * 물으면 **arXiv 번호를 지어낸다**(기억으로 답하니까). 실제 검색 결과만 보고
 * 답하게 해서 없는 논문을 만들지 못하게 한다.
 */
export async function searchArxiv(query, { fetchImpl = fetch, max = CHAT_SEARCH_MAX } = {}) {
  // 줄바꿈·따옴표가 섞이면 검색식이 깨진다. 모델이 만든 문자열이라 여기서 손본다.
  // 걷어낸 자리에 공백이 겹치므로 한 칸으로 모은다.
  const cleaned = String(query ?? "")
    .replace(/["\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!cleaned) return [];

  const url = new URL(ARXIV_API);
  url.searchParams.set("search_query", `all:"${cleaned}"`);
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("max_results", String(max));
  const response = await fetchImpl(url, { headers: { Accept: "application/atom+xml" } });
  if (!response.ok) throw new Error(`arXiv 검색 실패 (HTTP ${response.status})`);
  return parseAtom(await response.text());
}

/** arXiv 번호 하나로 논문을 집어 온다. 리뷰는 특정 한 편을 붙들고 쓴다. */
export async function fetchPaperById(id, { fetchImpl = fetch } = {}) {
  const clean = String(id ?? "").match(/(\d{4}\.\d{4,5})/)?.[1];
  if (!clean) return null;
  const url = new URL(ARXIV_API);
  url.searchParams.set("id_list", clean);
  const response = await fetchImpl(url, { headers: { Accept: "application/atom+xml" } });
  if (!response.ok) throw new Error(`arXiv 조회 실패 (HTTP ${response.status})`);
  return parseAtom(await response.text())[0] ?? null;
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

/* ── LLM 은 엣지에 없다 ──────────────────────────────────────────────────
 * 채점도 요약도 **집 PC 의 `claude -p`(구독)** 가 만든다. 엣지에서 부르려면
 * 별도 API 키가 필요한데, 이 도구 하나 때문에 키와 청구서를 늘리지 않기로 했다.
 * 그래서 이 파일에는 프롬프트를 짓는 함수와 답을 읽는 함수만 있고, 실제 호출은
 * `_src/papers-sink/` 가 한다 — invest-sink 와 같은 거래다(PC 가 꺼져 있으면
 * 그날 다이제스트는 PC 가 켜질 때까지 미뤄진다).
 */

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

// 프롬프트에서 120자를 넘기지 말라고 하지만 모델이 곧잘 넘긴다. 자를 때는 잘렸다고
// 보이게 한다 — 맨 슬라이스면 문장이 끊긴 자리가 오류처럼 읽힌다.
const digestField = (paper, field) => clip(String(paper?.summary_ko?.[field] ?? ""), 200);

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
  /**
   * PC 데몬이 물어본다: "오늘 치를 내가 만들까?"
   *
   * 판단을 엣지가 하는 이유는 **오늘 것이 이미 저장됐는지 아는 쪽이 여기**라서다.
   * 넘겨줄 때 자리를 찜해 둔다(`claim`) — 데몬은 1분마다 도는데 채점·요약은
   * 몇 분씩 걸려서, 찜하지 않으면 앞선 실행이 끝나기 전에 다음 실행이 같은
   * 하루치를 또 만든다. 찜이 만료되면 다시 집어가므로 데몬이 죽어도 막히지 않는다.
   */
  async claimDigest({ at = Date.now(), claim = true } = {}) {
    const date = kstDate(at);
    const env = this.env;

    if (!createDelivery(env)) {
      return { due: false, reason: "보낼 곳이 없습니다 — DISCORD_BOT_TOKEN+DISCORD_CHANNEL_ID" };
    }
    // 보관본과 "만들어 봤다" 표시를 함께 본다 — 못 고른 날은 보관본이 없다.
    if (await this.state.storage.get(`done:${date}`) || await this.state.storage.get(`digest:${date}`)) {
      return { due: false, reason: "오늘 것은 이미 만들었습니다" };
    }

    // arXiv 신규 공지(13~14시 KST)가 한참 지난 뒤라 하루치가 다 모여 있다.
    const hourKst = new Date(at + 9 * 60 * 60 * 1000).getUTCHours();
    if (hourKst < DIGEST_HOUR_KST) return { due: false, reason: `${DIGEST_HOUR_KST}시 이후에 만듭니다` };

    const claimed = (await this.state.storage.get("claim")) ?? 0;
    if (at - claimed < CLAIM_TTL_MS) return { due: false, reason: "다른 실행이 만드는 중입니다" };
    if (claim) await this.state.storage.put("claim", at);

    return {
      due: true,
      date,
      profile: env.PAPERS_PROFILE || RESEARCH_PROFILE,
      seen: [...(await this.#seen())],
    };
  }

  /**
   * 데몬이 만들어 온 하루치를 받아 보관하고 디스코드로 보낸다.
   *
   * **본 논문 ID 는 고른 게 없어도 기억한다** — 안 그러면 내일 같은 논문을 다시
   * 채점한다. 봇 토큰이 엣지에만 있으므로 발송도 여기서 한다(PC 로 내리지 않는다).
   */
  async completeDigest(payload, { at = Date.now(), fetchImpl = fetch } = {}) {
    const env = this.env;
    const delivery = createDelivery(env);
    if (!delivery) throw new Error("보낼 곳이 없습니다");

    const scanned = Number(payload?.scanned) || 0;
    const ids = Array.isArray(payload?.ids) ? payload.ids.map(String).slice(0, 200) : [];
    const digest = normalizeDigest({
      date: String(payload?.date || kstDate(at)).slice(0, 10),
      ts: at,
      scanned,
      hits: Array.isArray(payload?.hits) ? payload.hits : [],
      near: Array.isArray(payload?.near) ? payload.near : [],
    });

    if (ids.length) await this.#remember(ids);
    await this.state.storage.delete("claim");
    // **고를 게 없어도 그날은 끝난 것으로 표시한다.** 보관본만 기준으로 삼으면
    // 아무것도 못 고른 날에 저장되는 게 없어서, 1분마다 도는 데몬이 하루 종일
    // 같은 하루치를 다시 만들며 arXiv 를 찌른다.
    await this.#finish(digest.date, at);

    if (!digest.hits.length && !digest.near.length) {
      return { skipped: "고를 만한 논문 없음", scanned };
    }

    await this.#save(digest);
    await postToDiscord(delivery, buildDiscordPayload(digest), { fetchImpl });
    return { date: digest.date, hits: digest.hits.length, near: digest.near.length, scanned, via: delivery.kind };
  }

  /** 살아 있는 질문만. 토큰이 죽은 것은 목록에서 뺀다. */
  async #liveAsks(now = Date.now()) {
    const stored = await this.state.storage.list({ prefix: "ask:" });
    return [...stored.values()].filter((ask) => now - (ask?.at ?? 0) < ASK_TTL_MS);
  }

  async #archive(limit) {
    const stored = await this.state.storage.list({ prefix: "digest:", reverse: true, limit });
    return [...stored.values()];
  }

  /** 그날 치를 만들어 봤다는 표시. 보관본과 달리 **못 고른 날에도** 남는다. */
  async #finish(date, at) {
    await this.state.storage.put(`done:${date}`, at);
    const stored = await this.state.storage.list({ prefix: "done:" });
    if (stored.size <= MAX_ARCHIVE) return;
    const keys = [...stored.keys()].sort();
    await this.state.storage.delete(keys.slice(0, stored.size - MAX_ARCHIVE));
  }

  /* ── 채널 대화 ─────────────────────────────────────────────────────────
   * 봇 토큰이 엣지에만 있으므로 채널을 읽고 쓰는 것도 엣지가 한다. 데몬은
   * "새 말 있나" 를 물어보고 답만 만들어 준다.
   */

  /** 새 메시지. 처음 켠 순간에는 **밀린 것을 답하지 않는다** — 자리만 잡는다. */
  async chatPoll({ at = Date.now(), fetchImpl = fetch } = {}) {
    const channel = this.env.DISCORD_CHAT_CHANNEL_ID;
    const token = this.env.DISCORD_BOT_TOKEN;
    if (!channel || !token) return { messages: [], reason: "대화 채널이 설정되지 않았습니다" };

    // 상주 데몬이 듣고 있으면 비켜선다. **둘 다 답하면 같은 말에 두 번 답한다.**
    // 신호가 끊기면 저절로 폴링이 이어받으므로 PC 를 꺼도 대화가 죽지 않는다.
    const alive = (await this.state.storage.get("chat:alive")) ?? 0;
    if (at - alive < GATEWAY_ALIVE_MS) {
      return { messages: [], reason: "상주 데몬이 듣고 있습니다" };
    }

    const since = await this.state.storage.get("chat:last");
    const url = new URL(`https://discord.com/api/v10/channels/${channel}/messages`);
    url.searchParams.set("limit", since ? "20" : "1");
    if (since) url.searchParams.set("after", since);

    const response = await fetchImpl(url, { headers: { Authorization: `Bot ${token}` } });
    if (!response.ok) throw new Error(`채널 조회 실패 (HTTP ${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows)) return { messages: [] };

    // 처음이면 지금 자리만 기억하고 끝낸다. 안 그러면 켜자마자 밀린 대화에
    // 줄줄이 답한다.
    if (!since) {
      if (rows[0]?.id) await this.state.storage.put("chat:last", rows[0].id);
      return { messages: [], reason: "대화 시작 위치를 잡았습니다" };
    }

    // 디스코드는 최신순으로 준다. 오래된 것부터 읽어야 말의 순서가 맞는다.
    const humans = rows.filter((row) => !row.author?.bot);
    const messages = humans
      .filter((row) => String(row.content ?? "").trim())
      .map((row) => ({ id: row.id, text: String(row.content).trim().slice(0, 2000) }))
      .reverse();

    // 인텐트가 꺼져 있으면 글은 오는데 **내용만 빈 채로** 온다. 그냥 넘기면
    // 아무 일도 안 일어난 것처럼 보여서 어디가 막혔는지 알 수 없다.
    if (humans.length && !messages.length) {
      return {
        messages: [],
        needsIntent: true,
        reason: "메시지 내용이 비어 있습니다 — 개발자 포털에서 Message Content 인텐트를 켜세요",
      };
    }

    return {
      messages,
      cursor: rows[0]?.id ?? since,
      history: (await this.state.storage.get("chat:history")) ?? [],
    };
  }

  /** 상주 데몬이 "나 듣고 있다" 고 알린다. 이게 신선하면 폴링이 비켜선다. */
  async chatAlive({ at = Date.now() } = {}) {
    await this.state.storage.put("chat:alive", at);
    return { ok: true };
  }

  /** 답을 채널에 올리고, 오간 말을 기억하고, 커서를 옮긴다. */
  async chatReply({ cursor, question, answer }, { fetchImpl = fetch } = {}) {
    const channel = this.env.DISCORD_CHAT_CHANNEL_ID;
    const token = this.env.DISCORD_BOT_TOKEN;
    if (!channel || !token) throw new Error("대화 채널이 설정되지 않았습니다");

    const text = String(answer ?? "").trim().slice(0, CHAT_ANSWER_LIMIT);
    if (text) {
      await postToDiscord({ kind: "bot", url: `https://discord.com/api/v10/channels/${channel}/messages`,
        headers: { Authorization: `Bot ${token}` } }, { content: text }, { fetchImpl });
    }

    const history = (await this.state.storage.get("chat:history")) ?? [];
    const next = [...history,
      { role: "user", text: String(question ?? "").slice(0, 600) },
      { role: "bot", text: text.slice(0, 600) },
    ].slice(-CHAT_HISTORY_LIMIT);
    await this.state.storage.put("chat:history", next);
    // **답한 뒤에 커서를 옮긴다.** 먼저 옮기면 답을 만들다 죽었을 때 그 말이 사라진다.
    if (cursor) await this.state.storage.put("chat:last", String(cursor));
    return { ok: true, remembered: next.length };
  }

  async chatHistory() {
    return { history: (await this.state.storage.get("chat:history")) ?? [] };
  }

  /** 오간 말을 기억한다. 발송은 게이트웨이가 직접 하므로 여기서는 기억만. */
  async chatRemember({ question, answer }) {
    const history = (await this.state.storage.get("chat:history")) ?? [];
    const next = [...history,
      { role: "user", text: String(question ?? "").slice(0, 600) },
      { role: "bot", text: String(answer ?? "").slice(0, 600) },
    ].slice(-CHAT_HISTORY_LIMIT);
    await this.state.storage.put("chat:history", next);
    return { ok: true, remembered: next.length };
  }

  /* ── 리뷰 ──────────────────────────────────────────────────────────────
   * 보관본(다이제스트)과 키를 나눈다. 다이제스트는 그날 서버가 만든 것이고
   * 리뷰는 내가 읽기로 하고 쌓은 것이라, 성격이 다르면 자리도 다르게 둔다.
   */
  async saveReview({ paper, review, asked, verdict, source, at = Date.now() }) {
    const id = String(paper?.id ?? "").slice(0, 32);
    if (!id) throw new Error("논문이 필요합니다");
    const body = Object.fromEntries(
      REVIEW_FIELDS.filter((f) => review?.[f]).map((f) => [f, String(review[f]).slice(0, 1200)]),
    );
    if (!Object.keys(body).length) throw new Error("리뷰가 비어 있습니다");

    const row = {
      id, at,
      title: String(paper.title ?? "").slice(0, 300),
      link: String(paper.link ?? "").slice(0, 200),
      published: String(paper.published ?? "").slice(0, 10),
      authors: (paper.authors ?? []).slice(0, 6).map((a) => String(a).slice(0, 60)),
      // 초록만 봤는지 전문을 봤는지 남긴다 — 나중에 이 글을 얼마나 믿을지가 달라진다.
      source: source === "full" ? "full" : "abstract",
      review: body,
      // **여기가 이 글을 기계 요약과 가르는 부분이다.** 내가 무엇을 물었고
      // 무엇으로 결론 냈는지는 내가 그 자리에 있었어야만 남는다.
      asked: (asked ?? []).slice(0, 20).map((q) => String(q).slice(0, 300)),
      verdict: String(verdict ?? "").slice(0, 600),
    };
    await this.state.storage.put(`review:${at}:${id}`, row);

    const stored = await this.state.storage.list({ prefix: "review:" });
    if (stored.size > MAX_REVIEWS) {
      await this.state.storage.delete([...stored.keys()].sort().slice(0, stored.size - MAX_REVIEWS));
    }
    return { ok: true, id, title: row.title };
  }

  async #reviews(limit) {
    const stored = await this.state.storage.list({ prefix: "review:", reverse: true, limit });
    return [...stored.values()];
  }

  /* ── 댓글 ──────────────────────────────────────────────────────────────
   * 논문 ID 하나에 키 하나. 다이제스트 안에 끼워 넣지 않는 이유는 보관본이
   * **서버가 만든 그대로**여야 해서다 — 내가 쓴 글이 섞이면 나중에 다시 그릴 때
   * 무엇이 요약이고 무엇이 내 메모인지 구분이 안 된다.
   */
  async #comments() {
    const stored = await this.state.storage.list({ prefix: "comment:" });
    return Object.fromEntries(
      [...stored.entries()].map(([key, items]) => [key.slice("comment:".length), items ?? []]),
    );
  }

  async addComment({ paperId, text, at = Date.now() }) {
    const id = String(paperId ?? "").slice(0, 32);
    const body = String(text ?? "").trim().slice(0, COMMENT_TEXT_LIMIT);
    if (!id || !body) throw new Error("논문과 내용이 필요합니다");

    const items = (await this.state.storage.get(`comment:${id}`)) ?? [];
    // 오래된 것부터 밀어낸다 — 최근 생각이 남는 편이 낫다.
    const next = [...items, { id: `${at.toString(36)}${items.length}`, text: body, at }]
      .slice(-COMMENT_PER_PAPER);
    await this.state.storage.put(`comment:${id}`, next);
    return { paperId: id, comments: next };
  }

  async removeComment({ paperId, id }) {
    const key = `comment:${String(paperId ?? "").slice(0, 32)}`;
    const items = (await this.state.storage.get(key)) ?? [];
    const next = items.filter((item) => item.id !== id);
    // 마지막 하나를 지우면 키까지 지운다 — 빈 배열이 목록에 남지 않게.
    if (next.length) await this.state.storage.put(key, next);
    else await this.state.storage.delete(key);
    return { paperId: key.slice("comment:".length), comments: next };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/chat" && request.method === "GET") {
      try {
        return Response.json(await this.chatPoll());
      } catch (error) {
        return Response.json({ error: String(error.message ?? error) }, { status: 502 });
      }
    }

    if (url.pathname === "/chat/reply" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      try {
        return Response.json(await this.chatReply(payload ?? {}));
      } catch (error) {
        return Response.json({ error: String(error.message ?? error) }, { status: 502 });
      }
    }

    if (url.pathname === "/chat/alive" && request.method === "POST") {
      return Response.json(await this.chatAlive());
    }

    if (url.pathname === "/chat/history" && request.method === "GET") {
      return Response.json(await this.chatHistory());
    }

    if (url.pathname === "/chat/remember" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      return Response.json(await this.chatRemember(payload ?? {}));
    }

    if (url.pathname === "/reviews" && request.method === "GET") {
      const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 30));
      return Response.json({ reviews: await this.#reviews(limit) });
    }

    if (url.pathname === "/reviews" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      try {
        return Response.json(await this.saveReview(payload ?? {}));
      } catch (error) {
        return Response.json({ error: String(error.message ?? error) }, { status: 400 });
      }
    }

    if (url.pathname === "/comments" && request.method === "GET") {
      return Response.json({ comments: await this.#comments() });
    }

    if (url.pathname === "/comments" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      try {
        return Response.json(await this.addComment(payload ?? {}));
      } catch (error) {
        return Response.json({ error: String(error.message ?? error) }, { status: 400 });
      }
    }

    if (url.pathname === "/comments/delete" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      return Response.json(await this.removeComment(payload ?? {}));
    }

    // PC 데몬이 하루치를 가져가고(찜) 만들어서 돌려준다.
    if (url.pathname === "/digest/pending" && request.method === "GET") {
      const claim = url.searchParams.get("peek") !== "1";
      return Response.json(await this.claimDigest({ claim }));
    }

    if (url.pathname === "/digest/done" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      try {
        return Response.json(await this.completeDigest(payload ?? {}));
      } catch (error) {
        return Response.json({ error: String(error.message ?? error) }, { status: 502 });
      }
    }

    // 디스코드 슬래시 명령이 넣는다. 답은 PC 데몬이 채운다.
    if (url.pathname === "/ask" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      const id = String(payload?.id ?? "").slice(0, 64);
      const token = String(payload?.token ?? "").slice(0, 200);
      const question = String(payload?.question ?? "").trim().slice(0, 500);
      if (!id || !token || !question) {
        return Response.json({ error: "invalid ask" }, { status: 400 });
      }
      await this.state.storage.put(`ask:${id}`, { id, token, question, at: Date.now() });
      return Response.json({ ok: true, id });
    }

    // PC 데몬이 가져간다.
    if (url.pathname === "/asks" && request.method === "GET") {
      return Response.json({ asks: await this.#liveAsks() });
    }

    // 처리한 것을 지운다. 시간이 지나 죽은 것도 같이 걷어낸다.
    if (url.pathname === "/asks/done" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      const ids = Array.isArray(payload?.ids) ? payload.ids.slice(0, 50) : [];
      const live = new Set((await this.#liveAsks()).map((ask) => ask.id));
      const stored = await this.state.storage.list({ prefix: "ask:" });
      const stale = [...stored.values()].filter((ask) => !live.has(ask.id)).map((ask) => ask.id);
      const drop = [...new Set([...ids, ...stale])].map((id) => `ask:${id}`);
      if (drop.length) await this.state.storage.delete(drop);
      return Response.json({ ok: true, removed: drop.length });
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
/**
 * 밖으로 열어 두는 경로. **읽기 전용만** 연다.
 *
 * 하루치를 만드는 경로가 여기 없는 건 실수가 아니다 — 열려 있으면 아무나 남의
 * 디스코드로 발송을 시킬 수 있다. 만드는 쪽은 sink secret 뒤에 둔다.
 */
const PUBLIC_PATHS = new Set(["/latest", "/archive"]);

/** PC 데몬만 부르는 경로. sink secret 으로 막는다. */
const SINK_PATHS = new Set(["/asks", "/asks/done", "/digest/pending", "/digest/done", "/chat", "/chat/reply", "/chat/alive", "/chat/history", "/chat/remember", "/reviews"]);

/**
 * 댓글과 리뷰 읽기. **LIFE 세션 쿠키로만** 연다 — 화면이 게이트 뒤에 있으니 쓰기도 같은
 * 자격으로 맞춘다. `/_papers/*` 는 게이트보다 앞에서 처리되므로 여기서 직접
 * 확인해야 한다(그냥 두면 주소만 알면 남이 쓸 수 있다).
 *
 * `owner` 판정은 worker.js 가 한다 — 세션 열쇠가 거기 있다.
 */
export async function handlePapersComments(request, env, url, owner) {
  if (!owner) return Response.json({ error: "authentication required" }, { status: 401 });

  const path = url.pathname.replace(/^\/_papers/, "");
  // 리뷰는 **읽기만** 여기로 온다 — 쓰는 쪽은 데몬이라 sink secret 을 쓴다.
  const owned = new Set(["/comments", "/comments/delete", "/reviews"]);
  if (!owned.has(path)) return new Response("not found", { status: 404 });
  if (path === "/reviews" && request.method !== "GET") {
    return new Response("not found", { status: 404 });
  }

  const id = env.PAPERS.idFromName("main");
  const response = await env.PAPERS.get(id).fetch(
    new Request(`https://papers${path}${url.search}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: request.method === "POST" ? await request.text() : undefined,
    }),
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** 길이·내용 모두 상수 시간으로 비교한다. 인증 경계라 값싼 대로 제대로 한다. */
export function secretMatches(offered, expected) {
  const a = new TextEncoder().encode(String(offered ?? ""));
  const b = new TextEncoder().encode(String(expected ?? ""));
  if (!b.length) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** 데몬 인증. 질문 원문과 다이제스트가 오가므로 아무나 읽게 두지 않는다. */
export async function handlePapersSink(request, env, url) {
  const path = url.pathname.replace(/^\/_papers/, "");
  if (!SINK_PATHS.has(path)) return new Response("not found", { status: 404 });
  if (!env.PAPERS_SINK_SECRET) return new Response("papers sink is not configured", { status: 503 });
  const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secretMatches(offered, env.PAPERS_SINK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = env.PAPERS.idFromName("main");
  const response = await env.PAPERS.get(id).fetch(
    // 쿼리를 함께 넘긴다 — 떼면 `?peek=1`(찜하지 않고 보기)이 조용히 무시된다.
    new Request(`https://papers${path}${url.search}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: request.method === "POST" ? await request.text() : undefined,
    }),
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** `/_papers/*` 조회. */
export async function handlePapers(request, env, url) {
  const path = url.pathname.replace(/^\/_papers/, "") || "/latest";
  if (request.method !== "GET" || !PUBLIC_PATHS.has(path)) {
    return new Response("not found", { status: 404 });
  }
  const id = env.PAPERS.idFromName("main");
  const response = await env.PAPERS.get(id).fetch(
    new Request(`https://papers${path}${url.search}`, { method: "GET" }),
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/* ── 질문에 답하기 (디스코드 슬래시 명령) ────────────────────────────────
 *
 * 채점·요약·답변이 모두 집 PC 의 Claude 로 간다. 요약은 정해진
 * 틀을 채우는 일이라 싼 모델로 충분하지만, "이 방법을 800회 예산에 쓸 수 있나"
 * 같은 물음은 논문의 가정과 내 제약을 견줘야 해서 추론 품질이 실제로 갈린다.
 */

// 디스코드 임베드 설명 한도가 4096자다. 그보다 앞서 읽기 힘들어지므로 더 짧게 끊는다.
export const ANSWER_LIMIT = 1400;
// interaction 토큰은 15분이면 죽는다. 그 안에 못 답하면 버린다 — 데몬이 한참
// 뒤에 깨어나 이미 의미 없는 질문에 답하고 PATCH 가 실패하는 걸 막는다.
export const ASK_TTL_MS = 14 * 60 * 1000;

/** 최신 다이제스트를 문맥으로 깔아 준다. 없으면 논문 없이 답한다. */
export function buildAskPrompt(digest, question, profile = RESEARCH_PROFILE) {
  const papers = [...(digest?.hits ?? []), ...(digest?.near ?? [])];
  const context = papers.length
    ? papers.map((paper, i) => {
      const summary = FIELDS.filter((f) => paper.summary_ko?.[f])
        .map((f) => `${f}: ${paper.summary_ko[f]}`).join("\n");
      return `[${i + 1}] ${paper.title} (${paper.score}점)\n${summary || paper.summary}\n${paper.link}`;
    }).join("\n\n")
    : "(오늘 고른 논문이 없습니다)";

  return `당신은 아래 문제를 실제로 풀고 있는 연구자의 조수입니다.

# 내 문제
${profile}

# 오늘의 논문 (${digest?.date ?? "날짜 미상"})
${context}

# 질문
${question}

# 답할 때
- **적용 관점으로** 답하세요. 아이디어 설명보다 "내 문제에 쓸 수 있는가"가 먼저입니다.
- 위 논문에 없는 내용은 **지어내지 마세요.** 초록만으로 판단할 수 없으면 그렇게 말하고,
  본문의 어느 부분을 봐야 하는지 알려주세요.
- 일반적인 최적화 지식으로 답해도 되지만, 그때는 논문 근거가 아니라는 걸 밝히세요.
- 한국어로, ${ANSWER_LIMIT}자 이내. 출퇴근길에 읽습니다 — 문단을 짧게 끊으세요.`;
}

/* ── 채널 대화 프롬프트 ──────────────────────────────────────────────────
 *
 * 두 걸음으로 나눈다. ① 지금 말에 답하려면 논문을 뒤져야 하는지 모델이 정하고,
 * ② 뒤져야 한다면 **데몬이 실제로 arXiv 를 부른 뒤** 그 결과만 보여 주고 답하게
 * 한다. 도구를 쥐여 주지 않고도(=인젝션 위험을 늘리지 않고) 근거 있는 답이 된다.
 */

const chatHistory = (history) => (history ?? [])
  .map((turn) => `${turn.role === "bot" ? "나(조수)" : "연구자"}: ${turn.text}`)
  .join("\n") || "(첫 대화입니다)";

export function buildChatPrompt(history, message, digest, profile = RESEARCH_PROFILE) {
  return `당신은 아래 문제를 실제로 풀고 있는 연구자의 조수입니다. 디스코드에서
대화 중이고, 지금 연구자가 한 말에 답해야 합니다.

# 내 문제
${profile}

# 최근 다이제스트 (${digest?.date ?? "없음"})
${[...(digest?.hits ?? []), ...(digest?.near ?? [])]
    .map((paper) => `- ${paper.title} (${paper.score}점) ${paper.link}`).join("\n") || "(없음)"}

# 지금까지 오간 말
${chatHistory(history)}

# 연구자가 방금 한 말
${message}

# 지금 할 일
논문을 새로 찾아야 답할 수 있으면, **다른 말 없이 첫 줄에만** 이렇게 쓰세요:
SEARCH: <영어 검색어>

arXiv 전체를 훑습니다(기간 제한 없음 — 옛날 논문도 나옵니다). "옛날 거라도",
"더 찾아봐", "이런 주제 없나" 같은 말이면 검색하세요.

찾을 필요 없이 지금 아는 것으로 답할 수 있으면 그냥 한국어로 답하세요.
**논문 제목이나 arXiv 번호를 기억에 기대어 쓰지 마세요** — 그럴 상황이면 검색하세요.

**여기는 거르는 자리입니다.** 초록까지만 보고 "읽어볼 만한가" 를 가릅니다.
제대로 읽는 것은 연구자가 직접 `/paper` 로 합니다 — 대신 읽어 주겠다고 하지 마세요.
읽어볼 만하다고 판단되면 "`/paper <번호>` 로 붙들면 됩니다" 라고 알려주세요.
**논문 제목이나 arXiv 번호를 기억에 기대어 쓰지 마세요** — 그럴 상황이면 검색하세요.
한국어로, ${CHAT_ANSWER_LIMIT}자 이내. 문단을 짧게 끊으세요.`;
}

export function parseSearchRequest(text) {
  const match = String(text ?? "").match(/^\s*SEARCH:\s*(.+)$/m);
  return match ? match[1].trim().slice(0, 200) : null;
}

export function buildChatAnswerPrompt(history, message, papers, query, profile = RESEARCH_PROFILE) {
  const found = papers.length
    ? papers.map((paper, i) =>
      `[${i + 1}] ${paper.title} (${paper.published?.slice(0, 7) ?? "?"})\n${paper.summary.slice(0, 900)}\n${paper.link}`)
      .join("\n\n")
    : "(검색 결과가 없습니다)";

  return `당신은 아래 문제를 실제로 풀고 있는 연구자의 조수입니다.

# 내 문제
${profile}

# 지금까지 오간 말
${chatHistory(history)}

# 연구자가 방금 한 말
${message}

# "${query}" 로 arXiv 를 찾은 결과
${found}

# 답할 때
- **위 목록에 있는 논문만** 언급하세요. 목록에 없는 제목·arXiv 번호를 쓰면 안 됩니다.
  기억에 있는 다른 논문이 떠올라도 쓰지 마세요 — 번호가 틀립니다.
- 쓸 만한 게 없으면 없다고 말하고, 검색어를 어떻게 바꾸면 좋을지 알려주세요.
- 편마다 **내 문제에 쓸 수 있는지**를 한 줄로 판단해 주세요. 800회 예산·순서형
  조합 공간·다목적이 기준입니다.
- 링크는 그대로 붙여 주세요. 한국어로, ${CHAT_ANSWER_LIMIT}자 이내.`;
}

/* ── 리뷰 프롬프트 ───────────────────────────────────────────────────────
 * 초록만 보고 쓴다는 걸 숨기지 않는다 — 본문을 봐야 아는 것은 "봐야 한다" 고
 * 적게 한다. 지어낸 확신보다 정확한 모름이 낫다.
 */
export function buildReviewPrompt(paper, profile = RESEARCH_PROFILE) {
  return `아래 논문을 한 편 붙들고 정리하세요. 읽을지 말지를 고르는 요약이 아니라,
**읽기로 한 논문을 공부한 결과물**입니다.

# 내 문제
${profile}

# 논문
${paper.title}
${paper.authors?.slice(0, 6).join(", ") ?? ""} (${paper.published?.slice(0, 7) ?? "?"})
${paper.link}

${paper.summary}

# 출력 형식 (한국어. 표제어를 그대로 두고 각 항목 아래에 씁니다)
${REVIEW_FIELDS.map((f) => `${f}: …`).join("\n")}

# 쓸 때
- **초록만 보고 씁니다.** 본문을 봐야 아는 것은 "본문의 어디를 봐야 한다" 고 적으세요.
  지어낸 확신보다 정확한 모름이 낫습니다.
- "내 문제 적용" 은 800회 예산·순서형 3x10^14 조합 공간·다목적을 기준으로
  **쓸 수 있다/없다를 분명히** 하고 이유를 답니다.
- "따라 해볼 것" 은 내일 당장 코드로 옮길 수 있는 크기로 적으세요. 없으면 없다고.
- 항목마다 2~5문장. 전체 1500자 안쪽.`;
}

export function parseReview(text) {
  const out = {};
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    const head = line.match(/^\s*\**\s*(.+?)\s*\**\s*[:：]\s*(.*)$/);
    const field = head && REVIEW_FIELDS.find((f) => head[1].replace(/\*/g, "").trim() === f);
    if (field) {
      current = field;
      out[current] = head[2].replace(/\*\*/g, "").trim();
    } else if (current && line.trim()) {
      out[current] = `${out[current]} ${line.replace(/\*\*/g, "").trim()}`.trim();
    }
  }
  return Object.fromEntries(
    Object.entries(out).filter(([, v]) => v).map(([k, v]) => [k, v.slice(0, 1200)]),
  );
}

/* ── 질문 큐 ─────────────────────────────────────────────────────────────
 *
 * 엣지는 질문을 적어 두기만 하고, 답은 집 PC 의 Claude Code 가 만든다
 * (`claude -p`, 구독 사용 — API 키가 필요 없다). invest 의 "지금 갱신" 과 같은
 * 구조다: 엣지가 못 하는 일을 PC 가 가져가는 형태.
 */
