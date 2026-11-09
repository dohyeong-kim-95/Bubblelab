# opic — 오픽 모의고사 (opic.bubblelab.dev)

폰으로 실제 OPIc 순서대로 보는 비공식 모의고사. 서베이(Part 1–4, 12개 이상) → 자가평가(6단계) →
마이크 확인 → 15문항(40분) → 녹음 다시 듣기·셀프 체크.

- `questions.js` — 서베이·자가평가 표, 문항 은행, 시험지 짜기(순수 함수, 테스트 `_infra/opic.test.mjs`).
  - 1번 자기소개 → 2–4 거주지 콤보 → 5–7 서베이 주제 콤보 → **난이도 재조정** → 8–10 돌발 →
    11–13 롤플레이(질문하기·문제 해결·관련 경험) → 14–15 비교·사회 이슈(5–6단계) 또는 묘사·경험.
  - 1–2단계는 롤플레이를 질문하기까지만, 과거 경험·비교·이슈를 줄인다.
  - 문항은 출제 형식(묘사·습관·과거 경험 콤보, 롤플레이)을 따라 **새로 쓴 연습 문항**이다. 기출을 옮기지 않는다.
- `app.js` — 화면 흐름. 질문 음성은 브라우저 내장 `speechSynthesis`(en-US), 녹음은 `MediaRecorder`.
  질문이 끝나면 5초 안에 한 번 다시 듣기, 그 뒤 자동 녹음, 「다음」으로 넘긴다(실제 시험 규칙).
  **아무것도 서버로 보내지 않는다** — 녹음은 메모리의 blob 이고 결과 화면에서 「저장」으로 받는다.
- **로그인**: admin 이 발급한 계정만 들어온다(가입 화면 없음, `CONFIDENTIAL_SUBDOMAINS` — 랜딩 미노출).
  - 계정 발급·비밀번호 재설정·삭제는 admin 🗣️ OPIc 화면(`/api/opic/accounts*`).
  - 게이트·계정 DO 는 `_infra/opic.js`(`OpicDO`, 바인딩 `OPIC`, 마이그레이션 v21). 비밀번호는 PBKDF2-SHA256 10만 회
    해시로만 남는다. 세션 쿠키 `bl_opic`(30일)는 `ADMIN_SESSION_SECRET` 에서 용도를 달리해 파생한 키로 서명 —
    새 시크릿이 필요 없다. `ENABLE_OPIC` var 는 fail-closed.
  - 비밀번호를 바꾸거나 계정을 지우면 `gen` 이 달라져, 그 전 세션은 다음에 화면을 열 때 끊긴다.
  - 서버에 남는 것은 계정뿐이다. 녹음·답변은 여전히 폰에만 있다. 테스트 `_infra/opic.test.mjs`.
- 마이크: 사이트 기본 `Permissions-Policy` 가 `microphone=()` 라 `_infra/security.js` 의 `OPIC_POLICY` 로
  이 서브도메인만 `microphone=(self)` 로 연다(테스트 `_infra/security.test.mjs`).

## 오늘의 문항 (`daily.html`)

매일 아침 7시(KST)에 실제 출제 형식대로 한 문항씩 **AL 목표 모범답안**이 쌓이고 디스코드로 알린다.
논문 다이제스트와 같은 구조다 — LLM 은 엣지에 없고 집 PC 의 `claude -p`(구독 차감, API 비용 0).

- **문항은 날짜가 정한다** — `questions.js` 의 `dailyQuestion(date)`. 8일 주기로 묘사 → 습관 → 과거 경험 →
  문제 해결 → 비교 → 사회 이슈 → 돌발 → 질문하기, 주제는 `DAILY_POOL`(흔한 AL 서베이 조합)에서 3칸씩 건너뛴다.
  서베이 주제 문항은 80일 동안 겹치지 않는다. 롤플레이 상황은 다섯 개라 문제 해결은 41일째부터 다시 나온다.
- 데몬 `_src/opic-sink/index.mjs`(cron 5분마다): `GET /_sink/daily/pending`(7시 이후·오늘 것 없음·20분 찜) →
  `buildDailyPrompt` → `claude -p --allowed-tools ""` → `parseDaily` → `POST /_sink/daily/done`.
  인증은 papers 와 같은 `PAPERS_SINK_SECRET`(같은 PC·같은 `~/.bubblelab/papers.env`). PC 가 꺼져 있으면 켜질 때 만든다.
  `--dry` 는 엣지 없이 오늘 답안만 찍어 본다.
- **문항 글은 데몬이 보낸 것을 믿지 않는다** — `done` 이 날짜로 다시 정하고, 받는 것은 답안 칸뿐(길이 잘라 저장).
- 보관은 `OpicDO` 의 `d:<날짜>`, 화면은 로그인 뒤 `_daily`(목록)·`_daily/<날짜>`. 디스코드는 처음 저장할 때 한 번,
  `OPIC_DISCORD_CHANNEL_ID` var 가 있으면 그 채널, 없으면 papers 채널(`DISCORD_CHANNEL_ID`).
- 음성은 화면에서 기기 내장 `speechSynthesis` 로 읽는다(녹음 파일 없음).

## 디자인 토큰

`bubble.css` 대신 **OPIc 응시 화면의 토큰**을 쓴다(사용자 요청 — 실제 시험 화면에 익숙해지는 게 목적).
출처: 공식 데모 `opicdemo.actfltesting.org/css/master.css` (2026-11-09 수집). 값은 `index.html` `:root`.

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--o-primary` | `#ff6633` | 주 버튼·재생·선택 단계·지금 문항 |
| `--o-primary-hover` / `-active` | `#ff4a0f` / `#d54406` | 눌림·강조 글자 |
| `--o-on-primary` | `#212529` | 주황 위 글자(흰색 아님) |
| `--o-blue` | `#3366ff` | 녹음 중 띠·진행 막대·마이크 게이지·제목 |
| `--o-green` | `#15874e` | 끝낸 단계·지나간 문항 |
| `--o-purple` | `#8960b5` | 안내 상자 |
| `--o-muted` | `#666d73` | 머리 밑줄·비활성·아직 안 푼 문항 |
| `--o-surface` | `#eeeeee` | 재생 막대·결과 상자 |
| 모서리 | `0` | 버튼·입력·상자 전부 각짐 |
| 버튼 그림자 | `0 2px 1px rgba(0,0,0,.2)` | |

로고·아바타 영상·상표는 쓰지 않는다(면접관은 직접 그린 SVG). 화면 상단에 "비공식 연습"을 밝힌다.
