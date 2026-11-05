#!/usr/bin/env bash
# FILM 없는 컷 조립(생성 0, 가벼움).  bash assemble_all.sh [컷id…]
# 컷마다: 시트는 균등 격자로 자르고(칸 안 위치 보존), 키는 파일을 순서대로 놓아 assemble.
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd)"; G="$(dirname "$T")"; R="$G/raw"; W="$G/frames"
A() { python3 "$T/assemble.py" "$@"; }
sl() { rm -rf "$W/$1"; python3 "$T/slice.py" "$2" "$W/$1" --rows "$3" --cols "$4" >/dev/null; }
keys() { local id=$1; shift; rm -rf "$W/$id"; mkdir -p "$W/$id"; local i=0
  for f in "$@"; do cp "$f" "$W/$id/k$(printf %02d $i).png"; i=$((i+1)); done; }

cut() { case $1 in
  # 눈깜빡임: 뜸 길게 · 반감 1 · 감음 2 · 반감 1 = 20틱
  01) sl 01 "$R/01/sheet.png" 2 2; A "$W/01" --id 01 --hold 16,1,2,1;;
  # 뜸 20 · 감음 2 = 22틱
  02) keys 02 "$R/00/base.png" "$R/02/closed.png"; A "$W/02" --id 02 --hold 20,2;;
  # 손 흔들기 6장 순서대로 3틱씩 = 18틱. 팔이 bbox 를 흔드니 가로는 칸 자리 그대로(ground), 크기는 높이로
  04) sl 04 "$R/04/sheet.png" 2 3; A "$W/04" --id 04 --hold 3 --align ground --normalize height;;
  # base → out → in → out → in → out, 3틱씩 = 18틱
  05) keys 05 "$R/00/base.png" "$R/05/out.png" "$R/05/in.png" "$R/05/out.png" "$R/05/in.png" "$R/05/out.png"
      A "$W/05" --id 05 --hold 3 --align ground --normalize height;;
  # 끄덕임 두 번: [3,2,3,2]×2 = 20틱. 머리가 내려가 높이가 바뀌니 면적 정규화, 바닥·가로중심 정렬
  08) sl 08 "$R/08/sheet.png" 2 2; A "$W/08" "$W/08" --id 08 --hold 3,2,3,2,3,2,3,2;;
  # base 5 · down 4 × 2 = 18틱
  09) keys 09 "$R/00/base.png" "$R/09/down.png" "$R/00/base.png" "$R/09/down.png"; A "$W/09" --id 09 --hold 5,4,5,4;;
  # 통통: 칸 안 높이를 살린다(정렬·정규화 끔). 웅크림3 · 뜀2 · 공중3 · 착지2 × 2 = 20틱
  12) sl 12 "$R/12/sheet.png" 2 2; A "$W/12" "$W/12" --id 12 --hold 3,2,3,2,3,2,3,2 --align none --normalize none --fill 0.62;;
  # 하트: 떠오름→커짐→유지→사라짐 5틱씩 = 20틱 (하트는 떨어진 조각이라 정렬은 몸 기준)
  14) sl 14 "$R/14/sheet.png" 2 2; A "$W/14" --id 14 --hold 5 --fill 0.72;;   # 하트가 몸 위로 솟으니 배율을 낮춘다
  # 달리기 사이클 6장 ×3바퀴, 1틱 = 18틱. 바닥만 맞춤, 크기 고정
  15) sl 15 "$R/15/sheet.png" 2 3; A "$W/15" "$W/15" "$W/15" --id 15 --hold 1 --align ground --normalize none --fill 0.8;;
  # N 손 흔들기: pingpong 0-1-2-3-2-1, 3틱 = 18틱
  17) sl 17 "$R/17/sheet.png" 2 2; A "$W/17" --id 17 --hold 3 --pingpong --align ground --normalize height;;
  # N 통통: 12 와 같은 설정
  18) sl 18 "$R/18/sheet.png" 2 2; A "$W/18" "$W/18" --id 18 --hold 3,2,3,2,3,2,3,2 --align none --normalize none --fill 0.62;;
  # 테니스: 준비4 · 백스윙3 · 올림2 · 임팩트1 · 팔로스루3 · 복귀5 = 18틱 (임팩트는 빠르게)
  20) sl 20 "$R/20/sheet.png" 2 3; A "$W/20" --id 20 --hold 4,3,2,1,3,5 --align ground --normalize none --fill 0.8;;
  *) echo "모르는 컷 $1"; return 1;;
esac; }

CUTS=("$@"); [ ${#CUTS[@]} -eq 0 ] && CUTS=(01 02 04 05 08 09 12 14 15 17 18 20)
for id in "${CUTS[@]}"; do cut "$id"; done
python3 "$T/report.py"
