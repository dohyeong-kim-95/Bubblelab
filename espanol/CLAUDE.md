# espanol — 에이전트 배경 메모

무엇을 왜 만들었는지는 `espanol/README.md`, 공통 규칙은 루트 `CLAUDE.md`. 여기엔 **세션마다 사람이 다시 설명하게 되는 것**만 적는다.

## 로케일 — UI는 한국어, 배우는 말은 스페인어

- **화면은 전부 한국어.** 모든 페이지가 `<html lang="ko">`(`index.html:2`), `<title>`도 한국어
  (`:6`). 다만 랜딩 검색이 가져가는 건 **하위 페이지의 `<title>` 뿐**이고(아래 배포 절),
  루트 카드 문구는 `www/index.html:99` 에 손으로 적혀 있다.
- **스페인어가 들어가는 자리는 정해져 있다.** 데이터의 `es`·`ex` 필드(`data/words.js:3`~`:10`),
  본문의 `class="es"` 스팬과 `data-say` 속성(`sounds/index.html:106`). `.es` 는 CSS 클래스일
  뿐 **`lang="es"` 속성은 어디에도 없다** — 읽어주기 언어는 `app.js:16` 의 `LANG = "es-ES"`.
- **기준은 스페인 본토(es-ES).** c·z 를 th 로 발음하고 vosotros 를 쓴다
  (`index.html:111`~`:113`). 중남미 표기·어휘를 섞어 넣지 않는다.

### 스페인어 표기 규칙

- **악센트 부호는 반드시 넣는다.** `hablo`(나는 말한다) ↔ `habló`(그가 말했다)처럼 강세만으로
  인칭·시제가 갈린다(`sounds/index.html:152`, `data/words.js:4`).
- **의문·감탄은 `¿` `¡` 로 연다** — `¿qué?`·`¿vale?`(`data/chunks.js:102`, `:19`; 설명은
  `sounds/index.html:158`~`:160`).
- **성수 쌍은 한 항목에 슬래시로.** `es: "jefe / jefa"`(`data/words.js:83`),
  `"tranquilo / tranquila"`(`data/chunks.js:134`). 훈련이 ` / ` 로 쪼개 **둘 다 정답 인정**
  (`drill/index.html:243`, `:404`), **읽어주기는 첫 형태만**(`:290`) — 남성형을 앞에 둔다.
- `pr` 은 한글 근사 발음일 뿐이다(p·t·k → ㅃㄸㄲ, c(e·i)·z → ㅆ, j → ㅎ — `data/words.js:6`~`:9`).
- **악센트 접기가 곳마다 다르다(재현된 버그).** 받아쓰기 채점은 NFD 분해 후 결합부호와
  `¿?¡!` 를 지우고 비교해 악센트·ñ·대소문자를 안 따지지만
  (`drill/index.html:236 (normalize)`), **검색 화면 셋(words·ear·log)** 은
  `toLowerCase().includes()` 뿐이라(`words/index.html:112`, `ear/index.html:130`,
  `log/index.html:236`) `cafe` 로 `café` 를 못 찾는다 — 같은 `cafe` 가 채점은 통과한다. 랜딩
  검색은 `_shared/search-rules.js:57` 에 `espanol`·`español` 을 **둘 다** 적어 피한다.

## 날짜 — 브라우저 지역 시간이다 (서버의 KST와 다르다)

- `today()` 는 UTC가 아니라 **브라우저 지역 시간**으로 `YYYY-MM-DD` 를 만든다
  (`app.js:115 (today)`). KST로 못 박지 않는다 — 서버가 없어 고정할 근거가 없다.
  리포 다른 쪽(`_infra/verify-prod.mjs:34 (kstDate)`)은 KST 고정이니 섞지 말 것.
- 날짜 경계를 쓰는 곳: 오늘의 다섯 낱말(날짜가 시드 — `app.js:234 (pickDaily)`), 라이트너 복습
  만기(`:179 (INTERVALS = [0,1,2,4,8,16])`, `:191 (grade)`), 연속 학습일(`:214 (streakOf)`),
  하루 훈련량 400일 보관(`:261 (countToday)`), 내보내기 파일명(`log/index.html:273`).

## 통화·숫자

**해당 없음.** 금액·환율·수치 서식을 다루는 코드가 없다(카드 장수·일수뿐).

## 배포

