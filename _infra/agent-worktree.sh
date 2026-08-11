#!/usr/bin/env bash
# 서브도메인마다 격리된 git worktree("레인")를 만든다 — 병렬 에이전트가 같은
# 작업 트리를 공유하지 않게 하는 것이 목적이다. 각 레인은 origin/main에서
# 깨끗하게 시작하므로 다른 터미널의 미커밋 변경이 애초에 존재하지 않는다
# (커밋에 휩쓸리는 일이 불가능해진다).
#
#   레인 = ../worktrees/<서브도메인>   (서브도메인당 하나, 계속 재사용)
#   브랜치 = agent/<서브도메인>/<슬러그>  (작업마다 새로, origin/main에서)
#
#   _infra/agent-worktree.sh init                  # 모든 서브도메인 레인 생성
#   _infra/agent-worktree.sh task <서브도메인> <슬러그>  # 레인을 새 작업 브랜치로
#   _infra/agent-worktree.sh list
#   _infra/agent-worktree.sh remove <서브도메인> [--force]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TREES="$(cd "$ROOT/.." && pwd)/worktrees"

die() { echo "error: $*" >&2; exit 1; }

# 서브도메인 = 루트의 `_`/`.` 로 시작하지 않고 SKIP에도 없는 폴더.
# **제외 목록은 build.mjs에서 그대로 읽는다** — 여기에 따로 적어 두면 언젠가
# 어긋나서 서브도메인 아닌 폴더(scripts/ 등)에 레인이 생긴다.
skip_names() {
  sed -n 's/^const SKIP = new Set(\[\(.*\)\]);$/\1/p' "$ROOT/_infra/build.mjs" |
    tr -d ' "' | tr ',' '\n' | grep -v '^$'
}

subdomains() {
  find "$ROOT" -maxdepth 1 -mindepth 1 -type d -printf '%f\n' |
    grep -Ev '^(_|\.)' | grep -vxF -f <(skip_names) | sort
}

is_subdomain() { subdomains | grep -qx -- "${1:-}"; }

# 훅은 리포 설정이라 레인 전부가 같이 쓴다. 설정은 커밋되지 않으므로 매번 켠다.
enable_hooks() { git -C "$ROOT" config core.hooksPath _infra/agent-hooks; }

# node_modules는 gitignore라 레인마다 비어 있다. 메인 것을 복사해 둔다(19MB).
# **심링크가 아니라 복사인 이유**: 링크면 한 레인의 `npm ci` 가 다른 레인이
# 쓰는 트리를 동시에 갈아엎는다. 또 `node_modules/` 라는 ignore 패턴은 폴더만
# 가려서, 심링크는 untracked로 잡혀 레인이 항상 더러워 보인다.
copy_deps() {
  local dir="$1"
  [ -d "$ROOT/node_modules" ] && [ ! -e "$dir/node_modules" ] &&
    cp -r "$ROOT/node_modules" "$dir/node_modules"
  [ -d "$ROOT/_src/avalon/node_modules" ] && [ ! -e "$dir/_src/avalon/node_modules" ] &&
    cp -r "$ROOT/_src/avalon/node_modules" "$dir/_src/avalon/node_modules"
  return 0
}

ensure_lane() {
  local name="$1" dir="$TREES/$name"
  if [ ! -d "$dir" ]; then
    mkdir -p "$TREES"
    git -C "$ROOT" worktree add --quiet --detach "$dir" origin/main
  fi
  copy_deps "$dir"
  echo "$dir"
}

cmd_init() {
  enable_hooks
  git -C "$ROOT" fetch --quiet origin main
  local name dir
  while read -r name; do
    dir="$(ensure_lane "$name")"
    printf '%-14s %s\n' "$name" "$dir"
  done < <(subdomains)
}

cmd_task() {
  local name="${1:-}" slug="${2:-}"
  is_subdomain "$name" || die "서브도메인 폴더가 아니다: '$name'"
  [ -n "$slug" ] || die "슬러그가 필요하다 (작업 이름, 소문자-하이픈)"
  case "$slug" in *[!a-z0-9-]*) die "슬러그는 소문자·숫자·하이픈만: '$slug'" ;; esac

  enable_hooks
  git -C "$ROOT" fetch --quiet origin main

  local dir branch="agent/$name/$slug"
  dir="$(ensure_lane "$name")"

  # 레인에 남은 작업이 있으면 덮지 않는다 — 반려된 브랜치를 되살릴 때
  # 같은 슬러그로 다시 부르면 그 브랜치로 그냥 들어간다.
  local current
  current="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  if [ "$current" = "$branch" ]; then
    echo "$dir"
    return
  fi
  [ -z "$(git -C "$dir" status --porcelain)" ] ||
    die "레인에 커밋되지 않은 변경이 있다: $dir ($current). 확인 후 정리해라"

  if git -C "$ROOT" show-ref --quiet --verify "refs/heads/$branch"; then
    git -C "$dir" checkout --quiet "$branch"
  else
    git -C "$dir" checkout --quiet -b "$branch" origin/main
  fi
  echo "$dir"
}

cmd_list() { git -C "$ROOT" worktree list; }

cmd_remove() {
  local name="${1:-}" force="${2:-}" dir
  [ -n "$name" ] || die "서브도메인 이름이 필요하다"
  dir="$TREES/$name"
  [ -d "$dir" ] || die "레인이 없다: $dir"
  if [ "$force" = "--force" ]; then
    git -C "$ROOT" worktree remove --force "$dir"
  else
    [ -z "$(git -C "$dir" status --porcelain)" ] ||
      die "커밋되지 않은 변경이 있다: $dir (확인 후 --force)"
    git -C "$ROOT" worktree remove "$dir"
  fi
  echo "removed $dir"
}

case "${1:-}" in
  init) cmd_init ;;
  task) shift; cmd_task "$@" ;;
  list) cmd_list ;;
  subdomains) subdomains ;;   # 테스트가 build.mjs와 대조한다
  remove) shift; cmd_remove "$@" ;;
  *) die "사용법: $0 init | task <서브도메인> <슬러그> | list | subdomains | remove <서브도메인> [--force]" ;;
esac
