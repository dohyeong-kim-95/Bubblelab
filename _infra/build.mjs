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
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAssetCatalog } from "./assets.js";
import { emitEmoticonHistory } from "./emoticon-history.mjs";
import { CONFIDENTIAL_SUBDOMAINS, isSiteDirectoryName } from "./sites.js";
import { escapeHtml } from "./html.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
// 서브도메인이 아닌 루트 폴더(NON_SITE_DIRS)와 공개 구분(CONFIDENTIAL_SUBDOMAINS)은
// sites.js 한 곳에 있다. 퍼블릭은 www 랜딩 카드와 카테고리 홈 풀다운 메뉴에
// 노출되고, confidential은 주소를 직접 쳐야만 들어갈 수 있다(어디에도 링크 없음).
// 카테고리 홈 카드 목록에서 감춘다. 소스와 직접 URL은 그대로 살아 있고,
// 공개할 준비가 되면 이 목록에서 빼면 된다. (서브도메인 단위 비공개는
// CONFIDENTIAL_SUBDOMAINS 쪽이다 — 여기는 카테고리 안의 개별 카드용.)
const UNLISTED_ENTRIES = new Map([
  // 백엔드가 보안상 닫혀 있는 동안 발견되지 않게 한다(인증/ACL 검토 후 해제).
  ["games", new Set(["avalon", "liargame", "yacht"])],
  // 여권사진은 비공개 요청으로 목록에서 내렸다.
  ["util", new Set(["passport-pic"])],
]);

const isSite = (d) => d.isDirectory() && isSiteDirectoryName(d.name);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);

// README·CLAUDE·AGENTS 는 온보딩 문서일 뿐이므로 배포에서 제외.
// 특히 서브도메인마다 두는 에이전트 메모(CLAUDE.md)에는 게이트·DO 바인딩·env
// 이름이 적혀 있는데, 걸러 내지 않으면 `<서브도메인>.bubblelab.dev/CLAUDE.md`
// 로 그대로 서빙된다.
const AGENT_DOCS = /\/(README|CLAUDE|AGENTS)\.md$/;
const notReadme = (src) => !AGENT_DOCS.test(src);

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
        `랜딩에 카드를 추가하거나 _infra/sites.js의 CONFIDENTIAL_SUBDOMAINS에 등록하세요`,
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
  const hidden = catalog.filter((item) => item.active === false).length;
  console.log(`generated asset catalog (${catalog.length} items${hidden ? `, ${hidden} hidden` : ""})`);

  // 배경화면은 항목마다 상세페이지를 만든다 (/assets/wallpaper/<id>/).
  // 목록 카드로는 못 하는 것 — 원본 크기로 보기, 내 화면 해상도에 맞춰
  // 잘라 저장하기, 폰 케이스 목업 — 이 여기에 있다.
  // 숨긴 항목은 페이지도 굽지 않는다 (배경화면은 admin 토글 대상이 아니다).
  const wallpapers = catalog.filter((item) => item.category === "wallpaper" && item.active !== false);
  for (const item of wallpapers) {
    const dir = join(DIST, "assets", "wallpaper", item.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), wallpaperPage(item));
  }
  if (wallpapers.length) console.log(`generated ${wallpapers.length} wallpaper detail pages`);
}

// work/emoticon 생성 산출물(_src/emoticon)을 history 페이지가 읽을 수 있게 내보낸다
{
  const history = emitEmoticonHistory(ROOT, DIST);
  if (history) {
    console.log(`generated emoticon history (${history.characters} characters, ${history.cuts} cuts)`);
  }
}