공통 절차는 루트 `CLAUDE.md` 와 `make ship`. 여기 고유한 것만:

- **서버가 없다(순수 정적).** `_infra/worker.js` 에 espanol 분기가 없고(site 분기는 admin·work·
  duri·invest — `:1703`·`:1716`·`:1728`·`:1741`), `wrangler.jsonc` 에 `ENABLE_*` var 도 DO 바인딩도 없다.
- **퍼블릭 서브도메인이다.** `www/index.html:99` 에 카드가 있어야 빌드가 통과한다(검사는
  `_infra/build.mjs:69`~`:74`; 그 위 `:65`~`:68` 은 반대쪽인 confidential 링크 금지).
- 자체 `index.html` 이 있어 **카드 카테고리가 아니다** → 카테고리 홈 자동 생성도 `_shared/home.js`
  주입도 없어(`build.mjs:624 (cardSites)`, `:705`~`:712`) 각 페이지가 상단 내비를 직접 든다.
  반면 `engagement.js`·`dock.js` 는 들어간다(`build.mjs:700`~`:703`).
- **랜딩 검색 색인에는 하위 폴더 중 `index.html` 이 있는 것만** 담긴다
  (`build.mjs:654 (bl-cards 루프)`) — 실측 drill·ear·grammar·log·sounds·words 6개뿐이고
  **루트와 `data/` 는 없다.** 루트 제목을 고쳐도 검색 결과는 안 바뀐다.
- 이 파일은 배포에서 제외된다(`build.mjs:53 (AGENT_DOCS)`) — 여기 인프라 이름을 적어도 안전하다.
- 전용 프로브는 없다. `listSites()` 가 폴더를 훑어 `site:espanol` 을 자동 생성하고
  (`verify-prod.mjs:26 (listSites)`, `:292 (정적 프론트엔드 루프)`) 홈이 200·`text/html`·500바이트
  초과·`<title>` 존재인지만 본다. 그것만: `node _infra/verify-prod.mjs --only site:espanol`

## 테스트

**전용 단위 테스트가 없다**(`_infra/*.test.mjs` 어디에도 espanol이 없다). 안전망은 스모크 셋뿐.

```bash
node _infra/build.mjs                  # dist/ 를 먼저 만들어야 한다
npx playwright test -g "스페인어"       # 홈·훈련·문법 3개만 (약 2초)
```

- 대상은 `_infra/e2e/smoke.spec.mjs:30`~`:32` (SCREENS). 왜 이 셋인지는 `:29` 주석에 있다 —
  **화면을 전부 스크립트로 그려서 모듈 하나만 깨지면 빈 화면이 된다.** 페이지가
  `<script type="module">` 로 `app.js`·`data/*.js` 를 import 하므로(`index.html:130`~`:135`)
  import 한 줄이 어긋나면 본문이 통째로 사라진다. 그걸 잡는 건 이 스모크뿐이다.
- 보는 건 셋뿐(예외·가로 넘침·빈 화면, `smoke.spec.mjs:1`~`:5`). 새 페이지를 만들어도 SCREENS 는 자동으로 늘지 않는다.

## 남은 함정

- **훈련 카드 id 가 스페인어 표기 그 자체다**(`app.js:130 (wordId/chunkId)`, `w:jefe / jefa`).
  오타 하나를 고쳐도 그 카드의 학습 기록이 새 카드로 리셋된다.
- 저장 키를 새로 만들면 `app.js:100 (KEYS)` 에 넣어야 내보내기(`:111 BACKUP_KEYS`)에 들어간다.
- 랜딩 카드 아이콘은 **파일 전체의 첫 이모지**를 정규식으로 잡는다(`build.mjs:230 (toyEmoji)`)
  — 실무상 `<title>` 이 맨 앞이라 결과는 같다. `🗣️` 처럼 VS16이 붙은 것은 반쪽만 잡힌다.
- `blTTSConfig` 는 **`tts.js` 보다 먼저** `<head>` 에 심고 `dock: false` 유지
  (`index.html:9`~`:10`). 항목별 🔊는 `app.js` 의 `sayButton()`·`mountSayButtons()`.
- 스페인어 목소리가 없는 기기가 있다 — 새 페이지에도 `warnIfNoVoice()`(`app.js:68`~`:77`).
- **영화 대사를 옮겨 싣지 않는다.** 예문은 전부 새로 쓴 문장이다(README 저작권 절).
