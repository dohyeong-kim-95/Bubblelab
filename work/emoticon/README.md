# emoticon — 움직이는 이모티콘 작업 기록

움직이는 이모티콘을 만들며 쌓은 **문서와 스크립트**가 있는 자리다. 배포되는 화면은 없다.

- **지금 쓰는 방법**: 완성된 스티커 한 장을 부품으로 갈라 코드로 움직인다(파츠 리그).
  절차·도구·종별 기록은 [`doc/gif-lab/d4/README.md`](doc/gif-lab/d4/README.md),
  16종 동작 표와 캐릭터 규칙은 [`emoji.md`](emoji.md). **그림·프레임·출력은 저장소에 두지 않는다**
  (로컬 `~/dageudangs-lab/`).
- **타겟은 LINE**(2026-11-06 확정). 카카오는 생성형 AI 입점이 막혀 있다 →
  [`doc/kakao-emoticon-guide.md`](doc/kakao-emoticon-guide.md) §1. 제출 때 AI 사용은 정직하게 표시한다.

## 걷어낸 것 (2026-11-10)

컷마다 프레임을 새로 그리게 하던 생성 파이프라인(`_infra/emoticon*.mjs`·`skeleton*.mjs`,
Actions 워크플로 3종, 엣지 프록시 `/_emoticon/generate`, 검수 게시판 `/emoticon/history` +
`EmoticonReviewDO`, 토끼 캐릭터 산출물 `_src/emoticon/rabbit/`)은 지웠다. 8월 초 이후
쓰지 않았고, 그 방식의 한계(프레임마다 캐릭터가 달라진다 — `lesson_learned.md`)가 파츠
리그로 넘어온 이유다. 다시 볼 일이 있으면 git 이력에 그대로 있다(`git log -- _infra/emoticon.mjs`).

아래 문서들 중 `doc/prompting.md`·`doc/guide-by-movement/`·`doc/movement_catalog.json` 은 그
파이프라인의 프롬프트·동작 기록이다. 명령어는 더 이상 없지만 **무엇이 안 됐는지**는 여전히 유효하다.

## 문서 지도

| 파일 | 언제 읽나 |
|---|---|
| [`emoji.md`](emoji.md) | 캐릭터 규칙·색 토큰·16종 동작 표 |
| [`doc/gif-lab/d4/README.md`](doc/gif-lab/d4/README.md) | 지금의 제작 흐름과 도구(`tools/`)·프롬프트(`prompts/`) |
| [`lesson_learned.md`](lesson_learned.md) | **반복 전에 읽고, 반복 후에 추가한다.** 실측 교훈 전부 |
| [`doc/dageudangs-gif.md`](doc/dageudangs-gif.md) | 움직이는 방법 비교 실험 |
| [`doc/animation-craft.md`](doc/animation-craft.md) | 감정 채널·타이밍·애니메이션 기법 |
| [`doc/human-animation-research.md`](doc/human-animation-research.md) | 사람 애니메이터의 작업 방식 조사 |
| [`doc/line-emoticon-guide.md`](doc/line-emoticon-guide.md) | LINE 규격 (1순위 출구) |
| [`doc/kakao-emoticon-guide.md`](doc/kakao-emoticon-guide.md) | 카카오 규격·구성 규칙·AI 정책 |
| `doc/prompting.md`, `doc/guide-by-movement/*`, `doc/movement_catalog.json` | 걷어낸 생성 파이프라인의 기록 |
| `doc/archive/*` | 실패가 확정된 접근 — 재시도 방지용 보존 |

## duri 등록 (비공개 팩)

**16장을 채울 필요가 없다.** 1장짜리 팩도 뜬다. 절차:

1. `_assets/sticker/<팩>/`에 `NN.png`(APNG) + `preview.png` + `metadata.json`
2. metadata에 **`"active": false`** → 카탈로그·랜딩에서 빠지고 파일만 배포된다
3. `duri/index.html`의 **`DURI_ONLY_PACKS`**에 `{id, title, count, cutout}` 추가
4. **`cutout: false` 필수** — duri의 클라이언트 누끼가 캔버스로 다시 그려서
   APNG를 첫 프레임짜리 정지 이미지로 만든다
5. metadata에 **`chat` 필드를 넣지 않는다** — 넣으면 `util/chat`(공개 익명
   채팅) 등록이 강제된다(테스트가 잡는다)

## 주의

리포는 public이다. 게이트는 배포된 화면만 가린다 — 커밋한 것은 GitHub에서 보인다.
