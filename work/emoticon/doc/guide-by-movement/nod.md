# nod-anatomy — 끄덕임의 해부와 작화 기하

끄덕임(nod)을 여섯 번 실패하고(nod2~nod7) 쓴 문서다. 실패의 공통점이 하나였다:
**나는 실루엣을 움직이라고 썼고, 모델은 그걸 지웠다.** 왜 그런지와 대신 무엇을
써야 하는지를 해부·기하·작화 관례 세 층으로 정리한다.

머리 회전 전반(갸우뚱·도리도리)에 그대로 적용된다.

## 1. 해부 — 어디를 축으로 도는가

고개를 끄덕이는 굴곡·신전은 **환추후두관절(atlanto-occipital joint)** 에서
일어난다. 두개골 바닥의 후두골과 첫 번째 경추(환추)가 만나는 지점,
**머리 안쪽·뒤쪽 아래**다. 목 앞이 아니다.

- 이 관절 단독 가동범위는 **굴곡·신전 합쳐 약 25°**. 그 이상은 아래 경추가
  같이 접힌다(목 전체 굴곡은 흔히 45~50°로 인용된다).
- 회전은 전후 평면에서 **가로축(transverse axis) 둘레**로 일어난다 — 정면
  뷰에서는 **깊이 방향 회전**이라 좌우 성분이 없다. 갸우뚱(좌우 기울기)과
  기하가 완전히 다르다. **nod7이 갸우뚱으로 나온 건 이 축이 무너진 것이다.**
- 대화용 끄덕임은 10~15°, 만화적 과장은 25~40° 정도를 쓴다.

치비 캐릭터는 목이 없으므로 실용 피벗은 **머리·몸 경계**다.

## 2. 기하 — 어느 부위가 얼마나 내려가는가 (우리 토끼 실측)

레퍼런스(`_src/emoticon/rabbit/cuts/nod/frames-raw/key-1.png`)에서 머리 원을
피팅했다: **중심 (505, 519), 반지름 R = 206px**, 머리·몸 경계(피벗) y = 615,
머리 지름이 캐릭터 전체 높이의 **65%**.

얼굴 부위는 **머리 구(球)의 표면**에 있다. 표면 위 점의 고도각을 α라 하면
정면 투영 y = C_y − R·sin α 이고, θ만큼 숙이면 **R[sin α − sin(α−θ)]** 만큼
내려간다. 여기에 목 피벗 회전에 따른 머리 중심의 하강이 더해진다.

| 숙임 θ | 눈 | 입 | 귀뿌리 | 정수리 | 눈 대비 귀뿌리 / 정수리 |
|---|---|---|---|---|---|
| 15° | 57px (0.28R) | 56px | 40px (0.19R) | 16px (0.08R) | 0.69 / 0.27 |
| **20°** | **77px (0.38R)** | 75px | 56px (0.27R) | 25px (0.12R) | 0.73 / 0.32 |
| 30° | 119px (0.58R) | 113px | 94px (0.46R) | 50px (0.24R) | 0.79 / 0.42 |
| 40° | 161px (0.78R) | 150px | 138px (0.67R) | 83px (0.41R) | 0.85 / 0.52 |

**순서가 핵심이다: 얼굴 > 귀뿌리 > 정수리.** 피벗에서 멀고 정면을 향한 점일수록
많이 내려가고, 회전축 위에 가까운 정수리는 거의 안 움직인다. 그리고 모든 점이
**직선이 아니라 호(arc)** 를 그린다.

## 3. 물리와 작화 관례가 갈리는 지점

위 표는 강체 구를 그대로 돌린 값이다. 이대로면 귀뿌리가 얼굴의 0.7~0.85배나
내려간다 — 실루엣이 통째로 출렁인다.

**치비·이모티콘 작화는 그렇게 그리지 않는다.** 머리 실루엣(동그라미)은
캐릭터의 정체성 그 자체라 **각도가 바뀌어도 같은 원으로 유지하고, 각도는
얼굴 부위의 위치·곡률로만 표현한다.** 그래서 실제로 보면 귀-얼굴 경계는 호를
그리며 조금만 내려갔다 올라오고, 눈코입은 많이 내려갔다 올라온다.

두 관점은 **상대 순서(얼굴 > 귀뿌리 > 정수리)와 호 궤적에서 일치**하고,
**실루엣이 얼마나 움직이는가에서만 갈린다.** 우리는 작화 관례를 택한다 —
그게 귀엽고, 마침 우리 품질 게이트의 `scaleDrift`도 그때 낮게 나온다.

작화 관례로 번역한 끄덕임 최하점(θ≈20~25° 상당):

- **눈·코·입이 머리 반지름의 0.35~0.4배(≈ 머리 지름의 1/5)만큼 아래로 내려간다.**
- **이마가 넓어진다** — 귀뿌리와 눈 사이 여백이 약 1.5~2배. 정수리 쪽이
  텅 빈 돔으로 읽히는 게 "숙였다"의 가장 강한 신호다.
- **입은 머리 아래 경계에 가까워지고**, 눈-입 간격은 cos θ만큼(20°에서 0.94배)
  살짝 좁아진다. 과장할수록(35°→0.82배) 눌린 느낌이 난다.
