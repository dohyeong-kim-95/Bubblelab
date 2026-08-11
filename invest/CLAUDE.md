# invest — 에이전트 배경 메모

리포 공통 규칙은 루트 `CLAUDE.md`, 설계 배경·겪은 문제는 `invest/README.md`.
여기에는 **매번 다시 설명해야 했던 것**만 적는다. 토스를 부르는 건 집 PC 데몬
(`_src/invest-sink/`)이고, 엣지(InvestDO)는 결과 숫자만 보관·표시한다 —
**엣지에 토스 API 키는 없다.**

## 로케일 — 언어 ko-KR, 시간대 KST

- 화면은 한국어. `invest/index.html:2` `<html lang="ko">`, 제목도 한국어.
- **스냅샷의 정체성은 "어느 날짜의 잔고인가" 하나다.** 날짜 키는
  `kstDate()` — `_infra/invest.js:52`. UTC 로 도는 엣지에서 `Date.now() + 9시간`을
  더한 뒤 `toISOString().slice(0,10)` 으로 뽑는다(Intl·TZ 라이브러리 안 씀 —
  같은 함수를 `_infra/verify-prod.mjs:34` 가 따로 한 벌 갖고 있다).
- 날짜는 **데몬 값을 믿지 않고 받은 시각으로 다시 찍는다**(`normalizeSnapshot()`
  `_infra/invest.js:603`) — 시계 어긋난 PC 가 미래 날짜를 올리면 못 고친다.
- 저장은 `snap:YYYY-MM-DD` 하루 한 장(같은 날 재업로드는 덮어쓰기, 보관 800장 —
  `#record` `_infra/invest.js:622`), 36시간(`STALE_AFTER_MS` `:37`) 넘으면 stale.
- 화면의 "기준" 시각만 브라우저 시간대에 맡긴다(`toLocaleString("ko-KR", …)`
  `invest/app.js:406`). 갱신 주기는 전부 **PC cron** — 매일 22:00 KST 정기 +
  `--on-demand` 1분마다(`_src/invest-sink/README.md:67`, `:96`). **워커 cron 에는
  invest 가 없다**(`wrangler.jsonc:47` 의 세 트리거는 팟캐스트·운세·브리핑용).

## 통화·숫자 표기

- **환율을 적용하는 지점이 없다.** KRW·USD 를 절대 더하지 않고 통화별로 따로
  합산한다(`aggregateHoldings` `_infra/invest.js:67`, `aggregateGroups`
  `_infra/invest.js:183` — 그룹 안에서도 통화를 안 섞는다). 큰 숫자가 통화마다
  하나씩 뜨는 건 이 때문이다. 그래프는 단위 없는 수익률(%)만 그린다.
- 금액: `money()` `invest/app.js:21` — `Intl.NumberFormat("ko-KR", {style:"currency"})`,
  **USD 는 소수 2자리·그 외(KRW)는 0자리**, `minimumFractionDigits: 0`.
  천단위 구분은 로케일이 준다. 실패하면 `Math.round(...).toLocaleString("ko-KR") + " " + 통화`.
- 수익률: `percent()` `invest/app.js:32` — `(rate*100).toFixed(2)%`, 양수엔 `+`.
  저장값 `rate` 는 **비율**(0.0821 = 8.21%)이고 `pnl / cost` 다.
- 부호: `signed()` `invest/app.js:36` — 부호를 통화기호 **바깥**에 붙인다(`-₩1,234`).
- 색은 한국식으로 **이익 빨강·손실 파랑** (`toneOf` `invest/app.js:40`,
  `--up`/`--down` `invest/styles.css:8`). 수량은 `toLocaleString("ko-KR")` + `주`
  (`invest/app.js:141`). 데몬 로그도 같은 규칙(`_src/invest-sink/index.mjs:110`~`127`).
- 예수금은 `cash` 로 **따로** 담고 value·cost·pnl 에 섞지 않는다(섞으면 원가 없는
  현금이 수익률을 희석한다). 통화 코드는 `/^[A-Z]{3}$/` 로 검증한다.

## 배포 (wrangler / Workers)

배포 절차 자체는 공통 — `make ship`(= `/ship`, `Makefile:35`). invest 고유한 것만:

