# emoticon — 움직이는 이모티콘 제작 툴 (자체 프로젝트)

상태: **방법론 확보 단계.** 문서(이 README + `SKILL.md`)가 먼저고, 툴·산출물은
다음 단계다. work.bubblelab.dev/emoticon 페이지는 아직 없다.

외주 의뢰가 아니라 **자체 프로젝트**다. AI API를 활용해 움직이는 이모티콘을
만드는 **도구(툴)와 작업장**이며, 목표는 두 단계:

1. **1차 — duri·assets용 움직이는 팩**: duri 채팅에서 쓸 만한 움직이는
   이모티콘 팩을 만들어 `_assets/sticker`에 등록한다.
2. **2차 — 유료 마켓 입점**: 카카오 이모티콘 스튜디오 / LINE Creators Market
   제안. 단, **카카오는 생성형 AI 이모티콘 입점을 제한 중**이라 현실적 1순위
   출구는 LINE이다 — 근거와 전략은 `SKILL.md` §6.

`assets/sticker`와의 차이: 그쪽은 **완성 에셋의 보관·배포**(정적 팩 카탈로그),
여기는 **만드는 쪽**(생성 파이프라인·후보 리뷰·플랫폼별 패키징)이다.

## 구성

- [`goal.md`](goal.md) — **북극성(완료 조건)**: 일관된 캐릭터로 각 2초짜리
  움직이는 이모티콘 32개. 모든 작업의 판정 기준.
- [`SKILL.md`](SKILL.md) — 제작 방법론. 플랫폼 규격, AI 파이프라인, 비용,
  정책 리스크, duri 통합까지. **작업 전 반드시 먼저 읽는다.**
- **CLI** — `_infra/emoticon.mjs` (+ `emoticon-ai.mjs` 프로바이더,
  `apng.mjs` 인코더). 페이지가 아니라 CLI가 본체다. **API 키는 로컬 env로만
  쓰고 리포·워커에 절대 넣지 않는다** (리포는 public).
- 페이지(`index.html`)는 이후 단계: 생성된 후보 프레임·루프를 나란히 보고
  선별하는 리뷰 대시보드. work 프로젝트 폴더 규칙 그대로 비공개(마스터
  비밀번호)로 둔다.

## CLI 사용법

작업폴더는 `_src/emoticon/<캐릭터명>/` — 배포·커밋 모두 제외된다(.gitignore).

```bash
export GEMINI_API_KEY=...   # 필수 (Google AI Studio)

# ① 캐릭터 시트 — 마음에 들 때까지 --force로 재생성 (이후 모든 생성의 축)
node _infra/emoticon.mjs sheet _src/emoticon/토끼 --prompt "동그란 흰 토끼, 분홍 볼"

# ② 컷 생성 — 초록 배경으로 프레임을 뽑아 자동 크로마키 (컷당 약 $0.5)
node _infra/emoticon.mjs cut _src/emoticon/토끼 hello --motion "손 흔들며 인사" --frames 12 --fps 12

# ②' 또는 I2V 영상에서 가져오기 (초록 배경으로 생성한 클립)
#    ffmpeg -i clip.mp4 -vf fps=12 frames/%02d.png
node _infra/emoticon.mjs import _src/emoticon/토끼 hello frames --chroma

# ③ APNG 굽기 — out/hello.png(360², 카카오·duri) + --line이면 270²·300KB 검증
node _infra/emoticon.mjs build _src/emoticon/토끼 hello --line
node _infra/emoticon.mjs check _src/emoticon/토끼 hello
```

프레임별 트리밍 없이 컷 전체 공통 경계로 잘라 떨림을 막고, 루프 diff·투명도
검증이 자동으로 돈다. 키 없이 파이프라인만 돌려보려면
`EMOTICON_IMAGE_PROVIDER=mock`. 테스트: `node --test _infra/emoticon.test.mjs`.

### 필요한 API 키

| env | 용도 | 상태 |
|---|---|---|
| `GEMINI_API_KEY` | 시트·프레임 이미지 생성 (`gemini-2.5-flash-image`, $0.039/장) | **필수** |
| `EMOTICON_IMAGE_MODEL` / `EMOTICON_IMAGE_API_KEY` | 모델·키 교체용 | 선택 |
| Kling/Runway 등 I2V | 히어로 컷용 영상 생성 — CLI 미연동, `import`로 수동 반입 | 선택(추후) |

## 로드맵

1. ✅ 방법론 확보 — `SKILL.md`
2. **파일럿**: 캐릭터 1종 × 동작 4~6개로 파이프라인 끝까지(생성→누끼→APNG)
   관통. 예산 ~$10. 여기서 재시도율·품질 감각을 얻는다.
3. **1차 목표**: duri용 움직이는 팩 16종 — APNG 마스터로 만들어
   `_assets/sticker`에 등록(APNG는 `<img>`에서 네이티브 재생이라 duri·assets
   클라이언트 변경이 거의 없다. `SKILL.md` §7).
4. **2차 목표**: LINE 제안(8종 세트부터). 카카오는 AI 정책 해제 또는
   비-AI 워크플로(손그림 원화 + 리깅) 전환 시점에 제안.

## 주의 — 상업용 원본 커밋 금지

리포는 public이다. duri·assets용 팩은 기존 관례대로 커밋해도 되지만,
**카카오/LINE 제안용 최종 원본(시안·납품 파일)은 커밋하지 않는다** — 심사
전 선공개·유출은 미승인 사유가 될 수 있고, 입점 후에는 무단 배포 문제가
된다. 제안용 산출물은 로컬(또는 별도 private 저장소)에 보관한다.
