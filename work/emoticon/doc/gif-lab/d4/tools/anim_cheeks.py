"""07 기여워! — 생성 없음. 글자·하트를 뗀 캐릭터를 몸째 좌우로 살랑(발 쪽 축 회전 + 살짝 통통)하고,
스티커 원래의 하트 조각들을 차례로 피어오르게 한다. 출력 = 투명 PNG 24장 + ms.json.
사용: python3 anim_cheeks.py split_dir out_dir [--size 360]"""
import argparse, json, math, os
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument("split"); ap.add_argument("out"); ap.add_argument("--size", type=int, default=360)
ap.add_argument("--sway", type=float, default=5, help="좌우 기울기(도)"); ap.add_argument("--hearts", default="08,09,10,11")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
meta = json.load(open(f"{a.split}/parts.json")); W, H = meta["size"]
char = Image.open(f"{a.split}/char.png").convert("RGBA")
parts = {p["id"]: p for p in meta["parts"]}
hearts = [(Image.open(f"{a.split}/parts/{h}.png").convert("RGBA"), parts[h]["box"]) for h in a.hearts.split(",")]
N = 24; S = a.size; k = S / max(W, H) * 0.92; ox, oy = (S - W * k) / 2, (S - H * k) / 2
pivot = (W / 2, H * 0.97)                                    # 엉덩이 아래(발 쪽)를 축으로 살랑
ease = lambda t: 0.5 - 0.5 * math.cos(math.pi * t)
for i in range(N):
    ph = i / N
    ang = a.sway * math.sin(2 * math.pi * 2 * ph)             # 2초에 두 번 왕복 — 사인이라 끝에서 느려진다(ease·홀드)
    sq = 1 + 0.025 * math.cos(2 * math.pi * 4 * ph)          # 왕복마다 살짝 통통(가운데 지날 때 납작)
    c = char.resize((round(W * k), round(H * k * sq)), Image.LANCZOS)
    big = Image.new("RGBA", (S, S), (0, 0, 0, 0)); big.alpha_composite(c, (round(ox), round(oy + H * k * (1 - sq))))
    big = big.rotate(ang, resample=Image.BICUBIC, center=(ox + pivot[0] * k, oy + pivot[1] * k))
    cut = round(oy + H * k * 0.985)                           # 흉상의 잘린 아랫단은 기울지 않게 — 원래 아랫선 아래를 지운다
    big.paste((0, 0, 0, 0), (0, cut, S, S))
    for j, (hp, box) in enumerate(hearts):                     # 하트: 각자 시차를 두고 커지며 떠올랐다가 작아져 사라진다
        t = (ph + j / len(hearts)) % 1
        if t > 0.75: continue
        u = t / 0.75; s = 0.4 + 0.75 * ease(min(1, u / 0.35)) - 0.9 * max(0, (u - 0.75) / 0.25)
        s = max(0.05, s if u < 0.75 else 1.15 * (1 - (u - 0.75) / 0.25)); dy = -28 * ease(u)
        w, h = hp.size; hw, hh = max(1, round(w * k * s)), max(1, round(h * k * s))
        cx, cy = ox + (box[0] + box[2]) / 2 * k, oy + (box[1] + box[3]) / 2 * k + dy
        big.alpha_composite(hp.resize((hw, hh), Image.LANCZOS).rotate(8 * math.sin(2 * math.pi * (u + j * .3)), expand=True), (round(cx - hw / 2), round(cy - hh / 2)))
    big.save(f"{a.out}/{i+1:02d}.png")
ms = [80, 80, 90] * 8
json.dump(dict(ms=ms, note="사인 왕복이라 양 끝(기운 자세)에서 칸 간격이 좁아져 홀드처럼 보인다"), open(f"{a.out}/ms.json", "w"))
print("ok", N, "frames", sum(ms), "ms")
