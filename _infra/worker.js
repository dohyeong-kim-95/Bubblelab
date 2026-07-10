// 호스트명 → sites/ 최상위 폴더 라우팅.
//   slop.bubblelab.dev/foo  → dist/slop/foo
//   bubblelab.dev/          → dist/www/
// 로컬 개발(wrangler dev)에서는 호스트명이 localhost라서
// 첫 번째 경로 세그먼트를 서브도메인 대신 사용한다:
//   localhost:8787/slop/foo → dist/slop/foo

const ROOT_DOMAIN = "bubblelab.dev";

export { RealtimeDO } from "./realtime.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    let site;
    let path = url.pathname;

    // 공용 에셋(_shared/*)은 모든 서브도메인에서 사이트 프리픽스 없이 서빙
    if (path.startsWith("/_shared/")) {
      return env.ASSETS.fetch(request);
    }

    // 실시간 데이터 서버: /_rt/<이름> → 이름당 Durable Object 하나
    if (path.startsWith("/_rt/")) {
      const name = path.slice("/_rt/".length).split("/")[0];
      if (!name) return new Response("missing name", { status: 400 });
      const id = env.REALTIME.idFromName(name);
      return env.REALTIME.get(id).fetch(request);
    }

    if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) {
      site = "www";
    } else if (host.endsWith(`.${ROOT_DOMAIN}`)) {
      site = host.slice(0, -(ROOT_DOMAIN.length + 1));
    } else {
      const segments = path.split("/").filter(Boolean);
      site = segments[0] ?? "www";
      path = "/" + segments.slice(1).join("/");
      // 트레일링 슬래시 보존 (없으면 에셋 서버의 canonical 리다이렉트와 루프)
      if (url.pathname.endsWith("/") && !path.endsWith("/")) path += "/";
    }

    url.pathname = `/${site}${path}`;
    return env.ASSETS.fetch(new Request(url, request));
  },
};
