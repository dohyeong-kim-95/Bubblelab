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
- [`lesson_learned.md`](lesson_learned.md) — 파일럿 실측 교훈. **반복 전에
  읽고, 반복 후에 추가한다.**
- [`animation-techniques.md`](animation-techniques.md) — 사람 애니메이터의
  기법(pose-to-pose·타이밍 차트·리미티드 등)과 AI 파이프라인 적용법.
- **CLI** — `_infra/emoticon.mjs` (+ `emoticon-ai.mjs` 프로바이더,
  `apng.mjs` 인코더). 페이지가 아니라 CLI가 본체다. **API 키는 로컬 env로만
  쓰고 리포·워커에 절대 넣지 않는다** (리포는 public).
- **브라우저 툴**(`index.html`) — work.bubblelab.dev/emoticon. **마스터
  비밀번호로 로그인만 하면 비밀번호·키를 어디에도 옮기지 않고** 시트 생성 →
  컷 생성(자동 크로마키) → APNG 빌드·다운로드까지 전부 브라우저에서 된다
  (세션 쿠키로 프록시 호출, 픽셀 처리·APNG 인코딩은 클라이언트, 생성물은
  IndexedDB 보존). CLI와 같은 알고리즘·프롬프트를 쓴다.

## 생성 실행 경로 — 기본은 GitHub Actions

**Cloudflare Workers → Gemini 직접 호출은 지역 차단으로 실패할 수 있다**
("User location is not supported" — CF 이그레스 IP가 미지원 지역으로
geolocate 되는 경우). 그래서 기본 생성 경로는 **GitHub Actions 잡**이다
(러너가 지원 지역·미국 IP):

- 워크플로: `.github/workflows/emoticon.yml` (`Emoticon`, workflow_dispatch)
- 입력: character(작업폴더) · step(sheet|cut) · prompt · cut_id · frames · fps
- 산출물(시트·프레임·APNG)은 **`_src/emoticon/<캐릭터>/`에 자동 커밋**되어
  에이전트가 리포에서 직접 리뷰·반복할 수 있다 (배포에는 안 들어간다).
- cut 단계는 생성 후 build·check(APNG·루프·투명도 검증)까지 이어 돌린다.

브라우저 툴(`index.html`)의 직접 생성은 워커 프록시를 타므로 지역 차단에
걸릴 수 있다 — 실패 시 오류 복사 버튼으로 코드를 전달하고 Actions 경로를
쓴다. 페이지의 시트 업로드·APNG 빌드·리뷰 기능은 생성 경로와 무관하게
동작한다.

## CLI 사용법 (로컬)

작업폴더는 `_src/emoticon/<캐릭터명>/` — 산출물은 커밋한다(Actions 잡과
같은 규칙, 배포에는 미포함).

```bash
# 기본(edge): 배포 워커의 /_emoticon/generate 프록시 경유 —
# Gemini 키는 GEMINI_STICKER_KEY Worker secret에만 있고 밖으로 나오지 않는다.
export EMOTICON_EDGE_TOKEN=...   # work 마스터 비밀번호(WORK_PASSWORD)

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

### 필요한 키

| 키 | 위치 | 용도 |
|---|---|---|
| `GEMINI_STICKER_KEY` | **GitHub Actions secret** | 기본 생성 경로(Emoticon 워크플로)가 쓰는 Gemini 키 (`gemini-2.5-flash-image`, $0.039/장). 리포 Settings → Secrets and variables → Actions에 등록 — podcast의 `GEMINI_API_KEY`와 별도 |
| `GEMINI_STICKER_KEY` | Worker secret | 엣지 프록시(`/_emoticon/generate`)용 같은 키 — 단 지역 차단 가능성 있음(위 참조). `npx wrangler secret put GEMINI_STICKER_KEY` |
| `EMOTICON_EDGE_TOKEN` | 로컬 env | 프록시 인증 = work 마스터 비밀번호 (edge 프로바이더용) |
| `GEMINI_API_KEY` | 로컬 env | `EMOTICON_IMAGE_PROVIDER=gemini`로 API 직접 호출할 때의 대안 경로 |
| Kling/Runway 등 I2V | — | 히어로 컷용 영상 생성 — CLI 미연동, `import`로 수동 반입 (추후) |

프록시는 work 마스터만 통과(비밀번호 Bearer 또는 마스터 세션 쿠키),
60회/10분 레이트리밋, `GEMINI_STICKER_KEY`·`WORK_PASSWORD` 미설정이면
503(fail-closed). 호출당 과금이므로 Google 콘솔 예산 한도도 걸어둘 것.

## 로드맵

1. ✅ 방법론 확보 — `SKILL.md`
2. **파일럿**: 캐릭터 1종 × 동작 4~6개로 파이프라인 끝까지(생성→누끼→APNG)
   관통. 예산 ~$10. 여기서 재시도율·품질 감각을 얻는다.
3. **1차 목표**: duri용 움직이는 팩 16종 — APNG 마스터로 만들어
   `_assets/sticker`에 등록(APNG는 `<img>`에서 네이티브 재생이라 duri·assets
   클라이언트 변경이 거의 없다. `SKILL.md` §7).
4. **2차 목표**: LINE 제안(8종 세트부터). 카카오는 AI 정책 해제 또는
   비-AI 워크플로(손그림 원화 + 리깅) 전환 시점에 제안.

## 주의 — 공개 리포와 산출물

리포는 public이다. 작업 산출물(`_src/emoticon/`)과 duri·assets용 팩은
리뷰·반복을 위해 커밋한다. 단 **카카오/LINE에 제안하는 최종 세트는 제안
직전에 리포에서 제거하고 로컬(또는 별도 private 저장소)로 옮긴다** — 심사
전 선공개·유출은 미승인 사유가 될 수 있고, 입점 후에는 무단 배포 문제가
된다.
