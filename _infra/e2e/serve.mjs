// dist/를 워커와 같은 규칙으로 서빙하는 최소 정적 서버 — Playwright 스모크
// 테스트용이다. 워커(_infra/worker.js)는 서브도메인으로 폴더를 고르지만,
// 로컬에서는 wrangler와 마찬가지로 **첫 경로 세그먼트**를 서브도메인으로 읽는다.
//
//   /               → dist/www/index.html      (apex)
//   /slop/dino/     → dist/slop/dino/index.html
//   /_assets/…      → dist/_assets/…           (공용 에셋은 그대로)
//
//   node _infra/e2e/serve.mjs [포트]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wasm": "application/wasm",
};

async function resolveFile(pathname) {
  // 경로 탈출 차단 — 테스트 서버라도 dist 밖은 열지 않는다
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidates = clean === "/" || clean === ""
    ? [join(DIST, "www", "index.html")]
    : [join(DIST, clean), join(DIST, clean, "index.html"),
       // apex(www) 자산: /style.css 처럼 서브도메인 없이 오는 요청
       join(DIST, "www", clean)];
  for (const path of candidates) {
    if (!path.startsWith(DIST)) continue;
    try {
      if ((await stat(path)).isFile()) return path;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

export function createStaticServer() {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    const file = await resolveFile(pathname);
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
}

const port = Number(process.argv[2] ?? 8788);
createStaticServer().listen(port, () => console.log(`dist/ → http://localhost:${port}`));
