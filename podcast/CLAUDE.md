# podcast/ — 에이전트 배경 메모

개요·운영 셋업은 `podcast/README.md`, 공통 규칙은 루트 `CLAUDE.md`. 여기엔
**매번 다시 설명하게 되는 것만** 적는다. 줄번호는 밀리니 괄호 안 이름이 기준이다.

## 로케일과 "오늘 회차"의 경계

- 언어는 ko-KR 하나 — 대본 프롬프트도 한국어 고정(`podcast-ai.js:60 (buildScriptPrompt)`).
- **회차 날짜 = KST 자정 경계.** `_infra/podcast.js:51 (kstToday)` 가
  `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })` 로 만든
  `YYYY-MM-DD` 가 그대로 스토리지 키가 된다 — `pod:${userId}:${date}`
  (`:595`·`:614 (enqueue)`, `:625 (runDaily)`). 날짜를 UTC·로컬시각으로 다시
  계산하지 말고 `kstToday()` 를 쓴다.
- **"하루 1편"은 조건부다.** 409는 `existing && status !== "failed" && !stale`
  일 때만 나가고(`_infra/podcast.js:597-600 (enqueue)`), **`failed` 이거나 30분
  넘게 멈춘(stale) 회차는 409 없이 덮어써 재큐잉된다**(`STALE_GENERATION_MS`,
  `:18`). "같은 날 키가 있으면 무조건 막힌다"고 읽으면 틀린다.
- **cron은 UTC로 적혀 있다.** `wrangler.jsonc:47 (triggers.crons)`
  `["40 21 * * *", "0 13 * * *", "0 23 * * *"]` → `40 21` = 06:40 KST 생성,
  `0 13` = 22:00 KST 저녁 넛지. 분기는 `_infra/worker.js:1849-1864 (scheduled)` —
  `0 13`이면 `runEveningReminder`, `0 23`은 팟캐스트와 무관, **나머지 전부가 기본
  분기로 떨어져 `runDailyGeneration` 을 부른다(`:1863`).** cron을 새로 추가하며
  `controller.cron` 분기를 안 넣으면 그 cron이 팟캐스트 생성을 중복 트리거한다.
- **쿼터 집계일만 태평양시**다 — Google 무료 쿼터가 PT 자정에 리셋돼서
  `_infra/podcast.js:58 (quotaDay)` 는 `America/Los_Angeles`. 회차일과 섞지 말 것.
- 오디오 길이는 `"N분 M초"`(`podcast/index.html:158 (fmtDur)`,
  `podcast/player/index.html:94`), 플레이어 재생 위치만 `M:SS`
  (`player/index.html:90 (fmtTime)`), 파일 크기는 MB/KB(`index.html:157 (fmtSize)`).

## 숫자·비용 표기

- 통화는 화면 한 곳뿐: `podcast/index.html:161 (estCostText)` — 길이 기반 **예상**
  비용을 `$0.00` 두 자리 + `≈원`(환율 1400 하드코딩, `toLocaleString("ko-KR")`)로
  같이 낸다. 안내문 `$0.17 ≈ 240원`(`:101`)도 동일한 근사치.
- **토큰 수는 어디에도 표시하지 않는다.** 서버가 남기는 건 호출 *횟수*뿐 —
  `_infra/podcast.js:683 (recordAiCall)` 이 `usage:<PT날짜>` 키에
  `"<kind>:<model>" → {ok, fail}` 로 14일치만 쌓고 `GET /admin/usage`(`:397`)로 읽는다.
  내부 재시도를 1회로 세는 근사치라 Google 콘솔 수치와 어긋난다.

## 배포·워커 (공통 절차는 `make ship` / `/ship`, 아래는 podcast 고유분만)

- `wrangler.jsonc:26 (vars.ENABLE_PODCAST)` — **fail-closed**. 없으면
  `/_podcast/*` 도(`_infra/worker.js:1616`) `/api/podcast/*` admin도 503(`:1003`).
