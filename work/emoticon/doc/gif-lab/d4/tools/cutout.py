"""흰 배경 프레임 → 투명 PNG. 다그당스 4(움직이는 이모티콘) 출력 단계 1.

사용:
  python3 cutout.py <in_dir | sheet.png[:RxC]> <out_dir> [--thresh 235] [--outline N] [--min-area 0]

- 배경 = 테두리에 닿은 흰색만(flood fill). 눈 흰자처럼 선으로 둘러싸인 안쪽 흰색은 남긴다.
- 가장자리는 안쪽 1px 페더(배경에 닿은 그림 픽셀만 반투명).
- --outline N : 그림 둘레에 N px 흰 테두리(스티커 화풍). 바깥 가장자리도 1px 페더.
- 시트 입력: RxC(행x열)를 주면 그 격자로, 없으면 흰 띠로 행·열 수를 세서 **똑같은 칸**으로 자른다.
- 정렬·크롭·크기 조정을 하지 않는다 — 모든 프레임이 같은 크기, 칸 안의 원래 위치 그대로.
- 출력: out_dir/01.png, 02.png, … (RGBA)
의존: numpy, Pillow. 이미지는 저장소에 두지 않는다(입출력은 저장소 밖 경로).
"""
import argparse
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

EXTS = {".png", ".jpg", ".jpeg", ".webp"}


# ---------- 입력 ----------
def parse_src(src):
    m = re.match(r"^(.*?):(\d+)x(\d+)$", src)
    if m:
        return Path(m.group(1)), (int(m.group(2)), int(m.group(3)))
    return Path(src), None


def count_bands(nonwhite_1d, min_gap):
    """그림이 있는 줄(True)의 덩어리 수. min_gap 보다 짧은 흰 틈은 덩어리 안으로 본다."""
    bands, run, inside = 0, 0, False
    for v in nonwhite_1d:
        if v:
            if not inside:
                bands += 1
                inside = True
            run = 0
        else:
            run += 1
            if inside and run >= min_gap:
                inside = False
    return bands


