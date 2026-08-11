---
description: 방금 돌린 /insights 리포트를 한국어로 옮겨 lab.bubblelab.dev/claude-insights 에 싣는다
allowed-tools: Bash, Read, Write, Edit
---

# /insights 리포트를 한국어로 발행

**먼저 이 세션에서 `/insights`를 돌려야 한다.** 그 결과 JSON이 대화에 들어와
있어야 이 작업을 할 수 있다 — 리포트 HTML에는 구조화된 데이터가 없어서 파일에서
다시 뽑아낼 수 없다. 대화에 insights JSON이 없으면 여기서 멈추고 "먼저 /insights를
돌려주세요"라고 알린다. 예전 리포트를 다시 싣는 것도 마찬가지로 불가능하다.

## 1. payload 만들기

스크래치패드에 `insights-<날짜>.json` 을 쓴다. 날짜는 리포트를 뽑은 날(오늘,
KST 기준):

```json
{
  "date": "YYYY-MM-DD",
  "generated_at": "<리포트 파일명의 시각, ISO+09:00>",
  "range": { "from": "<리포트 첫 세션 날짜>", "to": "<마지막 세션 날짜>" },
  "stats": { "sessions_total": 0, "sessions_analyzed": 0, "messages": 0, "hours": 0, "commits": 0 },
  "source": { "report": "~/.claude/usage-data/report-….html" },
  "en": { "<insights JSON 원문 그대로>": "…" },
  "ko": { "<같은 구조의 한국어 번역>": "…" }
}
```

- `en` 은 `/insights` 가 준 JSON을 **한 글자도 고치지 않고** 그대로 넣는다.
  섹션은 `at_a_glance`, `project_areas`, `interaction_style`, `what_works`,
  `suggestions`, `on_the_horizon`, `fun_ending` 일곱 개다.
- `stats`·`range` 는 리포트 머리말(`12 sessions total · 10 analyzed · …`)에서 옮긴다.
- `ko` 는 `en` 과 **키·배열 길이가 완전히 같아야** 한다. 검증기가 모양을
  비교하니 항목을 요약하거나 합치지 말고 1:1로 옮긴다.

## 2. 번역 규칙

- 존댓말 서술체("…합니다"), 사람 얘기를 하는 문장은 자연스럽게. 직역투 금지.
- 코드·경로·명령·식별자·기능 이름은 그대로 둔다: `git add .`, `wrangler`,
  `IndexedDB`, `CLAUDE.md`, `Hooks`, `Custom Skills`, `days=1`.
- `example_code` 는 **번역하지 않는다**(붙여넣어 쓰는 코드). 나머지 문장형
  필드(`copyable_prompt`, `addition`, `prompt_scaffold` 포함)는 번역한다.
- `**강조**` 와 `` `코드` `` 마크업, 문단을 나누는 빈 줄은 원문 위치를 유지한다 —
  화면이 그 두 개만 렌더한다.
- 리포트가 인용한 사용자의 한국어 발언은 그대로 남긴다.

## 3. 발행·검증·배포

```bash
# --report 에 /insights 가 만든 원문 HTML 경로를 반드시 같이 넘긴다
node _infra/insights-publish.mjs <payload.json> --report ~/.claude/usage-data/report-<시각>.html
node --test _infra/insights-publish.test.mjs       # 구조·해시·매니페스트 검증
node _infra/build.mjs
```

**원문 HTML을 빠뜨리지 말 것.** 번역본(JSON)에는 리포트의 수치 패널(도구
사용량·언어·응답시간 분포·Multi-Clauding·마찰 유형·시간대별 메시지)이 없고,
나중에 세션 기록에서 다시 계산하면 그 뒤 세션이 섞여 숫자가 어긋난다. 원문은
바이트 그대로 `data/<날짜>.report.html` 로 복사되고 화면의 📄 원문 리포트 버튼이
그걸 연다. 같은 날짜를 다시 발행하려면 `--force`.

검증기가 잡는 것: 날짜 형식, 통계 숫자, 섹션 누락, ko/en 구조 불일치(항목을
빠뜨린 번역), 번역 안 된 긴 문장. 실패하면 payload를 고쳐서 다시 돌린다 —
데이터 파일은 남지 않는다.

커밋은 **이 작업의 파일만** 골라서 한다(`git add -A` 금지). 인덱스도 세션 간
공유라 add와 commit 사이에 남의 스테이징이 끼어든다 — **한 명령으로 붙여서**
실행하고, 직후 `git show --stat HEAD` 로 실린 파일을 확인한다:

```bash
git add lab/claude-insights/data/<날짜>.json lab/claude-insights/data/<날짜>.report.html \
        lab/claude-insights/data/index.json &&
  git commit -m "lab: 클로드 인사이트 <날짜> 리포트" && git push
```

배포는 GitHub Actions가 한다(~1분). 확인은 <https://lab.bubblelab.dev/claude-insights>
— 날짜 버튼에 그날이 생겼는지, 한국어/원문 토글이 도는지 본다.
