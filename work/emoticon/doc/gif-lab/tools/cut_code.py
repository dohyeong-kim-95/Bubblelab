"""방법 C(코드만) 컷. 생성 호출 0.
  python3 cut_code.py 11 [--base refs/dg1-07.png]   # 통통 튀기: 스쿼시&스트레치 + 그림자
  python3 cut_code.py 13 [--base …]                 # 하트: 하트 2~3개가 떠오르며 커지고 사라짐 + 숨쉬기
결과 out/<id>.gif + out/<id>_sheet.png. 베이스는 누끼 후 가장 큰 덩어리만(글자·반짝이 제거).
"""
import argparse, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from common import SIZE, load_rgba, keep_largest, save_gif, save_sheet

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N = 24                     # 12fps × 2초
SS = 4                     # 도형 슈퍼샘플
LINE = (0x2c, 0x24, 0x1e)
HEART = (0xe8, 0x4a, 0x4f)
HEART_HI = (0xf4, 0x78, 0x76)   # tokens blush


def base_sprite(path, height):
    im = keep_largest(load_rgba(path))
    s = height / im.height
    return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)


def place(canvas, sprite, sx, sy, foot_x, foot_y):
    """sprite 를 (sx, sy) 배율로, 바닥 가운데가 (foot_x, foot_y) 에 오게 붙인다."""
    w, h = max(1, round(sprite.width * sx)), max(1, round(sprite.height * sy))
    sp = sprite.resize((w, h), Image.LANCZOS)
    canvas.paste(sp.convert("RGB"), (round(foot_x - w / 2), round(foot_y - h)), sp)


def ellipse_layer(cx, cy, rx, ry, color, alpha):
    lay = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
    ImageDraw.Draw(lay).ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS],
                                fill=color + (round(255 * alpha),))
    return lay.resize((SIZE, SIZE), Image.LANCZOS)


def ease_out(t): return 1 - (1 - t) ** 2


# ─── 11 통통 튀기 ────────────────────────────────────────────────
def bounce(base):
    """12틱 주기 × 2회. 0틱 착지(가장 납작) → 1틱 덜 납작 → 2~11틱 공중(포물선).
    늘어남은 속도에 비례(뜨고 내릴 때 길쭉, 꼭대기에서 원형), 부피는 sx·sy=1 로 보존."""
    spr = base_sprite(base, 250)
    ground, jump = 338, 62
    frames = []
    for f in range(N):
        i = f % 12
        if i == 0: sy, lift = 0.80, 0            # 착지 — 납작
        elif i == 1: sy, lift = 0.90, 0          # 튕겨 오를 준비
        else:
            u = (i - 1) / 11                     # 공중 진행 0→1 (i=12 가 다음 착지)
            lift = jump * 4 * u * (1 - u)
            v = abs(1 - 2 * u)                   # 정규화 속도
            sy = 1 + 0.10 * v                    # 빠를 때 길쭉
        sx = 1 / sy
        c = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
        # 그림자: 높이 뜰수록 작고 옅게
        k = 1 - lift / jump
        c.paste(ellipse_layer(SIZE / 2, ground - 2, 70 + 30 * k * sx, 9 + 3 * k, LINE, 0.10 + 0.12 * k), (0, 0),
                ellipse_layer(SIZE / 2, ground - 2, 70 + 30 * k * sx, 9 + 3 * k, LINE, 0.10 + 0.12 * k))
        place(c, spr, sx, sy, SIZE / 2, ground - lift)
        frames.append(c)
    return frames


# ─── 13 하트 ─────────────────────────────────────────────────────
def heart_poly(cx, cy, size, n=60):
    """파라메트릭 하트. size = 대략 가로 폭."""
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * size / 34, cy - y * size / 34))
    return pts


def heart_layer(cx, cy, size, alpha, tilt):
    lay = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    pts = heart_poly(cx * SS, cy * SS, size * SS)
    ca, sa = math.cos(tilt), math.sin(tilt)
    pts = [(cx * SS + (x - cx * SS) * ca - (y - cy * SS) * sa, cy * SS + (x - cx * SS) * sa + (y - cy * SS) * ca) for x, y in pts]
    d.polygon(pts, fill=HEART + (255,), outline=LINE + (255,), width=max(2, round(size * SS / 14)))
    # 하이라이트 한 점(손그림 스티커 느낌)
    hx, hy = cx - size * 0.22, cy - size * 0.12
    r = size * 0.09
    d.ellipse([(hx - r) * SS, (hy - r) * SS, (hx + r) * SS, (hy + r) * SS], fill=(255, 255, 255, 220))
    lay = lay.resize((SIZE, SIZE), Image.LANCZOS)
    if alpha < 1:
        a = np.array(lay); a[..., 3] = (a[..., 3] * alpha).astype(np.uint8); lay = Image.fromarray(a, "RGBA")
    return lay


def hearts(base):
    """하트 3개가 8틱 간격으로 태어나 16틱 동안 떠오르며 커지고, 끝에 오그라들어 사라진다 — 주기 24틱이라 이음매 없이 돈다.
    캐릭터는 24틱에 한 번 숨쉬기(세로 +1.5%, 가로 -0.7%, 바닥 고정)."""
    spr = base_sprite(base, 262)
    ground = 352
    head_top = ground - spr.height
    # (태어나는 틱, 시작 x, 흔들림 방향, 최종 크기)
    H = [(0, 282, 1, 42), (8, 314, -1, 32), (16, 262, 1, 36)]
    LIFE = 16
    frames = []
    for f in range(N):
        b = math.sin(2 * math.pi * f / N)
        sy = 1 + 0.015 * b; sx = 1 - 0.007 * b
        c = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
        place(c, spr, sx, sy, SIZE / 2 - 24, ground)
        for born, x0, dirn, size in H:
            age = (f - born) % N
            if age >= LIFE: continue
            t = age / (LIFE - 1)
            y = head_top + 40 - 105 * ease_out(t)            # 귀 옆에서 위로
            x = x0 + dirn * 10 * math.sin(t * math.pi * 1.5)  # 살랑
            # 반투명 페이드는 GIF 공용 팔레트에서 분홍이 베이지로 떨어진다 → 크기로만 나타나고 사라진다
            grow = 0.35 + 0.65 * ease_out(min(1, t * 1.6))
            pop = 1 if t < 0.75 else max(0, (1 - t) / 0.25) ** 0.7
            sz, al = size * grow * pop, 1
            if sz < 4: continue
            lay = heart_layer(x, y, sz, al, dirn * 0.18 * math.sin(t * math.pi * 2))
            c.paste(lay.convert("RGB"), (0, 0), lay)
        frames.append(c)
    return frames


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id", choices=["11", "13"])
    ap.add_argument("--base", default=os.path.join(ROOT, "refs/dg1-07.png"))
    ap.add_argument("--out", default=os.path.join(ROOT, "out"))
    a = ap.parse_args()
    frames = bounce(a.base) if a.id == "11" else hearts(a.base)
    holds = [1] * len(frames)
    os.makedirs(a.out, exist_ok=True)
    save_gif(frames, holds, os.path.join(a.out, f"{a.id}.gif"))
    save_sheet(frames, holds, os.path.join(a.out, f"{a.id}_sheet.png"), cell=120)
    print(f"out/{a.id}.gif  {len(frames)} frames, {sum(holds) / 12:.2f}s")


if __name__ == "__main__":
    main()