- 바인딩: DO `PODCAST` → `PodcastDO`(`wrangler.jsonc:82`, 마이그레이션 `v8` `:102`,
  인스턴스는 `idFromName("global")` 단일 — `_infra/podcast.js:154 (podcastStub)`),
  R2 `PODCAST_BUCKET` → `bubblelab-podcast`(`wrangler.jsonc:41`). R2 바인딩이 없으면
  라우트가 503(`_infra/podcast.js:159 (handlePodcast)`).
- 게이트: 초대 코드 → HMAC 쿠키 `bl_pod`(`_infra/podcast.js:169-196`). 시크릿은
  **3단 폴백** — `PODCAST_SESSION_SECRET` → `ADMIN_SESSION_SECRET` →
  `ADMIN_ID`+`ADMIN_PASSWORD` 조합(`_infra/podcast.js:118-119 (sessionHmacKey)`).
  셋 다 없어야 503이라 전용 시크릿 없이도 로그인이 살아 있다.
  **duri·invest와 달리 엣지 비밀번호 게이트는 없다** —
  `_infra/verify-prod.mjs:22 (GATED_SITES)` 에 podcast 가 없다. 정적 페이지는
  열려 있고 API가 401로 막는 구조다.
- AI 프로바이더는 `_infra/podcast-ai.js` 한 겹뿐이고 **env로만 교체**한다
  (`PODCAST_LLM_PROVIDER`/`_MODEL`/`_BASE_URL`, TTS 동일). 기본값
  `_infra/podcast-ai.js:17 (AI_DEFAULTS)` 은 `gemini-flash-latest` /
  `gemini-2.5-flash-preview-tts` — 모델명을 코드에 새로 박지 말 것.
- 라이브 검증 프로브 `api:podcast-session`(`_infra/verify-prod.mjs:385-393`) —
  `GET /_podcast/session` 이 200 + `authenticated:false` + VAPID 공개키. 라우트를
  바꾸면 여기도 고쳐야 `make ship` 이 통과한다.
- `_infra/build.mjs:30 (CONFIDENTIAL_SUBDOMAINS)` 소속 — www 랜딩 카드를 만들지
  않는다. 이 `CLAUDE.md` 자체도 배포에서 걸러진다(`:54 (AGENT_DOCS)`).

## 테스트

```bash
node --test _infra/podcast.test.mjs _infra/podcast-ai.test.mjs   # 이 폴더 담당분만
node --test _infra/podcast*.test.mjs _infra/webpush.test.mjs     # 알림까지 (README)
GEMINI_API_KEY=... node _infra/podcast-pipeline.mjs 자료.pdf     # 실제 품질·비용 확인
```

모바일 스모크(`npm run test:e2e`)에는 podcast 화면이 없다 — 게이트 뒤라
`_infra/e2e/smoke.spec.mjs:8 (SCREENS)` 에서 제외돼 있다.

## 함정

- **토이가 아니다.** `share.js`·`window.blWeekly`·`_infra/records.js` 등록을
  적용하지 않는다(지금 `index.html`·`player/index.html` 어디에도 없다). 프론트는
  빌드 없는 바닐라 PWA + `sw.js` — 화면을 고치면 서비스워커 캐시도 같이 본다.
- 생성은 DO alarm이 **한 단계씩**(`script` → `tts` → `store`,
  `_infra/podcast.js:720-789 (alarm)`) 돌린다. 한 알람에서 전 과정을 끝내려 하면
  실행시간·외부 fetch 타임아웃(524)에 걸린다 — TTS도 `ttsChunkChars`(1600)로 쪼개고
  Gemini는 SSE 스트리밍으로 부른다(`_infra/podcast-ai.js:28-30`,
  `:190 (requestGeminiStream)`). 같은 단계 3연속 실패면 failed(`MAX_JOB_ATTEMPTS`).
- 용량 상한이 세 겹이라 헷갈린다(`_infra/podcast.js:13-16`): 업로드 1건 10MB
  (`MAX_SOURCE_BYTES`), 생성 1회 입력 합 20MB(`MAX_GENERATION_BYTES`), 1인 보관분
  50MB(`MAX_KEEP_BYTES`).
- `openai` LLM 어댑터는 PDF를 거부한다(`_infra/podcast-ai.js:281
  (createScriptProvider)`) — PDF 자료를 쓰는 한 LLM은 gemini여야 한다.
