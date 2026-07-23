// 리포 루트에서 `_`나 `.`로 시작하지 않는 폴더 = 서브도메인.
// 각 폴더를 dist/ 로 복사하고, index.html이 없는 서브도메인 루트에는
// 하위 폴더 목록 페이지를 자동 생성한다. (slop에 토이를 추가하면
// slop.bubblelab.dev 홈에 자동으로 링크가 뜬다.)
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAssetCatalog } from "./assets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SKIP = new Set(["dist", "node_modules"]);
// 서브도메인 공개 구분. 퍼블릭은 www 랜딩 카드와 카테고리 홈 풀다운 메뉴에
// 노출되고, confidential은 주소를 직접 쳐야만 들어갈 수 있다(어디에도 링크 없음).
// 새 폴더는 기본 퍼블릭이며, 빌드가 www 랜딩 카드 존재 여부를 검사한다.
const CONFIDENTIAL_SUBDOMAINS = new Set(["admin", "work", "podcast", "estate"]);
// 백엔드가 보안상 닫혀 있는 동안 카테고리 홈에서 발견되지 않게 한다.
// 소스와 직접 URL은 유지되며, 인증/ACL 검토 후 이 목록에서 제거한다.
const UNLISTED_ENTRIES = new Map([
  ["games", new Set(["avalon", "liargame", "yacht"])],
]);

const isSite = (d) =>
  d.isDirectory() &&
  !d.name.startsWith("_") &&
  !d.name.startsWith(".") &&
  !SKIP.has(d.name);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);

// README는 온보딩 문서일 뿐이므로 배포에서 제외
const notReadme = (src) => !src.endsWith("/README.md");

const sites = readdirSync(ROOT, { withFileTypes: true }).filter(isSite);

// 퍼블릭 서브도메인은 반드시 www 랜딩에 카드로 연결되고,
// confidential 서브도메인은 랜딩에 링크가 있으면 안 된다.
{
  const landing = readFileSync(join(ROOT, "www", "index.html"), "utf8");
  for (const { name } of sites) {
    if (name === "www") continue;
    const linked = landing.includes(`https://${name}.bubblelab.dev`);
    if (CONFIDENTIAL_SUBDOMAINS.has(name) && linked) {
      throw new Error(`confidential subdomain "${name}" must not be linked from www/index.html`);
    }
    if (!CONFIDENTIAL_SUBDOMAINS.has(name) && !linked) {
      throw new Error(
        `public subdomain "${name}" is missing from www/index.html — ` +
        `랜딩에 카드를 추가하거나 _infra/build.mjs의 CONFIDENTIAL_SUBDOMAINS에 등록하세요`,
      );
    }
  }
}
for (const site of sites) {
  cpSync(join(ROOT, site.name), join(DIST, site.name), {
    recursive: true,
    filter: notReadme,
  });
}

// 공용 에셋은 dist 루트로 (worker가 /_shared/* 를 프리픽스 없이 서빙)
if (existsSync(join(ROOT, "_shared"))) {
  cpSync(join(ROOT, "_shared"), join(DIST, "_shared"), {
    recursive: true,
    filter: notReadme,
  });
}

// Bubblelab 전체 서비스가 함께 쓰는 이미지 원본. 각 아이템 폴더의
// metadata.json을 모아 다운로드 화면과 다른 서비스가 읽는 카탈로그를 만든다.
if (existsSync(join(ROOT, "_assets"))) {
  cpSync(join(ROOT, "_assets"), join(DIST, "_assets"), {
    recursive: true,
    filter: notReadme,
  });
  const catalog = generateAssetCatalog(join(ROOT, "_assets"));
  writeFileSync(
    join(DIST, "_assets", "catalog.json"),
    JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), items: catalog }, null, 2),
  );
  console.log(`generated asset catalog (${catalog.length} items)`);
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 토이의 index.html에서 이모지(카드 아이콘용)를 뽑아온다.
function toyEmoji(site, name) {
  try {
    const html = readFileSync(join(ROOT, site, name, "index.html"), "utf8");
    const m = html.match(/\p{Extended_Pictographic}/u);
    if (!m) return { char: "🫧", badge: "" };
    // 이모지 바로 뒤에 '+'가 붙어 있으면 카드에 작은 플러스 배지를 단다
    return { char: m[0], badge: html[m.index + m[0].length] === "+" ? "+" : "" };
  } catch {
    return { char: "🫧", badge: "" };
  }
}

