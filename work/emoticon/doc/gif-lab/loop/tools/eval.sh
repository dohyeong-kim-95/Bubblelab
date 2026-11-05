#!/usr/bin/env bash
# 변형 시트 조립 + 이음매 분석 + 비교표.   bash eval.sh B C D        (인자 없으면 모든 변형 폴더)
#   변형 이름에 격자를 붙일 수 있다: B:4x6. 없으면 <변형>/grid.txt("4x6"), 그것도 없으면 흰 여백으로 자동 감지.
#   <변형>/<변형>.gif 가 이미 있으면 그대로 쓴다(A 처럼 draw 가 직접 조립한 경우). 다시 조립하려면 REBUILD=1.
#   조립은 A 와 같은 방식: 칸을 360² 로, 프레임마다 수평 가운데 정렬만(sheet.py --center frame-x), 50ms.
#   분석 결과: <변형>/seam.txt·seam.json·<변형>_seam.png, 루프 탐색 <변형>/<변형>_trim.gif(+_seam.txt).
#   마지막에 compare.md 를 다시 만든다(A·E 포함, seam.json 이 있는 모든 폴더).
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd)"; X="$(dirname "$T")"; MS="${MS:-50}"
args=("$@")
if [ ${#args[@]} -eq 0 ]; then for d in "$X"/*/; do b=$(basename "$d"); [ "$b" = tools ] || [ "$b" = E ] || args+=("$b"); done; fi
for a in "${args[@]}"; do
  v=${a%%:*}; grid=""; [ "$a" != "$v" ] && grid=${a#*:}
  d="$X/$v"; gif="$d/$v.gif"
  [ -d "$d" ] || { echo "$v: 폴더 없음 — 건너뜀"; continue; }
  if [ ! -f "$gif" ] || [ "${REBUILD:-0}" = 1 ]; then
    [ -f "$d/sheet.png" ] || { echo "$v: sheet.png 없음 — 건너뜀"; continue; }
    [ -z "$grid" ] && [ -f "$d/grid.txt" ] && grid=$(tr -d ' \n' < "$d/grid.txt")
    g=(); [ -n "$grid" ] && g=(--rows "${grid%x*}" --cols "${grid#*x}")
    python3 "$T/sheet.py" "$d/sheet.png" "$gif" "${g[@]}" --ms "$MS" --center frame-x
  fi
  python3 "$T/seam.py" "$gif" --json "$d/seam.json" --search "$d/${v}_trim.gif" > "$d/seam.txt"
  grep -E "seam_ratio|seam_pose_ratio|정체 구간|느린 구간|뺀 프레임|프레임 ×" "$d/seam.txt" | sed "s/^/  $v /"
done
python3 "$T/compare.py"
