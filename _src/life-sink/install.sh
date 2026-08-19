#!/usr/bin/env bash
# LIFE 백업 데몬을 이 PC 에 건다. 다시 실행해도 안전하다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/life-sink.config.json"
NODE="$(command -v node)"

if [ ! -f "$CONFIG" ]; then
  cp "$HERE/life-sink.config.example.json" "$CONFIG"
  chmod 600 "$CONFIG"
  echo "설정 파일을 만들었습니다: $CONFIG"
  echo "앱의 백업 화면에서 'PC 용 토큰 발급' 을 눌러 token 에 넣고 다시 실행하세요."
  exit 0
fi

LINE="0 * * * * cd $HERE && $NODE life-sink.mjs --once >> \$HOME/.life-sink.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'life-sink.mjs' ; echo "$LINE" ) | crontab -
echo "매시 정각에 받아 오도록 걸었습니다. 로그: ~/.life-sink.log"
