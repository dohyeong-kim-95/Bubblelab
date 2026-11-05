"""d4 재시범(2026-11-06) 공용 리그 도구. 부품 시트(흰 바탕)를 조각내고, 조각마다 축·각도·이동·squash 를 주어 한 칸을 그린다.
좌표는 전부 '부품 시트 원래 좌표'(world). 각 rig_XX.py 는 동작 곡선만 정하고 그리기·자르기·시트는 여기서 한다.

핵심 함수
- load_runs(path, n)          : 흰 바탕 시트를 가로로 떨어진 덩어리 n 개로(RGBA 조각 + world 오프셋)
- Piece / cut(piece, poly)    : 다각형으로 조각을 둘로(안 / 밖)
- draw(can, piece, pivot, deg, t, sx, sy, fill) : pivot 기준 회전·확대 + 이동. fill(조각 또는 1)이 있으면 0→deg 사이 각도로 여러 번 겹쳐 그려 회전 틈을 메운다(러프라 클린업이 다시 그린다)
- two_bone(...)               : 두 마디(어깨-팔꿈치 / 엉덩이-무릎) FK — 위 마디 각도 + 아래 마디 상대 각도
- ik2(hip, foot, L1, L2, bend): 두 마디 IK — 무릎이 bend 쪽(-1 왼쪽/+1 오른쪽)으로 굽는다
- lag(f, i, n, k)             : 곡선 f 를 k 칸 늦게(겹침 동작)
- finish(frames, out, ms, cols): 공통 정사각 자르기 → 칸 PNG(360²), 러프 시트(4×3, 칸 384), 미리보기 GIF, ms.json
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ease = lambda t: 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, t)))


class Piece:
    def __init__(self, im, off):
        self.im, self.off = im, (float(off[0]), float(off[1]))   # RGBA, world 좌상단

    def copy(self): return Piece(self.im.copy(), self.off)


def load_runs(path, n, gap=8):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(float)
    alpha = np.clip((250 - rgb.min(2)) * 6, 0, 255); m = alpha > 60
    cols = np.where(m.any(0))[0]; runs, s, p = [], cols[0], cols[0]
    for x in cols[1:]:
        if x > p + gap: runs.append((s, p)); s = x
        p = x
    runs.append((s, p)); assert len(runs) == n, runs
    out = []
    for x0, x1 in runs:
        ys = np.where(m[:, x0:x1 + 1].any(1))[0]; y0, y1 = ys.min(), ys.max()
        im = np.dstack([rgb[y0:y1 + 1, x0:x1 + 1], alpha[y0:y1 + 1, x0:x1 + 1]]).astype(np.uint8)
        out.append(Piece(Image.fromarray(im, "RGBA"), (x0, y0)))
    return out


def from_rgba(path, scale=1.0):
    im = Image.open(path).convert("RGBA")
    if scale != 1: im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    return Piece(im, (0, 0))


def cut(pc, poly):
    """poly(world 좌표 리스트) 안쪽 조각, 바깥 조각."""
    mk = Image.new("L", pc.im.size, 0)
    ImageDraw.Draw(mk).polygon([(x - pc.off[0], y - pc.off[1]) for x, y in poly], fill=255)
    a = np.asarray(pc.im)[..., 3]; k = np.asarray(mk) > 0
    inn, out = pc.im.copy(), pc.im.copy()
    inn.putalpha(Image.fromarray(np.where(k, a, 0).astype(np.uint8)))
    out.putalpha(Image.fromarray(np.where(k, 0, a).astype(np.uint8)))
    return Piece(inn, pc.off), Piece(out, pc.off)


def tint(pc, mul):
    q = np.asarray(pc.im).astype(float); q[..., :3] *= mul
    return Piece(Image.fromarray(np.clip(q, 0, 255).astype(np.uint8), "RGBA"), pc.off)


class Canvas:
    """world 좌표 → 캔버스 좌표 = world + (ox, oy)."""
    def __init__(self, w, h, ox, oy):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0)); self.ox, self.oy = ox, oy


def _affine(can, pc, pivot, deg, t, sx, sy):
    """조각 이미지를 직접 캔버스로 변환(조각이 캔버스 밖 world 위치에 있어도 된다).
    캔버스 q → world w = q - o → 원래 world p = P + S^-1 R^-1 (w - P - t) → 조각 로컬 = p - off."""
    W, H = can.im.size
    r = math.radians(deg); c, s = math.cos(r), math.sin(r)
    # R(+deg = 화면 반시계, y 아래) = [[c, s], [-s, c]] → 역 R^-1 = [[c, -s], [s, c]], 그 뒤 S^-1
    a, b, d, e = c / sx, -s / sx, s / sy, c / sy
    Px, Py = pivot; kx = Px + t[0] + can.ox; ky = Py + t[1] + can.oy
    cst = Px - a * kx - b * ky - pc.off[0]
    fst = Py - d * kx - e * ky - pc.off[1]
    return pc.im.transform((W, H), Image.AFFINE, (a, b, cst, d, e, fst), resample=Image.BICUBIC)


def draw(can, pc, pivot=(0, 0), deg=0.0, t=(0, 0), sx=1.0, sy=1.0, fill=0):
    if fill is not None and fill is not False and fill != 0 and abs(deg) > 0.5:
        fp = fill if isinstance(fill, Piece) else pc       # 틈 메우기 조각(목 근처 띠만 주면 실루엣 밖 잔상이 안 생긴다)
        n = max(2, int(abs(deg) // 1.5) + 1)
        for k in range(1, n):
            can.im.alpha_composite(_affine(can, fp, pivot, deg * k / n, t, sx, sy))
    can.im.alpha_composite(_affine(can, pc, pivot, deg, t, sx, sy))


def xform(pt, pivot, deg, t=(0, 0), sx=1.0, sy=1.0):
    """draw 와 같은 변환을 점 하나에(관절 위치 따라가기)."""
    r = math.radians(deg); c, s = math.cos(r), math.sin(r)
    x, y = (pt[0] - pivot[0]) * sx, (pt[1] - pivot[1]) * sy
    return (pivot[0] + c * x + s * y + t[0], pivot[1] - s * x + c * y + t[1])


def two_bone(can, upper, lower, root, joint, deg1, deg2, t=(0, 0), fill=0):
    """upper 는 root 축으로 deg1, lower 는 joint 축으로 deg1+deg2 (joint 는 upper 를 따라 움직인다). 반환: 새 joint 위치."""
    j = xform(joint, root, deg1, t)
    draw(can, upper, root, deg1, t, fill=fill)
    draw(can, lower, joint, deg1 + deg2, (j[0] - joint[0], j[1] - joint[1]), fill=fill)
    return j


def ik2(hip, foot, L1, L2, bend=-1):
    """화면 좌표(y 아래). bend=-1 → 무릎이 왼쪽(-x)으로, +1 → 오른쪽. 발이 닿지 않으면(너무 멀면) 다리를 곧게 뻗고 발이 뜬다.
    반환 (thigh_deg, knee_rel_deg, 실제 발 위치) — deg 는 '아래로 곧게 선 상태'에서 draw 규약(+ = 화면 반시계 = 아래 벡터가 +x 쪽으로)."""
    dx, dy = foot[0] - hip[0], foot[1] - hip[1]; d = math.hypot(dx, dy)
    d = min(max(d, abs(L1 - L2) + 1e-6), L1 + L2 - 1e-6)
    base = math.atan2(dx, dy)                         # 아래 방향에서 +x 쪽으로 잰 각
    a1 = math.acos(max(-1, min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))))
    th = base + a1 if bend > 0 else base - a1        # 무릎 왼쪽 = 허벅지가 base 보다 -x 쪽
    knee = (hip[0] + L1 * math.sin(th), hip[1] + L1 * math.cos(th))
    reach = (hip[0] + d * math.sin(base), hip[1] + d * math.cos(base))
    phi = math.atan2(reach[0] - knee[0], reach[1] - knee[1])
    return math.degrees(th), math.degrees(phi - th), reach


def lag(f, i, n, k):
    return f(((i - k) % n) / n)


def finish(frames, out, ms, cols=4, size=360, cell=384, margin=1.1):
    os.makedirs(f"{out}/frames", exist_ok=True)
    box = None
    for f in frames:
        a = np.asarray(f)[..., 3] > 40; ys, xs = np.where(a); b = (xs.min(), ys.min(), xs.max(), ys.max())
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    side = int(max(box[2] - box[0], box[3] - box[1]) * margin); cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    x0, y0 = int(cx - side / 2), int(cy - side / 2)
    outs = []
    for i, f in enumerate(frames):
        c = f.crop((x0, y0, x0 + side, y0 + side))      # 범위 밖은 투명으로 채워진다
        c = c.resize((size, size), Image.LANCZOS); outs.append(c)
        w = Image.new("RGB", (size, size), "white"); w.paste(c, mask=c); w.save(f"{out}/frames/{i+1:02d}.png")
    rows = math.ceil(len(outs) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * cell), "white")
    for i, c in enumerate(outs):
        w = Image.new("RGB", (size, size), "white"); w.paste(c, mask=c)
        sheet.paste(w.resize((cell, cell), Image.LANCZOS), ((i % cols) * cell, (i // cols) * cell))
    sheet.save(f"{out}/rig_sheet.png")
    whites = [Image.open(f"{out}/frames/{i+1:02d}.png").convert("RGB") for i in range(len(outs))]
    pal = whites[0].quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    enc = [w.quantize(palette=pal, dither=Image.Dither.NONE) for w in whites]
    enc[0].save(f"{out}/rig.gif", save_all=True, append_images=enc[1:] + enc, duration=list(ms) * 2, loop=0)
    json.dump(dict(ms=list(ms)), open(f"{out}/ms.json", "w"))
    print("ok", len(outs), "cells", sum(ms), "ms per cycle →", f"{out}/rig_sheet.png")
