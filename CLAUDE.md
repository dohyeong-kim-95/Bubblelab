# bubblelab 모노레포 — 에이전트 온보딩

이 파일만 읽으면 작업 시작에 충분하다. **리포 전체를 탐색하지 말 것.**
특정 폴더를 수정할 때만 그 폴더의 README.md를 추가로 읽어라.

## 핵심 규칙

- **루트 폴더 = 서브도메인**: `slop/` → slop.bubblelab.dev, `games/` →
  games.bubblelab.dev, `www/` → bubblelab.dev(apex). 새 폴더 = 새 서브도메인.
  퍼블릭 서브도메인은 `www/index.html` 랜딩에 카드 추가 필수(빌드가 검사),
  비공개는 `_infra/build.mjs`의 `CONFIDENTIAL_SUBDOMAINS`에 등록(랜딩·풀다운
  미노출, 직접 주소로만 접근).
- `_`나 `.`로 시작하는 폴더는 배포되지 않는다 (`_infra`, `_src`, `_shared`는
  각각 인프라, 빌드 소스, 공용 에셋).
- 토이 하나 = 폴더 하나 (`slop/이름/index.html`). 의존성·빌드 도구 없는
  바닐라 HTML이 기본. 카테고리 홈의 카드 목록은 자동 생성된다.
- **`games/avalon/`은 빌드 산출물 — 직접 수정 금지.** 소스는 `_src/avalon/`,
  수정 후 `_src/avalon/rebuild.sh` 실행해서 산출물을 갱신·커밋한다.
- main에 push하면 GitHub Actions가 자동 배포한다 (~1분). PR 불필요,
  main에서 직접 작업한다.
- **명시적인 요청이 없으면 자기 서브도메인 밖은 add하지 않는다.** `git add -A`·
  `git add .` 금지. 여러 사람·여러 에이전트 세션이 같은 작업 트리를 동시에 쓴다 —
  `invest`를 고치는 중이면 `invest/`와 그에 딸린 파일(`_infra/invest.js`,
  `_src/invest-sink/`)만 add하고, 함께 바뀌어 있는 `duri/`·`estate/`는 남의
  작업이니 그대로 둔다(실제로 휩쓸려 나간 적이 있다). 커밋 전 `git status
  --short`로 확인한다. 이미 푸시된 이력은 혼자 다시 쓰지 말고 사용자에게 알린다.

## 잠들어 있는 화면

`espanol`, `estate`, `invest`, `trip`, `util/planner` 는 **내려 둔 상태**다. 목록은
`_infra/dormant.js` 한 곳에 있고, 워커가 404 로 답하며 빌드가 아예 배포하지 않는다.
`ENABLE_INVEST`·`ENABLE_TRIP_WATCH`·`ENABLE_PLANNER` 는 `"false"`, trip 가격 수집
cron 도 빼 뒀다.

**코드와 Durable Object 데이터는 그대로 있다.** 바인딩과 migrations 를 지우면
invest 잔고 이력과 trip 가격 관측이 사라지고 되살릴 방법이 없으니 건드리지 말 것.
하나씩 필요해질 때 `dormant.js` 에서 한 줄 지우고 해당 플래그를 되돌리면 살아난다
(되살릴 항목은 그 파일에 적혀 있다).

`espanol`(영화로 스페인어) 은 서버도 DO 도 쓰지 않아 폴더만 그대로 남아 있다.
스페인어는 **`life/espanol/`(노래로 스페인어)** 로 자리를 옮겼다 — 목적도 방식도
다른 별개의 도구이고, 옛 폴더에서 옮겨온 코드는 없다.

아래 문서에 남아 있는 trip·estate·invest 설명은 되살릴 때를 위한 것이다.

## 토이 작성 관례

- 파일 안에 이모지 하나 (카드 아이콘으로 자동 추출됨)
- `<title>`은 랜딩(bubblelab.dev) 검색어로 그대로 쓰인다 — **한국어로** 짓는다
  (폴더 이름은 영문이라 이것 말고는 한국어로 찾을 방법이 없다). 따로 등록할 곳은
  없고, 제목에 없는 말로도 찾게 하려면 `_shared/search-rules.js`의 `SYNONYMS`만
  한 줄 늘린다.
