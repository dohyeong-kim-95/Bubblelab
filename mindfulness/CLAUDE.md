# mindfulness — 서브도메인 작업 메모

루트 `CLAUDE.md`(공통 규칙)를 먼저 읽는다. 여기엔 **이 폴더 고유의 것**만 적는다.
공개 상태·데이터 처리 약속은 `README.md`.

## 이 폴더의 성격

- 퍼블릭 서브도메인. 카드 4장(`breathe`·`thought-bubble`·`sound-bubble`·`listen`) + 허브 `index.html`.
- **카드 목록이 자동 생성되지 않는다.** 자체 `index.html`이 있으면 빌드가
  카테고리 홈 생성을 건너뛴다(`_infra/build.mjs:624` — `existsSync(dist/<site>/
  index.html)`이면 `continue`). 새 카드는 `mindfulness/index.html`의
  `section.grid` 안에 `<a class="card">`로 직접 추가해야 목록에 뜬다.
- 같은 이유로 공용 홈 버튼(`/_shared/home.js`)도 안 붙는다
  (`_infra/build.mjs:707`의 `for (const name of cardSites)` 루프가 카드 사이트만
  돈다) — 하위 페이지마다 `‹ 카드`(`href="../"`)를 손으로 단다
  (`breathe/index.html:17`).
- 토이 관례 중 `share.js`·주간 기록(`records.js`)은 쓰지 않는다. 대신 빌드가
  `/_shared/engagement.js`·`/_shared/dock.js`를 모든 html에 자동 삽입한다
  (`_infra/build.mjs:700-703`의 전 사이트 루프) — 직접 넣지 말 것.
- **서버 코드가 없다.** `wrangler.jsonc:72-91`의 `durable_objects`에 mindfulness
  항목이 없고 `_infra/worker.js`에 분기도 없다 — DO·라우트·시크릿·`ENABLE_*`
  플래그·cron 전부 해당 없음 = 순수 정적.
- **저장하지 않는다.** `localStorage`/`sessionStorage`/쿠키/`fetch`/`sendBeacon`
  이 0건. 생각방울 문구는 `textContent`로만 쓰고 `pagehide`에서 지운다
  (`thought-bubble/app.js:131-134`). README의 공개 약속이라, 자유 입력을 서버로
  보내려면 Privacy 문서·동의가 먼저다.

## 로케일 · 시간 표기

- 언어는 ko-KR: 5개 페이지 모두 `<html lang="ko">`, 카피 전부 한국어. 랜딩
  검색어가 되는 건 **하위 카드 4장의 `<title>`**(예: `숨방울 — Bubble
  Mindfulness`)이고 **허브 `<title>`은 색인 대상이 아니다** — 색인은 하위 폴더만
  훑어 mindfulness 항목은 4개뿐이다(빌드 후 `dist/www/index.html`의 `bl-cards`
  JSON). 허브를 한국어로 찾게 하는 건 `_shared/search-rules.js:48` SYNONYMS뿐.
- **날짜 경계(KST) 로직은 이 폴더에 없다.** 세션 기록·연속 일수(streak)·달력이 없고
  `Date`/`Intl`/`toLocale*` 호출이 0건이다. 새로 넣는다면 공통 기준(KST=UTC+9)을 따르고
  `_infra/verify-prod.mjs:34`의 `kstDate()`를 참고한다.
- 경과 시간은 어디서나 `M:SS` — `Math.floor(초/60)` + `String(초%60).padStart(2,"0")`.
  `listen/app.js:64-67`의 `formatTime()`, `sound-bubble/app.js:262`,
  `breathe/app.js:214-217`(잠들기 모드는 뒤에 " 남음").
- 통화·숫자 서식은 해당 없음(값을 다루지 않는다). 볼륨만 `%` 정수로 표시한다.
- 허브 카드의 소요 시간(`.time`: 약 1분 / 약 15초 / 약 2분 ×2)은 **손으로 적은
  라벨**이라 코드 상수와 연결돼 있지 않다 — 길이를 바꾸면 같이 고친다. 상수는
  `breathe/app.js:4-9`(준비 5s + 들4s/내6s ×6회, 잠들기 모드 30회·마지막 60s
  페이드), `sound-bubble/app.js:4`(120s), `listen/app.js:4,46-56`(27.633s ×3회).