- **부위 배열이 아래로 볼록한 호를 그린다** — 수평 일직선이면 각도가 안 읽힌다.
- **귀뿌리는 얼굴의 1/4~1/3만 내려가고**, 귀는 뒤로 몇 도 눕는다.
- **머리 실루엣·몸·발은 제자리.**

## 4. 오버래핑 액션 — 귀는 늦게 따라온다

12원칙의 follow through / overlapping action은 "긴 귀 같은 부속은 몸이 멈춘
뒤에도 계속 움직인다"를 대표 예로 든다. 끄덕임에서는:

- 머리가 내려갈 때 귀는 **한 프레임 늦게** 따라 내려가고, 머리가 멈춘 뒤에
  **한 프레임 더** 흔들린다.
- 실무 번역: 브레이크다운(중간 프레임)에서 **머리는 이미 절반 내려갔는데
  귀는 아직 위쪽에 남아 뒤로 눕는다**. 이 한 장이 끄덕임을 "살아 있게" 만든다.
- 우리 파이프라인에서는 브레이크다운 포즈를 **머리 50% / 귀 25%** 로 따로
  적어주면 된다. 키만으로는 절대 안 나온다.

## 5. 프롬프트 규약으로 — 이동이 아니라 배치로 쓴다

여섯 번의 실패가 가리키는 결론이다. Gemini 이미지 편집은 **매 호출 피사체를
캔버스에 다시 배치·정규화**한다. 그래서 이런 지시는 전부 지워졌다:

| 실패한 표현 | 실측 결과 |
|---|---|
| `the head sinks downward` (nod3·nod4) | 움직임 자체가 죽음 (12.4% → 8.6%) |
| `both ears swing forward over the forehead` (nod5) | 선 귀가 처진 귀로 **교체** |
| `the tips of the ears are 0.85 times as high above the feet as before` (nod7) | 실측 1.006배 — **완전 무시** |

전부 **캐릭터 전체의 위치·크기**를 말하는 문장이고, 리컴포지션이 그걸 되돌린다.

**대신 "이 그림에서 부위가 어디에 그려져 있는가"를 쓴다.** 그건 리컴포지션과
싸우지 않는, 프레임 안의 레이아웃 서술이다.

```
✅ the eyes and mouth are drawn low on the head circle, about one third of the
   head's radius lower than in Image 1, so the forehead above the eyes is about
   twice as tall and the crown reads as a wide empty dome
✅ the eyes, nose and mouth line up along a downward-bowing arc
✅ the ear bases sit near the top of the head circle and drop about one quarter
   as far as the eyes; the ears lean back about 10 degrees
✅ the head outline, the body and the feet are drawn at the same place and the
   same size as Image 1

❌ the head sinks / the character is shorter / the ears are lower above the feet
```

브레이크다운(오버래핑 액션)은 두 값을 다르게 준다:

```
머리·얼굴: 두 키의 정확한 중간
귀:        키1 쪽에 가깝게 (25% 지점) + 뒤로 눕기
```

## 6. 검증 방법

`scaleDrift`(bbox 세로)는 이 방식에서 **낮게 나오는 게 정상**이다 — 실루엣을
일부러 고정하니까. 끄덕임이 됐는지는 픽셀 지표가 아니라 **눈-정수리 거리 비율**로
봐야 한다:

```
숙임 정도 ≈ (눈 중심 y − 머리 위 끝 y) / 머리 지름
```

레퍼런스에서 (484 − 314) / 412 = **0.41**. 최하점 프레임에서 이 값이
**0.55~0.60**이면 20~25° 숙임이 그려진 것이다. 변화가 0.05 미만이면 끄덕임이
아니다. *(자동 측정은 미구현 — 눈 검출이 필요하다. 현재는 육안 판정.)*

## 참고 자료

해부: [Atlanto-occipital joint — Kenhub](https://www.kenhub.com/en/library/anatomy/atlanto-occipital-joint) ·
[Atlanto-occipital joint — Wikipedia](https://en.wikipedia.org/wiki/Atlanto-occipital_joint) ·
[A nod of the head to the atlanto occipital joint — Daniel Baines Osteopathy](https://www.danielbaines.co.uk/occipito-atlanto-joint/)

작화: [Follow through and overlapping action — Wikipedia](https://en.wikipedia.org/wiki/Follow_through_and_overlapping_action)
(긴 귀를 대표 예로 든다) ·
[Animation for Beginners: How to Animate a Head Turn — Envato Tuts+](https://design.tutsplus.com/tutorials/animation-for-beginners-how-to-animate-a-head-turn--cms-26487) ·
[Principles of Animation: Anticipation and Pose-to-Pose — Creativity School](https://creativityschool.com/principles-of-animation-anticipation-and-pose-to-pose/)

*(리서치 제약: 위키피디아·kenhub·tutsplus 원문은 프록시에서 403이라 검색
스니펫 기반이다. §2의 수치와 §6의 지표는 인용이 아니라 **우리 레퍼런스
이미지에서 직접 측정·계산한 값**이며, 계산식은 위에 그대로 적어 두었다.)*