- `wrangler.jsonc`: `ENABLE_INVEST` var(`:36`, fail-closed), DO 바인딩 `INVEST` →
  `InvestDO`(`:91`)·마이그레이션 `v15`(`:109`), optional secret `INVEST_PASSWORD`·
  `INVEST_SINK_SECRET`(`:65`). **토스 키(`INVEST_CLIENT_*`)는 엣지에 넣지
  않는다**(`:63`) — 데몬 PC 환경변수로만 둔다.
- 게이트: `_infra/worker.js` `handleInvestGate:471` / `handleInvest:502`. 쿠키
  `bl_invest`·세션 **7일**(`:452`)·로그인 5회/15분, `ENABLE_INVEST` 가 꺼졌거나
  `INVEST_PASSWORD` 가 없으면 **503**(`:1743`), 응답은 `no-store` + noindex
  (`:1777`). rate limit 은 state 30/분·refresh 6/분·push 20/분이고, 데몬 경로
  (`/_invest/pending`·`/_invest/snapshot`)는 `Bearer INVEST_SINK_SECRET`.
- `_infra/build.mjs:30` `CONFIDENTIAL_SUBDOMAINS` 에 있다 — 랜딩·풀다운·검색
  미노출이고 `www/index.html` 에 카드를 넣을 필요도 없다.
- 라이브 검증: 프로브 `invest:state`(`_infra/verify-prod.mjs:450`)가 로그인해
  `/_invest/state` 를 읽고 `assertInvestState`(`:138`)로 형태까지 본다
  (`BL_INVEST_PASSWORD` 없으면 SKIP, 익명 401 확인은 `gate:closed` `:432`).
  하나만: `bash scripts/verify-prod.sh --only invest`.
- **검증은 읽기만 한다.** 예전에 검증 페이로드가 그날 잔고를 빈 값으로 덮어써
  복구한 적이 있어(`_infra/verify-prod.mjs:6`) `InvestDO` 가 빈 스냅샷 업로드를
  **409 로 거절**한다(`isEmptySnapshot` `_infra/invest.js:524`, 거절 `:696`).
  정말 빈 계좌일 때만 데몬이 `?allowEmpty=1`. **프로브에 쓰기 경로 추가 금지.**

## 테스트

```bash
node --test _infra/invest.test.mjs   # invest 만 (75개)
npm test                             # 전체 (_infra/*.test.mjs + _src/duri-sink/*.test.mjs)
node _src/invest-sink/index.mjs      # 실계좌 연결 확인 — 실제 키 환경변수 필요
```

- **`_src/invest-sink/` 전용 테스트 파일은 없다.** 데몬이 쓰는 로직
  (`fetchSnapshot`·`issueToken`·`tossFetch`)이 전부 `_infra/invest.js` 에 있어
  `invest.test.mjs` 가 스텁 fetch 로 덮는다(`package.json:5` 글롭도 duri-sink 만).
- 조회 경로를 하나라도 늘리면 `READ_ONLY_PATHS` 개수·주문 경로 문자열 가드가
  걸린다(`_infra/invest.test.mjs:54`, `:73`) — 테스트도 같이 고친다. 게이트 뒤라
  e2e 스모크 대상은 아니다(`_infra/e2e/smoke.spec.mjs:8`).

## 함정 (겪은 것)

- **토스 허용 IP.** 엣지에서 직접 부르면 영원히 `unidentified-client` 401.
  데몬 PC 의 공인 IP 가 토스 콘솔에 등록돼 있어야 하고, 회선·IP 가 바뀌면 재등록.
- 데몬 진단(`_src/invest-sink/README.md:112`): 토큰 발급 401 = IP/키, 업로드 401 =
  `INVEST_SINK_SECRET` 불일치, 400 = 형태, **409 = 빈 스냅샷 거부**, 503 = 미설정.
- cron 은 PATH 가 `/usr/bin:/bin` 뿐이라 **node 를 절대경로로** 적는다.
  `INVEST_GROUPS` 는 공백·`;` 때문에 **따옴표 필수**(없으면 매일 조용히 실패).
- 토스는 client 당 유효 토큰이 1개다 — 캐시(`~/.bubblelab/invest-token.json`, 0600)를
  재사용한다. 매번 새로 받으면 다른 곳에서 쓰던 토큰이 죽는다.