// 배경화면 상세페이지. 항목 데이터를 통째로 심어 두고(추가 요청 없이 바로
// 그린다) 나머지 동작은 assets/item.js 가 맡는다.
// **링크는 상대경로.** 서브도메인 접속(assets.bubblelab.dev/wallpaper/<id>/)에는
// URL에 /assets 세그먼트가 없다 — worker가 내부에서 붙인다. 절대경로 /assets/…
// 로 적으면 로컬(첫 세그먼트=서브도메인)에서만 되고 실서비스에서 404가 난다.
// /_shared/*, /_assets/*, /_download/* 는 worker가 프리픽스 없이 서빙하므로 예외.
function wallpaperPage(item) {
  const title = escapeHtml(item.title);
  const description = escapeHtml(item.description || `Bubblelab에서 만든 배경화면 ${item.title}`);
  const tags = (item.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("");
  const downloads = item.downloads
    .map((download) => `<div class="download-item">
          <a class="download" href="/_download/wallpaper/${encodeURIComponent(item.id)}/${encodeURIComponent(download.file)}" download="${escapeHtml(download.file)}">↓ ${escapeHtml(download.label)}</a>
        </div>`)
    .join("\n        ");
  // </script> 가 데이터 안에 있으면 스크립트 블록이 끊긴다
  const data = JSON.stringify(item).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${description}">
<title>${title} · Bubblelab 배경화면</title>
<link rel="stylesheet" href="/_shared/bubble.css">
<link rel="stylesheet" href="../../catalog.css">
<link rel="stylesheet" href="../../item.css">
</head>
<body data-category="wallpaper">
<main class="wrap item-wrap">
  <header>
    <a class="back" href="../">← 배경화면 목록</a>
    <h1 class="item-title">${title}</h1>
    <p class="intro">${description}</p>
    <div class="tags">${tags}</div>
  </header>

  <section class="gallery">
    <div class="stage" id="stage">
      <img id="view-image" src="${escapeHtml(item.preview)}" alt="${title}">
      <canvas id="case-canvas" width="600" height="1200" hidden aria-label="${title} 폰 케이스 목업"></canvas>
    </div>
    <div class="thumbs" id="thumbs" role="tablist" aria-label="미리보기 선택">
      <button class="thumb" type="button" role="tab" data-view="image" aria-selected="true">
        <img src="${escapeHtml(item.preview)}" alt=""><span>원본</span>
      </button>
      <button class="thumb" type="button" role="tab" data-view="case" aria-selected="false">
        <img id="case-thumb" alt=""><span>케이스 목업</span>
      </button>
    </div>
    <p class="panel-note" id="view-note"></p>
    <div class="case-actions" id="case-actions" hidden>
      <button class="flip" id="case-flip" type="button" aria-pressed="false">⇄ 좌우 반전</button>
      <button class="download" id="case-save" type="button">↓ 목업 이미지 저장</button>
    </div>
  </section>

  <section class="panel">
    <h2>내 기기에 맞게 잘라서 저장</h2>
    <p class="panel-note" id="fit-note">화면 크기를 확인하는 중…</p>
    <label class="field">기종
      <select id="device-select"></select>
    </label>
    <div class="fit-inputs">
      <label>가로 <input id="fit-width" type="number" min="120" max="8000" step="1" inputmode="numeric"></label>
      <span class="times">×</span>
      <label>세로 <input id="fit-height" type="number" min="120" max="8000" step="1" inputmode="numeric"></label>
    </div>
    <div class="crop" id="crop">
      <img id="crop-image" alt="잘라낼 영역 고르기">
      <div class="crop-box" id="crop-box" tabindex="0" role="application"
           aria-label="잘라낼 영역 — 끌어서 옮기거나 방향키로 조절">
        <span class="crop-grip" aria-hidden="true"></span>
        <span class="crop-resize" id="crop-resize" role="button" tabindex="0"
              aria-label="잘라낼 영역 크기 — 끌어서 늘리거나 줄이기"></span>
      </div>
    </div>
    <p class="panel-note" id="crop-note"></p>
    <button class="download fit-go" id="fit-save" type="button">↓ 잘라서 저장</button>
    <p class="panel-note" id="fit-result"></p>
  </section>

  <section class="panel">
    <h2>규격별 원본 받기</h2>
    <div class="downloads">
        ${downloads}
    </div>
  </section>

  <footer>© Bubblelab Assets</footer>
</main>
<script type="application/json" id="item-data">${data}</script>
<script type="module" src="../../item.js"></script>
</body>
</html>
`;
}

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

// 도구형 카테고리(util)는 카드 대신 묶음별 목록으로 보인다 — 한 줄 설명과 묶음은
// 각 페이지의 <meta name="description">·<meta name="bl-group"> 에서 읽는다.
// 묶음 순서는 아래 표, 표에 없는 묶음은 뒤에 붙는다.
const GROUP_ORDER = ["매일", "사진·이미지", "글·문서", "함께"];
function toyMeta(site, name) {
  try {
    const html = readFileSync(join(ROOT, site, name, "index.html"), "utf8");
    const pick = (key) => html.match(new RegExp(`<meta name="${key}" content="([^"]*)"`))?.[1] ?? "";
    return { desc: pick("description"), group: pick("bl-group") };
  } catch {
    return { desc: "", group: "" };
  }
}

