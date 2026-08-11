# puzzle 서브도메인 — 에이전트용 배경 메모

리포 공통 규칙(폴더=서브도메인, `git add -A` 금지, 로컬 서빙)은 루트 `CLAUDE.md`,
게임 목록·양산 규칙은 `puzzle/README.md`, 난이도 곡선은 `puzzle/DIFFICULTY.md`.
여기는 **puzzle 에만 해당하는 것**만 적는다.

## 로케일 · 시간

- 10장 전부 `<html lang="ko">`(예: `puzzle/watersort/index.html:2`), 제목·UI·공유 문구도 한국어.
- **주간 신기록 보드 경계 = 월요일 09:00 KST = 월요일 00:00 UTC.** 계산은
  서버 한 곳 `weekKey()` (`_infra/records.js:73-77`) — UTC 요일로 직전 월요일을
  구해 `YYYY-MM-DD` 를 만든다. KST 오프셋을 더하는 코드는 없다(UTC 월요일
  자정이 곧 KST 월요일 09시라 변환이 필요 없다).
- 클라이언트는 경계를 **직접 계산하지 않는다** — 응답의 `week` 문자열을 받아
  쓸 뿐이다 (`_shared/records.js:215-222`). 새 화면도 로컬 시각으로 주차를
  재계산하지 말고 서버 값을 그대로 쓴다.
- 경계 회귀 테스트: `_infra/records.test.mjs:23-28` (월요일 08:59 KST 는 지난주).
- 화면 문구는 "매주 월요일 09시 초기화" 로 통일 (`_shared/records.js:202,205`).
  puzzle 코드에는 그 밖의 시각·타임존 포맷팅이 하나도 없다.

## 점수·숫자 표기

- **돈 표기는 없다.** 이 서브도메인에 통화·금액·소수점 기록이 하나도 없다.
- 기록 단위는 **정수 "클리어 스테이지" 하나뿐**. 9종 전부 같은 포맷이다
  (`puzzle/watersort/index.html:313`, 나머지 8종도 게임 이름만 다르고 동일):

  ```js
  window.blWeekly = { game: "watersort", dir: "max", fmt: (v) => `스테이지 ${v}` };
  ```

  초·밀리초·자릿수 규칙은 해당 없음 — 명예의 전당이 게임별 개인 최고 스테이지를
  **더해서** 랭킹을 내므로 새 게임도 정수 스테이지여야 한다 (`_infra/records.js:85-92`).
- 서버로 가는 표시 문자열은 `fmt(점수)` 결과이고 제어문자 없는 24자 이내여야
  한다(벗어나면 숫자 그대로 저장, `_infra/records.js:334,364`). 닉네임은
  한글/영문/숫자 1~6자 (`_infra/records.js:6`).

## 배포에서 puzzle 만 다른 것

절차 자체는 `make ship`(= `/ship`, `.claude/commands/ship.md`). puzzle 함정만 적는다.

1. **주간 기록을 쓰려면 `_infra/records.js` 의 `GAMES` 에 `{ dir, min, max }`
   한 줄을 등록해야 한다** (`_infra/records.js:37-45`). 서버가 방향·범위를
   고정하고 **미등록 게임의 제출은 400 으로 거절**된다 — 클라이언트에는 "등록
   실패" 토스트만 뜨는, 코드상 멀쩡해 보이는 버그가 된다. `/_like`(👍) 도 같은
   표를 보므로 등록 전에는 추천 버튼도 죽는다 (`_infra/records.js:131,136`).
2. 명예의 전당 합산 대상은 **별도 배열** `PUZZLE_GAMES`
   (`_infra/records.js:56-57`). 여기 빠지면 총합과 `scope=puzzle` 올타임
   보드에서 누락된다. `GAMES` 등록과 **둘 다** 해야 한다.