// 이름을 해시해서 카드마다 고정된 파스텔 색상을 준다.
function hueOf(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

function listingPage(site, entries) {
  const categoryNames = sites
    .map((item) => item.name)
    .filter((name) => name !== "www" && !CONFIDENTIAL_SUBDOMAINS.has(name))
    .sort((a, b) => a.localeCompare(b, "ko"));
  const categoryLinks = categoryNames
    .map((name) => `      <a href="https://${escapeHtml(name)}.bubblelab.dev"${name === site ? ' aria-current="page"' : ""}><span>${name === site ? "✓" : ""}</span>${escapeHtml(name)}</a>`)
    .join("\n");
  const preconnectLinks = [
    '<link rel="preconnect" href="https://bubblelab.dev">',
    ...categoryNames
      .filter((name) => name !== site)
      .map((name) => `<link rel="preconnect" href="https://${escapeHtml(name)}.bubblelab.dev">`),
  ].join("\n");
  // 명예의 전당은 게임이 아니라 요약 화면이라, 그리드 맨 위 한 행을 전부
  // 차지하는 금색 배너로 분리한다 (인기순 재정렬에서도 고정 — card--pinned).
  const hofEntry = entries.find(({ name }) => name === "hall-of-fame");
  const gameEntries = entries.filter(({ name }) => name !== "hall-of-fame");
  const hofCard = hofEntry
    ? `    <a class="card card--hof card--pinned" href="/hall-of-fame/" style="--hue:45;--i:0">
      <span class="hof-emoji">🏆</span>
      <span class="hof-text"><span class="hof-name">명예의 전당</span><span class="hof-desc">전체 게임 올타임 1위 모음</span></span>
      <span class="hof-arrow" aria-hidden="true">→</span>
    </a>\n`
    : "";
  const gameCards = gameEntries
    .map(({ name, emoji }, i) => {
      return `    <a class="card" href="/${escapeHtml(name)}/"
       style="--hue:${hueOf(name)};--i:${i + (hofEntry ? 1 : 0)}">
      <span class="emoji"${emoji.badge ? ' data-badge="+"' : ""}>${emoji.char}</span>
      <span class="name">${escapeHtml(name)}</span>
      <span class="champ" data-game="${escapeHtml(name)}"></span>
      <span class="mine"></span>
    </a>`;
    })
    .join("\n");
  const cards = hofCard + gameCards;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(site)}.bubblelab.dev</title>
${preconnectLinks}
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace; max-width: 52rem;
         margin: 3rem auto 4rem; padding: 0 1.25rem; }
  h1 { font-size: 1.25rem; text-align: center; margin: 0 0 .4rem; }
  .site-switcher { position: relative; width: max-content; max-width: 100%; margin: 0 auto; }
  .site-trigger { border: 0; padding: .35rem .5rem; border-radius: .55rem; background: transparent;
          color: inherit; font: inherit; cursor: pointer; }
  .site-trigger:hover, .site-trigger:focus-visible { background: light-dark(#edf1f5, #1a2330); outline: none; }
  .site-trigger .domain { opacity: .45; font-weight: normal; }
  .site-trigger .chevron { display: inline-block; margin-left: .18rem; opacity: .5; font-size: .8em;
          transition: transform .15s; }
  .site-trigger[aria-expanded="true"] .chevron { transform: rotate(180deg); }
  .site-menu { position: absolute; z-index: 30; top: calc(100% + .3rem); left: 50%; transform: translateX(-50%);
          width: 13rem; padding: .4rem; border-radius: .8rem;
          background: light-dark(#fff, #141d28); border: 1px solid light-dark(#dce3ea, #2a3747);
          box-shadow: 0 12px 30px light-dark(#1b27331f, #0008); text-align: left; }
  .site-menu[hidden] { display: none; }
  .site-menu a { display: grid; grid-template-columns: 1.3rem 1fr; align-items: center;
          padding: .65rem .7rem; border-radius: .55rem; color: inherit; text-decoration: none; font-size: .9rem; }
  .site-menu a:hover, .site-menu a:focus-visible { background: light-dark(#eef3f7, #202c3a); outline: none; }
  .site-menu a[aria-current="page"] { font-weight: bold; }
  .site-menu a.loading { opacity: .65; pointer-events: none; }
  .site-menu a.loading::after { content: "…"; margin-left: auto; }
  .site-menu .menu-home { border-bottom: 1px solid light-dark(#e6ebef, #263342); margin-bottom: .25rem; }
  #crown { text-align: center; opacity: .6; font-size: .85rem;
           margin: 0 0 .35rem; min-height: 1.2em; }
  #streak { text-align: center; opacity: .6; font-size: .8rem;
           margin: 0 0 1.8rem; min-height: 1.2em; }
  .grid { display: grid; gap: 1rem;
          grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); }
  .card { aspect-ratio: 1; border-radius: 1.25rem; text-decoration: none;
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: .55rem; padding: .75rem;
          color: light-dark(hsl(var(--hue) 45% 22%), hsl(var(--hue) 55% 88%));
          background: light-dark(hsl(var(--hue) 75% 91%), hsl(var(--hue) 35% 20%));
          border: 2px solid light-dark(hsl(var(--hue) 60% 82%), hsl(var(--hue) 35% 30%));
          box-shadow: 0 4px 0 light-dark(hsl(var(--hue) 55% 78%), hsl(var(--hue) 35% 12%));
          transition: transform .12s, box-shadow .12s;
          animation: pop .4s cubic-bezier(.2,1.5,.4,1) both;
          animation-delay: calc(var(--i) * 45ms); }
  .card:hover { transform: translateY(-3px);
          box-shadow: 0 7px 0 light-dark(hsl(var(--hue) 55% 78%), hsl(var(--hue) 35% 12%)); }
  .card:active { transform: translateY(2px); box-shadow: 0 1px 0
          light-dark(hsl(var(--hue) 55% 78%), hsl(var(--hue) 35% 12%)); }
  /* 명예의 전당: 한 행을 전부 채우는 가로형 금색 배너 (게임 카드와 차별화) */
  .card--hof { grid-column: 1 / -1; aspect-ratio: auto; flex-direction: row;
          justify-content: flex-start; gap: 1rem; padding: 1.05rem 1.4rem; text-align: left;
          color: light-dark(#6a4e14, #ffe4a0);
          background: light-dark(#fff4d6, #38301a);
          border-color: light-dark(#ecca6e, #715d24);
          box-shadow: 0 4px 0 light-dark(#eaca70, #221b0b); }
  .card--hof:hover { box-shadow: 0 7px 0 light-dark(#eaca70, #221b0b); }
  .card--hof:active { box-shadow: 0 1px 0 light-dark(#eaca70, #221b0b); }
  .card--hof .hof-emoji { font-size: 2.3rem; line-height: 1; }
  .card--hof .hof-text { display: flex; flex-direction: column; gap: .18rem; min-width: 0; }
  .card--hof .hof-name { font-weight: bold; font-size: 1.1rem; }
  .card--hof .hof-desc { font-size: .8rem; opacity: .72;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card--hof .hof-arrow { margin-left: auto; font-size: 1.3rem; opacity: .5; }
  /* 올타임 1위를 가장 많이 가진 3명 — 3·1·2 시상대 (명예의 전당 카드 위) */
  #hof-podium { margin: 0 0 1.4rem; }
  #hof-podium[hidden] { display: none; }
  .podium-title { text-align: center; font-weight: bold; font-size: .95rem;
          margin: 0 0 .7rem; letter-spacing: .02em;
          color: light-dark(#8a6d12, #ffd873); }
  .podium-row { display: flex; justify-content: center; align-items: flex-end; gap: .55rem;
          max-width: 30rem; margin: 0 auto; }
  .podium-item { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
          align-items: center; text-align: center;
          animation: pop .5s cubic-bezier(.2,1.5,.4,1) both; }
  .podium-item.rank-3 { animation-delay: .04s; }
  .podium-item.rank-2 { animation-delay: .09s; }
  .podium-item.rank-1 { animation-delay: .15s; }
  .podium-figure { font-size: 2rem; line-height: 1; filter: drop-shadow(0 2px 2px #0003); }
  .rank-1 .podium-figure { font-size: 2.7rem; }
  .podium-nick { font-weight: bold; font-size: .88rem; margin-top: .25rem;
          max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .podium-count { font-size: .7rem; opacity: .72; margin-bottom: .4rem; }
  .podium-base { width: 100%; display: grid; place-items: center;
          font-weight: 900; font-size: 1.15rem; color: #fff;
          border-radius: .55rem .55rem 0 0; text-shadow: 0 1px 2px #0006; }
  .rank-1 .podium-base { height: 4.6rem; background: linear-gradient(#f6d979, #dcae32); }
  .rank-2 .podium-base { height: 3.4rem; background: linear-gradient(#dfe6ec, #a8b4c1); }
  .rank-3 .podium-base { height: 2.6rem; background: linear-gradient(#e6b083, #bf7a45); }
  @keyframes pop { from { transform: scale(.6); opacity: 0; } }
  .emoji { font-size: 2.6rem; line-height: 1; position: relative; display: inline-block; }
  .emoji[data-badge]::after { content: attr(data-badge); position: absolute;
          top: -.1em; right: -.28em; display: grid; place-items: center;
          width: 1.15em; height: 1.15em; font-size: .95rem; font-weight: 900;
          line-height: 1; border-radius: 50%; color: #fff; background: #7c5fd6;
          box-shadow: 0 1px 2px rgba(0,0,0,.25); }
  .name { font-weight: bold; font-size: 1.02rem; word-break: break-all;
          text-align: center; }
  .champ { opacity: .55; font-size: .72rem; min-height: 1em; max-width: 100%;
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mine { opacity: .48; font-size: .7rem; min-height: 1em; max-width: 100%;
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { text-align: center; opacity: .6; margin-top: 4rem; }
  footer { margin-top: 3.5rem; opacity: .4; font-size: .8em; text-align: center; }
  footer a { color: inherit; }
</style>
</head>
<body>
  <div class="site-switcher">
    <h1><button class="site-trigger" id="siteTrigger" type="button" aria-expanded="false" aria-controls="siteMenu">
      <strong>${escapeHtml(site)}</strong><span class="chevron">⌄</span><span class="domain">.bubblelab.dev</span>
    </button></h1>
    <nav class="site-menu" id="siteMenu" aria-label="Bubblelab sites" hidden>
      <a class="menu-home" href="https://bubblelab.dev"><span>🫧</span>bubblelab</a>
${categoryLinks}
    </nav>
  </div>
  <div id="crown" title="이번 주 1위를 가장 많이 가진 사람 — 월요일 09시 초기화"></div>
${site === "slop" ? '  <div id="streak">🔥 연속 방문 계산 중…</div>' : ""}
${site === "slop" ? '  <div id="hof-podium" hidden><p class="podium-title">👑 슬롭 3대장</p><div class="podium-row"></div></div>' : ""}
${cards ? `  <div class="grid">\n${cards}\n  </div>` : `  <p class="empty">아직 아무것도 없어요 🫧</p>`}
  <footer><a href="https://bubblelab.dev">bubblelab.dev</a></footer>
<script>
const SITE = ${JSON.stringify(site)};
const siteTrigger = document.getElementById("siteTrigger");
const siteMenu = document.getElementById("siteMenu");
const closeSiteMenu = () => {
  siteMenu.hidden = true;
  siteTrigger.setAttribute("aria-expanded", "false");
};
siteTrigger.addEventListener("click", () => {
  const opening = siteMenu.hidden;
  siteMenu.hidden = !opening;
  siteTrigger.setAttribute("aria-expanded", String(opening));
  if (opening) {
    siteMenu.querySelector("a[aria-current=page]")?.focus();
    // 사용자가 메뉴를 고르는 동안 다른 서브도메인 문서를 미리 받아 둔다.
    for (const anchor of siteMenu.querySelectorAll("a:not([aria-current=page])")) {
      if (document.head.querySelector(\`link[rel=prefetch][href="\${anchor.href}"]\`)) continue;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = anchor.href;
      document.head.append(link);
    }
  }
});
siteMenu.addEventListener("click", (event) => {
  const anchor = event.target.closest("a");
  if (!anchor || anchor.hasAttribute("aria-current")) return;
  anchor.classList.add("loading");
  anchor.setAttribute("aria-busy", "true");
});
addEventListener("click", (event) => {
  if (!event.target.closest(".site-switcher")) closeSiteMenu();
});
addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !siteMenu.hidden) {
    closeSiteMenu();
    siteTrigger.focus();
  }
});

// 주간 신기록 보드(/_records)에서 카드별 챔피언을 채운다. 실패해도 조용히 넘어간다.
(async () => {
  const els = [...document.querySelectorAll(".champ[data-game]")];
  if (!els.length) return;
  try {
    const games = els.map((el) => el.dataset.game).join(",");
    const res = await fetch("/_records?games=" + encodeURIComponent(games), { cache: "no-store" });
    if (!res.ok) return;
    const { week, records, personal = {}, supported = [], notice } = await res.json();
    const supportedGames = new Set(supported);
    const wins = {}; // 닉네임 → 이번 주 1위 개수
    for (const el of els) {
      const r = records[el.dataset.game];
      if (!r) continue;
      // text 없는 옛 기록은 생 float가 못생기지 않게 반올림해서 보여준다
      el.textContent = \`👑 \${r.nick} · \${r.text ?? Math.round(r.score * 100) / 100}\`;
      el.title = "이번 주 1위 — 월요일 09시 초기화";
      wins[r.nick] = (wins[r.nick] ?? 0) + 1;
    }
    for (const el of els) {
      const game = el.dataset.game;
      if (!supportedGames.has(game)) continue;
      const mine = personal[game];
      el.closest(".card").querySelector(".mine").textContent = mine
        ? \`나의 최고 · \${mine.text ?? Math.round(mine.score * 100) / 100}\`
        : "나의 기록 · 아직 없음";
    }
    const top = Math.max(0, ...Object.values(wins));
    if (top > 0) {
      const leaders = Object.keys(wins).filter((n) => wins[n] === top);
      document.getElementById("crown").textContent =
        \`🏆 이번 주 종합 1위: \${leaders.join(" · ")} (1위 \${top}개)\`;
    }
    // 주간 리셋·공지 팝업 (records.js가 정의 — defer 스크립트 실행을 기다린다)
    if (document.readyState === "loading") {
      await new Promise((r) => addEventListener("DOMContentLoaded", r, { once: true }));
    }
    if (SITE === "slop") window.blWeeklyResetNotice?.(week, notice);
  } catch {}
})();

// Slop에서만 현재 브라우저의 KST 기준 연속 방문일을 보여준다.
(async () => {
  const streak = document.getElementById("streak");
  if (!streak) return;
  try {
    const res = await fetch("/_streak", { cache: "no-store" });
    if (!res.ok) throw new Error();
    const data = await res.json();
    streak.textContent = \`🔥 나의 Slop 연속 방문 · \${data.streak ?? 1}일\`;
  } catch {
    streak.textContent = "";
  }
})();

// 올타임 1위(명예의 전당)를 가장 많이 보유한 3명을 3·1·2 시상대로 보여준다.
(async () => {
  const podium = document.getElementById("hof-podium");
  if (!podium) return;
  try {
    const res = await fetch("/_records?alltime=1", { cache: "no-store" });
    if (!res.ok) throw new Error();
    const { records } = await res.json();
    const counts = new Map();               // 닉네임 → { count, at(최근 달성일) }
    for (const r of Object.values(records ?? {})) {
      if (!r || !r.nick) continue;
      const cur = counts.get(r.nick) ?? { count: 0, at: 0 };
      cur.count += 1;
      cur.at = Math.max(cur.at, r.at ?? 0);
      counts.set(r.nick, cur);
    }
    const ranked = [...counts.entries()]
      .map(([nick, v]) => ({ nick, count: v.count, at: v.at }))
      .sort((a, b) => b.count - a.count || b.at - a.at || a.nick.localeCompare(b.nick))
      .slice(0, 3);
    if (!ranked.length) return;             // 기록이 하나도 없으면 표시하지 않음
    const MEDAL = ["🥇", "🥈", "🥉"];
    const row = podium.querySelector(".podium-row");
    row.textContent = "";
    for (const pos of [2, 0, 1]) {          // 화면 배치: 3등 · 1등 · 2등
      const p = ranked[pos];
      if (!p) continue;                     // 3명 미만이면 있는 만큼만
      const item = document.createElement("div");
      item.className = "podium-item rank-" + (pos + 1);
      const fig = document.createElement("div");
      fig.className = "podium-figure"; fig.textContent = MEDAL[pos];
      const nick = document.createElement("div");
      nick.className = "podium-nick"; nick.textContent = p.nick;
      const cnt = document.createElement("div");
      cnt.className = "podium-count"; cnt.textContent = "👑 " + p.count + "관왕";
      const base = document.createElement("div");
      base.className = "podium-base"; base.textContent = String(pos + 1);
      item.append(fig, nick, cnt, base);
      row.appendChild(item);
    }
    podium.hidden = false;
  } catch {}
})();

// 카드는 즉시 보여주고, 최근에 저장한 인기순을 먼저 적용한다. 최신 통계는
// 백그라운드에서 받아 다음 방문에 사용하므로 화면이 통계를 기다리거나 점프하지 않는다.
(async () => {
  const grid = document.querySelector(".grid");
  if (!grid) return;
  const cacheKey = \`bl-card-order:\${SITE}\`;
  // 고정 카드(명예의 전당 배너)는 재정렬에서 빼서 항상 맨 위 한 행에 둔다.
  const cards = [...grid.children].filter((card) => !card.classList.contains("card--pinned"));
  const gameOf = (card) => card.querySelector(".champ")?.dataset.game;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (cached && Date.now() - cached.at < 5 * 60 * 1000 && Array.isArray(cached.order)) {
      const rank = new Map(cached.order.map((name, index) => [name, index]));
      cards
        .map((card, index) => ({ card, index, rank: rank.get(gameOf(card)) ?? 1e9 }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .forEach(({ card }, index) => {
          card.style.setProperty("--i", index);
          grid.append(card);
        });
    }
  } catch {}
  try {
    const res = await fetch("/_stats");
    if (!res.ok) throw new Error();
    const { pages } = await res.json();
    const count = (card) => pages[\`\${SITE}/\${gameOf(card)}\`] ?? 0;
    const order = cards
      .map((card, i) => ({ card, n: count(card), i })) // i = 가나다순 (안정 정렬용)
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .map(({ card }) => gameOf(card));
    localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), order }));
  } catch {}
})();
</script>
<script defer src="/_shared/records.js"></script>
<script defer src="/_shared/suggest.js"></script>
</body>
</html>
`;
}

for (const site of sites) {
  if (existsSync(join(DIST, site.name, "index.html"))) continue;

  // 기본 순서는 가나다순. 접속량 데이터가 있으면 클라이언트에서 재정렬한다.
  const entries = readdirSync(join(DIST, site.name), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !UNLISTED_ENTRIES.get(site.name)?.has(d.name))
    .map((d) => ({
      name: d.name,
      emoji: toyEmoji(site.name, d.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  writeFileSync(
    join(DIST, site.name, "index.html"),
    listingPage(site.name, entries),
  );
  console.log(`generated index for ${site.name} (${entries.length} entries)`);
}

// 모든 공개 카드 페이지에 체류 측정기를 한 번만 삽입한다. 개별 토이가 공용
// 스크립트를 직접 챙길 필요가 없고, admin과 카테고리 홈은 클라이언트에서 제외된다.
function injectEngagement(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      injectEngagement(path);
    } else if (entry.name.endsWith(".html")) {
      const html = readFileSync(path, "utf8");
      if (html.includes('/_shared/engagement.js') || !/<\/body>/i.test(html)) continue;
      writeFileSync(path, html.replace(
        /<\/body>/i,
        '<script defer src="/_shared/engagement.js"></script>\n</body>',
      ));
    }
  }
}
for (const site of sites) {
  if (site.name !== "admin") injectEngagement(join(DIST, site.name));
}

writeFileSync(
  join(DIST, "404.html"),
  `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>404</title>
<style>:root{color-scheme:light dark} body{font-family:ui-monospace,monospace;
display:grid;place-items:center;min-height:100vh;margin:0}</style></head>
<body><p>404 — 여기엔 아직 아무것도 없어요. <a href="https://bubblelab.dev">bubblelab.dev</a></p></body>
</html>
`,
);

console.log(`build done → dist/ (${sites.map((s) => s.name).join(", ")})`);
