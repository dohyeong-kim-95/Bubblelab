# admin — 에이전트용 배경 메모

`admin.bubblelab.dev` 운영 관리 화면. **토이가 아니다** — share.js·주간 기록
관례를 붙이지 않는다. 공통 규칙은 루트 `CLAUDE.md`, 기능·API 목록은
`admin/README.md`. 정적 파일은 `admin/index.html` 한 장(로그인 뒤 해시로 뷰
전환)이고 로그인·API는 전부 `_infra/worker.js`의 `handleAdmin`(:847)에 있다.

**내 소유 파일**(`_infra/agent-scope.conf:16` — `admin:` 줄): `admin/**`,
`_infra/analytics.js`, `_infra/analytics.test.mjs`. `_infra/worker.js`·
`wrangler.jsonc`·`_infra/build.mjs`는 공용이라 커밋 훅이 경고한다 — 한 줄만
고치고 남의 변경은 함께 add 하지 않는다.

## 로케일 · 시간대

- 문서 언어는 `<html lang="ko">`(index.html:2), UI 문구는 전부 한국어.
- **서버 날짜는 KST 고정.** `kstDate()`(worker.js:701)가
  `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })`로 `YYYY-MM-DD`를
  만들고 `/api/stats`(worker.js:905)가 그 값을 쓴다. AnalyticsDO도 같은 방식
  (`recentDates`, analytics.js:24-35), 날짜 경계는 `T00:00:00+09:00`. 날짜를
  새로 만들 일이 생기면 `toISOString()` 대신 이 함수를 쓴다.
- **화면 표시는 브라우저 로컬 시간대다.** `toLocaleDateString('ko-KR')`·
  `toLocaleString('ko-KR')`(index.html:606 아이디어·:648/:692 기록·:733 의뢰·
  :766 공지)에 `timeZone`이 없다. KST를 못 박은 곳은 통계 초기화 날짜 입력
  하나뿐(index.html:479) — 날짜를 새로 표시할 때 여기 맞출지 먼저 정한다.
- 숫자는 `toLocaleString('ko-KR')`로 천단위 구분(index.html:407-441, :492), 큰
  숫자 칸은 `font-variant-numeric: tabular-nums`(index.html:39, `.value`),
  참여율만 소수 1자리 반올림(analytics.js:271). 통화·금액은 다루지 않는다.

## 배포 · 게이트

배포는 `make ship`(= `/ship`) 하나로 한다. 아래는 admin 고유분만.

- **ENABLE_* var 없음.** admin은 var가 아니라 secret으로 잠근다: `ADMIN_ID` /
  `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`(wrangler.jsonc:54-56,
  `secrets.required`). 프로덕션 호스트에서 앞의 둘이 없으면 `admin/admin`으로
  열리지 않고 **503**(worker.js:1708, `admin credentials are not configured`)
  — 기본 계정은 로컬에서만 산다. 팟캐스트 화면만 `ENABLE_PODCAST`에 딸려 있어,
  꺼지면 `/api/podcast/*`가 503(worker.js:1003), 화면은 "팟캐스트가 꺼져 있어요".
- **DO 바인딩**(wrangler.jsonc `durable_objects`): `ANALYTICS`(통계 — 이
  서브도메인이 소유하는 `AnalyticsDO`), `RECORDS`(기록·공지·아이디어),
  `WORK_QNA`(의뢰 접수함), `CHAT`(정원), `PODCAST`, `ASSET_FLAGS`(스티커 토글),
  `RATE_LIMITER`(로그인 제한). admin 전용 R2·cron은 **없다**.
- **라우팅**: `site === "admin"` 분기(worker.js:1703-1713). 프로덕션은 경로
  프리픽스가 없고 로컬(`localhost:8787/admin/...`)은 `base = "/admin"` — 이
  판정을 클라이언트도 복제하니(index.html:463) 새 API 경로는 양쪽 다 붙인다.
