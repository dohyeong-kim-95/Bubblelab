# invest — 조회 전용 잔고·수익률 화면

상태: **1단계(조회 전용)**. <https://invest.bubblelab.dev>, 자체 비밀번호 게이트 뒤
비공개(`_infra/build.mjs`의 `CONFIDENTIAL_SUBDOMAINS`). 랜딩·풀다운·검색 어디에도
나오지 않는다.

토스증권 Open API로 **내 계좌 잔고를 읽어서 보여주기만 한다.** 토이가 아니라
개인용 서비스라 토이 관례(share.js, 주간 기록)를 적용하지 않는다.

## 조회 전용이라는 뜻

`_infra/invest.js`의 `READ_ONLY_PATHS`에 있는 세 경로 말고는 부르지 않는다.
`tossFetch()`가 화이트리스트 밖의 경로를 받으면 **네트워크를 타기 전에 던진다.**

| 부르는 것 | 용도 | Rate limit 그룹 |
|---|---|---|
| `GET /api/v1/accounts` | accountSeq 해석 (최초 1회, 이후 캐시) | `ACCOUNT` 초당 1회 |
| `GET /api/v1/holdings` | 보유 종목·평가금액·손익 | `ASSET` 초당 5회 |
| `GET /api/v1/buying-power` | 통화별 예수금 | `ACCOUNT` 초당 1회 |

주문(`POST /api/v1/orders`)·정정·취소는 **코드에 존재하지 않는다.**
`_infra/invest.test.mjs`가 소스에 주문 경로 문자열이 섞여 들어오는지까지 검사한다.
2·3단계(페이퍼 트레이딩 → 소액 실주문)로 갈 때는 이 화이트리스트를 늘리는 게 아니라
별도 모듈로 분리하고 한도·킬스위치·감사 로그를 먼저 갖춘다.

## 설정

`ENABLE_INVEST` var가 켜져 있어도 아래 secret 셋이 **모두** 있어야 열린다. 하나라도
없으면 런타임에서 503으로 닫힌다(fail-closed). 내리려면 var를 `"false"`로 바꾼다.

```bash
npx wrangler@4 secret put INVEST_PASSWORD        # 화면 게이트 비밀번호
npx wrangler@4 secret put INVEST_CLIENT_ID       # 토스 developers 앱키
npx wrangler@4 secret put INVEST_CLIENT_SECRET   # 토스 developers 시크릿
npx wrangler@4 secret put INVEST_ACCOUNT_SEQ     # (선택) 계좌 조회 한 번을 아낀다
```

키 발급은 <https://corp.tossinvest.com/ko/open-api>. 게이트 세션 쿠키는 `bl_invest`,
**7일**이다(duri의 1년보다 짧게 잡았다 — 계좌 정보가 보이는 화면이라 기기를
잃어버렸을 때의 노출 창을 좁히는 쪽을 택했다). 라우팅·게이트는 `_infra/worker.js`의
`handleInvestGate`·`handleInvest`.

## 토스 Open API 메모

- **Base**: `https://openapi.tossinvest.com`, 응답은 `{"result": …}` 봉투.
- **인증**: OAuth2 client_credentials — `POST /oauth2/token`에 `client_id`·
  `client_secret`(form-urlencoded) → `access_token`, `expires_in` 86400,
  **refresh token 없음**.
- **client당 유효 토큰이 1개**다. 그래서 발급을 `InvestDO` 단일 인스턴스
  (`idFromName("main")`)에 몰아넣었다 — 여러 곳에서 발급하면 서로 무효화한다.
  같은 키로 **터미널에서 curl 한 번 받아보는 것만으로도** 서버가 캐시한 토큰이
  죽는다. 그래서 401을 만나면 만료 전이라도 캐시를 버리고 새로 받아 한 번
  재시도한다 — 이게 없으면 24시간 내내 401이다.
- 계좌·자산 API는 `Authorization: Bearer` 외에 **`X-Tossinvest-Account` 헤더 필수**.
- Rate limit이 빡빡하다. 상류 재조회는 30초(`REFRESH_MIN_MS`) 간격으로만 하고
  나머지는 DO 캐시로 답한다. 상류가 429로 막히면 **직전 캐시를 `stale` 표시와 함께**
  돌려준다 — 한도에 걸렸다고 화면이 비지 않게.

## 알려진 막힘 — 토큰 발급 실패 (2026-08 현재 미해결)

토스가 토큰 발급(`POST /oauth2/token`)을 **HTTP 401** 로 거절한다. 실제 응답:

```json
{"error":{"requestId":"…","code":"unidentified-client",
  "message":"클라이언트를 식별할 수 없습니다. 액세스 토큰 또는 IP를 확인해 주세요."}}
```

