#!/usr/bin/env bash
# 12칸 한 주기를 두 번 이어 24장으로(2초). 사용: loop24.sh src_dir dst_dir ms.json → 표준출력에 24개 ms(쉼표)
set -euo pipefail
src=$1; dst=$2; msj=$3; mkdir -p "$dst"
n=$(ls "$src"/*.png | wc -l)
i=0; for r in 1 2; do for f in $(ls "$src"/*.png | sort); do i=$((i+1)); cp "$f" "$dst/$(printf %02d $i).png"; done; done
python3 -c "import json,sys; m=json.load(open(sys.argv[1]))['ms']; print(','.join(map(str,m*2)))" "$msj"
