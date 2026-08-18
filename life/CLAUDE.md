# Life 유지보수 규칙

- **항목은 한 종류(`daily-action`)뿐이다.** 계층·부모·집중 목표를 다시 들이지 않는다
  — 그게 이 앱을 한 번 무겁게 만들었다가 걷어낸 것이다.
- 의미 데이터는 반드시 `crypto.js`를 거쳐 envelope로만 서버에 보낸다. API payload와
  로그에 평문 제목을 넣지 않는다.
- 복호화 문자열은 `textContent`, `createTextNode` 등 DOM API로만 렌더링한다.
  `innerHTML`, inline script/style/event handler를 추가하지 않는다.
- `/_life/*`, 로그인/리다이렉트 응답은 서비스워커에 캐시하지 않는다. 문서 요청은
  **네트워크 우선**이다 — 캐시를 먼저 주면 세션 만료 리다이렉트를 앱이 볼 수 없어
  잠금 화면과 401 사이에 갇힌다.
- KST 날짜 경계와 이월 규칙은 `model.js` 한 곳에서 관리한다.
- 목록에서 부르는 저장은 `guard()`를 지난다. 실패를 unhandled rejection 으로 흘리지
  않는다.
- 여러 건을 한 번에 큐잉할 때는 `queueEntities`를 쓴다 — 서버 프레임 한도에 맞춰
  잘라 담는다. 직접 뮤테이션을 만들지 않는다.
- 잠금·로그아웃·401 처리에서 encrypted `envelopes`, `outbox`, `conflicts`를 삭제하지
  않는다. 401은 게이트 로그인으로 보내되 기기 키는 남긴다.
- 충돌은 조용히 덮어쓰지 않는다. 409 로컬 초안을 `conflicts`에 보존하고, 서버가
  모르는 항목이면 로컬 envelope을 지운다.
- 서버(`_infra/life.js`)에서 `storage.put/get/delete`에 배열·객체를 넘길 때는
  `putAll/getAll/deleteAll`을 쓴다 — DO는 한 번에 128개까지만 받는다.
- UI는 Today가 기본 진입이다. 390px 가로 넘침, 44px 터치 타깃, 키보드/스크린리더,
  reduced motion을 유지한다.
- **기기 목록 API(`/_life/devices`)는 등록 코드를 돌려주지 않는다.** 코드는 새 기기
  화면에만 뜬다 — 이걸 목록에 실으면 비밀번호만 가진 사람이 혼자 등록을 마칠 수 있다.
- 세션 쿠키는 기기 ID 를 함께 서명한다. 다른 사이트가 쓰는 `validSession`(만료.nonce)
  과 형식이 다르니 그쪽을 고쳐 맞추지 말고 `lifeSessionDevice` 를 쓴다.
- `README.md`와 이 파일은 빌드에서 배포되지 않는다.
