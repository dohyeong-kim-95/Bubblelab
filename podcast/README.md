# podcast — 데일리 팟캐스트 (podcast.bubblelab.dev)

낮에 모은 PDF·이미지를 다음 날 아침 06:40(KST) 한국어 2인 대담 팟캐스트로
만들어 주는 초대 코드 기반 PWA. 예전 Vercel + Cloud Run + Supabase +
NotebookLM 스크래핑 구조를 Bubblelab 워커 하나로 재구축한 것이다.
외부 의존성은 AI API 키 하나뿐이다.

## 구조

| 역할 | 구현 |
| --- | --- |
| 프론트 | `podcast/index.html` 바닐라 PWA (이 폴더, 빌드 없음) |
| API | `/_podcast/*` 워커 라우트 (`_infra/podcast.js`) |
| 데이터 | `PodcastDO` (사용자·소스·에피소드 메타데이터, 생성 큐) |
| 파일 | R2 `bubblelab-podcast` (소스 파일, 생성 오디오 WAV) |
| AI | `_infra/podcast-ai.js` — 대본(LLM)·음성(TTS) 프로바이더 계층 |
| 스케줄 | 워커 cron `40 21 * * *` (= 06:40 KST) |
| 알림 | `_infra/webpush.js` — VAPID Web Push 자체 구현 |
| 인증 | admin이 발급하는 초대 코드 → HMAC 세션 쿠키 (`bl_pod`) |

생성 흐름: 소스(보관분 우선, AI 입력 20MB 한도) → 대본 프로바이더(JSON
대담) → TTS 프로바이더(멀티스피커 PCM → WAV) → R2 저장 → 완료 커밋 →
사용된 일회성 소스만 정리 → 푸시. 하루 1편. 📌 보관 소스(1인 50MB)는
생성 후에도 남아 매일 사용되고, 한도 초과로 안 쓰인 소스도 보존된다.
실패하면 소스는 남고 같은 날 재시도할 수 있으며, 작업은 완료 전까지
큐에 남아 처리 중 중단돼도 워치독 알람(15분)으로 재시도된다(최대 3회).

## AI 프로바이더 교체 (최저가 운용)

코드 수정 없이 env로 바꾼다. 기본값은 Gemini(대본 `gemini-flash-latest`,
음성 `gemini-2.5-flash-preview-tts`, 멀티스피커·한국어 지원). 더 저렴하게
가려면 `PODCAST_LLM_MODEL=gemini-flash-lite-latest`.

| var | 값 |
| --- | --- |
| `PODCAST_LLM_PROVIDER` | `gemini`(기본) 또는 `openai` — OpenAI 호환이면 전부 (OpenRouter·Groq·DeepSeek…) |
| `PODCAST_LLM_MODEL` / `PODCAST_LLM_BASE_URL` | 모델명 / OpenAI 호환 베이스 URL |
| `PODCAST_TTS_PROVIDER` / `PODCAST_TTS_MODEL` / `PODCAST_TTS_BASE_URL` | TTS 쪽 동일 |
| `PODCAST_TTS_VOICE_A` / `PODCAST_TTS_VOICE_B` | 진행자·해설자 보이스 |

키는 secret: `GEMINI_API_KEY` (또는 `PODCAST_LLM_API_KEY`·`PODCAST_TTS_API_KEY`
분리 지정). 단, `openai` LLM 어댑터는 이미지 소스만 받는다(PDF는 Gemini 권장).

배포 전에 실제 자료로 품질·비용을 확인할 것:

```bash
GEMINI_API_KEY=... node _infra/podcast-pipeline.mjs 자료.pdf
# → podcast-preview.json(대본) / podcast-preview.wav(오디오)
```

## 운영 셋업 체크리스트

1. Cloudflare 대시보드에서 **R2 활성화** (계정 단위, 미활성 시 배포가 code
   10042로 실패한다) → `wrangler.jsonc`의 `r2_buckets` 주석 해제.
   버킷 `bubblelab-podcast`는 deploy.yml이 자동 생성 시도, 실패 시 수동 생성
2. secrets: `GEMINI_API_KEY`, `PODCAST_SESSION_SECRET`
3. 푸시(선택): `node _infra/podcast-pipeline.mjs --gen-vapid` →
   `VAPID_PUBLIC_KEY` var + `VAPID_PRIVATE_KEY`·`VAPID_SUBJECT` secret
4. `wrangler.jsonc`의 `ENABLE_PODCAST`를 `"true"`로 (없으면 fail-closed)
5. DNS: `podcast` 레코드를 Vercel에서 Cloudflare 프록시로 전환
   (워커의 `*.bubblelab.dev` 라우트가 받는다), Vercel 프로젝트 도메인 해제
6. admin 접속 → `POST /api/podcast/users` `{"name":"이름"}` 으로 사용자 생성,
   응답의 초대 코드를 전달 (코드는 이때 한 번만 보이고 서버엔 해시만 남는다)

confidential 서브도메인이라 랜딩·풀다운에 노출되지 않는다
(`_infra/build.mjs`의 `CONFIDENTIAL_SUBDOMAINS`). 공개 서비스로 전환할 때
목록에서 빼고 `www/index.html`에 카드를 추가하면 된다.

## 로컬 개발

```bash
npx wrangler@4 dev --local --local-upstream localhost \
  --var ENABLE_PODCAST:true --var PODCAST_SESSION_SECRET:dev \
  --var ADMIN_SESSION_SECRET:dev --var GEMINI_API_KEY:<키>
# http://localhost:8787/podcast/  (API는 /_podcast/* 전역 경로)
# 사용자 생성: localhost:8787/admin (admin/admin) → /admin/api/podcast/users
```

테스트: `node --test _infra/podcast*.test.mjs _infra/webpush.test.mjs`
