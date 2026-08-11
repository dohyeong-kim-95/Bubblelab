# assets 서브도메인 — 에이전트 메모

assets.bubblelab.dev = 스티커·배경화면·음악·포토프레임 **카탈로그 UI**. 토이가 아니라
카탈로그라 share.js·주간기록 관례를 쓰지 않는다(`assets/`에 `blShareText`·`blWeekly`가
없다). 공통 규칙은 루트 `CLAUDE.md`.

**소유 범위** = `_infra/agent-scope.conf`의 `assets:` 줄 **+ 훅 기본 이름 규칙**
(`_infra/agent-hooks/pre-commit:53-54`가 `_infra/<sub>.*`·`_infra/<sub>-*`를 자동 허용
— conf에 없는 `_infra/assets.js`·`assets-store.*`가 소유인 이유). 합치면 `assets/`,
`_assets/`, `_infra/{assets,assets-store,asset-flags,downloads,devices,wallpaper,sticker-pack,png,apng,gif}.*`.
`_infra/home-button.test.mjs`는 **공용**이라 못 건드린다(배경화면 상세페이지 검사가 거기 있다 — 고쳐야 하면 오케스트레이터에게).

## 로케일 — ko-KR / KST

- 화면 언어는 한국어 고정 — 모든 페이지가 `<html lang="ko">`에 제목·본문·버튼 전부
  한국어다. `assets/*/index.html`을 새로 만들면 같게 맞춘다.
- **이 서브도메인 화면에는 시각 표시가 없다.** 날짜는 metadata의 `createdAt`
  (`YYYY-MM-DD`) 하나뿐이고 목록 정렬 키로만 쓰인다.
- 숫자·검색은 화면 쪽 — `new Intl.NumberFormat("ko-KR")`(`assets/catalog.js:14`),
  `toLocaleLowerCase("ko")`(`assets/catalog.js:117,119`). 카탈로그 정렬만 빌드 쪽 —
  `localeCompare(…, "ko")`(`_infra/assets.js:104`).
- ⚠️ 그 `createdAt`의 CLI 기본값이 `new Date().toISOString().slice(0, 10)` = **UTC
  날짜**다(`_infra/wallpaper.mjs:263`, `_infra/sticker-pack.mjs:338`). KST 00~09시에
  등록하면 전날 날짜가 박히고 정렬이 `createdAt` 내림차순 우선이라 목록 순서가
  밀린다. 덮어쓸 CLI 플래그가 없으니 그 시간대면 metadata.json을 손으로 고친다.

## 표기 규칙

- 다운로드 횟수: `총 N회` / `N회 다운로드` — 천단위 구분은 위 ko-KR 포매터.
- 해상도: 곱셈기호 `×`(U+00D7), `1290×2796` 형식 — 조립은 `assets/item.js:148`과
  `_infra/wallpaper.mjs:229`(라벨 `모바일 1290×2796`) 두 곳뿐. `x`·`*` 금지. **기종 표
  (`assets/devices.js`)는 문자열이 아니라 `{ label, width, height }` 정수 필드**라, 한 줄
  추가할 때 해상도를 문자열로 쓰지 않는다(`_infra/devices.test.mjs`가 120–8000 정수 검사).
- 파일 크기는 **화면에 안 나온다** — `_infra/wallpaper.mjs:320`(`formatSize`)의 CLI 로그만
  `12.34MB`(MiB 기준, 소수 2자리)로 찍는다. 돈·통화 표기는 이 서브도메인에 없다.

## 배포 (Workers)

배포는 언제나 `make ship`. 아래는 assets 고유분만.

- `wrangler.jsonc`: **assets 전용 `ENABLE_*` var·R2·cron이 없다** — fail-closed 스위치가
  없으니 내리려면 파일을 지우거나 admin 토글을 쓴다. DO는 `ASSET_FLAGS`
  (class `AssetFlagsDO`, migration `v14`) 하나, 집계는 공용 `ANALYTICS`, 하루 1회 제한은
  공용 `RATE_LIMITER` — 셋 다 `_infra/worker.js`의 `HEALTH_BINDINGS`에 있어 `/_health`로 본다.
