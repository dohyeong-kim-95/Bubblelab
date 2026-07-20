# 상품 리뷰 동기화 — 실서비스 전환 안내

다온핏 상세페이지의 **구매 후기**는 네이버 스마트스토어 리뷰를 주기적으로
가져와 보여주도록 설계되어 있습니다. 다만 **현재는 실제 API를 붙이지 않고
mock(샘플) 데이터로 동작**합니다. 실서비스로 전환할 때 아래 항목을 반드시
확인하세요.

> 이 문서는 의뢰자·인수 개발자 전달용입니다. 시연은 mock 데이터로 그대로
> 동작하며, 판매자 API 자격증명을 넣는 순간 실데이터 경로로 전환됩니다.

## 지금 어떻게 동작하나 (mock)

- 상세페이지(`goods/<상품>.html`)가 `reviews.js`로 두 곳을 호출해 자기
  상품(`window.blProduct`) 항목만 골라 렌더합니다:
  - `/_workreviews/daonfit` → 네이버에서 동기화된 **리뷰 + 상품 문의(Q&A)**.
  - `/_workqna/daonfit` → 다온핏 사이트 자체 문의(고객이 `qna.html`에서 남긴 것).
- **출처 표시**: 네이버에서 온 항목(`source: "naver"`)에는 초록색 **네이버 마크(N)**를
  붙이고, 다온핏 자체 문의에는 `다온핏` 배지를 붙여 구분합니다.
- 서버(`_infra/reviews.js`)의 `fetchStoreReviews()`는 **판매자 자격증명이 없으면
  mock 리뷰·문의를 반환**하고, 있으면 실제 커머스 API 경로(`fetchNaverReviews` /
  `fetchNaverQna`)를 탑니다.
- 동기화 결과(`{ items(리뷰), questions(문의) }`)는 `WorkReviewsDO`(프로젝트당 1개)에
  캐시되고, 매일 cron(06:40 KST)이 갱신합니다. 최초 조회 시에도 한 번 채웁니다.
- mock 목록은 `_infra/reviews.js`의 `MOCK_REVIEWS`·`MOCK_QNA`에 있습니다. 상품
  slug는 상세페이지 파일명과 일치합니다: `keybox`, `parking-keyring`, `vent-clip`,
  `mini-atm`, `figure-stand`.

## 실데이터로 켜는 방법

1. **네이버 커머스 API 신청** — 판매자센터에서 API 사용 신청 후 애플리케이션을
   등록하고 `client_id` / `client_secret`을 발급받습니다.
2. **Worker secret 등록** (`wrangler secret put`):
   - `NAVER_COMMERCE_CLIENT_ID`
   - `NAVER_COMMERCE_CLIENT_SECRET`
   - `NAVER_PRODUCT_MAP` — 상품 slug ↔ 스마트스토어 상품ID 매핑(JSON).
     예: `{"daonfit":{"keybox":"1234567890","vent-clip":"..."}}`
3. 두 자격증명이 존재하면 `fetchStoreReviews()`가 자동으로 실제 API 경로를 탑니다.
   코드 수정 없이 mock → 실데이터로 전환됩니다.

## ⚠️ 실서비스 전 반드시 확인할 것

1. **토큰 서명(bcrypt) 미구현** — 커머스 API 토큰은
   `client_secret_sign = base64(bcrypt("{client_id}_{timestamp}", client_secret))`
   서명을 요구합니다. **Cloudflare Workers 기본 런타임에는 bcrypt가 없어**
   `signClientSecret()`이 지금은 에러를 던집니다. 순수 JS bcrypt를 번들하거나,
   토큰 발급을 별도 서버/함수에서 처리해 주입하는 방식으로 **서명 구현을
   반드시 붙여야** 합니다. (이 한계가 mock으로 둔 핵심 이유입니다.)
