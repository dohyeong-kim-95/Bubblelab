# poses — 재사용 포즈 라이브러리

동작 하나 = JSON 파일 하나. **관절 각도만 저장하므로 캐릭터와 무관하고,
한 번 잘 나온 동작은 모든 캐릭터·모든 팩에 재사용된다.** 뼈 길이(비율)는
캐릭터 쪽 값이라 분리돼 있다 — "각도 = 모션, 길이 = 정체성"
(`../../../work/emoticon/pose-conditioning.md` §7).

## 형식

```json
{
  "name": "wave",
  "description": "손 흔들기",
  "steps": 2,                  // 키 사이에 끼울 인비트윈 수
  "loop": "pingpong",          // pingpong | cycle | none
  "keys": [
    { "root": [0.5, 0.62], "angles": { "upperArmR": 100, "foreArmR": 95 } }
  ]
}
```

- **각도는 월드 기준(도)**: `0` = 화면 오른쪽, `90` = 아래, `-90` = 위.
  화면 기준이라 좌우 모호성이 없다.
- **뼈 이름의 R/L은 캐릭터 기준**(OpenPose COCO 규약). 정면을 보는 캐릭터의
  `R`(오른쪽)은 **화면에서는 왼쪽**에 그려지고, 렌더링 색도 빨강 계열이 된다.
- 생략한 각도는 기본 자세(`REST_ANGLES`)를 쓴다 — 바뀌는 관절만 적으면 된다.
- `root`는 골반 중심의 캔버스 상대 좌표. 생략 시 `[0.5, 0.62]`.

관절 이름: `spine` `neck` `head` `upperArmR/L` `foreArmR/L` `thighR/L` `shinR/L`

## 루프 종류

| loop | 동작 | 쓸 곳 |
|---|---|---|
| `pingpong` | 끝까지 갔다가 되돌아옴 — **편도만 저작하면 된다** | 끄덕임·손 흔들기·두근거림 |
| `cycle` | 마지막→첫 구간까지 보간해 순환을 닫음 | 걷기·회전처럼 한 방향 순환 |
| `none` | 키 사이만 | 루프 아닌 단발 |

## 렌더 확인

```bash
node _infra/skeleton-cli.mjs _src/emoticon/poses/wave.json --out /tmp/wave --grid
```