- `_infra/worker.js` 라우트
  - `GET /_download/<cat>/<id>/<file>` → `_infra/downloads.js`. 카테고리 화이트리스트
    (sticker·wallpaper·photo-frame·music) + 평면 파일명만. 같은 IP·같은 파일은 24시간
    1회만 집계하고, 집계가 실패해도 파일은 내려준다.
  - `GET /_asset-downloads` → 누적 카운터(분당 60회 제한).
  - `GET /_assets/catalog.json` → 워커가 `asset-flags.js`로 숨긴 항목을 걸러 내보낸다
    (`run_worker_first`라 정적 파일로 우회 불가).
  - `/_assets/upload/*`, admin `/api/assets` → 항상 404 (R2 업로드 경로 비활성).
  - admin `/api/stickers` → 팩 공개 토글. **스티커만** 가능(`FLAGGABLE_CATEGORIES`)
    — 배경화면은 빌드가 상세페이지를 굽기 때문에 제외.
- `_infra/build.mjs`가 자동 생성 — 손으로 만들지 말 것: `dist/_assets/catalog.json`(모든
  metadata.json 병합), `/assets/wallpaper/<id>/` 상세페이지(`wallpaperPage`), `/assets/`
  홈(`assets/index.html`이 없어서 카드 목록이 생성된다), 홈 버튼 주입.
- 등록 CLI: `node _infra/sticker-pack.mjs`(4x4 시트 → 팩), `node _infra/wallpaper.mjs`
  (이미지 → 규격별). 사용법은 루트 `CLAUDE.md`. JPEG 입력은 `jpeg-js` 의존성이라
  `npm ci`가 먼저 필요하다. 같은 id가 있으면 **둘 다 거부**하고 `--force`로만
  덮어쓰며(`wallpaper.mjs:215`, `sticker-pack.mjs:289`), 그때 `wallpaper.mjs:238-243`이
  새 규격 목록 밖 파일을 `rmSync(recursive)`로 지운다 — 손으로 넣어 둔 파일 주의.
- 라이브 확인: `bash scripts/verify-prod.sh --only api:catalog`(카탈로그 형태),
  `--only api:downloads`(집계 형태), `--only gate:closed`(업로드 경로 404 계약).

## 테스트

```bash
node --test _infra/assets.test.mjs _infra/assets-store.test.mjs \
  _infra/asset-flags.test.mjs _infra/downloads.test.mjs _infra/devices.test.mjs \
  _infra/wallpaper.test.mjs _infra/sticker-pack.test.mjs _infra/gif.test.mjs
node --test _infra/home-button.test.mjs   # 빌드 산출물(배경화면 상세페이지) 검사
npm run test:e2e                          # 빌드(= 카탈로그 검증) + 모바일 스모크
```

스모크(`_infra/e2e/smoke.spec.mjs`의 `SCREENS`)가 보는 화면은 `/assets/`,
`/assets/wallpaper/`, `/assets/wallpaper/stars-bootes/` 셋 — 마지막은 **실제 항목 id에
묶여 있어** 그 배경화면을 지우거나 이름을 바꾸면 깨진다.

## 함정

- **상세페이지 안 링크는 상대경로.** 실서비스 URL(`assets.bubblelab.dev/wallpaper/<id>/`)에는
  `/assets` 세그먼트가 없어(워커가 내부에서 붙인다) `/assets/…` 절대경로는 로컬만 되고
  라이브에서 404. `/_shared/*`·`/_assets/*`·`/_download/*`는 예외.
- 숨김(`active:false`·admin 토글)은 **목록에서만** 빼는 것 — 주소를 아는 사람은 그대로 받는다. 완전히 내리려면 파일을 지우고 배포한다.
- 페이지 `<title>`이 영문(`✨ Sticker · Bubblelab Assets`)이라 랜딩 한국어 검색은
  `_shared/search-rules.js`의 `SYNONYMS`(배경화면/스티커 줄)에 기댄다 — 카테고리를
  새로 추가하면 거기 한 줄을 같이 늘려야 검색된다.
- `photo-frame`은 `util/photo`가 카탈로그에서 직접 읽어 쓴다 — 다운로드 중 `.json`으로 끝나는 첫 파일을 프레임 정의로 삼으므로 `frame.json`을 꼭 넣는다.
- 스티커 팩 장수·`util/chat` 등록(`_infra/chat.js`의 `CHAT_STICKER_PACKS`)은 CLI가 맞춘다. 손으로 팩을 넣었다면 `_infra/sticker-pack.test.mjs`가 불일치를 잡는다.