- `</body>` 직전에 `<script defer src="/_shared/share.js"></script>` (공유 버튼)
- 기록 자랑 문구: `window.blShareText = () => "내 기록은 X! 도전해보세요";`
- 주간 신기록 보드(월요일 09시 KST 초기화): `window.blWeekly = { game: "이름",
  dir: "min|max", fmt: v => … }` 선언 + `<script defer
  src="/_shared/records.js"></script>` 추가 후, 기록이 나올 때마다
  `window.blWeeklyReport?.(점수)` 호출. **추가로 `_infra/records.js`의
  `GAMES`에 dir·점수 범위 한 줄 등록** (서버가 방향·범위를 고정한다 —
  미등록 게임의 제출은 거절됨).
- 다크모드: `:root { color-scheme: light dark; }` + `light-dark()` 함수
- 언어는 한국어, 스타일은 ui-monospace 계열의 가벼운 느낌

## 검증 방법

```bash
npm test                     # 인프라 단위 테스트
make lint                    # 문법 검사 (js/mjs/json/sh) — eslint 없음, 파싱만 본다
node _infra/build.mjs        # 빌드 (dist/ 생성, 에러 없어야 함)
npm run test:e2e             # 핵심 화면 모바일 스모크 (빌드 후 Playwright)
npx wrangler@4 dev --local --local-upstream localhost   # 로컬 서빙
# http://localhost:8787/slop/이름  (첫 경로 세그먼트 = 서브도메인)
```

`--local-upstream localhost` 필수.

**커밋 훅이 알아서 돈다.** `_infra/agent-hooks/pre-commit` 이 스테이지된 파일에
린트를 돌리고, 코드가 하나라도 끼면 `npm test`(빌드 검사 포함)까지 돌린다 —
문서만 바뀐 커밋은 건너뛴다. 급하면 `SKIP_HOOKS=1 git commit`. 새로 클론했으면
한 번 켜 준다: `git config core.hooksPath _infra/agent-hooks`.

## 배포는 `make ship` 으로

**맨 `git push` 로 배포하지 않는다.** 로컬에서 통과한 코드가 프로덕션·실기기에서
깨지는 게 이 리포의 가장 흔한 사고였다(빈 스냅샷 덮어쓰기, 바인딩 누락 등).

```bash
make ship     # 테스트 → 빌드 → push → Actions 완료 대기 → 라이브 검증 → 실패 시 롤백
make verify   # 지금 라이브만 읽기 전용으로 검사 (배포 없이)
```

에이전트에게는 슬래시 하나로 시킨다: **`/ship`** (`.claude/commands/ship.md`) —
절차·옵션·실패 대처가 거기 적혀 있다. 절차를 대화에서 재구성하지 말 것.

- 배포는 push → Actions, 그래서 **롤백은 revert push** 다(`scripts/ship.sh`가
  직전에 서빙 중이던 커밋까지 자동으로 되돌리고 재검증한다). 되돌리지 않고
  직접 판단하려면 `SHIP_ROLLBACK=0 make ship`.
- 검증은 `scripts/verify-prod.sh`(구현은 `_infra/verify-prod.mjs`). 서브도메인
  첫 화면·공개 API·DO·WebSocket·게이트를 실제로 찔러 **상태코드가 아니라 응답
  형태**를 본다. 새 서브도메인 폴더는 자동으로 프로브가 생긴다.
- **검증은 프로덕션에 쓰지 않는다.** 검증 페이로드를 저장소에 넣는 방식은
  금지 — 예전에 그날 잔고 스냅샷을 빈 값으로 덮어써서 복구해야 했다. 쓰기
  경로는 "지금 저장된 값이 비어 있지 않은지" 읽어서 검사한다(InvestDO 는
  빈 스냅샷 덮어쓰기를 409로 거부한다).
- 인증 게이트 뒤(invest·duri·admin)는 자격증명이 있을 때만 들어가고, 없으면
  게이트가 막는지까지만 확인하고 SKIP 한다 — 거짓 실패를 만들지 않는다.
  자격증명은 `.verify.env`(커밋되지 않음)나 환경변수로 준다:
  `BL_ADMIN_ID` `BL_ADMIN_PASSWORD` `BL_INVEST_PASSWORD` `BL_DURI_PASSWORD`.
- 배포 신원은 `/_health` — 빌드가 구운 커밋 SHA·바인딩·기능 플래그를 돌려준다.
  `make ship` 은 이 값이 방금 올린 커밋이 될 때까지 기다린 뒤 검증한다(옛 배포를
  검사하고 통과했다고 착각하지 않게).
- 상류 API(날씨)나 집 PC 데몬(잔고·듀리 싱크)처럼 우리 배포 밖의 문제는 실패가
  아니라 **경고**다 — 그것 때문에 배포를 되돌리지 않는다.

