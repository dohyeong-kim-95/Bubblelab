#!/usr/bin/env bash
# make ship — 빌드 → 테스트 → 배포 → 라이브 검증 → (실패하면) 롤백.
#
# 이 리포의 배포는 "main 에 push → GitHub Actions → wrangler deploy" 다. 그래서
# 배포는 push, 롤백은 revert push 다(로컬에 Cloudflare 토큰을 두지 않는다).
# 검증은 scripts/verify-prod.sh — 프로덕션에 쓰지 않고 읽기만 한다.
#
# 환경변수:
#   SHIP_ROLLBACK=0   검증 실패해도 되돌리지 않는다 (직접 판단하고 싶을 때)
#   SHIP_E2E=1        푸시 전에 로컬에서 모바일 스모크(Playwright)까지 돌린다
#   SHIP_DEPLOY_TIMEOUT=1200   Actions 완료 대기 상한(초)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ROLLBACK="${SHIP_ROLLBACK:-1}"
DEPLOY_TIMEOUT="${SHIP_DEPLOY_TIMEOUT:-1200}"
REPORT="${TMPDIR:-/tmp}/bubblelab-verify.json"

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

served_commit() {
  curl -fsS --max-time 20 "https://bubblelab.dev/_health" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).commit??"")}catch{}})' \
    || true
}

# ── 0. 프리플라이트 ───────────────────────────────────────────────────────
say "프리플라이트"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || die "main 브랜치에서만 배포한다 (지금: $(git rev-parse --abbrev-ref HEAD))"
git diff --quiet || die "커밋되지 않은 변경이 있다 — 배포할 것만 커밋하고 다시 실행해라"
git diff --cached --quiet || die "스테이징된 변경이 남아 있다 — 커밋하고 다시 실행해라"
command -v gh >/dev/null || die "gh CLI 가 필요하다 (Actions 배포 결과를 확인한다)"
gh auth status >/dev/null 2>&1 || die "gh 로그인이 필요하다: gh auth login"

# 작업 트리를 여러 세션이 공유한다 — 남의 변경을 같이 밀어버리지 않도록
# 무엇이 올라가는지 먼저 보여준다.
git fetch --quiet origin main
if ! git diff --quiet origin/main..HEAD; then
  echo "이번에 올라가는 커밋:"
  git --no-pager log --oneline origin/main..HEAD
  echo "바뀌는 파일:"
  git --no-pager diff --name-status origin/main..HEAD
fi

# ── 1. 빌드 · 테스트 ──────────────────────────────────────────────────────
say "테스트"
npm test

say "빌드"
node _infra/build.mjs
node _infra/check-avalon-sync.mjs

if [[ "${SHIP_E2E:-0}" == "1" ]]; then
  say "모바일 스모크"
  npm run test:e2e
fi

# ── 2. 배포 (push → Actions) ──────────────────────────────────────────────
SHA="$(git rev-parse HEAD)"
PREV_SERVED="$(served_commit)"
[[ -n "$PREV_SERVED" ]] || PREV_SERVED="$(git rev-parse origin/main)"
say "배포: ${SHA:0:7} (지금 서빙 중: ${PREV_SERVED:0:7})"

if [[ "$SHA" == "$(git rev-parse origin/main)" ]]; then
  echo "origin/main 이 이미 이 커밋이다 — push 를 건너뛰고 검증만 한다"
else
  git push origin main
fi

# ── 3. Actions 완료 대기 ─────────────────────────────────────────────────
say "Deploy 워크플로 대기"
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID="$(gh run list --workflow deploy.yml -b main -L 20 \
    --json headSha,databaseId --jq "[.[] | select(.headSha==\"$SHA\")][0].databaseId" 2>/dev/null || true)"
  [[ -n "$RUN_ID" && "$RUN_ID" != "null" ]] && break
  sleep 5
done
if [[ -z "$RUN_ID" || "$RUN_ID" == "null" ]]; then
  die "이 커밋의 Deploy 런을 찾지 못했다 — Actions 탭을 확인해라"
fi
echo "run #$RUN_ID"
if ! timeout "$DEPLOY_TIMEOUT" gh run watch "$RUN_ID" --exit-status >/dev/null; then
  gh run view "$RUN_ID" --log-failed | tail -40 || true
  die "배포가 실패했다 (run #$RUN_ID) — 라이브는 아직 ${PREV_SERVED:0:7} 이다"
fi

# ── 4. 라이브 검증 ───────────────────────────────────────────────────────
say "라이브 검증 (읽기 전용)"
set +e
bash scripts/verify-prod.sh --commit "$SHA" --wait 180
VERIFY=$?
bash scripts/verify-prod.sh --commit "$SHA" --json > "$REPORT" 2>/dev/null
set -e

if [[ $VERIFY -eq 0 ]]; then
  say "완료 — ${SHA:0:7} 가 라이브에서 검증되었다"
  exit 0
fi

# ── 5. 실패 → 기대값·실제값 diff 후 롤백 ─────────────────────────────────
printf '\n\033[31m✗ 검증 실패 — 기대값 vs 실제값\033[0m\n'
node -e '
const report = require(process.argv[1]);
for (const result of report.results.filter((r) => r.state === "FAIL")) {
  console.log(`\n[${result.id}] ${result.title}${result.note ? ` — ${result.note}` : ""}`);
  for (const failure of result.failures) {
    console.log(`  ${failure.at}`);
    console.log(`    - 기대: ${failure.expected}`);
    console.log(`    + 실제: ${failure.actual}`);
  }
}
' "$REPORT" || true

if [[ "$ROLLBACK" != "1" ]]; then
  die "SHIP_ROLLBACK=0 이라 되돌리지 않았다 — 라이브는 ${SHA:0:7} 그대로다"
fi

say "롤백: ${PREV_SERVED:0:7} 상태로 되돌린다"
git revert --no-edit --no-commit "${PREV_SERVED}..${SHA}"
git commit -m "revert: ${SHA:0:7} 라이브 검증 실패로 되돌림

verify-prod 가 실패해서 배포 직전 상태(${PREV_SERVED:0:7})로 되돌립니다.
실패 내역: $REPORT"
git push origin main
REVERT_SHA="$(git rev-parse HEAD)"

for _ in $(seq 1 30); do
  RUN_ID="$(gh run list --workflow deploy.yml -b main -L 20 \
    --json headSha,databaseId --jq "[.[] | select(.headSha==\"$REVERT_SHA\")][0].databaseId" 2>/dev/null || true)"
  [[ -n "$RUN_ID" && "$RUN_ID" != "null" ]] && break
  sleep 5
done
timeout "$DEPLOY_TIMEOUT" gh run watch "$RUN_ID" --exit-status >/dev/null \
  || die "롤백 배포까지 실패했다 — 직접 확인이 필요하다 (run #$RUN_ID)"

say "롤백 검증"
bash scripts/verify-prod.sh --commit "$REVERT_SHA" --wait 180 \
  || die "되돌린 뒤에도 검증이 실패한다 — 라이브가 정상이 아니다"

die "배포는 되돌렸다. 위의 기대값·실제값 diff 를 보고 고친 뒤 다시 make ship 해라"
