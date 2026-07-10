# games — 살아남은 것들

slop에서 검증되고 승격된 게임들. 승격은 `git mv slop/x games/x` 한 줄.

홈(games.bubblelab.dev) 카드 그리드는 slop과 동일하게 자동 생성된다
(관례도 동일 — slop/README.md 참고).

## avalon — 특별 케이스

`games/avalon/`은 손으로 짠 게 아니라 **빌드 산출물**이다.

- 소스: `_src/avalon/` (Vite 프로젝트, 원래 별도 리포였던 것을 이관)
- 수정하려면: `_src/avalon/`에서 소스 고치고 → `_src/avalon/rebuild.sh`
  실행 → 갱신된 `games/avalon/` 커밋
- 멀티플레이어 동기화는 자체 실시간 서버(`/_rt/avalon`) 사용 — 외부 서비스
  의존성 없음. 자세한 건 `_src/avalon/MIGRATION.md`

`games/avalon/` 안의 파일을 직접 고치지 말 것 — 다음 rebuild 때 덮어써진다.
