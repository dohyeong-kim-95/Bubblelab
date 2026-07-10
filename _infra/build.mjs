// 리포 루트에서 `_`나 `.`로 시작하지 않는 폴더 = 서브도메인.
// 각 폴더를 dist/ 로 복사하고, index.html이 없는 서브도메인 루트에는
// 하위 폴더 목록 페이지를 자동 생성한다. (slop에 토이를 추가하면
// slop.bubblelab.dev 홈에 자동으로 링크가 뜬다.)
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
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

const sites = readdirSync(ROOT, { withFileTypes: true }).filter(isSite);
for (const site of sites) {
  cpSync(join(ROOT, site.name), join(DIST, site.name), { recursive: true });
}

// 마지막 커밋 시각 (없으면 0). 자동 목록을 최신순으로 정렬하는 데 쓴다.
function lastCommitTime(path) {
  try {
    const out = execSync(`git log -1 --format=%ct -- "${path}"`, {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    return out ? Number(out) * 1000 : 0;
  } catch {
    return 0;
  }
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function listingPage(site, entries) {
  const items = entries
    .map(({ name, date }) => {
      const when = date
        ? `<time>${new Date(date).toISOString().slice(0, 10)}</time>`
        : "";
      return `      <li><a href="/${escapeHtml(name)}/">${escapeHtml(name)}</a>${when}</li>`;
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
  body { font-family: ui-monospace, monospace; max-width: 40rem;
         margin: 4rem auto; padding: 0 1.5rem; line-height: 1.7; }
  h1 { font-size: 1.2rem; } h1 span { opacity: .45; font-weight: normal; }
  ul { list-style: none; padding: 0; }
  li { display: flex; justify-content: space-between; gap: 1rem;
       border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
       padding: .5rem 0; }
  time { opacity: .5; font-size: .85em; }
  footer { margin-top: 3rem; opacity: .4; font-size: .8em; }
</style>
</head>
<body>
  <h1>${escapeHtml(site)}<span>.bubblelab.dev</span></h1>
  <ul>
${items || "      <li>아직 아무것도 없어요</li>"}
  </ul>
  <footer><a href="https://bubblelab.dev">bubblelab.dev</a></footer>
</body>
</html>
`;
}

for (const site of sites) {
  if (existsSync(join(DIST, site.name, "index.html"))) continue;

  const entries = readdirSync(join(DIST, site.name), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      date: lastCommitTime(join(ROOT, site.name, d.name)),
    }))
    .sort((a, b) => b.date - a.date || a.name.localeCompare(b.name));

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
