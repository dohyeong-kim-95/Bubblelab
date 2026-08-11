# 판정 기록

병렬 에이전트 워크플로(`docs/parallel-agents.md`)의 모든 리뷰 판정과 머지 결정을
남긴다. **판정이 났으면 여기 한 줄이 늘어난다** — 통과도, 반려도, 폐기도.

기록 형식 (최신이 위):

```
## <YYYY-MM-DD HH:MM KST> · <브랜치> · <통과|조건부|불통과|머지|폐기>
- **작업**: 한 줄 요약
- **근거**: 리뷰어가 확인한 것 (파일:줄, 실행한 명령과 결과)
- **조치**: 머지 / 반려 사유 / 폐기 사유
```

시각은 KST(`TZ=Asia/Seoul date "+%Y-%m-%d %H:%M KST"`)로 적는다.
판정은 리뷰어 것이고, 조치는 오케스트레이터 것이다.

---

## 2026-08-12 07:59 KST · 서브도메인 CLAUDE.md 17개 · 1차 Gate 판정

작업 목록: "반복되는 배경(로케일·통화 표기·wrangler/Workers 배포 절차·테스트
명령)을 서브도메인별 CLAUDE.md 로 굳힌다." 서브도메인 17개에 구현 에이전트를
레인마다 하나씩 병렬로 띄우고, 적대적 Gate 리뷰어 6명이 각자 격리된
읽기 전용 워크트리에서 브랜치를 독립 검증했다.

**소유 범위 검증**: 17개 브랜치 전부가 정확히 자기 `<서브도메인>/CLAUDE.md`
한 파일만 바꿨다(`git diff --name-only origin/main...`). 훅이 버텼다.

| 브랜치 | 판정 | 근거 요약 |
| --- | --- | --- |
| invest | **통과 → 머지** | 52개 주장 전수 확인, 오류 0. `kstDate()` 가 Intl 아닌 +9h 절단이라는 점, 환율 적용 지점 부재, 빈 스냅샷 409 거부를 코드로 확인. `invest.test.mjs` 75개 통과 |
| work | **통과 → 머지** | 57개 전수 확인, 오류 0. DO 태그 v6/v9/v12, Actions 3종의 `pull --rebase` 후 push, `WORK_PASSWORD` fail-closed 세 지점 확인. 테스트 103개 통과 |
| util | **통과 → 머지** | 51개 전수 확인, 오류 0. "오늘"의 경계 네 갈래(`kstStamp`/`kstToday`/`currentMonth`/calendar 로컬시각)를 각각 확인. 테스트 136개 통과 |
| duri | 조건부 → 반려 | **세 주장이 코드와 반대.** ① `DURI_RETENTION_MS`(30일)는 선언만 있고 참조 0 — 시간 기반 만료가 없다 ② 툼스톤은 90일마다 정리되고 `MAX_CAL_EVENTS` 는 살아 있는 것만 센다(문서는 이미 고쳐진 옛 버그를 현재로 적음) ③ `calendar.md` 는 UTC 가 아님. 단 최우선 검증 대상인 "디스크 기록 → ack" 순서는 정확했다 |
| espanol | 조건부 → 반려 | 루트 `<title>` 이 랜딩 색인에 들어간다는 오해(하위 폴더만 색인됨, 실측 확인) + build.mjs 인용 6개 드리프트 |
| mindfulness | 조건부 → 반려 | 같은 색인 오해 + 인용한 `build.mjs:703` 이 주장과 정반대 동작(모든 사이트 vs 카드 사이트) |
| idle | 조건부 → 반려 | "`home-button.test.mjs:220` 이 idle 색인을 검사한다" — 실제로는 mindfulness 만 단언. 없는 커버리지를 있다고 적음 |
| assets | 조건부 → 반려 | `toLocaleLowerCase("ko")` 를 `_infra/assets.js` 로 오귀속(실제 `assets/catalog.js`) + 소유 범위 근거 오귀속 |
| games | 조건부 → 반려 | `wrangler.jsonc:76` 이 `REALTIME` 이 아니라 전혀 다른 DO(`RECORDS`)를 가리킴. 실제 `:74` |
| slop | 조건부 → 반려 | woodstack 을 `toLocaleString` 묶음에 잘못 포함(실제 `` `${v}층` ``) |
| podcast | 조건부 → 반려 | cron 위치 `:87`→`:47` 오기, 409 조건이 `failed`·stale 예외를 빠뜨림, 세션 시크릿 폴백 3단 중 2단만 |
| admin | 조건부 → 반려 | `agent-scope.conf:18`(실제 `:16`), `home-button.test.mjs:228`(실제 `:239`) |
| estate | 조건부 → 반려 | `_infra/estate.js:89` 의 함수명이 `kstNowYm` 이 아니라 `kstYearMonth` — grep 으로 못 찾아 같은 함수를 새로 만들 위험 |
| www | 조건부 → 반려 | 내용 전부 정확(에러 문구·마크업 원문 일치), 줄번호 4곳만 드리프트 |
| lab | 조건부 → 반려 | ① CLAUDE.md 가 공개 배포된다는 서술이 `ee2810a` 로 거짓이 됨 ② "풀다운·검색 미노출을 `home-button.test.mjs` 가 지킨다" — 그 테스트에 lab 이 아예 없다 |
| test | 조건부 → 반려 | 같은 배포 서술 뒤집힘 + 줄번호 2곳. `test/` 의 정체 설명과 `_infra/*.test.mjs` 혼동 경고는 리뷰어가 "모범적으로 정확"이라 평가 |
| puzzle | 조건부 → 반려 | 내용 32개 전부 정확(타임존 설명이 가장 엄밀). `build.mjs` 줄번호 4개만 드리프트 |

