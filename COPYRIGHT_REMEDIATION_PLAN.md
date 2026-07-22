# 저작권 문제 해결 계획 (Copyright Remediation Plan)

> 1차 코드 점검 기반 실행 계획. README + 게임 엔트리 파일 검증 결과이며,
> 이미지·음악·폰트·외부 코드 전체를 포함한 완전한 법률 감사는 아니다.
> 배포물을 당장 전부 내릴 필요는 없다 — 아래 우선순위대로 처리한다.

## 검증 결과 요약 (코드 실측)

| 항목 | 위험도 | 코드 실측 근거 | 상태 |
|---|---|---|---|
| `slop/2048` | **중간~높음** | 타일 팔레트 `#eee4da`·`#ede0c8`·`#f2b179`…`#edc22e`·`#3c3a32` 원작값 그대로. 제목/공유문구/기록키/`records.js` 키 모두 `2048` | 최우선 |
| `slop/fruitmerge` | 중간 | 과일 진화 순서 🫐→🍒→🍓→🍊→🍎→🍐→🍑→🍍→🍈→🍉 (10단계·수박 엔딩), 수박게임 구조와 근접 | 2순위 |
| `slop/yacht-bot` | 낮음~중간 | "야추"(Yahtzee 연상) 명칭·카테고리, 주석 "아소비대전51 버전" | 3순위 |
| 저장소 라이선스 | 낮음 | 루트 `LICENSE` 없음. README에 "무단 사용 불허" 1줄. `THIRD_PARTY_NOTICES.md`엔 manseryeok·jpeg-js만, 2048 미등재 | 정리 필요 |
| 나머지 slop 게임 | 낮음 | 보편 규칙 중심 | 조치 불필요 |

---

## 1순위 — slop/2048 색상 팔레트 즉시 교체 (가장 시급)

원작의 **대표 색상값이 픽셀 단위로 동일**한 것이 명칭보다 더 두드러지는 문제.
아래 두 안 중 택1. **A안(리디자인) 권장.**

### A안 — 독자 게임으로 리디자인 (권장)
- 이름 변경: `Number Bloom` / `Merge Grid` / `Power Merge` 중 택1
  - `slop/2048/index.html` 내 `<title>`, `<h1>`, `blShareText`, `blWeekly.game`
  - `records.js` 24행 게임키 `"2048"` → 신규 키 (기존 기록 마이그레이션 여부 결정 필요)
  - 폴더명 변경 시 URL/README/랜딩 카드 동시 갱신 (폴더 rename은 서브경로 변경이므로 신중히)
- 타일 색상 `.v2`~`.v2048`, `.vbig` 을 **Bubblelab 고유 팔레트**로 전면 교체
  (`light-dark()` 다크모드 대응 유지)
- 4×4 숫자 병합 규칙은 유지, 종료/승리 UI·애니메이션 차별화
- 설명은 "숫자 병합 퍼즐"로만 표기

### B안 — 2048 포크 인정 + MIT 고지
- 팔레트는 그대로 두되(원작이 MIT라 활용 자체는 가능), 아래 고지를 **반드시** 병기
  - 페이지 하단 + `THIRD_PARTY_NOTICES.md`에 항목 추가:
    ```
    ## 2048
    Inspired by 2048 by Gabriele Cirulli — https://github.com/gabrielecirulli/2048
    Licensed under the MIT License. (MIT 라이선스 전문 보존)
    ```
- 단, 원작 코드를 직접 복사한 부분이 있으면 MIT 전문 + 저작권 고지 원문 보존 의무.
  현재 코드는 재작성 형태로 보이나 **색상값은 즉시 바꾸는 것이 가장 안전** → A안 우세.

> 판단: 팔레트가 원작값 그대로라 공개 규모가 커지기 전 **가장 먼저** 수정.

---

## 2순위 — slop/fruitmerge 차별화

규칙 자체는 저작권 보호가 제한적이나, 과일 배열·크기 관계·화면 구성·전체
시각적 인상이 원작에 가까울수록 분쟁 가능성 증가. 현재는 에셋 복제가 아닌
시스템 이모지+자체 캔버스 렌더라 직접 복제 위험은 낮음. 아래 중 **하나 이상** 적용:

