# admin — 운영 관리 화면

<https://admin.bubblelab.dev>에서 Bubblelab 운영 데이터를 관리합니다. 정적 화면은
`index.html` 하나지만 로그인과 API는 `_infra/worker.js`가 처리합니다.

현재 기능:

- 오늘·최근 방문 통계와 페이지별 집계 확인
- 게임별 이번 주 기록 및 올타임 기록 삭제
- 카테고리 홈에 전달할 공지 작성·조회·삭제
- 방문자가 보낸 토이 아이디어 조회·삭제
- 이미지 업로드 UI는 남아 있지만 서버 `/api/assets`가 비활성화되어 실제 업로드 불가

운영 환경은 `ADMIN_ID`, `ADMIN_PASSWORD` Worker secret이 모두 있어야 열립니다.
누락 시 기본 계정으로 열리지 않고 503으로 잠깁니다. 로컬 개발에서만
`admin/admin`을 기본값으로 사용합니다. `ADMIN_SESSION_SECRET`을 설정하면 계정
정보와 별도의 HMAC 세션 키를 사용할 수 있으며 로그인 세션은 24시간 유지됩니다.

관리자 API는 인증 쿠키 뒤에서만 접근할 수 있습니다.

| API | 메서드 | 기능 |
| --- | --- | --- |
| `/api/stats` | GET | 방문 통계 |
| `/api/records` | GET, DELETE | 주간·올타임 기록 관리 |
| `/api/notice` | GET, POST, DELETE | 공지 관리 |
| `/api/suggestions` | GET, DELETE | 아이디어 우편함 관리 |
| `/api/assets` | — | 현재 비활성 |
