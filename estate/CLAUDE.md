# estate — 에이전트용 배경 메모

동탄구·기흥구 아파트 실거래 대시보드(비공개). 화면을 왜 그렇게 그리는지는
`estate/README.md`, 공통 규칙은 루트 `CLAUDE.md`. 여기엔 매번 다시 설명해야 했던
것만 적는다. 줄번호 뒤 이름이 진짜 앵커다 — 줄은 밀려도 이름으로 찾으면 된다.

## 로케일·시간

- `<html lang="ko">`(`index.html:2`), 화면 문구는 한국어. `<title>`만 이모지·영문
  폴더명이 섞인 `🏙️ estate — 동탄·기흥 아파트 실거래`(`index.html:7`).
- **월 경계는 항상 KST.** `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })`
  로 `YYYYMM`을 뽑는 헬퍼가 세 곳에 같은 모양으로 있는데 **이름이 하나만 다르다** —
  클라이언트·CLI는 `kstNowYm()`(`estate/index.html:334`, `_infra/estate-import.mjs:41`),
  워커는 **`kstYearMonth()`**(`_infra/estate.js:89`). `kstNowYm`으로만 grep하면 워커
  쪽을 놓치고 같은 함수를 또 만든다. Worker는 UTC로 도니 `new Date().getMonth()` 류로
  이번 달을 구하면 매월 1일 KST 09시 전까지 한 달 밀린다. "미래 월 거절"
  (`estate.js:103` `validateDealsQuery`)·"최근 두 달 6시간 캐시"(`:167`)도 같은 기준.
- **거래일은 파싱하지 않는다.** API의 `dealYear`/`Month`/`Day`를 그대로 `YYYY-MM-DD`
  문자열로 조립하고(`estate.js:38` `dealDate`) 화면은 `date.slice(2)` 같은 문자열
  자르기·비교만 쓴다 — `new Date(date)`로 바꾸면 UTC 해석으로 하루 밀린다.
- **데이터 신선도**는 화면에 안 뜬다 — `estate/data/index.json`의 `generatedAt`
  (`_infra/estate-import.mjs:105`)과 `ls estate/data/trade-dongtan-*.json | tail -1`.

## 금액·면적 표기

- 원천 단위는 **만원 정수**다 — `amt`·`dep`·`rent` 모두 그렇고 콤마만 뗀다
  (`_infra/estate.js:33` `num`, `:47` `parseTradeItem`). 원 단위 변환은 없다.
- 표시는 헬퍼 둘로 고정한다. **새 금액을 직접 포맷하지 말고 이걸 쓴다.**
  - `fmtMan(v)` — `Math.round` 후 `toLocaleString("ko-KR")` 천단위 콤마, 단위는
    호출부에서 붙인다: `…만`(`index.html:1027`), `…만/평`(`index.html:576-577`).
  - `fmtEok(man)` — 만원→억. **10억 이상은 소수 1자리, 미만은 2자리** + `억`
    (`index.html:360` `fmtEok`). 즉 `6.25억` / `12.4억`.
- 의도된 예외 둘: 지도 추천 핀 라벨은 자리가 좁아 늘 `(price/10000).toFixed(1)억`
  (`index.html:945`), 내 호가 메모는 **억 단위 직접 입력**(`step="0.1"`, `:1057`)에
  갭만 `toFixed(2)억`(`:1060`). 비율은 `toFixed(1)%` + 증감 부호(`:1021`).
- 면적은 **㎡가 원본**(`excluUseAr`, 전용면적). 평은 `3.3058`로 나누고
  (`index.html:358` `perPy`), 84.9㎡ 환산은 `:696` `PY_TO_84`. **전용면적 기준이라
  통상의 공급면적 평당가보다 높다** — 이를 밝힌 하단 주석(`:304`)을 지우지 말 것.

## 배포·운영

배포는 공통대로 `make ship`(= `/ship`). 여기서만 알아야 할 것:

