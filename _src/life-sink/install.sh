#!/usr/bin/env bash
# LIFE 백업 데몬을 이 PC 에 건다. 다시 실행해도 안전하다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/life-sink.config.json"
EXAMPLE="$HERE/life-sink.config.example.json"

die() { printf '✖ %s\n' "$*" >&2; exit 1; }

# set -e 아래에서 $(command -v node) 가 실패하면 아무 말 없이 끝난다 — 먼저 확인한다.
command -v node >/dev/null 2>&1 || die "node 가 없습니다. Node 20 이상을 설치한 뒤 다시 실행하세요."
NODE="$(command -v node)"

if [ ! -f "$CONFIG" ]; then
  cp "$EXAMPLE" "$CONFIG"
  chmod 600 "$CONFIG"
  echo "설정 파일을 만들었습니다: $CONFIG"
  echo "앱의 백업 화면에서 'PC 용 토큰 발급' 을 눌러 token 에 넣고 다시 실행하세요."
  exit 0
fi

# 토큰이 예시 그대로(자리표시자)면 cron 이 매시간 조용히 실패한다 — 여기서 멈춘다.
"$NODE" -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const example = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!config.token || config.token === example.token || /→|여기에|</.test(String(config.token))) {
    console.error("✖ token 이 아직 비어 있습니다 (앱의 백업 화면 → PC 용 토큰 발급)");
    process.exit(1);
  }
' "$CONFIG" "$EXAMPLE" || die "$CONFIG 를 채운 뒤 다시 실행해주세요."

# 경로에 공백이 있어도 cron 이 깨지지 않게 따옴표로 감싼다.
LINE="0 * * * * cd \"$HERE\" && \"$NODE\" life-sink.mjs --once >> \$HOME/.life-sink.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'life-sink.mjs' ; echo "$LINE" ) | crontab -
echo "매시 정각에 받아 오도록 걸었습니다. 로그: ~/.life-sink.log"
