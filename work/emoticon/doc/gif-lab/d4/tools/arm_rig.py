"""01 안뇽~ — 부품 리그(팔 흔들기). image_gen 이 그린 '든 팔을 뗀 몸 + 곧게 선 팔' 부품 시트에서
팔을 어깨 축(팔 아래 둥근 끝의 중심)으로 돌려 24칸을 만든다. 몸은 팔과 반대로 아주 살짝 흔든다.
팔은 몸 뒤에 그린다(어깨 이음매를 몸이 덮는다). 출력: 흰 바탕 4x6 러프 시트 + 칸 PNG + ms.json.
사용: python3 arm_rig.py parts.png out_dir --pivot X,Y --rest DEG [--amp 18] [--size 360]"""
import argparse, json, math, os
import numpy as np
from PIL import Image, ImageOps
ap = argparse.ArgumentParser(); ap.add_argument("parts"); ap.add_argument("out")
ap.add_argument("--pivot", required=True, help="몸 부품 좌표(부품 시트 기준)의 어깨 축")
ap.add_argument("--rest", type=float, required=True, help="팔 기본 기울기(도, + = 위끝이 왼쪽으로)")
ap.add_argument("--amp", type=float, default=18, help="흔드는 폭(도, ±)"); ap.add_argument("--sway", type=float, default=1.5)
ap.add_argument("--size", type=int, default=360)
a = ap.parse_args(); os.makedirs(f"{a.out}/frames", exist_ok=True)
P = ImageOps.expand(Image.open(a.parts).convert("RGB"), 400, fill="white"); rgb = np.asarray(P).astype(float)
alpha = np.clip((250 - rgb.min(2)) * 6, 0, 255); m = alpha > 60
cols = np.where(m.any(0))[0]; runs, s, p = [], cols[0], cols[0]
for x in cols[1:]:
    if x > p + 8: runs.append((s, p)); s = x
    p = x
runs.append((s, p)); assert len(runs) == 2, runs
def sprite(x0, x1):
    ys = np.where(m[:, x0:x1 + 1].any(1))[0]; y0, y1 = ys.min(), ys.max()
    return Image.fromarray(np.dstack([rgb[y0:y1 + 1, x0:x1 + 1], alpha[y0:y1 + 1, x0:x1 + 1]]).astype(np.uint8), "RGBA"), (x0, y0)
body, (bx, by) = sprite(*runs[0]); arm, _ = sprite(*runs[1])
px, py = (float(v) + 400 for v in a.pivot.split(","))
aw, ah = arm.size; apiv = (aw / 2, ah - aw * 0.32)        # 팔 아래 둥근 끝의 중심 근처
W, H = P.size
ease = lambda t: 0.5 - 0.5 * math.cos(math.pi * t)
# 24칸 = 흔들기 2번. 한 번 = 바깥 홀드 → 안으로 → 안쪽 홀드 → 밖으로. 사인 대신 '홀드 + ease' 로 끝에서 멈칫한다
def wave(ph):
    u = (ph * 2) % 1
    seg = [(0.00, 0.12, 1, 1), (0.12, 0.50, 1, -1), (0.50, 0.62, -1, -1), (0.62, 1.00, -1, 1)]
    for t0, t1, v0, v1 in seg:
        if u < t1: return v0 + (v1 - v0) * ease((u - t0) / (t1 - t0))
    return 1
frames = []
for i in range(24):
    ph = i / 24; w = wave(ph)
    ang = a.rest + a.amp * w
    can = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    big = Image.new("RGBA", (2 * ah + 4, 2 * ah + 4), (0, 0, 0, 0)); c = ah + 2
    big.alpha_composite(arm, (int(c - apiv[0]), int(c - apiv[1])))
    big = big.rotate(ang, resample=Image.BICUBIC, center=(c, c))
    can.alpha_composite(big, (int(round(px - c)), int(round(py - c))))
    bsw = -a.sway * w                                         # 몸은 팔과 반대로 살짝
    bb = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bb.alpha_composite(body, (bx, by))
    bb = bb.rotate(bsw, resample=Image.BICUBIC, center=(bx + body.width / 2, by + body.height))
    can.alpha_composite(bb); frames.append(can.convert("RGB"))
box = None
for f in frames:
    q = np.asarray(f).min(2) < 235; ys, xs = np.where(q); b = (xs.min(), ys.min(), xs.max(), ys.max())
    box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
side = int(max(box[2] - box[0], box[3] - box[1]) * 1.1); cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
crop = (int(cx - side / 2), int(cy - side / 2), int(cx - side / 2) + side, int(cy - side / 2) + side)
out = [f.crop(crop).resize((a.size, a.size), Image.LANCZOS) for f in frames]
sheet = Image.new("RGB", (6 * 256, 4 * 256), "white")
for i, f in enumerate(out): f.save(f"{a.out}/frames/{i+1:02d}.png"); sheet.paste(f.resize((256, 256), Image.LANCZOS), ((i % 6) * 256, (i // 6) * 256))
sheet.save(f"{a.out}/rig_sheet.png")
json.dump(dict(ms=[90, 80, 80] * 8), open(f"{a.out}/ms.json", "w")); print("ok")
