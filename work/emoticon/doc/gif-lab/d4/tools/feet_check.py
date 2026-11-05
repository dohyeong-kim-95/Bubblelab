"""14 다리 검증(3×4 시트용 — loop/tools 의 foot_track·passing_zoom 은 4×6 전용). 지표로 합격을 정하지 않는다. 그림 두 장을 만든다.
1) track.png : 칸마다 초록(왼)발 위치(몸 가운데 기준 x, 바닥 기준 높이)를 러프·다듬기 두 곡선으로. 다듬기 곡선이 점프 없이 러프를 따라가야 한다.
2) legs.jpg  : 칸마다 하반신을 위(러프)·아래(다듬기)로 붙여 확대 — 무릎 굽힘·딛는 발·초록 양말이 같은 발인지 눈으로 본다.
사용: python3 feet_check.py rough_sheet.png clean_sheet.png out_dir [--rows 3 --cols 4]"""
import argparse, os
import numpy as np
from PIL import Image, ImageDraw
ap = argparse.ArgumentParser(); ap.add_argument("rough"); ap.add_argument("clean"); ap.add_argument("out")
ap.add_argument("--rows", type=int, default=3); ap.add_argument("--cols", type=int, default=4)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
N = a.rows * a.cols
def cells(path):
    S = Image.open(path).convert("RGB"); cw, ch = S.width // a.cols, S.height // a.rows
    return [S.crop(((i % a.cols) * cw, (i // a.cols) * ch, (i % a.cols + 1) * cw, (i // a.cols + 1) * ch)) for i in range(N)]
def measure(c):
    q = np.asarray(c).astype(int); R, G, B = q[..., 0], q[..., 1], q[..., 2]
    ink = q.min(2) < 235; ys, xs = np.where(ink); H = ys.max() - ys.min()
    green = ((G - np.maximum(R, B)) / np.maximum(G, 1) > 0.3) & (G > 60)
    cx = (xs.min() + xs.max()) / 2; floor = ys.max()
    if green.sum() < 15: return None, H
    gy, gx = np.where(green)
    return ((gx.mean() - cx) / H, (floor - gy.max()) / H), H     # 키로 나눈 값(크기 차 상쇄)
RC, CC = cells(a.rough), cells(a.clean)
mr = [measure(c)[0] for c in RC]; mc = [measure(c)[0] for c in CC]
W, Hh = 900, 520; g = Image.new("RGB", (W, Hh), "white"); d = ImageDraw.Draw(g)
def plot(vals, k, y0, color, label):
    pts = [(60 + i * (W - 100) / (N - 1), y0 - v[k] * 400) for i, v in enumerate(vals) if v]
    if len(pts) > 1: d.line(pts, fill=color, width=3)
    for p in pts: d.ellipse((p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4), fill=color)
    d.text((W - 200, y0 - 60 + (0 if color == (40, 40, 40) else 14)), label, fill=color)
for k, y0, name in ((0, 130, "green(L) foot x (body-centered)"), (1, 470, "green(L) foot height")):
    d.text((10, y0 - 120 if k == 0 else y0 - 200), name, fill="black"); d.line((50, y0, W - 30, y0), fill=(200, 200, 200))
    plot(mr, k, y0, (40, 40, 40), "rough"); plot(mc, k, y0, (0, 170, 0), "clean")
for i in range(N): d.text((56 + i * (W - 100) / (N - 1), Hh - 16), str(i + 1), fill="gray")
miss = [i + 1 for i, v in enumerate(mc) if v is None]
if miss: d.text((10, Hh - 34), f"clean: no green foot in cells {miss}", fill="red")
g.save(f"{a.out}/track.png")
z = 200; strip = Image.new("RGB", (N * z, 2 * z + 20), "white"); dd = ImageDraw.Draw(strip)
for i, (r, c) in enumerate(zip(RC, CC)):
    for row, im in ((0, r), (1, c)):
        q = np.asarray(im).min(2) < 235; ys, xs = np.where(q); y1 = ys.max(); x0, x1 = xs.min(), xs.max(); hgt = y1 - ys.min()
        box = (int((x0 + x1) / 2 - hgt * 0.42), int(y1 - hgt * 0.62), int((x0 + x1) / 2 + hgt * 0.42), int(y1 + hgt * 0.06))
        strip.paste(im.crop(box).resize((z, z)), (i * z, 20 + row * z))
    dd.text((i * z + 4, 3), f"#{i+1} rough/clean", fill="red")
strip.save(f"{a.out}/legs.jpg", quality=88)
print("ok", f"{a.out}/track.png", f"{a.out}/legs.jpg", "missing green:", miss)
