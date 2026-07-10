// 호스트명 → sites/ 최상위 폴더 라우팅.
//   slop.bubblelab.dev/foo  → dist/slop/foo
//   bubblelab.dev/          → dist/www/
// 로컬 개발(wrangler dev)에서는 호스트명이 localhost라서
// 첫 번째 경로 세그먼트를 서브도메인 대신 사용한다:
//   localhost:8787/slop/foo → dist/slop/foo

const ROOT_DOMAIN = "bubblelab.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    let site;
    let path = url.pathname;

    if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) {
      site = "www";
    } else if (host.endsWith(`.${ROOT_DOMAIN}`)) {
      site = host.slice(0, -(ROOT_DOMAIN.length + 1));
    } else {
      const segments = path.split("/").filter(Boolean);
      site = segments[0] ?? "www";
      path = "/" + segments.slice(1).join("/");
    }

    url.pathname = `/${site}${path}`;
    return env.ASSETS.fetch(new Request(url, request));
  },
};
