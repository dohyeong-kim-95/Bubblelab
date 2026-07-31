# skeleton-rigs — body plan별 리그 설계 (리서치)

우리가 실제로 만든 이모티콘 8종의 체형을 분류하고, 업계 리깅 관행·동물 포즈
표준·비인간 캐릭터 포즈 제어 연구를 조사해 **리그 세트**를 설계한 문서다
(2026-07). 스켈레톤 조건화 1차 실패(`lesson_learned.md` §24~25)의 후속.

**현재 실행 우선순위는 아니다.** 품질 게이트가 먼저이고, 이 문서는 스켈레톤을
다시 볼 때(특히 팔다리가 뚜렷한 캐릭터를 다룰 때) 꺼내 쓰는 설계 자산이다.

## 0. 출발점 — 우리 이모티콘 8종의 체형 분류

기존 산출물을 실물로 분류한 결과가 설계의 근거다.

| body plan | 개수 | 실물 |
|---|---|---|
| **BUST** (상반신, 다리 없음) | 3 | 후드 소년(검지로 위 가리킴) · 회색 고양이(턱에 앞발) · 회색 고양이(엄지척) |
| **CHIBI BIPED** (스텁팔 이족) | 1 | 두 앞발로 팻말 든 강아지 |
| **QUADRUPED** (비기립) | 3 | 강아지+고양이 기대앉기 · 강아지 엎드려 자기 · 말 뒤집혀 웃기 |
| **LIMBLESS BLOB** | 1 | 매트 위 물범(지느러미만) |

**서 있는 전신 인간형이 하나도 없다.** 우리가 만든 스켈레톤은 정확히 그
하나였으므로 8종 전부와 맞지 않았다. 이게 1차 실패의 구조적 원인이다.

## 1. 업계는 이미 body plan별로 리그를 나눈다

### Live2D Cubism — 표준 파라미터 40개에 **다리가 0개**

공식 `CubismDefaultParameterId.cpp`의 표준 파라미터 구성:

| 그룹 | 개수 | 예 |
|---|---:|---|
| 얼굴(눈·눈썹·입·볼) | **18** | `ParamEyeLOpen`, `ParamBrowLAngle`, `ParamMouthOpenY`, `ParamCheek` |
| 머리 각도 | 3 | `ParamAngleX/Y/Z` |
| 몸통 | 4 | `ParamBodyAngleX/Y/Z`, `ParamBreath` |
| 팔·손 | 6 | `ParamArmLA`, `ParamArmLB`, `ParamHandL` … |
| 머리카락 | 4 | `ParamHairFront` … |
| 기타 | 5 | `ParamShoulderY`, `ParamBaseX/Y` … |
| **다리** | **0** | — |

- **다리 파라미터가 없다.** VTuber·이모티콘 도메인의 사실상 표준은 버스트다.
  우리 8종 중 3종이 버스트인 건 편중이 아니라 도메인 정상값.
- **목 파라미터가 없다** — 머리 각도와 몸통 각도가 직결. "목 없는 캐릭터"가 전제.
- **팔은 관절이 아니라 A/B 두 단계**(`ArmLA`/`ArmLB`) — 해부학적 상완/전완이
  아니라 "1단계/2단계 흔들기". 스텁팔에 맞는 추상화다.
- 얼굴이 40개 중 18개. **표현의 중심은 사지가 아니라 얼굴.**

### Spine 2D — 공식 `chibi-stickers` 예제가 우리와 같은 목적

일반 인간형(`spineboy-pro`) 대비 치비 리그가 **버린 것 / 늘린 것**:

| | spineboy | chibi-stickers |
|---|---|---|
| 척추 | torso/torso2/torso3 3분할 + 목 | **`hips → body-up` 1본, 목 없음** |
| 팔 | shoulder+upper+bracer+fist (4) | holder+up+down (실질 2), **손 본 없음** |
| 다리 | thigh+shin+foot+tip (4) | up+down (2) + IK 타깃, **발 본 없음** |
| 얼굴·이펙트 | 최소 | **눈물·홍조·땀방울·헤드 이펙트 본 증축** |

→ **치비 리깅 = 사지 본 감축 + 얼굴/이펙트 본 증축.** Live2D와 같은 결론.

