# _infra — 인프라 전부

파일 세 개 + 워크플로우 하나가 전부다.

## worker.js — 라우터

모든 요청을 받는 단일 Cloudflare Worker. 우선순위 순서로:

1. `/_rt/<이름>` → 실시간 서버 (아래 realtime.js). 이름당 Durable Object 하나.
2. `/_records` → 주간 신기록 보드 (records.js, RecordsDO). GET `?game=`
   또는 배치 `?games=a,b,c`(카테고리 홈 카드용), POST `{game, nick, score,
   text}`. 게임별로 이번 주(월 09시 KST 시작) 1위 하나만 저장, 비교
   방향과 점수 범위는 records.js의 `GAMES` 테이블이 고정한다 (새 게임은
   여기 한 줄 등록). 클라이언트는 `_shared/records.js`.
3. `/_suggest` → 토이 아이디어 우편함 제출 (RecordsDO에 저장, 방문자당
   하루 5건). 카테고리 홈의 💡 버튼(`_shared/suggest.js`)이 사용하고,
   조회·삭제는 admin의 `/api/suggestions`.
4. `/_shared/*` → 공용 코드, `/_assets/*` → 정적 이미지와 R2 관리자 업로드.
   어느 서브도메인에서든 같은 파일을 사용한다. 관리자 업로드 API는
   `admin.bubblelab.dev/api/assets`이며 기존 관리자 세션 뒤에서만 동작한다.
5. 나머지 → 호스트명 라우팅: `slop.bubblelab.dev/x` → `dist/slop/x`,
   apex와 www는 `dist/www`.
   로컬 개발(호스트가 *.bubblelab.dev가 아닐 때)은 첫 경로 세그먼트가
   서브도메인 역할: `localhost:8787/slop/x` → `dist/slop/x`.

Planner는 `/_planner/login`, `/_planner/data`, `/_planner/logout` API와
`PlannerDO`를 사용한다. 사용자가 숫자 6자리와 영문 2자로 개인 코드를 만들며,
코드마다 별도 Durable Object가 배정된다. 세션 서명 전용 secret을 따로 쓰려면:

```bash
npx wrangler secret put PLANNER_SESSION_SECRET
```

설정하지 않으면 기존 `ADMIN_SESSION_SECRET` 또는 관리자 계정 secret에서 서명 키를
파생한다. 데이터는 KST 기준 현재 달만 보존하며 같은 개인 코드를 입력한 PC 편집
화면과 모바일 조회 화면이 같은 저장소를 사용한다. 코드는 복구할 수 없다.

## build.mjs — 빌드

`node _infra/build.mjs` 하면:

- 루트의 사이트 폴더들(`_`/`.` 미시작)을 `dist/`로 복사 (README.md 제외)
- `_shared/` → `dist/_shared/`
- `_assets/` → `dist/_assets/`, 각 아이템 `metadata.json`을 합친 카탈로그 생성
- index.html이 없는 사이트 루트에 하위 폴더 카드 그리드 페이지 자동 생성
  (이모지는 각 토이 index.html의 첫 이모지. 순서는 주간 접속량순 —
  기본은 가나다순으로 생성하고 클라이언트가 `/_stats`로 재정렬)
- `dist/404.html` 생성

의존성 제로. Node만 있으면 된다.

## realtime.js — 실시간 데이터 서버 (Durable Object)

Firebase RTDB의 서브셋을 WebSocket 위에 구현: 경로 기반 JSON 트리,
get/set/update, 경로 구독(onValue), 접속 종료 시 쓰기(onDisconnect),
서버 타임스탬프 치환(`{".sv":"timestamp"}`).

- 접속: `wss://<아무 서브도메인>/_rt/<이름>` — 이름마다 독립된 트리
- 프로토콜: 파일 상단 주석 참고
- 사용 예: 아발론의 `_src/avalon/src/firebase.js`가 이걸 쓰는 클라이언트
  어댑터. 새 멀티플레이어 토이 만들 땐 그 파일을 복사해서 시작하면 된다.

트리는 DO 스토리지에 통짜 JSON으로 저장된다. 친구들끼리 하는 게임 규모용이지
대규모 트래픽용이 아니다 (그때 가서 고민할 것).

## deploy.yml (.github/workflows/)

main에 푸시하면: checkout → build.mjs →
`wrangler deploy`. 시크릿 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` 사용.
wrangler 버전 4 고정 (3.x는 wrangler.jsonc를 못 읽음).

## 로컬 개발

```bash
node _infra/build.mjs
npx wrangler@4 dev --local --local-upstream localhost
```

`--local-upstream localhost` 필수 — 없으면 wrangler가 라우트 패턴 호스트
(bubblelab.dev)로 요청을 위장시켜서 전부 www로 라우팅된다.
Durable Object도 로컬에서 그대로 돈다.
