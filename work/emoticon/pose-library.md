# pose-library — 감정·동작별 포즈 문장 사전

새 컷을 만들 때 **여기서 문장을 가져다 쓴다.** 실측으로 검증된 것만 올리고,
실패한 표현은 그 자리에 남겨서 다시 쓰지 않게 한다.

규약 자체(부정어 금지·변화 먼저·부품 인벤토리)는 [`prompting.md`](prompting.md),
머리 회전 기하는 [`nod-anatomy.md`](nod-anatomy.md)에 있다. 이 문서는 **그
규약을 부위·감정별 완성 문장으로 굳힌 것**이다.

## 0. 문장을 쓰는 세 가지 원칙 (전부 실패에서 나왔다)

### ① 가리는 것을 말하지 말고, 남는 형태를 말한다
모델은 "가리는 것"을 **도형으로 그려버린다.**

| ❌ 쓰지 말 것 | 실측 결과 | ✅ 대신 |
|---|---|---|
| `the upper eyelids cover the top half of each eye` | 눈꺼풀이 콧등을 가로지르는 큰 덩어리로 그려짐 (blink1 F3) | `each eye is a small flat oval, half as tall as in Image 1, with the dark iris still showing` |
| `the eyelids have come down over the eyes` | 얼굴 전체를 덮는 가면 (blink1 F3 초판) | 〃 |

**부위 이름 + 동작**보다 **부위 이름 + 최종 형태**가 안전하다.

### ② 좌우 대칭은 명시하지 않으면 깨진다
`poseConstants`에 없는 대칭은 모델이 관용구로 채운다.

- 눈 대칭을 안 쓴 blink1 → **두 프레임 다 윙크**가 됐다(한쪽만 감김).
- 문구를 넣자 한 번에 해결: `both eyes close by the same amount at the same
  time, and the two eyes are always mirror images of each other`
- 귀도 같다: `the two ears stay symmetric left and right`

### ③ 배율은 숫자로, 부위 위치는 POSE에
`wider`·`bigger` 같은 열린 형용사는 상한 없이 읽힌다(실측 가로 +33%).
부품 **개수**는 CANON이 지키지만 **위치**는 POSE에서 말해야 한다.

## 1. 매 컷에 넣는 공통 문장 (poseConstants)

```
the head outline, the body and the feet are drawn where Image 1 has them;
the character faces the viewer straight on and the two ears stay symmetric
left and right; both eyes close by the same amount at the same time, and the
two eyes are always mirror images of each other
```

부품 인벤토리(invariants)는 캐릭터마다 고정:

```
two long upright ears whose bases sit on top of the head, two eyes, one mouth,
two short arms, two feet; two pink oval inner ears; two round pink cheek
blushes; the canvas holds only this one character
```

## 2. 눈 — 감김 단계 (검증됨: blink1)

| 단계 | 문장 |
|---|---|
| 뜸 | `the eyes are wide open and round` |
| 살짝 | `the eyes are slightly narrowed, still round and dark` |
| 반 | `each eye is a small flat oval, half as tall as in Image 1, with the dark iris still showing` |
| 실눈 | `the eyes are narrow curved slits with only a sliver of the dark iris showing` |
| 감김 | `the eyes are shut, drawn as two short downward-curving lines` |
| 웃는 눈 | `the eyes are shut and curve upward into gentle happy arcs` |
| 꽉 감음 | `the eyes are squeezed into deep happy arcs` |

**실측 부수효과: 눈을 감기면 얼굴이 저절로 내려간다.** 이 캐릭터 디자인에서
웃는 호는 뜬 눈보다 아래에 그려져, 이마 여백이 162 → 195px 벌어진다
(`nod-anatomy.md` §6 지표로 0.39 → 0.47). **끄덕임처럼 보이게 하는 공짜 효과**이고,
반대로 **순수한 표정 변화만 원할 때는 이게 노이즈**다.

## 3. 입

| 상태 | 문장 |
|---|---|
| 다문 미소 | `a gentle closed-mouth smile` |
| 살짝 벌림 | `the mouth has just parted` |
| 작게 벌린 미소 | `the mouth is a small open smile` |
| 크게 | `the mouth is a wide open smile` |
| 혀 | `a wide open smile with a small pink tongue` |

## 4. 팔 — 위치를 반드시 쓴다

안 쓰면 배 위로 접히거나 개수가 늘어난다(nod5 손 4개, nod11 팔 4개).

| 상태 | 문장 |
|---|---|
| 기본 | `each short arm is a small rounded nub on the outer edge of the body silhouette, level with the middle of the belly` |
| 옆으로 늘어뜨림 | `both short arms hang at the sides of the body` |
| 한쪽 들기 | `the arm on the left side of the image is raised beside the head with the paw open` |

## 5. 귀 — 종류가 바뀌지 않게 밑동을 고정한다

`ears swing forward`라고만 쓰면 **선 귀가 처진 귀로 교체**된다(nod5).

| 상태 | 문장 |
|---|---|
| 기본 | `both ears standing straight up` |
| 앞으로 기울기 | `both ears keep their full length and their bases stay on top of the head, and only the top third of each ear tips forward` |
| 뒤로 눕기 | `both ears keep their full length with their bases on top of the head, and both ears lean back about 10 degrees` |

## 6. 아직 해결 안 된 것

- **끄덕임(머리 숙임)** — 아홉 번 모두 실패. 텍스트로도 배치도 이미지로도
  얼굴 세로 위치를 못 바꾼다. 리그(`emoticon-rig.mjs`)로 간다.
- **통통튀기** — 미착수. 전신 세로 이동이라 끄덕임과 같은 벽에 부딪힐
  가능성이 높다. 리그를 먼저 검증하고 들어간다.

## 7. 컷 스펙 뼈대

```json
{
  "assembly": "pingpong", "breakdowns": 0, "fps": "12",
  "invariants": "(§1 부품 인벤토리)",
  "poseConstants": "(§1 공통 문장)",
  "keys": [
    { "pose": "(§2~5에서 조합)", "hold": 7 },
    { "pose": "…", "hold": 1 },
    { "pose": "…", "hold": 5 }
  ]
}
```

- **편도 8장이 기준선.** 그 아래면 게이트가 경고한다(사람 검수 반복 요구).
- 홀드 합 × 2(핑퐁) = 24프레임이면 12fps에서 2.00초 = 카카오 규격.
- 컷 하나 8장 = **$0.312**, 불량 프레임 1장 재작업 = **$0.039**.
