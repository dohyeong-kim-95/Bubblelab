#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${LIFE_SINK_HOME:-$HOME/life-sink}"
CONFIG="$DEST/life-sink.config.json"

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js 20 이상을 설치해주세요."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20 이상이 필요합니다 (현재 $(node -v))."

mkdir -p -m 700 "$DEST"
chmod 700 "$DEST"
if [ "$HERE" != "$DEST" ]; then
  cp "$HERE/life-sink.mjs" "$HERE/store.mjs" "$HERE/install.sh" "$HERE/life-sink.config.example.json" "$DEST/"
fi
chmod 700 "$DEST/install.sh"
chmod 600 "$DEST/life-sink.mjs" "$DEST/store.mjs" "$DEST/life-sink.config.example.json"

if [ ! -f "$CONFIG" ]; then
  cp "$DEST/life-sink.config.example.json" "$CONFIG"
  chmod 600 "$CONFIG"
  say "설정 파일을 만들었습니다: $CONFIG"
  say "token과 passphrase를 채운 뒤 bash $DEST/install.sh 를 다시 실행하세요."
  exit 0
fi
chmod 600 "$CONFIG"

node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const missing = ["url", "token", "passphrase"].filter((key) => !value[key] || /앱의|암호 문구|여기에|[<>]/.test(value[key]));
  if (missing.length) { console.error("설정이 비어 있습니다: " + missing.join(", ")); process.exit(1); }
' "$CONFIG" || die "$CONFIG 를 먼저 채워주세요."

if ! command -v systemctl >/dev/null 2>&1; then
  say "설치는 완료했습니다. systemd가 없어 수동 실행이 필요합니다: node $DEST/life-sink.mjs"
  say "macOS는 launchd, Windows는 작업 스케줄러에서 로그인 시 실행하도록 등록하세요."
  exit 0
fi

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p -m 700 "$UNIT_DIR"
UNIT="$UNIT_DIR/life-sink.service"
{
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=Life OS encrypted archive sink'
  printf '%s\n' 'After=network-online.target'
  printf '%s\n' 'Wants=network-online.target'
  printf '\n%s\n' '[Service]'
  printf '%s\n' 'Type=simple'
  printf 'ExecStart=%s %s/life-sink.mjs\n' "$(command -v node)" "$DEST"
  printf 'WorkingDirectory=%s\n' "$DEST"
  printf '%s\n' 'Restart=always'
  printf '%s\n' 'RestartSec=10'
  printf '%s\n' 'UMask=0077'
  printf '%s\n' 'NoNewPrivileges=true'
  printf '\n%s\n' '[Install]'
  printf '%s\n' 'WantedBy=default.target'
} > "$UNIT"
chmod 600 "$UNIT"
systemctl --user daemon-reload
systemctl --user enable --now life-sink
loginctl enable-linger "$USER" 2>/dev/null || say "경고: 로그아웃 뒤 실행을 유지하려면 loginctl enable-linger가 필요합니다."

say "Life sink 설치 및 기동 완료"
say "상태: systemctl --user status life-sink"
say "로그: journalctl --user -u life-sink -f"
