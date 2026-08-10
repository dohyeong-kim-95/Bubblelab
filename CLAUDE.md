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
node _infra/build.mjs        # 빌드 (dist/ 생성, 에러 없어야 함)
npm run test:e2e             # 핵심 화면 모바일 스모크 (빌드 후 Playwright)
npx wrangler@4 dev --local --local-upstream localhost   # 로컬 서빙
# http://localhost:8787/slop/이름  (첫 경로 세그먼트 = 서브도메인)
```

`--local-upstream localhost` 필수. 배포 결과는 GitHub Actions run의
conclusion으로 확인한다.

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

## 둘만의 기록 (duri/)

`duri/`도 토이가 아니라 두 사람만 쓰는 비공개 서비스다 — 토이 관례(share.js, 주간
기록)를 적용하지 않고, 랜딩·풀다운에도 노출되지 않는다(`CONFIDENTIAL_SUBDOMAINS`).
대화·사진·공유 캘린더를 공유 패스프레이즈로 **E2E 암호화**해서 주고받고, 엣지는
암호블롭만 중계·버퍼링한다: `_infra/duri.js`(DuriDO + R2), 게이트·라우팅은
`_infra/worker.js`(`bl_duri` 쿠키·`DURI_PASSWORD`), `ENABLE_DURI` var는 fail-closed.
**원본은 각자 PC** — 배포에서 제외되는 `_src/duri-sink/` 데몬이 디스크에 쓰고 ack
하면 서버가 그 항목을 버린다. 화면은 [채팅 | 캘린더 | 지도] 세 장을 좌우 실시간
드래그 스와이프로 넘긴다(지도는 사진 위치로 시군구를 색칠 — 커밋된
`duri/data/kr-sgg.geojson`만 쓰고 외부 지도 API는 없다). 셋업·프로토콜·한계는
`duri/README.md` 참고.

## 더 읽을 것 (필요할 때만)

- 배포/워커/빌드 파이프라인 내부: `_infra/README.md`
- 아발론 이력·재빌드: `_src/avalon/MIGRATION.md`
- 사람용 전체 안내: `README.md`
