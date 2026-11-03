# podcast — 데일리 팟캐스트 (podcast.bubblelab.dev)

낮에 모은 PDF·이미지·텍스트(.txt/.md, 붙여넣기 포함)를 다음 날 아침
06:40(KST) 한국어 2인 대담 팟캐스트로 만들어 주는 초대 코드 기반 PWA.
플레이어는 ±10초·탐색·다시재생과 Media Session(잠금화면·블루투스 차량
제어, 백그라운드 재생)을 지원한다. 예전 Vercel + Cloud Run + Supabase +
NotebookLM 스크래핑 구조를 Bubblelab 워커 하나로 재구축한 것이다.
**외부 AI API는 쓰지 않는다** — 대본과 녹음은 집 PC 생성기(`_src/podcast-worker/`)가 만든다.

## 구조

| 역할 | 구현 |
| --- | --- |
| 프론트 | `podcast/index.html` 바닐라 PWA (이 폴더, 빌드 없음) |
| API | `/_podcast/*` 워커 라우트 (`_infra/podcast.js`) |
| 데이터 | `PodcastDO` (사용자·소스·에피소드 메타데이터, 생성 큐) |
| 파일 | R2 `bubblelab-podcast` (소스 파일, 생성 오디오 WAV) |
| 생성 | 집 PC `_src/podcast-worker/` — 대본은 당이(llama-server), 녹음은 Supertonic |
| 대본 규칙 | `_infra/podcast-ai.js` — 프롬프트·JSON 검증 (워커·PC가 같이 씀) |
| 스케줄 | 워커 cron `40 21 * * *`(06:40 생성) + `0 13 * * *`(22:00 저녁 넛지) |
| 알림 | `_infra/webpush.js` — VAPID Web Push 자체 구현. 완성 알림은 말투별
  문구 팩(playful/warm/plain)을 번갈아 쓰고 제목·스트릭을 반영. 자료 없는
  사용자에겐 22:00 리마인더 |
| 습관 | 청취 스트릭(`/listened` 재생 기록), 홈·플레이어에 연속 일수 표시 |
| 인증 | admin이 발급하는 초대 코드 → HMAC 세션 쿠키 (`bl_pod`) |

생성 흐름: 큐(cron 06:40 또는 수동) → PC 생성기가 `/_podcast/worker/claim` 으로
가져감(보관분 우선, 입력 20MB 한도) → 소스를 받아 글로 바꿈(PDF는 pdftotext, 이미지는
당이 비전) → 길면 조각 요약 → 당이가 JSON 대담 대본 → Supertonic 녹음(24kHz WAV) →
`PUT /_podcast/worker/audio` → 완료 커밋 → 사용된 일회성 소스만 정리 → 푸시. 하루 1편.
📌 보관 소스(1인 50MB)는 생성 후에도 남아 매일 사용되고, 한도 초과로 안 쓰인 소스도
보존된다. 실패하면 사유가 남고 PC가 5분 뒤 다시 가져가며, 세 번째 실패에서 실패
처리된다(소스는 남아 다시 시도할 수 있다). **PC가 꺼져 있으면 일감은 큐에서 기다린다** —
홈 화면이 "집 PC가 꺼져 있어 기다리는 중"이라고 알려 준다(`workerOnline`).

## 집 PC 생성기

설치·운영은 `_src/podcast-worker/README.md`. 요약:

- 인증은 admin 🎙️ Podcast 화면의 **🖥️ PC 생성기 → 토큰 발급**(DO에는 해시만, 새로 발급하면 옛 토큰 무효).
- PC는 1분마다 `/_podcast/worker/claim` 을 부른다 — 이게 곧 생존 신호다(admin에 🟢/⚪).
- 03~06시(KST)와 당이가 꺼져 있을 때는 일감을 가져가지 않는다.
- 대본 분량은 당이 컨텍스트(8192토큰) 때문에 5,000자(약 5~6분)로 줄었다
  (`SCRIPT_LIMITS` in `_infra/podcast-ai.js`).

## 운영 셋업 체크리스트

1. Cloudflare 대시보드에서 **R2 활성화** (계정 단위, 미활성 시 배포가 code
   10042로 실패한다) → `wrangler.jsonc`의 `r2_buckets` 주석 해제.
   버킷 `bubblelab-podcast`는 deploy.yml이 자동 생성 시도, 실패 시 수동 생성
2. secret: `PODCAST_SESSION_SECRET` (AI 키는 없다 — 생성은 집 PC)
3. 푸시(선택): `node _infra/podcast-pipeline.mjs --gen-vapid` →
   `VAPID_PUBLIC_KEY` var + `VAPID_PRIVATE_KEY`·`VAPID_SUBJECT` secret
4. `wrangler.jsonc`의 `ENABLE_PODCAST`를 `"true"`로 (없으면 fail-closed)
5. DNS: `podcast` 레코드를 Vercel에서 Cloudflare 프록시로 전환
   (워커의 `*.bubblelab.dev` 라우트가 받는다), Vercel 프로젝트 도메인 해제
6. admin 접속 → `POST /api/podcast/users` `{"name":"이름"}` 으로 사용자 생성,
   응답의 초대 코드를 전달 (코드는 이때 한 번만 보이고 서버엔 해시만 남는다)
7. admin 🎙️ Podcast → 🖥️ PC 생성기 토큰 발급 → 집 PC에 `_src/podcast-worker/install.sh`

confidential 서브도메인이라 랜딩·풀다운에 노출되지 않는다
(`_infra/build.mjs`의 `CONFIDENTIAL_SUBDOMAINS`). 공개 서비스로 전환할 때
목록에서 빼고 `www/index.html`에 카드를 추가하면 된다.

## 로컬 개발

```bash
npx wrangler@4 dev --local --local-upstream localhost \
  --var ENABLE_PODCAST:true --var PODCAST_SESSION_SECRET:dev \
  --var ADMIN_SESSION_SECRET:dev
# http://localhost:8787/podcast/  (API는 /_podcast/* 전역 경로)
# 사용자 생성: localhost:8787/admin (admin/admin) → /admin/api/podcast/users
# PC 생성기를 로컬 워커에 붙이려면 config 의 server 를 http://localhost:8787 로
```

대본·녹음 품질만 볼 때(서버 없이): `node _src/podcast-worker/podcast-worker.mjs --preview 자료.pdf`

테스트: `node --test _infra/podcast*.test.mjs _infra/webpush.test.mjs _src/podcast-worker/*.test.mjs`