배포 결과는 Actions run의 conclusion과 `make verify` 두 가지로 확인한다.

스모크 테스트는 화면이 깨지는 세 가지(스크립트 예외·가로 넘침·빈 화면)만 본다 —
대상 화면은 `_infra/e2e/smoke.spec.mjs`의 `SCREENS`. 컨테이너에 크로미움이 이미
있으면 `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`을 앞에 붙인다.

아발론을 고쳤으면 `_src/avalon/rebuild.sh` 실행 후 산출물까지 커밋해야 한다 —
Deploy·CI가 `_infra/check-avalon-sync.mjs`로 `games/avalon`이 소스 빌드와
같은지 확인하고, 다르면 배포가 멈춘다.

## 멀티플레이어가 필요하면

자체 실시간 서버(Durable Object)가 `/_rt/<이름>` 에 있다 (Firebase RTDB
서브셋: 경로 트리 + 구독 + onDisconnect). 클라이언트 어댑터 예시는
`_src/avalon/src/firebase.js` — 복사해서 시작하면 된다. 외부 서비스를
추가하지 말 것.

익명 채팅(`util/chat`)은 별도의 전용 DO를 쓴다: `_infra/chat.js`의
`ChatDO`(`/_chat` WebSocket, 단일 로비, 메시지 미저장 브로드캐스트).
정원(기본 10명)은 admin 페이지 💬 Chat에서 조정, `ENABLE_CHAT`
var(fail-closed)로 전체 차단 가능.

## 스티커 팩 추가 (원샷)

4x4 그리드 시트 이미지를 받으면: ① 시트를 **한 번만** 보고 셀 순서(좌→우,
위→아래)대로 라벨 16줄을 `labels.txt`에 작성 ② 아래 한 명령 실행 ③ 테스트·빌드로
검증. 개별 셀 이미지를 따로 볼 필요 없고, 다른 파일을 수동 편집하지 않는다.

```bash
node _infra/sticker-pack.mjs 시트.png <팩id> --title "제목 16종" \
  --labels labels.txt --chat "짧은제목" --tags "태그,태그"
```

시트는 PNG·JPEG 모두 받는다(매직 바이트 자동 판별 — PNG는 `_infra/png.mjs`
자체 코덱, JPEG는 jpeg-js 의존성이라 `npm ci` 필요). 슬라이스·트리밍·preview·
metadata.json·`CHAT_STICKER_PACKS` 등록·스티커 README 표까지 자동 갱신된다.
누끼는 생성 시점에 처리·검증된다(산출 PNG의 배경 투명 여부가 기준 — CLI가
셀별로 자동 확인하므로 클라이언트 표시를 따로 검증할 필요 없음).
util/chat 클라이언트는 `catalog.json`의 `chat.title` 팩을 자동으로 읽으므로
손댈 곳 없음. 등록 누락·장수 불일치는 `_infra/sticker-pack.test.mjs`가 잡는다.

팩의 **공개 여부는 admin ✨ Sticker 화면에서** 재배포 없이 토글한다
(`_infra/asset-flags.js`의 `AssetFlagsDO`, 기본값은 metadata의 `active`).
목록에서만 빼는 것이라 파일은 주소를 알면 받을 수 있다 — 완전히 내리려면 팩을
지우고 배포한다.

## 배경화면 추가 (원샷)

세션에 이미지가 올라오면 그 경로를 그대로 넘긴다. 규격별 잘라내기·preview·
metadata.json·`_assets/wallpaper/README.md` 표까지 한 번에 갱신된다.

```bash
node _infra/wallpaper.mjs 이미지.png <id> --title "제목" \
  --sizes mobile,desktop --tags "태그,태그"
```

`--sizes`는 `mobile`(1290×2796)·`tablet`·`desktop`(2560×1440)·`wide`·`square`·
`original` 중에서 고른다(기본 `mobile,desktop`). **세로 원본에 가로 규격을
같이 넣지 말 것** — 가운데 가로 띠만 남아 그림이 망가진다. 잘라내기는
채우기(cover), 남길 쪽은 `--focus top|bottom|left|right`. **확대는 하지 않는다**
— 원본이 규격보다 작으면 비율만 맞춘 원본 해상도로 저장하고 라벨에 실제 크기가
들어간다(CLI가 경고로 알려주니 그때 원본을 더 큰 걸로 받으면 된다).
`--format`은 사진이면 `jpg`(기본), util/stars 출력처럼 어두운 그라데이션·가는
선·작은 글씨가 있는 생성 그래픽이면 `png`(무손실, 3–4배 큼). 출력은 항상
재인코딩이라 EXIF(위치·기기)는 자동으로 지워진다. 디코더는 스티커와 같아
PNG·JPEG를 모두 받고, JPEG는 `npm ci` 필요. 검증은 `_infra/wallpaper.test.mjs`.

