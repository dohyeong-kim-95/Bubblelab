# emoticon — 움직이는 이모티콘 제작 툴

**처음 보는 에이전트를 위한 인수인계서다. 이 파일만 읽고 시작할 수 있게 쓴다.**

AI API로 움직이는 이모티콘을 만드는 도구와 작업장. 외주가 아니라 자체
프로젝트이며 목표는 두 단계다:

1. **1차 — duri용 움직이는 팩**: duri 채팅에서 쓸 만한 팩을 만들어
   `_assets/sticker`에 등록. **진행 중** (현재 1종 납품).
2. **2차 — 유료 마켓 입점**: LINE 8종 세트부터. 카카오는 생성형 AI 입점이
   막혀 있다 → [`doc/kakao-emoticon-guide.md`](doc/kakao-emoticon-guide.md) §1.

`assets/sticker`와의 차이: 그쪽은 **완성 에셋의 보관·배포**, 여기는
**만드는 쪽**(생성 파이프라인·검수·플랫폼 패키징)이다.

---

## 작업을 시작하는 법

**동작 이름을 정했으면 먼저 이걸 돌린다.** 문서 전체를 읽지 말 것 —
카탈로그가 그 동작에서 읽을 문서만 알려준다.

```bash
node _infra/emoticon.mjs guide 인사      # 또는 wave / 끄덕임 / nod / 통통튀기 …
```

기존 컷·사람 판정·읽을 문서 목록이 나온다. **카탈로그에 없으면 새 동작이고,
작업을 마치면 `doc/movement_catalog.json`에 한 줄 추가한다.**

## 북극성 (완료 조건)

**일관된 캐릭터로 각 2초짜리 움직이는 이모티콘 32개.**
2초 = 12fps × 24프레임 = 카카오 움직이는 이모티콘 규격.

판정 기준 — 전부 충족해야 완료:

1. **캐릭터 동일성**: 32컷 전부 같은 캐릭터로 읽힌다
2. **규격**: 360², ≤24프레임, 1.8~2.2초, 프레임당 0.05~2.0초
3. **기술 결함 없음**: 여분 사지·누끼 실패·크기 드리프트
4. **사람 검수 통과**: 게이트는 기술 결함만 잡는다(아래 참조)

### 일반화 게이트 — 양산 전에 통과할 것

동작 유형 5종이 각각 되는지 먼저 본다. 지금 상태:

| 유형 | 동작 | 상태 |
|---|---|---|
| 얼굴만 | blink (눈깜빡임) | ✅ 통과 · duri 납품 |
| 부분 동작 | wave (인사) | △ 겨드랑이 튐 |
| 효과 기호 | heart (하트) | △ 움직임 없음 |
| 머리 회전 | nod (끄덕임) | ✗ 9회 실패 — 리그 필요 |
| 전신 이동 | bounce (통통튀기) | · 미착수 |

## 현재 상태 (2026-08)

- **합격 컷 2종**: `blink1`, `wave2`
- **납품**: duri 비공개 팩 "애니메이션" 1종 (`_assets/sticker/emoticon-anim`)
- **누적 비용**: 약 $3
- **최대 난관**: 모델이 **전신 이동·좌우 방향·부위 세로 위치**를 지시대로 못
  그린다. 이 축들은 전부 **코드로 잡는다**(`mirror`·`alignFrames`·`nodRig`).

---

## 문서 지도

| 파일 | 언제 읽나 |
|---|---|
| 이 파일 | 처음 · 현재 상태 확인 |
| [`lesson_learned.md`](lesson_learned.md) | **반복 전에 읽고, 반복 후에 추가한다.** 실측 교훈 전부 |
| [`doc/movement_catalog.json`](doc/movement_catalog.json) | `guide` 명령이 읽는다. 새 동작 추가 시 편집 |
| [`doc/prompting.md`](doc/prompting.md) | 프롬프트를 고치기 전에. 규약 + 부위별 문장 사전 |
| [`doc/animation-craft.md`](doc/animation-craft.md) | 감정 채널·타이밍·애니메이션 기법 |
| [`doc/kakao-emoticon-guide.md`](doc/kakao-emoticon-guide.md) | 카카오 규격·구성 규칙·AI 정책 |
| [`doc/line-emoticon-guide.md`](doc/line-emoticon-guide.md) | LINE 규격 (1순위 출구) |
| `doc/guide-by-movement/*.md` | 그 동작을 만들 때. `guide` 명령이 짚어준다 |
| `doc/archive/*` | 실패가 확정된 접근 — 재시도 방지용 보존 |