**원인은 아직 확정되지 않았다.** 토스가 "액세스 토큰 **또는** IP"라고 두 가지를 함께
말하므로 이 응답만으로는 좁혀지지 않는다:

- **API 키가 틀렸다** — 키를 다시 확인하면 끝난다.
- **허용 IP가 아니다** — Cloudflare Workers는 아웃바운드 IP가 고정이 아니라서
  콘솔에 등록할 IP 자체가 없다. 아래 2번 구조로 가야 한다.

가르는 방법: **같은 키로 내 PC에서 토큰 발급을 시도해 본다.** 성공하면 키는 멀쩡하고
IP 문제, PC에서도 실패하면 키·앱 승인 문제다.

> 초기에 이 응답을 IP 차단으로 **오진했다**. 본문에 `ip` 라는 단어가 있다는 것만으로
> 단정했기 때문이다. 지금은 명시적으로 거부당한 문구(`not allowed ip` 등)일 때만
> 단정하고, `unidentified-client` 는 두 원인을 함께 알린다.

판정 근거인 토스 응답 원문은 두 곳에서 볼 수 있다.

```bash
npx wrangler@4 tail --format pretty   # invest upstream failure 항목의 body
```

**임시 조치**: 로그를 볼 수 없는 상황을 위해 오류 배너에 "토스 응답 원문"을 접어서
함께 보여준다(`/_invest/state` 응답의 `detail`). 비밀번호 뒤 본인 전용 화면이고 우리
키·토큰은 토스 응답에 없으므로 노출 위험은 없지만, **원인이 확정되면 되돌린다** —
`invest.js` 의 `detail` 필드와 `app.js` 의 `showNotice` 두 번째 인자를 빼면 된다.

풀 수 있는 길:

1. **토스 콘솔에서 IP 제한을 끄거나 넓게 잡는다.** 가능하면 이게 끝이다. 코드 변경 없음.
2. **고정 IP 지점에서 토스를 부른다.** `_src/duri-sink/` 처럼 내 PC에 상주하는 데몬이
   주기적으로 잔고를 읽어 **숫자만** 엣지로 올리고, 엣지는 저장·표시만 한다. API 키가
   Cloudflare가 아니라 내 PC에만 있게 되어 보안상 오히려 낫고, 지금 화면을 그대로 쓴다.
   대신 PC가 꺼져 있으면 갱신이 멈춘다(하루 한 장이 목적이라 대체로 무해).
3. Cloudflare의 고정 송신 IP 기능은 개인 요금제 범위 밖이라 실질적 선택지가 아니다.

## 수익률 그래프가 "오늘부터" 시작하는 이유

토스 Open API의 표면은 시세·계좌·주문뿐이라 **과거 자산 추이 엔드포인트가 없다.**
그래서 그래프는 우리가 직접 쌓는다 — 매일 22:00 KST(13:00 UTC) cron이 잔고를 한 장
찍어 `snap:YYYY-MM-DD`로 저장하고(`MAX_SNAPSHOTS` 800장 ≈ 3년), 화면을 열 때도
그날 스냅샷이 없으면 채운다. 즉 **켠 날부터 점이 생기고, 그 전 기간은 복원할 수 없다.**

### 두 가지 한계 (숫자를 읽을 때 알아야 할 것)

- **통화를 환산하지 않는다.** KRW·USD를 각각 따로 합산해서 보여준다. 환율
  엔드포인트를 쓰면 통합 평가금액을 낼 수 있지만, 환율까지 섞이면 "주가가 오른
  것"과 "환율이 움직인 것"이 한 숫자에 뭉개져서 1단계에서는 일부러 나눠 뒀다.
  그래프는 수익률(%)만 그린다 — 단위가 없어 통화가 달라도 같은 축에 겹칠 수 있다.
- **입출금 타이밍을 반영하지 않는다.** 수익률 = 평가손익 ÷ 매입원가라, 보유분
  기준 누적 수익률이다. 중간에 돈을 넣고 뺀 시점을 반영하는 금액가중수익률(MWR)과는
  다른 값이고, 입금이 잦으면 차이가 커진다. 정확히 하려면 거래원장이 필요한데
  공식 API에 없다.

## 검증

```bash
npm test                     # _infra/invest.test.mjs 포함
node _infra/build.mjs
```

실계좌 연결은 secret 없이는 테스트할 수 없다. `_infra/invest.test.mjs`는 스텁 fetch로
집계·시계열·화이트리스트·토큰 캐시를 검사하고, 실제 응답 스키마와의 정합은 토스
문서(<https://developers.tossinvest.com/docs>)를 기준으로 맞춰 두었다.
