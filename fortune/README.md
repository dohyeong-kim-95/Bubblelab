# fortune.bubblelab.dev — 다그당스 운세 노트 (M4~)

비공개 서브도메인으로 시작해 2026-11-19 공개로 바꿨다 — 랜딩(`www/index.html`) 카드·카테고리 풀다운에 나오고 noindex 를 뗐다
(손금 베타 `note/palm/` 은 아직 noindex). 개인정보처리방침(`privacy/`)은 랜딩 검색 카드에서만 뺐다(`UNLISTED_ENTRIES`).
첫 화면 = 사주·타로·손금을 채워 가는 종합 노트(M4). 설계: `~/bubblelab-research/m4/DESIGN.md`(리포 밖).

**이 폴더가 운세 코드의 최종 집이다.** util/fortune 은 M4.5 이주가 끝나면 없어진다. 그래서 두 곳이 같이 쓰는 코드의
원본은 `_shared/` 가 아니라 여기에 두고, util/fortune 은 이주가 끝날 때까지만 빌려 쓴다(임시 연결은 M4.5 끝에 함께 지운다).

## lib/ — 운세 공용 코드(원본)

순수 모듈(DOM 없음)만 둔다. 브라우저·Node 테스트·(나중) 다그당스 대화가 같은 함수를 부른다. `lib/` 안의 파일은 서로만 import 한다.

| 파일 | 하는 일 | 검사 |
|---|---|---|
| `lib/traits.js` | 공통 특성 어휘 40개(`~한 편`), 축·극, 모순 쌍 표(같은 축 반대 극 15 + 손으로 적은 6), 손금 id 대응, 타로 state 11개·카드 대응, 역할(바탕·습관·요즘), 금칙 정규식 | `_infra/fortune-note.test.mjs` |
| `lib/note.js` | 겹침 규칙(`mergeNote`)·변화(`delta`)·운세별 한 줄·모순 검사·노트 조립(`assembleNote`, v1 템플릿 — LLM 없음)·다음 칸 말풍선 | `_infra/fortune-note.test.mjs` |
| `lib/tarot.js`·`lib/tarot-minor.js`·`lib/tarot-texts.js`·`lib/tarot-log.js`·`lib/art.js` | 타로 78장 덱(v4): 스프레드 4개(오늘 1장 · 지금·걸림·한 걸음 · 마음 3장 · 갈림길 3장), 섞을 때 정/역을 함께 정하는 역방향(셋 중 하나꼴, 부드러운 말투 — 꼬리표 없음, 거꾸로 나온 카드는 '요즘' state 없음), 카드 잇기 flow(무게·정/역·영역·단계 최대 2문장)·한 줄 묶기·맺음, 질문 다듬기, 읽는 틀. `tarot-minor.js`·`tarot-texts.js` 는 문장 표(데이터만). `tarot-log.js` 는 지난 카드 30일(이 기기만, 질문은 켰을 때만). 그림 매니페스트(그림은 R2, `_src/fortune-tarot/`). 옛 기록(메이저 22장 순열·정/역 없음)은 정방향으로 그대로 읽는다 | `_infra/fortune-tarot.test.mjs`·`_infra/fortune-tarot-log.test.mjs` |

사주 → 특성 규칙표는 엣지 코드라 `_infra/saju-traits.js`(어휘는 여기 `lib/traits.js` 를 import). 노트가 받는 사주 칸 재료는
`sajuNoteInput(chart)` — 특성과 일간 후보만, 생년월일·명식은 싣지 않는다.

**통과 기준: 노트 안 문장끼리 모순 0건.** 테스트가 가상 인물 5명 × 손금 실결과 13장(traits 만, `_infra/fortune-note.fixtures.json`)
× 타로 78장(메이저 22 + 마이너 56) × 3단계와 생일 표본 860개 × 손금 × 3단계를 돌린다. 어휘·규칙을 바꾸면 이 테스트와 설계 문서를 같이 본다.

## 첫 화면 = 다그당스 상담 노트(M4 v2)

역술가가 노트에 실시간으로 써 주는 화면. 칸·메뉴·폼 없이 펼친 노트 한 장에 위에서 아래로 이어 쓴다(스토리보드
`~/bubblelab-research/m4/storyboard/`, 프로토타입 `_src/fortune-storyboard/`).

