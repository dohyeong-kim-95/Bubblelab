# 🫧 bubblelab

bubblelab.dev에서 서비스하는 모든 것이 사는 모노레포.

**루트 폴더 = 서브도메인.** 그게 전부예요.

```
/
├── www/                → https://bubblelab.dev
├── slop/               → https://slop.bubblelab.dev        (자동 목록 페이지)
│   └── bubble-pop/     → https://slop.bubblelab.dev/bubble-pop
├── games/              → https://games.bubblelab.dev       (폴더 만들면 생김)
└── _infra/             → `_`나 `.`로 시작하는 폴더는 배포 안 됨
```

## 일상 워크플로우

```bash
mkdir slop/my-idea
vim slop/my-idea/index.html
git add . && git commit -m "slop: my-idea" && git push
```

main에 푸시하면 GitHub Actions가 자동 배포하고, 1분 안에
`https://slop.bubblelab.dev/my-idea` 가 라이브됩니다.
slop 홈에는 최신순으로 자동으로 링크가 뜹니다 (직접 index.html을 만들면 그걸 씁니다).

### 승격

```bash
git mv slop/my-idea games/my-idea && git push
# → https://games.bubblelab.dev/my-idea
```

새 카테고리(= 새 서브도메인)도 **아무 설정 없이** 폴더만 만들면 생깁니다.
와일드카드 라우트(`*.bubblelab.dev`)가 워커 하나로 다 받기 때문이에요.

전용 서브도메인을 갖는 토이도 가능: `/my-idea/` → `my-idea.bubblelab.dev`.

## 동작 방식

- Cloudflare Worker 하나(`_infra/worker.js`)가 모든 요청을 받아
  호스트명을 `dist/` 안의 폴더로 매핑합니다. (`slop.bubblelab.dev/x` → `dist/slop/x`)
- `_infra/build.mjs`가 루트의 사이트 폴더들을 `dist/`로 복사하면서, index.html이
  없는 서브도메인 루트에 하위 폴더 목록 페이지와 404 페이지를 자동 생성합니다.
- 정적 파일만 있으면 되므로 빌드 도구/의존성이 전혀 없습니다.

## 최초 1회 설정

1. **Cloudflare에 bubblelab.dev 등록** — 도메인 네임서버를 Cloudflare로.
2. **DNS 레코드 2개** (워커 라우트가 동작하려면 프록시된 레코드가 있어야 함):
   - `AAAA` / 이름 `@` / 값 `100::` / Proxied ✅
   - `AAAA` / 이름 `*` / 값 `100::` / Proxied ✅
3. **GitHub Secrets** (repo Settings → Secrets → Actions):
   - `CLOUDFLARE_API_TOKEN` — Cloudflare 대시보드에서 "Edit Cloudflare Workers" 템플릿으로 발급
   - `CLOUDFLARE_ACCOUNT_ID` — 대시보드 우측에서 확인
4. main에 푸시 → 끝. 이후로는 신경 쓸 것 없음.

## 로컬에서 보기

```bash
node _infra/build.mjs && npx wrangler dev
# http://localhost:8787/slop/bubble-pop  (로컬에선 첫 경로 세그먼트가 서브도메인 역할)
```

## 규칙 (미래의 나에게)

- slop에 올리는 건 완성도 신경 쓰지 말 것. 폴더 하나, index.html 하나면 충분.
- 남들이 쓰거나 내가 아끼게 되면 그때 카테고리로 `git mv`.
- 루트에 만드는 폴더는 전부 인터넷에 공개된다는 것 잊지 말 것.
  배포하면 안 되는 건 `_`로 시작하는 폴더에.
- 빌드가 필요한 물건이 생기면 그 폴더 안에서 빌드해서 결과물만 커밋하거나,
  그때 가서 워크플로우에 스텝 하나 추가. 미리 복잡하게 만들지 말 것.
