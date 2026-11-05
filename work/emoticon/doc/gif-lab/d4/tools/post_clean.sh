#!/usr/bin/env bash
# 다듬기 뒤 한 종 마무리(2026-11-06): 복사 → 누끼 → 칸 정렬 → 24장 → 효과(+duri판 글자) → 카카오·LINE 출력 → duri APNG.
# 사용: post_clean.sh NN [--band] -- <fx_overlay 효과 인자...>
set -euo pipefail
T=$(cd "$(dirname "$0")" && pwd); D=~/dageudangs-lab/work/d4; PK=~/dageudangs-lab/stickers/dageudangseu-4-anim
n=$1; shift; band=""; [ "${1:-}" = "--band" ] && { band="--band"; shift; }; [ "${1:-}" = "--" ] && shift
V=$D/$n/v2; cp /tmp/dageudangs-d4/v2/$n/clean_sheet.png /tmp/dageudangs-d4/v2/$n/gen.md $V/
rm -rf $V/cut $V/reg $V/char24 $V/frames $V/duri_frames $V/out
python3 $T/cutout.py $V/clean_sheet.png:3x4 $V/cut >/dev/null
python3 $T/register.py $V/cut $V/rig/frames $V/reg $band
MS=$($T/loop24.sh $V/reg $V/char24 $V/rig/ms.json)
python3 $T/fx_overlay.py $V/char24 $D/$n/split $V/frames --period 12 --match-char "$@"
python3 $T/fx_overlay.py $V/char24 $D/$n/split $V/duri_frames --period 12 --match-char --static text "$@"
python3 $T/d4_export.py $V/frames $V/out --ms "$MS" --line-period 12 | tail -3
mkdir -p $PK; python3 $T/duri_export.py one $V/duri_frames $V/rig/ms.json $PK/$n.png