사족(`dragon-ess`)은 `center`를 루트로 `chest`/`back`/`neck` 3분기, 앞다리는
chest에 뒷다리·꼬리는 back에. 무사지(`owl-pro`)는 몸통축 2본+머리 1본.
블롭(`sack-pro`)은 **관절이 아니라 몸통축 2본 + 코너 디포머 4 + belly**.

### 나머지 툴

- **Cartoon Animator**: Human / **Quadruped** / Wing / Spine / Free-bone
  **다섯 종류 템플릿을 명시적으로 출하**. 템플릿 간 차이는 "본 방향 + 파트
  이름"뿐이라고 공식 문서가 밝힌다 → 우리도 렌더 규약은 공유하고 조인트
  이름만 바꾸는 게 맞다.
- **Adobe Character Animator**: 본이 아니라 **레이어 이름 규약**으로 리그를
  추론(`Head`, `Left Arm`…). **라벨만으로 리그가 성립한다**는 증거 — 아래
  §4의 "조인트에 텍스트 라벨" 권고의 방법론적 근거.
- **Moho**: Characters Pack과 **Animals Pack이 분리 판매**.

## 2. 동물 포즈에는 표준이 있다 — AP-10K 17점

NeurIPS 2021, 54종 10,015장. 키포인트:

```
1 L_Eye  2 R_Eye  3 Nose  4 Neck  5 Root_of_Tail
6 L_Shoulder  7 L_Elbow  8 L_F_Paw   9 R_Shoulder 10 R_Elbow 11 R_F_Paw
12 L_Hip 13 L_Knee 14 L_B_Paw  15 R_Hip 16 R_Knee 17 R_B_Paw
```

**구조적으로 중요한 두 가지**:
- **사족 척추는 단 1개 세그먼트**(neck→root_of_tail). 인간 openpose의
  nose-neck-hip 구조와 달리 몸통을 선분 하나로 본다 — 치비에 이식하기 쉽다.
- **꼬리 끝·귀·주둥이 끝이 없다.** 치비 동물 이모티콘에서 귀·꼬리는 감정
  표현의 핵심이라 확장이 필요하다(Animal-Pose 20점은 `EarBase` 2점을 가짐).

## 3. 결정적 증거 — 커스텀 스켈레톤은 ControlNet에서 안 통한다

ControlNet 생태계에서 동물 포즈를 지원하려고 **`control_sd15_animal_openpose.pth`
(1.45GB)를 별도로 훈련**해야 했다. 사람용 openpose 모델에 동물 스켈레톤을
넣는 것으로는 안 됐다는 뜻이다.

→ **확산 모델의 포즈 이해는 "학습된 픽셀 컨벤션"이지 일반화된 골격 개념이
아니다.** 우리가 임의로 만든 리그를 ControlNet에 넣는 접근은 애초에 성립하지
않는다.

**그런데 Gemini는 ControlNet이 아니다.** ControlNet 브랜치 없이 포즈 이미지를
일반 참조 이미지로 in-context 투입하고 **읽어서 해석**한다. 설계 원칙이
정반대가 되어야 한다:

| | ControlNet openpose | Gemini in-context |
|---|---|---|
| 색상 규약 | **필수**(학습 신호) | **무의미하고 유해** — 색이 출력으로 샌다 |
| 조인트 개수 고정 | 필수 | 불필요 |
| 텍스트 라벨 | 무의미 | **매우 효과적** |
| 캐릭터 비율 일치 | 중요 | **매우 중요** |
| few-shot 예시 | 불가 | **가능하고 강력** |

**우리 1차 실패의 재진단**: 색이 출력에 샌 것(`lesson_learned` §24)은
**OpenPose 팔레트가 Gemini에게 아무 의미 없는 "네온 막대기 그림"이었기
때문**이다. 우리는 ControlNet 규약을 ControlNet이 아닌 모델에 쓰고 있었다.
거기에 인간 비율 스켈레톤 vs 머리 50% 스텁팔이라는 비율 오정렬이 겹쳤다.

