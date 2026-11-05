"""효과 부품(스티커에서 떼어 낸 음표·먼지 등)을 투명 프레임 시퀀스 위에 코드로 움직여 얹는다. 생성 없음.
위치는 스티커 안의 원래 자리(비율)를 프레임 크기에 옮긴 것이다.
사용: python3 fx_overlay.py frames_dir split_dir out_dir --float 11,12 [--puff 17,18 --puff-at 1,13]
  --float : 위로 떠오르며 좌우로 흔들리고 커졌다 작아지는 부품(음표·하트). 부품마다 시차.
  --puff  : --puff-at 칸(착지)에서 퐁 커졌다 사라지는 부품(먼지).
  --static: 움직이지 않고 원래 자리에 그대로 얹는 부품(duri판의 손글씨 글자). 'text' = 글자로 보이는 부품 자동 선택
            (어두운 무채색 + 스티커 위쪽 25% 안에서 시작).
  --twinkle: 제자리에서 커졌다 작아지며 살짝 도는 부품(반짝이·별·달), 부품마다 시차.
  --blink  : --blink-on 칸(주기 안 1-기반, 예 '1-6')에만 보이는 부품(동작선·충격선)."""
import argparse, glob, json, math, os
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument("frames"); ap.add_argument("split"); ap.add_argument("out")
ap.add_argument("--float", default=""); ap.add_argument("--static", default=""); ap.add_argument("--twinkle", default=""); ap.add_argument("--static-dy", type=float, default=0, help="--static 부품을 스티커 px 만큼 위(-)/아래(+)로 — 점프가 글자에 닿을 때"); ap.add_argument("--blink", default=""); ap.add_argument("--blink-on", default="1-6"); ap.add_argument("--puff", default=""); ap.add_argument("--puff-at", default="1,13")
ap.add_argument("--match-char", action="store_true", help="첫 칸 캐릭터 크기·자리를 스티커 속 캐릭터에 맞춰 효과를 원래 자리에(필요하면 프레임을 넓힌다)")
ap.add_argument("--period", type=int, default=0, help="효과 한 주기 칸 수(0=전체). 캐릭터가 12칸 주기면 12 — LINE 이 한 주기만 담아도 이어진다")
ap.add_argument("--rise", type=float, default=0.10, help="떠오르는 높이(프레임 높이 비율)")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
meta = json.load(open(f"{a.split}/parts.json")); SW, SH = meta["size"]; P = {p["id"]: p for p in meta["parts"]}
files = sorted(glob.glob(f"{a.frames}/*.png")); N = len(files)
F0 = Image.open(files[0]); FW, FH = F0.size; k = min(FW / SW, FH / SH) * 0.95
OX = OY = 0                                                   # 프레임을 넓힌 만큼의 여백(--match-char)
if a.match_char:
    # 스티커 안 캐릭터 범위(split/char.png)와 첫 칸 캐릭터 범위를 맞춘다(키 비율 + 아랫단·가로 가운데). 효과가 원래 자리(캐릭터 기준)에 온다.
    import numpy as _np
    def _bb(im): ys, xs = _np.where(_np.asarray(im.convert("RGBA"))[..., 3] > 60); return xs.min(), ys.min(), xs.max(), ys.max()
    sb = _bb(Image.open(f"{a.split}/char.png")); fb = _bb(F0)
    k = (fb[3] - fb[1]) / (sb[3] - sb[1])
    x0 = (fb[0] + fb[2]) / 2 - (sb[0] + sb[2]) / 2 * k; y0 = fb[3] - sb[3] * k   # 스티커 (0,0) 의 프레임 좌표
    L, T, R, B = min(0, x0), min(0, y0 + min(0, a.static_dy) * k), max(FW, x0 + SW * k), max(FH, y0 + SH * k)
    side = int(max(R - L, B - T)); OX, OY = int(-L + (side - (R - L)) / 2), int(-T + (side - (B - T)) / 2)
    FW = FH = side; _sx0, _sy0 = x0 + OX, y0 + OY
def part(pid): return Image.open(f"{a.split}/parts/{pid}.png").convert("RGBA"), P[pid]["box"]
floats = [part(p) for p in a.float.split(",") if p]; puffs = [part(p) for p in a.puff.split(",") if p]
def is_text(p):
    c = p["color"].lstrip("#"); r, g, b = (int(c[i:i + 2], 16) for i in (0, 2, 4))
    return max(r, g, b) < 130 and max(r, g, b) - min(r, g, b) < 20 and p["box"][1] < SH * 0.25
sids = [p["id"] for p in meta["parts"] if is_text(p)] if a.static == "text" else [x for x in a.static.split(",") if x]
statics = [part(p) for p in sids]
twinks = [part(p) for p in a.twinkle.split(",") if p]; blinks = [part(p) for p in a.blink.split(",") if p]
blink_on = set()
for r in a.blink_on.split(","):
    lo, _, hi = r.partition("-"); blink_on |= set(range(int(lo) - 1, int(hi or lo)))
puff_at = [int(x) - 1 for x in a.puff_at.split(",") if x]
ease = lambda t: 0.5 - 0.5 * math.cos(math.pi * max(0, min(1, t)))
def place(can, img, box, s, dx=0, dy=0, rot=0):
    w, h = img.size; im = img.resize((max(1, round(w * k * s)), max(1, round(h * k * s))), Image.LANCZOS)
    if rot: im = im.rotate(rot, expand=True, resample=Image.BICUBIC)
    if a.match_char: cx = _sx0 + (box[0] + box[2]) / 2 * k + dx; cy = _sy0 + (box[1] + box[3]) / 2 * k + dy
    else: cx = FW / 2 + ((box[0] + box[2]) / 2 - SW / 2) * k + dx; cy = FH / 2 + ((box[1] + box[3]) / 2 - SH / 2) * k + dy
    can.alpha_composite(im, (round(cx - im.width / 2), round(cy - im.height / 2)))
P_ = a.period or N
for i, f in enumerate(files):
    can = Image.new("RGBA", (FW, FH), (0, 0, 0, 0)); can.alpha_composite(Image.open(f).convert("RGBA"), (OX, OY))
    for img, box in statics: place(can, img, box, 1.0, dy=a.static_dy * k)
    for j, (img, box) in enumerate(twinks):
        t = (i % P_) / P_ + j / max(1, len(twinks)) * 0.5
        place(can, img, box, 0.95 + 0.2 * math.sin(2 * math.pi * 2 * t), rot=10 * math.sin(2 * math.pi * t))
    if i % P_ in blink_on:
        for img, box in blinks: place(can, img, box, 1.0 + 0.06 * ((i % P_) % 2))
    for j, (img, box) in enumerate(floats):                    # 한 주기에 한 번 떠올랐다 사라짐, 부품마다 반 주기 시차
        t = ((i % P_) / P_ + j / max(1, len(floats))) % 1
        s = 0.6 + 0.5 * ease(t / 0.3) - 1.1 * ease((t - 0.8) / 0.2)
        if s <= 0.05: continue
        place(can, img, box, s, dx=4 * math.sin(2 * math.pi * 2 * t), dy=-a.rise * FH * ease(t), rot=12 * math.sin(2 * math.pi * 2 * t + j))
    for img, box in puffs:                                     # 착지 칸부터 4칸 동안 퐁
        for c in puff_at:
            d = (i - c) % P_
            if d < 4: place(can, img, box, 0.5 + 0.25 * d, dy=-2 * d)
    can.save(f"{a.out}/{i+1:02d}.png")
print("ok", N, "frames", len(floats), "float", len(puffs), "puff", len(statics), "static", sids)