- **`wrangler.jsonc`에 estate 몫이 없다** — `ENABLE_*` var도 DO도 R2도 cron도 없고,
  정적 자산 + 라우트 하나(`/_estate/deals`, 분당 120회, `_infra/worker.js:1175`)뿐.
- **로그인 게이트는 없다**(`_infra/verify-prod.mjs:22` `GATED_SITES` =
  admin·invest·duri). 대신 Worker가 `no-store` + `X-Robots-Tag: noindex, nofollow`를
  붙이고(`worker.js:1777`) 방문 집계에서 뺀다(`:1798`). 주소를 알면 그냥 들어온다.
- `_infra/build.mjs:30` `CONFIDENTIAL_SUBDOMAINS` 등록. www 랜딩에 링크를 만들면
  **빌드가 실패**하고, 홈 버튼(`_infra/home-button.test.mjs:50`)·풀다운(`:166`)·검색
  색인(`:242`)에도 나오면 안 된다. 검증: `node _infra/verify-prod.mjs --only site:estate`.
- **운영 Worker에서 국토부 API는 403이다** — RTMS가 해외 IP를 차단한다
  (`estate.js:7` 주석). 프로덕션 secret에 넣어도 소용없어 `wrangler.jsonc` secrets
  목록에도 없다. 키는 로컬 `.dev.vars`의 `MOLIT_SERVICE_KEY`·`VWORLD_KEY`뿐, 운영
  데이터는 정적 JSON 커밋이고 키가 없으면 준비 안내로 fail-soft다.
- 데이터 갱신(주 1회, 한국 IP 로컬에서):

```bash
bash _infra/estate-refresh.sh            # 수집 → 지오코딩 → 빌드 검증 → 커밋 → 푸시
bash _infra/estate-refresh.sh --basemap  # 배경지도 스냅샷까지
node _infra/estate-import.mjs --months 60 --force   # 단계별로 돌릴 때
```

⚠️ `estate-refresh.sh`는 **`git add estate/` 후 `git push origin main`까지 한다**
(`estate-refresh.sh:41-43`). 에이전트 레인에서 돌리지 말 것. 게다가 실거래 변경이
없으면 `git checkout -- estate/`로 되돌려서(`:36`) `estate/` 미커밋 작업이 날아간다.

## 테스트

```bash
node --test _infra/estate.test.mjs                 # 이 서브도메인 전용 (8개)
npm test                                           # 인프라 전체
node _infra/build.mjs && node --test _infra/home-button.test.mjs   # 비공개 노출 검사
```

`estate.test.mjs`가 덮는 것: XML 파싱(만원 정수·ISO 날짜·해제/직거래 플래그), 오류
봉투, 쿼리 허용목록, LAWD 코드, not-configured, 405, 재수집 규칙. e2e 대상 아님.

## 함정

- **법정동코드**: 화성시 통합 코드 `41590`은 폐지됐고 과거 월까지 `41597`(동탄구)로
  이관됐다(`_infra/estate.js:12` 주석). 기흥구는 `41463` — 둘 다 `estate.js:15`
  `REGIONS`가 허용 목록으로 고정한다.
- **동탄1/2 구분은 뺄셈**이다 — 동탄1을 반송동·석우동·능동으로 고정하고 동탄2는
  "동탄구 − 동탄1"로 정의한다(`index.html:315`). 법정동 개명(오산동→여울동)에도
  목록을 안 고치려는 것 — 화이트리스트로 바꾸지 말 것.
- 해제신고(`canceled`)는 표에 취소선으로 남기되 **모든 집계에서 뺀다**.
- 전 단지 시계열은 `allAptSeries()`가 한 번에 만들어 캐시한다(단지마다 따로 훑으면
  렌더가 눈에 띄게 느려진다).
- 이번 달 마지막 점은 신고 지연(최대 30일) 때문에 늘 과소 집계다.
