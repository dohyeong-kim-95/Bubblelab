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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SKIP = new Set(["dist", "node_modules"]);

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

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 토이의 index.html에서 이모지(카드 아이콘용)를 뽑아온다.
function toyEmoji(site, name) {
  try {
    const html = readFileSync(join(ROOT, site, name, "index.html"), "utf8");
    return html.match(/\p{Extended_Pictographic}/u)?.[0] ?? "🫧";
  } catch {
    return "🫧";
  }
}

// 이름을 해시해서 카드마다 고정된 파스텔 색상을 준다.
function hueOf(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

function listingPage(site, entries) {
  const cards = entries
    .map(({ name, emoji }, i) => {
      return `    <a class="card" href="/${escapeHtml(name)}/"
       style="--hue:${hueOf(name)};--i:${i}">
      <span class="emoji">${emoji}</span>
      <span class="name">${escapeHtml(name)}</span>
      <span class="champ" data-game="${escapeHtml(name)}"></span>
    </a>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(site)}.bubblelab.dev</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, monospace; max-width: 52rem;
         margin: 3rem auto 4rem; padding: 0 1.25rem; }
  h1 { font-size: 1.25rem; text-align: center; margin-bottom: 2rem; }
  h1 span { opacity: .45; font-weight: normal; }
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
  @keyframes pop { from { transform: scale(.6); opacity: 0; } }
  .emoji { font-size: 2.6rem; line-height: 1; }
  .name { font-weight: bold; font-size: 1.02rem; word-break: break-all;
          text-align: center; }
  .champ { opacity: .55; font-size: .72rem; min-height: 1em; max-width: 100%;
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { text-align: center; opacity: .6; margin-top: 4rem; }
  footer { margin-top: 3.5rem; opacity: .4; font-size: .8em; text-align: center; }
  footer a { color: inherit; }
</style>
</head>
<body>
  <h1>${escapeHtml(site)}<span>.bubblelab.dev</span></h1>
${cards ? `  <div class="grid">\n${cards}\n  </div>` : `  <p class="empty">아직 아무것도 없어요 🫧</p>`}
  <footer><a href="https://bubblelab.dev">bubblelab.dev</a></footer>
<script>
const SITE = ${JSON.stringify(site)};

// 주간 신기록 보드(/_records)에서 카드별 챔피언을 채운다. 실패해도 조용히 넘어간다.
(async () => {
  const els = [...document.querySelectorAll(".champ[data-game]")];
  if (!els.length) return;
  try {
    const games = els.map((el) => el.dataset.game).join(",");
    const res = await fetch("/_records?games=" + encodeURIComponent(games), { cache: "no-store" });
    if (!res.ok) return;
    const { records } = await res.json();
    for (const el of els) {
      const r = records[el.dataset.game];
      if (!r) continue;
      // text 없는 옛 기록은 생 float가 못생기지 않게 반올림해서 보여준다
      el.textContent = \`👑 \${r.nick} · \${r.text ?? Math.round(r.score * 100) / 100}\`;
      el.title = "이번 주 1위 — 월요일 09시 초기화";
    }
  } catch {}
})();

// 주간 접속량(/_stats, 최근 7일 순방문자) 많은 순으로 카드를 재정렬한다.
// 동률(0 포함)은 빌드 시점의 가나다순이 그대로 유지된다.
(async () => {
  const grid = document.querySelector(".grid");
  if (!grid) return;
  try {
    const res = await fetch("/_stats");
    if (!res.ok) return;
    const { pages } = await res.json();
    const count = (card) =>
      pages[\`\${SITE}/\${card.querySelector(".champ")?.dataset.game}\`] ?? 0;
    const cards = [...grid.children];
    if (!cards.some((c) => count(c) > 0)) return;
    cards
      .map((card, i) => ({ card, n: count(card), i })) // i = 가나다순 (안정 정렬용)
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .forEach(({ card }, i) => {
        card.style.setProperty("--i", i);
        grid.append(card);
      });
  } catch {}
})();
</script>
<script defer src="/_shared/suggest.js"></script>
</body>
</html>
`;
}

for (const site of sites) {
  if (existsSync(join(DIST, site.name, "index.html"))) continue;

  // 기본 순서는 가나다순. 접속량 데이터가 있으면 클라이언트에서 재정렬한다.
  const entries = readdirSync(join(DIST, site.name), { withFileTypes: true })
    .filter((d) => d.isDirectory())
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
