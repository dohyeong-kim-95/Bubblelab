// 배포된 사이트를 실제로 찔러 보는 검증기 — "빌드가 됐다"가 아니라 "지금 라이브가
// 맞다"를 본다. scripts/verify-prod.sh 가 이 파일을 부르고, make ship 이 배포 뒤에
// 이걸 통과해야만 성공으로 친다.
//
// 규칙 세 가지:
//  1. **아무것도 쓰지 않는다.** 프로덕션 저장소(DO·R2)에 테스트 페이로드를 넣지
//     않는다 — 예전에 검증 페이로드 한 방이 그날 잔고 스냅샷을 빈 값으로 덮었다.
//     쓰기 경로는 "쓴 뒤에 확인"이 아니라 "지금 저장된 값이 비어 있지 않은지"로
//     검사한다(assertInvestState). 유일한 예외는 채팅 WebSocket 접속인데, 서버가
//     메시지를 저장하지 않으므로 상태가 남지 않는다(--no-ws 로 끌 수 있다).
//  2. **상태코드만 보지 않는다.** 200이어도 형태가 무너져 있으면 실패다.
//  3. **인증 게이트는 거짓 실패를 만들지 않는다.** 자격증명이 없으면 게이트가
//     제대로 막는지(303 /login·401)까지만 확인하고 안쪽은 SKIP으로 남긴다.
//
// 사용: node _infra/verify-prod.mjs [--domain bubblelab.dev] [--commit <sha>] [--json]
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dormantSubdomains } from "./dormant.js";

const ROOT = new URL("..", import.meta.url);

/** 로그인 게이트 뒤에 있는 서브도메인 (worker.js 의 site 분기와 같아야 한다). */
export const GATED_SITES = new Set(["admin", "duri", "life"]);
/** 배포되지 않는 폴더 규칙은 build.mjs 와 같다. */
const SKIP_DIRS = new Set(["dist", "node_modules", "docs", "scripts", ...dormantSubdomains()]);

export function listSites(root = fileURLToPath(ROOT)) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith(".") &&
      !SKIP_DIRS.has(d.name))
    .map((d) => d.name)
    .sort();
}

