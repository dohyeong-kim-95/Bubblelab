# idle 서브도메인 — 에이전트 메모

`idle.bubblelab.dev` = 7일짜리 방치형 게임 **Bubble Pop Idle** 한 개 + 명예의
전당. 게임 규칙·경로 표는 `idle/README.md`, 리포 공통 규칙은 루트 `CLAUDE.md`.
여기엔 **이 서브도메인에서만 다른 것**만 적는다. 로직은 전부
`bubble-pop/game-core.js`(DOM 없는 순수 ES 모듈, `_infra/idle.test.mjs` 가 직접
import), 화면·저장·제출은 `bubble-pop/game.js` — **새 계산은 game-core.js 에
넣어야 테스트가 볼 수 있다.**

## 1. 로케일과 시간

- 문서는 `<html lang="ko">`(`bubble-pop/index.html:2`), UI 문구는 한국어.
- 시즌 경계는 **월요일 09:00 KST = 월요일 00:00 UTC**. `seasonBounds()`가
  `Date.UTC` 로만 계산하므로 KST 오프셋을 따로 더하지 않는다
  (`game-core.js:34 (seasonBounds)`, 테스트 `_infra/idle.test.mjs:26 (Monday 09:00 KST)`).
  주간 기록 서버도 같은 경계를 쓴다(`_infra/records.js:1 (머리 주석)`).
- 시간은 전부 `Date.now()` 하나로 잰다. 저장 위치는 `localStorage`
  `"bl-bubble-pop-idle-v1"` 안의 `state.lastSeenAt`(+ `startedAt`) —
  `saveState()`가 5초마다·조작마다 갱신한다(`game.js:11 (SAVE_KEY)`, `:66 (saveState)`, `:442 (틱 저장)`).
- 오프라인 보상은 `settleOffline()`(`game-core.js:259`) 한 곳:
  `lastSeenAt → min(now, 시즌 종료)` 구간, **최대 24시간**
  (`game-core.js:2 (OFFLINE_CAP_MS)`). 복귀·탭 전환도 같은 함수를 탄다
  (`game.js:115 (resume)`, `:540 (visibilitychange)`).
- **시계 되돌림 방어는 "음수 방지"까지만**이다. 되돌린 시계에선 경과가 0으로
  깎이고(`game-core.js:261 (from 클램프)`), 틱도 `activeUntil > from` 일 때만
  생산한다(`game.js:430 (tick)`). 서버 재연산은 없다 — README 의 "양심 기록".

## 2. 숫자 표기 (실제 통화는 없다)

- 재화는 게임 내 두 종류뿐: 🫧 버블, 💠 압력. 결제·광고 경로 없음.
- `formatNumber()`(`game-core.js:273`): 1000 미만은 `toLocaleString("ko-KR")`
  정수, 이상은 1000 단위 `K M B T Qa Qi Sx Sp Oc No` + **소수 자릿수** 0/1/2
  (`:279` — 100 이상은 0자리라 유효숫자는 늘 3자리). **억·조 같은 한글 만 단위
  축약은 쓰지 않는다**(값이 1e100 까지 간다). 압력만 작은 값을 소수로
  (`game.js:54 (formatPressure)`).

## 3. 배포

- 절차는 공통 — `make ship`(에이전트는 `/ship`, 루트 `CLAUDE.md` 참고).
- **서버 라우트도 DO도 이 서브도메인 전용으로는 없다.** 정적 파일 + 공용
  `/_records`(워커가 공용 `RECORDS` DO 로 넘긴다, `_infra/worker.js:1276 (/_records)`)
  뿐이라 `wrangler.jsonc` 에 idle 전용 바인딩·`ENABLE_*` 플래그가 없다.
- 주간 기록은 `_infra/records.js:28 (GAMES)` 에 `"bubble-pop-idle"`
  (`dir: max`, `max: 1e100`)로 등록돼 있다 — 미등록이면 서버가 제출을 거절한다.
  `:53 (HISTORICAL_GAMES)` 에도 들어 있어 주가 넘어가면 `idlehall:` 키로 옮겨
  **최근 52시즌**이 남고, 그걸 `hall-of-fame/` 이 읽는다(`?history=1&game=…`).
