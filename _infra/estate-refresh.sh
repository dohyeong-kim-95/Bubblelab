#!/usr/bin/env bash
# estate 실거래 데이터 원클릭 갱신: 수집 → 지오코딩 → 커밋 → 푸시.
# 한국 IP인 로컬에서 돌린다 (국토부 RTMS는 해외 IP를 차단). 키는 .dev.vars의
# MOLIT_SERVICE_KEY / VWORLD_KEY에서 읽으며, 이 파일은 .gitignore라 커밋되지 않는다.
#
#   bash _infra/estate-refresh.sh            # 실거래 최근 3개월 + 신규 단지 좌표
#   bash _infra/estate-refresh.sh --basemap  # 배경지도 스냅샷까지 재생성
#
# 변경이 없으면 커밋·푸시를 건너뛴다. 주기 갱신은 주 1회면 충분하다.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! grep -qE '^MOLIT_SERVICE_KEY=.' .dev.vars 2>/dev/null; then
  echo "✗ .dev.vars에 MOLIT_SERVICE_KEY가 없습니다."
  echo "  echo 'MOLIT_SERVICE_KEY=발급키' >> .dev.vars  (data.go.kr 실거래가 인증키)"
  exit 1
fi

echo "▶ 실거래 수집 (최근 3개월 재수집)…"
node _infra/estate-import.mjs

echo "▶ 신규 단지 지오코딩…"
node _infra/estate-geocode.mjs

if [[ "${1:-}" == "--basemap" ]]; then
  echo "▶ 배경지도 스냅샷 재생성…"
  node _infra/estate-basemap.mjs
fi

echo "▶ 빌드 검증…"
node _infra/build.mjs >/dev/null

# 실질 변경(실거래 파일·배경지도)만으로 판정한다. geo.json/index.json/basemap.json은
# generatedAt 타임스탬프가 매번 바뀌므로, 실거래 변경이 없으면 이 노이즈를 되돌린다.
if git diff --quiet -- 'estate/data/trade-*.json' 'estate/data/rent-*.json' 'estate/basemap-*.png'; then
  git checkout -- estate/ 2>/dev/null || true
  echo "✓ 새 신고분 없음 — 커밋·푸시 생략."
  exit 0
fi

git add estate/
git commit -q -m "estate: 실거래 데이터 갱신 ($(date +%Y-%m-%d))"
git push origin main
echo "✓ 커밋·푸시 완료. GitHub Actions 배포 후(~1분) estate.bubblelab.dev에 반영됩니다."
