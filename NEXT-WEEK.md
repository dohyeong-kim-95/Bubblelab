# next-week — 주간 룰 변경 릴리스 트레인

게임 룰·점수 범위처럼 **주간 보드에 영향을 주는 변경**을 모아뒀다가, 주간
리셋 경계에 맞춰 한 번에 반영하기 위한 스테이징 브랜치.

## 왜 이렇게 하나

주간 신기록 보드는 **월요일 00:00 UTC(= 09:00 KST)** 에 롤오버된다
(`_infra/records.js`의 `weekKey`). 룰을 주중에 바꾸면 진행 중인 기록이
중간에 무효화되거나 기준이 섞인다. 리셋 순간에 맞춰 머지하면 새 룰이 새
보드와 함께 깨끗하게 시작된다.

## 쓰는 법

1. 보드에 영향 주는 룰 변경(`_infra/records.js`의 `GAMES` 점수 범위·방향,
   게임별 규칙 등)은 `main`이 아니라 **이 `next-week` 브랜치에 커밋**한다.
2. 급한 버그 수정 등 즉시 반영할 것은 평소대로 `main`에 직접.
3. 머지 전 검증:
   ```bash
   node _infra/records.test.mjs
   node _infra/build.mjs
   ```
4. **월요일 아침(09:00 KST 이후) 수동 머지·배포:**
   ```bash
   git fetch origin
   git checkout main && git reset --hard origin/main
   git merge --no-ff origin/next-week -m "next-week 릴리스: <요약>"
   git push origin main            # GitHub Actions가 ~1분 내 자동 배포
   # 다음 주 트레인 초기화: next-week를 새 main으로 리셋
   git checkout -B next-week origin/main && git push -f origin next-week
   ```

## 주의

- `next-week`가 오래 `main`보다 뒤처지면 머지 충돌 위험 → 주중에 `main`에
  핫픽스가 들어갔다면 `git merge origin/main`으로 가끔 최신화.
- 룰 변경은 **이번 주 기록을 소급 무효화하지 않는다** — 새 룰은 다음 주
  보드부터 적용된다는 점을 전제로 작성한다.
