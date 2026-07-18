# work — 외주 작업 미리보기

상태: **Restricted**. `WORK_PASSWORD` Worker secret을 아는 사람만 접근할 수 있습니다.

<https://work.bubblelab.dev>는 클라이언트에게 진행 중인 작업을 보여주는 비공개
공간입니다. 프로젝트 하나 = 폴더 하나(`work/<프로젝트명>/index.html`)이며, 다른
카테고리와 달리 카드 목록을 자동 생성하지 않습니다(루트 `index.html` 고정).

## 접근 제어

- 서브도메인 전체가 워커의 비밀번호 게이트 뒤에 있습니다. 비밀번호는
  `WORK_PASSWORD` Worker secret 하나이고, 세션은 admin과 같은 HMAC 서명
  쿠키(24시간)입니다. 로그인은 15분당 5회로 제한됩니다.
- secret이 설정되지 않았으면 503으로 잠깁니다(fail-closed).
  `npx wrangler secret put WORK_PASSWORD`로 설정합니다.
- 모든 응답에 `X-Robots-Tag: noindex`와 `Cache-Control: no-store`가 붙고 방문
  통계에서도 제외됩니다.

## QnA API

프로젝트별 문의 보드가 필요하면 `/_workqna/<프로젝트>` API를 씁니다
(GET 목록 / POST ask·answer·delete). work 게이트 세션 쿠키가 있어야만 접근되고,
쓰기는 10분당 10회로 제한되며 `WorkQnaDO`에 프로젝트당 최근 500건을 보관합니다.

## 주의

- **리포는 public입니다.** 게이트는 배포된 화면만 가리므로, 커밋된 코드·이미지는
  GitHub에서 볼 수 있습니다. 시안 유출이 민감한 프로젝트는 인계 직전까지 더미
  에셋을 쓰거나 별도 private 리포로 작업합니다.
- 클라이언트 브랜드 로고·사진 등 에셋은 해당 프로젝트 폴더 README에 권리자를
  명시하고, 인계·서비스 종료 시 폴더를 삭제합니다.
