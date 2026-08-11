# 병렬 멀티 에이전트 개발 워크플로

서브도메인마다 격리된 worktree("레인")에서 구현 에이전트를 동시에 돌리고,
적대적 Gate 리뷰어가 통과시킨 브랜치만 main에 머지한다.

**`docs/` 는 서브도메인이 아니다** — `_infra/build.mjs`의 `SKIP`에 들어 있어
배포되지 않는다(`_infra/agent-worktree.test.mjs`가 고정한다).

---

## 왜 레인인가

예전에는 모두가 같은 작업 트리를 썼다. `git add -A` 한 번이면 옆 터미널의
미완성 변경이 남의 커밋에 딸려 들어갔다. 레인에서는 **그게 물리적으로
불가능하다** — 각 레인은 `origin/main`에서 깨끗하게 시작한 별도 체크아웃이라,
다른 세션의 미커밋 변경은 그 디스크에 존재하지 않는다.

방어선은 두 겹이다.

1. **레인 격리** — 남의 변경이 애초에 그 트리에 없다.
2. **`pre-commit` 훅** — 자기 소유 밖의 파일은 스테이지돼도 커밋되지 않는다.
   (`_infra/agent-hooks/pre-commit` + `_infra/agent-scope.conf`)

훅은 `core.hooksPath` 리포 설정으로 켜진다. 설정은 커밋되지 않으므로
`agent-worktree.sh` 가 실행될 때마다 다시 켠다. 새로 클론했다면 한 번:

```bash
git config core.hooksPath _infra/agent-hooks
```

## 배치

```
agent_coding/
├─ Bubblelab/              ← main 체크아웃. 오케스트레이터(머지·기록)만 쓴다
└─ worktrees/
   ├─ admin/  assets/  duri/  espanol/  estate/  games/  idle/  invest/
   ├─ mindfulness/  podcast/  puzzle/  slop/  test/  util/  work/  www/
   └─ (서브도메인당 하나. 레인은 계속 재사용, 브랜치만 작업마다 갈아탄다)
```

- 레인 하나 ≈ 166MB + node_modules 19MB. 전부 만들면 약 2.9GB.
- `node_modules`는 **복사**다(심링크 아님) — 한 레인의 `npm ci` 가 다른 레인이
  쓰는 트리를 갈아엎지 않게.

```bash
_infra/agent-worktree.sh init                      # 레인 전체 생성(멱등)
_infra/agent-worktree.sh task <서브도메인> <슬러그>  # 레인을 새 작업 브랜치로
_infra/agent-worktree.sh list
_infra/agent-worktree.sh remove <서브도메인> [--force]
```

브랜치 이름은 항상 **`agent/<서브도메인>/<슬러그>`** 다. 훅이 이 이름에서
소유 서브도메인을 읽으므로 규칙을 벗어나면 보호가 꺼진다.

## 소유 범위

기본 규칙(훅에 내장):

| 범위 | 예 |
| --- | --- |
| `<이름>/**` | `duri/index.html` |
| `_infra/<이름>.*`, `_infra/<이름>-*` | `_infra/duri.js`, `_infra/podcast-ai.js` |
| `_src/<이름>/**`, `_src/<이름>-*/**` | `_src/duri-sink/` |

이름이 서브도메인과 다른 파일(`util` → `_infra/brief.js`, `work` →
`_infra/emoticon*`, `assets` → `_infra/wallpaper.mjs` …)은
**`_infra/agent-scope.conf`** 에 명시돼 있다. 테스트가 그 경로들이 실재하는지
검사하므로 파일을 옮기면 conf도 같이 고쳐야 한다.

**공용 등록 파일**(`www/index.html`, `_infra/worker.js`, `_infra/records.js`,
`_infra/build.mjs`, `_shared/search-rules.js`, `_infra/e2e/smoke.spec.mjs`,
`wrangler.jsonc`, `package.json`)은 커밋되지만 훅이 경고한다. 여기가 병렬
머지의 유일한 충돌 지점이다 — 각자 **한 줄만** 더하고, 순서는 오케스트레이터가
잡는다.

어디에도 속하지 않는 공용 인프라(`_infra/security.js`, `webpush.js`,
`realtime.js`, `home-button.test.mjs`, `_shared/` 대부분)는 **에이전트가 못
건드린다.** 필요하면 오케스트레이터가 별도로 처리한다.

## 흐름

```
작업 목록
   │
   ├─ 서브도메인당 구현 에이전트 1명 (병렬)
   │    레인 체크아웃 → 자기 서브도메인만 읽기 → 구현 → 테스트 작성·실행
   │    → 커밋 → 브랜치 push.  머지하지 않는다.
   │
   ├─ Gate 리뷰어 (별도 에이전트, 적대적 권한)
   │    브랜치마다 독립 검증 → 통과 / 조건부 / 불통과 + 근거
   │    체크리스트: docs/review-checklist.md
   │
   ├─ 통과 → 오케스트레이터가 main에 머지
   ├─ 조건부 → 리뷰어 메모를 붙여 구현 에이전트에게 반려 → 재리뷰
   └─ 불통과 → 브랜치 폐기 또는 재설계
   │
   └─ 모든 판정을 docs/decisions.md 에 기록 (시각·브랜치·판정·근거)
```

### 각 역할의 경계

- **구현 에이전트**는 자기 레인 밖을 읽지 않는다. main 체크아웃도 보지 않는다
  (다른 세션의 미완성 변경이 있다).
- **구현 에이전트는 머지하지 않는다.** `main`을 체크아웃하지도, push하지도
  않는다. 자기 브랜치만 push한다.
- **리뷰어는 구현 에이전트와 말하지 않는다.** 브랜치와 diff만 본다. 구현
  에이전트가 "테스트 통과했다"고 한 것은 근거가 아니며, 직접 돌려서 확인한다.
- **오케스트레이터(사람 또는 메인 세션)만** 머지하고 `docs/decisions.md`를 쓴다.

### 머지 순서

여러 브랜치가 통과하면 **공용 파일을 건드리는 브랜치를 하나씩** 머지한다.
각 머지 뒤에 `npm test` + `node _infra/build.mjs`를 다시 돌린다 — 개별로는
통과했지만 합쳤을 때 깨지는 경우(같은 등록 목록의 두 줄, 같은 CSS 셀렉터)가
여기서 잡힌다.

머지 후 `_infra/agent-worktree.sh task <서브도메인> <다음슬러그>` 로 레인을
새 브랜치에 다시 올린다(항상 최신 `origin/main`에서 시작한다).

## 검증

```bash
npm test                # 인프라 단위 테스트 (기준선 617개 + 신규)
node _infra/build.mjs   # dist/ 생성, 에러 없어야 함
npm run test:e2e        # 화면을 건드렸으면
```

세 가지 모두 **레인 안에서** 돈다 — 레인은 자족적인 체크아웃이다.
