# pose-conditioning — 스켈레톤 조건화 (Kling·바이트댄스 계열 리서치)

AI가 "춤추는 사람"을 만드는 방식(포즈 조건부 캐릭터 애니메이션)을 리서치해서
(2026-07) 우리 파이프라인에 적용 가능한 형태로 정리했다. `lesson_learned.md`
§9·§12·§22에서 반복 확인된 **포즈 준수의 텍스트 한계**에 대한 답이 여기 있다.

## 0. 한 줄 요약

이 분야가 6년간 수렴한 결론은 **"레퍼런스 이미지 = 정체성, 프레임별 포즈
스켈레톤 = 움직임, 둘을 분리해서 조건으로 준다"**이다. 텍스트는 기하를
지정하지 못하고, 포즈 시퀀스는 **정의상 부드러워서** 시간 일관성 문제를
생성 단계가 아니라 **입력 준비 단계**로 옮겨버린다 — 그리고 입력 준비는
결정론적 코드로 완벽히 풀 수 있다.

**우리에게 결정적인 사실**: Animate Anyone 같은 최상급 연구도 결국
**컬러 스틱피겨 PNG를 조건으로 먹인다.** 우리가 API로 못 할 이유가 없다.

## 1. 왜 이것이 우리 문제의 답인가

우리가 겪은 두 실패가 이 계열이 푼 두 실패와 정확히 같다.

| 우리 증상 | 원인 | 스켈레톤 조건화의 해법 |
|---|---|---|
| "오른팔"이 프레임마다 좌우로 오감 (§9·§12) | 텍스트는 기하가 아니다 — 참조계(화면/캐릭터), 각도, 굽힘을 지정 못 함 | 스켈레톤은 **좌우가 색으로 구분**되고 관절 각도가 좌표로 확정 |
| 프레임 간 튐·크기 드리프트 (§17) | 프레임마다 독립 샘플링 = 결합 분포 없음 | 포즈 시퀀스를 **보간으로** 만들면 프레임 i와 i+1 차이가 정의상 작고 매끄러움 |
| 키2가 "팔은 몸 옆에"를 어김 (§22) | 텍스트 지시의 준수를 강제할 수단 없음 | 픽셀 수준 기하 조건 |

ControlNet 원논문의 표현이 정확하다: **"프롬프트는 개념을 기술하지 기하를
기술하지 않는다."** 우리는 지금까지 기하를 개념으로 지시하고 있었다.

이 구조가 얼마나 강력한지는 각 논문이 시간 일관성 모듈에 **얼마나 적은
예산**을 쓰는지로 드러난다 — Animate Anyone은 본 학습에 30,000 step을 쓰고
temporal layer는 10,000 step·batch 4만 쓴다. 스켈레톤이 이미 일을 다 했기 때문.

## 2. 계보 요약

| 논문 | 소속 | 포즈 신호 | 정체성 보존 |
|---|---|---|---|
| DreamPose (2023) | UW+Google | DensePose, **연속 5프레임 포즈**를 함께 | CLIP+VAE 듀얼 인코더 |
| DisCo (2023) | Microsoft | OpenPose 스켈레톤 | **전경/배경/포즈 3-way 분리** |
| MagicPose (2023) | ICML'24 | 스켈레톤 + **얼굴 랜드마크** | Appearance Control Model |
| MagicAnimate (2023) | ByteDance+NUS | **DensePose(조밀)** | Appearance Encoder |
| **Animate Anyone** (2023) | Alibaba | **DWPose → OpenPose 스켈레톤 이미지** | **ReferenceNet** + CLIP |
| Champ (2024) | Alibaba 등 | SMPL 렌더 + 스켈레톤 | ReferenceNet 계열 |
| MimicMotion (2024) | Tencent | **신뢰도 가중 포즈** | SVD 기반 |
| MusePose (2024) | Tencent Music | 스켈레톤 + **pose align** | Animate Anyone 재구현 |
| TCAN (2024) | ECCV'24 | **동결 ControlNet** + LoRA | — |
| **Animate-X** (2024) | Alibaba | **Pose Indicator (암묵+명시)** | — |
| **Kling-MotionControl** (2026) | Kuaishou | **부위별 이종 표현**(몸/얼굴/손) | **identity-agnostic motion learning** |

