"""온몸(C 분류) 러프 리그 — 부품 생성 없이 split/char.png 를 조각내 부모-자식으로 움직인다(2026-11-06).
조각: 몸(나머지) / 머리 / 귀 둘 / 팔 / 다리 / 꼬리 / 소품(공) / 바닥 그림자. 좌표는 스티커 원래 px.
- 몸: 발 아래 가운데(BOT) 기준 squash·stretch + 위아래 이동(점프·통통) + 기울기
- 자식 조각은 부모가 움직인 자리의 관절을 따라가고, 자기 각도를 더한다(머리·팔·꼬리는 1~2칸 늦게 = 겹침 동작)
- 다리: 엉덩이 축 회전 + 길이 방향 배율(접힘을 흉내 — 무릎은 다듬기가 그린다)
- 그림자: 바닥에 남고 몸이 뜨면 작아진다
한 주기 = 12칸(1초). 사용: python3 rig_body.py <종> split_dir out_dir"""
import math, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from rig_lib import *
from rig_bust import patch, ellipse

K = 4
sw = lambda u: math.sin(2 * math.pi * u)


def hop(u):
    """08 호이잇! 한 발 콩: 0-1 웅크림 → 2-3 박차 솟음 → 4-7 공중 → 8 착지 → 9-10 납작 → 11 회복. 반환 (높이 0..1, squash -1..1)."""
    k = (u % 1) * 12
    if k < 2: return 0.0, -0.6 * ease(k / 2)                       # 웅크림(납작)
    if k < 8:
        h = math.sin(math.pi * (k - 2) / 6); return h, 0.7 * (1 - (k - 2) / 3) if k < 5 else 0.15 * h
    if k < 10: return 0.0, -1.0 + 0.5 * (k - 8) / 2                 # 착지 납작
    return 0.0, -0.5 * (1 - ease((k - 10) / 2))


def m08(u):
    h, s = hop(u); hl, sl = hop(u - 1 / 12); h2, s2 = hop(u - 2 / 12)
    air = h
    return dict(y=-70 * h, sy=1 + 0.07 * s, sx=1 - 0.045 * s, t=-4 * h + 2 * s,
                head=dict(deg=3 * sl - 4 * hl, dy=-6 * sl), earL=dict(deg=14 * (sl - s2) - 6 * hl), earR=dict(deg=14 * (sl - s2) - 6 * hl),
                armL=dict(deg=-12 * hl + 8 * sl), armR=dict(deg=18 * hl - 6 * sl),
                legF=dict(deg=-22 * air + 6 * s, sy=1 - 0.18 * air), legB=dict(deg=-25 * air - 8 * min(0, s), sy=1 - 0.05 * air),
                shadow=dict(s=1 - 0.35 * air))


def m15(u):
    """15 테니스 치러 가승! 통통 걷기 두 걸음 — 다리 번갈아, 몸 두 번 통통, 라켓 팔·공 팔 늦게, 공은 걸음마다 톡 튀어 오름, 꼬리 살랑."""
    st = sw(u); b = abs(math.sin(2 * math.pi * u)); bl = abs(math.sin(2 * math.pi * (u - 1 / 12)))
    toss = abs(math.sin(2 * math.pi * (u - 1 / 12)))
    return dict(y=-14 * b, sy=1 + 0.03 * (b - 0.5) * 2 * 0.6, sx=1 - 0.015 * (b - 0.5) * 2, t=2.5 * st,
                head=dict(deg=-2.5 * sw(u - 2 / 12), dy=4 * (1 - bl)), earL=dict(deg=9 * (sw(u - 3 / 12) - sw(u - 2 / 12))), earR=dict(deg=9 * (sw(u - 3 / 12) - sw(u - 2 / 12))),
                racket=dict(deg=10 * sw(u - 1.5 / 12)), ballarm=dict(deg=-8 * sw(u - 1.5 / 12)), ball=dict(dy=-26 * toss ** 1.5),
                legF=dict(deg=22 * st, sy=1 - 0.12 * max(0, -st)), legB=dict(deg=22 * st, sy=1 - 0.12 * max(0, st)),
                tail=dict(deg=-14 * sw(u - 2 / 12)), shadow=dict(s=1 - 0.08 * b))


