# games 서브도메인 — 에이전트 메모

games.bubblelab.dev. 소개·구성 표는 `games/README.md`, 리포 공통 규칙은 루트
`CLAUDE.md`. 여기는 **이 폴더를 만질 때마다 다시 설명해야 했던 것**만 적는다. 현재
4개: `stepcam/`(공개, 서버 없는 1인용)과 `avalon/` `liargame/` `yacht/`(실시간
멀티플레이 — 지금은 목록에서 감춰지고 서버도 닫혀 있다, 아래 참고).

## 로케일·표기

- 언어는 ko-KR. 네 게임 모두 `<html lang="ko">`(각 `index.html:2`), 제목도 한국어다.
  `games/avalon/index.html:8 (<title>)` 만 원제인데 UNLISTED(아래)라 검색 대상이 아니다.
- 점수는 `toLocaleString("ko-KR")` 로 찍는다 — `games/stepcam/index.html:667·768·783
  (p-score / r-score / blShareText)`. 만점은 `chart.js:126 (MAX_SCORE = 1_000_000)`.
- 판정 창은 **초 단위 소수**다: 퍼펙트 0.06 / 그레이트 0.11 / 굿 0.18
  (`games/stepcam/chart.js:110-113 (JUDGES)`). 카메라가 초당 30장이라 ±16 ms 눈금
  오차가 깔려 있다(`chart.js:107` 주석) — 창을 더 좁히지 말 것. 남은 시간은 60초
  미만이면 `N초`, 이상이면 `m:ss`(`games/liargame/game.js:500`).
- **돈 표기도, 주간 기록 보드도, KST 날짜 경계도 없다.** games 는 `window.blWeekly` ·
  `_shared/records.js` 를 붙이지 않는다 — 점수는 그 판에서만 쓰고 서버로 보내지 않는다
  (`games/README.md`). 루트 `CLAUDE.md` 의 "월요일 09:00 KST 리셋"은 해당 없음.
  `_infra/records.js:51 (GAMES 의 "yacht-bot")` 은 `slop/yacht-bot/` 이지
  `games/yacht/` 가 아니다 — 헷갈리지 말 것.
- 공유 버튼(`_shared/share.js`)은 stepcam·yacht 만 쓴다(각 `index.html:876`·`:541`).

## `games/avalon/` 은 빌드 산출물 — 직접 수정 금지

- 소스는 `_src/avalon/`(Vite, `base: '/avalon/'` 는 `vite.config.js:7` 에 있다).
  고친 뒤 `_src/avalon/rebuild.sh` 를 돌리고 **산출물까지 같이 커밋**한다.
- `rebuild.sh:14-15` 가 `rm -rf ../../games/avalon` 후 `dist` 를 통째로 복사한다 —
  산출물에 손으로 넣은 파일은 사라진다. `--base` 같은 옵션을 rebuild.sh 에서 덮어쓰지
  말 것(예전에 CI 가 검사하는 빌드와 운영 산출물의 설정이 갈렸다 — `rebuild.sh:5-7`).
- CI·Deploy 가 `node _infra/check-avalon-sync.mjs` 로 대조하고 어긋나면 배포가
  멈춘다(`.github/workflows/ci.yml:50`, `deploy.yml:51`). `make ship` 도 diff 에
  아발론이 있으면 같은 검사를 먼저 돌린다(`scripts/ship.sh:58-62`). 린트는 산출물을
  건너뛴다(`scripts/lint.sh:31`).

## 배포·런타임 (공통은 `make ship` / `/ship`)

- **실시간 3종은 지금 꺼져 있다**: `wrangler.jsonc:20 (vars.ENABLE_REALTIME = "false")`.
  `/_rt/*` 는 503 을 돌려준다(`_infra/worker.js:1647 (featureEnabled 분기)`).
- `/_rt/<이름>` 은 화이트리스트다: `_infra/worker.js:16 (REALTIME_NAMESPACES =
  {avalon, liargame, yacht})`, 목록 밖 이름은 400(`worker.js:1654`). 바인딩은
  `wrangler.jsonc:74 (durable_objects REALTIME → RealtimeDO)`, 마이그레이션은
  `wrangler.jsonc:95 (tag v1, RealtimeDO)`.
