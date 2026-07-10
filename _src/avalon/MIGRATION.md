# 마이그레이션 노트

- 원본: github.com/dohyeong-kim-95/ResistanceAvalon (2026-07-10 이전, 리포 삭제 예정)
- 서비스 주소: https://games.bubblelab.dev/avalon (구 GitHub Pages 배포는 리포 삭제와 함께 종료)
- `games/avalon/` = 빌드 산출물 (커밋됨), 여기 `_src/avalon/` = 전체 소스
- 소스 수정 후에는 `./rebuild.sh` 실행하고 `games/avalon`을 커밋할 것
- Firebase(Realtime DB + 익명 인증)는 원본 프로젝트 그대로 사용.
  새 도메인에서 인증이 되려면 Firebase Console → Authentication →
  Settings → Authorized domains에 `games.bubblelab.dev` 추가 필요.
