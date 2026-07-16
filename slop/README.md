# slop — 짧은 게임 실험장

<https://slop.bubblelab.dev>에서 서비스하는 작은 게임과 토이입니다. 사이트 루트의
카드 목록은 빌드 시 자동 생성되며, 주간 기록·개인 최고 기록·명예의 전당을 함께
표시합니다.

## 현재 토이

| 경로 | 내용 | 주간 기록 |
| --- | --- | --- |
| `10sec/` | 정확히 10초 맞추기 | 오차 최소 |
| `2048/` | 2048 퍼즐 | 점수 최대 |
| `beer/` | 500cc 맥주 따르기 | 오차 최소 |
| `bubble-pop/` | 20초 버블팝 | 개수 최대 |
| `circle/` | 완벽한 원 그리기 | 정확도 최대 |
| `clicker/` | 10초 광클 | 클릭 수 최대 |
| `flags/` | 국기 맞추기 | 연속 정답 최대 |
| `fruitmerge/` | 과일 합치기 물리 퍼즐 | 점수 최대 |
| `lotto/` | 로또 번호 추첨기 | 없음 |
| `reactiontime/` | 반응속도 테스트 | 시간 최소 |
| `touch25/` | 1부터 25까지 순서대로 터치 | 시간 최소 |
| `trader/` | 20초 모의 트레이딩 | 수익률 최대 |
| `yacht-bot/` | 야추 봇 대전 | 총점 최대 |
| `hall-of-fame/` | 전체 게임 올타임 기록 | 조회 화면 |

`fruitmerge`는 위험선을 넘은 과일이 3초 동안 남아 있으면 종료되고, 종료 화면에서
현재 점수와 최고 점수를 보여줍니다. 위험 상태가 해소되면 카운트는 초기화됩니다.

## 새 토이 만들기

```bash
mkdir slop/my-idea
$EDITOR slop/my-idea/index.html
```

권장 관례:

- 문서의 첫 이모지는 자동 생성 카드의 아이콘으로 사용됩니다.
- `</body>` 앞에 `<script defer src="/_shared/share.js"></script>`를 넣으면
  공유 버튼이 생깁니다.
- 기록형 게임은 `window.blWeekly`을 정의하고 `/_shared/records.js`를 불러온 뒤
  결과가 확정될 때 `window.blWeeklyReport(score)`를 호출합니다. 서버 허용 범위는
  `_infra/records.js`의 `GAMES`에도 등록해야 합니다.
- `:root { color-scheme: light dark; }`와 `light-dark()`를 사용하면 가벼운
  다크 모드를 적용할 수 있습니다.

공유 문구 예시:

```js
window.blShareText = () => `내 기록은 ${best}점! 도전해보세요`;
```

완성도가 올라간 게임은 `git mv slop/<name> games/<name>`으로 승격합니다.