관련 학술: **Animate-X**(비인간 캐릭터 일반화 실패를 1급 문제로 정의,
오정렬을 학습으로 흡수), **MikuDance**(스케일·체형을 모션 가이던스에 정렬),
**Champ**(스켈레톤은 체형 정보를 못 담아 depth/normal 병용),
**How to Train Your Dragon**(캐릭터의 포즈 3~5장 + 대응 스켈레톤 **few-shot**
으로 리그를 추론 — 우리가 프롬프트에 넣을 수 있는 형태).

## 4. 재시도한다면 — 모든 리그 공통 규약

1. **컬러 금지.** 흰 배경, 검은 선·점. 색 leak의 근본 차단.
2. **캐릭터 비율로 그린다.** 머리 원이 캔버스 높이의 45~55%, 스텁팔은 몸통
   폭의 25~35% 선분. **단독으로 가장 큰 개선이 기대되는 항목.**
3. **실루엣을 깔고 그 위에 조인트를 얹는다.** 옅은 회색 실루엣 + 검은 관절점
   → 형태와 구조를 한 장에. (Champ이 depth/normal을 넣는 논리와 동일)
4. **조인트에 영문 라벨을 붙인다** (`head`, `L paw`, `chin`…).
5. **역할을 못 박는다**: "Image 2 is a black-and-white POSE DIAGRAM, not
   artwork. Do NOT render lines, dots, labels, or grey fill."
6. **few-shot 페어 1~3쌍 첨부** — 기존 8종에서 (다이어그램, 결과) 역산.
7. 조인트 정규화 좌표를 **텍스트로도 병기**.

## 5. 리그 세트 제안

### RIG-A `BUST-8` — 버스트 (우리 8종 중 3종)

`head_top` `head_center` `face_dir` `neck_pivot` `body_center`
`shoulder_L/R` `paw_L/R` (+옵션 `gesture_focus`)

**팔꿈치 없음** (Live2D `ArmLA/LB`·Spine 치비의 손 본 생략과 같은 판단).
`head_top`–`head_center`를 이어 **머리 기울기**를 전달하는 게 치비 최대 표현.

> 권장: **실루엣 + 손 모양 미니 스케치 + 라벨.** 버스트는 손 모양(가리키기·
> 엄지척)이 정보의 대부분인데 점 하나로 표현 불가. 순수 스틱피겨 부적합.

### RIG-B `CHIBI-BIPED-11` — 스텁팔 이족

`head_top` `head_center` `face_dir` `ear_L/R` `body_top` `body_bottom`
`paw_L/R`(어깨 생략, body_top 직결) `foot_L/R`(접지점만) + 옵션 `prop_box`

> 권장: 실루엣 + 조인트 + **소품 박스**(팻말 등은 스켈레톤으로 표현 불가).

### RIG-C `QUAD-13` — 사족 비기립 (3종)

AP-10K 이름을 그대로 쓰되 **팔꿈치·무릎 제거**, **귀·꼬리끝·접지선 추가**:
`nose` `head_center` `ear_L/R` `neck` `root_of_tail` `tail_tip`
`L/R_front_paw` `L/R_back_paw` **`ground_A` `ground_B`**

**`ground_A/B`가 결정적이다.** 우리 사족 3종이 전부 앉기·엎드리기·뒤집히기다.
접지선이 없으면 모델은 기본값인 "서 있는 네발짐승"으로 되돌아간다.

> 권장: **AP-10K 호환 스틱피겨 + 접지선.** 4개 리그 중 **유일하게 순수
> 스틱피겨가 통할 가능성이 있는 케이스**(표준 prior가 존재하고 사지가 실제로
> 선분이다).

### RIG-D `BLOB-6` — 무사지 덩어리

`head_center` `body_center` `tail_tip` `flipper_L/R` `belly_low` + 접지선.
Spine `sack` 리그(축 + 코너 + belly) 차용.

> 권장: **실루엣 단독, 스켈레톤 쓰지 말 것.** 사지가 없으면 스틱피겨의
> 정보량이 실루엣보다 압도적으로 적다. 실루엣이 곧 포즈다.

### RIG-E `SCENE-ANCHOR` — 다중 캐릭터 (보조 규약)

캐릭터별 리그를 `A.`/`B.` 접두어로 두 번 그리고, 맞닿는 지점을 `contact_n`
마커로, 공유 접지선 1개, 앞뒤 순서를 텍스트로 명시.

### 매핑 요약

