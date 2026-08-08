# invest — 조회 전용 잔고·수익률 화면

상태: **1단계(조회 전용)**. <https://invest.bubblelab.dev>, 자체 비밀번호 게이트 뒤
비공개(`_infra/build.mjs`의 `CONFIDENTIAL_SUBDOMAINS`). 랜딩·풀다운·검색 어디에도
나오지 않는다.

토스증권 Open API로 **내 계좌 잔고를 읽어서 보여주기만 한다.** 토이가 아니라
개인용 서비스라 토이 관례(share.js, 주간 기록)를 적용하지 않는다.

## 구조 — 토스는 내 PC가 부르고, 엣지는 받아만 둔다

```
내 PC (_src/invest-sink/)          엣지 (InvestDO)              브라우저
  토스 Open API 조회   ──POST──▶   스냅샷 보관 (일별)  ──GET──▶  잔고·그래프
  API 키는 여기에만                 키를 알지 못함
```

**토스는 콘솔에 등록한 IP에서만 받아준다.** Cloudflare Workers는 요청마다 다른
엣지에서 나가고 그 대역이 수천 개라 등록할 IP가 존재하지 않는다 — 엣지에서 직접
부르면 영원히 `unidentified-client` 401이다(아래 "겪은 문제" 참고).

그래서 조회는 집 PC 데몬이 하고 엣지에는 **결과 숫자만** 올린다. 덤으로 API 키가
Cloudflare가 아니라 내 PC에만 남아 보안상 더 낫다. duri의 `_src/duri-sink/`와 같은
구조다 — 원본은 내 PC, 엣지는 보관·표시.

데몬 설정·실행은 **`_src/invest-sink/README.md`**.

## 조회 전용이라는 뜻

`_infra/invest.js`의 `READ_ONLY_PATHS`에 있는 세 경로 말고는 부르지 않는다.
`tossFetch()`가 화이트리스트 밖의 경로를 받으면 **네트워크를 타기 전에 던진다.**

| 부르는 것 | 용도 | Rate limit 그룹 |
|---|---|---|
| `GET /api/v1/accounts` | accountSeq 해석 (`INVEST_ACCOUNT_SEQ`가 있으면 생략) | `ACCOUNT` 초당 1회 |
| `GET /api/v1/holdings` | 보유 종목·평가금액·손익 | `ASSET` 초당 5회 |
| `GET /api/v1/buying-power` | 통화별 예수금 | `ACCOUNT` 초당 1회 |

주문(`POST /api/v1/orders`)·정정·취소는 **코드에 존재하지 않는다.**
`_infra/invest.test.mjs`가 소스에 주문 경로 문자열이 섞여 들어오는지까지 검사한다.
2·3단계(페이퍼 트레이딩 → 소액 실주문)로 갈 때는 이 화이트리스트를 늘리는 게 아니라
별도 모듈로 분리하고 한도·킬스위치·감사 로그를 먼저 갖춘다.

엣지가 데몬의 업로드를 그대로 믿지도 않는다 — `normalizeSnapshot()`이 형태를
검증하고 **다시 지어서** 저장한다(날짜는 데몬 값이 아니라 받은 시각으로 찍는다).

## 설정 (엣지)

`ENABLE_INVEST` var가 켜져 있어도 `INVEST_PASSWORD`가 없으면 503으로 닫힌다
(fail-closed). 내리려면 var를 `"false"`로 바꾼다.

```bash
npx wrangler@4 secret put INVEST_PASSWORD      # 화면 게이트 비밀번호
npx wrangler@4 secret put INVEST_SINK_SECRET   # 데몬 업로드 인증용
```

**토스 API 키(`INVEST_CLIENT_ID`·`INVEST_CLIENT_SECRET`)는 엣지에 넣지 않는다.**
데몬이 쓰는 값이라 이 PC의 환경변수로만 둔다. 예전에 넣어 뒀다면 지우는 게 좋다:
`npx wrangler@4 secret delete INVEST_CLIENT_ID`.

게이트 세션 쿠키는 `bl_invest`, **7일**이다(duri의 1년보다 짧게 잡았다 — 계좌 정보가
보이는 화면이라 기기를 잃어버렸을 때의 노출 창을 좁히는 쪽을 택했다).
라우팅·게이트는 `_infra/worker.js`의 `handleInvestGate`·`handleInvest`.

