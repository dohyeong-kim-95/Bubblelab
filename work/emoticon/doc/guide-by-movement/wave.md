# wave — 인사 (손 흔들기)

**상태: △ 수정 요청.** 컷 `wave`(7장, "지금까지중 제일좋음") → `wave2`(8장).
채널은 **팔 각도** — 우리 파이프라인이 성공적으로 다루는 몇 안 되는 동작 채널이다.

## 되는 것

- **팔을 올렸다 내리는 것 자체는 된다.** 어깨 높이 → 볼 옆까지 올라가고,
  손끝을 바깥 25°·안쪽 20°로 기울이는 지시를 따른다.
- 편도 8프레임이면 부드럽다(사람 검수 확인).
- 표정을 같이 바꾸면(눈 뜸 → 웃는 호 → 벌린 입) 인사의 감정이 실린다.

## 반드시 코드로 잡아야 하는 것 두 가지

### ① 든 팔의 좌우 — `mirror`
"화면 기준 왼쪽"이라고 써도 프레임마다 좌우가 뒤집힌다. wave2 실측:
2번 왼쪽, 3~7 오른쪽, 8번 다시 왼쪽 — **한 컷에서 두 번 뛰었다.**
열 번 넘게 텍스트로 실패한 축이다(`lesson_learned.md` §9·§12·§22).

이 캐릭터는 정면 좌우대칭이라 **프레임을 통째로 뒤집으면 든 팔 방향만 바뀐다.**

```bash
node _infra/emoticon.mjs mirror <작업폴더> <컷> "2,8"
node _infra/emoticon.mjs build <작업폴더> <컷>
```

무손실·결정론적·무료다. **재작업($0.04)보다 먼저 시도할 것.**

### ② 몸 흔들림 — `alignFrames` (build 기본)
모델이 프레임마다 캐릭터를 새로 그려서 몸이 몇 px씩 움직인다. wave2 실측
하체 중심 502~517px(14px). 재생하면 **"몸이 갑자기 translation"**한다.
`build`가 발 바닥선 + 하체 가로 중심 기준으로 자동 정렬한다.

## 아직 못 고친 것 — 겨드랑이

**팔이 몸에서 갈라지는 지점이 프레임마다 튄다.** 사람 검수:
"다른 그림을 붙여놓은 느낌이 나요. 이 부분은 개선해야 움직이는 이모티콘의
느낌이 납니다."

평행이동으로는 안 된다(그림 안쪽 문제). 구조적 해법은 **몸을 한 번만 그리고
팔만 따로 합성**하는 것이며, 리깅 본체 작업이다. 미착수.

## 검증된 스펙

```json
{
  "assembly": "pingpong", "breakdowns": 0, "fps": "12",
  "poseConstants": "…; the arm on the right side of the image stays a small rounded nub at the side of the body, level with the middle of the belly; each raised paw is one smooth rounded shape in the same plain white surface as the body",
  "keys": [
    { "pose": "standing upright, both short arms are small rounded nubs at the sides of the body, the eyes are wide open and round, a gentle closed-mouth smile", "hold": 3 },
    { "pose": "the arm on the left side of the image is lifted so the paw sits level with the shoulder, …", "hold": 1 },
    { "pose": "… the paw sits beside the cheek, the paw open and pointing straight up, the eyes are shut and curve upward into gentle happy arcs, …", "hold": 1 },
    { "pose": "… the whole paw tips outward away from the head by about 25 degrees, …", "hold": 2 },
    { "pose": "… the whole paw stands straight up again, …", "hold": 1 },
    { "pose": "… the whole paw tips inward toward the head by about 20 degrees, …", "hold": 2 },
    { "pose": "… tips outward … with a small pink tongue", "hold": 2 },
    { "pose": "… stands straight up … with a small pink tongue", "hold": 3 }
  ]
}
```

홀드 합 15 + 핑퐁 9 = 24프레임 = 2.00초. 8장 생성 $0.312.

## 주의

- **앞발에 젤리(분홍 발바닥)가 생긴다.** `poseConstants`에 "each raised paw is
  one smooth rounded shape in the same plain white surface as the body"를 넣어야
  한다. 부품 검사는 발바닥을 세지 않으므로 게이트가 못 잡는다.
- 게이트가 완전 PASS를 줘도 **좌우 뜀은 못 잡는다.** 프레임 그리드를 눈으로
  볼 것.
