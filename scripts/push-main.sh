#!/usr/bin/env bash
# 워크플로가 만든 커밋을 main 에 올린다 — 이모티콘 워크플로 셋이 같이 쓴다.
#
#   GITHUB_TOKEN=… bash scripts/push-main.sh
#
# ① 세 번 시도하고, 다 실패하면 **실패로 끝낸다.** 예전 루프는 마지막 명령이
#    sleep(exit 0)이라 push 가 전부 실패해도 스텝이 초록색으로 끝났다.
# ② checkout 은 persist-credentials: false 라 쓰기 토큰이 디스크에 없다. 토큰은 이
#    스크립트에서만 원격 주소에 넣는다 — 앞 단계의 npm ci(의존성 설치 스크립트)가
#    main 에 push 할 수 있는 토큰을 보지 못하게.
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN 이 필요하다}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY 가 필요하다}"
server="${GITHUB_SERVER_URL:-https://github.com}"
git remote set-url origin "${server/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}/${GITHUB_REPOSITORY}.git"

for attempt in 1 2 3; do
  if git pull --rebase origin main && git push origin HEAD:main; then
    echo "main 에 올렸다 (시도 $attempt)"
    exit 0
  fi
  git rebase --abort 2>/dev/null || true   # 충돌로 멈춘 rebase 를 풀어 다음 시도를 깨끗하게
  sleep $((attempt * 2))
done

echo "::error::main 에 push 하지 못했다 (3번 시도)" >&2
exit 1
