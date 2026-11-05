"""4x6 시트 → 칸 순서·칸별 ms 를 지정해 GIF 조립 (생성 없음). 배치는 rebuild_b.py orig 와 같다.
사용: python3 assemble_order.py 시트.png 출력.gif "1,2,3,..." "120,90,..."   (ms 하나만 주면 전 칸 동일)"""
import sys
import numpy as np
from PIL import Image
sheet, out, order, ms = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")], [int(x) for x in sys.argv[4].split(",")]
if len(ms) == 1: ms = ms * len(order)
assert len(ms) == len(order), "칸 수와 ms 수가 다르다"
S = Image.open(sheet).convert("RGB"); W, H = S.size; cw, ch = W // 6, H // 4; N = 360; k = N / cw
def frame(i):
    r, c = divmod(i - 1, 6); im = S.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
    a = np.asarray(im).astype(int); m = ((a.max(2) - a.min(2) > 25) & (a.min(2) < 235)) | (a.min(2) < 110)
    xs = np.where(m.any(0))[0]; cx = (xs.min() + xs.max()) / 2 * k
    can = Image.new("RGB", (N, N), "white"); can.paste(im.resize((N, N), Image.LANCZOS), (round(N / 2 - cx), 0)); return can
pal = S.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
fr = [frame(i).quantize(palette=pal, dither=Image.Dither.NONE) for i in order]
fr[0].save(out, save_all=True, append_images=fr[1:], duration=ms, loop=0, optimize=False, disposal=2)
print(out, len(order), "frames", sum(ms), "ms")
