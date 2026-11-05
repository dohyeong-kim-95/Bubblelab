"""효과 부품(스티커에서 떼어 낸 음표·먼지 등)을 투명 프레임 시퀀스 위에 코드로 움직여 얹는다. 생성 없음.
위치는 스티커 안의 원래 자리(비율)를 프레임 크기에 옮긴 것이다.
사용: python3 fx_overlay.py frames_dir split_dir out_dir --float 11,12 [--puff 17,18 --puff-at 1,13]
  --float : 위로 떠오르며 좌우로 흔들리고 커졌다 작아지는 부품(음표·하트). 부품마다 시차.
  --puff  : --puff-at 칸(착지)에서 퐁 커졌다 사라지는 부품(먼지)."""
import argparse, glob, json, math, os
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument("frames"); ap.add_argument("split"); ap.add_argument("out")
ap.add_argument("--float", default=""); ap.add_argument("--puff", default=""); ap.add_argument("--puff-at", default="1,13")
ap.add_argument("--rise", type=float, default=0.10, help="떠오르는 높이(프레임 높이 비율)")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
meta = json.load(open(f"{a.split}/parts.json")); SW, SH = meta["size"]; P = {p["id"]: p for p in meta["parts"]}
files = sorted(glob.glob(f"{a.frames}/*.png")); N = len(files)
F0 = Image.open(files[0]); FW, FH = F0.size; k = min(FW / SW, FH / SH) * 0.95
def part(pid): return Image.open(f"{a.split}/parts/{pid}.png").convert("RGBA"), P[pid]["box"]
floats = [part(p) for p in a.float.split(",") if p]; puffs = [part(p) for p in a.puff.split(",") if p]
puff_at = [int(x) - 1 for x in a.puff_at.split(",") if x]
ease = lambda t: 0.5 - 0.5 * math.cos(math.pi * max(0, min(1, t)))
def place(can, img, box, s, dx=0, dy=0, rot=0):
    w, h = img.size; im = img.resize((max(1, round(w * k * s)), max(1, round(h * k * s))), Image.LANCZOS)
    if rot: im = im.rotate(rot, expand=True, resample=Image.BICUBIC)
    cx = FW / 2 + ((box[0] + box[2]) / 2 - SW / 2) * k + dx; cy = FH / 2 + ((box[1] + box[3]) / 2 - SH / 2) * k + dy
    can.alpha_composite(im, (round(cx - im.width / 2), round(cy - im.height / 2)))
for i, f in enumerate(files):
    can = Image.open(f).convert("RGBA")
    for j, (img, box) in enumerate(floats):                    # 한 주기에 한 번 떠올랐다 사라짐, 부품마다 반 주기 시차
        t = (i / N + j / max(1, len(floats))) % 1
        s = 0.6 + 0.5 * ease(t / 0.3) - 1.1 * ease((t - 0.8) / 0.2)
        if s <= 0.05: continue
        place(can, img, box, s, dx=4 * math.sin(2 * math.pi * 2 * t), dy=-a.rise * FH * ease(t), rot=12 * math.sin(2 * math.pi * 2 * t + j))
    for img, box in puffs:                                     # 착지 칸부터 4칸 동안 퐁
        for c in puff_at:
            d = (i - c) % N
            if d < 4: place(can, img, box, 0.5 + 0.25 * d, dy=-2 * d)
    can.save(f"{a.out}/{i+1:02d}.png")
print("ok", N, "frames", len(floats), "float", len(puffs), "puff")
