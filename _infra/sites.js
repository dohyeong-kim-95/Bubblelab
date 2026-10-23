// 서브도메인 분류의 원본 한 곳. 예전에는 build.mjs(CONFIDENTIAL_SUBDOMAINS·SKIP),
// verify-prod(GATED_SITES·SKIP_DIRS), deploy-scope(SITES), worker.js(no-store·집계 제외
// 목록)가 같은 목록을 손으로 따로 들고 있었고, 한 곳만 고쳐 어긋난 적이 있다(공개
// /_stats 가 lab·podcast 페이지 이름을 내보냈다). 워커도 불러 쓰므로 fs 를 쓰지 않는다.

// 루트 폴더지만 서브도메인이 아닌 것. `_`·`.` 로 시작하는 폴더는 따로 빠진다.
// docs/ 는 개발 워크플로 문서, scripts/ 는 배포 스크립트다.
// agent-worktree.sh 가 이 줄을 sed 로 읽는다 — 한 줄 모양을 유지할 것.
export const NON_SITE_DIRS = new Set(["dist", "node_modules", "docs", "scripts", "pops_generator"]);

export function isSiteDirectoryName(name) {
  if (name.startsWith("_") || name.startsWith(".")) return false;
  return !NON_SITE_DIRS.has(name);
}

// 비공개 서브도메인: 랜딩 카드·풀다운·검색 색인·공개 방문 통계에 나오지 않는다.
// 주소를 모르는 것이 유일한 장벽이라 이름을 밖으로 내보내는 곳이 없어야 한다.
// 새 폴더는 기본 공개이고, 빌드가 www 랜딩 카드 존재 여부를 검사한다.
export const CONFIDENTIAL_SUBDOMAINS = new Set(
  ["admin", "work", "podcast", "estate", "duri", "test", "lab", "life"]);

// 로그인 게이트가 사이트 전체를 막는 서브도메인 (worker.js 의 site 분기와 같다).
// work 은 루트가 공개라 여기 없다.
export const GATED_SITES = new Set(["admin", "duri", "life"]);

// 워커가 정적 응답을 no-store·noindex 로 내보내는 서브도메인(캐시 예외는 worker.js 의
// CACHEABLE). 사용자 데이터를 다루거나 게이트 뒤에 있는 곳이다.
export const NO_STORE_SITES = new Set(["admin", "work", "estate", "duri", "life"]);

// 배포 범위 판정(deploy-scope)이 아는 서브도메인. 여기 없는 폴더가 바뀌면 전체 검증으로
// 올라간다 — 새 서브도메인은 테스트 목록을 정한 뒤 여기에 넣는다.
export const KNOWN_SITES = [
  "admin", "assets", "duri", "estate", "games", "idle", "lab",
  "life", "mindfulness", "podcast", "slop", "test",
  "util", "work", "www",
];
