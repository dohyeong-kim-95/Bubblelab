"""14 야호 신나! 재리그(2026-11-06). '다리 모양이 부자연스럽다'(곧은 다리 회전) 피드백 → 무릎 IK + 깡충 궤적 + 겹침 동작.
부품: 14/parts.png (다리 없는 몸 / 왼다리 / 오른다리) — 새 생성 없이 코드로 더 자른다:
다리 → 허벅지·정강이(무릎), 몸 → 몸통·머리·귀 둘·든 팔 둘·꼬리.
한 주기 = 12칸 = 두 걸음(왼·오), 2초에 4걸음.
- 발: 디딤(바닥에서 앞→뒤로 밀림) / 흔듦(발꿈치가 먼저 들리고 무릎이 앞으로 높이 올라왔다가 앞으로 뻗어 착지). 엉덩이·발 목표 → IK 로 무릎 각.
  몸이 높아 발이 안 닿으면 다리가 펴지고 발이 뜬다(깡충).
- 몸: 착지 다음 칸에 가장 낮고 납작(squash), 밀어낼 때 가장 높고 길쭉(stretch). 걸음마다 디딤발 쪽으로 기운다.
- 머리: 몸보다 1~2칸 늦게 오르내리고 갸웃, 귀는 또 1칸 늦게. 든 팔 둘은 2칸 늦게 위아래로, 꼬리는 반대로 살랑.
- --sock: 왼(근)다리 발굽을 초록(#00c000)으로 — 클린업 표식(unsock.py 로 되돌린다).
출력: rig_sheet.png(4×3) + frames/ + rig.gif + feet.json(칸마다 발 위치 — 궤적 그래프용).
사용: python3 rig_14.py parts.png out_dir [--sock]"""
import argparse, json, math, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from rig_lib import *

ap = argparse.ArgumentParser(); ap.add_argument("parts"); ap.add_argument("out"); ap.add_argument("--sock", action="store_true")
ap.add_argument("--stride", type=float, default=110); ap.add_argument("--lift", type=float, default=95); ap.add_argument("--bob", type=float, default=20)
a = ap.parse_args()
body, legL, legR = load_runs(a.parts, 3)
N = 12
# 다리: 둥근 윗끝 중심 = 엉덩이 축, 발바닥 = 아랫끝. 허벅지/정강이 = 반씩(겹침 24px)
def split_leg(leg):
    w, h = leg.im.size; x0, y0 = leg.off; piv = (x0 + w / 2, y0 + w / 2); sole = (x0 + w / 2, y0 + h - 4)
    L = sole[1] - piv[1]; knee = (piv[0], piv[1] + L / 2)
    th, _ = cut(leg, [(x0 - 5, y0 - 5), (x0 + w + 5, y0 - 5), (x0 + w + 5, knee[1] + 24), (x0 - 5, knee[1] + 24)])
    sh, _ = cut(leg, [(x0 - 5, knee[1] - 24), (x0 + w + 5, knee[1] - 24), (x0 + w + 5, y0 + h + 5), (x0 - 5, y0 + h + 5)])
    return dict(th=th, sh=sh, piv=piv, knee=knee, sole=sole, L1=L / 2, L2=L / 2)
if a.sock:                                           # 왼다리 아래 40% 의 어두운 발굽 → 초록(밝기 결 유지) — parts_rig.py 와 같은 식
    q = np.asarray(legL.im).astype(float); hh = q.shape[0]; lum = q[..., :3].mean(2)
    hoof = (lum < 115) & (q[..., 3] > 60); hoof[: int(hh * 0.6)] = False
    q[hoof, 0] = 0; q[hoof, 1] = np.clip(lum[hoof] * 2.2, 90, 230); q[hoof, 2] = 0
    legL = Piece(Image.fromarray(q.astype(np.uint8), "RGBA"), legL.off)
LL, LR = split_leg(legL), split_leg(legR)

