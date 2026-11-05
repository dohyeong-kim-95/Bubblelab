"""부품 리그: image_gen 이 그린 '다리 없는 몸 + 곧은 다리 둘' 부품 시트를 SK 뼈대대로 조립해 24칸 걷기를 만든다.
다리는 엉덩이 축(둥근 윗끝의 중심)으로 회전하고, 발을 들 때는 길이를 줄인다. 두 다리 모두 몸 뒤에 그리고, 왼(근)다리를 오른(원)다리 위에.
발 궤적은 뼈대 그대로라 흔드는 발이 뒤 → 몸 밑 → 앞으로 연속해서 지나간다(생성 모델이 못 그리던 부분).
사용: python3 parts_rig.py parts.png 출력폴더 [--hipL 405 --hipR 485 --vis 180]"""
import argparse, math, os
import numpy as np
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument("parts"); ap.add_argument("out")
ap.add_argument("--hipL", type=float, default=405); ap.add_argument("--hipR", type=float, default=485); ap.add_argument("--vis", type=float, default=180)
ap.add_argument("--stride", type=float, default=1.0, help="뼈대 보폭 배율 — 통통한 다리는 겹쳐 가리므로 키운다")
ap.add_argument("--sock", action="store_true", help="왼다리 발굽을 초록(#00c000)으로 — 클린업 밑그림의 다리 표식")
ap.add_argument("--lift", type=float, default=6, help="발 드는 높이(뼈대 단위)")
ap.add_argument("--bob", type=float, default=3, help="몸 오르내림(뼈대 단위)")
ap.add_argument("--lean", type=float, default=0, help="상체 앞으로 숙임(도) — 몸 부품을 엉덩이 축으로 회전")
ap.add_argument("--droop", type=float, default=0, help="고개 처짐(도) — 머리를 목 축으로 아래·앞으로")
ap.add_argument("--nod", type=float, default=0, help="걸음마다 끄덕임 진폭(도)")
ap.add_argument("--nodlag", type=float, default=2, help="끄덕임이 몸 오르내림보다 늦는 틱 수")
ap.add_argument("--darkR", type=float, default=1.0, help="먼(오른) 다리 밝기 배율 — 1 보다 작으면 더 어둡게")
ap.add_argument("--neck", default="380,680", help="목 축(부품 좌표)")
ap.add_argument("--headpoly", default="40,100 720,100 720,540 590,600 440,600 340,640 300,770 40,770", help="머리 조각 다각형(부품 좌표)")
ap.add_argument("--legw", type=float, default=1.0, help="다리 폭 배율 — 통통한 다리끼리 가리면 줄인다")
ap.add_argument("--ms", default="120,90,80,140,100,70,60,60,60,60,70,90")
a = ap.parse_args()
os.makedirs(f"{a.out}/frames", exist_ok=True)
PAD = 300                                               # 숙인 머리가 캔버스 밖으로 안 나가게 여백(사용자 좌표는 원래 부품 좌표 그대로)
from PIL import ImageOps
P = ImageOps.expand(Image.open(a.parts).convert("RGB"), PAD, fill="white"); rgb = np.asarray(P).astype(float)
a.hipL += PAD; a.hipR += PAD
alpha = np.clip((250 - rgb.min(2)) * 6, 0, 255); m = alpha > 60
cols = np.where(m.any(0))[0]; runs, s, p = [], cols[0], cols[0]
for x in cols[1:]:
    if x > p + 8: runs.append((s, p)); s = x
    p = x
runs.append((s, p)); assert len(runs) == 3, runs
def sprite(x0, x1):
    ys = np.where(m[:, x0:x1 + 1].any(1))[0]; y0, y1 = ys.min(), ys.max()
    im = np.dstack([rgb[y0:y1 + 1, x0:x1 + 1], alpha[y0:y1 + 1, x0:x1 + 1]]).astype(np.uint8)
    return Image.fromarray(im, "RGBA"), (x0, y0)
