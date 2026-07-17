# slop — 짧은 게임 실험장

상태: **Experiment**. 게임 규칙·점수 범위·UI가 예고 없이 바뀔 수 있습니다.

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
- 공개 쓰기 API를 새로 만들지 말고 먼저 `_infra/worker.js`에 동일 출처,
  `application/json`, 본문 크기와 IP별 rate limit을 함께 설계합니다.
- 닉네임 외의 자유 입력은 기본적으로 서버에 보내지 않고, DOM에는 `innerHTML`이
  아니라 `textContent`로 표시합니다.
- `:root { color-scheme: light dark; }`와 `light-dark()`를 사용하면 가벼운
  다크 모드를 적용할 수 있습니다.

공유 문구 예시:

```js
window.blShareText = () => `내 기록은 ${best}점! 도전해보세요`;
```

완성도가 올라간 게임은 `git mv slop/<name> games/<name>`으로 승격합니다.

## 데이터와 기록의 한계

게임별 최고 기록과 일부 설정은 브라우저 `localStorage`에 저장됩니다. 주간·개인·
올타임 보드에 도전할 때 게임 키, 닉네임, 점수와 표시 문구가 서버로 전송됩니다.
서버는 게임별 방향·허용 범위, 입력 형식과 호출 빈도를 검사하지만 플레이 전체를
재현하지 않으므로 경쟁 서비스 수준의 부정행위 방지는 제공하지 않습니다.

자동 생성 카테고리 홈은 익명 브라우저 ID로 최근 방문, 활성 체류, Slop 연속 방문을
집계할 수 있습니다. IP 원문과 User-Agent는 분석 저장소에 보관하지 않습니다.
