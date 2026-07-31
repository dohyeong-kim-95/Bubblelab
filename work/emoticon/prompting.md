# prompting — 이미지 생성 프롬프트 규약

Gemini(Nano Banana)·OpenAI gpt-image 공식 가이드를 리서치해(2026-07) 우리
파이프라인 규약으로 정리한 문서다. **프롬프트를 고칠 때 이 문서를 먼저 읽는다.**

계기: 부정어를 잔뜩 쓴 프롬프트가 오히려 금지한 것을 불러왔고(앞발 젤리,
귀 3개), 제약을 강화하자 이번엔 동작이 죽었다(`lesson_learned.md` §32~35).

## 0. 핵심 세 줄

1. **부정어를 쓰지 않는다.** Google 공식: *"Use positive framing: Describe what
   you want, not what you don't want (e.g. 'empty street' instead of 'no cars')."*
   Gemini에는 `negative_prompt` 파라미터가 **아예 없다**.
2. **변화를 먼저, 불변을 나중에 쓴다.** 연구 관측: 충돌 시 **먼저 언급된 속성이
   이긴다.** 불변을 앞에 두면 프리즈가 이겨서 프레임이 안 움직인다 — 우리
   nod3·nod4가 정확히 그 실패였다.
3. **모든 프레임은 원본 레퍼런스에서 1홉**(스타 토폴로지). 앞 프레임을 물고
   가면 5~10프레임에서 드리프트가 누적돼 무너진다.

## 1. 부정어가 역효과인 이유와 증거

- **메커니즘**: 이미지 캡션은 "있는 것"만 기술한다. "no cats"에 대응하는 시각
  표상이 학습되지 않아, 텍스트 인코더에는 강한 토큰 `cats`만 남는다.
- **Google 공식** (Cloud Blog, 축자): *"Use positive framing: Describe what you
  want, not what you don't want."* Vertex 문서는 이를 **Semantic Negative
  Prompts**라 부르며 같은 예를 든다.
- **OpenAI는 반대로** 부정문을 권장한다(`"no watermark"`, `"do not change
  anything else"`). 단 Cookbook도 부정문을 **단독으로 쓰지 않고** 항상 긍정
  보존 목록과 짝지어 쓴다.
- **우리 실측이 이걸 재현했다**: "NO paw pads" → 앞발 젤리 생김 /
  "exactly TWO ears, never more" → 귀 3개 / "no sideways tilt" → 옆으로 기울어짐.

**→ 우리는 Gemini를 쓰므로 부정어 0개가 원칙이다.**

## 2. 부정어 없이 "이건 바뀌면 안 된다"를 쓰는 세 가지 도구

### ① `동일한 X` 나열 (Same-list)
OpenAI Cookbook의 Character Anchor 패턴(축자): *"Same green hooded tunic /
Same facial features, proportions, and color palette"*.
Google도 같은 말을 한다(축자): *"Be explicit about what to keep exactly the same."*

### ② 부품 인벤토리 (Parts Inventory) — 가장 강력
"없어야 할 것"을 나열하는 대신 **있는 것을 개수와 함께 완전 열거**한다.
열거되지 않은 것은 자연히 배제되고, 숫자를 명시한 긍정문은 백파이어하지 않는다.

```
귀 2 · 눈 2 · 입 1 · 팔 2 · 다리 2 (사지 총 4)
앞발: 몸통과 같은 흰색 단색 면, 매끈한 타원 실루엣
배경: 완전한 단색 흰색 면
```

### ③ 목표 상태 재서술 (Positive Restatement)
금지하고 싶은 자리에 **무엇이 있는지**를 대신 쓴다.

| 금지하고 싶던 것 | 대신 쓰는 말 |
|---|---|
| 발바닥 패드 없음 | "앞발은 몸통과 같은 흰색 단색 면" |
| 꼬리 없음 | "몸통 뒤쪽은 끊김 없이 닫힌 둥근 곡선" |
| 귀 3개 금지 | "귀는 정확히 2개, 좌우 대칭" |
| 배경 없음 | "배경은 완전한 단색 흰색 면" |
| 텍스트 금지 | "캔버스에 있는 것은 캐릭터 하나뿐" |

Google 공식 스티커 템플릿조차 `"The background must be white."`로 쓴다 —
`"no background"`가 아니다.

## 3. 순서 — 변화가 먼저다

Google 공식: *"start a prompt with a strong verb that tells the model the
primary operation"*. 연구(arXiv 2506.01929): 충돌 시 **먼저 언급된 속성이
이기고, 구체가 추상을 이긴다.**

```
1) 동작(바뀌는 것)  — 명령형 동사 하나, 목표 상태 서술
2) 불변 목록        — 긍정 나열
3) 부품 인벤토리
4) 캔버스·카메라    — 상수
```

정체성은 어차피 **레퍼런스 이미지**가 붙들고 있다. 텍스트의 첫 자리는 변화에
내준다. **불변을 첫 자리에 놓으면 프레임이 안 움직인다** — 우리가 겪은 그 실패다.

## 4. 모순 금지 — 변형은 부피 보존으로 번역한다

"몸통 크기는 그대로" + "몸통이 찌그러진다"는 **논리적 모순**이다. 스쿼시는
정의상 실루엣 변형이다. 모델에 넘기기 전에 사람이 풀어야 한다.

- ❌ "몸통 크기를 정확히 동일하게 유지하되 세로로 눌린다"
- ✅ "몸통은 세로 0.85배로 눌리고 가로 1.12배로 퍼진다 — **부피감은 보존된다**"

불변량과 변형량을 **다른 축**에 둔다:

