# test — 데이터랩 (데이터사이언스 문제은행)

test.bubblelab.dev. **비공개 서브도메인**(`CONFIDENTIAL_SUBDOMAINS`) — 랜딩·풀다운에
노출되지 않고 직접 주소로만 접근한다. 토이 관례(share.js, 주간 기록)를 적용하지 않는다.

빅데이터분석기사/ADP 실기 스타일의 문제를 브라우저 안 파이썬(Pyodide/WebAssembly)으로
푼다. 서버 채점 없음 — 전부 클라이언트에서 실행되고, 진행 상황은 localStorage에만 남는다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 문제 목록 (카테고리 필터, 진행 상황 표시) |
| `solve.html` | 노트북 풀이 화면 (`?id=<문제id>`, 실전 모드는 `&exam=1`) |
| `exam.html` | 실전 모드 (무작위 6문제 · 180분 · 100점 만점 · 60점 합격) |
| `problems.js` | 문제은행 데이터 (`window.DS_PROBLEMS`) |
| `runtime.js` | Pyodide 부팅, 셀 실행, 채점 엔진, 실전 모드 연동 |

## 동작 방식

- Pyodide는 jsDelivr CDN(`v0.27.2`)에서 로드한다. 이를 위해 `_infra/security.js`가
  **test 호스트에 한해** CSP에 `cdn.jsdelivr.net`과 `wasm-unsafe-eval`을 허용한다.
- 패키지는 셀 코드의 import를 보고 자동 로드(`loadPackagesFromImports`) —
  numpy·pandas·scipy·scikit-learn·statsmodels·matplotlib 사용 가능.
- 노트북: 셀 추가/삭제, Shift+Enter 실행, 마지막 표현식 표시(DataFrame은 HTML 표),
  matplotlib 그림은 PNG로 렌더링. 셀 내용은 문제별로 localStorage에 자동 저장.
- 채점: 사용자가 마지막 셀에서 `check.step('s1', {'x': x})` 를 호출하면,
  런타임이 setup + 모범답안 체인을 **별도 네임스페이스**에서 실행해 기대값을 만들고
  변수별로 비교한다(수치는 rel 1e-3/abs 1e-4 허용, DataFrame/Series/ndarray 지원).
  기대값 자체는 출력하지 않고 타입/shape/값 불일치 사유만 알려준다.

## 실전 모드

`exam.html`이 영역별로 무작위 출제한다: 전처리군 2 + 통계군 2 + 모델링군 2
(카테고리→군 매핑은 `exam.html`의 `GROUPS`). 시험 상태는 `bl-ds-exam-v1` 키 하나에
저장(시작/종료 시각, 문제 6개, 통과 단계)되고, 풀이는 `solve.html?...&exam=1`로 연다.

- 시험 중 `check.step()` 통과가 곧 제출 — `runtime.js`가 제한시간 안의 통과만
  시험 기록에 반영한다(연습 진행상황에는 항상 누적).
- 시험용 셀 코드는 `bl-ds-exam-cells-*`로 분리 저장돼 연습 코드가 보이지 않는다.
- 시간이 끝나면 자동 종료·채점(단계별 균등 배점, 총 100점). 새 시험 시작 시
  이전 시험 기록·셀을 지운다.

## 문제 추가

`problems.js`에 항목 하나 추가하면 끝. 규칙:

- 파이썬 코드는 `String.raw` 템플릿으로 담는다 (정규식 `\d` 등 백슬래시 보존).
  백틱과 `${`는 파이썬 코드 안에 쓰지 말 것.
- `setup`은 `np.random.default_rng(고정시드)`로 데이터를 만들고 마지막 줄에서
  `df.head()` 등을 보여준다. 첫 셀(읽기 전용)로 자동 실행된다.
- `steps[i].solution`은 setup + 이전 단계 solution들이 실행된 네임스페이스에서 이어
  실행된다. `expect`의 모든 변수를 solution이 정의해야 한다.
- 무작위성이 있는 모든 연산(sample, train_test_split, KMeans …)은 지시문에
  `random_state`를 명시해 결정적으로 만든다. k-means 라벨처럼 순서가 바뀔 수 있는
  결과는 정렬된 크기·실루엣 등 순열 불변 값으로 채점한다.
- 검증: `node _infra/build.mjs` + 아래 로컬 확인.

## 로컬 확인

```bash
node _infra/build.mjs
npx wrangler@4 dev --local --local-upstream localhost
# http://localhost:8787/test/
```

모범답안 전체가 실제로 실행되는지는 시스템 파이썬으로도 훑을 수 있다
(pandas·scikit-learn·statsmodels 설치 필요): 문제 JSON을 뽑아 setup→solution 체인을
실행하고 expect 변수 존재를 확인하면 된다.
