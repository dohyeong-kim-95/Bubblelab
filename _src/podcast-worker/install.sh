#!/usr/bin/env bash
# 팟캐스트 생성기 설치 — 이 폴더를 ~/podcast-worker 에 앉히고, 부팅 때 저절로 뜨게 만든다.
#
#   bash install.sh
#
# 하는 일: ~/podcast-worker 에 복사 → 파이썬 venv + Supertonic(TTS) 설치 → 설정 확인 →
# systemd 유저 서비스 등록·기동. 대본은 이미 떠 있는 당이(llama-server 8090)가 쓴다.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${PODCAST_WORKER_HOME:-$HOME/podcast-worker}"
CONFIG="$DEST/podcast-worker.config.json"

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node 가 없습니다. Node 20 이상을 설치해주세요."
command -v python3 >/dev/null 2>&1 || die "python3 가 없습니다."
command -v pdftotext >/dev/null 2>&1 || die "pdftotext 가 없습니다 (poppler-utils)."

# ── 설치 ─────────────────────────────────────────────────────
mkdir -p "$DEST"
if [ "$HERE" != "$DEST" ]; then
  # 데몬이 import 하는 모듈은 전부 여기 있어야 한다. podcast-ai.js 는 워커와 같은 대본 규칙 원본.
  cp "$HERE/podcast-worker.mjs" "$HERE/pipeline.mjs" "$HERE/tts.py" "$HERE/install.sh" \
     "$HERE/podcast-worker.config.example.json" "$DEST/"
  cp "$HERE/../../_infra/podcast-ai.js" "$DEST/"
fi
say "✓ 설치: $DEST"

if [ ! -x "$DEST/venv/bin/python" ]; then
  python3 -m venv "$DEST/venv"
fi
"$DEST/venv/bin/pip" install -q --upgrade supertonic
say "✓ Supertonic 준비 (모델 약 390MB 는 첫 녹음 때 ~/.cache/supertonic3 로 받습니다)"

if [ ! -f "$CONFIG" ]; then
  cp "$DEST/podcast-worker.config.example.json" "$CONFIG"
  chmod 600 "$CONFIG"
  say ""
  say "설정 파일을 만들었습니다: $CONFIG"
  say "admin 🎙️ Podcast 화면의 [🖥️ PC 생성기 → 토큰 발급] 값을 token 에 넣고 다시 실행하세요."
  say "  bash $DEST/install.sh"
  exit 0
fi
chmod 600 "$CONFIG"
node -e '
  const cfg = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!/^pw_[0-9a-f]{48}$/.test(cfg.token || "")) { console.error("✖ token 이 비어 있거나 형식이 다릅니다"); process.exit(1); }
' "$CONFIG" || die "$CONFIG 를 채운 뒤 다시 실행해주세요."

# ── 항상 켜두기 ──────────────────────────────────────────────
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/podcast-worker.service" <<UNIT
[Unit]
Description=Podcast worker — 팟캐스트 대본(당이)·녹음(Supertonic)을 이 PC에서 만든다
After=network-online.target llama-server.service

[Service]
Type=simple
ExecStart=$(command -v node) $DEST/podcast-worker.mjs
WorkingDirectory=$DEST
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now podcast-worker
systemctl --user restart podcast-worker
loginctl enable-linger "$USER" 2>/dev/null || true

say ""
say "✓ 서비스 등록·기동 완료."
say "  상태 보기:  systemctl --user status podcast-worker"
say "  로그 보기:  journalctl --user -u podcast-worker -f"
