# LINE 이모티콘 가이드

LINE Creators Market 애니메이션 스티커 규격. **AI 산출물의 현실적 1순위
출구다** — 카카오는 AI 입점이 막혀 있다([`kakao-emoticon-guide.md`](kakao-emoticon-guide.md) §1).

> **주의**: 규격은 바뀐다. 등록 직전에
> <https://creator.line.me/en/guideline/animationsticker/detail/>을 직접 열어
> 최종 확인할 것. 이 문서는 2026-07~08 리서치 시점 기준이다.

## 1. 정책 — 허용 + 자동 표기

AI 생성/보조 여부를 등록 시 **신고하면** 구매 화면에 "AI 사용"이 자동
표기된다. 타 저작물·유명 캐릭터 모방은 금지.

## 2. 규격

| 항목 | 값 |
|---|---|
| 형식 | **APNG** (`.png`) |
| 세트 | 8 / 16 / 24종 |
| 크기 | ≤320×270px, **한 변은 ≥270px** |
| 프레임 | **5~20프레임** |
| 재생시간 | 총 **1·2·3·4초 중 하나** (1.5초 같은 소수는 불가) |
| 루프 | 1~4회 |
| 용량 | **≤300KB/개** |
| 부속 | main 240×240 APNG, tab 96×74 PNG |

**용량 300KB가 실질 병목이다.** 우리 현재 산출물은 360²·14프레임에 850KB
수준이라 그대로는 못 낸다. 줄이는 순서:

1. 크기 360² → 270² (`build --line`이 만든다)
2. 프레임 수 축소 (20 → 10~12) — 홀드를 늘리고 유니크를 줄인다
3. 팔레트 감량 (pngquant류) — **미구현**

`line` 프로필이 270²·5~20프레임·≤300KB·루프 1~4회를 강제한다.

## 3. 기간·수익

- 등록 무료, 심사 며칠~1주. **규격 충족이면 대부분 통과** — 카카오와 달리
  세트 구성이 승인을 가르지 않는다.
- 수익 배분은 판매가의 약 35%가 작가 몫(앱마켓 30% 차감 후 5:5 안팎, 비공식).

## 4. 우리 상태

- 8종 세트부터 제안하는 게 진입 비용이 가장 낮다.
- 현재 합격 컷: blink v0, wave2 — **2종.** 8종까지 6개 더 필요하다.
- 제출용 원본은 **public 리포에 두지 않는다**(README 주의 항목).

## 참고 자료

[Animated Sticker Guidelines](https://creator.line.me/en/guideline/animationsticker/detail/) ·
[Creation Guidelines(개요)](https://creator.line.me/en/guideline/animationsticker/) ·
[AI-generated content 정책](https://help.line.me/line/smartphone/sp?contentId=200001248) ·
[Animation Sticker Checker(LINE Engineering)](https://engineering.linecorp.com/en/blog/line-animation-sticker-checker-on-web-browser/)