항목마다 `/assets/wallpaper/<id>/` 상세페이지가 빌드에서 자동 생성된다
(`build.mjs`의 `wallpaperPage` + `assets/item.js`) — 썸네일 갤러리(원본·케이스
목업), 기종을 골라 잘라 저장(캔버스), 폰 케이스 목업. 기종 목록은
`assets/devices.js`에 한 줄씩 손으로 관리한다. 잘라내기 계산은 CLI와 클라이언트가
`_shared/crop.js` 하나를 같이 쓴다. **확대 정책은 둘이 다르다** — CLI는 없는
해상도를 카탈로그에 광고하지 않으려고 확대하지 않고, 상세페이지는 방문자가 고른
기종 해상도로 늘려서라도 내보낸다(몇 배 늘렸는지 화면에 표시). 빌드 산출물 검사는 `_infra/home-button.test.mjs`
한 곳에 모아 둔다(테스트가 병렬이라 dist를 두 번 빌드하면 경합한다).

## 데일리 팟캐스트 (podcast/)

`podcast/`는 토이가 아니라 초대 코드 기반 서비스다 — 토이 관례(share.js,
주간 기록)를 적용하지 않는다. 서버는 `_infra/podcast.js`(PodcastDO +
`/_podcast/*` 라우트), AI 호출은 `_infra/podcast-ai.js` 프로바이더 계층
(env로 모델·업체 교체). `ENABLE_PODCAST` var는 fail-closed. 셋업·운영은
`podcast/README.md` 참고.

## 할 일 (life/)

`life/`는 목록 여러 개를 좌우로 넘기며 쓰는 할 일 PWA다(`CONFIDENTIAL_SUBDOMAINS`).
토이 관례(share.js, 주간 기록)를 적용하지 않는다.

할 일 밖의 도구는 `life/<이름>/` 폴더 하나가 전부다(서재·팔굽혀펴기·돌아보기·백업,
그리고 **`life/espanol/` — 노래로 스페인어**. 가사를 안 보고 알아듣고 따라 부르는
연습장이고, 소리 엔진·저작권 선은 `life/espanol/README.md` 에 적혀 있다).
**`life/budget/`(가계부)** 는 카드 한 장의 소비를 한 주기 한도(기본 100만원)와 견준다 —
합계보다 "오늘까지의 기준선"과 "남은 날에 하루 얼마"가 먼저 나온다. 주기 긋기·페이스
계산은 `life/budget/store.js` 한 곳이다(`life/budget/README.md`). 카드 승인 문자를
읽어 담는 파서는 `life/budget/sms.js` — 공유 시트(매니페스트의 `share_target`)·
붙여넣기·문자 백업 XML 셋 다 이 한 파서로 들어온다.
**`life/kcal/`(칼로리)** 는 하루 섭취와 탄단지를 끼니별로 적고, 운동으로 태운 것까지
센다(인아웃 벤치마크. 소모는 MET × 몸무게 × 시간).
목표는 몸 정보(Mifflin-St Jeor)로 계산하고 직접 덮어쓸 수 있으며, 규칙은
`life/kcal/store.js` 한 곳이다. 음식표(`life/kcal/foods.js`)는 **사람이 채우는 표**라
손으로 고치지 말고 `node _infra/kcal-food.mjs` 로 넣는다(`life/kcal/README.md`).
**`life/dram/`(DRAM 동작)** 은 다른 것들과 성격이 다르다 — 기록이 아니라 **공부용
시뮬레이터**다. 뱅크를 고르고 커맨드를 누르면 낼 수 있는 가장 빠른 클럭까지 시계가
밀리고 무엇이 밀었는지(tRCD·tFAW·커맨드 버스…)를 타임라인에 남긴다. 판정은
`life/dram/engine.js` 순수 함수 한 곳이고, 커맨드·파라미터·규칙 세 표는 세대별로
`life/dram/spec/*.js` 에 있다. **미공개 세대(DDR6·LPDDR6)는 값을 지어내지 않고
빈 껍데기로 두고 화면이 못 여는 이유를 말한다** — 값은 공개 자료 기준 대표값이라
`verify` 가 붙은 것은 스펙과 대조가 필요하다(`life/dram/README.md`).

