# 할 일

`life.bubblelab.dev` — 목록 여러 개를 좌우로 넘기며 쓰는 할 일 앱. 안드로이드에서
홈 화면에 추가해 PWA 로 쓰는 것을 기준으로 만들었다.

## 경계

**서버에 아무것도 저장하지 않는다.** 할 일은 브라우저 `localStorage`(`bl_life_v1`)에만
있다. 워커가 하는 일은 비밀번호 게이트(`bl_life` 쿠키)뿐이고, `/_life/*` 같은 API 는
없다. 기기끼리 동기화되지 않는다 — 폰에서 적은 것은 폰에만 있다.

브라우저 데이터를 지우면 함께 사라진다. 백업은 아직 없다.

## 만듦새

- `store.js` 가 상태를 전부 맡는다(순수 함수). 화면과 `_infra/life.test.mjs` 가
  같은 모듈을 쓰므로 목록·항목 규칙을 화면 안에서 따로 만들지 않는다.
- 좌우 이동은 CSS `scroll-snap` 이 맡는다. 드래그를 직접 처리하지 않아야 관성·
  되돌아가기·접근성이 브라우저 것 그대로 나온다. 스크롤이 멈추면 헤더와 점만 맞춘다.
- 목록 최대 12개, 이름 24자, 항목 200자. `store.js` 상단에 모여 있다.
- PWA 는 `display: standalone` 이라 주소창이 보이지 않는다. 안드로이드 크롬이 설치
  대상으로 인정하려면 192·512 PNG 아이콘이 필요해 `icon-192.png`·`icon-512.png` 를
  둔다(`_infra/png.mjs` 로 만들었다). 서비스워커는 셸을 캐시해 오프라인에서 열리게만 한다.

## 검증

```bash
node --test _infra/life.test.mjs
npx playwright test _infra/e2e/life.spec.mjs
```

프로덕션에는 `ENABLE_LIFE`, `LIFE_PASSWORD`, `LIFE_SESSION_SECRET` 이 필요하다.
`LIFE` Durable Object 바인딩은 쓰지 않지만, 적용된 마이그레이션을 되돌릴 수 없어
자리만 남아 있다(`_infra/life.js` 주석).
