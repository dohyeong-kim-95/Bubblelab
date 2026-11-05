"""다그당스 SD(2등신) 피곤한 걷기 뼈대 — 옆모습(화면 왼쪽 보기), 24칸 한 주기.
비율은 B2 시트(칸 256px)에서 잰 값: 머리(귀~턱) ≈ 키의 60%, 몸통 ≈ 22%, 다리 ≈ 19%.
다리는 발 궤적(디딤 60% 뒤로 미끄러짐 / 들기 40% 낮게 앞으로) → 2관절 IK 로 무릎을 구한다.
1번 칸 = 왼다리(근) 앞 착지, 13번 칸 = 오른다리(원) 앞 착지 → 한 주기에 L R 이 정확히 한 번씩.
색: 왼(근) 다리·팔 = 초록, 오른(원) 다리·팔 = 자홍, 몸통·머리 = 회색. 캐릭터 색(황갈·갈색·파란 가방)과 겹치지 않게.
사용: python3 sk_walk.py 출력폴더   → SK_skeleton_sheet.png(1536x1024, 4x6), frames/, SK_skeleton.gif
"""
import math, os, sys
from PIL import Image, ImageDraw
out = sys.argv[1]; os.makedirs(f"{out}/frames", exist_ok=True)
C = 256                                  # 칸 크기(B2 시트와 같음)
FLOOR = 242                              # 발굽 바닥 y
HIP = (140, 202)                         # 엉덩이(제자리 걷기라 x 고정)
THIGH, SHIN = 24, 22                     # 짧은 다리
STRIDE = 30                              # 피곤: 짧은 보폭(앞발~뒷발 x 간격)
LIFT = 6                                 # 피곤: 발을 낮게
STANCE = 0.6
BOB = 3                                  # 몸 오르내림 작게(대신 down 에서 가라앉음)
LEAN = 12                                # 상체 앞으로 숙임(도)
GREEN, MAG, GRAY = (0, 170, 0), (220, 0, 200), (120, 120, 120)

def foot(ph):
    """ph 0=앞 착지. 화면 왼쪽(-x)이 앞."""
    ph %= 1
    if ph < STANCE:                      # 디딤: 앞(-S/2) → 뒤(+S/2) 로 바닥을 따라
        t = ph / STANCE; return (HIP[0] - STRIDE / 2 + STRIDE * t, FLOOR)
    t = (ph - STANCE) / (1 - STANCE)     # 들기: 뒤 → 앞, 낮은 호
    e = (1 - math.cos(math.pi * t)) / 2  # ease
    return (HIP[0] + STRIDE / 2 - STRIDE * e, FLOOR - LIFT * math.sin(math.pi * t))

def knee(hip, ft):
    dx, dy = ft[0] - hip[0], ft[1] - hip[1]; d = min(math.hypot(dx, dy), THIGH + SHIN - 0.01)
    a = (THIGH**2 - SHIN**2 + d**2) / (2 * d); h = math.sqrt(max(THIGH**2 - a**2, 0))
    ux, uy = dx / d, dy / d; mx, my = hip[0] + a * ux, hip[1] + a * uy
    k1, k2 = (mx + h * uy, my - h * ux), (mx - h * uy, my + h * ux)
    return min(k1, k2, key=lambda k: k[0])   # 무릎은 앞(화면 왼쪽)으로 굽는다

def pose(i):
    ph = i / 24
    yb = BOB * math.cos(4 * math.pi * (ph - 3 / 24))          # 4·16번(down)에서 가장 낮게(+y)
    hip = (HIP[0], HIP[1] + yb)
    lean = math.radians(LEAN)
    neck = (hip[0] - 46 * math.sin(lean), hip[1] - 46 * math.cos(lean))
    yh = BOB * 1.3 * math.cos(4 * math.pi * (ph - 5 / 24))    # 머리는 2틱 늦게 따라온다(lag)
    head = (neck[0] - 22, neck[1] - 70 + (yh - yb))           # 머리는 크고(2등신) 앞으로 숙임
    legs = {}
    for side, off in (("L", 0.0), ("R", 0.5)):
        ft = foot(ph - off); legs[side] = (knee(hip, ft), ft)
    arms = {}
    for side, off in (("L", 0.5), ("R", 0.0)):                # 팔은 다리와 반대
        sw = math.radians(90 + 6 * math.cos(2 * math.pi * (ph - off)))   # 아주 작게 흔듦
        sh = (neck[0] - 12, neck[1] + 6)
        el = (sh[0] + 20 * math.cos(sw), sh[1] + 20 * math.sin(sw))
        ha = (el[0] + 16 * math.cos(sw + 0.1), el[1] + 16 * math.sin(sw + 0.1))
        arms[side] = (sh, el, ha)
    return dict(hip=hip, neck=neck, head=head, legs=legs, arms=arms)

def draw(d, p, ox=0, oy=0, w=4):
    o = lambda q: (q[0] + ox, q[1] + oy)
    def line(a, b, col, ww=w): d.line([o(a), o(b)], fill=col, width=ww)
    def dot(q, col, r): x, y = o(q); d.ellipse((x - r, y - r, x + r, y + r), fill=col)
    # 먼 쪽(오른) 먼저, 가까운 쪽(왼) 나중 = 가림 순서
    sh, el, ha = p["arms"]["R"]; line(sh, el, MAG, 3); line(el, ha, MAG, 3); dot(ha, MAG, 4)
    k, f = p["legs"]["R"]; line(p["hip"], k, MAG); line(k, f, MAG); dot(f, MAG, 6)
    line(p["hip"], p["neck"], GRAY, 5)
    hx, hy = o(p["head"]); d.ellipse((hx - 68, hy - 66, hx + 68, hy + 66), outline=GRAY, width=3)   # 큰 머리(B2 머리 폭·높이)
    line(p["head"], (p["head"][0] - 66, p["head"][1] + 30), GRAY, 3)
    line(p["neck"], (p["head"][0] + 14, p["head"][1] + 64), GRAY, 5)                              # 목                              # 주둥이 방향(왼쪽 아래 = 고개 숙임)
    
    k, f = p["legs"]["L"]; line(p["hip"], k, GREEN); line(k, f, GREEN); dot(f, GREEN, 6)
    sh, el, ha = p["arms"]["L"]; line(sh, el, GREEN, 3); line(el, ha, GREEN, 3); dot(ha, GREEN, 4)

sheet = Image.new("RGB", (6 * C, 4 * C), "white"); ds = ImageDraw.Draw(sheet)
frames = []
for i in range(24):
    p = pose(i); r, c = divmod(i, 6)
    draw(ds, p, c * C, r * C)
    im = Image.new("RGB", (C, C), "white"); draw(ImageDraw.Draw(im), p); im.save(f"{out}/frames/{i+1:02d}.png")
    frames.append(im.resize((360, 360), Image.LANCZOS))
sheet.save(f"{out}/SK_skeleton_sheet.png")
MS = [120, 90, 80, 140, 100, 70, 60, 60, 60, 60, 70, 90] * 2   # B2_timing 과 같음
frames[0].save(f"{out}/SK_skeleton.gif", save_all=True, append_images=frames[1:], duration=MS, loop=0)
for i in range(24):
    p = pose(i); print(i + 1, "L foot", tuple(round(v) for v in p["legs"]["L"][1]), "R foot", tuple(round(v) for v in p["legs"]["R"][1]))
