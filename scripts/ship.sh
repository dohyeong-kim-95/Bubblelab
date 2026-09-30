#!/usr/bin/env bash
# make ship — main을 push하고, 해당 커밋의 저장소 Deploy 실행이 끝날 때까지 기다린다.
# 테스트·빌드·배포 검증·Cloudflare 버전 복구는 deploy.yml이 한 트랜잭션으로 맡는다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY_TIMEOUT="${SHIP_DEPLOY_TIMEOUT:-1200}"
DISCOVERY_TIMEOUT="${SHIP_RUN_DISCOVERY_TIMEOUT:-150}"
POLL_INTERVAL="${SHIP_POLL_INTERVAL:-5}"
WORKFLOW="deploy.yml"

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

RUN_ID=""
RUN_STATUS=""
RUN_CONCLUSION=""
RUN_IDS_FOR_SHA=""

find_run() {
  local sha="$1" excluded="${2:-}" deadline rows id status conclusion
  deadline=$((SECONDS + DISCOVERY_TIMEOUT))
  while ((SECONDS <= deadline)); do
    rows="$(gh run list --workflow "$WORKFLOW" -b main -L 30 \
      --json databaseId,status,conclusion,headSha \
      --jq ".[] | select(.headSha == \"$sha\") | [.databaseId, .status, .conclusion] | @tsv" \
      2>/dev/null || true)"
    RUN_IDS_FOR_SHA=""
    while IFS=$'\t' read -r id status conclusion; do
      [[ -n "$id" ]] && RUN_IDS_FOR_SHA+="${RUN_IDS_FOR_SHA:+$'\n'}$id"
    done <<<"$rows"
    while IFS=$'\t' read -r id status conclusion; do
      [[ -n "$id" ]] || continue
      [[ $'\n'"$excluded"$'\n' == *$'\n'"$id"$'\n'* ]] && continue
      RUN_ID="$id"
      RUN_STATUS="$status"
      RUN_CONCLUSION="$conclusion"
      return 0
    done <<<"$rows"
    sleep "$POLL_INTERVAL"
  done
  return 1
}

watch_run() {
  local run_id="$1" deadline row status conclusion
  echo "run #$run_id"
  deadline=$((SECONDS + DEPLOY_TIMEOUT))
  while ((SECONDS <= deadline)); do
    row="$(gh run view "$run_id" --json status,conclusion \
      --jq '[.status, .conclusion] | @tsv' 2>/dev/null)" || break
    IFS=$'\t' read -r status conclusion <<<"$row"
    if [[ "$status" == "completed" ]]; then
      [[ "$conclusion" == "success" ]] && return 0
      gh run view "$run_id" --log-failed || true
      return 1
    fi
    sleep "$POLL_INTERVAL"
  done
  gh run view "$run_id" --log-failed || true
  return 1
}

live_commit() {
  local body pattern
  body="$(curl -fsS --max-time 20 "https://bubblelab.dev/_health")" || return 1
  pattern='"commit"[[:space:]]*:[[:space:]]*"([^"]+)"'
  [[ "$body" =~ $pattern ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

is_docs_only_run() {
  local run_id="$1" jobs name conclusion plan_ok=0 publish_skipped=0
  jobs="$(gh run view "$run_id" --json jobs \
    --jq '.jobs[].steps[] | [.name, .conclusion] | @tsv')" || return 1
  while IFS=$'\t' read -r name conclusion; do
    [[ "$name" == "Plan changes since the live deployment" && "$conclusion" == "success" ]] \
      && plan_ok=1
    [[ "$name" == "Publish, verify live commit, restore previous version on failure" \
      && "$conclusion" == "skipped" ]] && publish_skipped=1
  done <<<"$jobs"
  ((plan_ok && publish_skipped))
}

say "프리플라이트"
for tool in git gh curl; do
  command -v "$tool" >/dev/null || die "$tool 명령이 필요하다"
done
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || die "main 브랜치에서만 배포한다 (지금: $BRANCH)"
git diff --quiet || die "커밋되지 않은 tracked 변경이 있다 — 배포할 것만 커밋하고 다시 실행해라"
git diff --cached --quiet || die "스테이징된 변경이 남아 있다 — 커밋하고 다시 실행해라"
gh auth status >/dev/null 2>&1 || die "gh 로그인이 필요하다: gh auth login"

git fetch --quiet origin main
SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [[ "$SHA" != "$REMOTE_SHA" ]]; then
  echo "이번에 올라가는 커밋:"
  git --no-pager log --oneline origin/main..HEAD
  echo "바뀌는 파일:"
  git --no-pager diff --name-status origin/main..HEAD
  say "main push: ${SHA:0:7}"
  git push origin main

  say "저장소 Deploy 대기"
  find_run "$SHA" || die "${SHA:0:7}의 Deploy 실행을 ${DISCOVERY_TIMEOUT}초 안에 찾지 못했다"
  watch_run "$RUN_ID" || die "배포가 실패했다 (run #$RUN_ID) — Actions가 복구까지 처리한다"
  say "완료 — ${SHA:0:7}의 저장소 배포가 검증되었다"
  exit 0
fi

say "origin/main ${SHA:0:7}의 Deploy 확인"
if find_run "$SHA"; then
  EXISTING_RUN_IDS="$RUN_IDS_FOR_SHA"
  NEED_DISPATCH=0
  if [[ "$RUN_STATUS" == "completed" && "$RUN_CONCLUSION" != "success" ]]; then
    NEED_DISPATCH=1
  elif [[ "$RUN_STATUS" != "completed" ]] && ! watch_run "$RUN_ID"; then
    NEED_DISPATCH=1
  fi

  if [[ "$NEED_DISPATCH" == "0" ]]; then
    LIVE_SHA="$(live_commit || true)"
    if [[ "$LIVE_SHA" == "$SHA" ]]; then
      say "완료 — ${SHA:0:7}가 이미 라이브에서 검증되었다"
      exit 0
    fi
    if is_docs_only_run "$RUN_ID"; then
      say "완료 — 문서 전용 실행이라 배포가 생략되었다 (라이브 ${LIVE_SHA:0:7})"
      exit 0
    fi
    die "run #$RUN_ID는 성공했지만 라이브 커밋이 ${SHA:0:7}가 아니다 (실제: ${LIVE_SHA:-응답 없음})"
  fi
else
  EXISTING_RUN_IDS=""
fi

say "Deploy 수동 재실행: ${SHA:0:7}"
gh workflow run "$WORKFLOW" --ref main
find_run "$SHA" "$EXISTING_RUN_IDS" \
  || die "새 Deploy 실행을 ${DISCOVERY_TIMEOUT}초 안에 찾지 못했다"
watch_run "$RUN_ID" || die "재실행한 배포가 실패했다 (run #$RUN_ID) — Actions가 복구까지 처리한다"
say "완료 — ${SHA:0:7}의 저장소 배포가 검증되었다"