2. **응답 스키마 검증** — `fetchNaverReviews()`·`fetchNaverQna()`가 사용하는
   엔드포인트·필드명(리뷰: `reviews`, `reviewId`, `reviewScore`, `reviewContent`,
   `createDate` / 문의: `pay-user/inquiries`, `inquiryNo`, `inquiryContent`,
   `answerContent` 등)은 실제 커머스 API 문서 기준으로 **재확인**하세요. API
   버전에 따라 경로·필드가 다를 수 있습니다. (특히 상품 문의 조회 엔드포인트는
   스켈레톤 값이므로 실제 스펙 확인이 필요합니다.)
3. **리뷰 재게시 정책** — 네이버 스토어의 구매평을 자체 사이트에 노출하는 것에 대한
   네이버 약관·저작권(작성자 동의)을 확인하세요. 가장 안전한 방식은 자체 후기
   수집이거나, 노출 가능 범위 내 요약입니다.
4. **개인정보 최소화** — 작성자명은 `maskNick()`으로 첫·끝 글자만 남깁니다. 원문
   그대로 저장·노출하지 마세요. 전화번호·주소 등은 애초에 받지 않습니다.
5. **동기화 주기·부하** — 현재 하루 1회(06:40 KST). 리뷰 수가 많아지면 상품별
   페이지네이션과 rate limit을 처리하세요. cron은 `wrangler.jsonc`의
   `triggers.crons`, 대상 프로젝트는 `worker.js`의 `WORK_REVIEW_PROJECTS`.
6. **실패 시 동작** — API 실패는 조용히 무시하고(로그만) 마지막 캐시를 유지합니다.
   `WorkReviewsDO`에 남은 값이 계속 노출되므로, 장애 시 오래된 리뷰가 보일 수
   있음을 감안하세요.
7. **인계 시** — 이 기능은 Worker + Durable Object 백엔드에 의존합니다. 백엔드
   원본은 **이 폴더 안에 함께 들어 있습니다**(`_backend/reviews.js`) — 아래
   "인계와 독립 2벌" 참고. 인수 측은 이 파일을 자신의 Cloudflare Worker(또는
   동등한 백엔드)에 붙여 `/_workreviews/daonfit` 라우트를 제공하면 됩니다.
   순수 정적으로만 갈 거라면 ① 빌드 시점에 리뷰를 JSON으로 뽑아 번들하거나
   ② 리뷰 섹션을 스마트스토어 리뷰 링크로 대체하세요.

## 인계와 독립 2벌 (사본 정책)

리뷰 백엔드는 **완전히 독립된 두 벌**로 보관됩니다. 서로 import하지 않아,
한쪽을 지워도 다른 쪽이 그대로 돕니다.

- `work/daonfit/_backend/reviews.js` — **인계용 사본.** 다온핏 폴더가 통째로
  전달·삭제될 때 함께 넘어가는 자체 완결 백엔드 원본입니다. 이 폴더만으로
  백엔드까지 재구성할 수 있습니다.
- `_infra/reviews.js` — **보관용 사본.** 리포에 남아 라이브 워커가 사용하며,
  이후 다른 프로젝트에 재사용할 수 있게 유지합니다. work 폴더가 삭제돼도
  이 파일과 리포는 깨지지 않습니다.

두 파일은 지금 코드가 동일합니다(헤더 주석만 다름). 로직을 고칠 일이 생기면
**양쪽 모두** 반영하세요.

## 관련 파일

| 파일 | 역할 |
| --- | --- |
| `work/daonfit/_backend/reviews.js` | **인계용** 백엔드 원본(프로바이더 + `WorkReviewsDO`) |
| `work/daonfit/reviews.js` | 상세페이지 리뷰 위젯(클라이언트) |
| `work/daonfit/goods/*.html` | `window.blProduct`로 상품 지정 후 위젯 로드 |
| `_infra/reviews.js` | **보관용** 동일 사본(라이브 워커가 사용) |
| `_infra/worker.js` | `/_workreviews/<project>` 라우트 + cron 동기화 |
| `wrangler.jsonc` | `WORK_REVIEWS` DO 바인딩·마이그레이션(v9) |