3. 라우트는 워커 공용이고 puzzle 전용은 `/_puzzletotal` 뿐이다 —
   `/_records`(`_infra/worker.js:1276`), `/_puzzletotal`(`:1304`),
   `/_like`(`:1334`), `/_personal`(`:1363`). 방문자 id(`vid`)는 서버가 쿠키에서
   붙이고 클라이언트가 보낸 값은 지운다(`:1289`). POST 는 분당 10회(`:1296-1298`).
4. 퍼블릭 서브도메인이라 `www/index.html` 에 카드가 있어야 빌드가 통과한다
   (`www/index.html:95`, 검사는 `_infra/build.mjs` 의 랜딩 카드 링크 검사 블록).
5. `wrangler.jsonc` 에 puzzle 전용 var·바인딩·크론은 없다. 기록 저장소는
   `RECORDS` DO(`RecordsDO`, `idFromName("global")`) 하나를 slop 과 공유한다
   (`wrangler.jsonc:76`) — 그래서 스코프 분리(2번)가 중요하다.
6. 홈 카드 목록은 빌드가 자동 생성한다 — 파일 속 **첫 이모지**가 카드 아이콘
   (`_infra/build.mjs` 의 `toyEmoji`), **`<title>` 이 랜딩 검색어**(`toyTitle`),
   `hall-of-fame` 은 카드 대신 맨 위 금색 배너로 고정(`hofCard`).

## 테스트

- 전체: `npm test`. puzzle 을 덮는 것만: `node --test _infra/records.test.mjs _infra/podium.test.mjs`
  - `_infra/records.test.mjs:23` 주 경계, `:204-220` `scope=puzzle` 분리
    (slop 보드에 puzzle 게임이 안 섞이는지), `:304` `GAMES` 미등록 제출 400.
  - `_infra/podium.test.mjs:85-89` slop 명예의 전당이 `alltime=1&scope=slop`
    으로만 집계하는지 — puzzle 기록이 slop 관왕 수를 오염시키지 않게 하는 가드.
  - `_infra/` 에 puzzle 게임 로직 단위 테스트는 **없다** — 생성기 풀이 보장은
    각 `index.html` 안의 자체 검증(솔버·헤드리스 시뮬)에 의존한다.
- 스모크: `npm run test:e2e`. puzzle 화면은 `{ name: "puzzle 홈", path: "/puzzle/" }`
  한 장뿐이고 개별 게임은 대상이 아니다(`_infra/e2e/smoke.spec.mjs:12`, 파일 상단에
  "여기서 늘리지 않는다"). 이것만: `npx playwright test -g "puzzle 홈"` — 컨테이너에
  크로미움이 있으면 앞에 `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- 라이브: `make verify`. 관련 프로브는 `site:puzzle`(첫 화면 — 폴더 목록에서
  자동 생성, `_infra/verify-prod.mjs:26-32,291-295`)과 `api:records`(공용 기록
  라우트 + "미등록 게임 400" 계약, `:350-361`). 하나만 돌리려면
  `bash scripts/verify-prod.sh --only site:puzzle`. **puzzle 전용 기록 프로브는
  없다** — `api:records` 는 slop 의 `fruitmerge` 로 찌른다.

## 새 게임 한 장 추가할 때 (실제로 지켜지는 관례만)

- `puzzle/<이름>/index.html` 단일 바닐라 파일, `<html lang="ko">`, 파일 안에 이모지 하나.
- `<title>` 은 한국어 — 기존 관례는 `제목 — 광고에서 본 그 게임`
  (`puzzle/watersort/index.html:6`).
- `</body>` 직전 3줄 `/_shared/records.js`·`/_shared/share.js`·`/_shared/like.js`
  (`puzzle/watersort/index.html:315-317`). like.js 는 puzzle 양산 규칙이라 9종 전부 단다.
- 클리어마다 `window.blWeeklyReport?.(stage)` (`puzzle/watersort/index.html:287`),
  그리고 `window.blShareText`·`window.blWeekly` 선언.
- 마지막으로 `_infra/records.js` 의 `GAMES` + `PUZZLE_GAMES` 등록 → `npm test`.
