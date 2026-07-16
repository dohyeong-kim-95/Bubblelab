# _shared — 브라우저 공용 모듈

모든 서브도메인에서 사이트 접두사 없이 `/_shared/<file>`로 접근합니다.

| 파일 | 기능 |
| --- | --- |
| `realtime-client.js` | `/_rt/<namespace>` WebSocket 연결, JSON 경로 CRUD·구독·재접속 |
| `multiplayer-room.js` | 방 생성·입장·퇴장·강퇴·방장 승계·온라인 상태 |
| `records.js` | 주간 기록 배지, 닉네임 등록, 개인 최고 기록, 주간 리셋·공지 UI |
| `share.js` | Web Share API 또는 클립보드 기반 공유 버튼과 공유 이미지 지원 |
| `suggest.js` | 자동 생성 카테고리 홈의 토이 아이디어 우편함 |
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

`realtime-client.js`는 경로 기반 `get`, `set`, `update`, `remove`, 실시간 구독과
연결 종료 작업을 제공합니다. `multiplayer-room.js`는 그 위에 영문 6자리 방 코드,
닉네임 중복 검사, 최대 인원, 강제 퇴장, 방장 승계와 오래된 데이터 정리를 더합니다.
각 게임은 고유 namespace와 `rooms`, `privateData`, `actions` 하위 구조를 사용합니다.