| 파일 | 하는 일 |
|---|---|
| `index.html` | 노트 한 장(`#page`) + 곁의 다그당스(`#dg`) |
| `notebook/consult.js` | 상담 순서(스크립트): 맞이 → 궁금한 것 → 타로 → 생일 → 사주(명식 표·오행 막대·특성) → 손바닥 → 종합 → 마무리·더 볼까 |
| `notebook/pen.js` | 연필: 한 글자씩 쓰기(탭하면 바로 다 쓰기, `prefers-reduced-motion` 이면 처음부터 다 쓴 상태), rough.js 동그라미·밑줄·상자·화살표, 폴라로이드, 동그라미 고르기 |
| `notebook/notebook.css` | 이 화면 부품(토큰은 `note.css`) |
| `lib/consult-text.js` | 스크립트 문구 전부(해요체) — `_infra/fortune-consult.test.mjs` 가 금칙·단정 어미·맞세우는 말·어미 검사 |

- **말투:** 차분하고 따뜻한 역술가 해요체. “승”으로 끝나는 어미는 fortune/ 와 util/fortune 화면 어디에도 쓰지 않는다(사용자 결정
  2026-11-16, 테스트가 화면 파일 전체를 본다). 인스타 신청서 완성 DM(`_infra/fortune-comic-notice.js`)만 예외.
- **묻기는 노트 위에서:** 생일은 줄 끝 빈칸, 고르기는 써 준 보기에 동그라미, 어디서든 "다음에 할래요". 건너뛴 칸은 마무리의
  "더 볼까요?"에서 다시 고를 수 있다(그래서 순서가 바뀐다).
- **폴라로이드:** 손으로 그린 느낌을 못 내는 것(카드 그림·손 사진+선)만. 노트 위에 올려놓은 별개 물건이고(기울기·테이프·
  그림자·가장자리 살짝 넘김), 놓일 높이만큼 노트 줄을 비워 그 아래부터 쓴다 — 글자와 겹치지 않는다(E2E 가 잰다).
  속 사진·카드는 누르면 크게 본다(`pen.zoomable` — 다시 누르거나 바깥·닫기·Esc 로 닫힘, 손바닥은 캔버스째 옮겨 그려 주소를 만들지 않는다).
- **깊은 풀이도 노트 안에서:** 대운(차트의 `lifeCurve`, 성별이 없으면 한 번 묻는다)·올해 토정(`tojeong/<괘>.json` + `tojeong-reading.js`).
  인생 곡선은 탭 화면과 **같은 부품** `window.Note.lifeCurve`(`note/note.js` 를 첫 화면도 불러 쓴다 — 사본 없음)로 노트에 바로 그리고,
  구간을 누르면 그 대운 풀이를 아래 한 줄(`#curve-pick`)에.
- **손바닥 사진 바꾸기:** 손금 칸 끝에 늘 「📷 다른 사진으로 다시 보기」(새로 읽은 칸·저장된 손금을 다시 펼친 칸 모두, 손금방이
  쉬면 버튼 대신 쉬는 안내). 누르면 "더 볼까요?"의 「손바닥 사진 바꾸기」와 같은 흐름 — 그 물음을 기다리는 중이면 그 보기를 고른 것으로,
  다른 칸을 쓰는 중이면 다음 물음에서, 노트를 다 쓴 뒤면 그 아래에 바로. 다시 찍거나 다른 사진을 골라 새로 읽으면 이 페이지의
  옛 손금 칸·종합을 걷어 내고 새 결과로 바꾼다(기기엔 마지막 결과 하나). 건너뛰면 그대로. 페이지 기록에는 `palmRedo`(yes/null)만.
  util 로 가는 링크는 없다.
- **저장(이 기기만):** `bl-fortune-birth`·`bl-fortune-palm`(traits + 선별 요약 `lines` — 선마다 보인 정도·모양 표지·풀이 한 단락, 사진·좌표 없음)·`bl-fortune-tarot-last`(7일, 거꾸로 나왔는지 포함)·`bl-tarot-log`(지난 카드 30일, 타로 탭과 같이 씀)·`bl-tarot-pref`(역방향·질문 기억 설정)·`bl-fortune-dangi`(당이 "on"|"off", `lib/prefs.js` — 끄면 곁 그림과 타로 카드 그림 덱이 함께 빠진다. 상담 노트 왼쪽 아래 스위치와 타로 탭 「1909년 옛 그림 카드로 보기」 체크가 이 값 하나를 같이 쓴다), 그리고 `bl-fortune-page`
  {date, log:[{k, v}]} — 그날 고른 것(주제·카드 id·건너뜀·더 볼 것)만. 같은 날 다시 열면 그 페이지를 그대로 펼치고, 다른 날이면 지난
  페이지를 펼친 뒤 그 아래에 이어 쓴다(생일·손금은 다시 묻지 않고, 일주일 지난 카드는 새로).