export function kstDate(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* ── 단언 ──────────────────────────────────────────────────────────────── */

/**
 * 실패를 모아 두는 검사기. 첫 실패에서 던지지 않는 이유는, 한 프로브에서 어긋난
 * 것을 **한꺼번에** 보여줘야 기대값·실제값 diff가 쓸모 있기 때문이다.
 */
export function createChecks() {
  const failures = [];
  const fail = (at, expected, actual) => { failures.push({ at, expected, actual }); return false; };
  const show = (value) => {
    if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}…` : value;
    if (value === undefined) return "undefined";
    try { return JSON.stringify(value)?.slice(0, 200) ?? String(value); } catch { return String(value); }
  };
  return {
    failures,
    eq(at, actual, expected) {
      return actual === expected ? true : fail(at, show(expected), show(actual));
    },
    ok(at, actual, expected = "truthy") {
      return actual ? true : fail(at, expected, show(actual));
    },
    oneOf(at, actual, allowed) {
      return allowed.includes(actual) ? true : fail(at, `one of ${show(allowed)}`, show(actual));
    },
    matches(at, actual, pattern) {
      return typeof actual === "string" && pattern.test(actual)
        ? true : fail(at, `match ${pattern}`, show(actual));
    },
    number(at, actual, { min = -Infinity, max = Infinity } = {}) {
      const n = Number(actual);
      return Number.isFinite(n) && n >= min && n <= max
        ? true : fail(at, `finite number in [${min}, ${max}]`, show(actual));
    },
    nonEmpty(at, actual) {
      const empty = actual === null || actual === undefined ||
        (typeof actual === "string" && actual.trim() === "") ||
        (Array.isArray(actual) && actual.length === 0) ||
        (!Array.isArray(actual) && typeof actual === "object" && Object.keys(actual).length === 0);
      return empty ? fail(at, "non-empty", show(actual)) : true;
    },
    minLength(at, actual, minimum) {
      return Array.isArray(actual) && actual.length >= minimum
        ? true : fail(at, `array length >= ${minimum}`, show(actual?.length ?? actual));
    },
  };
}

/** 경고(soft)는 배포를 되돌리지 않는다 — 상류 API·집 PC 데몬처럼 우리 코드 밖의 것. */
export class Warning extends Error {}

/* ── 표면별 단언 (단위 테스트가 직접 부른다) ──────────────────────────── */

export function assertHealth(health, checks, { expectedCommit = null, today = kstDate() } = {}) {
  checks.eq("health.ok", health?.ok, true);
  checks.matches("health.commit", health?.commit ?? "", /^[0-9a-f]{40}$/);
  checks.eq("health.date (KST)", health?.date, today);
  checks.number("health.siteCount", health?.siteCount, { min: 1 });
  if (expectedCommit) checks.eq("health.commit == 배포한 커밋", health?.commit, expectedCommit);
  for (const [name, present] of Object.entries(health?.bindings ?? {})) {
    checks.eq(`health.bindings.${name}`, present, true);
  }
  checks.nonEmpty("health.bindings", health?.bindings);
  return checks;
}

export function assertStats(stats, checks, { today = kstDate() } = {}) {
  // 날짜가 UTC로 새면 하루가 통째로 어긋난다 — 예전에 타임존 정렬로 데인 자리.
  checks.eq("stats.date (KST)", stats?.date, today);
  checks.number("stats.days", stats?.days, { min: 1, max: 90 });
  checks.nonEmpty("stats.pages", stats?.pages);
  for (const [page, count] of Object.entries(stats?.pages ?? {}).slice(0, 40)) {
    checks.number(`stats.pages["${page}"]`, count, { min: 0 });
  }
  return checks;
}

/** 카탈로그 카테고리는 `_assets/` 의 폴더 이름이 원본이다 (하드코딩하면 새 카테고리마다 거짓 실패). */
export function assetCategories(root = fileURLToPath(ROOT)) {
  return readdirSync(`${root}/_assets`, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function assertCatalog(catalog, checks, { categories = assetCategories() } = {}) {
  checks.eq("catalog.version", catalog?.version, 1);
  checks.minLength("catalog.items", catalog?.items, 5);
  for (const item of (catalog?.items ?? []).slice(0, 200)) {
    checks.nonEmpty(`catalog.item[${item?.id}].id`, item?.id);
    checks.nonEmpty(`catalog.item[${item?.id}].title`, item?.title);
    checks.oneOf(`catalog.item[${item?.id}].category`, item?.category, categories);
  }
  return checks;
}

/**
 * **빈 값 덮어쓰기 탐지기.** 잔고 화면이 200을 주더라도 안쪽이 비어 있으면
 * 데몬이 빈 스냅샷을 올렸거나(과거 사고) 저장이 날아간 것이다.
 */
export function assertInvestState(state, checks, { staleIsWarning = true } = {}) {
  checks.number("invest.updatedAt", state?.updatedAt, { min: 1 });
  checks.nonEmpty("invest.byCurrency", state?.byCurrency);
  checks.minLength("invest.positions", state?.positions, 1);

  const totals = Object.values(state?.byCurrency ?? {});
  const anyValue = totals.some((bucket) => Number(bucket?.value) !== 0);
  checks.ok("invest.byCurrency 합계가 전부 0이 아님", anyValue, "적어도 한 통화의 평가금액 != 0");
  for (const [currency, bucket] of Object.entries(state?.byCurrency ?? {})) {
    checks.number(`invest.byCurrency.${currency}.value`, bucket?.value);
    checks.number(`invest.byCurrency.${currency}.cost`, bucket?.cost);
  }

  // 그래프 점 — 일별 스냅샷이 살아 있는지. 빈 값으로 덮이면 여기서도 티가 난다.
  const series = Object.values(state?.series ?? {});
  checks.ok("invest.series", series.length > 0, "통화별 시계열 1개 이상");
  for (const points of series) {
    checks.minLength("invest.series[].points", points, 1);
    for (const point of (points ?? []).slice(-5)) {
      checks.matches("invest.series[].date", point?.date, /^\d{4}-\d{2}-\d{2}$/);
      checks.number("invest.series[].value", point?.value);
    }
  }
  if (state?.stale && staleIsWarning) {
    throw new Warning(`잔고가 오래됐습니다 (updatedAt=${new Date(state.updatedAt).toISOString()}) — 집 PC 데몬 확인`);
  }
  return checks;
}

export function assertDuriStatus(status, checks, { pendingWarnAt = 200 } = {}) {
  checks.number("duri.head", status?.head, { min: 0 });
  checks.number("duri.ackSeq", status?.ackSeq, { min: 0 });
  checks.ok("duri.ackSeq <= head", Number(status?.ackSeq) <= Number(status?.head),
    `ackSeq <= head (${status?.ackSeq} <= ${status?.head})`);
  checks.number("duri.buffered", status?.buffered, { min: 0 });
  checks.number("duri.cal", status?.cal, { min: 0 });
  if (Number(status?.pending) > pendingWarnAt) {
    throw new Warning(`싱크가 밀려 있습니다 (pending=${status.pending}) — PC 데몬이 도는지 확인`);
  }
  return checks;
}

export function assertLifeStatus(status, checks) {
  checks.eq("life.protocol", status?.protocol, 1);
  checks.number("life.head", status?.head, { min: 0 });
  checks.number("life.oldestSeq", status?.oldestSeq, { min: 1 });
  checks.number("life.entityCount", status?.entityCount, { min: 0 });
  checks.number("life.currentBytes", status?.currentBytes, { min: 0 });
  checks.number("life.sinkAckSeq", status?.sinkAckSeq, { min: 0 });
  checks.number("life.sinkLag", status?.sinkLag, { min: 0 });
  checks.ok("life status has no entity bodies", !Object.hasOwn(status ?? {}, "entities"), "entities omitted");
  return checks;
}

export function assertChatWelcome(message, checks) {
  checks.eq("chat.welcome.type", message?.type, "welcome");
  checks.nonEmpty("chat.welcome.id", message?.id);
  checks.nonEmpty("chat.welcome.nick", message?.nick);
  checks.minLength("chat.welcome.online", message?.online, 1);
  checks.number("chat.welcome.max", message?.max, { min: 1, max: 1000 });
  return checks;
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */

function targetOf({ domain, base }) {
  if (base) {
    // 로컬 서빙(wrangler dev): 첫 경로 세그먼트가 서브도메인이다.
    const root = base.replace(/\/+$/, "");
    return {
      label: root,
      site: (site, path = "/") => `${root}/${site}${path === "/" ? "/" : path}`,
      api: (path) => `${root}${path}`,
      apiOn: (_site, path) => `${root}${path}`,
      origin: () => root,
      apex: () => `${root}/www/`,
      ws: (_site, path) => `${root.replace(/^http/, "ws")}${path}`,
    };
  }
  return {
    label: domain,
    site: (site, path = "/") => `https://${site}.${domain}${path}`,
    api: (path) => `https://${domain}${path}`,
    // 게이트를 통과한 쿠키는 host-only 라 로그인한 호스트에서 불러야 한다.
    apiOn: (site, path) => `https://${site}.${domain}${path}`,
    origin: (site) => (site ? `https://${site}.${domain}` : `https://${domain}`),
    apex: () => `https://${domain}/`,
    ws: (site, path) => `wss://${site}.${domain}${path}`,
  };
}

