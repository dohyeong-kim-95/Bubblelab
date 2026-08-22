#!/usr/bin/env bash
# papers 상주 데몬 설치 — 디스코드 전용 채널에 쓰면 그 자리에서 답하게 만든다.
#
#   bash _src/papers-sink/install.sh
#
# 하는 일: Node 확인 → 환경변수 확인 → systemd 유저 서비스 등록·기동.
# 하루치 다이제스트와 슬래시 명령은 별개다(그쪽은 1분 cron 이 맡는다).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PAPERS_ENV:-$HOME/.bubblelab/papers.env}"

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

# ── Node 확인 ────────────────────────────────────────────────
# 전역 WebSocket 이 필요하다. 22+ 는 기본, 20.10~21 은 플래그로 켠다.
command -v node >/dev/null 2>&1 || die "node 가 없습니다. Node 20.10 이상을 설치해주세요."
NODE_BIN="$(command -v node)"
NODE_FLAGS=""
if ! node -e 'if (typeof WebSocket !== "function") process.exit(1)' 2>/dev/null; then
  node --experimental-websocket -e 'if (typeof WebSocket !== "function") process.exit(1)' 2>/dev/null \
    || die "이 Node($(node -v))에서는 WebSocket 을 켤 수 없습니다. Node 22 이상을 써주세요."
  NODE_FLAGS="--experimental-websocket"
  say "· Node $(node -v) — $NODE_FLAGS 로 실행합니다 (22+ 는 플래그가 필요 없습니다)."
fi

# ── 환경변수 확인 ────────────────────────────────────────────
# 자리표시자인 채로 서비스를 띄우면 조용히 죽는다 — 여기서 세운다.
[ -f "$ENV_FILE" ] || die "$ENV_FILE 이 없습니다."
chmod 600 "$ENV_FILE"

missing=""
for key in DISCORD_BOT_TOKEN DISCORD_CHAT_CHANNEL_ID PAPERS_SINK_SECRET; do
  grep -q "^${key}=." "$ENV_FILE" || missing="$missing $key"
done
if [ -n "$missing" ]; then
  say ""
  say "✖ $ENV_FILE 에 다음이 없습니다:$missing"
  say ""
  say "  DISCORD_BOT_TOKEN       개발자 포털 → Bot → Reset Token"
  say "  DISCORD_CHAT_CHANNEL_ID 대화할 채널 ID (채널 우클릭 → ID 복사)"
  say ""
  say "**게이트웨이는 붙는 쪽이 토큰을 들어야 한다** — 그래서 엣지에만 두던 봇"
  say "토큰이 이 PC 에도 필요하다. 토큰을 새로 발급했다면 엣지 것도 같이 바꿔야"
  say "다이제스트 발송이 멈추지 않는다:"
  say ""
  say "  npx wrangler@4 secret put DISCORD_BOT_TOKEN"
  exit 1
fi

# 개발자 포털의 Message Content 인텐트가 꺼져 있으면 글이 내용 없이 온다.
# 게이트웨이가 4014 로 거부당하거나 빈 내용만 받으므로 로그에서 드러난다.

# ── 항상 켜두기 ──────────────────────────────────────────────
command -v systemctl >/dev/null 2>&1 || {
  say ""
  say "systemd 가 없습니다. 수동으로 실행하세요:"
  say "  set -a && . $ENV_FILE && set +a && node $NODE_FLAGS $REPO/_src/papers-sink/gateway.mjs"
  exit 0
}

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/papers-gateway.service" <<UNIT
[Unit]
Description=papers gateway — 디스코드 전용 채널에서 논문 이야기를 받는다
After=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $NODE_FLAGS $REPO/_src/papers-sink/gateway.mjs
WorkingDirectory=$REPO
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now papers-gateway

# 로그아웃·재부팅 뒤에도 계속 돌게 (이게 없으면 세션이 끝날 때 함께 죽는다).
loginctl enable-linger "$USER" 2>/dev/null || \
  say "! loginctl enable-linger 실패 — 로그아웃하면 멈출 수 있습니다."

say ""
say "✓ 서비스 등록·기동 완료."
say "  상태 보기:  systemctl --user status papers-gateway"
say "  로그 보기:  journalctl --user -u papers-gateway -f"
