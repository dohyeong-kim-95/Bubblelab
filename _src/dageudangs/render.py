# 다그당스 인스타툰 렌더러 — dageudangs/episodes.json 의 컷을 1080×1350(4:5) JPEG 로 굽는다.
# 글자는 전부 여기서 폰트로 넣는다(그림 생성기가 쓴 글자는 맞춤법이 깨진다).
# usage: python3 _src/dageudangs/render.py [ep01 …]   (Pillow 필요)
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(__file__).resolve().parent
OUT = ROOT / "dageudangs"
W, H = 1080, 1350
M = 54                      # 종이 여백
PAPER, INK, WHITE = "#fbf6ec", "#2a2620", "#ffffff"
ACCENT = "#c8742f"
FONT = str(SRC / "fonts" / "Jua-Regular.ttf")


def font(size):
    return ImageFont.truetype(FONT, size)


def text_box(d, xy, text, size, pad=(34, 22), fill=WHITE, ink=INK, shadow=8, anchor="lt"):
    """테두리 친 글상자(만화 내레이션 칸). 그림자는 잉크색으로 오른쪽 아래에 깐다."""
    f = font(size)
    l, t, r, b = d.multiline_textbbox((0, 0), text, font=f, spacing=size // 4)
    w, h = r - l + pad[0] * 2, b - t + pad[1] * 2
    x, y = xy
    if anchor == "mt":
        x -= w // 2
    if shadow:
        d.rounded_rectangle((x + shadow, y + shadow, x + w + shadow, y + h + shadow), 18, fill=ink)
    d.rounded_rectangle((x, y, x + w, y + h), 18, fill=fill, outline=ink, width=5)
    d.multiline_text((x + pad[0] - l, y + pad[1] - t), text, font=f, fill=ink if fill == WHITE else WHITE,
                     spacing=size // 4)
    return x, y, x + w, y + h


def say_bubble(d, text, panel):
    """화면 밖(오른쪽) 인물의 말풍선 — 꼬리가 패널 오른쪽 가장자리로 나간다."""
    f = font(50)
    l, t, r, b = d.multiline_textbbox((0, 0), text, font=f, spacing=12)
    w, h = r - l + 76, b - t + 52
    x1 = panel[2] - 90
    x0, y0 = x1 - w, 250
    ym = y0 + h // 2
    d.rounded_rectangle((x0, y0, x1, y0 + h), h // 2, fill=WHITE, outline=INK, width=5)
    # 꼬리: 밑변을 풍선 안쪽에 묻어 테두리를 덮고, 바깥 두 변만 잉크로 긋는다
    base_a, base_b, tip = (x1 - 14, ym - 4), (x1 - 14, ym + 34), (panel[2] - 8, ym + 70)
    d.polygon([base_a, tip, base_b], fill=WHITE)
    d.line([base_a, tip, base_b], fill=INK, width=5, joint="curve")
    d.multiline_text((x0 + 38 - l, y0 + 26 - t), text, font=f, fill=INK, spacing=12, align="center")


def render_cut(ep, i, cut):
    img = Image.new("RGB", (W, H), PAPER)
    panel = (M, M, W - M, H - M)
    # 배경: 벽 + 바닥 띠, 둥근 패널 모양으로 잘라 붙인다
    scene = Image.new("RGB", (W, H), cut["bg"])
    ImageDraw.Draw(scene).rectangle((0, int(H * 0.72), W, H), fill=cut["floor"])
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(panel, 40, fill=255)
    img.paste(scene, (0, 0), mask)

    art = Image.open(SRC / "art" / f"{cut['art']}.png").convert("RGBA")
    box_w, box_h = 880, panel[3] - panel[1] - 330
    s = min(box_w / art.width, box_h / art.height)
    art = art.resize((round(art.width * s), round(art.height * s)), Image.LANCZOS)
    img.paste(art, ((W - art.width) // 2, panel[3] - 46 - art.height), art)

    d = ImageDraw.Draw(img)
    d.rounded_rectangle(panel, 40, outline=INK, width=7)
    y = M + 42
    if i == 0 and ep.get("kind") != "zzal":  # 화의 첫 장은 제목 (짤은 한 장이라 없음)
        tag = text_box(d, (M + 42, y), f"{ep['no']}화", 40, pad=(24, 12), fill=ACCENT, shadow=0)
        d.text((tag[2] + 22, (tag[1] + tag[3]) // 2), ep["title"], font=font(56), fill=INK, anchor="lm")
        y = tag[3] + 30
    text_box(d, (M + 42, y), cut["narr"], 54)
    if cut.get("say"):
        say_bubble(d, cut["say"], panel)
    if cut.get("end"):
        text_box(d, (W // 2, panel[3] - 130), cut["end"], 46, pad=(36, 18), fill=INK, shadow=0, anchor="mt")
    page = f"  {i + 1}/{len(ep['cuts'])}" if len(ep["cuts"]) > 1 else ""
    d.text((panel[2] - 26, panel[3] - 20), f"@{ACCOUNT['handle']}{page}",
           font=font(28), fill=INK, anchor="rb")
    return img


data = json.loads((OUT / "episodes.json").read_text())
ACCOUNT = data["account"]
want = set(sys.argv[1:])
for ep in data["episodes"]:
    if want and ep["id"] not in want:
        continue
    (OUT / ep["id"]).mkdir(exist_ok=True)
    for i, cut in enumerate(ep["cuts"]):
        render_cut(ep, i, cut).save(OUT / ep["id"] / f"{i + 1:02d}.jpg", quality=88, optimize=True, progressive=True)
    print(ep["id"], len(ep["cuts"]), "컷")
