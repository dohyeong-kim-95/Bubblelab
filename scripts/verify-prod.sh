#!/usr/bin/env bash
# 배포된 bubblelab 을 실제로 찔러 본다. 상태코드가 아니라 응답 형태까지 본다.
#
#   bash scripts/verify-prod.sh                 # 지금 라이브 검사
#   bash scripts/verify-prod.sh --commit <sha>  # 그 커밋이 서빙 중이어야 통과
#   bash scripts/verify-prod.sh --base http://localhost:8787   # 로컬 서빙 검사
#
# **프로덕션에 아무것도 쓰지 않는다.** 검증 페이로드를 저장소에 넣던 방식이
# 예전에 그날 잔고 스냅샷을 빈 값으로 덮어써서 복구해야 했다 — 쓰기 경로는
# "지금 저장된 값이 비어 있지 않은지" 읽어서 검사한다.
#
# 인증 게이트 뒤(invest·duri·admin)는 자격증명이 있을 때만 들어간다. 없으면
# 게이트가 제대로 막는지만 확인하고 SKIP 으로 남긴다 — 거짓 실패를 만들지 않는다.
# 자격증명은 아래 파일이나 환경변수로 준다 (파일은 커밋되지 않는다):
#   .verify.env  또는  ~/.config/bubblelab/verify.env
#     BL_ADMIN_ID=... BL_ADMIN_PASSWORD=... BL_INVEST_PASSWORD=... BL_DURI_PASSWORD=...
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for env_file in "$ROOT/.verify.env" "$HOME/.config/bubblelab/verify.env"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$env_file"; set +a
  fi
done

# Node 20 은 WebSocket 이 플래그 뒤에 있다 (22+ 는 기본 제공). 없으면 채팅
# WebSocket 프로브가 조용히 건너뛰어져서, 있으면 켜 준다.
NODE_FLAGS=()
if node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 0 : 1)'; then
  NODE_FLAGS+=(--experimental-websocket)
fi

exec node "${NODE_FLAGS[@]}" "$ROOT/_infra/verify-prod.mjs" "$@"
