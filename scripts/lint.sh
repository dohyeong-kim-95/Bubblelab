#!/usr/bin/env bash
# 이 리포의 "린트" = 문법 검사다.
#
# eslint/prettier 를 두지 않는 이유: 토이는 의존성 없는 바닐라 HTML이 기본이고,
# 스타일 규칙보다 **파일이 파싱은 되는가**가 실제로 사고를 막는다. 브라우저에서만
# 도는 스크립트는 단위 테스트가 없어서, 오타 하나가 그대로 배포되어 빈 화면이
# 됐다. 그걸 커밋 전에 잡는 게 목적이다.
#
#   bash scripts/lint.sh              # 추적 중인 파일 전부
#   bash scripts/lint.sh a.js b.json  # 지정한 파일만 (pre-commit 훅이 이렇게 쓴다)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  mapfile -t files < <(git ls-files -- '*.js' '*.mjs' '*.json' '*.sh')
fi

fail=0
checked=0

report() { printf '\033[31m✗ %s\033[0m\n  %s\n' "$1" "$2" >&2; fail=1; }

for file in "${files[@]}"; do
  [ -f "$file" ] || continue          # 삭제된 파일은 건너뛴다
  case "$file" in
    node_modules/*|dist/*|*/node_modules/*) continue ;;
    # 아발론 빌드 산출물은 번들러가 만든 것이라 검사 대상이 아니다
    games/avalon/*|_src/avalon/dist/*) continue ;;
  esac

  case "$file" in
    *.js|*.mjs)
      out="$(node --check "$file" 2>&1)" || report "$file — 문법 오류" "$(echo "$out" | sed -n '2,4p')"
      checked=$((checked + 1))
      ;;
    *.json)
      out="$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$file" 2>&1)" ||
        report "$file — JSON 파싱 실패" "$(echo "$out" | grep -m1 -E 'SyntaxError|Unexpected')"
      checked=$((checked + 1))
      ;;
    *.sh)
      out="$(bash -n "$file" 2>&1)" || report "$file — 셸 문법 오류" "$out"
      checked=$((checked + 1))
      ;;
  esac
done

if [ "$fail" -eq 0 ]; then
  echo "lint: ${checked}개 파일 문법 통과"
else
  echo "" >&2
  echo "lint 실패 — 위 파일을 고치고 다시 커밋해라" >&2
fi
exit "$fail"