- **클라이언트 구현은 셋이 따로다.** avalon 은 `_src/avalon/src/firebase.js:12`,
  liargame 은 `_shared/realtime-client.js:5`(리포에서 이 모듈의 유일한 소비자),
  yacht 는 `games/yacht/index.html:125` 의 **자체 인라인 클라이언트**(`:128-129` 에서
  ws URL 을 직접 조립, `:134` `new WebSocket`). 프로토콜을 바꾸면 **세 곳을 모두**
  고쳐야 하고, yacht 것은 `games/` 안이라 이 에이전트가 직접 고친다.
- 카테고리 홈 카드에서 감춤: `_infra/build.mjs:34-39 (UNLISTED_ENTRIES)` 의
  `games → {avalon, liargame, yacht}`. 소스와 직접 URL 은 살아 있고 검색 색인에서도
  빠진다(`build.mjs:645-651`). 공개할 땐 이 줄과 `games/README.md` 상태 표를 함께 고친다.
- **`ENABLE_REALTIME=true` 만 바꿔 재공개하지 말 것.** 지금 프로토콜은 메시지 크기·
  경로·Origin·namespace 만 검증하고 사용자 인증과 방별 읽기·쓰기 ACL 이 없다
  (`games/README.md`). 방 권한 모델을 먼저 넣고 게임별로 상태를 올린다.
- 라이브 검증(`make verify`, 구현 `_infra/verify-prod.mjs`)에서 games 는 폴더가 있다는
  이유로 첫 화면 프로브가 자동 생성되고(`verify-prod.mjs:292 (for site of sites)`),
  닫힘 계약 쪽에서 `/_rt/avalon` → 503 을 확인한다(`verify-prod.mjs:435 (gate:closed)`).
  **실시간을 켜면 이 줄도 같이 고쳐야** 배포 검증이 통과한다.

## 테스트

```bash
node --test _infra/stepcam.test.mjs _infra/liargame.test.mjs _infra/check-avalon-sync.test.mjs
npm test                              # 리포 전체 인프라 테스트
npm run test:ci --prefix _src/avalon  # 아발론 시뮬·불변식 6종 + build
node _infra/build.mjs && npx playwright test -g "발판 리듬"
```

- `_infra/stepcam.test.mjs` 는 `games/stepcam/vision.js`·`chart.js` 를,
  `_infra/liargame.test.mjs` 는 `games/liargame/rules.js` 와
  `_shared/multiplayer-room.js` 를 직접 import 한다 — export 이름을 바꾸면 깨진다.
- e2e 의 games 화면은 `/games/stepcam/` 하나뿐(`_infra/e2e/smoke.spec.mjs:28 (SCREENS
  의 "발판 리듬")`) — 카메라 없는 헤드리스에서도 첫 화면이 떠야 한다는 뜻. 감춰진 3개는
  대상이 아니다. 크로미움이 이미 있으면 `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## 함정

- **에이전트 브랜치의 커밋 범위**(`_infra/agent-scope.conf:18 (games: 줄)`): 자기 폴더
  밖에서 소유하는 것은 `_infra/check-avalon-sync.mjs`·`.test.mjs`,
  `_infra/liargame.test.mjs`, `_infra/stepcam.test.mjs`, `_src/avalon/*` 뿐이다.
- `_infra/realtime.js` 와 `_shared/realtime-client.js`·`_shared/multiplayer-room.js` 는
  **아무에게도 속하지 않는 공용 인프라라 에이전트가 못 건드린다**. liargame 이 둘 다
  import 하므로(`games/liargame/game.js:1-2`) 프로토콜 변경은 오케스트레이터에게 넘긴다.
- `wrangler.jsonc`·`_infra/build.mjs`·`_infra/e2e/smoke.spec.mjs` 는
  `agent-scope.conf:26 (*shared*: 줄)` 이라 커밋은 되지만 훅이 경고하고 충돌 후보다.
- games 는 퍼블릭 서브도메인이라 `www/index.html` 랜딩 카드가 필수다
  (`_infra/build.mjs:69 (public subdomain is missing 검사)`). 이 파일 자체는
  `build.mjs:54 (AGENT_DOCS)` 가 dist 에서 걸러 배포되지 않는다.
- 새 정적 게임은 이 폴더에 바로 넣을 수 있지만, 보통 `slop/` 에서 검증한 뒤 승격한다.