HEAD = [(0, 180), (720, 180), (720, 520), (640, 560), (600, 660), (520, 668), (450, 700), (330, 715), (240, 700), (190, 650), (150, 540), (140, 500), (0, 500)]
ARM_L = [(0, 505), (145, 505), (165, 560), (205, 650), (232, 742), (170, 770), (0, 720)]; ARM_L_P = (205, 728)
ARM_R = [(495, 650), (600, 640), (608, 575), (725, 575), (725, 725), (560, 778), (492, 768)]; ARM_R_P = (512, 715)
TAIL = [(470, 790), (610, 790), (610, 905), (470, 905)]; TAIL_P = (492, 818)
EAR_L, EAR_L_P = [(278, 198), (372, 198), (366, 302), (283, 322)], (322, 316)
EAR_R, EAR_R_P = [(505, 248), (618, 248), (603, 362), (548, 402), (512, 392)], (560, 392)
NECK = (335, 735)
head, torso = cut(body, HEAD)
earL, head = cut(head, EAR_L); earR, head = cut(head, EAR_R)
armL, torso = cut(torso, ARM_L); armR, torso = cut(torso, ARM_R); tail, torso = cut(torso, TAIL)
filler, _ = cut(head, [(-9999, NECK[1] - 160), (9999, NECK[1] - 160), (9999, 9999), (-9999, 9999)])
HIPX = {"L": 268, "R": 425}; HIPY = 895; HIPC = (346, 895)
LEN = LL["L1"] + LL["L2"]; FLOOR = HIPY + LEN * 0.93
STANCE = 0.5
def foot(side, u):
    """발 목표(world). 디딤: 앞(-x)에서 뒤(+x)로 바닥을 민다. 흔듦: 발꿈치 먼저(뒤에서 위로) → 무릎 앞으로 높이 → 앞으로 뻗어 착지."""
    u %= 1; hx = HIPX[side]; S = a.stride
    if u < STANCE:
        return hx - S / 2 + S * (u / STANCE), FLOOR
    t = (u - STANCE) / (1 - STANCE)
    x = hx + S / 2 - S * ease(min(1, t * 1.15))      # 앞으로는 조금 먼저 도착해 내려놓는다
    y = FLOOR - a.lift * math.sin(math.pi * min(1, t ** 0.8)) ** 1.2   # 높이는 앞쪽(초반)에 몰린다
    return x, y
def bob(u):                                          # +: 아래(낮음). 착지(0, .5) 다음 칸에 가장 낮고, 밀어낼 때 가장 높다
    return a.bob * math.cos(2 * math.pi * 2 * (u - 1 / N))
frames, feet = [], []
for i in range(N):
    u = i / N
    dy = bob(u); low = dy / a.bob                   # -1..1
    sy, sx = 1 - 0.035 * low, 1 + 0.02 * low
    lean = 3.5 * math.sin(2 * math.pi * (u - 1 / N))  # 디딤발 쪽으로(왼발 디딤 = 앞 반 주기)
    can = Canvas(1300, 1400, 250, 0)
    fr = {}
    for side, LG, darken in (("R", LR, 1.0), ("L", LL, 1.0)):
        hip = (HIPX[side], HIPY + dy)
        off = 0.0 if side == "L" else 0.5
        f = foot(side, u - off)
        th, kr, reach = ik2(hip, f, LG["L1"], LG["L2"], bend=-1)
        t = (hip[0] - LG["piv"][0], hip[1] - LG["piv"][1])
        two_bone(can, LG["th"], LG["sh"], LG["piv"], LG["knee"], th, kr, t)
        fr[side] = [round(reach[0], 1), round(reach[1], 1)]
    feet.append(fr)
    # 몸(꼬리·팔은 몸 기준으로 붙어 다닌다)
    pose = dict(pivot=HIPC, deg=lean, t=(0, dy), sx=sx, sy=sy)
    def at(p): return xform(p, HIPC, lean, (0, dy), sx, sy)
    tp = at(TAIL_P); draw(can, tail, TAIL_P, lean - 14 * math.sin(2 * math.pi * 2 * (u - 3 / N)), (tp[0] - TAIL_P[0], tp[1] - TAIL_P[1]))
    draw(can, torso, **pose)
    for arm, p, sg in ((armL, ARM_L_P, -1), (armR, ARM_R_P, 1)):     # 팔: 몸보다 2칸 늦게 위아래로
        ap_ = at(p); draw(can, arm, p, lean + sg * 9 * math.cos(2 * math.pi * 2 * (u - 3 / N)), (ap_[0] - p[0], ap_[1] - p[1]))
    nk = at(NECK); hlag = bob(u - 1.5 / N) - dy        # 머리는 몸보다 늦게 오르내린다
    hdeg = lean * 0.5 + 4 * math.sin(2 * math.pi * (u - 3 / N))
    tn = (nk[0] - NECK[0], nk[1] - NECK[1] + 0.6 * hlag)
    for ear, p in ((earL, EAR_L_P), (earR, EAR_R_P)):
        pe = xform(p, NECK, hdeg, tn)
        draw(can, ear, p, hdeg + 10 * math.cos(2 * math.pi * 2 * (u - 3 / N)), (pe[0] - p[0], pe[1] - p[1]))
    draw(can, head, NECK, hdeg, tn, fill=filler)
    frames.append(can.im)
finish(frames, a.out, [100, 70, 80, 90, 70, 90] * 2)
json.dump(dict(floor=FLOOR, feet=feet), open(f"{a.out}/feet.json", "w"))
