#!/usr/bin/env bash
# 아이폰(WebKit) e2e 를 sudo 없이 돌리기 위한 시스템 라이브러리. Playwright 의 WebKit 은
# libavif16 을 시스템에서 찾는데, 데스크톱 배포판엔 없는 경우가 많다. apt 패키지를 내려받기만
# 하고(설치 아님) .cache/webkit-libs/root 에 풀어 둔다 — git 에 올라가지 않는다(.gitignore).
# playwright.config.mjs 의 iphone 프로젝트가 이 경로를 LD_LIBRARY_PATH 로 쓴다.
#   bash scripts/webkit-libs.sh && PLAYWRIGHT_IOS=1 npx playwright test --project=iphone
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=.cache/webkit-libs
mkdir -p "$DIR/deb"
cd "$DIR/deb"
for pkg in libavif16 libgav1-1 libyuv0; do
  dpkg -s "$pkg" >/dev/null 2>&1 && continue          # 시스템에 이미 있으면 받지 않는다
  ls "${pkg%%[0-9]*}"*.deb >/dev/null 2>&1 || apt-get download "$pkg"
done
cd ..
for deb in deb/*.deb; do [ -e "$deb" ] && dpkg -x "$deb" root; done
echo "WebKit 라이브러리: $(pwd)/root/usr/lib/x86_64-linux-gnu"
