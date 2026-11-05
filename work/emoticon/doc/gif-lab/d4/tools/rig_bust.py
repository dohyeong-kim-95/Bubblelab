"""흉상(A·B 분류) 공용 러프 리그 — rig_07.py 를 일반화(2026-11-06). 새 생성 없이 split/char.png 를 코드로 자른다:
몸통 / 머리(얼굴에 붙은 손 포함) / 귀 둘 [/ 팔: 위팔·아래팔(어깨-팔꿈치 2단)].
좌표는 스티커 원래 px(char.png). 종마다 아래 CFG 한 줄 + MOTION 함수 하나.
한 주기 = 12칸(1초), 2초 = 두 번(다듬기 뒤 loop24.sh).

겹침 동작 규칙(모든 종 공통): 몸통이 먼저, 머리는 1~2칸 늦게, 귀는 머리보다 1칸 더 늦게 반대로 펄럭.
동작 함수는 u(0..1) → dict(t=몸통각, sx, sy, dy, h=머리 상대각, hdy, hsx, hsy, ear=귀 추가각, up, fore)
사용: python3 rig_bust.py <종> split_dir out_dir"""
import math, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from rig_lib import *
from PIL import ImageDraw

K = 4
sw = lambda u: math.sin(2 * math.pi * u)
def hold_pulse(u, a, b):                       # a..b 사이에 0→1→0 (ease), 밖은 0
    u %= 1
    if u < a or u > b: return 0.0
    return math.sin(math.pi * (u - a) / (b - a)) ** 2

# ---------- 동작 ----------
def m02(u):   # 웅웅! 빠르게 두 번 끄덕(머리가 이끌고 몸통이 받는다), 끝에 홀드
    n = hold_pulse(u, 0.0, 0.28) + hold_pulse(u, 0.30, 0.58)
    nl = hold_pulse(u - 1 / 12, 0.0, 0.28) + hold_pulse(u - 1 / 12, 0.30, 0.58)
    return dict(t=-1.2 * nl, sy=1 - 0.02 * nl, sx=1 + 0.01 * nl, dy=0, h=11 * n, hdy=15 * n, hsy=1 - 0.05 * n, hsx=1 + 0.015 * n,
                ear=-12 * (hold_pulse(u - 2 / 12, 0.0, 0.28) + hold_pulse(u - 2 / 12, 0.30, 0.58)) + 6 * n)
def m03(u):   # 히히 — 어깨 들썩 3번(몸통 위아래 + squash), 머리 1칸 늦게 살짝 갸웃
    b = abs(sw(1.5 * u)); bl = abs(sw(1.5 * (u - 1 / 12)))
    return dict(t=1.5 * sw(u), sy=1 + 0.03 * b - 0.015, sx=1 - 0.012 * b, dy=-8 * b, h=3 * sw(u - 2 / 12) - 2 * bl, hdy=-4 * bl,
                ear=8 * (abs(sw(1.5 * (u - 2 / 12))) - bl))
def m04(u):   # >_< — 움츠림(납작) 한 번 꾹 + 그동안 오들오들(칸마다 좌우), 머리 늦게
    s = 0.5 + 0.5 * math.cos(2 * math.pi * u)          # 0→ 움츠림 최대 0.5 근처
    sq = 1 - s; jit = (1 if int(u * 12) % 2 else -1) * (0.4 + 1.2 * sq)
    sql = 1 - (0.5 + 0.5 * math.cos(2 * math.pi * (u - 1 / 12)))
    return dict(t=jit, sy=1 - 0.045 * sq, sx=1 + 0.03 * sq, dy=6 * sq, h=-jit * 0.8 + 2 * sw(u - 2 / 12), hdy=7 * sql, hsx=1 + 0.03 * sql, hsy=1 - 0.03 * sql,
                ear=-10 * sql + 3 * jit)
def m05(u):   # 키키키 — 입 가리고 작게 키득 3번(몸통·머리 들썩), 머리는 손 쪽으로 기울며 늦게
    b = abs(sw(1.5 * u)); bl = abs(sw(1.5 * (u - 1 / 12)))
    return dict(t=-1.2 * b, sy=1 + 0.025 * b - 0.012, sx=1 - 0.01 * b, dy=-6 * b, h=4 * bl - 1, hdy=-3 * bl,
                ear=9 * (abs(sw(1.5 * (u - 2 / 12))) - bl))

