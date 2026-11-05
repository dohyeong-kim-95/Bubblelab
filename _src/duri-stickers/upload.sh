#!/usr/bin/env bash
# 비공개 스티커(다그당스 등)를 R2 DURI_BUCKET 의 stickers/ 접두사로 올린다.
# 워커는 /_duri/sticker/<팩>/<NN|preview>.png 를 bl_duri 게이트 뒤에서만 내준다.
# 원본은 저장소가 아니라 로컬 ~/dageudangs-lab/stickers/<팩>/ 에 둔다 (README.md).
#
#   bash _src/duri-stickers/upload.sh                 # 원본 폴더의 팩 전부
#   bash _src/duri-stickers/upload.sh dageudangseu-3  # 팩 하나(여러 개 가능)
#   bash _src/duri-stickers/upload.sh --dry-run       # 올릴 목록만 출력
#
# 필요: npx wrangler login 이 살아 있어야 한다. 같은 키에 다시 올리면 덮어쓴다 —
# 같은 이름으로 다시 그렸다면 duri/index.html DURI_ONLY_PACKS 의 rev 를 올려야 폰 캐시(7일)를 넘긴다.
set -euo pipefail

SRC="${DURI_STICKER_SRC:-$HOME/dageudangs-lab/stickers}"
BUCKET="${DURI_STICKER_BUCKET:-bubblelab-duri}" # wrangler.jsonc 의 DURI_BUCKET
DRY=0
packs=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) echo "모르는 옵션: $arg" >&2; exit 2 ;;
    *) packs+=("$arg") ;;
  esac
done

[ -d "$SRC" ] || { echo "원본 폴더가 없습니다: $SRC" >&2; exit 1; }
if [ ${#packs[@]} -eq 0 ]; then
  for d in "$SRC"/*/; do packs+=("$(basename "$d")"); done
fi

# 워커 라우트(_infra/worker.js DURI_STICKER_PATH)와 같은 규칙 — 어긋나면 올려도 못 받는다.
pack_re='^[a-z0-9]+(-[a-z0-9]+)*$'
file_re='^([0-9]{2}|preview)\.png$'

files=()
for pack in "${packs[@]}"; do
  [[ "$pack" =~ $pack_re ]] || { echo "팩 이름 규칙 위반: $pack" >&2; exit 1; }
  dir="$SRC/$pack"
  [ -d "$dir" ] || { echo "팩 폴더가 없습니다: $dir" >&2; exit 1; }
  n=0
  for f in "$dir"/*.png; do
    name="$(basename "$f")"
    if [[ "$name" =~ $file_re ]]; then files+=("$pack/$name"); n=$((n + 1))
    else echo "  건너뜀(이름 규칙 밖): $pack/$name" >&2; fi
  done
  [ "$n" -gt 0 ] || { echo "PNG 가 없습니다: $dir" >&2; exit 1; }
done

echo "버킷 $BUCKET 에 ${#files[@]}개 → stickers/…"
for rel in "${files[@]}"; do
  key="stickers/$rel"
  if [ "$DRY" -eq 1 ]; then echo "  $key"; continue; fi
  npx --yes wrangler@4 r2 object put "$BUCKET/$key" --file "$SRC/$rel" \
    --content-type image/png --remote >/dev/null
  echo "  ✓ $key"
done
[ "$DRY" -eq 1 ] || echo "끝. 확인: duri 앱에서 스티커 서랍을 열거나, 로그인 쿠키로 /_duri/sticker/<팩>/01.png 를 받아 본다."
