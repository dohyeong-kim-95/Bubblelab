# invest-sink — 집 PC에서 토스 잔고를 읽어 올리는 데몬

`_src/` 아래라 **배포에 포함되지 않는다.** 의존성 0, Node 20+
(fetch·`node:fs` 만 쓴다 — v20.20.0에서 동작 확인).

## 왜 PC에서 도는가

토스 Open API는 콘솔의 "허용 IP 관리"에 등록한 IP에서만 받아준다. Cloudflare
Workers는 요청마다 다른 엣지에서 나가고 그 대역이 수천 개라 **등록할 IP가 존재하지
않는다** — 엣지에서 직접 부르면 영원히 `unidentified-client` 401이다.

그래서 조회는 이 PC에서 하고, 엣지에는 **결과 숫자만** 올린다. 덤으로 API 키가
Cloudflare가 아니라 이 PC에만 남아 보안상 더 낫다. duri의 `_src/duri-sink/`와 같은
구조다 — 원본은 내 PC, 엣지는 보관·표시.

## 준비

**① 이 PC의 공인 IP를 토스 콘솔에 등록한다.**

```bash
curl -s https://api.ipify.org   # 이 값을 토스 콘솔 → Open API → 허용 IP 관리에 추가
```

발급 때 자동 등록된 IP(휴대폰 등)는 이제 필요 없으면 지운다. **인터넷 회선이 바뀌거나
공인 IP가 갱신되면 다시 등록해야 한다** — 데몬이 401로 실패하면 이걸 먼저 의심한다.

**② 엣지에 업로드용 secret을 넣는다.** 아무 긴 문자열이면 된다.

```bash
npx wrangler@4 secret put INVEST_SINK_SECRET
```

**③ 이 PC에 환경변수를 준비한다.**

| 변수 | 필수 | 설명 |
|---|---|---|
| `INVEST_CLIENT_ID` | ✅ | 토스 앱키 |
| `INVEST_CLIENT_SECRET` | ✅ | 토스 시크릿 |
| `INVEST_SINK_SECRET` | ✅ | 위 ②에서 넣은 값과 같아야 한다 |
| `INVEST_ACCOUNT_SEQ` | | 계좌가 여러 개일 때 고를 계좌. 비우면 첫 계좌 |
| `INVEST_ENDPOINT` | | 기본 `https://invest.bubblelab.dev/_invest/snapshot` |
| `INVEST_TOKEN_CACHE` | | 기본 `~/.bubblelab/invest-token.json` |

## 실행

```bash
node _src/invest-sink/index.mjs
```

한 번 돌고 끝난다. 반복은 스케줄러에 맡긴다 — 매일 22:00 KST(국내장 마감 뒤,
미국장 개장 전)가 하루 한 장 찍기에 알맞다.

```bash
# crontab -e  (환경변수는 별도 파일에 두고 읽어들인다)
0 22 * * *  cd ~/bubblelab && set -a && . ~/.bubblelab/invest.env && set +a && node _src/invest-sink/index.mjs >> ~/.bubblelab/invest.log 2>&1
```

`~/.bubblelab/invest.env` 는 `chmod 600` 으로 두고 `KEY=값` 을 한 줄씩 적는다.
윈도우면 작업 스케줄러에 같은 명령을 등록한다.

## 확인

성공하면 이렇게 찍힌다.

```
2026-08-09 읽음: KRW 12,345,678 (8.21%)
업로드 완료: {"ok":true,"date":"2026-08-09"}
```

- **`토큰 발급: … (HTTP 401)`** → 이 PC의 공인 IP가 콘솔에 없거나 키가 틀렸다.
  `토스 응답 원문` 줄이 같이 찍히니 그걸 본다.
- **`업로드 실패 (HTTP 401)`** → `INVEST_SINK_SECRET` 이 엣지와 다르다.
- **`업로드 실패 (HTTP 400)`** → 스냅샷 형태가 서버 검증을 통과하지 못했다(스펙 변경 의심).

PC가 꺼져 있으면 그날 점이 빠진다. 화면은 마지막 갱신이 36시간을 넘으면 "갱신이
멈췄다"고 알려준다.
