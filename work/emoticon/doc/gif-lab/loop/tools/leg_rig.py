"""하이브리드 리그: 생성된 한 칸(몸 + 두 다리)을 잘라, 다리만 SK 뼈대 각도대로 엉덩이 축 회전·길이 조절해 24칸을 만든다.
다리 궤적의 연속성은 코드가 보장한다(생성 모델이 몸 밑을 지나는 중간 위치를 안 그리는 문제의 우회).
원본 칸 = 뼈대 1번과 같은 자세(왼발 앞·오른발 뒤)여야 한다 → 각 다리에 '뼈대 i번 각도 − 뼈대 1번 각도'만큼 돌린다.
사용: python3 leg_rig.py 시트.png 칸번호 출력폴더 [--cut 206 --split 146.5 --tail 187]
"""
import argparse, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ap = argparse.ArgumentParser(); ap.add_argument("sheet"); ap.add_argument("cell", type=int); ap.add_argument("out")
ap.add_argument("--cut", type=float, default=206); ap.add_argument("--split", type=float, default=146.5); ap.add_argument("--tail", type=float, default=187)
ap.add_argument("--hipy", type=float, default=196, help="회전 축(엉덩이) y — 몸 안쪽")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
K = 2                                                     # 2배로 키워 작업(회전 계단 줄이기)
S = Image.open(a.sheet).convert("RGB"); cw, ch = S.width // 6, S.height // 4
r, c = divmod(a.cell - 1, 6); src = S.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)).resize((256 * K, 256 * K), Image.LANCZOS)
rgb = np.asarray(src).astype(float); N = 256 * K
alpha = np.clip((250 - rgb.min(2)) * 6, 0, 255)          # 흰 바탕 → 투명
cut, split, tail, hipy = a.cut * K, a.split * K, a.tail * K, a.hipy * K
yy, xx = np.mgrid[0:N, 0:N]
legL = (yy >= cut) & (xx < split); legR = (yy >= cut) & (xx >= split) & (xx < tail)
def layer(mask, extend=0):
    al = alpha * mask
    im = np.dstack([rgb, al]).astype(np.uint8)
    if extend:                                             # 다리 윗부분을 몸 뒤로 늘려 회전해도 틈이 안 보이게
        rows = np.where((al > 0).any(1))[0]; top = rows.min()
        for y in range(max(0, top - extend), top): im[y] = im[top]
    return Image.fromarray(im, "RGBA")
LL, LR = layer(legL, 18 * K), layer(legR, 18 * K)
bodymask = ~(legL | legR)
B = np.dstack([rgb, alpha * bodymask]).astype(np.uint8); body = Image.fromarray(B, "RGBA")
# 몸 아랫면을 외곽선으로 닫는다: 잘린 선(cut) 위에서 몸이 있는 열을 따라 진갈색 선
d = ImageDraw.Draw(body); cols = np.where((alpha[int(cut) - 2] > 128) & (xx[0] < tail))[0]
if len(cols): d.line([(cols.min(), cut - 1), (cols.max(), cut - 1)], fill=(0x2c, 0x24, 0x1e, 255), width=2 * K)
def pivot(mask):
    xs = np.where(mask[int(cut) + 2])[0]; return ((xs.min() + xs.max()) / 2 if len(xs) else split, hipy)
pL, pR = pivot(legL), pivot(legR)

# --- SK 뼈대(sk_walk.py 와 같은 식, 칸 256 기준) ---
HIPX, HIPY, FLOOR, STRIDE, LIFT, STANCE, BOB = 140, 202, 242, 30, 6, 0.6, 3
def foot(ph):
    ph %= 1
    if ph < STANCE: return HIPX - STRIDE / 2 + STRIDE * ph / STANCE, FLOOR
    t = (ph - STANCE) / (1 - STANCE); e = (1 - math.cos(math.pi * t)) / 2
    return HIPX + STRIDE / 2 - STRIDE * e, FLOOR - LIFT * math.sin(math.pi * t)
def skel(i):
    ph = i / 24; yb = BOB * math.cos(4 * math.pi * (ph - 3 / 24)); hip = (HIPX, HIPY + yb); out = {}
    for side, off in (("L", 0.0), ("R", 0.5)):
        fx, fy = foot(ph - off); dx, dy = fx - hip[0], fy - hip[1]
        out[side] = (math.atan2(dx, dy), math.hypot(dx, dy))
    return yb, out
_, ref = skel(0)

def place(leg, piv, dtheta, s, dy):
    """piv 축으로 길이 s 배(다리 방향), dtheta 회전, 몸 bob dy 이동. 역변환 행렬로 transform."""
    ct, st = math.cos(dtheta), math.sin(dtheta)
    # 출력 p → 원본 q: q = piv + S^-1 R^-1 (p - piv - (0,dy))  (R: 화면 좌표에서 반시계 = 다리 끝이 +x 로)
    px, py = piv
    a_, b_ = ct, st; c_, d_ = -st / s, ct / s
    # q_x = px + a_*(x-px) + b_*(y-py-dy) ; q_y = py + c_*(x-px) + d_*(y-py-dy)
    m = (a_, b_, px - a_ * px - b_ * (py + dy), c_, d_, py - c_ * px - d_ * (py + dy))
    return leg.transform(leg.size, Image.AFFINE, m, resample=Image.BICUBIC)

frames = []
for i in range(24):
    yb, sk = skel(i); dy = yb * K
    can = Image.new("RGBA", (N, N), (255, 255, 255, 255))
    for side, leg, piv in (("R", LR, pR), ("L", LL, pL)):          # 먼 다리 먼저
        th, ln = sk[side]; th0, ln0 = ref[side]
        can.alpha_composite(place(leg, piv, -(th - th0), ln / ln0, dy))
    can.alpha_composite(body.transform(body.size, Image.AFFINE, (1, 0, 0, 0, 1, -dy)))
    f = can.convert("RGB").resize((256, 256), Image.LANCZOS); f.save(f"{a.out}/{i+1:02d}.png"); frames.append(f)
sheet = Image.new("RGB", (6 * 256, 4 * 256), "white")
for i, f in enumerate(frames): sheet.paste(f, ((i % 6) * 256, (i // 6) * 256))
sheet.save(f"{a.out}/rig_sheet.png"); print("ok", a.out)