- **타이머 기준은 벽시계가 아니다.** 소리가 켜져 있으면 `audioContext.currentTime`, 아니면
  `performance.now()`(`breathe/app.js:179-183`의 `nowMs()`, `sound-bubble/app.js:254`).
  일시정지도 `suspend()/resume()`으로 한다 — `Date.now()`로 바꾸면 소리와 화면이 어긋난다.
- 외부 의존은 `listen/`뿐 — 음원·아트워크를 절대 URL
  `https://assets.bubblelab.dev/_assets/music/upward-drift/…` 에서 받는다
  (`listen/index.html:86`의 `<audio>`, 허브는 `index.html:159`). 원본은 리포
  `_assets/music/upward-drift/`, 로컬에서도 프로덕션 도메인에서 받아 온다.

## 배포 — 공통과 같다(`make ship`, 에이전트는 `/ship`). 고유한 건 둘뿐

- 퍼블릭이라 `www/index.html`에 카드가 있어야 빌드가 통과한다
  (`_infra/build.mjs:69-74`의 `public subdomain … is missing` throw). 현재 줄은
  `www/index.html:96` — 지우면 빌드가 죽는다.
- 라이브 검증은 폴더 목록에서 자동 생성되는 `site:mindfulness` 프로브 하나
  (`_infra/verify-prod.mjs:292-319`의 사이트 루프) — 첫 화면 200 / `text/html` /
  본문 500바이트 초과 / `<title>` 존재만 본다. 하위 카드 4장은 프로브가 없다.

## 테스트 — **전용 단위 테스트 없음**

- `npm test`: `_infra/home-button.test.mjs:221`이 랜딩 색인에 mindfulness가
  있는지만 본다. 카드 동작을 검사하는 테스트는 없다.
- `npm run test:e2e`: `_infra/e2e/smoke.spec.mjs:19`의 `SCREENS` 항목
  `/mindfulness/` **홈 한 장**만 모바일 스모크(스크립트 예외·가로 넘침·빈 화면).
  카드 4장은 자동 테스트에 안 걸린다.
- 그래서 카드를 고쳤으면 `node _infra/build.mjs` + `make serve` 후 브라우저 수동
  확인이 실질적인 검증이다(오디오·wakeLock·mediaSession은 헤드리스에서 못 본다).
  새 카드는 `SCREENS`에 한 줄 추가를 고려 — 그 파일은
  `_infra/agent-scope.conf`의 `*shared*`라 커밋은 되되 훅이 경고한다.

## 함정

- 허브 `index.html`의 카드 링크는 **절대경로**다(`/breathe/` 등 134·142·150·158줄). 프로덕션
  호스트 라우팅에서만 맞고, 로컬 `make serve`는 첫 경로 세그먼트를 서브도메인으로 읽으므로
  (`_infra/worker.js:1-6`) `localhost:8787/mindfulness/`에서 누르면 404다. 하위 페이지는
  상대경로(`../`, `./styles.css`)라 양쪽 다 된다 — 새 카드는 하위 페이지 방식을 따른다.
- 다크모드가 없다. 5개 페이지 모두 `color-scheme: light` 고정이라 루트 관례(`light-dark()`)와
  다르다. 톤을 바꾸려면 카드 4장 + 허브를 함께 고쳐야 한다.
- 카드에 진짜 이모지가 없어 랜딩 카드 아이콘이 어긋나 있다 —
  `toyEmoji()`(`_infra/build.mjs:230-240`)가 첫 `Extended_Pictographic`을 뽑는데
  breathe·sound-bubble은 UI 기호 `♪`가 먼저 잡히고 listen·thought-bubble은 기본값 `🫧`로
  떨어진다(허브 표기 🫧/💭/♪/🎧 와 다름). 카드 `index.html` 앞쪽에 의도한 이모지를 넣으면 된다.
- 안전 문구를 지우지 않는다: 허브 footer의 "의료적 진단이나 치료를 대신하지 않습니다"
  (`index.html:167`)와 각 카드의 시작 전 다이얼로그(`#infoDialog`, 예:
  `breathe/index.html:126-138`). 카드를 추가하면 같은 것을 붙이고,
  `work/showcase/mindfulness.html`(포트폴리오)은 `work/` 소유라 손대지 않는다.