def m06(u):   # 헐...! — 놀라 쭉 늘어남(2칸, 오버슈트) → 굳음(미세 떨림), 머리 1칸 늦게 솟고 귀가 곤두선다. 땀방울은 굳는 동안 흘러내림
    k = min(1, u * 12 / 2); up = math.sin(math.pi / 2 * k) * (1 + 0.25 * math.exp(-max(0, u * 12 - 2) * 0.9) * (u * 12 > 2))
    kl = min(1, max(0, u * 12 - 1) / 2); upl = math.sin(math.pi / 2 * kl)
    jit = 0.5 * (1 if int(u * 12) % 2 else -1) * (u * 12 > 3)
    rel = max(0, (u * 12 - 9) / 3)                                   # 끝 3칸 풀림(다음 주기 시작으로 이어짐)
    up *= 1 - ease(rel); upl *= 1 - ease(rel)
    return dict(t=jit, sy=1 + 0.06 * up, sx=1 - 0.035 * up, dy=0, h=-3 * upl + jit, hdy=-6 * upl, ear=-14 * upl + 4 * (upl - up),
                drop=(0, 18 * ease(max(0, u * 12 - 3) / 6)))
def m10(u):   # 대박잉! — 놀라 살짝 몸이 솟고(1칸) 머리가 늦게 앞으로, 반짝이 눈 깜빡(7·8칸)
    p = hold_pulse(u, 0.0, 0.5); pl = hold_pulse(u - 1 / 12, 0.0, 0.5)
    return dict(t=-1.5 * pl, sy=1 + 0.03 * p, sx=1 - 0.015 * p, dy=-6 * p, h=4 * pl - 2 * p, hdy=-5 * pl,
                ear=-10 * hold_pulse(u - 2 / 12, 0.0, 0.5) + 4 * pl, blink=int(u * 12) in (7, 8), blinkhalf=int(u * 12) in (6, 9))
def m12(u):   # 와용~ — 07 처럼 몸통 먼저·머리 늦게 S 살랑, 별 눈이 커졌다 작아지며 돈다
    return dict(t=2.5 * sw(u), sy=1 - 0.02 * abs(sw(u - 1 / 12)) ** 1.5 + 0.005, sx=1 + 0.01 * abs(sw(u - 1 / 12)) ** 1.5,
                h=6 * sw(u - 2 / 12), ear=11 * (sw(u - 3 / 12) - sw(u - 2 / 12)),
                star=(12 * sw(u), 1.08 + 0.12 * abs(sw(2 * u))))
def m16(u):   # 오늘도 수고했승 — 느린 끄덕(2초 주기), 몸통은 숨 쉬듯, 머리 1~2칸 늦게, 귀 더 늦게
    n = 0.5 - 0.5 * math.cos(2 * math.pi * u); nl = 0.5 - 0.5 * math.cos(2 * math.pi * (u - 1.5 / 12))
    return dict(t=0.8 * sw(u), sy=1 + 0.015 * n, sx=1 - 0.006 * n, dy=-2 * n, h=6 * nl, hdy=6 * nl, hsy=1 - 0.02 * nl,
                ear=-7 * (0.5 - 0.5 * math.cos(2 * math.pi * (u - 3 / 12))) + 3 * nl)

def m09(u):   # 잘대따! — 엄지척 팔을 '척' 내밀며(가까워지듯 커지고 살짝 올라감) 오버슈트 후 정지, 몸이 따라 앞으로, 머리·귀 늦게
    def thrust(v):
        v %= 1; k = v * 12
        if k < 1: return 0.0
        if k < 3: return ease((k - 1) / 2) * 1.25
        if k < 5: return 1.25 - 0.25 * ease((k - 3) / 2)
        if k < 9: return 1.0
        return 1.0 - ease((k - 9) / 3)
    a, al, a2 = thrust(u), thrust(u - 1 / 12), thrust(u - 2 / 12)
    return dict(t=2.5 * al, sy=1 + 0.015 * al, dy=-3 * al, h=-3 * a2 + 1.5 * al, hdy=-2 * a2, ear=8 * (thrust(u - 3 / 12) - a2) - 4 * a2,
                up=-12 * a, asc=1 + 0.16 * a)
def m11(u):   # 나두나두! — 든 손을 위아래로 두 번(위팔 먼저, 아래팔 1칸 늦게 채찍), 몸 들썩, 머리·귀 늦게
    w = sw(2 * u); wl = sw(2 * (u - 1 / 12)); w2 = sw(2 * (u - 2 / 12))
    return dict(t=-1.2 * wl, sy=1 + 0.02 * wl, sx=1 - 0.01 * wl, dy=-6 * wl, h=2.5 * w2, hdy=-4 * w2, ear=9 * (sw(2 * (u - 3 / 12)) - w2),
                up=-7 * w, fore=-12 * wl)
