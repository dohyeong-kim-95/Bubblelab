# bubblelab 모노레포 — 에이전트 온보딩

이 파일만 읽으면 작업 시작에 충분하다. **리포 전체를 탐색하지 말 것.**
특정 폴더를 수정할 때만 그 폴더의 README.md를 추가로 읽어라.

## 핵심 규칙

- **루트 폴더 = 서브도메인**: `slop/` → slop.bubblelab.dev, `games/` →
  games.bubblelab.dev, `www/` → bubblelab.dev(apex). 새 폴더 = 새 서브도메인
  (설정 불필요).
- `_`나 `.`로 시작하는 폴더는 배포되지 않는다 (`_infra`, `_src`, `_shared`는
  각각 인프라, 빌드 소스, 공용 에셋).
- 토이 하나 = 폴더 하나 (`slop/이름/index.html`). 의존성·빌드 도구 없는
  바닐라 HTML이 기본. 카테고리 홈의 카드 목록은 자동 생성된다.
- **`games/avalon/`은 빌드 산출물 — 직접 수정 금지.** 소스는 `_src/avalon/`,
  수정 후 `_src/avalon/rebuild.sh` 실행해서 산출물을 갱신·커밋한다.
- main에 push하면 GitHub Actions가 자동 배포한다 (~1분). PR 불필요,
  main에서 직접 작업한다.

## 토이 작성 관례

- 파일 안에 이모지 하나 (카드 아이콘으로 자동 추출됨)
- `</body>` 직전에 `<script defer src="/_shared/share.js"></script>` (공유 버튼)
- 기록 자랑 문구: `window.blShareText = () => "내 기록은 X! 도전해보세요";`
- 주간 신기록 보드(월요일 09시 KST 초기화): `window.blWeekly = { game: "이름",
  dir: "min|max", fmt: v => … }` 선언 + `<script defer
  src="/_shared/records.js"></script>` 추가 후, 기록이 나올 때마다
  `window.blWeeklyReport?.(점수)` 호출. **추가로 `_infra/records.js`의
  `GAMES`에 dir·점수 범위 한 줄 등록** (서버가 방향·범위를 고정한다 —
  미등록 게임의 제출은 거절됨).
- 다크모드: `:root { color-scheme: light dark; }` + `light-dark()` 함수
- 언어는 한국어, 스타일은 ui-monospace 계열의 가벼운 느낌

## 검증 방법

```bash
node _infra/build.mjs        # 빌드 (dist/ 생성, 에러 없어야 함)
npx wrangler@4 dev --local --local-upstream localhost   # 로컬 서빙
# http://localhost:8787/slop/이름  (첫 경로 세그먼트 = 서브도메인)
```

`--local-upstream localhost` 필수. 배포 결과는 GitHub Actions run의
conclusion으로 확인한다.

## 멀티플레이어가 필요하면

자체 실시간 서버(Durable Object)가 `/_rt/<이름>` 에 있다 (Firebase RTDB
서브셋: 경로 트리 + 구독 + onDisconnect). 클라이언트 어댑터 예시는
`_src/avalon/src/firebase.js` — 복사해서 시작하면 된다. 외부 서비스를
추가하지 말 것.

## 더 읽을 것 (필요할 때만)

- 배포/워커/빌드 파이프라인 내부: `_infra/README.md`
- 아발론 이력·재빌드: `_src/avalon/MIGRATION.md`
- 사람용 전체 안내: `README.md`