### 우리에게 특히 중요한 넷

**Animate Anyone** ([arXiv 2311.17117](https://arxiv.org/abs/2311.17117)) — 표준 참조
아키텍처. 포즈 신호가 **"그려진 스틱피겨 이미지"**라는 점, 클립 길이가
**24프레임**(우리 목표와 동일 스케일)이라는 점이 핵심. Ablation: CLIP 임베딩만
쓰면 디테일 전이 실패 → 정체성 보존에는 **픽셀 수준 공간 특징**이 필요하다.

**Animate-X** ([arXiv 2410.10306](https://arxiv.org/abs/2410.10306)) — 우리
유스케이스에 가장 직접적. 기존 방식이 **의인화 캐릭터에 일반화되지 않는**
이유를 "포즈 시퀀스를 타깃 캐릭터에 경직되게 강제하기 때문"으로 진단하고,
학습 중 **레퍼런스와 포즈의 미정렬을 일부러 시뮬레이션**(EPI)해 강건성을 얻는다.
→ **스켈레톤이 캐릭터에 정확히 안 맞아도 된다**는 것. 우리는 프롬프트로
"스켈레톤은 각도만 지시, 비율은 캐릭터 시트를 따르라"고 역할을 못박아 대응.

**Kling-MotionControl** ([arXiv 2603.03160](https://arxiv.org/abs/2603.03160)) —
Kuaishou의 캐릭터 애니메이션 기술 리포트. 두 설계가 우리에게 직결된다:
① **부위별 이종 표현** — 몸통은 거친 스켈레톤, 얼굴·손은 별도의 세밀한 표현.
하나로 다 하려 하지 말 것. ② **identity-agnostic motion learning** — 실사부터
카툰·동물까지 일반화하려고 **기하 수준에서 모션과 신체 속성을 분리**한다.
우리의 스켈레톤 리타게팅 단계가 이 원리의 저비용 구현이다.

**FramePrompt** ([arXiv 2506.17301](https://arxiv.org/abs/2506.17301)) —
**우리 접근의 이론적 근거.** 레퍼런스 + 스켈레톤 시퀀스 + 타깃을 **하나의
시각적 시퀀스로 이어붙이는 것만으로**, guider network도 구조 변경도 없이
베이스라인 대비 FVD −53.87%. 즉 **in-context로 이어붙이기만 해도 전용
아키텍처를 능가한다** — API로 하는 우리 방식이 타협이 아니라는 뜻이다.

## 3. 희소(스켈레톤) vs 조밀(DensePose/SMPL) — 우리는 희소다

한 번 조밀로 갔다가 돌아온 논쟁이다. Champ ablation은 SMPL이 스켈레톤보다
**형상 정렬**에서 이득이 크다고 보고(PSNR +1.27 vs +0.48)하지만, **스켈레톤은
얼굴·손의 정교한 모션에서 우위**다. 그리고 DisPose가 정리한 결정적 문장:
**"조밀 조건은 체형이 크게 다를 때 비디오 품질을 훼손한다."**

**우리 결론: 희소 스켈레톤이 옳다.**
1. 이모티콘 캐릭터는 SMPL/DensePose의 형상 공간 **밖**이다(2~3등신 치비).
   조밀 조건은 실사 인체를 강제해 캐릭터를 망가뜨린다.
2. **shape-agnostic**이 정확히 우리가 원하는 성질 — 포즈 하나를 임의 캐릭터에
   재사용해야 한다.
3. Champ가 꼽은 스켈레톤의 우위(얼굴·손)가 이모티콘 표현의 전부다.
4. 스켈레톤은 **프로그램으로 그리기 쉽다** — 선분과 원이면 된다.
5. 우리는 스켈레톤을 직접 만들므로 **포즈 추정 노이즈 문제가 아예 없다**
   (MimicMotion이 씨름한 문제가 구조적으로 부재).

**단, 알려진 한계**: 2D 스켈레톤은 **전후 모호성**(앞을 보는지 뒤를 보는지,
팔이 몸 앞인지 뒤인지)을 표현 못 한다 — Beyond Skeletons
([arXiv 2606.06903](https://arxiv.org/abs/2606.06903))가 명시한 한계.
프레임별 방향 텍스트로 보강한다.

## 4. Gemini가 스틱피겨를 따를 수 있는가 — 증거와 반증

**긍정 ①** — 실무 워크플로가 문서화돼 있다
([atlassc.net](https://atlassc.net/2025/12/13/generate-image-with-pose-and-character-references)):
두 레퍼런스를 **역할로 명명**해서 넣는다 — Pose Reference(스켈레톤 맵)와
Character Reference. *"OpenPose 이미지는 포즈를 말로 기술하는 것(모호할 수
있음) 대신 모델이 따를 **정확한 기하 좌표**를 제공한다."*

**긍정 ②** — 상용 사례: **Cartwheel × Gemini 2.5 Flash Image**
([Google 쇼케이스](https://ai.google.dev/showcase/cartwheel-2)). 3D 마네킹을
드래그해 포즈를 만들고 **그 3D 씬이 생성의 주요 입력**이 된다. 팀은 다른
모델들은 실패했다고 밝힌다("월드 지식을 희생하지 않고는 포즈에 충실하지 못함").

**긍정 ③** — FramePrompt의 실증(§2).

**주의 ⚠️** — 같은 Cartwheel 쇼케이스에 **"마네킹 스크린샷을 보내면 모델이
포즈를 기술하는 텍스트 레이블을 반환한다"**는 설명도 있다. 즉 마네킹이 순수
픽셀 조건으로만 쓰이는 게 아닐 수 있다. **가정하지 말고 실험으로 확인한다.**

**주의 ⚠️** — VIBE 벤치마크([arXiv 2602.01851](https://arxiv.org/abs/2602.01851))의
"Pose Control" 평가: 상용 모델이 오픈소스를 앞서지만 **가장 강한 시스템조차
난이도가 올라가면 성능이 뚜렷이 저하**된다. → 완벽한 추종을 가정하지 말고
**검증 루프**를 넣어라.

**주의 ⚠️** — Gemini 레퍼런스 이미지 한도(프롬프트당 최대 11~14장). 프레임
8~24개를 각각 넣는 방식을 막는다 → §6 그리드 전략이 필요한 또 다른 이유.

## 5. 프롬프트 설계 원칙 (각 항목이 어느 논문에서 왔는지 표시)

1. **역할 명명** (DisCo의 disentangled control) — *"Image 1 = CHARACTER SHEET
   (외형·색·스타일의 유일한 출처). Image 2 = POSE SKELETON (자세의 유일한 출처)."*
2. **스켈레톤을 그리지 말라고 명시** — *"스켈레톤 선과 점은 출력에 렌더링하지
   말 것. 그것은 지시이지 그릴 대상이 아니다."* 실무 최빈 실패다.
3. **우선순위 명시** (Animate-X의 EPI 대응) — *"스켈레톤은 관절 각도와 팔다리
   방향만 지시한다. 신체 비율은 캐릭터 시트를 따르라."* → 8등신 스켈레톤이
   치비를 늘리는 것을 막는다.
4. **좌우 규약 고정** (ControlNet의 기하 명시성) — OpenPose 색 규약을
   프롬프트에 적는다. *"빨강 계열 = 캐릭터의 오른쪽, 파랑 계열 = 왼쪽."*
5. **전후 방향 텍스트 보강** (Beyond Skeletons의 한계 대응) — 2D가 표현 못
   하는 것만 텍스트로: *"캐릭터는 정면을 향한다. 오른팔이 몸통 앞을 가로지른다."*
6. **불변 요소 고정** (ReferenceNet 역할의 텍스트판) — *"카메라·캔버스·캐릭터
   크기·배경은 모든 프레임에서 동일."* 우리 실측(§17 드리프트)의 직접 대응.
7. **모션 방향 힌트** (DreamPose의 5-포즈 윈도우) — 프레임 i 생성 시 i−1·i+1
   스켈레톤을 **반투명 고스트로 겹쳐** 그린다. 코드 몇 줄.
8. **얼굴 별도 지시** (Kling-MotionControl의 부위별 이종 표현) — 스켈레톤에
   표정이 없으므로 프레임별 텍스트로: *"표정: 눈 감고 미소."*
9. **스타일 못박기** — Meta조차 스티커 도메인 갭 때문에 2단계 파인튜닝이
   필요했다([Animated Stickers](https://arxiv.org/abs/2402.06088)). 스타일
   서술을 고정 접두어로.

## 6. 두 생성 전략 — 그리드가 우리 인프라와 맞물린다

**전략 1: 프레임별 개별 호출** (현재 방식의 연장)
프레임당 해상도 최대, 개별 재시도 가능. 단 **프레임 간 결합 분포가 없어**
지터가 남고 N배 비용. 직전 프레임을 레퍼런스로 넣는 변형은 일관성이 오르지만
**오차 누적** 위험 — 루프는 끝이 처음으로 돌아와야 해서 드리프트가 치명적이다.

**전략 2: 단일 호출 그리드 생성** (FramePrompt의 in-context 방식) ⭐
```
4×2(8프레임) 또는 4×4(16프레임) 그리드로 배치한 스켈레톤 한 장
→ gemini([캐릭터 시트, 그리드 스켈레톤], "같은 배치의 그리드로 출력")
→ 슬라이스
```
- **모든 프레임이 한 번의 샘플링 패스를 공유** → 일관성이 구조적으로 높다.
- 호출 1회 = 비용 대폭 절감. 레퍼런스 이미지 한도 무관(2장만 씀).
- **우리 리포에 특히 유리한 이유**: `_infra/sticker-pack.mjs`가 **이미 4×4
  시트를 셀 단위로 슬라이스·트리밍·누끼·검증하는 파이프라인을 갖고 있다.**
  8프레임 = 4×2, 16프레임 = 4×4로 정확히 떨어진다.

**권고: 전략 2를 먼저, 전략 1을 폴백으로.**

## 7. 스켈레톤 리타게팅 — 필수 단계

외부 포즈 데이터(AIST++/Mixamo)는 실사 8등신이다. **그대로 쓰면 캐릭터가
늘어난다.** MusePose가 pose-align 알고리즘을 따로 만든 이유이고,
Kling-MotionControl의 "기하 수준에서 모션과 신체 속성 분리"가 말하는 바다.

1. **정규화**: 골반 중심을 원점으로, 어깨너비로 스케일 정규화.
2. **비율 리타게팅**: 우리 치비 비율을 정의하고 **관절 각도만 가져와** 우리
   뼈 길이로 재구성. → **각도 = 모션(가져옴), 길이 = 정체성(우리 것)**.
3. **프레이밍 고정**: 모든 프레임을 동일 캔버스·동일 중심에 렌더 → 크기
   드리프트 원천 차단(우리 실측 §17의 구조적 해결).
4. **전후 표시**: 프레임별 방향을 메타데이터로 들고 가 프롬프트에 주입.

보간은 **관절 각도 공간에서** 한다. 픽셀 좌표를 LERP하면 두 각도 사이 직선
경로가 원호를 가로질러 **팔다리가 짧아진다**. 8~24프레임이면 각도 lerp +
ease-in-out으로 충분.

## 8. 도구·데이터

- **포즈 에디터**: [PoseMy.Art](https://posemy.art/) — 3D 마네킹 포징,
  **OpenPose 스켈레톤과 마네킹 렌더를 둘 다 export**(A/B 테스트에 이상적).
  [OpenPose Editor (HF)](https://huggingface.co/spaces/AIARTCHAN/openpose_editor),
  [Magic Poser](https://webapp.magicposer.com/)(프리메이드 포즈 라이브러리).
- **색 규약**: [ControlNet 공식 COCO 색표](https://github.com/lllyasviel/ControlNet/discussions/266)
  — 모델이 학습 때 본 것과 같은 규약을 써야 인식률이 오른다. **반드시 따를 것.**
- **참조 구현**: `controlnet_aux`의 `draw_bodypose(canvas, keypoints)`.
  리타게팅은 [ComfyUI-Skeletonretarget](https://github.com/cedarconnor/ComfyUI-Skeletonretarget).
- **포즈 데이터**: [AIST++](https://google.github.io/aistplusplus_dataset/) —
  댄스 1,408 시퀀스, **COCO 2D 키포인트가 이미 들어있어** 바로 그릴 수 있다.
  [Mixamo](https://www.mixamo.com/) — 무료 2,500개, 일상 제스처가 훨씬 다양하나
  3D→2D 투영 단계 필요.

## 9. 검증 루프 (Sprite Sheet Diffusion의 평가 3축)

[Sprite Sheet Diffusion](https://arxiv.org/abs/2412.03685)이 우리 태스크의
학술적 이름이고, 평가 3축을 그대로 QA로 쓸 수 있다:

1. **포즈 정렬** — 생성 프레임에 포즈 추정기를 돌려 입력 스켈레톤과
   **PCK** 계산, 미달 프레임 자동 재생성. **이것이 파이프라인을 "눈으로
   확인"에서 "닫힌 루프"로 바꾸는 단 하나의 장치다** (우리 `redo`의 발전형).
2. **일관성** — 프레임 간 색 히스토그램/임베딩 유사도. (우리 scaleDrift가 이 축)
3. **시퀀스 품질** — 인접 프레임 차이 분포, 루프 이음새. (우리 인접 diff·루프 diff)

우리는 이미 2·3축의 저비용 버전을 갖고 있다. **1축(포즈 정렬)이 비어 있고,
그게 정확히 우리가 못 고친 문제다.**

## 10. 적용 로드맵 (게이트 방식)

### Phase 0 — 가설 검증 (반나절, 코드 없음) ⭐ 여기서 멈출 수도 있다
"Gemini가 스틱피겨를 포즈 지시로 받아들이는가?" 하나만 답한다.
1. 기존 rabbit 시트 사용.
2. PoseMy.Art에서 **명백히 구분되는 포즈 4개** export — **의도적으로 좌우
   비대칭 포즈**(오른팔만 위로)를 넣는다. 우리 §9·§12 실패의 리트머스다.
   스켈레톤(A)과 마네킹 렌더(B)를 둘 다 뽑아 비교.
3. §5의 원칙 1·2·3·4를 적용한 프롬프트로 수동 호출.
4. **판정**: ✅ 4포즈 구분 + **좌우 정확** + 스켈레톤 선이 안 그려짐 → Phase 1.
   ⚠️ 좌우 틀림 → 원칙 4·5 강화 후 재시도, 그래도 안 되면 (B) 마네킹으로.
   ❌ 스켈레톤을 무시하거나 그대로 그림 → **접근 전환**: 스켈레톤은 사람이
   편집하는 UI로만 쓰고 모델엔 구조화된 포즈 텍스트로 전달(Cartwheel 경로).

### Phase 1 — 스켈레톤 렌더러 (1일)
관절 좌표 JSON → OpenPose 스타일 PNG. **`_infra/png.mjs`에 이미 자체 PNG
코덱이 있으므로** 선분·원만 픽셀 버퍼에 래스터화하면 된다(의존성 0).
COCO-18 토폴로지 + ControlNet 공식 색 규약. 옵션: `--ghost`(i±1 반투명 오버레이),
`--grid 4x2`.

### Phase 2 — 포즈 시퀀스 + 보간 (1일)
키 포즈 2~4개를 JSON으로 정의 → 각도 공간 보간 + ease → **루프 구간(N−1→0)도
같은 보간으로** 채움 → 치비 비율 리타게팅. 외부 데이터셋은 Phase 5로 미룬다.

### Phase 3 — 그리드 생성 (반나절) ⭐ 핵심 실험
8개 스켈레톤을 4×2 그리드 한 장으로 → 단일 호출 → **기존 sticker-pack.mjs
슬라이스·누끼 로직 재사용** → APNG. 같은 8프레임을 전략 1로도 만들어
**일관성·비용·품질 3축 비교**. 이 결과가 이후 아키텍처를 결정한다.

### Phase 4 — 검증 루프 (1~2일)
포즈 추정 기반 PCK 자동 재시도(§9 1축). 우리 build 지표에 편입.

### Phase 5 — 확장
이모티콘 정준 동작 라이브러리(인사·박수·웃음·울음·하트…)를 JSON으로 축적 —
**한 번 만들면 모든 캐릭터에 재사용**(DisCo의 Compositionality를 자산화).
AIST++ 댄스 도입, 얼굴 채널 분리(Kling 방식).

## 11. 리스크

| 리스크 | 근거 | 완화 |
|---|---|---|
| Gemini가 스켈레톤을 픽셀 정확히 안 따름 | VIBE: 난이도 상승 시 저하 | Phase 4 PCK 루프. 극단 포즈 회피 |
| 스켈레톤 선이 출력에 그려짐 | 실무 최빈 실패 | 원칙 2 명시 + 후처리 검출 |
| 8등신 스켈레톤이 치비를 늘림 | MusePose가 pose-align을 만든 이유 | Phase 2 리타게팅 필수 + 원칙 3 |
| 전후 모호성 | Beyond Skeletons의 명시적 한계 | 원칙 5 방향 텍스트, 또는 마네킹 전환 |
| 프레임 간 드리프트 | Gemini 일관성 "100%는 아님" | 그리드 단일 호출. 앵커를 시트로 고정 |

## 참고 자료

핵심: [Animate Anyone](https://arxiv.org/abs/2311.17117) ·
[Animate-X](https://arxiv.org/abs/2410.10306) ·
[FramePrompt](https://arxiv.org/abs/2506.17301) ·
[Kling-MotionControl](https://arxiv.org/abs/2603.03160) ·
[Sprite Sheet Diffusion](https://arxiv.org/abs/2412.03685) ·
[ControlNet](https://arxiv.org/abs/2302.05543)

계보: [DisCo](https://arxiv.org/abs/2307.00040) ·
[MagicAnimate](https://arxiv.org/abs/2311.16498) ·
[MagicPose](https://arxiv.org/abs/2311.12052) ·
[DreamPose](https://arxiv.org/abs/2304.06025) ·
[Champ](https://arxiv.org/abs/2403.14781) ·
[MimicMotion](https://arxiv.org/abs/2406.19680) ·
[MusePose](https://github.com/TMElyralab/MusePose) ·
[TCAN](https://arxiv.org/abs/2407.09012) ·
[DisPose](https://arxiv.org/abs/2412.09349) ·
[SP-Ctrl](https://arxiv.org/abs/2506.20983) ·
[Beyond Skeletons](https://arxiv.org/abs/2606.06903)

스티커 도메인: [Animated Stickers (Meta)](https://arxiv.org/abs/2402.06088) ·
[ILDiff (투명 채널)](https://arxiv.org/pdf/2412.20901)

Gemini: [이미지 생성 문서](https://ai.google.dev/gemini-api/docs/image-generation) ·
[Cartwheel 쇼케이스](https://ai.google.dev/showcase/cartwheel-2) ·
[VIBE 벤치마크](https://arxiv.org/abs/2602.01851) ·
[OpenPose+Nano Banana 워크플로](https://atlassc.net/2025/12/13/generate-image-with-pose-and-character-references)

*(리서치 제약: 세션 egress 정책으로 arxiv·github.io 직접 fetch가 차단되어
검색 결과 스니펫 종합에 근거함. 구현 착수 전 핵심 논문 원문 확인 권장.)*
