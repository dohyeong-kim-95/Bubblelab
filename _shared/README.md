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
| `tts.js` | 브라우저 내장 음성으로 텍스트 읽어주기 — 🔊 독 버튼과 `blTTS` API |
| `fortune-common.js` | fortune·brief 공용 운세 상수 — 한 줄 문구, 12지시, 명식 요청 본문 |
| `suggest.js` | 자동 생성 카테고리 홈의 토이 아이디어 우편함 |
| `dock.js` | 우하단 유틸 독 — 위로 자라는 세로 알약, 많아지면 접힘 (빌드가 자동 주입) |
| `home.js` | 카드 페이지의 🏠 홈 버튼 (빌드가 자동 주입) |
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

## 읽어주기 (TTS)

```html
<script>
  window.blSpeakText = () => document.getElementById("brief").textContent;
  window.blTTSConfig = { lang: "ko-KR", rate: 1 };   // 전부 선택
</script>
<script defer src="/_shared/tts.js"></script>
```

브라우저 내장 음성(Web Speech API)을 씁니다 — API 키·할당량·서버 부하가 없고
오프라인에서도 동작합니다. 대신 목소리는 기기가 가진 것을 쓰므로 품질이 제각각이고
음성 파일로 저장할 수는 없습니다.

`window.blSpeakText`는 `blShareText`와 같은 규약으로 함수 또는 문자열을 받습니다.
선언돼 있으면 독에 🔊 버튼이 생기고(order 40 — 홈 10 · 공유 20 · **읽어주기 40** ·
토이 50~), 재생 중에는 ⏹로 바뀌어 누르면 멈춥니다. 버튼이 필요 없으면
`blTTSConfig.dock = false`.

프로그램에서 직접 부를 때: `blTTS.speak(text, opts?)`는
`"end" | "stopped" | "error" | "unsupported" | "empty"`로 resolve 하고,
`stop()` · `pause()` · `resume()` · `speaking` · `paused` ·
`on("start" | "chunk" | "end" | "error", cb)`를 함께 제공합니다.

- **목소리가 없는 기기가 있습니다.** 일부 데스크톱 리눅스에는 한국어 음성이 아예
  설치돼 있지 않습니다. 조용히 실패하면 "왜 안 되지?"가 되므로,
  `await blTTS.ready` 뒤 `blTTS.hasVoice("ko")`를 확인해 안내 문구를 띄우세요.
  독 버튼은 읽을 내용이 없거나 기기에 목소리가 하나도 없으면 토스트로 알려줍니다
  (`share.js`와 같은 `#bl-toast`를 재사용합니다).
- **iOS는 첫 재생이 사용자 제스처 안에서 일어나야 합니다.** 클릭 핸들러에서
  `speak()` 앞에 `await`를 두지 마세요(독 버튼은 이미 그렇게 돼 있습니다).
- 크롬의 15초 절단·큐 멎음, 첫 `getVoices()` 빈 배열, 페이지 이탈 후 소리 지속은
  모듈이 처리합니다. 토이가 `speechSynthesis`를 직접 만지지 마세요.

### 네트워크 목소리 주의 (개인정보)