def m13(u):   # 오나용? — 폰을 보다가(홀드) 고개를 갸웃 들어 올림(머리가 먼저 위로, 기울기는 1칸 늦게), 귀가 쫑긋 늦게, 되돌아옴
    def look(v):
        v %= 1; k = v * 12
        if k < 2: return 0.0
        if k < 5: return ease((k - 2) / 3)
        if k < 9: return 1.0
        return 1.0 - ease((k - 9) / 3)
    a, al, a2 = look(u), look(u - 1 / 12), look(u - 2 / 12)
    return dict(t=-1.0 * al, sy=1 + 0.012 * a, h=-9 * a - 5 * al + 1.5 * a2, hdy=-8 * a, ear=-12 * a2 + 5 * a, )

# ---------- 종별 자르기(스티커 px) ----------
CFG = {
    "02": dict(m=m02, head=[(0, 0), (263, 0), (263, 222), (220, 232), (190, 242), (150, 252), (128, 260), (100, 258), (70, 244), (30, 232), (0, 230)],
               earL=([(86, 50), (130, 50), (127, 92), (90, 100)], (108, 96)), earR=([(172, 66), (226, 66), (216, 110), (182, 120)], (195, 114)),
               neck=(150, 246), bot=(160, 298), ms=[110, 70, 80, 90, 70, 80, 90, 70, 80, 110, 80, 70]),
    "03": dict(m=m03, head=[(0, 0), (238, 0), (238, 220), (200, 228), (162, 236), (126, 250), (90, 252), (50, 246), (0, 240)],
               earL=([(84, 44), (124, 44), (120, 92), (88, 100)], (104, 96)), earR=([(176, 58), (222, 58), (210, 115), (180, 122)], (194, 118)),
               neck=(140, 246), bot=(150, 295), ms=[90, 80, 80, 90, 80, 80, 90, 80, 80, 90, 80, 80]),
    "04": dict(m=m04, head=[(0, 0), (264, 0), (264, 236), (220, 245), (180, 252), (130, 254), (90, 252), (40, 254), (0, 252)],
               earL=([(64, 48), (104, 48), (100, 100), (68, 106)], (84, 102)), earR=([(158, 56), (204, 56), (190, 112), (162, 118)], (176, 114)),
               neck=(125, 250), bot=(130, 292), ms=[80] * 10 + [100, 100]),
    "05": dict(m=m05, head=[(0, 0), (234, 0), (234, 230), (170, 245), (124, 252), (104, 274), (40, 276), (0, 272)],
               earL=([(68, 48), (110, 48), (106, 100), (72, 108)], (90, 102)), earR=([(170, 50), (216, 50), (204, 110), (174, 118)], (188, 114)),
               neck=(140, 252), bot=(150, 290), ms=[90, 80, 80, 90, 80, 80, 90, 80, 80, 90, 80, 80]),
    "06": dict(m=m06, head=[(0, 0), (223, 0), (223, 236), (150, 250), (110, 262), (60, 270), (0, 272)],
               earL=([(70, 50), (112, 50), (106, 104), (74, 112)], (90, 108)), earR=([(158, 56), (204, 56), (190, 112), (162, 120)], (176, 116)),
               drop=[(156, 142), (181, 142), (181, 183), (156, 183)],
               neck=(125, 258), bot=(130, 297), ms=[70, 70, 90, 80, 80, 80, 80, 90, 90, 90, 90, 90]),
    "10": dict(m=m10, head=[(0, 0), (227, 0), (227, 240), (172, 250), (140, 282), (60, 284), (0, 282)],
               earL=([(72, 50), (112, 50), (106, 104), (76, 112)], (92, 108)), earR=([(170, 62), (214, 62), (200, 116), (174, 124)], (186, 120)),
               eyes=[(81, 164, 21), (136, 167, 21)], neck=(140, 255), bot=(130, 289), ms=[90, 70, 80, 90, 80, 80, 90, 70, 90, 90, 80, 90]),
    "12": dict(m=m12, head=[(0, 0), (254, 0), (254, 240), (172, 250), (140, 282), (60, 284), (0, 282)],
               earL=([(74, 52), (114, 52), (108, 106), (78, 114)], (94, 110)), earR=([(170, 56), (214, 56), (200, 116), (174, 124)], (186, 120)),
               stars=[(84, 155, 21), (143, 162, 21)], neck=(140, 255), bot=(135, 291), ms=[110, 80, 70, 80, 80, 80] * 2),
    "16": dict(m=m16, head=[(0, 0), (269, 0), (269, 215), (200, 216), (150, 206), (124, 200), (90, 198), (50, 194), (0, 190)],
               earL=([(84, 46), (124, 46), (118, 106), (88, 114)], (104, 110)), earR=([(160, 56), (206, 56), (194, 116), (166, 124)], (180, 120)),
               neck=(160, 212), bot=(150, 289), ms=[170, 160, 170, 160, 170, 170, 170, 160, 170, 160, 170, 170]),
    "09": dict(m=m09, arm=dict(poly=[(0, 140), (57, 140), (57, 200), (62, 226), (100, 236), (100, 262), (60, 262), (0, 240)], shoulder=(85, 250)),
               head=[(0, 0), (283, 0), (283, 232), (200, 236), (150, 240), (110, 236), (70, 226), (57, 200), (57, 140), (0, 140)],
               earL=([(96, 44), (138, 44), (132, 100), (100, 108)], (116, 104)), earR=([(186, 60), (234, 60), (216, 106), (194, 114)], (204, 110)),
               neck=(150, 238), bot=(140, 290), ms=[100, 60, 60, 80, 80, 110, 90, 90, 90, 80, 80, 80]),
    "11": dict(m=m11, arm=dict(poly=[(20, 75), (88, 75), (88, 125), (64, 150), (57, 165), (57, 200), (66, 230), (80, 272), (30, 272), (25, 150)],
                                shoulder=(55, 262), elbow_y=165),
               head=[(88, 0), (241, 0), (241, 232), (180, 240), (130, 238), (95, 228), (70, 215), (58, 195), (58, 165), (64, 150), (88, 125)],
               earL=([(94, 46), (134, 46), (128, 100), (98, 108)], (113, 104)), earR=([(190, 64), (236, 64), (218, 112), (196, 120)], (206, 116)),
               neck=(150, 240), bot=(140, 287), ms=[90, 80, 80, 80, 90, 80] * 2),
    "13": dict(m=m13, front=[(58, 172), (116, 172), (126, 204), (152, 204), (152, 258), (58, 258)],
               head=[(0, 0), (254, 0), (254, 235), (200, 240), (160, 232), (140, 222), (112, 200), (112, 177), (78, 175), (0, 170)],
               earL=([(104, 42), (146, 42), (140, 104), (108, 112)], (124, 108)), earR=([(194, 54), (240, 54), (220, 102), (198, 110)], (208, 106)),
               neck=(170, 240), bot=(160, 291), ms=[100, 90, 80, 70, 80, 90, 90, 90, 80, 80, 70, 80]),
}