body, (bx, by) = sprite(*runs[0]); legL, _ = sprite(*runs[1]); legR, _ = sprite(*runs[2])
if a.legw != 1.0:
    legL = legL.resize((max(1, round(legL.width * a.legw)), legL.height), Image.LANCZOS)
    legR = legR.resize((max(1, round(legR.width * a.legw)), legR.height), Image.LANCZOS)
if a.darkR != 1.0:
    q = np.asarray(legR).astype(float); q[..., :3] *= a.darkR; legR = Image.fromarray(np.clip(q, 0, 255).astype(np.uint8), "RGBA")
from PIL import ImageDraw as _D
_hm = Image.new("L", body.size, 0)
_D.Draw(_hm).polygon([(float(x) + PAD - bx, float(y) + PAD - by) for x, y in (pt.split(",") for pt in a.headpoly.split())], fill=255)
M = 250                                                 # 회전해도 안 잘리게 몸 부품에도 여백
body = ImageOps.expand(body, M, fill=(0, 0, 0, 0)); _hm = ImageOps.expand(_hm, M, fill=0); bx -= M; by -= M
bm = np.asarray(body)[..., 3] > 60
head = body.copy(); head.putalpha(Image.fromarray(np.minimum(np.asarray(body)[..., 3], np.asarray(_hm))))
torso = body.copy(); torso.putalpha(Image.fromarray(np.where(np.asarray(_hm) > 0, 0, np.asarray(body)[..., 3]).astype(np.uint8)))
NECK = tuple(float(v) + PAD - o for v, o in zip(a.neck.split(","), (bx, by)))
filler = head.copy(); _fa = np.asarray(filler).copy(); _fa[: max(0, int(NECK[1] - 260)), :, 3] = 0   # 틈 메우기용: 머리 아랫부분만(귀 겹침 방지)
filler = Image.fromarray(_fa, "RGBA")
def body_pose(head_deg):
    """몸 부품 = 몸통 + (목 축으로 돌린) 머리. 머리를 0→목표 각도로 여러 번 겹쳐 그려 목 뒤 틈을 메운다(러프라 클린업이 다시 그린다)."""
    b = torso.copy()
    if abs(head_deg) < 0.01: b.alpha_composite(head); return b
    n = max(2, int(abs(head_deg) // 2) + 1)
    for k in range(1, n):
        b.alpha_composite(filler.rotate(head_deg * k / n, resample=Image.BICUBIC, center=NECK))
    b.alpha_composite(head.rotate(head_deg, resample=Image.BICUBIC, center=NECK))
    return b
if a.sock:                                              # 왼다리 아래 40% 의 어두운 발굽 픽셀 → 초록(밝기 결 유지)
    q = np.asarray(legL).astype(float); hh = q.shape[0]; lum = q[..., :3].mean(2)
    hoof = (lum < 115) & (q[..., 3] > 60); hoof[: int(hh * 0.6)] = False
    q[hoof, 0] = 0; q[hoof, 1] = np.clip(lum[hoof] * 2.2, 90, 230); q[hoof, 2] = 0
    legL = Image.fromarray(q.astype(np.uint8), "RGBA")
bm = np.asarray(body)[..., 3] > 60
def body_bottom(xc):                                   # 그 x 에서 몸 아랫면 y(부품 좌표)
    col = np.where(bm[:, int(xc - bx)])[0]; return by + col.max()

# SK 뼈대(sk_walk.py 와 같은 식, 칸 256 단위)
HIPX, HIPY, FLOOR, STRIDE, LIFT, STANCE, BOB = 140, 202, 242, 30 * a.stride, a.lift, 0.6, a.bob
def foot(ph):
    ph %= 1
    if ph < STANCE: return HIPX - STRIDE / 2 + STRIDE * ph / STANCE, FLOOR
    t = (ph - STANCE) / (1 - STANCE); e = (1 - math.cos(math.pi * t)) / 2
    return HIPX + STRIDE / 2 - STRIDE * e, FLOOR - LIFT * math.sin(math.pi * t)
def skel(i):
    ph = i / 24; yb = BOB * math.cos(4 * math.pi * (ph - 3 / 24)); out = {"ph": ph}
    for side, off in (("L", 0.0), ("R", 0.5)):
        fx, fy = foot(ph - off); dx, dy = fx - HIPX, fy - (HIPY + yb); out[side] = (math.atan2(dx, dy), math.hypot(dx, dy))
    return yb, out
DREST = math.hypot(STRIDE / 2, FLOOR - HIPY + BOB)       # 다리가 가장 뻗었을 때
SC = a.vis / (FLOOR - HIPY)                              # 뼈대 1 = 부품 SC px

def leg_at(leg, hip, theta, s, canvas):
    w, h = leg.size; r = w / 2
    piv = (w / 2, r)                                     # 둥근 윗끝의 중심
    L = leg.resize((w, max(1, round(r + (h - r) * s))), Image.LANCZOS)   # 축 아래 길이만 줄인다
    big = Image.new("RGBA", (2 * h + 4, 2 * h + 4), (0, 0, 0, 0)); cx = cy = h + 2
    big.alpha_composite(L, (int(cx - piv[0]), int(cy - piv[1])))
    big = big.rotate(math.degrees(theta), resample=Image.BICUBIC, center=(cx, cy))
    canvas.alpha_composite(big, (int(round(hip[0] - cx)), int(round(hip[1] - cy))))

legh = legL.size[1]; r = legL.size[0] / 2
def hip_y(x): return body_bottom(x) - (legh - r - a.vis)            # 보이는 다리 길이 = vis
W, H = P.size; frames = []
for i in range(24):
    yb, sk = skel(i); dy = yb * SC
    can = Image.new("RGBA", (W, H + 200), (255, 255, 255, 255))
    for side, leg, hx in (("R", legR, a.hipR), ("L", legL, a.hipL)):
        th, d = sk[side]; leg_at(leg, (hx, hip_y(hx) + dy), th, d / DREST, can)
    hd = a.droop + a.nod * math.cos(4 * math.pi * (sk["ph"] - (3 + a.nodlag) / 24))   # down 보다 nodlag 틱 늦게 가장 숙인다
    bp = body_pose(hd)
    if a.lean:                                          # 상체 숙임: 엉덩이(몸 아랫면 가운데)를 축으로
        hipc = ((a.hipL + a.hipR) / 2 - bx, body_bottom((a.hipL + a.hipR) / 2) - by)
        bp = bp.rotate(a.lean, resample=Image.BICUBIC, center=hipc)
    can.alpha_composite(bp, (bx, int(round(by + dy))))
    frames.append(can.convert("RGB"))
# 공통 자르기: 모든 칸의 캐릭터 범위를 합친 정사각형
box = None
for f in frames:
    q = np.asarray(f).min(2) < 235; ys, xs = np.where(q); b = (xs.min(), ys.min(), xs.max(), ys.max())
    box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
side = int(max(box[2] - box[0], box[3] - box[1]) * 1.12); cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
crop = (int(cx - side / 2), int(cy - side / 2), int(cx - side / 2) + side, int(cy - side / 2) + side)
def wcrop(f):                                          # 범위 밖은 흰색
    can = Image.new("RGB", (side, side), "white"); can.paste(f, (-crop[0], -crop[1])); return can
out = [wcrop(f).resize((360, 360), Image.LANCZOS) for f in frames]
for i, f in enumerate(out): f.save(f"{a.out}/frames/{i+1:02d}.png")
ms = [int(x) for x in a.ms.split(",")]; ms = (ms * (24 // len(ms) + 1))[:24]
pal = out[0].quantize(colors=256, method=Image.Quantize.MEDIANCUT)
enc = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in out]
enc[0].save(f"{a.out}/rig.gif", save_all=True, append_images=enc[1:], duration=ms, loop=0, optimize=False, disposal=2)
sheet = Image.new("RGB", (6 * 256, 4 * 256), "white")
for i, f in enumerate(out): sheet.paste(f.resize((256, 256), Image.LANCZOS), ((i % 6) * 256, (i // 6) * 256))
sheet.save(f"{a.out}/rig_sheet.png"); print("ok", sum(ms), "ms")
