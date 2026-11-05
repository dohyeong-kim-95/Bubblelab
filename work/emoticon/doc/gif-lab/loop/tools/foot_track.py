"""칸별 발굽 x 위치(몸 중심 기준) → 궤적 그래프 PNG. 지표가 아니라 '어디서 점프하는지' 보는 그림.
발굽 = 진갈색(#655846 근처) 또는 초록 양말 픽셀이 바닥 띠(칸 아래 22%)에 있는 열의 덩어리. 초록 덩어리는 L 로 표시.
사용: python3 foot_track.py 출력.png  이름=시트.png[:칸순서]  ...   (칸순서 예: 1-21,24)"""
import sys, math
import numpy as np
from PIL import Image, ImageDraw

def cells(spec):
    out = []
    for part in spec.split(","):
        a, _, b = part.partition("-"); out += list(range(int(a), int(b or a) + 1))
    return out

def feet(sheet, i):
    S = np.asarray(Image.open(sheet).convert("RGB")).astype(int); H, W = S.shape[:2]; cw, ch = W // 6, H // 4
    r, c = divmod(i - 1, 6); a = S[r*ch:(r+1)*ch, c*cw:(c+1)*cw]; R, G, B = a[..., 0], a[..., 1], a[..., 2]
    body = ((a.max(2) - a.min(2) > 25) & (a.min(2) < 235)) | (a.min(2) < 110)
    xs = np.where(body.any(0))[0]; cx = (xs.min() + xs.max()) / 2
    y0 = int(ch * 0.78)
    green = ((G - np.maximum(R, B)) / np.maximum(G, 1) > 0.3)[y0:]
    hoof = ((abs(R - 0x65) < 32) & (abs(G - 0x58) < 32) & (abs(B - 0x46) < 32))[y0:] | green
    def runs_of(colmask, tag):
        rs, x = [], 0
        while x < cw:
            if colmask[x]:
                s = x
                while x < cw and colmask[x]: x += 1
                if x - s >= 6: rs.append((s, x, tag))
            x += 1
        return rs
    brown = hoof & ~green                               # 초록과 갈색 발굽을 따로 센다(겹쳐 붙어도 둘로)
    runs = runs_of(green.sum(0) > 2, True) + runs_of(brown.sum(0) > 2, False)
    return [((s + e) / 2 - cx) * 256 / cw, g] if False else [(((s + e) / 2 - cx) * 256 / cw, bool(g)) for s, e, g in runs]

out = sys.argv[1]; series = []
for arg in sys.argv[2:]:
    name, _, rest = arg.partition("="); sheet, _, order = rest.partition(":")
    order = cells(order) if order else list(range(1, 25))
    series.append((name, [feet(sheet, i) for i in order], order))

# 뼈대 발 궤적(sk_walk.py 와 같은 식): 엉덩이 기준 x
def skx(ph):
    ph %= 1
    if ph < 0.6: return -15 + 30 * ph / 0.6
    t = (ph - 0.6) / 0.4; return 15 - 30 * (1 - math.cos(math.pi * t)) / 2
rows = len(series) + 1; PW, PH, M = 900, 230, 40
img = Image.new("RGB", (PW, PH * rows), "white"); d = ImageDraw.Draw(img)
def panel(k, title, n):
    y0 = k * PH; d.text((8, y0 + 4), title, fill="black")
    for j in range(n): x = M + j * (PW - 2 * M) / (n - 1); d.line((x, y0 + 24, x, y0 + PH - 14), fill=(235, 235, 235))
    d.line((M, y0 + PH // 2 + 10, PW - M, y0 + PH // 2 + 10), fill=(200, 200, 200))
    return lambda j, v: (M + j * (PW - 2 * M) / (n - 1), y0 + PH // 2 + 10 - v * 2.2)   # 위 = 몸 뒤(+x), 아래 = 앞(-x)
P = panel(0, "SK skeleton: green = L foot, magenta = R foot   (up = behind body, down = in front)", 24)
for side, off, colr in (("L", 0, (0, 160, 0)), ("R", 0.5, (210, 0, 190))):
    pts = [P(j, skx(j / 24 - off)) for j in range(24)]; d.line(pts, fill=colr, width=3)
for k, (name, data, order) in enumerate(series, 1):
    P = panel(k, f"{name}: green dot = green-sock foot (L), brown = other hooves   cells {order[0]}..{order[-1]} ({len(order)}f)", len(order))
    for j, fs in enumerate(data):
        d.text((P(j, 0)[0] - 6, k * PH + PH - 14), str(order[j]), fill=(120, 120, 120))
        for x, g in fs:
            px, py = P(j, x); col = (0, 160, 0) if g else (110, 80, 50)
            d.ellipse((px - 5, py - 5, px + 5, py + 5), fill=col)
    gl = [(P(j, x)) for j, fs in enumerate(data) for x, g in fs if g]
    if len(gl) > 1: d.line(gl, fill=(0, 160, 0), width=1)
img.save(out); print(out)
for name, data, order in series:
    print(name, [(o, [round(x) for x, g in fs], [g for x, g in fs]) for o, fs in zip(order, data)][:6], "...")
