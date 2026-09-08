# sktest PDF 연습실 — 코드 검토 메모

대상: `sktest/workbook/` (SKCT 연습실의 "내 PDF로 연습" 화면)
검토 시점: 2026-09-09, `a3fcd6f` 기준

배포·기능 설명은 `sktest/README.md` 에 있다. 이 문서는 **코드를 읽고 나온
개선 후보**만 적는다. 지금 라이브는 정상 동작한다 — 여기 적힌 것 중 서비스가
깨져 있는 항목은 없다.

## 구성 요약

```
workbook/index.html   3분할 그리드(PDF · OMR · 도구) + dialog 2개
workbook/app.js       257줄, 화면 배선 전부
workbook/core.js      parseAnswerKey / gradeAnswers — 순수 함수, 테스트 대상
../core.js            deviceStatus / remainingSeconds / calculate 공유
```

잘 되어 있어서 **건드리지 말아야 할 것**부터 적는다:

- **로컬 바이트 전용.** `file.arrayBuffer()` → `Uint8Array` → `getDocument({ data })`.
  `createObjectURL` 도 fetch 도 없어서 네트워크 경로 자체가 없다.
- **`isEvalSupported: false`** (`app.js:147`). PDF.js 가 폰트 프로그램에 쓰는
  eval 을 끄고, CSP 에는 `'unsafe-eval'` 없이 `'wasm-unsafe-eval'` 만 열었다
  (`_infra/security.js:152`). 이 짝을 깨지 말 것.
- **버전 카운터 두 개.** `fileVersion` 은 로딩 중 다른 파일 선택,
  `renderVersion` 은 페이지·확대 연타의 레이스를 막는다. 늦게 끝난 콜백이
  화면을 덮어쓰지 않게 하는 유일한 장치다.
- **캔버스 픽셀 상한** `Math.min(devicePixelRatio, 2, √(16e6 / 면적))`
  (`app.js:175`). 큰 페이지를 300% 로 열어도 캔버스가 터지지 않게 하는 계산.
- **벽시계 타이머.** 백그라운드 탭에서 `setInterval` 이 throttle 돼도 안 밀린다.

## 고칠 것

### 1. `const document` 섀도잉 — `app.js:151`

```js
loading = task; const document = await task.promise;
```

파일 열기 핸들러 안에서 전역 `document` 를 가린다. 지금 동작하는 건 그 핸들러가
전역 `document` 를 직접 안 쓰기 때문이다(`$` 는 모듈 스코프에서 닫혀 있다).

이 핸들러 안에 `document.` 한 줄만 새로 넣으면 **151행 위쪽이면 TDZ
ReferenceError, 아래쪽이면 PDFDocumentProxy 를 DOM 으로 착각**한다. 재현이
어렵고 원인이 안 보이는 종류의 사고다.

고치기: `const doc = await task.promise;` 로 이름만 바꾸면 끝. 아래 두 줄
(`pdf = document`)도 같이 바꾼다.

### 2. workbook OMR 에 키보드 입력이 없다

루트 연습실은 `1`–`5` 로 답을 고르고 `Alt+←/→` 로 이동한다
(`sktest/app.js:176`). 그런데 workbook 은 단축키가 하나도 없어서 **100문항을
전부 마우스로 클릭**해야 한다. 실전은 키보드를 쓰는 화면이니, 개선 하나만
고른다면 이것이 가장 효과가 크다.

붙일 때 지켜야 할 것:

- 입력란(`#book-memo`, `#book-calc`, `#answer-key`) 포커스 중에는 문항
  단축키가 먹지 않아야 한다. 루트 화면이 이미 같은 조건을 처리한다.
- "지금 몇 번" 커서 개념이 없으므로 커서 상태를 새로 만들거나, 포커스된
  `.omr-row` 를 기준으로 삼아야 한다. 후자가 상태를 안 늘린다.
- `state` 가 `paused|ended|graded` 면 무시해야 한다(답안 잠금).

### 3. 이 워킹 트리에서 `node _infra/build.mjs` 가 죽는다

