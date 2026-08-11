# test/ — 데이터랩 (데이터사이언스 문제은행)

**이름에 속지 말 것. 여기는 단위 테스트 폴더가 아니다.** 리포의 단위 테스트는
`_infra/*.test.mjs`(+ `_src/duri-sink/*.test.mjs`)이고 `npm test`가 그것만 돌린다
(`package.json` scripts.test). `test/`는 test.bubblelab.dev 로 **배포되는 서브도메인**
— 빅데이터분석기사/ADP 실기 스타일 문제를 브라우저 안 파이썬(Pyodide/WASM)으로 푸는
정적 웹앱이다. 여기 파일을 고쳐도 `npm test`는 아무것도 검증하지 않는다.

구조·문제 추가 규칙·실전 모드 동작은 `test/README.md`에 있다(그쪽이 원본). 리포 공통
규칙은 루트 `CLAUDE.md`. 이 파일에는 **매번 다시 물어봤던 배경만** 적는다.

## 정체와 경계

- 순수 정적 페이지 3장 + 스크립트 2장: `index.html` / `solve.html` / `exam.html` +
  `problems.js`(문제은행, `window.DS_PROBLEMS`) / `runtime.js`(Pyodide·채점·시험 연동).
- **서버가 없다.** 전용 라우트도, Durable Object도, `ENABLE_*` var도 없다
  (`wrangler.jsonc`의 routes/durable_objects/vars에 test 항목 없음). 채점은 전부
  클라이언트에서 돌고, 진행 상황은 localStorage에만 남는다.
- 따라서 **모범답안이 브라우저에 그대로 실려 나간다** — `problems.js`의 `solution`
  문자열이 공개 자산이다. 정답 은닉은 설계상 불가능하고, 엄격 모드
  (`test/runtime.js:321` — `strictNow()` 의 반환식, 선언은 `:318`)는 화면 표시만 가린다.
- 워커에서 test를 특별 취급하는 곳은 **CSP 완화 한 군데뿐**:
  `_infra/security.js:32-54` (`PYODIDE_CSP` / `isPyodideSite`) 가
  `test.bubblelab.dev`(및 로컬 `/test/…`)에 한해 `cdn.jsdelivr.net` + `wasm-unsafe-eval`을
  허용한다. Pyodide는 `v0.27.2`를 CDN에서 로드한다(`test/runtime.js:6`
  `PYODIDE_INDEX_URL`, `test/solve.html:106`) — 버전을 올리면 이 CSP·두 경로를 함께 본다.

## 로케일

- 언어 ko-KR: 세 페이지 모두 `<html lang="ko">`, UI·문제 지시문·카테고리명 전부 한국어.
- **시간대 의존 코드가 없다.** 시험 타이머는 절대시각 차이만 쓴다
  (`exam.html:73` `DURATION_MS = 180*60*1000`, `startedAt`/`endsAt` + `Date.now()`).
  KST 변환도, 주간 기록(`_shared/records.js`)도 쓰지 않는다 — 토이 관례 비적용.
- 통화·숫자 표기 규칙은 **해당 없음**: 화면에 `toLocaleString`/`Intl.NumberFormat`/
  통화 기호가 하나도 없다. 가격은 문제 데이터 안의 숫자일 뿐이다.
- localStorage 키(바꾸면 사용자 진행 상황이 날아간다): `bl-ds-progress-v1`,
  `bl-ds-exam-v1`, `bl-ds-exam-strict-pref`, 셀 저장 `bl-ds-cells-v1-<id>` /
  시험용 `bl-ds-exam-cells-<id>` (`runtime.js:7-8,306`, `exam.html:70-72`).

## 배포

- 배포 절차는 리포 공통 — `make ship`(또는 `/ship`). test 전용 단계는 없다.
- **비공개 서브도메인**: `_infra/build.mjs:29` (`CONFIDENTIAL_SUBDOMAINS`) 에 있다.
  랜딩(www)에 카드를 만들면 **빌드가 실패한다**(`_infra/build.mjs:67` 랜딩 링크 검사).
  카테고리 홈 풀다운과 랜딩 검색 색인에도 나오면 안 되고,
  `_infra/home-button.test.mjs:166` (풀다운 누출 검사) 와 `:242` (검색 색인 누출 검사) 가
  이를 강제한다.
  로그인 게이트는 **없다**(`_infra/verify-prod.mjs:22` `GATED_SITES`에 test 없음) —
  주소를 아는 사람은 누구나 들어온다. "감춰져 있을 뿐 비밀은 아니다."
- 라이브 검증: `verify-prod.mjs`가 폴더 목록에서 자동으로 잡아 `site:test` 프로브를
  만든다(첫 화면 200 · text/html · 본문 500바이트 초과 · `<title>` 존재 · 오류 문구 없음,
  `_infra/verify-prod.mjs:295` `id: site:${site}` 프로브). 이것만 따로 보려면
  `bash scripts/verify-prod.sh --only site:test`.

## 검증 (전용 단위 테스트 없음)

`problems.js`/`runtime.js`를 직접 실행·채점하는 테스트는 **없다**(`_infra` 어디에서도
`DS_PROBLEMS`를 읽지 않는다). e2e 스모크 대상 화면 목록
(`_infra/e2e/smoke.spec.mjs`의 `SCREENS`)에도 test 화면은 없다. 간접적으로 걸리는 것은
두 가지뿐이다:

- `_infra/security.test.mjs:79` (test 호스트 CSP 완화 검사) — test 호스트에서만
  jsDelivr·wasm이 열리는지
- `_infra/home-button.test.mjs` — 풀다운·검색 색인에 새지 않는지

그래서 실제 검증은 손으로 한다:

```bash
node _infra/build.mjs                                    # 빌드가 깨지지 않는지
npx wrangler@4 dev --local --local-upstream localhost     # http://localhost:8787/test/
```

문제를 추가·수정했으면 브라우저에서 그 문제를 열어 **setup→모범답안 체인이 실제로
돌고 `check.step()`이 통과하는지** 확인한다. 무작위성 있는 연산은 `random_state`를
고정한다(README의 문제 추가 규칙 참고).

## 잔가시

- **이 파일(과 `README.md`·`AGENTS.md`)은 배포에서 빠진다** — 빌드가 세 이름을 걸러
  내고(`_infra/build.mjs:54` `AGENT_DOCS`, 복사 필터 `notReadme`),
  `_infra/home-button.test.mjs:225` (에이전트 문서 배포 누출 검사) 가 dist를 훑어
  하나라도 섞이면 실패한다. 다만 **`test/`의 나머지 파일은 전부 공개된다** — 위의
  모범답안 노출과 같은 이야기다. `problems.js`·`runtime.js`·HTML 어디에도 비밀
  (토큰·자격증명·미공개 주소)을 적지 말 것. 이 파일이 안 나간다고 옆 파일이
  안전해지는 것은 아니다.
- 대문제(`kind: "big"`)는 `sections[].steps`를 `problems.js` 끝의 평탄화 루프가 펼쳐
  일반 문제와 같은 런타임을 태운다. 단계 id는 파일 전체가 아니라 **문제 안에서** 유일해야
  하고, 섹션끼리 변수명(`df_a`, `df_b`…)이 겹치면 채점이 조용히 틀어진다.
