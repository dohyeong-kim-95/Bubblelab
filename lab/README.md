# lab — 작업 도구를 두는 비공개 서브도메인

lab.bubblelab.dev. 토이가 아니라 내가 쓰는 도구 자리라서 랜딩·풀다운에
노출되지 않는다(`_infra/build.mjs`의 `CONFIDENTIAL_SUBDOMAINS`). 주소를 알면
열리는 정적 페이지일 뿐 로그인은 없다 — 남에게 보이면 곤란한 것은 두지 않는다.
`lab/` 홈은 빌드가 카드 목록으로 자동 생성한다.

## claude-insights — /insights 리포트 한국어 아카이브

`/insights`(Claude Code 사용 리포트)를 한국어로 옮겨 날짜별로 쌓아 두고,
날짜 버튼으로 그날 리포트를 다시 읽는 화면이다. 한국어/원문 토글이 있다.

```
lab/claude-insights/
  index.html               렌더러 (바닐라, 의존성 없음)
  data/index.json          날짜 목록 매니페스트 — 스크립트가 항상 다시 만든다
  data/YYYY-MM-DD.json     하루치 리포트 { date, range, stats, source, ko, en }
  data/YYYY-MM-DD.report.html  그날 /insights 원문 HTML (바이트 그대로)
```

**번역본은 `/insights` 가 준 JSON만 담는다** — 리포트 HTML의 수치 패널(도구
사용량·언어·응답시간 분포·Multi-Clauding·마찰 유형·시간대별 메시지)은 그 JSON에
없다. 나중에 `~/.claude/usage-data/session-meta/` 에서 다시 계산하면 그 뒤에 쌓인
세션이 섞여 리포트와 다른 숫자가 나온다(실제로 메시지 187 → 220으로 어긋난다).
그래서 원문 HTML을 바이트 그대로 옆에 싣고 화면의 **📄 원문 리포트** 버튼이 그걸
연다. 발행 시점 해시를 `source.report_sha256` 에 박아 테스트가 대조한다.
원문은 뷰포트 meta가 없어 폰에서는 축소되어 보인다(원본 그대로 두는 쪽을 택했다).

발행 흐름 — 세션에서 `/insights` 를 돌린 **직후**에만 가능하다:

1. `/insights` — 결과 JSON이 대화에 들어온다(리포트 HTML에는 구조화된 데이터가
   없어서 나중에 파일에서 뽑아낼 수 없다).
2. `/insights-publish` — 에이전트가 한국어로 옮겨 payload를 만들고
   `node _infra/insights-publish.mjs <payload.json> --report <원문.html>` 를 돌린다.
   자세한 규칙은 `.claude/commands/insights-publish.md`.
3. 커밋·푸시하면 Actions가 배포한다.

`_infra/insights-publish.mjs` 가 발행 전에 막는 것:

- 날짜 형식(`YYYY-MM-DD`)·통계 숫자·섹션 일곱 개 존재 여부
- ko/en **구조 일치** — 배열 길이나 키가 다르면 번역에서 항목을 빠뜨린 것이다
- 번역 누락 — 40자 넘는 한국어 문장에 한글이 하나도 없으면 잡는다
  (`example_code` 는 붙여넣어 쓰는 코드라 예외)
- 매니페스트 갱신 누락 — `data/index.json` 은 항상 데이터 파일에서 다시 만든다

검증은 `_infra/insights-publish.test.mjs`(커밋된 리포트가 전부 통과하는지,
매니페스트가 파일과 일치하는지 포함). 화면 스모크는 `_infra/e2e/smoke.spec.mjs`.