**서버에 아무것도 저장하지 않는다** — 할 일은 브라우저 localStorage 에만 있고, 워커는
비밀번호 게이트(`bl_life` 쿠키·`LIFE_PASSWORD`)만 담당한다. `/_life/*` API 는 없다.
`ENABLE_LIFE` var는 fail-closed. 상태 규칙은 `life/store.js` 한 곳, 좌우 이동은 CSS
scroll-snap 이다. 자세한 것은 `life/README.md`.

## 둘만의 기록 (duri/)

`duri/`도 토이가 아니라 두 사람만 쓰는 비공개 서비스다 — 토이 관례(share.js, 주간
기록)를 적용하지 않고, 랜딩·풀다운에도 노출되지 않는다(`CONFIDENTIAL_SUBDOMAINS`).
대화·사진·공유 캘린더를 공유 패스프레이즈로 **E2E 암호화**해서 주고받고, 엣지는
암호블롭만 중계·버퍼링한다: `_infra/duri.js`(DuriDO + R2), 게이트·라우팅은
`_infra/worker.js`(`bl_duri` 쿠키·`DURI_PASSWORD`), `ENABLE_DURI` var는 fail-closed.
**원본은 각자 PC** — 배포에서 제외되는 `_src/duri-sink/` 데몬이 디스크에 쓰고 ack
하면 서버가 그 항목을 버린다(대화·사진·캘린더 모두. `bash install.sh` 한 줄로
설치하고 토큰은 앱의 ⚙️ → 💾 PC 백업 설정에서 발급받는다). 화면은 [채팅 | 캘린더 | 지도] 세 장을 좌우 실시간
드래그 스와이프로 넘긴다(지도는 사진 위치를 색칠한다 — 우측 상단 버튼으로
**한국편(시군구) ↔ 세계편(나라)** 을 토글하고, 커밋된 `duri/data/*.geojson`만 쓰며
외부 지도 API는 없다). 헤더의 ✓·💪 는 **데이트 버킷리스트**와 **운동 인증**(둘이
하루 한 번 체크하는 달력)이고, 둘 다 캘린더와 같은 `cal:` 저장소에 얹혀 있다 —
서버는 E2E라 `kind` 를 못 보고 상한(2000)을 일정과 합쳐 세므로, 날마다 쌓이는
기록은 **사람당 한 달 한 건**으로 묶는다(`duri/README.md`). 셋업·프로토콜·한계는
`duri/README.md` 참고.

## 여행 계획·예산 (trip/) — 잠들어 있음

`trip/`은 혼자 쓰는 여행 계획·예산 화면이다(`CONFIDENTIAL_SUBDOMAINS`, 랜딩·풀다운·
검색 미노출). 토이 관례(share.js, 주간 기록)를 적용하지 않는다. **로그인은 없고**
estate·lab처럼 주소를 아는 사람은 들어온다 — 워커가 `no-store`·noindex를 붙이고
방문 집계에서 뺀다.

화면은 **계획 / 실행** 두 장이고 저장 경계가 다르다. **실행**(일정표·예산)은 브라우저
localStorage에만 있고 서버로 가지 않는다(내보내기/가져오기 JSON이 유일한 백업).
**계획**(여행 후보와 가격 관측)만 서버에 쌓인다 — 일정·예산·메모는 올라가지 않는다.
이 경계를 흐리지 말 것.

- 일정·예산 계산은 `trip/budget.js` 한 모듈에 모은다(화면과 `_infra/trip.test.mjs`가
  같이 쓴다 — 합계를 화면 안에서 따로 더하지 말 것).
- **관측 대상의 상위 개념은 여행지다**(`DestinationWatch`) — "몽골"이 여행지고
  ICN→UBN 은 그걸 실현하는 노선 중 하나다. 기간·박수·인원은 여행지에 있고 격자·관측은
  노선(`flights[]`)마다 붙는다. 패키지(`packages[]`)는 모델만 있고 수집기는 없다.
- 가격 관측은 `_infra/trip-watch.js`(TripWatchDO)+`_infra/trip-flights.js`(프로바이더
  계층: amadeus·sink·mock). cron `20 */6 * * *`이 오래 안 본 조합부터 조금씩만
  갱신한다 — 한 번에 그리드 전체를 돌리면 상류 쿼터가 하루도 못 간다. 줄 세우는
  기준은 가격을 받은 시각이 아니라 **조회를 시도한 시각**이다(항공편 없는 날짜가
  큐 맨 앞에 영원히 남아 그리드 뒤쪽을 굶기는 사고가 있었다).
