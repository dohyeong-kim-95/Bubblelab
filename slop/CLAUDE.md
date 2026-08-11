# slop — 에이전트 배경 메모

짧은 게임·토이 실험장(퍼블릭, slop.bubblelab.dev). 사람용 안내는 `slop/README.md`,
리포 전체 규칙은 루트 `CLAUDE.md` — 여기는 **slop 에만 해당하는 것**만 적는다.
(README·CLAUDE·AGENTS 는 빌드가 걸러내므로 배포되지 않는다 — `build.mjs`의 `AGENT_DOCS`)

## 새 토이 체크리스트 — `slop/<영문-이름>/index.html` 한 장, 바닐라

1. `<html lang="ko">`, 본문 한국어. 지금 slop 토이 23개가 전부 이렇다.
2. `<title>` 은 **한국어로**. 랜딩 검색 색인이 이 제목을 그대로 쓴다
   (`_infra/build.mjs` 의 `toyTitle()` — 검색어는 제목 전체, 카드 이름은 맨 앞
   이모지와 ` — 부제` 꼬리를 뗀 앞부분: "우드 스택 — 통나무 쌓기"). 제목에 없는
   말로도 찾게 하려면 `_shared/search-rules.js` 의 `SYNONYMS` 한 줄.
3. **파일의 첫 이모지가 카드 아이콘**이다(`toyEmoji()` — `Extended_Pictographic`
   첫 매치, 없으면 🫧). 보통 `<title>` 맨 앞에 둔다(`📈 20초 트레이더`). 이모지
   바로 뒤에 `+` 를 붙이면 카드에 작은 플러스 배지가 붙는다.
4. 다크모드는 `:root { color-scheme: light dark; }` + `light-dark()`.
5. `</body>` 직전에 `<script defer src="/_shared/share.js"></script>` 와
   `window.blShareText = () => "…";`(문자열도 가능, 없으면 링크만 공유).
   **`</body>` 가 없으면 공용 스크립트 주입이 통째로 건너뛴다**(`injectShared`).
6. 소리 토글 같은 유틸 버튼은 직접 배치하지 말고 우하단 공용 독(`_shared/dock.js`)에
   `(window.blDock = window.blDock || []).push({ id, icon, label, order, onClick })`
   로 등록한다. 홈 버튼은 빌드가 자동으로 넣는다.
7. 닉네임 외의 자유 입력은 서버에 보내지 않고, DOM 에는 `textContent` 로 넣는다.

## 주간 기록 보드 (기록형 토이)

선언·로드·보고 3줄이 한 세트다(`slop/touch25/index.html` — 선언:82 로드:157 보고:151):

```js
window.blWeekly = { game: "touch25", dir: "min", fmt: (v) => v.toFixed(2) + "초" };
// </body> 앞: <script defer src="/_shared/records.js"></script>
window.blWeeklyReport?.(score);   // 기록이 확정될 때마다. defer라 ?. 로 부른다
```

- **`_infra/records.js` 의 `GAMES` 에 한 줄 등록이 필수**다 —
  `touch25: { dir: "min", min: 0, max: 3600 }`. 서버가 방향·범위를 고정하고
  **미등록 게임의 제출은 400** 으로 거절된다(클라이언트가 보낸 dir 은 무시).
  키는 `/^[a-z0-9-]{1,32}$/`, 폴더 이름과 같게.
- 리셋 경계는 **월요일 09:00 KST = 월요일 00:00 UTC**. `weekKey()` 가 UTC 월요일
  날짜(`YYYY-MM-DD`)를 주차 키로 쓴다 — 토이에서 시간대 계산을 다시 하지 말 것.
  규칙이 바뀌어 점수 단위가 달라지면 **새 키를 판다**(picklock → lockrush).
- 주간 top3 와 브라우저별 올타임 개인 기록(`/_personal`) 두 갈래이고, 올타임
  명예의 전당은 `slop/hall-of-fame/` 이 `/_records?alltime=1&scope=slop` 로 읽는다.