def patch(pc, poly, ring=28):
    """poly 안을 둘레 색(중앙값)으로 칠한다 — 떼어 낸 땀방울 자리·감은 눈 덮기. 러프라 다듬기가 다시 그린다."""
    im = pc.im.copy(); mk = Image.new("L", im.size, 0)
    ImageDraw.Draw(mk).polygon([(x - pc.off[0], y - pc.off[1]) for x, y in poly], fill=255)
    m = np.asarray(mk) > 0; from PIL import ImageFilter
    rg = (np.asarray(mk.filter(ImageFilter.MaxFilter(ring * 2 + 1))) > 0) & ~m
    q = np.asarray(im).copy(); px = q[rg & (q[..., 3] > 200)][:, :3]
    q[m, :3] = np.median(px, 0) if len(px) else (223, 164, 97); q[m, 3] = 255
    return Piece(Image.fromarray(q), pc.off)

def ellipse(cx, cy, r, k=1.0): return [(cx + r * math.cos(t / 16 * 2 * math.pi), cy + r * k * math.sin(t / 16 * 2 * math.pi)) for t in range(16)]

if __name__ == "__main__":
    n, split, out = sys.argv[1:4]; C = CFG[n]
    S = lambda pts: [(x * K, y * K) for x, y in pts]; P = lambda p: (p[0] * K, p[1] * K)
    ch = from_rgba(f"{split}/char.png", K)
    arm = upper = fore = front = None
    if "arm" in C:
        arm, ch = cut(ch, S(C["arm"]["poly"]))
        if "elbow_y" in C["arm"]:
            ey = C["arm"]["elbow_y"] * K
            fore, _ = cut(arm, [(-9999, -9999), (9999, -9999), (9999, ey + 24), (-9999, ey + 24)])
            upper, _ = cut(arm, [(-9999, ey - 24), (9999, ey - 24), (9999, 9999), (-9999, 9999)])
            ys = np.where(np.asarray(arm.im)[int(ey - arm.off[1]), :, 3] > 60)[0]; ELB = (arm.off[0] + (ys.min() + ys.max()) / 2, ey)
    head, torso = cut(ch, S(C["head"]))
    if "front" in C: front, torso = cut(torso, S(C["front"]))
    ears = []
    for key in ("earL", "earR"):
        if key in C:
            e, head = cut(head, S(C[key][0])); ears.append((e, P(C[key][1])))
    NECK, BOT = P(C["neck"]), P(C["bot"])
    drop = None
    if "drop" in C:
        drop, _ = cut(head, S(C["drop"])); head = patch(head, S(C["drop"]))
    stars = [(cut(head, S(ellipse(x, y, r)))[0], P((x, y))) for x, y, r in C.get("stars", [])]
    closed = half = None
    if "eyes" in C:
        closed, half = head, head
        for x, y, r in C["eyes"]:
            closed = patch(closed, S(ellipse(x, y, r)))
            half = patch(half, S([(x - r, y - r), (x + r, y - r), (x + r, y), (x - r, y)]))
        for pc, yy in ((closed, 0.15), (half, 0.1)):
            d_ = ImageDraw.Draw(pc.im)
            for x, y, r in C["eyes"]:
                bx = [(x - r * 0.9) * K - pc.off[0], (y - r * 0.5 + r * yy) * K - pc.off[1], (x + r * 0.9) * K - pc.off[0], (y + r * 0.5 + r * yy) * K - pc.off[1]]
                d_.arc(bx, 10, 170, fill=(44, 36, 30, 255), width=10)
    filler, _ = cut(head, [(-9999, NECK[1] - 70 * K), (9999, NECK[1] - 70 * K), (9999, 9999), (-9999, 9999)])
    W, H = ch.im.size
    frames = []
    for i in range(12):
        m = dict(t=0, sx=1, sy=1, dy=0, h=0, hdy=0, hsx=1, hsy=1, ear=0); m.update(C["m"](i / 12))
        can = Canvas(W + 600, H + 600, 300, 300)
        t = (0, m["dy"] * K)
        draw(can, torso, BOT, m["t"], t, m["sx"], m["sy"])
        if arm is not None:
            SH = P(C["arm"]["shoulder"]); sh = xform(SH, BOT, m["t"], t, m["sx"], m["sy"]); ta = (sh[0] - SH[0], sh[1] - SH[1])
            if upper is not None: two_bone(can, upper, fore, SH, ELB, m["t"] + m.get("up", 0), m.get("fore", 0), ta)
            else: draw(can, arm, SH, m["t"] + m.get("up", 0), ta, m.get("asc", 1), m.get("asc", 1))
        nk = xform(NECK, BOT, m["t"], t, m["sx"], m["sy"]); tn = (nk[0] - NECK[0], nk[1] - NECK[1] + m["hdy"] * K)
        hdeg = m["t"] + m["h"]
        for e, p in ears:
            pe = xform(p, NECK, hdeg, tn, m["hsx"], m["hsy"])
            draw(can, e, p, hdeg + m["ear"], (pe[0] - p[0], pe[1] - p[1]))
        hd = closed if m.get("blink") else half if m.get("blinkhalf") else head
        draw(can, hd, NECK, hdeg, tn, m["hsx"], m["hsy"], fill=filler)
        def onhead(pc, p, deg=0.0, s=1.0, d=(0, 0)):
            q = xform(p, NECK, hdeg, tn, m["hsx"], m["hsy"])
            draw(can, pc, p, hdeg + deg, (q[0] - p[0] + d[0] * K, q[1] - p[1] + d[1] * K), m["hsx"] * s, m["hsy"] * s)
        if drop: onhead(drop, P(((C["drop"][0][0] + C["drop"][1][0]) / 2, C["drop"][0][1])), d=m.get("drop", (0, 0)))
        for pc, p in stars:
            rot, sc = m.get("star", (0, 1)); onhead(pc, p, rot, sc)
        if front is not None: draw(can, front, BOT, m["t"], t, m["sx"], m["sy"])
        frames.append(can.im)
    finish(frames, out, C["ms"])
