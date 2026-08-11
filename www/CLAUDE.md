# www — bubblelab.dev 랜딩 (apex)

리포 전체 규칙은 루트 `CLAUDE.md`, 화면 설계 의도는 `www/README.md`. 여기는
**랜딩을 만질 때만 필요한 배경**만. 파일은 `www/index.html` 하나뿐이다.

## 이 폴더가 전체 빌드의 게이트다

`_infra/build.mjs`가 루트의 모든 서브도메인 폴더를 훑으면서 `www/index.html`에
`https://<폴더>.bubblelab.dev` 링크가 있는지 검사한다. 어긋나면 **빌드가 통째로
실패**한다 (build.mjs:61 — 랜딩 카드 검사 블록. 줄번호는 밀리니 앵커로 찾아라).

- 퍼블릭인데 카드가 없으면(build.mjs:70 throw):
  `public subdomain "<이름>" is missing from www/index.html — 랜딩에 카드를 추가하거나 _infra/build.mjs의 CONFIDENTIAL_SUBDOMAINS에 등록하세요`
- confidential(`CONFIDENTIAL_SUBDOMAINS`, build.mjs:29 —
  admin·work·podcast·estate·duri·test·invest·lab)인데 카드가 있으면(build.mjs:67 throw):
  `confidential subdomain "<이름>" must not be linked from www/index.html`

즉 **다른 사람이 새 폴더를 만들면 랜딩이 빌드를 막는다.** 내 잘못이 아닌 실패도
여기서 터지니, 메시지에 나온 폴더 주인에게 넘기거나 CONFIDENTIAL 등록 여부를
확인한다. 서브도메인으로 안 치는 루트 폴더는 `dist`·`node_modules`·`docs`·
`scripts` 뿐이라(build.mjs:25 `SKIP`), e2e 산출물처럼 새로 생기는 폴더는 반드시
`_` 로 시작하는 경로에 둔다(playwright.config.mjs:14 `outputDir`).

**이 CLAUDE.md 자체는 배포되지 않는다** — 빌드가 `README|CLAUDE|AGENTS.md` 를
복사에서 걸러낸다(build.mjs:54 `AGENT_DOCS`, 55 `notReadme`). 안 그러면
`<서브도메인>.bubblelab.dev/CLAUDE.md` 로 그대로 서빙된다.

## 로케일

- `<html lang="ko">`(index.html:2). 화면 문구는 전부 한국어.
- **카드 `<title>`이 곧 검색어다.** 빌드가 카드 페이지의 `<title>`을 뽑아 랜딩 색인에
  심으므로(build.mjs:246 `toyTitle`), 제목이 한국어가 아니면 한국어로 찾을 길이 없다.
- 랜딩에는 시간·통화·숫자 포맷 코드가 없다(KST 규칙은 카테고리 홈·워커 쪽 얘기다).

## 배포

배포는 리포 공통으로 `make ship`(= `/ship`) 한 줄. www 고유한 것만:

- **apex 라우팅**: `_infra/worker.js` 가 `bubblelab.dev`·`www.bubblelab.dev` 를
  `site = "www"` 로 풀고, 나머지는 호스트에서 서브도메인을 떼어낸다. 호스트가
  `bubblelab.dev` 계열이 아니면(로컬 wrangler dev) **첫 경로 세그먼트**를 쓴다
  (worker.js:1678 — `fetch` 안의 `host` → `site` 분기, 상수는 `ROOT_DOMAIN`).
  그래서 로컬 랜딩은 `http://localhost:8787/www/` 다 — `/` 가 아니다.
- **검색 색인은 빌드가 심는다**: `dist/www/index.html` 의
  `<script type="application/json" id="bl-cards">` 안을 통째로 갈아끼운다
  (build.mjs:643 — `generated landing search index` 를 찍는 블록). 태그를 지우거나
  형태를 바꾸면 빌드가 `www/index.html에 검색 색인 자리(<script id="bl-cards">)가
  없다` 로 죽는다. 소스의 `[]` 는 비워 둔 자리다 — 손으로 채우지 않는다. 색인은
  confidential 서브도메인과 `UNLISTED_ENTRIES` 를 카테고리 홈과 같은 기준으로
  뺀다 — **검색이 뒷문이 되면 안 된다.**
- **검색어 늘리기**: 제목에도 폴더 이름에도 없는 말로 찾게 하려면
  `_shared/search-rules.js:38` 의 `SYNONYMS` 에 한 줄 추가. 그 밖에 손댈 곳 없음.
- **라이브 검증**: `_infra/verify-prod.mjs` 의 `buildProbes` 에 apex 프로브 둘 —
  `www:search-index`(apex 200 + `id="bl-cards"` 존재)와 `www:404` (322·331줄).
  랜딩만: `bash scripts/verify-prod.sh --only www` (로컬은 `--base http://localhost:8787`).

## 테스트

```bash
node --test _infra/search-rules.test.mjs   # 검색 규칙 엔진 (화면 없이 규칙만)
node --test _infra/home-button.test.mjs    # 빌드 산출물 — 랜딩 색인 검사가 여기 있다
node _infra/build.mjs                      # 카드 존재 검사 + 색인 생성
```

- `_infra/home-button.test.mjs` 끝의 세 테스트가 www 몫이다(`landingIndex` 헬퍼
  아래, 211·225·239줄) — `"랜딩 검색 색인이 공개 카드로 채워진다"`(색인 40개 이상,
  `util/ladder` label 이 `사다리타기`), `"에이전트 문서(README·CLAUDE·AGENTS)는
  배포되지 않는다"`, `"비공개 서브도메인·감춘 카드는 검색 색인에도 없다"`.
  **dist를 굽는 테스트는 이 파일뿐이다** — 병렬 실행이라 두 곳에서 빌드하면 경합한다.
- e2e(`_infra/e2e/smoke.spec.mjs`): `SCREENS` 의 `{ name: "랜딩", path: "/" }` 와
  `"랜딩의 카테고리 링크가 모두 살아 있다"`(카드 href의 서브도메인을 로컬 경로로
  바꿔 전부 200인지) — 10·68줄.
- `npm test`·`npm run test:e2e` 등 전체 검증은 루트 `CLAUDE.md` 참고.

## 새 서브도메인이 생겼을 때 www가 할 일

`<ul class="cards" id="categories">`(index.html:91) 안에 **한 줄** 추가한다:

```html
<li><a class="card" style="--h:265" href="https://slop.bubblelab.dev"><span class="emoji">🧪</span><b>slop</b><small>방금 만든 것들. 대부분 여기서 시작해요.</small></a></li>
```

- `href` 는 `https://<폴더이름>.bubblelab.dev` — 빌드 검사가 이 문자열을 찾는다.
- `<b>` 는 폴더 이름 그대로. 스크립트가 이 값을 사이트 키로 읽어 소속 카드에
  색(`--h`)을 물려준다(index.html:110 `categories`/`hueOf`) — 다르면 기본값으로 떨어진다.
- `<small>` 설명도 검색 대상이니(가중치 0.7, search-rules.js:27 `FIELDS`) 카테고리를
  한국어로 찾게 하는 문장을 쓴다. `--h` 는 색상환 각도 — 옆 카드와 겹치지 않게.
- 비공개로 둘 폴더면 카드 대신 `CONFIDENTIAL_SUBDOMAINS` 에 등록한다(www 소유가
  아니니 해당 폴더 담당이 넣는다).
