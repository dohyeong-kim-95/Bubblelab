# 🫧 Bubblelab

`bubblelab.dev`에서 운영하는 게임·도구·실험을 한곳에 모은 정적 사이트 모노레포입니다.

루트의 공개 폴더 하나가 서브도메인 하나에 대응합니다. `_` 또는 `.`으로 시작하는
폴더는 배포 대상에서 제외됩니다.

| 폴더 | 주소 | 내용 |
| --- | --- | --- |
| `www/` | <https://bubblelab.dev> | 메인 랜딩 |
| `slop/` | <https://slop.bubblelab.dev> | 짧은 게임과 실험 |
| `games/` | <https://games.bubblelab.dev> | 승격된 멀티·보드게임 |
| `idle/` | <https://idle.bubblelab.dev> | 7일 단위 방치형 게임 |
| `util/` | <https://util.bubblelab.dev> | 달력·운세·사진·플래너 |
| `invest/` | <https://invest.bubblelab.dev> | 반응형 개인 투자 터미널 데모 |
| `assets/` | <https://assets.bubblelab.dev> | 스티커·배경화면 카탈로그 |
| `admin/` | <https://admin.bubblelab.dev> | 통계·기록·공지 관리 화면 |

비공개 지원 폴더는 다음과 같습니다.

- `_shared/`: 모든 서브도메인에서 `/_shared/*`로 쓰는 공용 브라우저 모듈
- `_assets/`: 카탈로그 원본 이미지와 `metadata.json`
- `_src/`: Vite 등 별도 빌드가 필요한 프로젝트 소스
- `_infra/`: 빌드 스크립트, Cloudflare Worker, Durable Object와 테스트

## 빠른 작업 흐름

의존성이 없는 토이는 `index.html` 하나로 시작할 수 있습니다.

```bash
mkdir slop/my-idea
$EDITOR slop/my-idea/index.html
git add slop/my-idea
git commit -m "slop: add my idea"
git push
```

`main`에 반영되면 GitHub Actions가 테스트와 빌드를 거쳐 Cloudflare Worker에
배포합니다. `index.html`이 없는 공개 사이트 루트에는 하위 프로젝트 카드 페이지가
자동 생성됩니다. 카드는 기본적으로 이름순으로 만들어지고, 브라우저에서 최근 7일
방문량 순으로 재정렬됩니다.

검증된 토이는 다음처럼 승격할 수 있습니다.

```bash
git mv slop/my-idea games/my-idea
git commit -m "games: promote my idea"
git push
```

## 로컬 실행과 검증

Node.js 22 기준입니다.

```bash
npm ci
node --test _infra/*.test.mjs
node _infra/build.mjs
npx wrangler@4 dev --local --local-upstream localhost
```

예: <http://localhost:8787/slop/fruitmerge>

`--local-upstream localhost`를 빼면 Wrangler의 프로덕션 라우트 호스트가 적용되어
요청이 `www`로 라우팅될 수 있습니다.

## 배포 구조

```text
main push
  → infra tests
  → build.mjs가 dist/ 생성
  → wrangler deploy
  → 단일 Worker가 호스트명과 경로를 실제 파일·API·Durable Object로 라우팅
```

배포에는 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` GitHub Actions secret이
필요합니다. 운영 환경에는 `ADMIN_ID`, `ADMIN_PASSWORD`, `KASI_SERVICE_KEY`를
Worker secret으로 설정하고, 세션 키는 `ADMIN_SESSION_SECRET`과
`PLANNER_SESSION_SECRET`으로 분리할 수 있습니다. 자세한 API와 스토리지 구조는
[`_infra/README.md`](_infra/README.md)를 참고하세요.

## 저장소 규칙

- 실험은 먼저 `slop/`에 작게 올립니다.
- 공용 기능은 토이마다 복사하지 않고 `_shared/`에 둡니다.
- 빌드가 필요한 소스는 `_src/<name>/`, 배포 산출물은 공개 사이트 폴더에 둡니다.
- `games/avalon/`처럼 생성된 산출물은 직접 수정하지 않습니다.
- README 파일은 `dist/`에 복사되지 않으므로 운영 문서로 자유롭게 사용할 수 있습니다.