// 카드 페이지의 <title>을 랜딩 검색용으로 뽑아온다. 제목은 대개 한국어라
// 폴더 이름(영문)만으로는 안 되는 검색을 이 한 줄이 거의 다 해결한다.
//   title = 검색에 쓰는 제목 전체, label = 카드에 보여줄 앞부분
// 생성된 페이지도 있어 dist를 읽는다.
function toyTitle(site, name) {
  try {
    const html = readFileSync(join(DIST, site, name, "index.html"), "utf8");
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) return { title: "", label: "" };
    const title = m[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'")
      .replace(/\s+/g, " ").trim();
    // 이모지는 카드 아이콘으로 따로 붙고, " — 부제 · 사이트명" 꼬리는 이름이 아니다.
    const label = title
      .replace(/^\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*\s*/u, "")
      .split(/\s+[—–·|]\s+/)[0].trim();
    return { title, label };
  } catch {
    return { title: "", label: "" };
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
      // 이름을 감추는 홈(slop)에서도 스크린리더·툴팁에는 한국어 제목이 남는다
      const label = toyTitle(site, name).label || name;
      return `    <a class="card" href="/${escapeHtml(name)}/" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"
       style="--hue:${hueOf(name)};--i:${i + (hofEntry ? 1 : 0)}">
      <span class="emoji"${emoji.badge ? ' data-badge="+"' : ""}>${emoji.char}</span>
      <span class="name">${escapeHtml(name)}</span>
      <span class="champ" data-game="${escapeHtml(name)}"></span>
      <span class="mine"></span>
    </a>`;
    })
    .join("\n");
  const cards = hofCard + gameCards;
  // 묶음이 적힌 카테고리(util)는 묶음별 목록 — 이름이 영문 폴더라 카드만으론 뭔지 모른다
  const grouped = entries.some((e) => e.group);
  const groupNames = [...new Set([...GROUP_ORDER, ...entries.map((e) => e.group || "기타")])]
    .filter((g) => entries.some((e) => (e.group || "기타") === g));
  const groupedList = groupNames.map((g) => {
    const rows = entries
      .filter((e) => (e.group || "기타") === g)
      .map((e) => ({ ...e, label: toyTitle(site, e.name).label || e.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko"))
      .map((e) => `      <li><a class="row" href="/${escapeHtml(e.name)}/" style="--hue:${hueOf(e.name)}">
        <span class="emoji">${e.emoji.char}</span><b>${escapeHtml(e.label)}</b><small>${escapeHtml(e.desc)}</small>
      </a></li>`)
      .join("\n");
    return `  <section class="group"><h2>${escapeHtml(g)}</h2>\n    <ul class="rows">\n${rows}\n    </ul></section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(site)}.bubblelab.dev</title>
${preconnectLinks}
<link rel="stylesheet" href="/_shared/bubble.css">
<style>
  /* 랜딩과 같은 "비눗방울 실험실" — 색·글꼴·크기 토큰은 /_shared/bubble.css (원본 한 곳) */
  body { max-width: 56rem; margin: 0 auto; padding: 2.6rem 1.25rem 4rem; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  h1 { margin: 0 0 1.4rem; font-weight: normal; }
  .site-switcher { position: relative; width: max-content; max-width: 100%; margin: 0 auto; text-align: center; }
  .site-trigger { border: 0; padding: .3rem .7rem; border-radius: 999px; background: transparent;
          color: inherit; font: inherit; cursor: pointer; display: inline-flex; align-items: baseline; gap: .1rem; }
  .site-trigger:hover, .site-trigger:focus-visible { background: light-dark(#e9e4d8, #161d2a); outline: none; }
  .site-trigger strong { font-family: var(--serif); font-weight: 700; font-size: var(--t-title);
          letter-spacing: -.02em; line-height: 1.1; }
  .site-trigger .domain { font-family: var(--mono); font-size: .85rem; color: var(--muted); }
  .site-trigger .chevron { display: inline-block; margin: 0 .25rem; color: var(--muted); font-size: 1rem;
          transition: transform .15s; }
  .site-trigger[aria-expanded="true"] .chevron { transform: rotate(180deg); }
  .site-menu { position: absolute; z-index: 30; top: calc(100% + .3rem); left: 50%; transform: translateX(-50%);
          width: 14rem; padding: .4rem; border-radius: 1rem;
          background: var(--field); border: 1px solid var(--line);
          box-shadow: 0 18px 40px -12px light-dark(#1b273333, #000a); text-align: left; }
  .site-menu[hidden] { display: none; }
  .site-menu a { display: grid; grid-template-columns: 1.3rem 1fr; align-items: center;
          padding: .65rem .7rem; border-radius: .7rem; color: inherit; text-decoration: none; font-size: .95rem; }
  .site-menu a:hover, .site-menu a:focus-visible { background: light-dark(#f1ece1, #1b2331); outline: none; }
  .site-menu a[aria-current="page"] { font-weight: bold; }
  .site-menu a.loading { opacity: .65; pointer-events: none; }
  .site-menu a.loading::after { content: "…"; margin-left: auto; }
  .site-menu .menu-home { border-bottom: 1px solid var(--line); margin-bottom: .25rem; }
  #crown { text-align: center; color: var(--muted); font-size: .85rem; margin: -.6rem 0 1.4rem; min-height: 1.2em; }
  /* 연속 방문일: 우상단 구석의 조용한 배지 (🔥 N) */
  #streak { position: fixed; top: .8rem; right: .9rem; z-index: 4; font-family: var(--mono);
           color: var(--muted); font-size: .8rem; }
  /* 올타임 1위 — 존중의 자리. 시상대는 명예의 전당에, 여기엔 이름만 크게 */
  #alltime-top { display: block; text-align: center; margin: 0 0 1.8rem; text-decoration: none; color: inherit; }
  #alltime-top[hidden] { display: none; }
  #alltime-top .at-sub { display: block; font-family: var(--mono); font-size: .78rem;
           color: light-dark(#7a5c0e, #ffd873); }
  #alltime-top .at-nick { display: block; font-size: 2.15rem; font-weight: 800; letter-spacing: -.02em;
           line-height: 1.25; overflow-wrap: anywhere; }
  #alltime-top:hover .at-nick { text-decoration: underline; text-underline-offset: .2em; }
  /* 이번 주 시상대는 올타임 1위보다 한 급 아래로 (공용 css보다 작게) */
  #week-podium .podium-title { font-size: .8rem; }
  .grid { display: grid; gap: .9rem; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); }
  /* 카드: 종이 위의 방울 하나 — 색은 이름 해시(--hue)가 방울에만 묻는다 */
  .card { position: relative; aspect-ratio: 1; border-radius: 1.4rem; text-decoration: none; color: inherit;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .45rem;
          padding: .8rem; background: var(--field); border: 1px solid var(--line);
          transition: transform .25s cubic-bezier(.2, .9, .3, 1.2), border-color .2s, box-shadow .25s;
          animation: pop .45s cubic-bezier(.2, 1.4, .4, 1) both; animation-delay: calc(var(--i) * 35ms); }
  .card:hover, .card:focus-visible { transform: translateY(-3px);
          border-color: light-dark(hsl(var(--hue) 50% 75%), hsl(var(--hue) 35% 38%));
          box-shadow: 0 14px 28px -16px light-dark(hsl(var(--hue) 60% 45% / .45), #000c); }
  .card:active { transform: translateY(1px); }
  @keyframes pop { from { opacity: 0; transform: scale(.9); } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; transition: none; } }
  .emoji { position: relative; display: grid; place-items: center; width: 4.4rem; aspect-ratio: 1;
          border-radius: 50%; font-size: 2.1rem; line-height: 1;
          background: var(--gloss),
                      light-dark(hsl(var(--hue) 85% 88%), hsl(var(--hue) 45% 24%));
          box-shadow: inset 0 0 0 1px light-dark(hsl(var(--hue) 60% 76%), hsl(var(--hue) 40% 36%));
          transition: transform .35s cubic-bezier(.2, .9, .3, 1.3); }
  .card:hover .emoji, .card:focus-visible .emoji { transform: scale(1.08) rotate(-6deg); }
  .emoji[data-badge]::after { content: attr(data-badge); position: absolute;
          top: -.1rem; right: -.1rem; display: grid; place-items: center;
          width: 1.3rem; height: 1.3rem; font-size: .9rem; font-weight: 900;
          line-height: 1; border-radius: 50%; color: #fff; background: #5b47c4;
          box-shadow: 0 1px 3px rgb(0 0 0 / .25); }
  .name { font-family: var(--serif); font-weight: 700; font-size: 1.12rem; letter-spacing: -.01em;
          word-break: break-all; text-align: center; line-height: 1.2; }
  .champ, .mine { font-family: var(--mono); color: var(--muted); font-size: .7rem; min-height: 1em; max-width: 100%;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mine { opacity: .85; }
  /* 기록이 없는 사이트(util 등)에선 두 줄이 늘 비어 방울이 위로 쏠려 보인다 — 빈 줄은 자리를 안 차지하게 */
  .champ:empty, .mine:empty { display: none; }
  /* 명예의 전당: 한 행을 전부 채우는 가로형 금빛 배너 (게임 카드와 차별화) */
  .card--hof { grid-column: 1 / -1; aspect-ratio: auto; flex-direction: row;
          justify-content: flex-start; gap: 1rem; padding: 1rem 1.3rem; text-align: left;
          background: light-dark(#fbf1d6, #2a2414); border-color: light-dark(#e6cf8f, #5c4c22); }
  .card--hof:hover, .card--hof:focus-visible { border-color: light-dark(#d9b45a, #8a7232); }
  .card--hof .hof-emoji { display: grid; place-items: center; width: 3.2rem; aspect-ratio: 1; border-radius: 50%;
          font-size: 1.7rem; line-height: 1;
          background: var(--gloss),
                      light-dark(#f6dc8f, #6b5620); }
  .card--hof .hof-text { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
  .card--hof .hof-name { font-weight: 800; font-size: 1.1rem; letter-spacing: -.01em; }
  .card--hof .hof-desc { font-size: .82rem; color: var(--muted);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card--hof .hof-arrow { margin-left: auto; font-size: 1.3rem; color: var(--muted); }
  .empty { text-align: center; color: var(--muted); margin-top: 4rem; }
  footer { margin-top: 3.5rem; padding-top: 1.2rem; border-top: 1px solid var(--line);
           font-family: var(--mono); color: var(--muted); font-size: .78rem; text-align: center; }
  footer a { color: inherit; text-underline-offset: .2em; }
  /* slop: 이름 없이 방울만, 항상 3열 — 이름은 aria-label·title 로 남긴다 */
  body[data-site="slop"] .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 34rem; margin: 0 auto; }
  body[data-site="slop"] .card:not(.card--hof) .name,
  body[data-site="slop"] .card:not(.card--hof) .mine { position: absolute; width: 1px; height: 1px;
          overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  body[data-site="slop"] .card:not(.card--hof) .emoji { width: 62%; font-size: clamp(2rem, 9vw, 3.6rem); }
  /* 이번 주 1위 기록 값 — 기록이 있으면 방울 아래 한 줄, 없으면(:empty) 방울만 가운데 */
  body[data-site="slop"] .card:not(.card--hof) { gap: .4rem; }
  body[data-site="slop"] .card:not(.card--hof) .champ:not(:empty) ~ .mine { display: none; }
  body[data-site="slop"] .card:not(.card--hof):has(.champ:not(:empty)) .emoji { width: 54%; }
  body[data-site="slop"] .card:not(.card--hof) .champ { font-size: clamp(.62rem, 2.6vw, .78rem); color: var(--ink); opacity: .75; }
  /* 묶음별 목록(util): 랜딩의 카테고리 줄과 같은 모양 — 방울 + 이름 + 한 줄 설명 */
  .group { max-width: 40rem; margin: 0 auto 2.2rem; }
  .group h2 { margin: 0 0 .5rem; font-family: var(--mono); font-size: .78rem; font-weight: normal; color: var(--muted); }
  .rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .rows li { border-bottom: 1px solid var(--line); }
  .row { display: grid; grid-template-columns: 3rem 1fr auto; grid-template-areas: "e b go" "e s go";
         column-gap: 1rem; align-items: center; padding: .9rem .25rem; text-decoration: none; color: inherit; }
  .row .emoji { grid-area: e; width: 3rem; font-size: 1.4rem; }
  .row b { grid-area: b; align-self: end; font-size: 1.08rem; font-weight: 700; letter-spacing: -.015em; line-height: 1.3; }
  .row small { grid-area: s; align-self: start; color: var(--muted); font-size: .86rem; line-height: 1.45;
         display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .row::after { content: "→"; grid-area: go; font-size: 1.2rem; color: var(--muted); transition: transform .25s ease, color .25s ease; }
  .row:hover .emoji, .row:focus-visible .emoji { transform: scale(1.1) rotate(-6deg); }
  .row:hover::after, .row:focus-visible::after { transform: translateX(.3rem); color: light-dark(hsl(var(--hue) 70% 40%), hsl(var(--hue) 70% 70%)); }
  @media (max-width: 600px) {
    body { padding-top: 2rem; }
    .grid { gap: .65rem; grid-template-columns: repeat(auto-fill, minmax(8.2rem, 1fr)); }
    body:not([data-site="slop"]) .grid .emoji { width: 3.7rem; font-size: 1.8rem; }
    .name { font-size: 1rem; }
  }
</style>
</head>
<body data-site="${escapeHtml(site)}">
  <div class="site-switcher">
    <h1><button class="site-trigger" id="siteTrigger" type="button" aria-expanded="false" aria-controls="siteMenu">
      <strong>${escapeHtml(site)}</strong><span class="chevron">⌄</span><span class="domain">.bubblelab.dev</span>
    </button></h1>
    <nav class="site-menu" id="siteMenu" aria-label="Bubblelab sites" hidden>
      <a class="menu-home" href="https://bubblelab.dev"><span>🫧</span>bubblelab</a>
${categoryLinks}
    </nav>
  </div>
${site === "slop" ? "" : '  <div id="crown" title="이번 주 1위를 가장 많이 가진 사람 — 월요일 09시 초기화"></div>'}
${site === "slop" ? '  <div id="streak" title="나의 Slop 연속 방문일"></div>' : ""}
${site === "slop" ? '  <a id="alltime-top" href="/hall-of-fame/" hidden><span class="at-sub"></span><strong class="at-nick"></strong></a>' : ""}
${site === "slop" ? '  <div id="week-podium" class="bl-podium" hidden><p class="podium-title">🔥 이번 주 slop 삼대장</p><div class="podium-row"></div></div>' : ""}
${grouped ? groupedList : cards ? `  <div class="grid">\n${cards}\n  </div>` : `  <p class="empty">아직 아무것도 없어요 🫧</p>`}
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

// 이번 주 삼대장 시상대. 순위 계산·렌더는 /_shared/podium.js가 맡는다
// (명예의 전당의 올타임 시상대와 같은 동점 규칙을 쓰기 위해 한 곳에 뒀다).
async function renderWeekPodium(records) {
  // podium.js는 defer라 파싱 뒤에야 실행된다. fetch가 그 사이(interactive)에
  // 끝나면 blPodium이 아직 없다 — "loading"만 기다려서는 간헐적으로 빈
  // 시상대가 됐다. 문서 load까지 기다리면 확실하다.
  if (document.readyState !== "complete") {
    await new Promise((r) => addEventListener("load", r, { once: true }));
  }
  const mount = document.getElementById("week-podium");
  if (!mount || !window.blPodium) return;
  const gameEmoji = {};
  for (const card of document.querySelectorAll(".card")) {
    const g = card.querySelector(".champ")?.dataset.game;
    const e = card.querySelector(".emoji")?.textContent?.trim();
    if (g && e) gameEmoji[g] = e;
  }
  window.blPodium.render(mount, window.blPodium.rank(records), gameEmoji);
}

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
      const text = r.text ?? Math.round(r.score * 100) / 100;
      // slop 은 이모지만 있는 좁은 3열이라 기록 값만 — 닉네임은 툴팁으로
      el.textContent = SITE === "slop" ? \`👑 \${text}\` : \`👑 \${r.nick} · \${text}\`;
      el.title = \`이번 주 1위 \${r.nick} · \${text} — 월요일 09시 초기화\`;
      wins[r.nick] = (wins[r.nick] ?? 0) + 1;
    }
    // 이번 주 삼대장 시상대 — 카드 챔피언과 같은 응답을 재활용해 따로 안 부른다.
    // 게임 → 이모지는 카드에서 그대로 뽑는다(명예의 전당 배너 카드는 champ가 없다).
    renderWeekPodium(records);
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
      const crown = document.getElementById("crown");   // slop은 시상대가 대신한다
      if (crown) crown.textContent =
        \`🏆 이번 주 종합 1위: \${leaders.join(" · ")} (1위 \${top}개)\`;
    }
    // 주간 리셋·공지 팝업 (records.js가 정의 — defer 스크립트라 파싱 뒤에야
    // 실행된다. fetch가 그 사이(interactive)에 끝나면 아직 없다 — load까지 대기)
    if (document.readyState !== "complete") {
      await new Promise((r) => addEventListener("load", r, { once: true }));
    }
    if (SITE === "slop") window.blWeeklyResetNotice?.(week, notice);
  } catch {}
})();

// Slop에서만 현재 브라우저의 KST 기준 연속 방문일을 우상단 배지로 보여준다.
(async () => {
  const streak = document.getElementById("streak");
  if (!streak) return;
  try {
    const res = await fetch("/_streak", { cache: "no-store" });
    if (!res.ok) throw new Error();
    const data = await res.json();
    streak.textContent = \`🔥 \${data.streak ?? 1}\`;
    streak.title = \`나의 Slop 연속 방문 · \${data.streak ?? 1}일\`;
  } catch {
    streak.textContent = "";
  }
})();

// 올타임 1위는 존중받아야 한다 — 홈 상단에 이름을 크게 새긴다.
// 집계는 명예의 전당과 같은 규칙(blPodium.rank, slop 스코프)이고, 전체
// 시상대는 명예의 전당에 있다. 캐시로 즉시 그리고 최신값으로 갱신한다.
(async () => {
  const el = document.getElementById("alltime-top");
  if (!el) return;
  const KEY = "bl-alltime-top-v1";
  const render = (t) => {
    if (!t || !Array.isArray(t.nicks) || !t.nicks.length) return false;
    el.querySelector(".at-sub").textContent =
      \`👑 \${t.nicks.length > 1 ? "공동 " : ""}올타임 1위 · \${t.count}관왕\`;
    el.querySelector(".at-nick").textContent = t.nicks.join(" · ");
    el.hidden = false;
    return true;
  };
  try { render(JSON.parse(localStorage.getItem(KEY) || "null")); } catch {}
  try {
    const res = await fetch("/_records?alltime=1&scope=slop", { cache: "no-store" });
    if (!res.ok) throw new Error();
    const { records } = await res.json();
    // podium.js는 defer라 파싱 뒤에야 실행된다. fetch가 그 사이(interactive)에
    // 끝나면 blPodium이 아직 없다 — 문서 load까지 기다리면 확실하다.
    if (document.readyState !== "complete") {
      await new Promise((r) => addEventListener("load", r, { once: true }));
    }
    const top = (window.blPodium?.rank(records) ?? [])[0];
    if (!top || top.rank !== 1) return;
    const t = { nicks: top.members.map((m) => m.nick), count: top.count };
    if (render(t)) localStorage.setItem(KEY, JSON.stringify(t));
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
<script defer src="/_shared/podium.js"></script>
<script defer src="/_shared/records.js"></script>
<script defer src="/_shared/suggest.js"></script>
</body>
</html>
`;
}

// 자동 생성 홈을 가진 카테고리 = 카드로 이루어진 서브도메인. 홈 버튼은 여기에만 단다
// (podcast·duri처럼 자체 index.html을 가진 서비스는 카드 구조가 아니라 제외된다).
const cardSites = [];

for (const site of sites) {
  if (existsSync(join(DIST, site.name, "index.html"))) continue;
  cardSites.push(site.name);

  // 기본 순서는 가나다순. 접속량 데이터가 있으면 클라이언트에서 재정렬한다.
  const entries = readdirSync(join(DIST, site.name), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !UNLISTED_ENTRIES.get(site.name)?.has(d.name))
    .map((d) => ({
      name: d.name,
      emoji: toyEmoji(site.name, d.name),
      ...toyMeta(site.name, d.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  writeFileSync(
    join(DIST, site.name, "index.html"),
    listingPage(site.name, entries),
  );
  console.log(`generated index for ${site.name} (${entries.length} entries)`);
}

// 랜딩(bubblelab.dev)의 검색 색인. 공개 서브도메인의 카드 페이지를 제목·폴더 이름으로
// 모아 www/index.html 안에 그대로 심는다(요청 한 번 덜고, 오프라인에서도 뜬다).
// **감춘 것은 검색에서도 감춘다** — confidential 서브도메인과 UNLISTED_ENTRIES는
// 카테고리 홈 카드와 똑같이 제외한다. 검색 규칙 자체는 `_shared/search-rules.js`.
{
  const cards = [];
  for (const site of sites) {
    if (site.name === "www" || CONFIDENTIAL_SUBDOMAINS.has(site.name)) continue;
    const unlisted = UNLISTED_ENTRIES.get(site.name);
    for (const entry of readdirSync(join(DIST, site.name), { withFileTypes: true })) {
      if (!entry.isDirectory() || unlisted?.has(entry.name)) continue;
      if (!existsSync(join(DIST, site.name, entry.name, "index.html"))) continue;
      const { title, label } = toyTitle(site.name, entry.name);
      cards.push({
        site: site.name,
        name: entry.name,
        label: label || entry.name,
        title,
        emoji: toyEmoji(site.name, entry.name).char,
      });
    }
  }
  cards.sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name, "ko"));

  const file = join(DIST, "www", "index.html");
  const html = readFileSync(file, "utf8");
  const json = JSON.stringify(cards).replace(/</g, "\\u003c");
  const next = html.replace(
    /(<script type="application\/json" id="bl-cards">)[\s\S]*?(<\/script>)/,
    (_, open, close) => open + json + close,
  );
  if (next === html) {
    throw new Error('www/index.html에 검색 색인 자리(<script id="bl-cards">)가 없다');
  }
  writeFileSync(file, next);
  console.log(`generated landing search index (${cards.length} cards)`);
}

// 공용 스크립트를 페이지에 한 번만 삽입한다. 개별 토이가 직접 챙길 필요가 없다.
function injectShared(dir, src) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      injectShared(path, src);
    } else if (entry.name.endsWith(".html")) {
      const html = readFileSync(path, "utf8");
      if (html.includes(src) || !/<\/body>/i.test(html)) continue;
      writeFileSync(path, html.replace(
        /<\/body>/i,
        `<script defer src="${src}"></script>\n</body>`,
      ));
    }
  }
}
// 체류 측정기는 admin을 뺀 모든 페이지에. (카테고리 홈은 클라이언트에서 제외된다)
// 유틸 독은 홈·공유 버튼이 등록해 들어가는 그릇이라 같은 범위에 깔아둔다.
// 등록이 하나도 없으면 독은 아예 그려지지 않는다.
//
// life 는 뺀다: 워커가 방문 집계에서 이미 제외하고 있고(worker.js), 공유·홈 버튼이
// 없어 독이 그려질 일도 없다. 받아 봐야 하는 일 없이 여는 속도만 깎는다.
const NO_SHARED_SCRIPTS = new Set(["admin", "life"]);
for (const site of sites) {
  if (NO_SHARED_SCRIPTS.has(site.name)) continue;
  injectShared(join(DIST, site.name), "/_shared/engagement.js");
  injectShared(join(DIST, site.name), "/_shared/dock.js");
}
// 홈 버튼은 카드 카테고리의 카드 페이지에만 — 카테고리 홈 자신은 갈 곳이 없다.
let homeButtons = 0;
for (const name of cardSites) {
  for (const entry of readdirSync(join(DIST, name), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    injectShared(join(DIST, name, entry.name), "/_shared/home.js");
    homeButtons++;
  }
}
console.log(`injected home button into ${homeButtons} card pages`);

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

// 배포 신원. `/_health`가 이 파일을 읽어 커밋 SHA를 돌려주고, verify-prod는
// "내가 방금 올린 커밋이 실제로 서빙되고 있는가"를 그걸로 판단한다 — 없으면
// 이전 배포를 검사하고 통과했다고 착각한다.
{
  let commit = process.env.GITHUB_SHA ?? "";
  if (!commit) {
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    } catch { commit = ""; }
  }
  writeFileSync(
    join(DIST, "_health.json"),
    // 서브도메인 이름 목록은 담지 않는다 — 비공개 서브도메인은 주소를 모르는 것이
    // 유일한 장벽이라 개수만 센다.
    JSON.stringify({ commit, builtAt: new Date().toISOString(), siteCount: sites.length }) + "\n",
  );
  console.log(`health stamp → dist/_health.json (${commit.slice(0, 7) || "no-git"})`);
}

console.log(`build done → dist/ (${sites.map((s) => s.name).join(", ")})`);