- **다그당스 그림:** 저장소에 넣지 않는다 — R2 `bubblelab-fortune` 의 `art/dangi/`(표정 7개, 내용 해시 이름), 매니페스트
  `lib/dangi-art.js`. 다시 굽기·올리기는 `bash _src/fortune-dangi/upload-art.sh`(원본 `~/dageudangs-lab/stickers`, 위쪽 글씨 띠를
  잘라 몸만). 워커 `/_fortune/art/dangi/<파일>` 이 1년 immutable 로 낸다.
- 검사: `_infra/e2e/fortune.spec.mjs` 「다그당스 상담 노트」(첫 방문 전체·건너뛰기·재방문·탭으로 다 쓰기 — 모순 쌍 0, 폴라로이드
  겹침 0, 360px 가로 넘침 없음, util 링크 없음, 어미 검사), `_infra/fortune-consult.test.mjs`, `_infra/fortune-note.test.mjs`.

## 탭 화면 /note/ — 상담 노트와 둘 다 연다(A/B, 2026-11-16)

사용자 결정: 완성된 걸 한눈에 보는 화면과 인터랙티브 상담을 둘 다 살려 둔다. **집계·A/B 배정 없음**(익명 통계도 넣지 않는다).

- `/` = 다그당스 상담 노트(`index.html`·`notebook/`). 노트 끝에 「한눈에 보기 →」(`note/`).
- `/note/` = 운세 노트 탭 화면(오늘·사주·궁합·토정비결·바이오리듬·타로) — 원본 `note/`(예전 util/fortune 화면 그대로).
  머리에 「손금 보기(베타) → · 다그당스와 상담하기 →」가 **fortune 자리에서만** 붙는다(같은 파일이 util 에서도 열리므로 스크립트가
  주소를 보고 단다 — util 첫 화면엔 손금 링크 금지·비공개 서브도메인 링크 금지).
- 같은 출처라 생일(`bl-fortune-birth`)을 두 화면이 같이 쓴다 — 한쪽에서 적으면 다른 쪽이 다시 묻지 않는다.
- 자리별 주소(2026-11-16): 같은 탭 화면 파일이 자리(`ON_FORTUNE`)를 보고 고른다 — 공유 이미지 워터마크는 fortune 에서 만들면
  `fortune.bubblelab.dev/note`, util 에서 만들면 `util.bubblelab.dev/fortune`. 아침 알림은 구독 기록에 출처(`site`)를 남겨
  (서버가 요청 호스트로 정함) fortune 구독자는 `/note/`, util·출처 없는 옛 구독자는 util 을 연다(`_infra/fortune.js`
  `FORTUNE_PUSH_URLS`·`pushSiteOf`). 서비스워커(`note/sw.js`)는 주소를 박지 않고 서버가 준 주소, 없으면 자기 scope.

## 임시 연결(M4 → M4.5) — 지울 때 한 곳

탭 화면은 공용 재료를 자기 옆에서 상대 주소로 부르고, **빌드가 복사해 두 자리를 만든다**(`_infra/build.mjs` 「임시 연결」):
① 공용 재료(아래)를 탭 화면이 놓이는 `fortune/note/`·`util/fortune/` 옆에 같은 이름으로, ② 탭 화면 `note/*` 를 `util/fortune/*` 로
(옛 주소 그대로 200 — 인스타 링크·만화 사주·신청서·후기). 공용 재료:
`lib/`, `note.css`, `fonts/`(글꼴 조각 — `_src/fortune-fonts/build.py`), `palm/palm.js`·`labels.js`, `tojeong/`(괘 본문 —
`_src/util-tojeong/publish.mjs`)·`tojeong-reading.js`, `vendor/`(rough.js), `privacy/`(개인정보처리방침). 소스의 두 자리에 같은 이름을
만들면 빌드가 멈춘다. util/fortune 소스에는 `insta/`(신청서)·`receipt/`(접수증)·`get/`·`review/` 만 남는다.