- **세션**: 쿠키 `bl_admin`, HttpOnly·SameSite=Strict·24시간(worker.js:852,
  `cookieFlags`), `ADMIN_SESSION_SECRET`으로 HMAC(worker.js:195, `sessionKey`),
  로그인 15분 5회 제한(worker.js:856, `scope: "admin-login"`). 응답에는
  `no-store` + `noindex, nofollow`가 강제로 붙고(worker.js:1777의 게이트 사이트
  분기) admin 방문은 통계에 잡히지 않는다(worker.js:1798).
- **`CONFIDENTIAL_SUBDOMAINS`에 들어 있다**(build.mjs:29-30) — `www/index.html`
  에 admin 링크를 넣으면 빌드가 실패한다(build.mjs:66-68, `must not be linked`).
- **이 `CLAUDE.md`와 `README.md`는 배포되지 않는다** — 빌드의 `AGENT_DOCS`
  정규식이 거른다(build.mjs:54, `README|CLAUDE|AGENTS`). 안 그러면 게이트·
  바인딩·env 이름이 `admin.bubblelab.dev/CLAUDE.md`로 그대로 서빙된다.
- **라이브 검증**: `GATED_SITES`(verify-prod.mjs:22)에 들어 있고 프로브는
  `admin:api`(verify-prod.mjs:473) — 폼 로그인 후 `/api/stats`·`/api/chat`을
  읽는다(`BL_ADMIN_ID`/`BL_ADMIN_PASSWORD` 없으면 SKIP).
  단독 실행 `bash scripts/verify-prod.sh --only admin`.

## 테스트

`npm test`가 전체, 둘만 돌리려면 `node --test _infra/analytics.test.mjs
_infra/home-button.test.mjs`. admin을 덮는 테스트(줄은 밀리니 이름으로 찾는다):

- `_infra/analytics.test.mjs` — AnalyticsDO 단위 전체. **내 소유 파일**이다.
- `_infra/worker.test.mjs:337 (optout toggle is admin-gated …)`,
  `:538 (admin에서 토글한 스티커 공개 여부가 카탈로그에 반영된다)`
- `_infra/security.test.mjs:100 (admin responses are never cached or indexed)`
- `_infra/home-button.test.mjs:49 (카드 구조가 아닌 서비스·비공개 사이트에는
  주입되지 않는다)`, `:162 (비공개 서브도메인은 풀다운 메뉴에도 나오지 않는다)`,
  `:225 (에이전트 문서는 배포되지 않는다)`, `:239 (비공개 서브도메인·감춘 카드는
  검색 색인에도 없다)` — 이 파일은 `test.before`에서 스스로 `build.mjs`를 돌린다
  (빌드 산출물 검사는 병렬 경합 때문에 여기 한 곳에 모은다).
- `_infra/verify-prod.test.mjs:173` — `GATED_SITES`(admin 포함)가 worker.js
  분기와 같은지 (테스트 `모든 서브도메인에 첫 화면 프로브가 하나씩 생긴다`).

**e2e 스모크(`_infra/e2e/smoke.spec.mjs`의 `SCREENS`)에 admin 화면은 없다** —
로그인 게이트 뒤라 정적 서버로는 못 여니 추가하지 않는다.

## 함정

- `/api/assets`는 서버가 **404 고정**(worker.js:1015-1016)인데 화면에는 업로드
  UI가 남아 있다(index.html:255 폼, :502-577 스크립트). 안 되는 게 현재 상태다.
- 방문 통계는 **35일치만 남는다**(analytics.js:3 주석, :125
  `recentDates(date, 35)`). `/api/stats`의 `days`는 1~30으로 잘리고
  (worker.js:902, `Math.min(30, …)`), `/api/stats/reset`은 `YYYY-MM-DD`만 받고
  아니면 400(worker.js:916, `invalid date`).
- 스티커 공개 토글은 화면 반영까지 최대 1분 남짓(워커 아이솔레이트 캐시 60초 +
  카탈로그 응답 캐시 30초, `admin/README.md`) — 즉시 안 바뀐다고 코드를 의심 말 것.
