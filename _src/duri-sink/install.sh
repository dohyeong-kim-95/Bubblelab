#!/usr/bin/env bash
# Duri 싱크 설치 — 이 폴더를 홈에 앉히고, 부팅 때 저절로 뜨게 만든다.
#
# 이 데몬이 안 돌면 서버 버퍼(30일)를 넘긴 대화·사진은 그대로 사라진다.
# "엣지는 중계소, 원본은 내 PC"의 원본이 곧 이 프로세스다.
#
#   bash install.sh
#
# 하는 일: 설정 확인 → ~/duri-sink 에 설치 → systemd 유저 서비스 등록·기동.
# systemd 가 없으면(맥·윈도) 설치까지만 하고 등록 방법을 안내한다.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DURI_SINK_HOME:-$HOME/duri-sink}"
CONFIG="$DEST/duri-sink.config.json"

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

# ── Node 확인 ────────────────────────────────────────────────
# 전역 WebSocket 이 필요하다. 22+ 는 기본 제공, 20.10~21 은 플래그로 켤 수 있다 —
# Node 20 을 쓰는 PC 에 22 설치를 강요하지 않으려고 플래그 경로를 남겨 둔다.
command -v node >/dev/null 2>&1 || die "node 가 없습니다. Node 20.10 이상을 설치해주세요."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
NODE_FLAGS=""
if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 10 ]; then
    die "Node 20.10 이상이 필요합니다 (지금 $(node -v))."
  elif [ "$NODE_MAJOR" -lt 20 ]; then
    die "Node 20.10 이상이 필요합니다 (지금 $(node -v))."
  fi
  node --experimental-websocket -e 'if (typeof WebSocket !== "function") process.exit(1)' 2>/dev/null \
    || die "이 Node($(node -v))에서는 WebSocket 을 켤 수 없습니다. Node 22 이상을 써주세요."
  NODE_FLAGS="--experimental-websocket"
  say "· Node $(node -v) — $NODE_FLAGS 로 실행합니다 (22+ 는 플래그가 필요 없습니다)."
fi

# ── 설치 ─────────────────────────────────────────────────────
mkdir -p "$DEST"
cp "$HERE/duri-sink.mjs" "$HERE/store.mjs" "$DEST/"
say "✓ 설치: $DEST"

# 설정은 덮어쓰지 않는다 — 토큰·문구가 이미 들어 있을 수 있다.
if [ -f "$CONFIG" ]; then
  say "✓ 기존 설정 유지: $CONFIG"
else
  if [ -f "$HERE/duri-sink.config.json" ]; then
    cp "$HERE/duri-sink.config.json" "$CONFIG"
    say "✓ 설정 복사: $CONFIG"
  else
    cp "$HERE/duri-sink.config.example.json" "$CONFIG"
    chmod 600 "$CONFIG"
    say ""
    say "설정 파일을 만들었습니다: $CONFIG"
    say "앱의 [⚙️ → 💾 PC 백업 설정 → 🔑 싱크 토큰 발급] 내용을 붙여넣고,"
    say "passphrase 에는 앱에 입력한 암호 문구를 그대로 적어주세요."
    say "그런 다음 이 스크립트를 다시 실행하면 서비스로 등록합니다."
    exit 0
  fi
fi
chmod 600 "$CONFIG"

# 설정이 채워졌는지 확인 — 자리표시자인 채로 서비스를 띄우면 조용히 죽는다.
node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const missing = ["url", "token", "passphrase"].filter(
    (k) => !cfg[k] || /여기에|<|＜/.test(String(cfg[k])));
  if (missing.length) {
    console.error("✖ 설정이 아직 비어 있습니다: " + missing.join(", "));
    process.exit(1);
  }
' "$CONFIG" || die "$CONFIG 를 채운 뒤 다시 실행해주세요."

# ── 항상 켜두기 ──────────────────────────────────────────────
if ! command -v systemctl >/dev/null 2>&1; then
  say ""
  say "systemd 가 없습니다. 수동으로 실행하세요:  node $NODE_FLAGS $DEST/duri-sink.mjs"
  say "  macOS  → ~/Library/LaunchAgents 에 launchd plist (RunAtLoad·KeepAlive true)"
  say "  Windows→ 작업 스케줄러 '로그온할 때' 트리거"
  exit 0
fi

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/duri-sink.service" <<UNIT
[Unit]
Description=Duri sink — 대화·사진을 이 PC 디스크에 보존
After=network-online.target

[Service]
Type=simple
ExecStart=$(command -v node) $NODE_FLAGS $DEST/duri-sink.mjs
WorkingDirectory=$DEST
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now duri-sink

# 로그아웃·재부팅 뒤에도 계속 돌게 (이게 없으면 세션이 끝날 때 함께 죽는다).
loginctl enable-linger "$USER" 2>/dev/null || \
  say "! loginctl enable-linger 실패 — 로그아웃하면 멈출 수 있습니다 (sudo 로 한 번 실행해주세요)."

say ""
say "✓ 서비스 등록·기동 완료."
say "  상태 보기:  systemctl --user status duri-sink"
say "  로그 보기:  journalctl --user -u duri-sink -f"
say "  저장 위치:  $DEST/DuriStorage"
