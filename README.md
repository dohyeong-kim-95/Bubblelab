# 🫧 bubblelab

bubblelab.dev에서 서비스하는 모든 것이 사는 모노레포.

**루트 폴더 = 서브도메인.** 그게 전부예요.

```
/
├── www/       → https://bubblelab.dev            (랜딩)
├── slop/      → https://slop.bubblelab.dev       (실험장. 새 토이는 여기서 시작)
├── games/     → https://games.bubblelab.dev      (승격된 게임들. 아발론 등)
├── admin/     → https://admin.bubblelab.dev      (익명 방문 통계, 로그인 필요)
├── _shared/   → 모든 서브도메인 공용 에셋 (/_shared/* 로 서빙)
├── _src/      → 빌드가 필요한 것들의 소스 (배포 안 됨)
└── _infra/    → 워커·빌드·실시간 서버 (배포 안 됨)
```

규칙 하나: **`_`나 `.`로 시작하지 않는 루트 폴더는 전부 인터넷에 공개된다.**
새 카테고리(=새 서브도메인)는 폴더만 만들면 생긴다 — DNS·호스팅 설정 불필요.

## 일상 워크플로우

```bash
mkdir slop/my-idea
vim slop/my-idea/index.html      # 이모지 하나 + 공유 버튼 한 줄 넣기 (slop/README.md 참고)
git add . && git commit -m "slop: my-idea" && git push
# → 1분 안에 https://slop.bubblelab.dev/my-idea 라이브
```

승격: `git mv slop/my-idea games/my-idea && git push` — 끝.

## 로컬에서 보기

```bash
node _infra/build.mjs
npx wrangler@4 dev --local --local-upstream localhost
# http://localhost:8787/slop/my-idea   (첫 경로 세그먼트 = 서브도메인)
```

`--local-upstream localhost`가 없으면 라우트 설정 때문에 모든 요청이
apex(www)로 위장되니 꼭 붙일 것.

## 어떻게 돌아가나

푸시 → GitHub Actions(`.github/workflows/deploy.yml`) → 빌드 → Cloudflare
Workers 배포. 워커 하나가 `*.bubblelab.dev` 전체를 받아서 호스트명을 폴더로
매핑한다. 멀티플레이어 토이용 실시간 서버(`/_rt/*`)도 같은 워커에 있다.
자세한 건 [`_infra/README.md`](_infra/README.md).

## 재해 복구용 최초 설정 (이미 완료됨)

새 계정/도메인에서 처음부터 다시 세팅해야 할 때만 필요:

1. Cloudflare에 도메인 등록 (네임서버 이전)
2. DNS: `@`와 `*`에 `AAAA 100::` Proxied 레코드 2개
3. GitHub repo secrets: `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" 템플릿),
   `CLOUDFLARE_ACCOUNT_ID`
4. Cloudflare 계정에 workers.dev 서브도메인 등록 (Workers 메뉴 한 번 열면 됨.
   Durable Object 배포에 필수)

관리자 계정은 설정 전에는 `admin/admin`이다. 공개 저장소이므로 첫 배포 후 반드시
Cloudflare Worker secrets로 교체한다:

```bash
npx wrangler secret put ADMIN_ID
npx wrangler secret put ADMIN_PASSWORD
```

## 규칙 (미래의 나에게)

- slop에 올리는 건 완성도 신경 쓰지 말 것. 폴더 하나, index.html 하나면 충분.
- 남들이 쓰거나 내가 아끼게 되면 그때 `git mv`로 승격.
- 빌드가 필요한 물건은 소스를 `_src/<이름>/`에 두고 빌드 결과물만 사이트
  폴더에 커밋 (예: `_src/avalon/` → `games/avalon/`).
- 미리 복잡하게 만들지 말 것.