**개인정보처리방침의 원본은 `privacy/`**(fortune.bubblelab.dev/privacy/). 노트 손금 동의 문구 바로 아래와 노트 끝에서 링크한다.
옛 주소 util.bubblelab.dev/fortune/privacy/ 는 임시 연결로 같은 내용이 계속 200 — 인스타 신청서·만화 사주·후기 화면의 `../privacy/`,
인스타 DM 의 주소(`_infra/fortune-ig.js` `PRIVACY_URL`), Meta 앱에 등록된 주소가 그 주소다. M4.5 에서 util/fortune 을 지울 때는
옛 주소를 새 주소로 넘기는 301(워커)을 먼저 두고, Meta 앱·DM 문구의 주소를 바꾼다. 실제 동작(저장 위치·지우는 때)이 바뀌면
이 문서를 같이 고치고 시행일을 올린다. util 의 손금 페이지는 마크업 없이 `mountPalm` 하나를 붙인다. 같은 출처라 localStorage·CSP 가 그대로이고, 워커·e2e 서버·csp-serve 가 모두 dist 를
내주므로 따로 맞출 곳이 없다. 소스에 빌려 쓰는 경로(`util/fortune/lib/` 등)를 만들면 빌드가 멈춘다. M4.5 에서 util/fortune 을 지울 때 그 블록과
`_infra/fortune-tarot.test.mjs` 의 「임시 연결」 테스트를 같이 지운다.

**타로 클래식 덱(2026-11-17):** 카드 그림을 당이 ↔ 1909년 초판(Pamela Colman Smith, 퍼블릭 도메인 — 위키미디어 공용 스캔)으로 바꾼다.
**당이 끄기 = 당이 없는 화면 전체(2026-11-17 결정 ③ 뒤집음):** 덱은 따로 저장하지 않고 `bl-fortune-dangi` 하나가 정한다(끄면 클래식).
상담 노트의 당이 스위치와 타로 탭 시작 화면의 「1909년 옛 그림 카드로 보기」 체크(= 당이 끔)가 같은 값을 보여 주고 바꾼다. 예전 `bl-tarot-pref.deck`
은 처음 읽을 때 옮기고(classic 이었으면 당이 끔) 지운다(`lib/prefs.js` `loadDangi`). 끈 상태에서는 화면에 '당이' 글자가 스위치 이름 말고는 없다. 덱은 그림과 그림 묘사 문장만 바꾸고 뽑기·뜻·잇기·'요즘'은 같다(`TAROT_VERSION` 그대로).
- 그림: R2 `art/tarot-classic/`(`_src/fortune-tarot/upload-art.sh --deck classic`, 420×714 로 맞추고 모서리 둥글게), 매니페스트 `lib/art-classic.js`.
- 문구: `lib/tarot-classic.js` 의 `CLASSIC` — 당이 덱 문구 중 '당이'를 말하는 칸(147칸)만 1909 그림대로 다시 쓴 덮어쓰기,
  `CLASSIC_REASSURE` — 1909 그림이 무거운 소드 3·9·10·펜타클 5 에 안심 한 줄. 모든 그림 묘사는 `tarot.js` 의 `symbolFor`·`textFor`·`revFor` 를 지난다.
- 검사: `_infra/fortune-tarot-classic.test.mjs` — 클래식 출력 전수(4 스프레드 × 78장 × 정/역 × 모든 자리)에 '당이' 0글자, 덮어쓰기 범위 = '당이' 칸,
  '당이' 없는 문장은 글자 그대로, 덱이 뽑기를 바꾸지 않음. 설계 메모 `~/bubblelab-research/tarot/DESIGN-classic-deck.md`.

**손금 선별 풀이(2026-11-16):** 상담 노트(`/`)는 폴라로이드 아래에 선마다(생명·두뇌·감정·운명선 + 손 모양) 한 단락, 손금 화면(`/note/palm/`)은
「선마다 읽어 보면」 칸에 같은 단락을 쓴다. 문구 원본은 `lib/palm-lines.js` 하나(검사 `_infra/fortune-palm-lines.test.mjs`).
판독 단락이 말투·금칙·길이 검사에 걸리거나, 그 선의 뜻이 사주·노트 카드·앞 선과 모순이면 표 문구(남은 뜻만)로 바꾼다.
