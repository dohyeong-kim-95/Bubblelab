# art/2-15.png 의 아날로그 시계(5시 59분이 아님)를 지우고 17:59 디지털 시계를 말 뒤에 깐다 → art/2-15d.png
# usage: python3 _src/dageudangs/clock.py   (Pillow·numpy·scipy 필요)
# 그림은 저장소에 없다 — DGD_TOON(기본 ~/dageudangs-lab/toon)/_src/dageudangs/art 에서 읽고 쓴다.
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

ART = Path(os.environ.get("DGD_TOON", Path.home() / "dageudangs-lab" / "toon")).expanduser() / "_src" / "dageudangs" / "art"
a = np.asarray(Image.open(ART / "2-15.png").convert("RGBA")).astype(int)
H, W = a.shape[:2]
yy, xx = np.mgrid[:H, :W]
r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]

# 시계 원(흰 외곽선 포함) 안에서 말(갈색 덩어리 + 그 외곽선)만 남기고 지운다
circle = (xx - 680) ** 2 + (yy - 383) ** 2 <= 200 ** 2
brown = (r - b > 30) & (np.maximum(np.maximum(r, g), b) < 215) & (al > 128)
lab, n = nd.label(brown)
sizes = nd.sum(brown, lab, range(1, n + 1))
horse = nd.binary_dilation(np.isin(lab, 1 + np.nonzero(sizes > 3000)[0]), iterations=7)
out = a.copy()
out[circle & ~horse, 3] = 0
art = Image.fromarray(out.astype(np.uint8), "RGBA")

clk = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(clk)
x0, y0, x1, y1 = 520, 250, 858, 470
d.rounded_rectangle((x0 - 10, y0 - 10, x1 + 10, y1 + 32), 40, fill="white")
d.rounded_rectangle((x0, y0, x1, y1), 32, fill="#f4a64a", outline="#2a2620", width=8)
sx0, sy0, sx1, sy1 = x0 + 30, y0 + 30, x1 - 30, y1 - 30
d.rounded_rectangle((sx0, sy0, sx1, sy1), 16, fill="#26302b", outline="#2a2620", width=5)
for fx in (x0 + 60, x1 - 60):
    d.rounded_rectangle((fx - 22, y1 - 2, fx + 22, y1 + 22), 8, fill="#2a2620")

ON, OFF = "#ff5a3c", "#2d3832"
SEG = {"1": "bc", "5": "afgcd", "7": "abc", "9": "abcdfg"}


def digit(ch, x, y, w, h, t):
    segs = {"a": (x + t, y, x + w - t, y + t), "g": (x + t, y + h // 2 - t // 2, x + w - t, y + h // 2 + t // 2),
            "d": (x + t, y + h - t, x + w - t, y + h),
            "f": (x, y + t, x + t, y + h // 2 - t // 2), "b": (x + w - t, y + t, x + w, y + h // 2 - t // 2),
            "e": (x, y + h // 2 + t // 2, x + t, y + h - t), "c": (x + w - t, y + h // 2 + t // 2, x + w, y + h - t)}
    for k, box in segs.items():
        d.rounded_rectangle(box, t // 2, fill=ON if k in SEG[ch] else OFF)


dw, dh, t, gap, colon = 50, 108, 13, 16, 26
x = (sx0 + sx1) // 2 - (4 * dw + 3 * gap + colon) // 2
y = (sy0 + sy1) // 2 - dh // 2
for i, ch in enumerate("1759"):
    digit(ch, x, y, dw, dh, t)
    x += dw + gap
    if i == 1:
        cx = x + colon // 2 - gap // 2
        for cy in (y + dh // 3, y + 2 * dh // 3):
            d.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=ON)
        x += colon
clk.alpha_composite(art)
clk.save(ART / "2-15d.png")