| 축 | 내용 |
|---|---|
| 정체성(불변) | 부품 개수, 색, 선 굵기, 머리:몸통 비율, 화풍, 캔버스, 카메라 |
| 변형(가변) | 실루엣 스쿼시, 관절 각도, 표정, 무게중심 |

## 5. 레퍼런스 사용법

- **`gemini-2.5-flash-image`는 입력 이미지 3장이 권장 상한.** (Gemini 3 Pro
  Image는 14장) — 우리 키 생성(시트+첫키+직전키)과 브레이크다운(시트+키A+키B)이
  정확히 3장이라 상한에 맞다.
- **레퍼런스가 주도하게 두고 텍스트 묘사는 짧게.** 매 프레임 캐릭터를 새로
  묘사하면 모델이 그걸 "새 사양"으로 읽어 드리프트가 생긴다.
- **CANON 블록은 바이트 단위로 동일하게.** 동의어로 바꾸는 것조차 "새 지시"다.
- 멀티 이미지는 **인덱스+역할 라벨**로: "Image 1: canonical character reference.
  Image 2: key pose A."

## 6. 스타 토폴로지 — 체인 금지

```
❌ ref → f1 → f2 → f3 …    드리프트·열화 누적, 5~10프레임에서 붕괴
✅ ref → f1,  ref → f2,  ref → f3   (모두 원본에서 1홉)
```

멀티턴 편집 체인은 누적 아티팩트가 문서화돼 있다(FreqEdit arXiv 2512.01755,
AnchorEdit 2606.11751). 대화형 편집은 **탐색용**으로만 쓰고, 확정되면 그
프롬프트로 레퍼런스에서 1홉 재생성한다.

인비트윈만 예외적으로 [시트, 키A, 키B] 3장을 쓰되, **A와 B 자체는 시트에서
1홉**이어야 한다.

## 7. 스티커 특이사항

- Google 공식 템플릿: `"A [style] sticker of a [subject], featuring [key
  characteristics] and a [color palette]. The design should have [line style]
  and [shading style]. The background must be white."`
- 알려진 실패: 해부 오류(여분 사지), 멀티뷰 붕괴, 패널 간 디테일 드리프트 —
  **한 이미지에 여러 포즈를 몰아넣을수록 심해진다.** 프레임은 개별 생성이 낫고
  시트는 레퍼런스 보강용으로만 쓴다.
- Nano Banana는 **스타일 전이가 약하다** — 화풍은 프롬프트로 바꾸려 하지 말고
  레퍼런스로 고정한다.

## 8. 우리 프롬프트 템플릿

### 키 포즈
```
Redraw the character from Image 1 in a new pose.

POSE — the only thing that differs in this frame:
  {포즈 문장: 명령형 하나, 목표 상태}
  {표정 문장}

IDENTITY — same as Image 1:
  same character, same colors, same head-to-body ratio,
  same uniform black outline weight, same flat cel-shaded style

PARTS: {부품 인벤토리}

CANVAS: the background is a solid white surface; square 1:1 canvas;
  front view at eye level, the character's feet rest on the same baseline
```

### 브레이크다운
```
Draw the in-between frame between Image 2 and Image 3.

TIMING: this frame is at {T}% of the way from Image 2 to Image 3.
MOTION: {보간 서술 — 부피 보존 표현}
IDENTITY / PARTS / CANVAS: (키와 동일한 상수 블록)
```

### 포즈 문장 작성 규칙
- ✅ "왼팔을 어깨 높이까지 들어 손바닥이 정면을 향한다" (목표 상태)
- ❌ "손을 흔든다" (동작 — 잔상·모션블러가 생길 수 있다)
- ❌ "왼팔만 바꾸고 나머지는 건드리지 마" (부정 + 프리즈 과잉)

## 9. 자동 검사 (구현됨 — `_infra/emoticon-prompt.mjs`)

1. **부정어 스캐너**: `no / not / don't / never / avoid / without / remove /
   그리지 마 / 없이` 등이 프롬프트에 있으면 빌드 실패.
2. **모순 검사**: "같은 크기"류와 "눌린다/늘어난다"류가 한 프롬프트에 같이
   있으면 실패 → 부피 보존 표현으로 유도.
3. **CANON 해시**: 불변 블록이 프레임마다 같은지 검사.

## 참고 자료

공식(직접 확인): [Ultimate prompting guide for Nano Banana — Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) ·
[GPT Image Prompting Guide — OpenAI Cookbook](https://github.com/openai/openai-cookbook/blob/main/examples/multimodal/image-gen-models-prompting-guide.ipynb)

공식(검색 경유): [Gemini API image generation](https://ai.google.dev/gemini-api/docs/image-generation) ·
[Gemini image generation best practices](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/gemini-image-generation-best-practices) ·
[Gemini image generation limitations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/gemini-image-generation-limitations) ·
[Nano Banana Pro prompt tips](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/)

부정어 실패: [OpenAI Community — negative instructions ignored](https://community.openai.com/t/image-prompts-ignore-specific-negative-instructions-to-not-include-something/648023) ·
[No elephants — Ethan Mollick](https://www.oneusefulthing.org/p/no-elephants-breakthroughs-in-image)

연구: [Contextually-Contradictory Prompts (2506.01929)](https://arxiv.org/pdf/2506.01929) ·
[FreqEdit — 멀티턴 열화 (2512.01755)](https://arxiv.org/pdf/2512.01755) ·
[AnchorEdit (2606.11751)](https://arxiv.org/pdf/2606.11751)

실무: [Max Woolf — Nano Banana prompt engineering](https://minimaxir.com/2025/11/nano-banana-prompts/)

*(리서치 제약: ai.google.dev·blog.google·arxiv 등은 프록시 차단으로 검색
스니펫 기반. Google Cloud Blog와 OpenAI Cookbook은 원문 직접 확인.)*