def auto_grid(rgb, thresh):
    nonwhite = rgb.min(axis=2) < thresh
    h, w = nonwhite.shape
    rows = count_bands(nonwhite.any(axis=1), max(4, h // 100))
    cols = count_bands(nonwhite.any(axis=0), max(4, w // 100))
    return rows, cols


def slice_sheet(path, grid, thresh):
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    if grid is None:
        grid = auto_grid(rgb, thresh)
        print(f"격자 자동: {grid[0]}x{grid[1]}", file=sys.stderr)
    rows, cols = grid
    h, w = rgb.shape[:2]
    if h % rows or w % cols:
        print(f"경고: {w}x{h} 가 {rows}x{cols} 로 나누어떨어지지 않음 — 칸 크기를 내림", file=sys.stderr)
    ch, cw = h // rows, w // cols
    return [rgb[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] for r in range(rows) for c in range(cols)]


def load_dir(d):
    files = sorted(p for p in d.iterdir() if p.suffix.lower() in EXTS)
    if not files:
        sys.exit(f"{d}: 이미지 없음")
    out = []
    for p in files:
        im = Image.open(p)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            im = Image.alpha_composite(bg, im)
        out.append(np.asarray(im.convert("RGB")))
    sizes = {a.shape[:2] for a in out}
    if len(sizes) > 1:
        print(f"경고: 프레임 크기가 서로 다름 {sizes} — 그대로 둔다", file=sys.stderr)
    return out


# ---------- 마스크 연산(scipy 없이) ----------
def shift_or(m, dy, dx):
    """m 을 (dy,dx) 만큼 민 것(밖은 False)."""
    h, w = m.shape
    out = np.zeros_like(m)
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = m[ys, xs]
    return out


def dilate4(m):
    return m | shift_or(m, 1, 0) | shift_or(m, -1, 0) | shift_or(m, 0, 1) | shift_or(m, 0, -1)


def flood_border(white):
    """테두리에 닿은 white 영역(4-연결)."""
    seed = np.zeros_like(white)
    seed[0, :] = white[0, :]
    seed[-1, :] = white[-1, :]
    seed[:, 0] = white[:, 0]
    seed[:, -1] = white[:, -1]
    reach = seed
    while True:
        nxt = dilate4(reach) & white
        if (nxt == reach).all():
            return reach
        reach = nxt


def box3(m):
    """3x3 평균(밖은 0으로 본다)."""
    f = m.astype(np.float32)
    acc = np.zeros_like(f)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            acc += shift_or(f, dy, dx) if (dy or dx) else f
    return acc / 9.0


def disk_dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if (dy or dx) and dy * dy + dx * dx <= r * r + r:  # +r : 작은 반지름에서 덜 각지게
                out |= shift_or(m, dy, dx)
    return out


def feather(mask):
    """안쪽 1px 페더: 배경에 닿은 가장자리만 반투명, 안쪽은 1."""
    a = np.clip(box3(mask) * 2.0 - 0.5, 0.0, 1.0)
    return np.where(mask, a, 0.0)


def components(mask):
    """8-연결 라벨(최대 라벨 전파). 반환: 라벨 배열(0=배경)."""
    h, w = mask.shape
    lab = np.where(mask, np.arange(1, h * w + 1, dtype=np.int64).reshape(h, w), 0)
    while True:
        nb = lab.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    nb = np.maximum(nb, shift_or(lab, dy, dx))
        nb = np.where(mask, nb, 0)
        if (nb == lab).all():
            return lab
        lab = nb


# ---------- 누끼 ----------
def cutout(rgb, thresh=235, outline=0, min_area=0):
    white = rgb.min(axis=2) >= thresh
    bg = flood_border(white)
    fg = ~bg
    specks = 0
    if min_area > 0:
        lab = components(fg)
        ids, counts = np.unique(lab[lab > 0], return_counts=True)
        small = ids[counts < min_area]
        specks = len(small)
        if specks:
            fg &= ~np.isin(lab, small)
    a_fg = feather(fg)
    out = np.zeros(rgb.shape[:2] + (4,), np.float32)
    if outline > 0:
        ring = disk_dilate(fg, outline)
        a_ring = feather(ring)
        out[..., :3] = 255.0
        out[..., 3] = a_ring
    # 그림을 흰 테두리 위에 얹는다(over)
    src_a = a_fg[..., None]
    dst_a = out[..., 3:4]
    out_a = src_a + dst_a * (1 - src_a)
    col = (rgb.astype(np.float32) * src_a + out[..., :3] * dst_a * (1 - src_a)) / np.maximum(out_a, 1e-6)
    out[..., :3] = col
    out[..., 3:4] = out_a
    touches = bool(fg[0].any() or fg[-1].any() or fg[:, 0].any() or fg[:, -1].any())
    res = np.clip(out.round(), 0, 255).astype(np.uint8)
    res[..., 3] = np.clip((out[..., 3] * 255).round(), 0, 255).astype(np.uint8)
    res[res[..., 3] == 0, :3] = 0
    return res, {"fg_px": int(fg.sum()), "touches_edge": touches, "specks_removed": specks}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="프레임 폴더 또는 sheet.png[:RxC] (행x열)")
    ap.add_argument("out_dir")
    ap.add_argument("--thresh", type=int, default=235, help="흰색 판정: RGB 최솟값 ≥ 이 값 (기본 235)")
    ap.add_argument("--outline", type=int, default=0, help="흰 테두리 두께 px (0=없음)")
    ap.add_argument("--min-area", type=int, default=0, help="이보다 작은 떨어진 조각(먼지)을 지운다 (0=끔)")
    a = ap.parse_args()

    path, grid = parse_src(a.src)
    frames = load_dir(path) if path.is_dir() else slice_sheet(path, grid, a.thresh)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("[0-9][0-9].png"):
        old.unlink()
    for i, rgb in enumerate(frames, 1):
        res, info = cutout(rgb, a.thresh, a.outline, a.min_area)
        Image.fromarray(res, "RGBA").save(out / f"{i:02d}.png", optimize=True)
        warn = "  ⚠ 그림이 칸 가장자리에 닿음" if info["touches_edge"] else ""
        sp = f" 먼지 {info['specks_removed']}개 제거" if info["specks_removed"] else ""
        print(f"{i:02d}.png {res.shape[1]}x{res.shape[0]} 그림 {info['fg_px']}px{sp}{warn}")
    print(f"→ {out} ({len(frames)}장)")


if __name__ == "__main__":
    main()
