"""러프(밑그림)와 클린업 시트의 하반신을 같은 칸끼리 위아래로 붙여 확대 — passing 전후에 다리가 바뀌었는지 눈으로 본다.
사용: python3 passing_zoom.py 러프.png 클린업.png 출력.jpg [칸 목록, 기본 7,8,9,10,11,18,19,20,21,24,1]"""
import sys
from PIL import Image, ImageDraw
rough, clean, out = sys.argv[1:4]; ids = [int(x) for x in (sys.argv[4] if len(sys.argv) > 4 else "7,8,9,10,11,18,19,20,21,24,1").split(",")]
U, S = Image.open(rough).convert("RGB"), Image.open(clean).convert("RGB")
def cell(im, i):
    cw, ch = im.width // 6, im.height // 4; r, c = divmod(i - 1, 6)
    return im.crop((c * cw + cw * 40 // 256, r * ch + ch * 150 // 256, c * cw + cw * 210 // 256, (r + 1) * ch)).resize((170, 106))
g = Image.new("RGB", (len(ids) * 170, 2 * 130 + 20), "white"); d = ImageDraw.Draw(g)
for k, i in enumerate(ids):
    g.paste(cell(U, i), (k * 170, 18)); g.paste(cell(S, i), (k * 170, 150)); d.text((k * 170 + 3, 2), f"#{i} rough / clean", fill="red")
g.resize((g.width * 5 // 4, g.height * 5 // 4)).save(out, quality=85); print(out)