## 숫자 표기

- 큰 점수는 `toLocaleString("ko-KR")` + 단위: `점`(2048·lockrush·fruitmerge),
  `m`(dino). 층수는 자릿수 구분 없이 `` `${v}층` ``(woodstack), 비율은 부호까지
  붙여 `(r*100).toFixed(2)+'%'`(trader).
- 짧은 시간은 밀리초 정수(`10sec`: `Math.round(s*1000).toLocaleString("ko-KR")+" ms"`),
  긴 시간은 초 소수 둘째 자리(`touch25`: `v.toFixed(2)+"초"`). 돈이 나오는 건
  `slop/trader` 하나 — `'₩' + Math.round(n).toLocaleString('ko-KR')`.
- `fmt` 결과는 표시용 `text` 로 저장되는데 `/^[^\x00-\x1f<>&"']{1,24}$/` 를 통과
  못 하면 숫자로 대체된다 — **24자 이내, `<>&"'` 금지**. 닉네임은 클라이언트·서버
  모두 `/^[가-힣a-zA-Z0-9]{1,6}$/`(`_infra/records.js` 의 `NICK`).

## 배포

`make ship`(또는 `/ship`) 하나로 끝, 절차는 `scripts/ship.sh` 에 있다. slop 고유:

- **카드 목록·홈 버튼은 빌드가 자동 생성**한다. 폴더를 만들면 slop 홈에 카드가
  생기고(기본 가나다순, 클라이언트가 인기순 재정렬), 카드 페이지마다
  `/_shared/home.js`·`dock.js`·`engagement.js` 가 주입된다. 등록할 목록은 없다.
- 퍼블릭이라 `www/index.html` 랜딩 카드가 **서브도메인 단위로** 이미 있다(토이마다
  추가할 필요 없다). 개별 토이를 홈·검색에서만 감추려면 `build.mjs` 의
  `UNLISTED_ENTRIES` — 지금 slop 항목은 없고, 직접 URL 은 계속 살아 있다.
- 라이브 검증 `_infra/verify-prod.mjs`(읽기 전용)의 slop 프로브는 `site:slop`
  (첫 화면 200·`<title>`·본문 길이)과 `api:records`(미등록 게임 400 확인).
- 커밋 범위(`_infra/agent-scope.conf`): `agent/slop/*` 가 소유하는 건 `slop/**` 와
  `_infra/animal-vs.test.mjs`·`_infra/podium.test.mjs` 뿐이다(`records.test.mjs` 는
  아니다). `records.js`·`www/index.html`·`search-rules.js` 는 공용 = 훅이 경고한다.

## 테스트

```bash
npm test                                 # 전체 (_infra/*.test.mjs)
node --test _infra/animal-vs.test.mjs    # animal-vs 데이터셋 + 토이 관례
node --test _infra/podium.test.mjs       # hall-of-fame 시상대 등수
node --test _infra/records.test.mjs      # 주간 보드 서버 (weekKey·top3·올타임)
node --test _infra/home-button.test.mjs  # 빌드 산출물·독 미사용 버튼 (스스로 빌드)
npm run test:e2e                         # 빌드 + Playwright 모바일 스모크
make serve                               # → http://localhost:8787/slop/<이름>
```

- `animal-vs.test.mjs` 는 인라인 데이터를 HTML 에서 발췌해 검증하면서 `GAMES` 등록,
  `blWeekly`/`blWeeklyReport`/`blShareText`, `records.js`·`share.js` 태그,
  `color-scheme`, 첫 이모지까지 확인한다 — **새 토이 테스트를 베낄 틀**.
- e2e 스모크(`_infra/e2e/smoke.spec.mjs`)의 slop 대상은 **`/slop/` 홈 한 장뿐**이다
  — 개별 토이는 여기서 늘리지 말고 단위 테스트로 덮는다.