`_infra/build.mjs:87` 이 sktest 폴더가 있으면 무조건
`node_modules/pdfjs-dist` 에서 복사하는데, 이 트리에 pdfjs-dist 가 없다:

```
ENOENT: .../node_modules/pdfjs-dist/build/pdf.min.mjs
```

CI·배포는 항상 `npm ci` 를 먼저 돌리니 **프로덕션은 멀쩡하다.** 문제는
CLAUDE.md 의 검증 절차에 `node _infra/build.mjs` 가 그대로 적혀 있다는 것 —
다른 서브도메인을 만지던 세션이 이걸 돌리면 sktest 때문에 죽고, 메시지는
맨 ENOENT 스택이라 `npm ci` 를 하라는 안내가 없다.

둘 중 하나:

- CLAUDE.md 검증 항목에 jpeg-js 처럼 "sktest 는 `npm ci` 필요" 한 줄 추가, 또는
- vendor 복사를 `existsSync` 로 감싸고 없으면 경고만 남기고 건너뛰기.
  단, 이 경우 **배포 경로에서는 건너뛰면 안 된다** — vendor 없이 배포되면
  PDF 열기가 통째로 죽는다. 건너뛴 빌드로 ship 하지 않게 막는 장치가 같이 필요.

### 4. 클릭마다 OMR 600개 노드를 재생성한다

`renderOMR()` 은 `replaceChildren` 으로 100행 × (번호 + 버튼 5개)를 통째로
다시 만든다. 그래서 스크롤 위치(`app.js:42`)와 포커스(`app.js:81`)를 손으로
복원하는 코드가 붙어 있다 — 이미 한 번 밟은 흔적이다.

600개면 체감 지연은 없다. 다만 답을 고를 때마다 포커스가 날아갔다 돌아오는
구조라 스크린리더에서는 거슬릴 수 있고, 2번(키보드 입력)을 붙이면 이 재생성이
커서 상태와 얽힌다. **2번을 할 때 같이 보는 것이 맞고, 단독으로 손댈 이유는 없다.**

## 알아 둘 것 (고칠 것 아님)

- **확대율 100% 는 실제 크기가 아니라 폭 맞춤이다.** `fit` 을 먼저 구하고
  `zoom` 을 곱하는 구조(`app.js:173`)라 50–300% 는 폭 맞춤 기준 배율이고,
  `폭 맞춤` 버튼은 `zoom = 1` 일 뿐이다. 실제 크기 배율로 바꾸려면 라벨과
  하한·상한을 같이 다시 정해야 한다.
- `standard_fonts/FoxitSans.pfb` 는 404 지만 정상이다. PDF.js 6 에서 표준 폰트가
  Liberation/Nimbus 계열로 바뀌었다 — `LiberationSans-Regular.ttf` 는 200 이다.
- 다크모드가 없는 것은 의도다. sktest 는 토이가 아니라 `NO_SHARED_SCRIPTS`·
  `CONFIDENTIAL_SUBDOMAINS` 쪽이라 토이 관례(다크모드·share.js)를 따르지 않는다.

## 손댈 때 검증

```bash
npm ci                       # pdfjs-dist 가 있어야 빌드가 돈다
npm test                     # _infra/sktest.test.mjs 6건 + home-button 미노출 검사
node _infra/build.mjs
node _infra/csp-serve.mjs    # /sktest/workbook/ — 실제 CSP 아래에서 봐야 한다
```

`csp-serve` 를 쓰는 이유: 일반 `wrangler dev` 에는 `'wasm-unsafe-eval'` 이 안
붙어서 PDF.js 가 로컬에서만 조용히 실패한다.

배포는 루트 `make ship`(`/ship`). 첫 배포 때 라이브 검증이 인증 게이트 타임아웃과
WebSocket 오류로 자동 롤백된 적이 있는데(`d68d4b3`), sktest 문제가 아니라 실행
환경의 프록시 지연이었다 — 재검사는 28 PASS / 0 FAIL / 2 SKIP 였고 코드 변경
없이 그대로 복원했다(`a3fcd6f`). 같은 증상이면 sktest 를 의심하기 전에
`--timeout` 을 먼저 늘려 볼 것.
