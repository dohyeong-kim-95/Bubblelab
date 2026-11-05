"""스프라이트 시트 → 프레임 PNG.
  python3 slice.py 시트.png 출력폴더 --rows 2 --cols 2      # 균등 격자
  python3 slice.py 시트.png 출력폴더                          # 흰 여백으로 자동 감지(행→열)
옵션: --order rows|cols(읽는 순서, 기본 좌→우 위→아래) --inset N(격자 경계선 깎기 px)
      --cutout(흰 배경 누끼) --trim(내용 bbox 로 자르기) --min-gap N(자동: 여백 최소 폭)
"""
import argparse, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from common import cutout_white


def runs(profile, min_gap, min_len):
    """profile(True=내용) 에서 내용 구간들. min_gap 미만의 빈틈은 이어 붙인다."""
    segs, start, gap = [], None, 0
    for i, v in enumerate(profile):
        if v:
            if start is None: start = i
            gap = 0; end = i + 1
        elif start is not None:
            gap += 1
            if gap >= min_gap: segs.append((start, end)); start = None
    if start is not None: segs.append((start, end))
    return [s for s in segs if s[1] - s[0] >= min_len]


def content_mask(im, thresh):
    a = np.asarray(im.convert("RGBA"))
    return (a[..., 3] > 16) & ~(a[..., :3] >= thresh).all(-1)


def auto_cells(im, thresh, min_gap):
    m = content_mask(im, thresh)
    min_len = max(8, min(im.size) // 30)
    cells = []
    for y0, y1 in runs(m.any(1), min_gap, min_len):
        for x0, x1 in runs(m[y0:y1].any(0), min_gap, min_len):
            cells.append((x0, y0, x1, y1))
    return cells


def grid_cells(im, rows, cols, order):
    W, H = im.size
    cw, ch = W / cols, H / rows
    idx = [(r, c) for r in range(rows) for c in range(cols)] if order == "rows" \
        else [(r, c) for c in range(cols) for r in range(rows)]
    return [(round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch)) for r, c in idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet"); ap.add_argument("out")
    ap.add_argument("--rows", type=int); ap.add_argument("--cols", type=int)
    ap.add_argument("--order", choices=["rows", "cols"], default="rows")
    ap.add_argument("--inset", type=int, default=0)
    ap.add_argument("--cutout", action="store_true")
    ap.add_argument("--trim", action="store_true")
    ap.add_argument("--thresh", type=int, default=240, help="이 값 이상 RGB 는 흰 여백으로 본다")
    ap.add_argument("--min-gap", type=int, default=6)
    ap.add_argument("--pad", type=int, default=4, help="자동 감지 칸에 둘 여유 px")
    a = ap.parse_args()

    im = Image.open(a.sheet).convert("RGBA")
    if a.rows and a.cols:
        cells = grid_cells(im, a.rows, a.cols, a.order)
    else:
        cells = auto_cells(im, a.thresh, a.min_gap)
        cells = [(max(0, x0 - a.pad), max(0, y0 - a.pad), min(im.width, x1 + a.pad), min(im.height, y1 + a.pad))
                 for x0, y0, x1, y1 in cells]
        if a.order == "cols": cells.sort(key=lambda c: (c[0], c[1]))
    os.makedirs(a.out, exist_ok=True)
    for i, (x0, y0, x1, y1) in enumerate(cells):
        f = im.crop((x0 + a.inset, y0 + a.inset, x1 - a.inset, y1 - a.inset))
        if a.cutout: f = cutout_white(f, a.thresh)
        if a.trim:
            bb = f.getbbox() if a.cutout else Image.fromarray(content_mask(f, a.thresh).astype(np.uint8) * 255).getbbox()
            if bb: f = f.crop(bb)
        f.save(os.path.join(a.out, f"f{i:02d}.png"))
        print(f"f{i:02d}.png  {x0},{y0}-{x1},{y1}  {f.size[0]}x{f.size[1]}")
    print(f"{len(cells)} frames → {a.out}")


if __name__ == "__main__":
    main()