## 코드 지도

| 파일 | 역할 |
|---|---|
| `_infra/emoticon.mjs` | CLI 본체 (guide·sheet·cut·build·check·redo·mirror·parts) |
| `_infra/emoticon-prompt.mjs` | 프롬프트 조립 + 규약 자동 검사(부정어·모순·배율) |
| `_infra/emoticon-rig.mjs` | 리그 — 생성된 작화에 기하를 입힌다 |
| `_infra/emoticon-vision.mjs` | 부품 개수 비전 검사 (여분 사지) |
| `_infra/emoticon-gate.mjs` | 품질 판정 (프로필·hard·soft) |
| `_infra/emoticon-history.mjs` | 히스토리 페이지 manifest 생성 |
| `_infra/emoticon-review.js` | 컷별 사람 검수 댓글 DO |

---

## 생성 경로 — GitHub Actions가 기본

**Cloudflare Workers → Gemini 직접 호출은 지역 차단으로 실패한다**
("User location is not supported"). 그래서 생성은 **Actions 러너**에서 돈다.

`_src/emoticon/job.json`을 커밋·푸시하면 `Emoticon` 워크플로가 돌고,
합격 산출물이 `_src/emoticon/<캐릭터>/`에 자동 커밋된다(배포 제외).
**실패한 실행은 아무것도 커밋하지 않는다** — check가 FAIL이면 커밋 단계까지
가지 않고, 그 실행이 만든 파일은 Actions artifact(`emoticon-run-<run_id>`,
보존 14일)로만 남는다.

```json
{
  "character": "rabbit", "step": "cut", "cut_id": "wave3",
  "prompt": "동작 설명", "assembly": "pingpong", "breakdowns": 0,
  "fps": "12", "profile": "master-2s",
  "ref": "_src/emoticon/rabbit/refs/key-1.png",
  "max_calls": "10", "max_cost": "0.40",
  "invariants": "부품 인벤토리",
  "poseConstants": "매 프레임 참인 포즈 사실",
  "keys": [{ "pose": "…", "hold": 3 }]
}
```

`step`은 `sheet` | `cut` | `redo`. redo는 `"frames": "2,3"`으로 불량 프레임만
다시 뽑는다(**프레임당 2회 상한** — 넘으면 포즈 문장을 고치고 `--force-redo`).

관련 워크플로: `Emoticon`(생성) · `Emoticon Parts`(부품 검사 일괄) ·
`Emoticon Reviews`(검수 댓글 동기화). 셋 다 파일을 건드려 push하면 돈다
(에이전트에게 workflow_dispatch 권한이 없다).

## 로컬 CLI

```bash
node _infra/emoticon.mjs guide <동작>                     # 작업 시작점
node _infra/emoticon.mjs plan   <작업폴더> <컷> --keys spec.json   # 비용 예측(무료)
node _infra/emoticon.mjs cut    <작업폴더> <컷> --keys spec.json
node _infra/emoticon.mjs mirror <작업폴더> <컷> "2,8"      # 좌우 정렬 (무료)
node _infra/emoticon.mjs build  <작업폴더> <컷> [--line]   # 몸 정렬 + APNG·GIF
node _infra/emoticon.mjs parts  <작업폴더> <컷>            # 부품 검사 (비전)
node _infra/emoticon.mjs check  <작업폴더> <컷> --profile master-2s
node _infra/emoticon.mjs redo   <작업폴더> <컷> "3" [--force-redo]
```

키 없이 파이프라인만 돌리려면 `EMOTICON_IMAGE_PROVIDER=mock`.
테스트: `node --test _infra/*.test.mjs`.

