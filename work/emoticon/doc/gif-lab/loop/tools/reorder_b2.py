"""B2 시트 칸 재배치 조립 (생성 없음). 배치는 rebuild_b.py 의 orig 와 같다(칸을 256→360 통째로, 수평 가운데 정렬).
사용: python3 reorder_b2.py 시트.png 출력폴더
"""
import sys, json
import numpy as np
from PIL import Image
sheet, out = sys.argv[1], sys.argv[2]
S = Image.open(sheet).convert("RGB"); W, H = S.size; cw, ch = W // 6, H // 4
N = 360; k = N / cw

def frame(i):  # i = 1..24
    r, c = divmod(i - 1, 6); im = S.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
    a = np.asarray(im).astype(int); m = ((a.max(2) - a.min(2) > 25) & (a.min(2) < 235)) | (a.min(2) < 110)
    xs = np.where(m.any(0))[0]; cx = (xs.min() + xs.max()) / 2 * k
    sm = im.resize((N, N), Image.LANCZOS); can = Image.new("RGB", (N, N), "white"); can.paste(sm, (round(N / 2 - cx), 0)); return can

T = {1: 120, 2: 90, 3: 80, 4: 140, 5: 100, 6: 70, 7: 60, 8: 60, 9: 60, 10: 60, 11: 70, 12: 90}   # B2_timing 과 같은 걸음 안 타이밍(칸 번호 기준)
def t(i): return T[(i - 1) % 12 + 1]
V = {
    # fix1: 22·23(10·11 을 베껴 오른다리가 또 나감)을 빼고, 왼다리 뻗음(24)을 그만큼 길게
    "fix1": ([*range(1, 22), 24], {24: 220}),
    # fix2: fix1 + 두 걸음의 '뻗기' 길이를 맞춤 — 첫 걸음도 뻗기를 11·12 두 칸으로(10 뺌), 24 는 160
    "fix2": ([*range(1, 10), 11, 12, *range(13, 22), 24], {11: 100, 12: 120, 24: 160, 21: 80}),
    # fix3: 첫 걸음(1~12)만 두 번 — 실루엣으로만 보면 '디딤 → 뒷다리 들기 → 뻗기'가 매번 번갈아 읽힌다. 명암은 이음매(12→1)에서 바뀐다
    "fix3": ([*range(1, 13)] * 2, {}),
}
info = {}
pal = S.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
for name, (order, over) in V.items():
    ms = [over.get(i, t(i)) for i in order]
    fr = [frame(i).quantize(palette=pal, dither=Image.Dither.NONE) for i in order]
    fr[0].save(f"{out}/B2_{name}.gif", save_all=True, append_images=fr[1:], duration=ms, loop=0, optimize=False, disposal=2)
    info[name] = dict(order=order, ms=ms, frames=len(order), total=sum(ms))
    print(name, len(order), sum(ms), order)
json.dump(info, open(f"{out}/B2_fix.json", "w"), indent=1)
