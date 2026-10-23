# 마이그레이션 노트

- 원본: github.com/dohyeong-kim-95/ResistanceAvalon (2026-07-10 이전, 리포 삭제 예정)
- 서비스 주소: https://games.bubblelab.dev/avalon (구 GitHub Pages 배포는 리포 삭제와 함께 종료)
- `games/avalon/` = 빌드 산출물 (커밋됨), 여기 `_src/avalon/` = 전체 소스
- 소스 수정 후에는 `./rebuild.sh` 실행하고 `games/avalon`을 커밋할 것

## 백엔드 (2026-07-10 Firebase 제거)

- 원래 Firebase Realtime Database + 익명 인증이었으나, bubblelab 워커의
  Durable Object 실시간 서버(`_infra/realtime.js`, 접속 경로 `/_rt/avalon`)로 교체됨.
- `src/firebase.js`가 기존 Firebase API(ref/get/set/update/onValue/
  onDisconnect/...)를 동일 인터페이스로 구현한 어댑터라서, 게임 로직 파일은
  Firebase 시절 그대로다.
- 외부 서비스/키/콘솔 설정 전혀 필요 없음. 플레이어 ID는 localStorage 기반.
- 로컬 개발: 리포 루트에서 `node _infra/build.mjs && npx wrangler dev --local
  --local-upstream localhost` 실행 후 `localhost:8787/games/avalon` 접속.
  (vite dev 서버로 띄우려면 `VITE_RT_HOST=games.bubblelab.dev`로 프로덕션
  실시간 서버에 붙일 수 있음)

## 알려진 한계: 역할(privateData)을 아무나 읽을 수 있다

- 역할은 `privateData/<방>/<플레이어>`에 저장된다. Firebase 시절에는 보안 규칙이
  "자기 것만 읽기"를 막아 줬지만, `/_rt/avalon` 실시간 서버(`_infra/realtime.js`)에는
  **경로별 접근 제어가 없다** — `get privateData/<방>`(또는 루트 `""`)이면 모두의
  역할이 보인다. 개발자 도구만 열면 숨은 역할 게임이 무너진다(데이터 유출이 아니라
  게임 무결성 문제). 그래서 `games` 카테고리 목록에서 아발론을 숨겨 두었다
  (`_infra/build.mjs` 의 `UNLISTED_ENTRIES`).
- **클라이언트만 고쳐서는 막을 수 없다.**
  - 경로 키를 플레이어별 비밀값으로 만드는 방법(`privateData/<방>/<id>.<토큰>`)은
    효과가 없다. 서버의 `get` 이 부모 경로의 하위 트리를 통째로 돌려주므로 키 이름도
    함께 보인다.
  - 역할을 각자의 공개키로 암호화해도, 역할을 나눠 주는 방장 브라우저는 모두의 역할을
    안다. 방장이 바뀔 때 새 방장이 `privateData/<방>` 전체를 읽어 복원하는 구조
    (`GameEngine` 의 재개 경로)도 깨진다.
- 근본 대책은 서버 쪽이다: (1) 역할 배정을 서버(DO)가 하고 플레이어별 연결에만
  자기 몫을 보내거나, (2) 실시간 서버에 경로 단위 읽기 제한(예: `privateData/<방>/<id>`
  는 그 id 로 붙은 연결만 읽기, 부모 경로 `get`·구독 금지)을 두는 것. 둘 다
  `_infra/realtime.js` 변경이라 이 폴더만으로는 할 수 없다.