### 필요한 키

| 키 | 위치 | 용도 |
|---|---|---|
| `GEMINI_STICKER_KEY` | **GitHub Actions secret** | 기본 생성 경로. `gemini-2.5-flash-image` $0.039/장 |
| `GEMINI_STICKER_KEY` | Worker secret | 엣지 프록시(`/_emoticon/generate`) — 지역 차단 가능 |
| `EMOTICON_EDGE_TOKEN` | 로컬 env | 프록시 인증 = work 마스터 비밀번호 |

**API 키는 리포·워커 소스에 절대 넣지 않는다** (리포는 public).

## 검수 — 게이트만으로는 안 된다

**게이트는 기술 결함만 잡는다.** 실측: 귀 3개짜리 컷이 PASS했고, 든 팔이
좌우로 뛰는 컷도 PASS했다. 사람 판정 13건에 대조해보니 픽셀 지표
(드리프트·움직임)는 합격/불합격을 **전혀 예측하지 못했다**
(`lesson_learned.md` §37~44).

- **자동 hard**: 규격(크기·프레임·재생시간·용량) + 누끼 실패 + **부품 개수 초과**
- **사람 검수**: `work.bubblelab.dev/emoticon/history`에서 컷마다 댓글.
  `Emoticon Reviews` 워크플로가 `_src/emoticon/reviews.json`으로 끌어온다 —
  **에이전트가 피드백을 읽는 유일한 경로다**(배포 사이트에 직접 접근 불가).

## duri 등록 (비공개 팩)

**16장을 채울 필요가 없다.** 1장짜리 팩도 뜬다. 절차:

1. `_assets/sticker/<팩>/`에 `NN.png`(APNG) + `preview.png` + `metadata.json`
2. metadata에 **`"active": false`** → 카탈로그·랜딩에서 빠지고 파일만 배포된다
3. `duri/index.html`의 **`DURI_ONLY_PACKS`**에 `{id, title, count, cutout}` 추가
4. **`cutout: false` 필수** — duri의 클라이언트 누끼가 캔버스로 다시 그려서
   APNG를 첫 프레임짜리 정지 이미지로 만든다
5. metadata에 **`chat` 필드를 넣지 않는다** — 넣으면 `util/chat`(공개 익명
   채팅) 등록이 강제된다(테스트가 잡는다)

현재: `emoticon-anim` = "애니메이션" 1장 (blink v0).

## 주의 — 공개 리포와 산출물

리포는 public이다. 실험 산출물(`_src/emoticon/`)은 리뷰·반복을 위해 커밋한다.

**누끼 전 원본(`cuts/*/frames-raw/`)은 저장소에 두지 않는다**(`.gitignore`).
프레임 하나가 1MB 가까이 되는 데다 매 실행마다 쌓여서, 한때 저장소 추적 용량의
절반(56MB)을 이것만으로 차지했다. 지금 저장소에 남는 것은 최종 APNG·GIF(`out/`),
누끼 후 프레임(`cuts/*/frames/`), 메타·판정 근거(`cut.json`·`report.json`)다.

- 계속 참조하는 이미지(캐릭터 레퍼런스 등)는 `<캐릭터>/refs/` 에 둔다 — 여기는
  추적 대상이다. 컷 대부분이 쓰는 정면 컷이 `rabbit/refs/key-1.png`.
- 어떤 실행의 raw가 필요하면 그 run의 artifact를 내려받아 워크스페이스에 풀면
  된다(14일). 그 뒤에는 재생성해야 한다 — Actions 재실행 시 raw 재사용
  (`--resume`의 프레임 건너뛰기)은 같은 실행 안에서만 동작한다.

**단 마켓 제출용 최종 세트는 처음부터 여기에 두지 않는다.** "제출 직전에
지운다"는 **보호가 되지 않는다 — 삭제 전 커밋의 Git 기록에 파일이 남는다.**
제안본과 raw 프레임은 처음부터 로컬 또는 별도 private 저장소에 두고, public
리포에는 레시피·지표·리뷰용 저해상 자료만 남긴다.