- 토이 관례인 `_shared/share.js`·`window.blWeekly`(`_shared/records.js`)는
  **쓰지 않는다.** `game.js:414 (syncRecord)` 가 `/_records` 로 직접 POST 한다.
- 퍼블릭 서브도메인이라 `www/index.html:97 (idle 카드)` 가 있어야 빌드가
  통과한다(검사는 `_infra/build.mjs:69 (public subdomain is missing…)`).
- `idle/index.html` 이 손으로 쓴 홈이라 빌드가 카드 목록도 홈 버튼(`_shared/home.js`)
  도 넣지 않는다(`_infra/build.mjs:621 (cardSites)`, `:706 (home.js 주입)`) —
  **뒤로 가기 링크는 직접 넣는다**(`bubble-pop/index.html:14`).
- 검증 프로브는 폴더에서 자동 생성되는 `site:idle`(`_infra/verify-prod.mjs:292`)
  와 공용 `api:records`(`:350`) — `bash scripts/verify-prod.sh --only site:idle`.

## 4. 테스트

```bash
node --test _infra/idle.test.mjs   # 이 게임 전용 (16개: 시즌·밸런스·마이그레이션·명예의 전당)
node _infra/idle-balance.mjs       # 밸런스·콘텐츠 소진 시뮬레이터 (표를 눈으로 본다)
npm test                           # 전체 (_infra/*.test.mjs)
npm run test:e2e                   # 스모크 — idle 은 홈 /idle/ 한 장뿐, 게임 화면은 미포함 (smoke.spec.mjs:20)
```

`_infra/idle.test.mjs` 는 밸런스에 **상한·하한**을 건다(1층 완료 30~40분 `:75`,
부활 증폭 이득 1.25배 미만 `:93`). 생산 상수를 만지면 여기가 먼저 깨진다.
랜딩 검색 색인 검사는 `_infra/home-button.test.mjs:211-223` — **다만 idle 자체를
단언하지 않는다(mindfulness 만 확인).** idle 홈은 색인에 들어가지만 지켜 주는
테스트가 없다. 그 파일은 소유 목록에 없는 공용 인프라라 이 레인에서 단언을 더할
수 없다(훅이 거부한다). `_infra/idle*.mjs` 는 이름 규칙으로 이 서브도메인 소유
(`_infra/agent-scope.conf` 머리말), `_infra/records.js`·`www/index.html`·
`_infra/e2e/smoke.spec.mjs` 는 공용이라 커밋은 되지만 훅이 경고한다.

## 5. 함정 — 진행도가 날아가는 경로

- `loadState()`(`game.js:45 (loadState)`)는 조금이라도 어긋나면 **조용히 `null`**
  을 돌려주고, 그러면 시작 모달의 `begin()` 이 같은 키를 새 상태로 덮어쓴다
  (`game.js:85 (begin)`). 폐기 조건: 시즌 키 불일치, `version` 범위 밖,
  `startedAt`/`bubbles`/`lifetime` 이 유한수가 아님.
- 그래서 **`SAVE_VERSION` 을 낮추거나 저장 필드 이름을 바꾸면 전원 진행도가
  리셋된다.** 올릴 때는 `migrateState()`(`game-core.js:56 (migrateState)`)에
  기본값 보강을 같이 넣고, `_infra/idle.test.mjs:106`·`:122` 의 v1·v2
  마이그레이션 테스트처럼 새 버전 테스트를 하나 추가한다.
- "디버깅: 진행 상황 완전 초기화" 버튼과 종료 모달의 "새 시즌 시작하기" 버튼은
  둘 다 저장 키를 지운다(`game.js:100 (reset-button)`, `:109 (new-season-button)`).
  스크린샷·수동 확인 중에 누르지 말 것.
- 제출 점수는 `state.lifetime`(누적)이고 `1e100` 으로 잘린다
  (`game.js:417 (score 캡)`) — `GAMES` 의 `max` 와 같은 값이라, 한쪽만 바꾸면
  제출이 400 으로 거절된다.
