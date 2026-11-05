"""01 안뇽~ 재리그(2026-11-06). '종이인형'(한 축 회전) 피드백 → 관절 2단 + 겹침 동작 + 바운스.
부품: 01/parts.png (몸 / 든 팔) — 새 생성 없이 코드로 더 자른다: 팔 → 위팔·아래팔(팔꿈치), 몸 → 몸통·머리·귀 둘.
한 주기 = 12칸(흔들기 1번), 2초에 2번 돈다.
- 위팔: 어깨 축, 양 끝 홀드 + ease
- 아래팔: 팔꿈치 축, 위팔보다 2칸 늦게(채찍처럼 끌려가 손이 호를 그린다)
- 몸통: 흔들 때마다 통통(아래 기준 squash/stretch) + 팔 반대로 살짝
- 머리: 몸통보다 2칸 늦게 갸웃, 귀: 머리보다 또 1~2칸 늦게 펄럭
사용: python3 rig_01.py parts.png out_dir"""
import math, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from rig_lib import *

parts, out = sys.argv[1], sys.argv[2]
body, arm = load_runs(parts, 2)
N = 12
SHOULDER, ARMPIV = (200, 980), (1011, 991)          # 몸의 어깨 / 팔 부품의 어깨 끝(둥근 끝 중심)
ELBOW_Y = 800
ax = np.where(np.asarray(arm.im)[int(ELBOW_Y - arm.off[1]), :, 3] > 60)[0]
ELBOW = (arm.off[0] + (ax.min() + ax.max()) / 2, ELBOW_Y)
fore, _ = cut(arm, [(850, 500), (1180, 500), (1180, ELBOW_Y + 18), (850, ELBOW_Y + 18)])
upper, _ = cut(arm, [(850, ELBOW_Y - 18), (1180, ELBOW_Y - 18), (1180, 1100), (850, 1100)])
NECK = (420, 1010)
HEAD = [(40, 230), (770, 230), (770, 1000), (600, 978), (470, 955), (330, 978), (200, 962), (40, 905)]
EAR_L = [(205, 245), (352, 245), (340, 385), (222, 410)]; EAR_L_P = (282, 395)
EAR_R = [(548, 312), (668, 312), (662, 492), (570, 512)]; EAR_R_P = (608, 500)
head, torso = cut(body, HEAD)
earL, head = cut(head, EAR_L); earR, head = cut(head, EAR_R)
filler, _ = cut(head, [(-9999, NECK[1] - 260), (9999, NECK[1] - 260), (9999, 9999), (-9999, 9999)])   # 목 근처 띠만 — 회전 틈 메우기용
BOT = (395, 1173)                                     # 몸통 아래 가운데(squash 기준)

def wave(u):                                          # 바깥 홀드 → 안으로 → 안쪽 홀드 → 밖으로
    u %= 1
    for t0, t1, v0, v1 in [(0, .14, 1, 1), (.14, .5, 1, -1), (.5, .64, -1, -1), (.64, 1, -1, 1)]:
        if u < t1: return v0 + (v1 - v0) * ease((u - t0) / (t1 - t0))
    return 1

frames = []
for i in range(N):
    u = i / N
    w0 = wave(u); w2 = wave(u - 2 / N); w3 = wave(u - 3 / N); w4 = wave(u - 4 / N)
    bob = math.cos(2 * math.pi * 2 * (u - 1.5 / N))   # 양 끝에서 내려앉고(+) 가운데서 솟는다
    sy = 1 - 0.022 * bob; sx = 1 + 0.012 * bob
    tdeg = -1.8 * wave(u - 1 / N)                      # 몸통은 팔 반대로
    can = Canvas(1500, 1500, 300, 150)
    # 팔(몸 뒤): 위팔 → 아래팔
    up = 33 + 13 * w0; rel = 20 * w2 - 5
    sh = xform(SHOULDER, BOT, tdeg, (0, 0), sx, sy)
    t = (sh[0] - ARMPIV[0], sh[1] - ARMPIV[1])
    two_bone(can, upper, fore, ARMPIV, ELBOW, up, rel, t)
    # 몸통
    draw(can, torso, BOT, tdeg, (0, 0), sx, sy)
    neck = xform(NECK, BOT, tdeg, (0, 0), sx, sy); tn = (neck[0] - NECK[0], neck[1] - NECK[1])
    hdeg = tdeg + 4.5 * w3 + 1.2 * bob                 # 머리: 2~3칸 늦게 갸웃 + 내려앉을 때 살짝 끄덕
    # 귀(머리 뒤): 머리를 따라가되 1칸 더 늦게, 반대로 펄럭
    for ear, p, sgn in ((earL, EAR_L_P, 1), (earR, EAR_R_P, 1)):
        pe = xform(p, NECK, hdeg, tn)
        draw(can, ear, p, hdeg + sgn * 7 * (w4 - w3) + 3 * bob, (pe[0] - p[0], pe[1] - p[1]))
    draw(can, head, NECK, hdeg, tn, fill=filler)
    frames.append(can.im)
finish(frames, out, [120, 80, 70, 80, 80, 70] * 2)
