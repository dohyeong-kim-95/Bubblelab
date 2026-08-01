# blink-research — 우리 깜빡임이 시중 것과 왜 다른가

blink1을 v0로 확정하면서 "시중에서 팔리는 깜빡임과는 다른 느낌"이라는 검수
의견이 나왔다. 무엇이 다른지 생리학·작화 관례·우리 실측 세 층으로 비교한다.

**결론부터: 우리 것은 깜빡임이 아니라 "눈 감고 웃기"라는 표정 변화다.**
느낌이 다른 건 그림이 아니라 **타이밍 구조**가 다르기 때문이고, 세 가지가
갈린다 — ①속도 ②비대칭 ③최하점에 머무는 시간.

## 1. 생리 — 진짜 깜빡임의 숫자

| 항목 | 값 |
|---|---|
| 전체 (감기 시작 → 완전히 뜸) | **100~400ms** |
| 감는 구간 (downstroke) | **50~100ms** |
| 뜨는 구간 (upstroke) | **150~300ms** |
| 자연 깜빡임 빈도 | 분당 15~20회 = **3~4초에 한 번** |

핵심은 **비대칭**이다. 감기는 안륜근(orbicularis oculi)의 빠른 수축이고, 뜨는
건 상안검거근(levator palpebrae superioris)의 정밀한 제어라 훨씬 느리다.
**뜨는 데 감는 것의 2~3배가 걸린다.**

## 2. 작화 관례

- 표준 타이밍: **감기 3~5프레임 → 짧은 홀드 → 뜨기 2~4프레임** (24fps 기준).
- 옛 교본은 "깜빡임은 대칭이니 감기·뜨기에 같은 프레임 수를 쓰라"고 했는데,
  **실측 연구가 이를 반박한다** — 자연 깜빡임은 시간·공간 양쪽으로 뚜렷이
  비대칭이다.
- **위 눈꺼풀이 이동의 대부분을 담당하고 아래 눈꺼풀이 뒤따라온다.**
- 스티커 맥락: LINE 애니메이션 스티커는 **최대 4초, 5~20프레임**. 분당 15~20회
  빈도를 2초 루프에 옮기면 **깜빡임 한 번 + 나머지는 전부 뜬 눈 홀드**다.

## 3. 우리 blink1 실측

```
타임라인(프레임): 1 2 3 4 5 6 7 8 7 6 5 4 3 2   (14슬롯, 1996ms)
지속(ms):       583 83 83 83 83 83 83 417 83 83 83 83 83 83
```

| 구간 | 우리 | 진짜 깜빡임 |
|---|---|---|
| 뜬 눈 홀드 | 583ms | 3~4초 |
| **감기** | **332ms** (4프레임) | **50~100ms** |
| 최하점 체류 | **666ms** | ~0 (바로 뜬다) |
| 뜨기 | 498ms | 150~300ms |
| 눈 동작 총합 | **~1500ms** | 100~400ms |

## 4. 차이 세 가지

### ① 감는 속도가 3~6배 느리다
진짜 깜빡임의 감기는 50~100ms인데 우리는 332ms다. **12fps에서 1프레임이
83ms이므로, 생리적으로 정확한 감기는 "1프레임"이다.** 시중 스티커의 깜빡임이
탁 하고 끊기는 느낌인 이유가 이것 — 프레임레이트 바닥에 붙어 있다.

### ② 핑퐁이라 감기와 뜨기가 같은 그림이다
우리는 8→2로 되짚어 재생한다. 지속시간은 332 vs 498ms로 방향은 맞지만
(1:1.5), **그리는 형태 자체가 대칭**이라 감기·뜨기가 구별되지 않는다.
진짜 비율은 **1:3**이고, 뜨는 쪽은 별도로 그려야 한다(간격을 다르게).

### ③ 최하점에 666ms 머문다 — 이게 제일 크다
깜빡임은 감은 순간 바로 뜬다. 우리는 "감은 눈 + 벌린 입 + 진한 볼"에 2/3초를
머문다. 그래서 **깜빡임이 아니라 "웃으며 눈을 감는 표정"으로 읽힌다.**
검수 의견의 "다른 느낌"은 정확히 이 지점이다.

## 5. 그래서 어떻게 할 것인가

**blink1은 이대로 v0로 둔다.** 목표가 "부드러운 이모티콘"이었고 그건 달성됐다.
이건 깜빡임이 아니라 **표정 변화 컷**이고, 스티커로서는 그 편이 오래 보이는
장점이 있다(2초 내내 뭔가 일어난다).

**진짜 깜빡임이 필요하면 별도 컷이다.** 12fps·2초 기준 설계:

```
뜬 눈        홀드 12프레임 (1000ms)   ← 대부분이 홀드
감기          1프레임  (83ms)
완전히 감김    1프레임  (83ms)
뜨기          3프레임  (250ms)         ← 중간 단계를 따로 그린다
뜬 눈        홀드 7프레임  (583ms)
```

- **유니크 6장**(뜸·감기중간·감김·뜨기1·뜨기2·뜨기3) — 지금과 비슷한 예산.
- **핑퐁을 쓰지 않는다.** 감기와 뜨기의 그림이 달라야 비대칭이 산다.
- 위 눈꺼풀이 주로 움직인다는 관례는 우리 캐릭터에는 약하게 적용된다 —
  눈이 단색 원이라 눈꺼풀 도형을 그리면 오히려 망가진다(`doc/prompting.md` §10 §0-①).
  대신 **눈 높이를 줄이는 것**으로 표현한다.

## 참고 자료

생리: [How Fast Can You Blink Your Eye? — Biology Insights](https://biologyinsights.com/how-fast-can-you-blink-your-eye/) ·
[How Long Is the Average Blink? — Biology Insights](https://biologyinsights.com/how-long-is-the-average-blink/) ·
[How Fast Is a Blink? — ScienceInsights](https://scienceinsights.org/how-fast-is-a-blink-the-science-behind-the-speed/)

작화: [Tutorial: How to Animate Blinks and Eye Movements — Animation Mentor](https://www.animationmentor.com/blog/tutorial-animate-blinks-eye-movement/) ·
[Modeling and Animating Eye Blinks — Disney Research (PDF)](https://la.disneyresearch.com/wp-content/uploads/Modeling-and-Animating-Eye-Blinks-Paper.pdf) ·
[Mastering the Blink — Dark Skies](https://darkskiesfilm.com/how-to-make-blinking-animation/)

규격: [Animated Sticker Creation Guidelines — LINE Creators Market](https://creator.line.me/en/guideline/animationsticker/detail/)

*(리서치 제약: animationmentor·darkskies·Disney Research PDF는 프록시에서
403이라 검색 스니펫 기반이다. §3의 타이밍 수치는 인용이 아니라 우리
`cut.json`의 timeline에서 직접 계산한 값이다.)*
