#!/bin/sh
# 아발론 소스 수정 후 실행: games/avalon 빌드 산출물을 갱신한다.
#   ./rebuild.sh && git add ../../games/avalon && git commit && git push
#
# base('/avalon/')와 카드 아이콘 이모지 주석은 소스(vite.config.js, index.html)에
# 들어 있다 — 여기서 덮어쓰지 않는다. CI가 검사하는 빌드와 운영 산출물이 같은
# 설정이어야 _infra/check-avalon-sync.mjs 의 동기화 검사가 의미를 갖는다.
set -e
cd "$(dirname "$0")"

npm ci
npx vite build

rm -rf ../../games/avalon
cp -r dist ../../games/avalon

echo "done → games/avalon"
