# duri 서브도메인 — 에이전트 메모

앱 동작·설계 이유는 `duri/README.md`, 리포 공통 규칙은 루트 `CLAUDE.md`. 여기엔
**매번 다시 설명하게 되는 배경**만 적는다.

## 로케일 — 표시는 기기 로컬(KST), 저장은 epoch, 백업만 파일마다 다름

- 언어는 ko-KR 고정, 시각 문구는 `toLocale*("ko-KR", …)` 로만
  (`duri/index.html:869-870 (fmtTime/dayLabel)`).
- **서버에는 날짜 계산이 없다.** DuriDO는 `Date.now()` epoch ms만 찍고
  (`_infra/duri.js:375 (calDel)`, `:444`, `:593`), `Asia/Seoul` 문자열은 이
  서브도메인 어디에도 없다 — 타임존은 **기기 로컬**(두 사람 다 KST라 결과가 KST).
- **날짜 경계는 전부 클라이언트 로컬 기준.** 캘린더 키는
  `${getFullYear()}-${getMonth()+1}-${getDate()}`(`duri/index.html:2662 (ymd)`),
  되돌릴 때도 `new Date(ds + "T00:00:00")` 로 **로컬 자정**(`:2817`, `:2980-2981`).
  `Z` 나 `toISOString()` 으로 키를 만들면 KST에서 하루가 밀린다.
- **PC 백업에서 UTC인 건 대화록 쪽뿐이다.** 월 폴더·파일명 스탬프
  (`_src/duri-sink/store.mjs:33-34 (monthOf/stampOf)`)와 대화록의 `## 날짜`·시:분
  (`:64 (renderMarkdown)`)이 UTC라 **KST 00~09시 대화·사진은 전날로 들어간다.** 반면
  `calendar.md`(`:89 (renderCalendarMarkdown)`)는 클라이언트가 만든 로컬 `ymd`
  (`e.date`)를 그대로 써서 밀리지 않는다. 고칠 거면 sink + `store.test.mjs`.
- 음력 공휴일은 변환 로직 없이 **2026·2027년치만**(`duri/index.html:2873
  LUNAR_HOLIDAYS`). 통화·숫자 표기 규칙은 없다(금액을 다루지 않는다).

## 배포

절차 자체는 리포 공통(`make ship` → `scripts/ship.sh`). duri 고유는 아래뿐이다.

- `wrangler.jsonc`: var `ENABLE_DURI`(:32) · DO 바인딩 `DURI`→`DuriDO`(:83, 마이그
  태그 v10 `new_sqlite_classes` :104) · R2 `DURI_BUCKET`→`bubblelab-duri`(:43).
- fail-closed **503** 조건은 둘뿐이다 — `ENABLE_DURI` 꺼짐(`_infra/worker.js:624`),
  `DURI_BUCKET` 또는 게이트 비밀번호 없음(`:630`). **DO 바인딩은 이 검사에 없다** —
  `DURI` 가 빠지면 503이 아니라 `:653` 의 `env.DURI.get(...)` 에서 500이 난다.
- 게이트 `_infra/worker.js:417 (handleDuriGate)` — 쿠키 `bl_duri`, TTL **1년**
  (`:394 DURI_SESSION_TTL_MS`). 비번은 `DURI_PASSWORD`→`WORK_PASSWORD` 폴백
  (`:400 duriPassword`). 이게 **싱크 토큰 서명 키의 기본값**이기도 해서(`:601
  duriSinkKey`), 비번을 갈면 `DURI_SINK_SECRET` 을 미리 걸어 두지 않는 한 **PC 싱크
  토큰까지 무효화**된다. 로컬은 `http://localhost:8787/duri` 이고(`:1737` 의
  `isProdHost ? "" : "/duri"`) 거기서도 게이트가 뜬다.
- `_infra/verify-prod.mjs`: 자격증명 없이 항상 도는 건 `gate:closed` 의
  `["/_duri/status", [401]]` 한 줄(`:433`) — **게이트가 막는지만** 본다. 안쪽
  `:462 (duri:status)` 는 `needs:"duri"` 라 `BL_DURI_PASSWORD` 가 없으면 **SKIP**
  (`:539`), 있으면 `head`/`ackSeq`/`buffered`/`cal` 형태를 본다(`:167
  assertDuriStatus`). ship 로그의 `duri:status … 자격증명 없음` 은 정상이다.
- `_infra/build.mjs:29 (CONFIDENTIAL_SUBDOMAINS)` 라 랜딩 카드·풀다운에 **노출되지
  않고**(카드 추가 금지), 자체 `index.html` 이 있어 자동 생성 홈·홈 버튼 대상에서도
  빠진다(`:619-624 cardSites 루프`).