- **테마 교체(권장):** 과일 → 버블/행성/광물/디저트/감정 아이콘
  - 방향: `Bubble Bloom` — 같은 색 버블이 합쳐져 커지고, 일정 크기에서 터져 주변을 밀어냄
- 과일 유지 시 **최종 단계를 수박이 아닌 다른 대상**으로 변경 + 진화 순서 독자 변경
  - 대상 코드: `index.html` 12행의 `F=[...]` 배열 (이모지·이름·색·반지름·점수)
- 원형이 아닌 찌그러지는 버블/다각형 객체
- 특수 객체 추가(터지는 버블·얼음 과일·3개 병합)
- 게임명 `Fruit Merge`보다 고유하게 변경 (`<title>`, `<h1>`, `blShareText`, `blWeekly.game`, `records.js` 키)

---

## 3순위 — slop/yacht-bot 명칭 확인 (경량)

- Yahtzee는 상표명 사용 사례 존재. 규칙 자체보다 **원작 점수표 명칭/로고/상표명**을
  그대로 쓰는지가 핵심.
- 권장: 경로 `yacht-bot` 유지, 한국어 표기를 "야추" 대신
  **"Yacht Dice / 주사위 족보 게임 / Dice Poker / Five Dice"** 계열로 정리.
  - 대상: `<title>`, `<footer>`, 카테고리 라벨 `yacht:'야추'`, 봇 코멘트 문자열.
  - 주석 "아소비대전51 버전" 문구 제거/일반화.

---

## 4순위 — 향후 Sandtrix/Tetris 계열 (예방)

현재 목록엔 없음. 만들 경우 다음 회피:
- 이름에 `Tetris`/`-tris`/`Tetrimino` 금지
- 10×20 플레이필드·7 테트로미노·원작 색배치·고스트/넥스트/홀드 UI·테마곡 회피
- 블록 대신 불규칙 물질, 선 삭제 대신 영역 연결/색 반응, Bubblelab 고유 이름·시각

> 근거: The Tetris Company의 명칭·로고·테마곡·Tetrimino·trade dress 권리 주장,
> Tetris Holding v. Xio 판결(규칙 복사 주장에도 구체적 표현·시각 구성 침해 인정).

---

## 5순위 — 저장소 라이선스 표기 정리

현재 루트 `LICENSE` 부재 + README "무단 사용 불허" 1줄 → 사실상 all rights
reserved로 해석되나, 외부 OSS/퍼블릭 에셋 혼입 시 출처 추적 곤란.

- **루트 `LICENSE` 신설:**
  ```
  Copyright © 2026 Bubblelab. All rights reserved.
  Unless otherwise stated, the source code and assets in this repository
  may not be copied, modified, or redistributed without permission.
  ```
- **`THIRD_PARTY_NOTICES.md` 보강:** 2048(B안 채택 시)·폰트·아이콘·음악 등 외부 출처 추가.
  (현재 manseryeok·jpeg-js만 등재)
- README 문구를 "복제·재배포·상업적 이용 금지"처럼 **범위 명확화**
  (브라우저의 HTML/JS 다운로드 실행까지 금지하는 모호한 해석 방지).

---

## 실행 순서 (권장)

1. **2048 색상 팔레트 즉시 변경** (A안 리디자인 우세, 최소한 팔레트만이라도 즉시)
2. 2048 유지 선택 시 MIT 출처 고지 추가 (B안)
3. Fruit Merge 고유 테마 차별화
4. Sandtrix/Tetris 계열: 미추가 또는 핵심 구조까지 충분히 변형
5. 루트 `LICENSE` + `THIRD_PARTY_NOTICES.md` 정리

## 결정 필요 사항 (사용자 확인 요청)

- **2048**: A안(리디자인) vs B안(포크 인정+고지) — 어느 쪽으로?
- 리디자인 시 **폴더/URL(`slop/2048`) 및 `records.js` 기존 기록 키** 유지 vs 신규(기록 초기화)?
- **fruitmerge**: 테마 전면 교체(Bubble Bloom) vs 최소 변경(엔딩·순서만)?
- 위 확정되면 실제 코드 수정·빌드 검증(`node _infra/build.mjs`)·커밋까지 진행.
