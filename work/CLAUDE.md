# work 서브도메인 — 에이전트 배경 메모

리포 공통 규칙은 루트 `CLAUDE.md`, 화면·접근제어는 `work/README.md`, 이모티콘
작업 절차는 `work/emoticon/README.md`가 원본이다. 여기는 **work 고유의 것만**.

work은 토이가 아니라 **여러 앱이 한 서브도메인에 모인 작업실**이고, 폴더 밖에
소유 파일이 가장 많다. `_infra/agent-scope.conf`의 `work:` 줄이 그 목록이다 —
`_infra/workqna.js` `_infra/reviews.js` `_infra/emoticon*.mjs` `_infra/emoticon*.js`
`_infra/skeleton*.mjs` `_src/emoticon/*` (+ 각 `*.test.mjs`).

## 앱 → 서버 파일 → 테스트

| 앱 / 화면 | 서버·소스 | 테스트 |
|---|---|---|
| 루트 공개(`index.html`·`request.html`·`showcase/`) | `_infra/worker.js` `handleWork()`·`WORK_PUBLIC_PAGES`(:332), 접수 `/_workintake`(:1382) | `_infra/worker.test.mjs` (공용) |
| 의뢰 프로젝트 `work/<의뢰ID>/` (현재 `daonfit/`) | `_infra/workqna.js` = `WorkQnaDO`, 라우트 `/_workqna/<프로젝트>`(worker.js:1419) | `_infra/workqna.test.mjs` |
| 상품 리뷰·문의 동기화 | `_infra/reviews.js` = `WorkReviewsDO`, `/_workreviews/<프로젝트>`(:1562), cron `syncWorkReviews()`(:1833) | `_infra/reviews.test.mjs` |
| `work/emoticon/` 생성 파이프라인 | `_infra/emoticon.mjs`(CLI)·`-run`·`-prompt`·`-rig`·`-vision`·`-gate`·`-ai`·`-gen`, 작업장 `_src/emoticon/` | `_infra/emoticon*.test.mjs` |
| 포즈 스켈레톤(포즈 조건화) | `_infra/skeleton.mjs`·`_infra/skeleton-cli.mjs` | `_infra/skeleton.test.mjs` |
| `/emoticon/history` 검수 게시판 | `_infra/emoticon-review.js` = `EmoticonReviewDO`, `/_emoticon/review`(:1520); 페이지 데이터는 빌드가 `_infra/emoticon-history.mjs`로 `dist/work/emoticon/history/`에 생성 | `_infra/emoticon-review.test.mjs` |

## 로케일·시간

- 모든 페이지 `<html lang="ko">`. 한국어 UI.
- **KST 변환 코드가 어디에도 없다.** 저장 타임스탬프는 전부 UTC ISO —
  `workqna.js:32` `askedAt`, `emoticon-review.js:31` `at`. 검수 게시판은 그 값을
  `slice(0, 16).replace("T", " ")`로 그대로 찍는다
  (`work/emoticon/history/index.html:131`). 즉 화면 시각은 UTC다. 바꾸려면 여기.
- 리뷰 날짜도 UTC 기준: 커머스 응답은 `slice(0, 10)`(`reviews.js:105·128`),
  자체 등록분은 `new Date().toISOString().slice(0, 10)`(`reviews.js:216`).
- cron 표기는 UTC(`wrangler.jsonc:47`). `40 21 * * *` = 06:40 KST.

## 통화

이모티콘 이미지 생성 비용만 돈을 표시한다. 단가 `IMAGE_COST_USD = 0.039`
(`_infra/emoticon-run.mjs:10`), 표기는 **USD 고정** `$0.039` 꼴 —
`` `$${cost.toFixed(3)}` ``(`emoticon-run.mjs:172·189`, `emoticon.mjs:566`).
원화 표기는 없다.

## 배포 (공통 절차는 `make ship` / `/ship`)