async function request(url, { method = "GET", timeoutMs = 20000, cookie, headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        // 방문 집계에 잡히지 않도록 프로브임을 밝힌다 (worker 의 봇 필터가 걸러낸다).
        "User-Agent": "bubblelab-verify-prod/1 (+monitor)",
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, status: response.status, text, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

function setCookieValue(headers, name) {
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie() : [headers.get("set-cookie") ?? ""];
  for (const line of raw) {
    const match = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`).exec(line ?? "");
    if (match && match[1]) return `${name}=${match[1]}`;
  }
  return null;
}

/** 폼 로그인 → 세션 쿠키. 실패하면 null (자격증명 문제는 SKIP으로 다룬다). */
async function formLogin(target, site, fields, cookieName, timeoutMs) {
  const url = target.site(site, "/login");
  const { status, headers } = await request(url, {
    method: "POST",
    timeoutMs,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: target.origin(site),
    },
    body: new URLSearchParams(fields).toString(),
  });
  if (status !== 303 && status !== 302) return null;
  return setCookieValue(headers, cookieName);
}

/* ── 프로브 ───────────────────────────────────────────────────────────── */

/**
 * 프로브 하나 = { id, surface, title, needs?, soft?, run(ctx) }.
 * run 은 실패를 던지거나(Error/Warning) checks.failures 를 채운다.
 */
export function buildProbes({ sites, expectedCommit, ws }) {
  const probes = [];
  const add = (probe) => probes.push(probe);

  /* 배포 신원 — 이게 어긋나면 나머지는 옛 배포를 검사하는 셈이다. */
  add({
    id: "health", surface: "worker", title: "배포 신원 (/_health)",
    soft: !expectedCommit,
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.api("/_health"), { timeoutMs });
      checks.eq("GET /_health status", status, 200);
      const health = parseJson(text);
      if (!health) return checks.ok("/_health JSON", false, "JSON 응답");
      assertHealth(health, checks, { expectedCommit });
      return health;
    },
  });

  /* 정적 프론트엔드 — 서브도메인마다 한 장씩. */
  for (const site of sites) {
    const gated = GATED_SITES.has(site);
    add({
      id: `site:${site}`, surface: "static", title: `${site} 첫 화면`,
      async run({ target, checks, timeoutMs }) {
        const { status, text, headers } = await request(target.site(site, "/"), { timeoutMs });
        if (gated) {
          // 로그인 게이트는 "막는 것"이 정상 동작이다. 여기서 200이면 오히려 사고.
          checks.oneOf(`GET ${site}/ status (게이트)`, status, [302, 303]);
          checks.matches(`${site} 로그인 리다이렉트`, headers.get("location") ?? "", /\/login$/);
          return;
        }
        // 리포에는 있는데 라이브에 없는 폴더 = 아직 배포되지 않은 작업(다른 세션이
        // 만드는 중일 수 있다). --commit 으로 "이 커밋이 서빙 중"임을 확인한
        // 배포 검증에서는 진짜 실패지만, 그냥 라이브를 볼 때는 경고에 그친다.
        if (status === 404 && !expectedCommit) {
          throw new Warning(`${site}/ 는 아직 배포되지 않았습니다 (리포에는 있음)`);
        }
        checks.eq(`GET ${site}/ status`, status, 200);
        checks.matches(`${site} content-type`, headers.get("content-type") ?? "", /text\/html/);
        checks.ok(`${site} 본문 길이`, text.length > 500, "> 500 bytes");
        checks.matches(`${site} <title>`, text, /<title>[^<]+<\/title>/);
        // 빈 화면·서버 오류가 200으로 나가는 경우를 잡는다.
        checks.ok(`${site} 오류 문구 없음`, !/Internal Server Error|Application error/i.test(text),
          "오류 문구 없음");
      },
    });
  }

  add({
    id: "www:search-index", surface: "static", title: "랜딩 검색 색인",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.apex(), { timeoutMs });
      checks.eq("GET / status", status, 200);
      checks.matches("랜딩 카드 색인", text, /<script[^>]+id="bl-cards"/);
    },
  });

  add({
    id: "www:404", surface: "static", title: "404 페이지",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(`${target.apex()}__verify_prod_missing__`, { timeoutMs });
      checks.eq("없는 경로 status", status, 404);
      checks.matches("404 본문", text, /404/);
    },
  });

  /* 공개 워커 API — 형태까지 본다. */
  add({
    id: "api:stats", surface: "worker", title: "방문 집계 (/_stats)",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.api("/_stats"), { timeoutMs });
      checks.eq("GET /_stats status", status, 200);
      assertStats(parseJson(text) ?? {}, checks);
    },
  });

  add({
    id: "api:records", surface: "worker", title: "주간 기록 (/_records)",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.api("/_records?game=fruitmerge"), { timeoutMs });
      checks.eq("GET /_records status", status, 200);
      const body = parseJson(text) ?? {};
      checks.matches("records.week", body.week, /^\d{4}-\d{2}-\d{2}$/);
      checks.ok("records.top3 배열", Array.isArray(body.top3), "array");
      // 등록되지 않은 게임은 400 — 서버가 방향·범위를 고정한다는 계약.
      const unknown = await request(target.api("/_records?game=__nope__"), { timeoutMs });
      checks.eq("미등록 게임 거부", unknown.status, 400);
    },
  });

  add({
    id: "api:catalog", surface: "worker", title: "에셋 카탈로그",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.api("/_assets/catalog.json"), { timeoutMs });
      checks.eq("GET /_assets/catalog.json status", status, 200);
      assertCatalog(parseJson(text) ?? {}, checks);
    },
  });

  add({
    id: "api:downloads", surface: "worker", title: "다운로드 집계",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.api("/_asset-downloads"), { timeoutMs });
      checks.eq("GET /_asset-downloads status", status, 200);
      const body = parseJson(text) ?? {};
      checks.ok("downloads.files 객체", body.files && typeof body.files === "object", "object");
      for (const [file, count] of Object.entries(body.files ?? {}).slice(0, 20)) {
        checks.number(`downloads["${file}"]`, count, { min: 0 });
      }
    },
  });

  add({
    id: "api:podcast-session", surface: "do", title: "팟캐스트 세션 (PodcastDO)",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.api("/_podcast/session"), { timeoutMs });
      checks.eq("GET /_podcast/session status", status, 200);
      const body = parseJson(text) ?? {};
      checks.eq("익명은 미인증", body.authenticated, false);
      checks.matches("VAPID 공개키", body.vapidPublicKey ?? "", /^B[A-Za-z0-9_-]{80,}$/);
    },
  });

  add({
    id: "api:emoticon-review", surface: "do", title: "이모티콘 검수 (EmoticonReviewDO)",
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.apiOn("work", "/_emoticon/review"), { timeoutMs });
      checks.eq("GET /_emoticon/review status", status, 200);
      const body = parseJson(text) ?? {};
      checks.eq("review.version", body.version, 1);
      checks.ok("review.items 배열", Array.isArray(body.items), "array");
      for (const item of (body.items ?? []).slice(0, 5)) {
        checks.nonEmpty("review.item.id", item?.id);
        checks.nonEmpty("review.item.character", item?.character);
      }
    },
  });

  add({
    id: "api:brief", surface: "worker", title: "아침 브리핑 날씨 (BriefDO·상류)",
    soft: true, // Open-Meteo 가 흔들리면 우리 배포와 무관하게 실패할 수 있다.
    async run({ target, checks, timeoutMs }) {
      const { status, text } = await request(target.api("/_brief/today?lat=37.5&lon=127.0"), { timeoutMs });
      checks.eq("GET /_brief/today status", status, 200);
      const body = parseJson(text) ?? {};
      checks.eq("brief.date (KST)", body.date, kstDate());
      checks.nonEmpty("brief.region.name", body.region?.name);
      checks.number("brief.current.temp", body.current?.temp, { min: -60, max: 60 });
      checks.number("brief.today.min", body.today?.min, { min: -60, max: 60 });
      checks.ok("brief.today.min <= max", Number(body.today?.min) <= Number(body.today?.max),
        `${body.today?.min} <= ${body.today?.max}`);
    },
  });

  /* 닫혀 있어야 하는 것들 — fail-closed 계약을 매 배포마다 확인한다. */
  add({
    id: "gate:closed", surface: "worker", title: "인증·기능 게이트 (익명 접근)",
    async run({ target, checks, timeoutMs }) {
      // 잠든 기능은 503, 살아 있으면 401 — 어느 쪽이든 익명에게 열리지 않는다.
      const cases = [
        ["/_invest/state", [401, 503]],
        ["/_duri/status", [401]],
        ["/_life/status", [401, 503]],
        ["/_planner/data", [401, 503]],
        ["/_rt/avalon", [503]],       // ENABLE_REALTIME=false
        ["/_chat", [403]],            // Origin 없는 WebSocket 시도
        ["/_assets/upload/x.png", [404]],
      ];
      for (const [path, allowed] of cases) {
        const { status } = await request(target.api(path), { timeoutMs });
        checks.oneOf(`익명 GET ${path}`, status, allowed);
      }
      const fortune = await request(target.api("/_fortune/chart"), { timeoutMs });
      checks.eq("GET /_fortune/chart (POST 전용)", fortune.status, 405);
    },
  });

  /* 게이트 안쪽 — 자격증명이 있을 때만. */
  add({
    id: "duri:status", surface: "do", title: "듀리 중계 상태 (DuriDO·PC 싱크)", needs: "duri",
    async run({ target, checks, timeoutMs, creds }) {
      const cookie = await formLogin(target, "duri", { password: creds.duriPassword }, "bl_duri", timeoutMs);
      if (!cookie) throw new Error("duri 로그인 실패 — BL_DURI_PASSWORD 확인");
      const { status, text } = await request(target.apiOn("duri", "/_duri/status"), { timeoutMs, headers: { cookie } });
      checks.eq("GET /_duri/status status", status, 200);
      assertDuriStatus(parseJson(text) ?? {}, checks);
    },
  });

  add({
    id: "life:status", surface: "do", title: "Life OS 상태 (LifeDO·PC 싱크)", needs: "life",
    async run({ target, checks, timeoutMs, creds }) {
      const cookie = await formLogin(target, "life", { password: creds.lifePassword }, "bl_life", timeoutMs);
      if (!cookie) throw new Error("life 로그인 실패 — BL_LIFE_PASSWORD 확인");
      const { status, text } = await request(target.apiOn("life", "/_life/status"), { timeoutMs, headers: { cookie } });
      checks.eq("GET /_life/status status", status, 200);
      assertLifeStatus(parseJson(text) ?? {}, checks);
    },
  });

  add({
    id: "admin:api", surface: "do", title: "관리자 API (AnalyticsDO·ChatDO 설정)", needs: "admin",
    async run({ target, checks, timeoutMs, creds }) {
      const cookie = await formLogin(
        target, "admin", { id: creds.adminId, password: creds.adminPassword }, "bl_admin", timeoutMs);
      if (!cookie) throw new Error("admin 로그인 실패 — BL_ADMIN_ID/BL_ADMIN_PASSWORD 확인");
      const stats = await request(target.apiOn("admin", "/api/stats"), { timeoutMs, headers: { cookie } });
      checks.eq("GET /api/stats status", stats.status, 200);
      checks.nonEmpty("admin stats 본문", parseJson(stats.text));
      const chat = await request(target.apiOn("admin", "/api/chat"), { timeoutMs, headers: { cookie } });
      checks.eq("GET /api/chat status", chat.status, 200);
      checks.number("채팅 정원", parseJson(chat.text)?.max, { min: 1, max: 1000 });
    },
  });

  /* WebSocket — DO 가 실제로 붙는지. 메시지는 저장되지 않는다. */
  if (ws) {
    add({
      id: "chat:ws", surface: "do", title: "익명 채팅 WebSocket (ChatDO)",
      async run({ target, checks, timeoutMs }) {
        if (typeof WebSocket === "undefined") {
          throw new Warning("이 Node에는 WebSocket이 없습니다 (node --experimental-websocket 필요)");
        }
        const url = target.ws("util", "/_chat");
        const origin = target.origin("util");
        const message = await new Promise((resolve, reject) => {
          const socket = new WebSocket(url, { headers: { Origin: origin } });
          const timer = setTimeout(() => { try { socket.close(); } catch { /* 이미 닫힘 */ } reject(new Error("welcome 메시지 타임아웃")); }, timeoutMs);
          socket.onmessage = (event) => {
            clearTimeout(timer);
            try { socket.close(1000); } catch { /* 이미 닫힘 */ }
            resolve(parseJson(String(event.data)));
          };
          socket.onerror = (event) => {
            clearTimeout(timer);
            reject(new Error(`WebSocket 오류: ${event?.message ?? event?.error?.message ?? "unknown"}`));
          };
        });
        assertChatWelcome(message ?? {}, checks);
      },
    });
  }

  return probes;
}

/* ── 실행기 ───────────────────────────────────────────────────────────── */

export function credsFromEnv(env = process.env) {
  return {
    adminId: env.BL_ADMIN_ID || "",
    adminPassword: env.BL_ADMIN_PASSWORD || "",
    investPassword: env.BL_INVEST_PASSWORD || "",
    duriPassword: env.BL_DURI_PASSWORD || "",
    lifePassword: env.BL_LIFE_PASSWORD || "",
    has(kind) {
      if (kind === "admin") return Boolean(this.adminId && this.adminPassword);
      if (kind === "invest") return Boolean(this.investPassword);
      if (kind === "duri") return Boolean(this.duriPassword);
      if (kind === "life") return Boolean(this.lifePassword);
      return true;
    },
  };
}

export async function runProbes(probes, ctx) {
  const results = [];
  for (const probe of probes) {
    if (probe.needs && !ctx.creds.has(probe.needs)) {
      results.push({ ...summaryOf(probe), state: "SKIP", note: `자격증명 없음 (${probe.needs})`, failures: [] });
      continue;
    }
    const checks = createChecks();
    const started = Date.now();
    try {
      await probe.run({ ...ctx, checks });
      const failures = checks.failures;
      results.push({
        ...summaryOf(probe),
        state: failures.length === 0 ? "PASS" : (probe.soft ? "WARN" : "FAIL"),
        failures,
        ms: Date.now() - started,
      });
    } catch (error) {
      const soft = probe.soft || error instanceof Warning;
      results.push({
        ...summaryOf(probe),
        state: soft ? "WARN" : "FAIL",
        note: error.message,
        failures: checks.failures,
        ms: Date.now() - started,
      });
    }
    if (ctx.onResult) ctx.onResult(results[results.length - 1]);
  }
  return results;
}

const summaryOf = (probe) => ({ id: probe.id, surface: probe.surface, title: probe.title });

export function parseArgs(argv) {
  const args = {
    domain: "bubblelab.dev", base: null, commit: null, json: false, ws: true,
    timeoutMs: 20000, only: null, waitMs: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--domain") args.domain = next();
    else if (arg === "--base") args.base = next();
    else if (arg === "--commit") args.commit = next();
    else if (arg === "--only") args.only = next();
    else if (arg === "--timeout") args.timeoutMs = Number(next()) * 1000;
    else if (arg === "--wait") args.waitMs = Number(next()) * 1000;
    else if (arg === "--json") args.json = true;
    else if (arg === "--no-ws") args.ws = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`알 수 없는 옵션: ${arg}`);
  }
  return args;
}

const USAGE = `사용: node _infra/verify-prod.mjs [옵션]

  --domain <도메인>   기본 bubblelab.dev
  --base <URL>        로컬 서빙 검증 (예: http://localhost:8787)
  --commit <sha>      이 커밋이 서빙 중이어야 통과 (make ship 이 넘긴다)
  --wait <초>         --commit 이 서빙될 때까지 최대 이만큼 기다린다 (배포 전파)
  --only <접두사>     프로브 id 필터 (예: --only invest)
  --timeout <초>      요청 하나의 제한시간 (기본 20)
  --no-ws             WebSocket 프로브 건너뛰기
  --json              결과를 JSON 으로 (make ship 이 diff 출력에 쓴다)

자격증명(없으면 게이트 안쪽은 SKIP):
  BL_ADMIN_ID / BL_ADMIN_PASSWORD / BL_INVEST_PASSWORD / BL_DURI_PASSWORD / BL_LIFE_PASSWORD

이 스크립트는 프로덕션에 **쓰기를 하지 않는다**.`;

/** --commit 이 걸린 배포가 실제로 서빙될 때까지 기다린다 (배포 전파 시간). */
async function waitForCommit(target, commit, waitMs, timeoutMs, log) {
  const deadline = Date.now() + waitMs;
  let last = null;
  while (Date.now() <= deadline) {
    const { text } = await request(target.api("/_health"), { timeoutMs }).catch(() => ({ text: "" }));
    last = parseJson(text)?.commit ?? null;
    if (last === commit) return true;
    log(`  배포 대기 중… 서빙 커밋 ${String(last).slice(0, 7)} ≠ ${commit.slice(0, 7)}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return false;
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.help) { log(USAGE); return 0; }

  const target = targetOf(args);
  const creds = credsFromEnv();
  const sites = listSites();
  let probes = buildProbes({ sites, expectedCommit: args.commit, ws: args.ws });
  if (args.only) probes = probes.filter((probe) => probe.id.startsWith(args.only));

  if (!args.json) {
    log(`verify-prod → ${target.label} (프로브 ${probes.length}개, 쓰기 없음)`);
  }
  if (args.commit && args.waitMs > 0) {
    const arrived = await waitForCommit(target, args.commit, args.waitMs, args.timeoutMs,
      args.json ? () => {} : log);
    if (!arrived && !args.json) log("  기다렸지만 커밋이 바뀌지 않았습니다 — 아래 health 결과를 보세요");
  }

  const results = await runProbes(probes, {
    target, creds, timeoutMs: args.timeoutMs,
    onResult: args.json ? null : (result) => {
      const mark = { PASS: "✓", FAIL: "✗", WARN: "!", SKIP: "-" }[result.state];
      log(`  ${mark} ${result.id.padEnd(22)} ${result.title}${result.note ? ` — ${result.note}` : ""}`);
      for (const failure of result.failures) {
        log(`      ${failure.at}\n        기대: ${failure.expected}\n        실제: ${failure.actual}`);
      }
    },
  });

  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const result of results) counts[result.state]++;
  if (args.json) {
    log(JSON.stringify({ target: target.label, commit: args.commit, counts, results }, null, 2));
  } else {
    log(`\n통과 ${counts.PASS} · 실패 ${counts.FAIL} · 경고 ${counts.WARN} · 건너뜀 ${counts.SKIP}`);
    if (counts.SKIP > 0) log("건너뛴 항목은 자격증명(BL_*)을 주면 검사합니다.");
  }
  return counts.FAIL > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`verify-prod 실패: ${error.message}`);
    process.exit(2);
  });
}