## 테스트

```bash
node --test _infra/duri.test.mjs _src/duri-sink/store.test.mjs   # duri 전용 (27건)
npm test                                                          # 인프라 전체
```

`npm test` 범위는 `package.json:5`. duri를 덮지만 **이 레인이 커밋할 수 없는** 공용
테스트가 셋 — `_infra/security.test.mjs:150-151`(지도의 geolocation 헤더),
`_infra/home-button.test.mjs`, `_infra/verify-prod.test.mjs:125-131`. 깨지면 고치지
말고 보고한다. `_infra/worker.test.mjs:200`(bl_duri 게이트)만 `_infra/agent-scope.conf:26`
의 `*shared*` 라 **거부가 아니라 경고**로 통과한다. 스모크(`npm run test:e2e`)에 duri는
없다(게이트 뒤 — `_infra/e2e/smoke.spec.mjs:8`). 레인 커밋 범위는 `duri/**`,
`_infra/duri.*`, `_infra/duri-*`, `_src/duri-*/**` + `*shared*`
(`_infra/agent-hooks/pre-commit:51-55`). 그 밖은 거부된다.

## 함정

- **엣지는 암호블롭만 본다** — 워커·DO·R2에 오는 건 `{iv, ct}` 뿐이다
  (`_infra/worker.js:595-598`). 서버에서 본문을 읽는 기능은 **설계상 불가능**.
- **ack = 서버에서 삭제.** sink의 `{type:"ack", seq}` 를 받으면 DO가 그 이하 버퍼·R2
  사진을 지운다(`_infra/duri.js:518 (prune)`). 그래서 sink 순서가 **persist → 커서
  전진 → ack** 로 고정돼 있다(`_src/duri-sink/duri-sink.mjs:102 (store.persist)` →
  `:127-129` → `:130 (scheduleAck)`); 실패하면 `:119`·`:123` 의 `keepGoing=false` 로
  멈춰 ack 하지 않고, 복호화 실패는 격리하되 연속 10건이면 중단한다(`:111-113`).
  **이 순서를 뒤집으면 영구 손실이다.**
- **미ack 버퍼를 줄이는 건 개수 상한 하나뿐이다.** `_infra/duri.js:537 (capBuffer)`
  가 `head - ackSeq` 이 `:34 MAX_BUFFER_ENTRIES`(5000)를 넘을 때만 오래된 것부터
  버리고 `ackSeq` 를 올린다(=조용한 손실). **시간 기반 만료는 없다** — `:35
  DURI_RETENTION_MS`(30일)는 **참조 0건의 죽은 상수**, `:618 (alarm)` 은 ping 전용.
- 캘린더는 버퍼가 아니라 DO 지속 상태(`cal:<id>`, LWW). 툼스톤은 접속(cal-hello)마다
  `_infra/duri.js:329 (sweepCalTombstones)` 이 `:51 CAL_TOMBSTONE_TTL_MS`(90일) 지난
  것을 지우고, 상한은 `:349 (calPut)` 이 `if (!v?.deleted) live++` 로 **살아 있는
  것만** 세므로 만들고 지우기를 반복해도 `:48 MAX_CAL_EVENTS`(2000)가 차지 않는다
  (툼스톤까지 세던 **옛** 버그 얘기가 주석에 남아 있다). 한도 초과는 조용한 폐기가
  아니라 `cal-reject`(`:362`, 클라 `duri/index.html:1221`).
- 앱 셸을 고쳤으면 `duri/sw.js:104 (SHELL_CACHE)` 버전을 올린다(안 올리면 SWR 캐시로
  옛 화면). `sw.js` 의 푸시 복호화는 `index.html` 의 `deriveKey`/`decryptJson`
  **중복 구현**이라 한쪽만 고치면 알림만 조용히 깨진다.
- DuriDO는 `idFromName("main")` 단일 인스턴스다(`_infra/worker.js:653 (handleDuri)`).
  배포해도 **살아 있는 WebSocket이 있으면 옛 코드가 계속 돈다** — 서버 동작이 안
  바뀐 것처럼 보이면 PC 싱크와 열린 탭을 모두 끊었다가 다시 붙여 본다.

- `data/kr-sgg.geojson`(386KB)만 브라우저 캐시를 받는다. 게이트 뒤 사이트는 워커가
  `no-store` 를 기본으로 주고, 예외는 `_infra/worker.js` 의 `CACHEABLE` 에 사이트별로
  적혀 있다. 무거운 정적 파일을 새로 두면 거기 한 줄을 더한다 — 코드는 넣지 말 것
  (문서는 늘 최신인데 스크립트만 캐시되면 배포 직후 둘이 어긋난다).
