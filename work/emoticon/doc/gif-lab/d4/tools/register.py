"""다듬기(CLEAN) 칸을 러프 칸 자리에 맞춘다. image_gen 은 칸마다 캐릭터를 조금씩 다른 자리에 그려서, 그대로 이으면 떨린다.
칸마다 그림 범위의 (가로 가운데, 아랫단)을 러프 같은 칸의 그것에 맞추고, 크기는 전체 칸 공통 배율 하나(키 중앙값 비)로 맞춘다.
- 흉상(01·07): 아랫단 = 가슴 잘린 선이라 고정, 가로 가운데는 러프처럼 팔·몸을 따라간다.
- 온몸(14): 아랫단 = 가장 낮은 발(바닥), 러프의 깡충 높이를 그대로 따른다.
--band: 가운데를 맞출 때 그림 범위 대신 아랫단 띠(아래 12%)의 가운데를 쓴다(팔이 크게 움직이는 흉상용).
사용: python3 register.py clean_cut_dir rough_frames_dir out_dir [--band]"""
import argparse, glob, os
import numpy as np
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument("clean"); ap.add_argument("rough"); ap.add_argument("out")
ap.add_argument("--band", action="store_true", help="가로 가운데를 아랫단 띠(아래 12%)로 잰다")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
C = [Image.open(f).convert("RGBA") for f in sorted(glob.glob(f"{a.clean}/*.png"))]
R = [Image.open(f).convert("RGB") for f in sorted(glob.glob(f"{a.rough}/*.png"))]
assert len(C) == len(R), (len(C), len(R))
def geo(mask):
    ys, xs = np.where(mask); y0, y1 = ys.min(), ys.max()
    if a.band:
        sel = ys > y1 - (y1 - y0) * 0.12; cx = (xs[sel].min() + xs[sel].max()) / 2
    else: cx = (xs.min() + xs.max()) / 2
    return cx, y1, y1 - y0
rg = [geo(np.asarray(r).min(2) < 235) for r in R]
cg = [geo(np.asarray(c)[..., 3] > 60) for c in C]
s = np.median([r[2] for r in rg]) / np.median([c[2] for c in cg])
W, H = R[0].size
for i, (c, (rcx, rby, _), (ccx, cby, _)) in enumerate(zip(C, rg, cg)):
    cs = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
    can = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    can.paste(cs, (round(rcx - ccx * s), round(rby - cby * s)), cs)
    can.save(f"{a.out}/{i+1:02d}.png")
print("ok", len(C), "칸, 배율", round(float(s), 3), "→", a.out)
