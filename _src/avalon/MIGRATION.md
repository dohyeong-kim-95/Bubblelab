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
