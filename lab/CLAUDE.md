# lab 서브도메인 — 에이전트 메모

무엇을 두는 곳인지·데이터 구조·발행 흐름의 배경은 `lab/README.md`,
리포 공통 규칙(폴더=서브도메인, 커밋 범위, 배포 자동화)은 루트 `CLAUDE.md`.
여기는 **매번 사람이 다시 설명해야 했던 것**만 적는다.

## 로케일

- 화면 언어는 한국어 하나다: `claude-insights/index.html` 은 `<html lang="ko">`,
  `<title>📊 클로드 코드 인사이트</title>`. 새 페이지를 만들어도 같게 간다.
- 시간대는 **KST 고정**. 아카이브의 **날짜 키(`YYYY-MM-DD`)는 `/insights` 를 돌린
  날의 KST 날짜**를 사람이/에이전트가 payload에 적어 넣는 값이다
  (`.claude/commands/insights-publish.md` 의 "오늘, KST 기준").
  **코드에는 날짜를 만드는 자리가 없다** — 검증기는 형식만 본다
  (`_infra/insights-publish.mjs` 의 `validatePayload`), 화면도 `new Date()` 를
  쓰지 않고 매니페스트의 문자열을 그대로 버튼으로 그린다. 그래서 UTC 자정 뒤에
  작업하면 하루 어긋난 파일명이 그대로 통과한다 — 날짜는 직접 확인해서 적는다.
- `generated_at` 은 오프셋을 붙인 ISO(`2026-08-12T01:58:26+09:00`) 로 쓴다.
  `range.from`/`range.to` 는 리포트 머리말의 세션 기간이지 발행일이 아니다.
- 한국어/원문 토글은 **번역 두 벌을 같은 렌더러로 그리는** 구조다:
  payload의 `ko`/`en` 두 트리 + 화면의 섹션 제목 사전 `L.ko`/`L.en`
  (`index.html`). 기본값 `state.lang = "ko"`, 버튼은 `#lang-ko`/`#lang-en`.
  **섹션 키를 늘리면 `L` 양쪽과 `SECTIONS`(`_infra/insights-publish.mjs`)를
  같이 고쳐야 한다** — 한쪽만 고치면 원문 토글에서만 제목이 빈다.

## 배포·검증

공통 의례는 `make ship`(= `/ship`). 여기 고유한 것만:

- lab 은 `CONFIDENTIAL_SUBDOMAINS`(`_infra/build.mjs:29`)라 **랜딩 카드가 있으면
  빌드가 실패한다**(반대로 공개 서브도메인은 카드가 없으면 실패 —
  `_infra/build.mjs:60-76`). 카테고리 홈 풀다운(`build.mjs:275 (listingPage)`)과
  랜딩 검색 색인(`build.mjs:650 (cards 수집)`)도 이 집합을 건너뛰기 때문에 빠진다
  — **빠지는 이유는 빌드지 테스트가 아니다.** `_infra/home-button.test.mjs` 의
  누출 검사 두 곳(`:166` 풀다운, `:242` 검색 색인)의 목록에 **lab 은 없다** —
  링크 생성 쪽을 고치다 lab 이 새도 테스트는 잡아 주지 않으니, 그 근처를 만지면
  빌드 산출물을 직접 확인하거나 두 목록에 lab 을 넣어라.
- **서버 코드가 없다.** `_infra/worker.js` 에 lab 라우트도 게이트도 없고 DO·R2
  바인딩도 없다(`wrangler.jsonc`). 순수 정적이라 로그인이 없다 — 주소를 알면
  누구나 열린다. 남에게 보이면 곤란한 것은 올리지 않는다.
- 그래서 `_infra/verify-prod.mjs` 의 `GATED_SITES` 에도 없다 → `site:lab` 프로브가
  `lab/` 첫 화면 **200 + `<title>` + 본문 500바이트 초과**를 기대한다.
  게이트 사이트처럼 302를 내면 실패로 잡힌다.
- 에이전트 문서(`README.md`·`CLAUDE.md`·`AGENTS.md`)는 **배포에서 빠진다**
  (`_infra/build.mjs:54 (AGENT_DOCS)` 정규식으로 복사 필터에서 제외,
  `_infra/home-button.test.mjs:225 ("에이전트 문서(README·CLAUDE·AGENTS)는
  배포되지 않는다")` 가 dist 전체를 훑어 지킨다). 이 파일에 게이트·env 이름을
  적어도 서빙되지 않는다.
- 반대로 **그 셋을 뺀 `lab/` 안의 모든 파일은 그대로 dist 로 복사돼 공개 주소로
  열린다.** 로그인이 없으니 메모·스크래치·자격증명 같은 것을 폴더에 두지 않는다.

## 리포트 발행 (`claude-insights`)

```bash
node _infra/insights-publish.mjs <payload.json> --report <원문.html> [--force]
```

- **`/insights` 를 이 세션에서 먼저 돌려야 한다.** 구조화된 JSON은 대화에만 있고
  리포트 HTML에서 다시 뽑아낼 수 없다 — 지난 날짜를 소급 발행하는 방법은 없다.
  payload 작성 규칙은 `/insights-publish`(`.claude/commands/insights-publish.md`).
- 검증에 걸리면 **아무 파일도 남지 않는다**(붙였던 원문 HTML까지 지운다).
  잡는 것: 날짜 형식, `stats` 다섯 개 숫자, 섹션 일곱 개, ko/en 구조 불일치
  (배열 길이·키·타입), 40자 넘는데 한글이 없는 문장(`example_code` 는 예외).
- `data/index.json` 은 **손으로 고치지 않는다** — 발행할 때마다 데이터 파일에서
  통째로 다시 만든다(최신이 위). 목록 버튼의 툴팁은
  `ko.interaction_style.key_pattern` 을 그대로 쓴다.
- `--report` 를 빠뜨리면 수치 패널(도구 사용량·응답시간·마찰 유형)이 영영 없는
  리포트가 된다. 원문은 바이트 그대로 복사되고 `source.report_sha256` 에 해시가
  박히므로, **커밋 뒤에 그 HTML을 한 글자라도 손대면 테스트가 깨진다.**
- 같은 날짜 재발행은 `--force`. 원문 파일이 옆에 없으면 매니페스트가 링크를
  걸지 않아 📄 버튼이 조용히 사라진다(404 대신).

## 테스트

```bash
node --test _infra/insights-publish.test.mjs   # 이 서브도메인 전용 (유일)
npm test                                       # 인프라 전체
npm run test:e2e                               # /lab/claude-insights/ 스모크 포함
```

`insights-publish.test.mjs` 는 순수 단위 테스트가 아니라 **커밋된 데이터까지
검사한다** — 모든 `data/*.json` 재검증, 원문 HTML 해시 대조, `index.json` 이
파일과 일치하는지, 화면이 쓰는 필드가 매니페스트에 있는지. 데이터만 만져도
이 테스트를 돌린다.
