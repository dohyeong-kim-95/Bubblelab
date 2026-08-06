# admin — 운영 관리 화면

상태: **Restricted**. 공개 프로젝트 카드가 아니며 운영자 인증 뒤에서만 사용합니다.

<https://admin.bubblelab.dev>에서 Bubblelab 운영 데이터를 관리합니다. 정적 화면은
`index.html` 하나지만 로그인과 API는 `_infra/worker.js`가 처리합니다.

현재 기능:

- 오늘·최근 방문 통계와 페이지별 집계 확인 (유효 방문자/전체 브라우저 병기,
  오염된 날짜의 통계 초기화 포함)
- 게임별 이번 주 기록 및 올타임 기록 삭제
- 카테고리 홈에 전달할 공지 작성·조회·삭제
- 방문자가 보낸 토이 아이디어 조회·삭제
- 스티커 팩 공개 여부 토글 (✨ Sticker) — 아래 참고
- 이미지 업로드 UI는 남아 있지만 서버 `/api/assets`가 비활성화되어 실제 업로드 불가

운영 환경은 `ADMIN_ID`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` Worker secret이
모두 있어야 열립니다.
누락 시 기본 계정으로 열리지 않고 503으로 잠깁니다. 로컬 개발에서만
`admin/admin`을 기본값으로 사용합니다. 관리자 세션은 계정 정보와 분리된
`ADMIN_SESSION_SECRET`으로 HMAC 서명하며 24시간 유지됩니다.

로그인은 Cloudflare가 확인한 IP 기준 15분에 5회로 제한됩니다. IP 원문은 저장하지
않고 HMAC 처리한 rate-limit 버킷만 제한 시간 동안 사용합니다. 관리자 응답에는
`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, 클릭재킹 방지 헤더가
붙습니다. Cloudflare Access는 결제 수단 등록이 가능한 시점까지 보류된 2차 방어입니다.

관리자 API는 인증 쿠키 뒤에서만 접근할 수 있습니다.

| API | 메서드 | 기능 |
| --- | --- | --- |
| `/api/stats` | GET | 방문 통계 (유효/전체 순사용자) |
| `/api/stats/reset` | POST | 특정 날짜 방문 통계 삭제 (`?date=YYYY-MM-DD`) |
| `/optout` | GET, POST | 운영자 브라우저 집계 제외 토글 (전체 서브도메인 쿠키) |
| `/api/records` | GET, DELETE | 주간·올타임 기록 관리 |
| `/api/notice` | GET, POST, DELETE | 공지 관리 |
| `/api/suggestions` | GET, DELETE | 아이디어 우편함 관리 |
| `/api/stickers` | GET, POST | 스티커 팩 공개 여부 조회·토글 |
| `/api/assets` | — | 현재 비활성 |

## 스티커 팩 공개 여부

✨ Sticker 화면에서 팩마다 [공개 중 | 숨김]을 눌러 바꿉니다. 기본값은 리포의
`_assets/sticker/<id>/metadata.json`의 `active`이고, 여기서 바꾼 값이 그 위에
얹혀 `AssetFlagsDO`에 남습니다 — 재배포해도 유지되고, 재빌드 없이 바뀝니다.
`POST /api/stickers`에 `visible: null`을 보내면 오버라이드가 지워지고 리포 값으로
돌아갑니다(화면에는 기본값이 다를 때만 "기본값 공개/숨김"으로 표시됩니다).

- 적용 범위는 **목록 노출**입니다: `assets/sticker` 카탈로그와 util/chat 스티커
  서랍(둘 다 `/_assets/catalog.json`을 읽습니다)에서 빠집니다. 파일
  (`/_assets/sticker/<id>/01.png`)은 주소를 아는 사람이 그대로 받을 수 있습니다 —
  완전히 내리려면 리포에서 팩을 지우고 배포해야 합니다.
- 방문자 화면 반영까지 최대 1분 남짓 걸립니다(워커 아이솔레이트 캐시 60초 +
  카탈로그 응답 캐시 30초).
- 배경화면 등 다른 카테고리는 대상이 아닙니다. 항목마다 빌드가 상세페이지를 굽기
  때문에 런타임 토글과 반쪽으로 어긋납니다.
