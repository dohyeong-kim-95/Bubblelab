#!/usr/bin/env node
// dist/ 를 **프로덕션과 같은 보안 헤더로** 서빙한다.
//
// 왜 있나: 맨 정적 서버에는 CSP 가 없어서, life 처럼 `style-src 'self'` 인 화면의
// 인라인 style 이 로컬에서는 멀쩡히 그려지고 프로덕션에서만 조용히 버려진다.
// 그 차이를 배포 전에 보려는 것이다(실제로 그걸로 한 번 속았다).
//
// 헤더는 직접 적지 않고 워커와 **같은 applySecurityHeaders 를 부른다** — 정책이
// 바뀌면 여기도 함께 따라가야지, 베껴 두면 어긋난 줄도 모르고 통과시킨다.
//
//   node _infra/csp-serve.mjs                 # dist/ 를 8788 포트로
//   node _infra/csp-serve.mjs --port 9000 --dir dist
//   # http://localhost:8788/life/dram/  (첫 경로 세그먼트 = 서브도메인)
//
// wrangler dev 가 있으면 그쪽이 더 정확하다. 이건 빌드 산출물만 빠르게 보고 싶을 때다.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { applySecurityHeaders } from "./security.js";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

export function createCspServer({ dir = "dist", port = 8788 } = {}) {
  const root = resolve(dir);
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    // 디렉터리는 index.html 로 — 워커의 라우팅과 같은 모양으로 보이게 한다.
    const wanted = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const file = resolve(join(root, wanted));
    // 루트 밖으로 나가는 경로는 받지 않는다.
    if (file !== root && !file.startsWith(root + sep)) return send(res, url, 403, "밖으로 나갈 수 없다");
    try {
      send(res, url, 200, await readFile(file), TYPES[extname(file)]);
    } catch {
      send(res, url, 404, `없는 파일: ${url.pathname}`);
    }
  });
}

function send(res, url, status, body, type = "text/plain; charset=utf-8") {
  // 워커가 붙이는 것과 같은 헤더를 통과시킨다 — 이 서버의 존재 이유가 이 한 줄이다.
  const request = new Request(url.href);
  const headers = applySecurityHeaders(new Response(null, { status, headers: { "content-type": type } }), request).headers;
  res.writeHead(status, Object.fromEntries(headers));
  res.end(body);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
  };
  const port = Number(arg("port", 8788));
  const dir = arg("dir", "dist");
  createCspServer({ dir, port }).listen(port, () => {
    console.log(`csp-serve: ${resolve(dir)} → http://localhost:${port} (프로덕션과 같은 보안 헤더)`);
  });
}
