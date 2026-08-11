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
