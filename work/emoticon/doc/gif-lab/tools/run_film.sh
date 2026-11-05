#!/usr/bin/env bash
# FILM 보간 컷 일괄: 입력 정규화(360² 흰 바탕 키) → film.py --white --loop --n 3 → assemble.
#   bash run_film.sh            # 전 컷 (01b 03 06 07 10 16)
#   bash run_film.sh 03 10      # 고른 컷만
# 입력이 아직 없으면 30초마다 확인하며 기다린다(MAX_WAIT 초, 기본 3600). 준비된 컷부터 목록 순서대로.
# 당이(llama-server)가 돌 때는 돌리지 말 것 — 무겁다.
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"; G="$(dirname "$T")"; R="$G/raw"
FILMPY="${FILMPY:?FILM 용 TF 가상환경 파이썬 경로를 FILMPY 로 준다 (tensorflow·tensorflow_hub)}"
N=3; MAX_WAIT="${MAX_WAIT:-3600}"
export TF_NUM_INTRAOP_THREADS="${THREADS:-$(nproc)}" TF_NUM_INTEROP_THREADS=2 OMP_NUM_THREADS="${THREADS:-$(nproc)}" TF_CPP_MIN_LOG_LEVEL=2
LOG="$G/film/run.log"; mkdir -p "$G/film"

# 컷별 설정: 입력 파일들 | 준비 방식 | 키 홀드(틱, 키 순서) | assemble 정렬 옵션
inputs() { case $1 in
  01b) echo "$R/01/sheet.png";;
  03)  echo "$R/00/base.png $R/02/closed.png";;
  06)  echo "$R/00/base.png $R/05/out.png $R/05/in.png";;
  07)  echo "$R/04/sheet.png";;
  10)  echo "$R/00/base.png $R/09/down.png";;
  16)  echo "$R/15/sheet.png";;
esac; }
keyholds() { case $1 in       # 보간 프레임은 1틱
  01b) echo 10,1,2,1;;        # 뜸 · 반감 · 감음 · 반감  → 22틱
  03)  echo 14,2;;            # 뜸 · 감음                → 20틱
  06)  echo 3,2,2,2;;         # base · out · in · out     → 17틱
  07)  echo 1,1,1,1,1,1;;     #                          → 18틱
  10)  echo 3,2,3,2;;         # base · down · base · down → 18틱 (끄덕 두 번)
  16)  echo 1,1,1,1,1,1;;     # 달리기 사이클             → 18틱
esac; }
alignopt() { case $1 in 16) echo "--align ground --normalize none";; *) echo "--align bbox --normalize area";; esac; }

ready() {   # 파일이 다 있고 5초 동안 크기가 안 변했으면(쓰는 중이 아니면) 준비됨
  local f s1 s2
  for f in $(inputs "$1"); do [ -s "$f" ] || return 1; done
  s1=$(stat -c %s $(inputs "$1") | tr '\n' ,); sleep 5; s2=$(stat -c %s $(inputs "$1") | tr '\n' ,)
  [ "$s1" = "$s2" ]
}

prep() {    # → film/<id>/keys/k00.png …
  local id=$1 d="$G/film/$1"; rm -rf "$d"; mkdir -p "$d/src"
  case $id in
    01b) python3 "$T/slice.py" "$R/01/sheet.png" "$d/src" --rows 2 --cols 2 >/dev/null;;
    07) python3 "$T/slice.py" "$R/04/sheet.png" "$d/src" --rows 2 --cols 3 >/dev/null;;
    16) python3 "$T/slice.py" "$R/15/sheet.png" "$d/src" --rows 2 --cols 3 >/dev/null;;
    03) cp "$R/00/base.png" "$d/src/0.png"; cp "$R/02/closed.png" "$d/src/1.png";;
    06) cp "$R/00/base.png" "$d/src/0.png"; cp "$R/05/out.png" "$d/src/1.png"
        cp "$R/05/in.png" "$d/src/2.png"; cp "$R/05/out.png" "$d/src/3.png";;
    10) cp "$R/00/base.png" "$d/src/0.png"; cp "$R/09/down.png" "$d/src/1.png"
        cp "$R/00/base.png" "$d/src/2.png"; cp "$R/09/down.png" "$d/src/3.png";;
  esac
  python3 "$T/assemble.py" "$d/src" --id "$id" $(alignopt "$id") --frames-out "$d/keys" >/dev/null
}

holds() {   # holds.txt(K/i) + 키 홀드 목록 → assemble --hold 문자열
  python3 -c "
import sys
tags=open(sys.argv[1]).read().split(); kh=[int(x) for x in sys.argv[2].split(',')]; k=0; out=[]
for t in tags:
    if t=='K': out.append(kh[k % len(kh)]); k+=1
    else: out.append(1)
print(','.join(map(str,out)))" "$1" "$2"
}

run_one() {
  local id=$1 d="$G/film/$1" t0=$SECONDS
  echo "[$(date +%T)] $id 시작" | tee -a "$LOG"
  prep "$id" || { echo "$id prep 실패" | tee -a "$LOG"; return 1; }
  "$FILMPY" "$T/film.py" "$d/keys" "$d/interp" --white --loop --n $N >>"$LOG" 2>&1 \
    || { echo "$id FILM 실패 (로그 $LOG)" | tee -a "$LOG"; return 1; }
  python3 "$T/assemble.py" "$d/interp" --id "$id" --raw --hold "$(holds "$d/interp/holds.txt" "$(keyholds "$id")")" | tee -a "$LOG"
  echo "[$(date +%T)] $id 끝 $((SECONDS - t0))s" | tee -a "$LOG"
  echo "$id $((SECONDS - t0))s" >> "$G/film/times.txt"
}

CUTS=("$@"); [ ${#CUTS[@]} -eq 0 ] && CUTS=(01b 03 06 07 10 16)
pending=("${CUTS[@]}"); waited=0
while [ ${#pending[@]} -gt 0 ]; do
  did=0; rest=()
  for id in "${pending[@]}"; do
    if [ $did -eq 0 ] && ready "$id"; then run_one "$id"; did=1; else rest+=("$id"); fi
  done
  pending=("${rest[@]+"${rest[@]}"}")
  if [ $did -eq 0 ] && [ ${#pending[@]} -gt 0 ]; then
    [ $waited -ge "$MAX_WAIT" ] && { echo "입력 대기 시간 초과: ${pending[*]}" | tee -a "$LOG"; exit 1; }
    echo "[$(date +%T)] 입력 대기: ${pending[*]}"; sleep 30; waited=$((waited + 30))
  fi
done
echo "FILM 전부 끝" | tee -a "$LOG"