# 조각: (이름, 다각형, 관절, 부모). 위에서부터 차례로 잘라 낸다 — 나머지가 '몸'. DRAW 는 그리는 순서(뒤 → 앞).
CFG = {
    "08": dict(m=m08, bot=(140, 282), neck=(150, 215),
               pieces=[("shadow", [(70, 283), (168, 283), (168, 299), (70, 299)], (120, 290), None),
                       ("legF", [(38, 228), (100, 220), (110, 252), (86, 283), (38, 283)], (95, 235), "body"),
                       ("legB", [(150, 240), (208, 240), (212, 299), (168, 299), (148, 262)], (165, 245), "body"),
                       ("armR", [(176, 196), (236, 212), (236, 264), (196, 264), (174, 232)], (182, 214), "body"),
                       ("armL", [(36, 106), (84, 106), (80, 148), (70, 175), (74, 202), (48, 202), (36, 160)], (70, 196), "body"),
                       ("head", [(84, 0), (273, 0), (273, 190), (212, 205), (172, 213), (130, 215), (100, 206), (82, 196), (80, 150), (84, 106)], (150, 215), "body"),
                       ("earL", [(100, 46), (138, 46), (134, 92), (104, 98)], (118, 94), "head"),
                       ("earR", [(182, 64), (222, 64), (210, 104), (188, 110)], (196, 106), "head")],
               draw=["shadow", "legB", "armR", "body", "legF", "armL", "earL", "earR", "head"],
               ms=[90, 80, 60, 60, 80, 90, 90, 70, 60, 90, 110, 120]),
    "15": dict(m=m15, bot=(165, 280), neck=(160, 225),
               pieces=[("shadow", [(122, 279), (275, 279), (275, 299), (122, 299)], (195, 288), None),
                       ("ball", ellipse(208, 193, 23), (208, 193), "ballarm"),
                       ("ballarm", [(185, 160), (247, 160), (247, 264), (200, 264), (185, 230)], (196, 236), "body"),
                       ("racket", [(3, 66), (84, 66), (84, 195), (100, 205), (100, 247), (55, 247), (50, 200), (3, 170)], (90, 226), "body"),
                       ("legF", [(84, 236), (130, 232), (142, 262), (128, 279), (84, 279)], (124, 242), "body"),
                       ("legB", [(188, 250), (236, 250), (236, 279), (192, 279)], (205, 255), "body"),
                       ("tail", [(232, 222), (278, 222), (278, 264), (232, 264)], (234, 246), "body"),
                       ("head", [(84, 0), (293, 0), (293, 160), (247, 160), (185, 160), (185, 222), (150, 228), (110, 216), (100, 205), (84, 195)], (160, 225), "body"),
                       ("earL", [(108, 44), (146, 44), (142, 96), (112, 102)], (126, 98), "head"),
                       ("earR", [(192, 52), (234, 52), (218, 98), (196, 104)], (206, 100), "head")],
               draw=["shadow", "tail", "legB", "body", "legF", "earL", "earR", "head", "ballarm", "ball", "racket"],
               ms=[90, 80, 80, 90, 80, 80] * 2),
}

if __name__ == "__main__":
    n, split, out = sys.argv[1:4]; C = CFG[n]
    S = lambda pts: [(x * K, y * K) for x, y in pts]; P = lambda p: (p[0] * K, p[1] * K)
    rest = from_rgba(f"{split}/char.png", K)
    pcs = {}
    for name, poly, piv, parent in C["pieces"]:
        src = pcs[parent][0] if parent in pcs and parent not in ("body",) else rest
        inn, out_ = cut(src, S(poly))
        if src is rest: rest = patch(out_, S(poly)) if name == "ball" else out_   # 공이 떠난 자리는 둘레 색으로(다듬기가 손·갈기를 다시 그린다)
        else: pcs[parent] = (out_,) + pcs[parent][1:]
        pcs[name] = (inn, P(piv), parent)
    pcs["body"] = (rest, P(C["bot"]), None)
    NECK = P(C["neck"])
    filler, _ = cut(pcs["head"][0], [(-9999, NECK[1] - 60 * K), (9999, NECK[1] - 60 * K), (9999, 9999), (-9999, 9999)])
    W, H = rest.im.size
    frames = []
    for i in range(12):
        m = C["m"](i / 12)
        tf = {"body": (P(C["bot"]), m["t"], (0, m["y"] * K), m["sx"], m["sy"])}
        def get(name):
            if name in tf: return tf[name]
            pc, piv, parent = pcs[name]; o = m.get(name, {})
            if parent is None:
                s = o.get("s", 1); tf[name] = (piv, 0, (0, 0), s, s); return tf[name]
            ppiv, pdeg, pt, psx, psy = get(parent)
            q = xform(piv, ppiv, pdeg, pt, psx, psy)
            tf[name] = (piv, pdeg + o.get("deg", 0), (q[0] - piv[0], q[1] - piv[1] + o.get("dy", 0) * K), o.get("sx", 1), o.get("sy", 1))
            return tf[name]
        can = Canvas(W + 800, H + 800, 400, 400)
        for name in C["draw"]:
            piv, deg, t, sx, sy = get(name)
            draw(can, pcs[name][0], piv, deg, t, sx, sy, fill=filler if name == "head" else 0)
        frames.append(can.im)
    finish(frames, out, C["ms"])
