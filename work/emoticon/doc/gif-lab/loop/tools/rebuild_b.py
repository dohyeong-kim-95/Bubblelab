"""B 시트 재조립 (생성 없음): orig / size / timing / both.
size  = 얼굴(주둥이 크림색 면적의 제곱근) 중앙값에 맞춰 칸마다 스케일 + 발끝(바닥 그림자 제외)을 같은 접지선에.
timing= B 스케줄(1·13 contact, 4·16 down, 7·19 passing, 10·22 up)에 맞춘 칸별 ms.
size_bbox = (비교용) 칸별 bbox 높이를 중앙값에 맞춤 — 걸을 때 몸이 오르내리는 것까지 지워진다.
"""
import sys, json
import numpy as np
from PIL import Image
sheet, out = sys.argv[1], sys.argv[2]
S = Image.open(sheet).convert("RGB"); W, H = S.size; R, C = 4, 6; cw, ch = W // C, H // R
cells = [S.crop((c*cw, r*ch, (c+1)*cw, (r+1)*ch)) for r in range(R) for c in range(C)]

def mask(im):
    a = np.asarray(im).astype(int); mn, mx = a.min(2), a.max(2)
    return ((mx - mn > 25) & (mn < 235)) | (mn < 110)   # 색 있는 털·가방 + 진한 선. 옅은 회색 바닥 그림자는 빠짐

def stats(im):
    m = mask(im); ys, xs = np.where(m)
    top, bot = ys.min(), ys.max(); h = bot - top
    a = np.asarray(im).astype(int)
    mu = (abs(a[..., 0] - 252) < 18) & (abs(a[..., 1] - 231) < 22) & (abs(a[..., 2] - 201) < 28)   # 주둥이 크림색(#fce7c9)
    return dict(top=int(top), bot=int(bot), h=int(h), x0=int(xs.min()), x1=int(xs.max()), face=float(mu.sum()) ** 0.5)

st = [stats(c) for c in cells]
N = 360; BOT = 342; BASE = N / cw   # 원래 B 와 같은 배율(256→360)
face_t = float(np.median([s["face"] for s in st])); h_t = float(np.median([s["h"] for s in st]))

def frame(i, sized):
    im, s = cells[i], st[i]
    k = BASE * ({"face": face_t / s["face"], "bbox": h_t / s["h"]}[sized] if sized else 1.0)
    sm = im.resize((round(cw * k), round(ch * k)), Image.LANCZOS)
    cx = (s["x0"] + s["x1"]) / 2 * k
    bot = s["bot"] * k if sized else None
    can = Image.new("RGB", (N, N), "white")
    dx = round(N / 2 - cx)
    dy = round(BOT - bot) if sized else round((N - ch * k) / 2)
    can.paste(sm, (dx, dy))
    return can, round(k / BASE, 3)

STEP = [100, 70, 60, 80, 60, 50, 80, 50, 50, 60, 70, 80]   # contact 길게 → down → passing 홀드 → up, 끝에서 다음 contact 로 감속
TIRED = [120, 90, 80, 140, 100, 70, 60, 60, 60, 60, 70, 90]   # 피곤: contact·down(가장 낮은 점)에 오래 머물고 올라오는 쪽은 느리게, 걸음당 1.0s
variants = {"orig": (False, False), "size": ("face", False), "timing": (False, True), "both": ("face", True), "size_bbox": ("bbox", False), "tired": (False, "tired")}
info = {}
for name, (sized, timed) in variants.items():
    fr, ks = zip(*[frame(i, sized) for i in range(24)])
    ms = (TIRED * 2) if timed == "tired" else (STEP * 2) if timed else [50] * 24
    pal = S.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    enc = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in fr]
    p = f"{out}/B_{name}.gif"
    enc[0].save(p, save_all=True, append_images=enc[1:], duration=ms, loop=0, optimize=False, disposal=2)
    info[name] = dict(frames=24, ms=ms, total=sum(ms), scale=list(ks) if sized else None)
json.dump(dict(face=[round(s["face"], 1) for s in st], h=[s["h"] for s in st], variants=info), open(f"{out}/B4.json", "w"), ensure_ascii=False, indent=1)
print("face", [round(s["face"]) for s in st], "h", [s["h"] for s in st])
for n, v in info.items(): print(n, v["total"], "ms", v["scale"] and [min(v["scale"]), max(v["scale"])])