- **가격의 성격을 섞지 말 것.** 관측마다 `quality`(reference·live·verified)를 저장하고
  화면이 배지로 나눈다. "예매가(bookable)"라고 부르지 않는다 — 검색 결과 가격은 결제
  화면에서 바뀔 수 있다. Amadeus Self-Service는 종료돼 신규 키를 못 받으므로 평소
  경로는 집 PC 데몬(`sink`)이고, 자격증명이 없으면 `mock`(참고가)으로 돈다.
- **패키지는 표시가만 저장하지 말 것.** `listedPrice`와 `effectivePrice`(표시가 + 아는
  필수비용)를 나눠 두고, 금액을 모르는 항목은 0원으로 세지 말고 `unknownCosts`에
  이름만 남긴다(화면이 "추가비용 확인 필요"로 표시). 최저가 정렬도 실질가 기준이다.
  파서는 `node _infra/trip-package-parse.mjs 저장한페이지.html`로 실제 페이지에
  맞춰 교정한다 — 셀렉터를 짐작해서 넣지 않는다.
- `/_trip/*` 는 **읽기·쓰기 모두** admin 발급 토큰(`/api/trip/token`)을 요구한다 —
  응답에 여행지·기간·인원이 들어 있어 공개하면 여행 의향이 읽힌다. 데몬 push만 별도
  `TRIP_SINK_SECRET`. `ENABLE_TRIP_WATCH` var는 fail-closed.

자세한 것은 `trip/README.md`.

## 인사이트 아카이브 (lab/claude-insights)

`lab/`은 내가 쓰는 도구를 두는 비공개 서브도메인이다(`CONFIDENTIAL_SUBDOMAINS`,
랜딩 미노출). 그 안의 `claude-insights`는 Claude Code의 `/insights` 리포트를
한국어로 옮겨 날짜별로 쌓아 두는 화면이다 — 날짜 버튼으로 그날 리포트를 다시
읽고, 한국어/원문을 토글한다.

**발행은 `/insights`를 돌린 직후에만 가능하다** — 결과 JSON이 대화에 있어야 한다
(리포트 HTML에는 구조화된 데이터가 없다). 그다음 `/insights-publish`를 실행하면
번역·검증·발행까지 간다. 번역 규칙과 payload 형식은
`.claude/commands/insights-publish.md`, 화면·데이터 구조는 `lab/README.md`.

```bash
node _infra/insights-publish.mjs <payload.json> --report <원문.html>   # 덮어쓰기는 --force
```

**원문 HTML을 항상 같이 싣는다** — 번역본(JSON)에는 리포트의 수치 패널(도구
사용량·응답시간 분포·마찰 유형 등)이 없고 나중에 다시 계산할 수도 없다.
바이트 그대로 복사되고 화면의 📄 원문 리포트 버튼이 그걸 연다.

ko/en 구조가 어긋나거나(번역에서 항목 누락) 번역이 빠진 문장이 있으면 스크립트가
거절한다. `data/index.json`(날짜 목록)은 항상 자동 재생성이라 손대지 않는다.

## 병렬로 여러 에이전트를 돌린다면

서브도메인마다 격리된 worktree("레인")가 `../worktrees/<이름>` 에 있다. 같은
작업 트리를 공유하지 않으므로 남의 미커밋 변경이 커밋에 휩쓸릴 수 없다.

```bash
_infra/agent-worktree.sh init                      # 레인 전체 생성(멱등)
_infra/agent-worktree.sh task <서브도메인> <슬러그>  # agent/<서브도메인>/<슬러그> 브랜치로
```

`agent/<서브도메인>/…` 브랜치에서는 pre-commit 훅이 소유 밖 파일의 커밋을
거부한다(소유 목록은 `_infra/agent-scope.conf`). 구현 에이전트는 머지하지
않는다 — Gate 리뷰어(`docs/review-checklist.md`)가 통과시킨 브랜치만
오케스트레이터가 머지하고, 판정은 `docs/decisions.md` 에 남는다.
전체 흐름은 `docs/parallel-agents.md`.

## 더 읽을 것 (필요할 때만)

- 배포/워커/빌드 파이프라인 내부: `_infra/README.md`
- 아발론 이력·재빌드: `_src/avalon/MIGRATION.md`
- 사람용 전체 안내: `README.md`