**조치**: 통과 3건 머지(`ed9fc17`·`5824da3`·`e704c62`). 조건부 14건은 리뷰어
메모를 붙여 각 구현 에이전트에게 반려하고 재리뷰 대기.

**이번 라운드에서 배운 것**
- **줄번호는 썩는다.** 조건부 14건 중 8건이 순수 줄번호 드리프트였고, 원인은
  전부 같은 커밋(`ee2810a`, `build.mjs` 에 +4줄)이다. 반려 시 "숫자 옆에
  앵커(함수·상수·테스트 제목)를 붙여라"를 공통 지시로 넣었고, puzzle 은 아예
  줄번호를 빼고 이름만 남겼다 — 그쪽이 옳다.
- **가장 값어치 있던 지적은 줄번호가 아니라 "없는 것을 있다고 적은" 세 건**
  (duri 의 30일 보존·툼스톤, idle 의 테스트 커버리지, lab 의 누출 검사).
  전부 다음 세션이 그대로 믿고 잘못 판단했을 종류다.

## 2026-08-12 07:30 KST · (머지 전 인프라 수정) · 머지

- **작업**: 서브도메인 CLAUDE.md 가 배포에 섞이지 않게 빌드 필터 확장.
- **근거**: `test` 구현 에이전트가 빌드는 `README.md` 만 거른다는 것을 발견했다
  (`_infra/build.mjs` 의 `notReadme`). 17개를 머지했으면 비공개 서브도메인의
  게이트·DO 바인딩·env 이름이 `<서브도메인>.bubblelab.dev/CLAUDE.md` 로
  열렸을 것이다. 필터를 `README|CLAUDE|AGENTS` 로 넓히고, dist 를 훑어 이 세
  이름이 없는지 보는 검사를 `home-button.test.mjs` 에 추가했다. 필터를
  되돌리면 실제로 빨개지는 것까지 확인했다(`slop/CLAUDE.md` 로 재현).
- **조치**: 머지(`ee2810a`). 오케스트레이터 소유 인프라라 Gate 대상 아님.

## 2026-08-12 02:03 KST · (워크플로 셋업) · 머지

- **작업**: 병렬 멀티 에이전트 워크플로 셋업 — 서브도메인별 worktree 레인,
  소유 범위 pre-commit 훅, Gate 리뷰어 체크리스트, 이 기록 파일.
- **근거**:
  - `bash _infra/agent-worktree.sh init` → 서브도메인 16개 레인 생성
    (`../worktrees/`), `git worktree list` 로 확인.
  - 레인 자족성: `worktrees/slop` 에서 `node _infra/build.mjs` 성공,
    `npm test` 617개 전부 통과.
  - 훅: `node --test _infra/agent-worktree.test.mjs` 11개 통과 — 남의
    서브도메인·남의 conf 파일·공용 인프라 커밋이 실제로 거부되는 것을
    임시 리포에 훅을 걸어 실기동으로 확인.
  - `docs/` 비배포: `node _infra/build.mjs` 출력의 사이트 목록에 docs 없음.
- **조치**: main에 직접 커밋(오케스트레이터 인프라, 리뷰 대상 아님).
  같은 작업 트리에서 동시에 진행 중이던 `_infra/invest.js`·`_infra/worker.js`·
  `_infra/build.mjs`의 타 세션 변경은 **스테이지하지 않았다** —
  `_infra/build.mjs`는 `git apply --cached` 로 내 훅 하나만 골라 넣었다.