- **ENABLE_* var가 없다.** work은 `WORK_PASSWORD` secret이 없으면 라우트가 통째로
  503 = fail-closed(`worker.js:1420·1533·1563`). 끄고 켜는 var를 찾지 말 것.
- secret: `WORK_PASSWORD`(운영자 마스터), `WORK_CLIENTS`(JSON `{"의뢰ID":"비번"}`),
  `GEMINI_STICKER_KEY`(엣지 프록시 `/_emoticon/generate`, worker.js:1460).
  `EMOTICON_EDGE_TOKEN`은 로컬 env이고 값이 work 마스터 비밀번호다.
- DO 바인딩(`wrangler.jsonc:79·80·84`): `WORK_QNA`/`WorkQnaDO`(v6),
  `WORK_REVIEWS`/`WorkReviewsDO`(v9), `EMOTICON_REVIEW`/`EmoticonReviewDO`(v12).
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
  `site:work`는 200을 기대). 전용 프로브는 `api:emoticon-review`(:397, `/_emoticon/review`가
  200·`version:1`·`items` 배열인지). e2e 스모크 대상은 아니다(`smoke.spec.mjs:8`).
- GitHub Actions 3종(`.github/workflows/`):
  - `emoticon.yml` — 생성. `_src/emoticon/job.json` push가 트리거. 테스트·빌드 →
    검수 댓글 pull → 생성 → **check 통과분만** `_src/emoticon/`에 커밋 →
    `deploy.yml`을 직접 dispatch. 실행 산출물은 artifact `emoticon-run-<run_id>`(14일).
  - `emoticon-parts.yml` — 비전 부품 검사 일괄. 대상 컷은 `_src/emoticon/parts.txt`.
  - `emoticon-reviews.yml` — 6시간마다 `/_emoticon/review`를 `_src/emoticon/reviews.json`으로.

## 테스트

```bash
node --test _infra/workqna.test.mjs _infra/reviews.test.mjs \
            _infra/emoticon*.test.mjs _infra/skeleton.test.mjs
node --test _infra/worker.test.mjs      # 라우트·게이트를 건드렸으면 추가로
EMOTICON_IMAGE_PROVIDER=mock node _infra/emoticon.mjs …   # 키 없이 파이프라인만
```

## 함정

- `_src/emoticon/*/cuts/*/frames-raw/`는 `.gitignore:7`이다. 누끼 전 원본을 다시
  구하는 경로는 그 실행의 Actions artifact(14일)뿐이고, 그 뒤엔 재생성이다.
  계속 참조할 이미지는 추적 대상인 `<캐릭터>/refs/`에 둔다.
- 생성 산출물은 **Actions가 main에 직접 커밋한다.** 레인에서 이모티콘 작업 중이면
  push 전에 최신 `_src/emoticon/`을 가져와야 한다.
- 에이전트 토큰에 `workflow_dispatch` 권한이 없다(403). 워크플로를 지금 돌리려면
  그 워크플로 파일을 건드려 push한다(세 파일 모두 자기 경로 push 트리거를 갖고 있다).
- 배포 사이트에 직접 접근할 수 없으므로 **사람 검수 피드백은 `_src/emoticon/reviews.json`으로만** 읽는다.
- 리포는 public이다. 게이트는 배포된 화면만 가린다 — 커밋한 시안·에셋은 GitHub에서 보인다.
- `daonfit`은 쇼핑몰형 시안에서 **브랜드 랜딩 단일 페이지**로 교체됐다. 그래서
  `_infra/reviews.js` 주석이 가리키는 `work/daonfit/REVIEWS.md`·`goods/<slug>.html`은
  지금 없고, `/_workreviews/*`를 실제로 쓰는 페이지도 없다(cron은 계속 돈다).
- `_infra/skeleton.mjs` 헤더가 가리키는 `work/emoticon/pose-conditioning.md`는
  현재 `work/emoticon/doc/archive/pose-conditioning.md`에 있다(폐기된 접근 보존).
