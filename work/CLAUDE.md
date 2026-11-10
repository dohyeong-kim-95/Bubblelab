# work 서브도메인 — 에이전트 배경 메모

리포 공통 규칙은 루트 `CLAUDE.md`, 화면·접근제어는 `work/README.md`, 이모티콘
작업 기록은 `work/emoticon/README.md`가 원본이다. 여기는 **work 고유의 것만**.

work은 토이가 아니라 **여러 앱이 한 서브도메인에 모인 작업실**이고, 폴더 밖에
소유 파일이 가장 많다. `_infra/agent-scope.conf`의 `work:` 줄이 그 목록이다 —
`_infra/workqna.js` `_infra/reviews.js` `_src/emoticon/*` (+ 각 `*.test.mjs`).

## 앱 → 서버 파일 → 테스트

| 앱 / 화면 | 서버·소스 | 테스트 |
|---|---|---|
| 루트 공개(`index.html`·`request.html`·`showcase/`) | `_infra/worker.js` `handleWork()`·`WORK_PUBLIC_PAGES`(:332), 접수 `/_workintake`(:1382) | `_infra/worker.test.mjs` (공용) |
| 의뢰 프로젝트 `work/<의뢰ID>/` (현재 `daonfit/`) | `_infra/workqna.js` = `WorkQnaDO`, 라우트 `/_workqna/<프로젝트>`(worker.js:1419) | `_infra/workqna.test.mjs` |
| 상품 리뷰·문의 동기화 | `_infra/reviews.js` = `WorkReviewsDO`, `/_workreviews/<프로젝트>`(:1562), cron `syncWorkReviews()`(:1833) | `_infra/reviews.test.mjs` |
| `work/emoticon/` | 문서·스크립트만 있다(배포 화면 없음). 색 토큰 `_src/emoticon/dageudangs/tokens.json` | — |

## 로케일·시간

- 모든 페이지 `<html lang="ko">`. 한국어 UI.
- **KST 변환 코드가 어디에도 없다.** 저장 타임스탬프는 전부 UTC ISO —
  `workqna.js:32` `askedAt`. 즉 화면 시각은 UTC다.
- 리뷰 날짜도 UTC 기준: 커머스 응답은 `slice(0, 10)`(`reviews.js:105·128`),
  자체 등록분은 `new Date().toISOString().slice(0, 10)`(`reviews.js:216`).
- cron 표기는 UTC(`wrangler.jsonc:47`). `40 21 * * *` = 06:40 KST.

## 배포 (공통 절차는 `make ship` / `/ship`)

- **ENABLE_* var가 없다.** work은 `WORK_PASSWORD` secret이 없으면 라우트가 통째로
  503 = fail-closed. 끄고 켜는 var를 찾지 말 것.
- secret: `WORK_PASSWORD`(운영자 마스터), `WORK_CLIENTS`(JSON `{"의뢰ID":"비번"}`).
- DO 바인딩(`wrangler.jsonc`): `WORK_QNA`/`WorkQnaDO`(v6), `WORK_REVIEWS`/`WorkReviewsDO`(v9).
  **R2 버킷은 쓰지 않는다.**
- 전용 cron 없음 — 06:40 KST 런(`40 21 * * *`)에 리뷰 동기화가 얹혀 있다.
  대상은 `worker.js:18`의 `WORK_REVIEW_PROJECTS = ["daonfit"]`, 판매자
  자격증명이 없으면 mock으로 캐시를 채운다.
- 게이트: `/login`·`/logout`, 쿠키 `bl_work` 24시간, 로그인 15분당 5회.
  공개는 루트 `/`, `WORK_PUBLIC_PAGES`(`request`·`showcase`), 확장자 있는 루트
  파일뿐(`worker.js:380`).
- `_infra/build.mjs:29`의 `CONFIDENTIAL_SUBDOMAINS`에 `work`가 들어 있다 —
  `www/index.html`에 링크를 만들면 빌드가 실패한다.
- `_infra/verify-prod.mjs`: `GATED_SITES`에 work은 **없다**(:22 — 루트가 공개라
  `site:work`는 200을 기대). e2e 스모크 대상은 아니다(`smoke.spec.mjs`).

## 테스트

```bash
node --test _infra/workqna.test.mjs _infra/reviews.test.mjs
node --test _infra/worker.test.mjs      # 라우트·게이트를 건드렸으면 추가로
```

## 함정

- 리포는 public이다. 게이트는 배포된 화면만 가린다 — 커밋한 시안·에셋은 GitHub에서 보인다.
- `daonfit`은 쇼핑몰형 시안에서 **브랜드 랜딩 단일 페이지**로 교체됐다. 그래서
  `_infra/reviews.js` 주석이 가리키는 `work/daonfit/REVIEWS.md`·`goods/<slug>.html`은
  지금 없고, `/_workreviews/*`를 실제로 쓰는 페이지도 없다(cron은 계속 돈다).
