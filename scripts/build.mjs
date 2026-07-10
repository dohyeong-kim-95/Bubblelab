// sites/ → dist/ 로 복사하고, index.html이 없는 카테고리 루트에는
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
import { join } from "node:path";

const SITES = "sites";
const DIST = "dist";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
cpSync(SITES, DIST, { recursive: true });

// 마지막 커밋 시각 (없으면 0). 자동 목록을 최신순으로 정렬하는 데 쓴다.
function lastCommitTime(path) {
  try {
    const out = execSync(`git log -1 --format=%ct -- "${path}"`, {
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

for (const dirent of readdirSync(DIST, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const site = dirent.name;
  if (existsSync(join(DIST, site, "index.html"))) continue;

  const entries = readdirSync(join(DIST, site), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      date: lastCommitTime(join(SITES, site, d.name)),
    }))
    .sort((a, b) => b.date - a.date || a.name.localeCompare(b.name));

  writeFileSync(join(DIST, site, "index.html"), listingPage(site, entries));
  console.log(`generated index for ${site} (${entries.length} entries)`);
}

if (!existsSync(join(DIST, "404.html"))) {
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
}

console.log("build done → dist/");
