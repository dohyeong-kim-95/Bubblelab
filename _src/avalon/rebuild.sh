#!/bin/sh
# 아발론 소스 수정 후 실행: games/avalon 빌드 산출물을 갱신한다.
#   ./rebuild.sh && git add ../../games/avalon && git commit && git push
set -e
cd "$(dirname "$0")"

npm ci
npx vite build --base=/avalon/

rm -rf ../../games/avalon
cp -r dist ../../games/avalon

# games.bubblelab.dev 카드 그리드 아이콘용 이모지 주석
sed -i 's|<head>|<head>\n  <!-- ⚔️ card icon for games.bubblelab.dev -->|' \
  ../../games/avalon/index.html

echo "done → games/avalon"
