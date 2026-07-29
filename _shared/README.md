# _shared — 브라우저 공용 모듈

이 폴더의 JavaScript는 여러 공개 서브도메인에 동시에 영향을 주므로 개별 토이보다
높은 검토 수준을 적용합니다.

모든 서브도메인에서 사이트 접두사 없이 `/_shared/<file>`로 접근합니다.

| 파일 | 기능 |
| --- | --- |
| `realtime-client.js` | `/_rt/<namespace>` WebSocket 연결, JSON 경로 CRUD·구독·재접속 |
| `multiplayer-room.js` | 방 생성·입장·퇴장·강퇴·방장 승계·온라인 상태 |
| `records.js` | 주간 기록 배지, 닉네임 등록, 개인 최고 기록, 주간 리셋·공지 UI |
| `share.js` | Web Share API 또는 클립보드 기반 공유 버튼과 공유 이미지 지원 |
| `suggest.js` | 자동 생성 카테고리 홈의 토이 아이디어 우편함 |
| `home.js` | 카드 페이지의 "← 홈" 버튼 (빌드가 자동 주입) |
| `engagement.js` | 유효 방문 비콘과 표시 시간 누적 (빌드가 자동 주입) |
| `TwemojiCountryFlags.woff2` | 국기 게임용 Twemoji Country Flags 폰트 |

## 공유 버튼

```html
<script defer src="/_shared/share.js"></script>
```

```js
window.blShareText = () => `내 최고 기록은 ${best}점!`;
```

`window.blShareText`는 함수 또는 문자열을 받을 수 있습니다. 모바일에서는 OS 공유
시트를 열고, 지원하지 않는 환경에서는 `문구\nURL`을 클립보드에 복사합니다.

## 홈 버튼

`home.js`와 `engagement.js`는 **토이가 직접 챙기지 않습니다.** `_infra/build.mjs`의
`injectShared`가 `</body>` 앞에 자동으로 넣습니다.

- 홈 버튼은 **자동 생성 홈을 가진 카테고리**(slop·util·games·assets)의 **카드
  페이지에만** 붙습니다. 카테고리 홈 자신과 `podcast`·`duri` 같은 자체 index.html을
  가진 서비스에는 붙지 않습니다.
- 자리는 **좌하단**입니다. 상단은 거의 모든 토이가 점수·타이머 HUD로 쓰고 있어
  (실측: 상단 배치는 21개 중 7~9개에서 UI를 가렸고, 하단은 3개) 공용 버튼이 이미
  모여 있는 아래쪽을 씁니다. 주간 기록 배지가 있으면 `body:has(#bl-weekly)`로 그
  위에 쌓입니다 — `suggest.js`가 공유 버튼을 피하는 방식과 같습니다.
- **새 공용 고정 UI를 추가할 때는 네 모서리의 기존 점유를 먼저 확인하세요.**
  좌하단 `#bl-weekly`·`#bl-home`, 우하단 `#bl-share`, 그 위 `#bl-suggest`,
  좌하단 위쪽 `#bl-claim`이 이미 자리를 씁니다.

## 기록 보드

```html
<script>
window.blWeekly = {
  game: "my-game",
  dir: "max",
  fmt: (score) => `${score}점`,
};
</script>
<script defer src="/_shared/records.js"></script>
```

결과 확정 시 `window.blWeeklyReport(score)`를 호출합니다. 클라이언트의 `dir`은 UI
판정용일 뿐이며, 서버는 `_infra/records.js`의 `GAMES` 설정으로 방향과 허용 범위를
다시 검증합니다.

## 멀티플레이

현재 `ENABLE_REALTIME=false`이므로 `realtime-client.js`와
`multiplayer-room.js`를 사용하는 공개 게임은 카드 목록에서 숨겨져 있고 서버 연결은
503으로 거절됩니다.

`realtime-client.js`는 경로 기반 `get`, `set`, `update`, `remove`, 실시간 구독과
연결 종료 작업을 제공합니다. `multiplayer-room.js`는 그 위에 영문 6자리 방 코드,
닉네임 중복 검사, 최대 인원, 강제 퇴장, 방장 승계와 오래된 데이터 정리를 더합니다.
각 게임은 고유 namespace와 `rooms`, `privateData`, `actions` 하위 구조를 사용합니다.

메시지 크기·경로·Origin·namespace 제한은 방어선일 뿐 사용자 권한을 대신하지
않습니다. 다시 공개할 때는 방 참가자별 세션과 `rooms/<code>`·
`privateData/<code>` 읽기/쓰기 ACL을 서버에서 강제해야 합니다.

## 공용 모듈 보안 규칙

- 사용자·서버 문자열은 `textContent`, DOM 속성 또는 검증된 URL로만 표시합니다.
- 공개 쓰기는 상대 경로의 JSON 요청을 사용하며 Worker의 동일 출처·본문 크기·
  rate-limit 검사를 우회하는 별도 엔드포인트를 만들지 않습니다.
- 비밀키, 관리자 정보, 민감한 자유 입력을 `localStorage`나 공유 모듈 전역 상태에
  넣지 않습니다.
- 변경 후 최소한 인프라 테스트와 관련 카테고리의 모바일 흐름을 확인합니다.
