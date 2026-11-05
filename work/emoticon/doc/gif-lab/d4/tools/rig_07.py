"""07 기여워! 재리그(2026-11-06). '통째로 기울어지는 종이인형' 피드백 → 몸통·머리·귀를 따로, 시차를 두고.
입력: split/char.png(글자·하트 뗀 캐릭터). 새 생성 없이 코드로 자른다: 몸통 / 머리(+볼 감싼 두 손) / 귀 둘.
한 주기 = 12칸(좌우 살랑 1번), 2초에 2번 돈다.
- 몸통: 아래 가운데 축으로 작게(±S) 살랑, 끝에서 내려앉으며 squash
- 머리+손: 목 축으로 몸통보다 2칸 늦게 더 크게(S 곡선 — 엉덩이가 먼저, 머리가 따라온다), 끝에서 볼을 꾹(가로로 살짝 넓게)
- 귀: 머리보다 1칸 더 늦게 반대로 펄럭
하트는 다듬기 뒤에 fx_overlay.py 로 얹는다(부품 08–11).
사용: python3 rig_07.py split_dir out_dir"""
import math, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from rig_lib import *

split, out = sys.argv[1], sys.argv[2]
K = 4
ch = from_rgba(f"{split}/char.png", K)
S = lambda pts: [(x * K, y * K) for x, y in pts]
HEAD = S([(0, 0), (285, 0), (285, 200), (232, 240), (190, 226), (140, 232), (100, 232), (80, 224), (40, 226), (0, 226)])
EAR_L, EAR_L_P = S([(95, 45), (135, 45), (132, 82), (98, 90)]), (115 * K, 86 * K)
EAR_R, EAR_R_P = S([(192, 58), (235, 58), (228, 108), (200, 118)]), (210 * K, 108 * K)
NECK, BOT = (130 * K, 240 * K), (142 * K, 293 * K)
head, torso = cut(ch, HEAD)
earL, head = cut(head, EAR_L); earR, head = cut(head, EAR_R)
filler, _ = cut(head, [(-9999, NECK[1] - 70 * K), (9999, NECK[1] - 70 * K), (9999, 9999), (-9999, 9999)])   # 목 근처 띠만 — 회전 틈 메우기용
N = 12
sw = lambda u: math.sin(2 * math.pi * u)
frames = []
for i in range(N):
    u = i / N
    tdeg = 2.5 * sw(u)
    ext = abs(sw(u - 1 / N)) ** 1.5                  # 양 끝 = 1 → 내려앉음 · 볼 꾹
    sy = 1 - 0.03 * ext + 0.01; sx = 1 + 0.015 * ext
    can = Canvas(1700, 1600, 280, 250)
    draw(can, torso, BOT, tdeg, (0, 0), sx, sy)
    neck = xform(NECK, BOT, tdeg, (0, 0), sx, sy); tn = (neck[0] - NECK[0], neck[1] - NECK[1])
    hdeg = tdeg + 6.5 * sw(u - 2 / N)
    hs = abs(sw(u - 2 / N)) ** 2                     # 머리가 끝에 닿을 때 볼을 꾹
    hsx, hsy = 1 + 0.03 * hs, 1 - 0.025 * hs
    for ear, p in ((earL, EAR_L_P), (earR, EAR_R_P)):
        pe = xform(p, NECK, hdeg, tn, hsx, hsy)
        draw(can, ear, p, hdeg + 12 * (sw(u - 3 / N) - sw(u - 2 / N)), (pe[0] - p[0], pe[1] - p[1]))
    draw(can, head, NECK, hdeg, tn, hsx, hsy, fill=filler)
    frames.append(can.im)
finish(frames, out, [110, 80, 70, 80, 80, 80] * 2)
