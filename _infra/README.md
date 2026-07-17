# _infra — 빌드와 Cloudflare 런타임

Bubblelab의 정적 빌드, 단일 Cloudflare Worker, Durable Object 저장소와 Node 테스트를
관리합니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `build.mjs` | 공개 사이트·공용 파일을 `dist/`로 복사하고 카드 페이지와 404 생성 |
| `worker.js` | 호스트 라우팅, 공개 API, 관리자·플래너 세션 처리 |
| `security.js` | 동일 출처 검사, 보안 헤더, IP 원문을 남기지 않는 `RateLimiterDO` |
| `realtime.js` | 경로 기반 JSON 실시간 서버 `RealtimeDO` |
| `analytics.js` | 익명 방문 집계와 Slop 연속 방문 `AnalyticsDO` |
| `records.js` | 주간·개인·올타임 기록, 공지, 아이디어 우편함 `RecordsDO` |
| `planner.js` | 개인 코드별 이번 달 플래너 데이터 `PlannerDO` |
| `fortune.js` | KASI 양력·음력 변환과 사주 명식 응답 |
| `assets.js` | 저장소 이미지 메타데이터 검증과 카탈로그 생성 |
| `assets-store.js` | R2용 데이터 변환 코드. 현재 운영 라우트에서는 비활성 |
| `idle-balance.mjs` | Bubble Pop Idle 밸런스 시뮬레이터 |

`*.test.mjs`는 Node 내장 테스트 러너로 실행됩니다.

## 요청 라우팅

Worker는 다음 우선순위로 요청을 처리합니다.

| 경로 | 기능 |
| --- | --- |
| `/_shared/*`, `/_assets/*` | 모든 서브도메인의 공용 정적 파일 |
| `/_planner/login`, `/_planner/data`, `/_planner/logout` | 개인 플래너 세션과 데이터. 기본 비활성 |
| `/_fortune/chart` | 생년월일시를 명식·오늘 운세 계산용 데이터로 변환 |
| `/_stats`, `/_streak`, `/_engagement` | 최근 방문량, Slop 연속 방문, 카드 활성 체류시간 |
| `/_suggest` | 익명 토이 아이디어 제출 |
| `/_records`, `/_personal` | 주간·올타임·개인 기록 조회와 제출 |
| `/_rt/<namespace>` | namespace별 실시간 Durable Object. 기본 비활성 |
| 나머지 | 호스트명을 `dist/<site>/`에 매핑 |

예를 들어 `slop.bubblelab.dev/fruitmerge`는 `dist/slop/fruitmerge`로,
apex와 `www`는 `dist/www`로 연결됩니다. 로컬에서는 첫 경로 세그먼트가 사이트가
되어 `localhost:8787/slop/fruitmerge` 형식으로 접근합니다.

`admin`은 별도 처리되며 로그인 뒤 `/api/stats`, `/api/records`, `/api/notice`,
`/api/suggestions`를 제공합니다. `/api/assets`와 `/_assets/upload/*`는 현재 404로
닫혀 있습니다.

## 빌드

```bash
node _infra/build.mjs
```

빌드 결과:

- `_`·`.`으로 시작하지 않는 루트 폴더를 `dist/`로 복사
- `_shared/`와 `_assets/`를 공용 경로로 복사
- `_assets/*/*/metadata.json`을 검증해 `dist/_assets/catalog.json` 생성
- `index.html`이 없는 사이트 루트에 하위 폴더 카드 페이지 생성
- 카드에 주간 1위·개인 최고·인기순·연속 방문·아이디어 버튼 연결
- `dist/404.html` 생성
- 모든 README는 배포 결과에서 제외

## Durable Object

- `RealtimeDO`: Firebase RTDB와 비슷한 `get`, `set`, `update`, 구독,
  `onDisconnect`, 서버 타임스탬프를 WebSocket 위에 제공합니다. namespace별 JSON
  트리를 통째로 저장하므로 소규모 친구 게임에 맞춘 구조입니다.
- `AnalyticsDO`: IP와 User-Agent를 저장하지 않고 익명 방문자 쿠키 기준으로 HTML
  문서 방문을 멱등 집계합니다. 카드 페이지는 화면에 표시된 시간만 세션별 최대
  30분까지 누적하며 관리자 Insights에서 7일·30일 총 체류, 중앙값과 10초 이상
  체류율을 확인할 수 있습니다.
- `RecordsDO`: 월요일 09:00 KST 기준 주간 보드, 브라우저별 최고 기록, 올타임
  기록과 Bubble Pop Idle 시즌 역사를 보관합니다.
- `PlannerDO`: 개인 코드별로 KST 현재 달 데이터만 유지합니다.
- `RateLimiterDO`: Cloudflare가 확인한 클라이언트 IP를 HMAC 처리한 별도 버킷으로
  로그인·공개 쓰기·다운로드 집계 호출을 제한합니다. IP 원문은 저장하지 않으며
  버킷은 제한 시간이 지나면 alarm으로 삭제합니다.

## 설정과 보안

GitHub Actions:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Worker secrets:

- `ADMIN_ID`, `ADMIN_PASSWORD`: 운영 관리자 계정. 운영에서는 누락 시 fail-closed
- `KASI_SERVICE_KEY`: 운세의 양력·음력 변환
- `ADMIN_SESSION_SECRET`: 관리자 세션 서명과 rate-limit 식별자 분리 키
- `PLANNER_SESSION_SECRET`: 플래너 세션 서명 키

Worker vars:

- `ENABLE_REALTIME`: 기본 `false`. ACL 검토 없이 `true`로 바꾸지 않습니다.
- `ENABLE_PLANNER`: 기본 `false`. 코드 소유권·복구 정책을 정한 뒤에만 엽니다.

로컬에서만 관리자 기본값 `admin/admin`을 허용합니다. 플래너 코드는 복구할 수
없으며 생년월일시는 저장하지 않고 요청 시점에만 처리합니다. 비활성 기능의 소스와
직접 URL은 유지하지만, 카테고리 카드 목록에서는 노출하지 않습니다.

공개 API는 변경 메서드의 Origin·`Sec-Fetch-Site`, 선언된 본문 크기와 JSON
Content-Type을 검사합니다. 전역 응답에는 CSP, HSTS, `nosniff`, frame 차단,
Referrer·Permissions 정책을 붙입니다. 현재 정적 페이지 구조 때문에 CSP의 inline
script/style 허용은 과도기적으로 남아 있으며 향후 nonce 또는 외부 파일화가
추가 보강 항목입니다.

## 로컬 검증

```bash
npm ci
node --test _infra/*.test.mjs
node _infra/build.mjs
npx wrangler@4 dev --local --local-upstream localhost
```

배포 워크플로우는 `main` push에서 Node 22로 의존성을 설치하고, 인프라 테스트와
빌드가 성공한 뒤 Wrangler 4로 배포합니다.