| body plan | 리그 | 1순위 컨디셔닝 | 스틱피겨 단독 적합도 |
|---|---|---|---|
| BUST | `BUST-8` | 실루엣 + 손 스케치 + 라벨 | 낮음 |
| CHIBI BIPED | `CHIBI-BIPED-11` | 실루엣 + 조인트 + 소품 박스 | 중간 |
| QUADRUPED | `QUAD-13` | AP-10K 스틱피겨 + 접지선 | **높음** |
| BLOB | `BLOB-6` | **실루엣 단독** | 매우 낮음 |

## 6. 스켈레톤 말고 다른 길

| 방식 | 적합성 | 비고 |
|---|---|---|
| **실루엣/마스크** | 높음 | 색 leak 위험 없음. 스텁팔·무사지에 최적 |
| **pose-by-example**(캐릭터 스타일 러프 스케치) | 매우 높음 | Gemini의 "스케치→장면" 공식 역량. 비율 오정렬이 원천 소멸. 단 프레임마다 그림 필요 |
| depth map | 낮음 | Gemini는 depth를 학습된 조건으로 받지 않음 |
| **ARAP 워핑**(Meta Animated Drawings) | 별도 트랙 | 재생성 없이 원본을 직접 변형 → **프레임 간 일관성이 공짜**. 관절 각도만 바뀌는 프레임(호흡·흔들기·갸웃)에 최적. 단 새 손 모양·표정은 못 만듦 |

**혼합 전략**: 각도만 바뀌는 프레임은 ARAP 워핑, 새 형태가 필요한 프레임만
Gemini 생성 — 비용과 일관성을 동시에 개선한다.

## 7. 재시도 순서 (싼 것부터)

1. **흑백화 + 역할 명시만** — 기존 스켈레톤 유지, 색만 제거. 색 leak이
   사라지는지 확인. 가장 싼 실험.
2. **비율 리타게팅** — 캐릭터 비율로 다시 그리기. 단독 최대 개선 기대.
3. **실루엣 레이어 추가** — 조인트를 캡슐·원 union으로 렌더(머리=원,
   몸통=둥근 사각, 스텁팔=짧은 캡슐). 렌더러 하나로 4개 리그 커버 가능.
4. 라벨 + 정규화 좌표 병기 → 5. few-shot 페어 → 6. ARAP 병행 검토.

## 참고 자료

리깅: [Live2D 표준 파라미터(소스)](https://github.com/Live2D/CubismNativeFramework/blob/develop/src/CubismDefaultParameterId.cpp) ·
[Live2D 파라미터 목록](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/) ·
[Spine 예제 스켈레톤](https://github.com/EsotericSoftware/spine-runtimes/tree/4.2/examples) ·
[Spine Chibi Stickers](http://esotericsoftware.com/spine-examples-chibi-stickers) ·
[Cartoon Animator 캐릭터 타입](https://manual.reallusion.com/Cartoon-Animator/Content/Resources/ENU/03_Actor/Character_Types/Character_Types.htm) ·
[Character Animator 레이어 태그](https://helpx.adobe.com/adobe-character-animator/using/puppet-layers.html)

동물 포즈: [AP-10K](https://github.com/AlexTheBad/AP-10K) ·
[AP-10K 스켈레톤 구현](https://github.com/Fannovel16/comfyui_controlnet_aux/blob/main/src/custom_controlnet_aux/dwpose/animalpose.py) ·
[Animal-Pose](https://sites.google.com/view/animal-pose/) ·
[animal_openpose 전용 모델](https://huggingface.co/huchenlei/animal_openpose)

학술: [Animate-X](https://arxiv.org/abs/2410.10306) ·
[MikuDance](https://arxiv.org/abs/2411.08656) ·
[Champ](https://arxiv.org/abs/2403.14781) ·
[How to Train Your Dragon](https://arxiv.org/abs/2503.15586) ·
[Meta Animated Drawings (ARAP)](https://dl.acm.org/doi/10.1145/3592788)

*(리서치 제약: arxiv·huggingface·live2d 문서는 프록시 차단으로 검색 스니펫
기반. 단 Live2D 파라미터 40개 전체, Spine 5개 예제 본 계층, AP-10K 17점·엣지
정의는 GitHub 소스에서 직접 추출한 1차 자료다.)*