플랫폼에 따라 **일부 목소리는 기기가 아니라 서버에서 합성**됩니다(크롬의 "Google
한국의" 계열). 즉 읽어주는 텍스트가 기기 밖으로 나갈 수 있습니다. 모듈은 조건이
같으면 기기 내장 목소리(`voice.localService`)를 우선 고르고, 지금 고른 목소리가
내장인지 `blTTS.isLocal("ko-KR")`로 노출합니다. **민감한 자유 입력을 읽어주는
토이**(예: `mindfulness/thought-bubble`의 생각 문구)는 이 값이 `false`면 읽기를
거절하거나 최소한 사용자에게 알려야 합니다.

## 운세 공용 상수 (fortune · brief)

```html
<!-- defer가 아니다: 페이지 자기 인라인 스크립트보다 먼저 -->
<script src="/_shared/fortune-common.js"></script>
```

```js
blFortuneLine(blFortuneDaySeed())   // → { emoji, text }  생년월일 없이 쓰는 한 줄
blFortuneBranches                   // 12지시 (저장값 h = 이 배열의 인덱스)
blFortuneChartBody(birth)           // → /_fortune/chart 요청 본문
```

`util/fortune`과 `util/brief`가 같은 문구·같은 시진 목록을 보여주고, 생년월일시를
어느 쪽에서 넣어도 같은 값(`localStorage`의 `bl-fortune-birth`)을 쓰므로 여기 한 번만
둡니다. 한 줄 문구는 씨앗으로 고르기 때문에 하루 동안 유지되고, 씨앗에 생년월일을
섞으면 사람마다 다른 문구가 나옵니다(`fortune`이 그렇게 씁니다).

**`blFortuneChartBody`를 거치세요.** 요청 본문을 페이지마다 손으로 만들면 어긋납니다 —
실제로 brief가 `timeMode: "unknown"`을 보내 서버가 400으로 거절했고, 총평이 조용히
일반 문구로 남았습니다.

**이 파일만 `defer`를 쓰지 않습니다.** 두 페이지 모두 인라인 스크립트에서 첫 화면을
즉시 그리는데, `defer`면 그 시점에 `window.blFortuneLine`이 아직 없습니다.

## 우하단 유틸 독

홈·공유처럼 토이 바깥에서 붙는 버튼은 **각자 `position: fixed`로 자리를 잡지
않습니다.** 그러면 서로 덮습니다 — 실제로 우드 스택의 음소거 버튼이 공유 버튼에
완전히 가려 눌리지 않았습니다. 배치는 `dock.js`가 전담합니다.

```js
(window.blDock = window.blDock || []).push({
  id: "bl-mute", icon: "🔊", label: "소리 켜기/끄기", order: 50,
  onClick: (el) => { el.textContent = "🔇"; /* … */ },
});
```

- **로드 순서를 신경 쓸 필요가 없습니다.** 독보다 먼저 실행돼도 큐에 쌓였다가 함께
  그려집니다. 등록이 하나도 없으면 독은 아예 나타나지 않습니다 — 카테고리 홈이
  그렇습니다(홈 버튼도 공유 버튼도 없음).
- **아래를 축으로 위로 자랍니다.** 폭이 48px로 고정이라 좌하단 주간 기록 배지 쪽으로
  번지지 않습니다. 가로로 늘리면 배지와 부딪힙니다.
- 필드: `id`·`icon`(필수), `label`(툴팁/스크린리더), `order`(작을수록 아래쪽 =
  엄지에 가까움 — 홈 10 · 공유 20 · 토이 50~), `href`(링크) 또는
  `onClick(el)`(버튼), `ready(el)`(생성 직후 콜백).
- 버튼이 **3개를 넘으면** 접기 토글이 생겨 원형(⋯)으로 접히고, 누르면 위로
  펼쳐집니다. 접힌 상태는 `localStorage`에 남습니다.
- 독이 탭 전파 차단(`stopPropagation`)을 대신하므로, 화면 전체를 탭 영역으로 쓰는
  토이에서도 버튼이 게임 입력을 건드리지 않습니다.

### 자리 선정 근거 (실측)

- **상단은 쓰지 마세요.** 거의 모든 토이가 점수·타이머 HUD로 씁니다 — 상단 배치는
  21개 중 7~9개에서 UI를 가렸고, 하단은 3개였습니다.
- **좌하단·하단 중앙도 쓰지 마세요.** 주간 기록 배지(`#bl-weekly`)는 폭과 높이가
  모두 가변입니다. 1~3위가 다 차면 390px 화면에서 높이 169px까지 자라고, 하단
  중앙 배치는 21개 중 13개 토이에서 겹쳤습니다. **위로 쌓아도 안전하지 않습니다.**
- 알려진 한계: 배지가 완전히 펼쳐지면 390px 이하에서 독 영역까지 넘어옵니다.
  독이 생기기 전에도 배지는 `#bl-share`를 침범했으므로 새 문제는 아니지만, 근본
  해결은 `#bl-weekly`의 `max-width`를 조이는 쪽입니다.
- 현재 화면 모서리 점유: 좌하단 `#bl-weekly`(가변)와 그 위 `#bl-claim`,
  우하단 `#bl-dock`, 그 위 `#bl-suggest`(카테고리 홈 전용).

## 홈 버튼

`dock.js`·`home.js`·`engagement.js`는 **토이가 직접 챙기지 않습니다.**
`_infra/build.mjs`의 `injectShared`가 `</body>` 앞에 자동으로 넣습니다.

홈 버튼은 **자동 생성 홈을 가진 카테고리**(slop·util·games·assets)의 **카드
페이지에만** 붙습니다. 카테고리 홈 자신과 `podcast`·`duri`처럼 자체 index.html을
가진 서비스에는 붙지 않습니다.

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