## 수익률 그래프가 "오늘부터" 시작하는 이유

토스 Open API의 표면은 시세·계좌·주문뿐이라 **과거 자산 추이 엔드포인트가 없다.**
그래서 그래프는 우리가 직접 쌓는다 — 데몬이 올릴 때마다 `snap:YYYY-MM-DD`로 하루
한 장씩 저장한다(`MAX_SNAPSHOTS` 800장 ≈ 3년, 같은 날 다시 올리면 덮어쓴다).
즉 **켠 날부터 점이 생기고, 그 전 기간은 복원할 수 없다.**

데몬이 멈추면 점이 빠진다. 마지막 갱신이 `STALE_AFTER_MS`(36시간)를 넘으면 화면이
"갱신되지 않았습니다"라고 알린다 — 조용히 옛날 숫자를 보여주지 않기 위해서다.

### 두 가지 한계 (숫자를 읽을 때 알아야 할 것)

- **통화를 환산하지 않는다.** KRW·USD를 각각 따로 합산해서 보여준다. 환율
  엔드포인트를 쓰면 통합 평가금액을 낼 수 있지만, 환율까지 섞이면 "주가가 오른
  것"과 "환율이 움직인 것"이 한 숫자에 뭉개져서 1단계에서는 일부러 나눠 뒀다.
  그래프는 수익률(%)만 그린다 — 단위가 없어 통화가 달라도 같은 축에 겹칠 수 있다.
- **입출금 타이밍을 반영하지 않는다.** 수익률 = 평가손익 ÷ 매입원가라, 보유분
  기준 누적 수익률이다. 중간에 돈을 넣고 뺀 시점을 반영하는 금액가중수익률(MWR)과는
  다른 값이고, 입금이 잦으면 차이가 커진다. 정확히 하려면 거래원장이 필요한데
  공식 API에 없다.

## 겪은 문제 — 엣지에서 직접 부르면 401 (해결됨: 데몬 구조로 전환)

처음에는 워커가 토스를 직접 불렀고, 토큰 발급이 계속 401로 거절됐다.

```json
{"error":{"requestId":"…","code":"unidentified-client",
  "message":"클라이언트를 식별할 수 없습니다. 액세스 토큰 또는 IP를 확인해 주세요."}}
```

원인은 **허용 IP**였다. 토스 콘솔의 "허용 IP 관리"에 발급 시점의 IP 한 개만 등록돼
있었고, 워커의 IP는 그 목록에 없었다. Workers는 나가는 IP가 고정이 아니라 등록으로는
풀 수 없어서 조회 주체를 집 PC로 옮겼다.

원인을 좁히기까지 헛짚은 것들 — 같은 응답을 다시 만나면 참고할 것:

- **본문에 `ip`가 있다고 IP 문제로 단정하면 안 된다.** 저 메시지는 "액세스 토큰
  **또는** IP"라고 두 원인을 함께 말한다. 지금은 명시적 거부 문구(`not allowed ip`
  등)일 때만 단정하고, `unidentified-client`는 두 원인을 함께 알린다.
- **클라이언트 인증 방식도 의심했다.** 401 응답에 `WWW-Authenticate: Basic
  realm="openapi"`가 실려 와서 폼 본문(`client_secret_post`) 대신 Basic 헤더를
  기대하는 줄 알았다. 원인은 아니었지만, 확정할 수 없어 지금도 basic → post 순으로
  자동 판별한다.
- 진단 문구는 어느 단계(토큰 발급/잔고 조회)에서 깨졌는지와 HTTP 상태코드를 담는다.
  토스 응답 원문은 `detail`로 따로 실어 화면 배너에서 펼쳐볼 수 있다.

## 검증

```bash
npm test                     # _infra/invest.test.mjs 포함
node _infra/build.mjs
node _src/invest-sink/index.mjs   # 실계좌 연결 확인 (환경변수 필요)
```

실계좌 연결은 secret 없이는 테스트할 수 없다. `_infra/invest.test.mjs`는 스텁 fetch로
집계·시계열·화이트리스트·토큰 캐시를 검사하고, 실제 응답 스키마와의 정합은 토스
문서(<https://developers.tossinvest.com/docs>)를 기준으로 맞춰 두었다.
