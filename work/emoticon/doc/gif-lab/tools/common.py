"""gif-exp 공용: 누끼·연결성분·GIF 저장·검수 시트. Pillow + numpy 만 쓴다."""
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

SIZE, FPS = 360, 12
TICK_MS = 1000 / FPS          # 83.33ms
LINE = (0x2c, 0x24, 0x1e)


def load_rgba(path, white_thresh=245):
    """RGBA 로 읽는다. 알파가 없거나 전부 불투명이면 테두리에 닿은 흰 영역만 지워 누끼한다."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)
    if a[..., 3].min() == 255:
        im = cutout_white(im, white_thresh)
    return im


def cutout_white(im, thresh=245):
    """테두리에서 출발해 흰색(≥thresh)으로 이어진 영역만 투명하게(속의 흰 하이라이트는 남긴다)."""
    a = np.array(im.convert("RGBA"))
    white = (a[..., :3] >= thresh).all(-1)
    bg = flood(white, seeds="border")
    a[bg, 3] = 0
    return Image.fromarray(a, "RGBA")


def flood(mask, seeds="border"):
    """mask 위에서 seeds 와 4-연결된 영역. seeds='border' 면 가장자리 픽셀들."""
    h, w = mask.shape
    out = np.zeros_like(mask, bool)
    q = deque()
    if seeds == "border":
        for x in range(w):
            for y in (0, h - 1):
                if mask[y, x] and not out[y, x]: out[y, x] = True; q.append((y, x))
        for y in range(h):
            for x in (0, w - 1):
                if mask[y, x] and not out[y, x]: out[y, x] = True; q.append((y, x))
    else:
        for y, x in seeds: out[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True; q.append((ny, nx))
    return out


def components(mask):
    """8-연결 성분 라벨(0=배경), 성분 크기 리스트."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32); sizes = [0]
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]: continue
        n = len(sizes); lab[y0, x0] = n; q = deque([(y0, x0)]); c = 0
        while q:
            y, x = q.popleft(); c += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y+dy, x+dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n; q.append((ny, nx))
        sizes.append(c)
    return lab, sizes


def dilate(mask, r):
    """정사각 r 팽창(numpy 시프트 — scipy 없이)."""
    out = mask.copy()
    for _ in range(r):
        m = out.copy()
        m[1:] |= out[:-1]; m[:-1] |= out[1:]; m[:, 1:] |= out[:, :-1]; m[:, :-1] |= out[:, 1:]
        out = m
    return out


def keep_largest(im, halo=8, white=235):
    """가장 큰 잉크 덩어리(=캐릭터)만 남긴다 — 글자·반짝이 같은 떨어진 조각 제거.
    스티커의 흰 테두리가 글자와 몸을 이어 붙이므로 흰색이 아닌 픽셀로 성분을 찾고,
    그 덩어리를 halo px 넓힌 범위의 원래 알파(흰 테두리 포함)를 살린다."""
    a = np.array(im)
    ink = (a[..., 3] >= 128) & ~(a[..., :3] >= white).all(-1)
    lab, sizes = components(ink)
    if len(sizes) <= 1: return im
    body = lab == (int(np.argmax(sizes[1:])) + 1)
    # 몸 안의 흰 하이라이트(눈 등)는 잉크가 아니라 성분에서 빠지니 구멍을 메운 뒤 팽창
    body = ~flood(~body, seeds="border")
    a[~dilate(body, halo), 3] = 0
    out = Image.fromarray(a, "RGBA")
    return out.crop(out.getbbox())


def body_bbox(im, min_alpha=128, largest=True):
    """캐릭터 bbox. largest 면 가장 큰 성분만(이펙트·파편이 정렬을 흔들지 않게)."""
    m = np.asarray(im)[..., 3] >= min_alpha
    if largest:
        lab, sizes = components(m)
        if len(sizes) > 1: m = lab == (int(np.argmax(sizes[1:])) + 1)
    ys, xs = np.nonzero(m)
    if len(ys) == 0: return (0, 0, im.width, im.height), 0
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), int(m.sum())


def on_white(im):
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im.convert("RGBA"))
    return bg.convert("RGB")


def durations(holds):
    """틱 수 → GIF 프레임 ms. 누적 시각을 10ms 로 반올림해 12fps 를 오차 없이 맞춘다."""
    out, t = [], 0
    for h in holds:
        a = round(t * TICK_MS / 10) * 10; t += h
        b = round(t * TICK_MS / 10) * 10
        out.append(b - a)
    return out


def save_gif(frames, holds, path):
    """흰 배경 RGB 프레임들 → GIF. 전 프레임 공통 팔레트(프레임마다 색이 끓지 않게)."""
    rgb = [f.convert("RGB") for f in frames]
    w, h = rgb[0].size
    mosaic = Image.new("RGB", (w, h * len(rgb)))
    for i, f in enumerate(rgb): mosaic.paste(f, (0, h * i))
    pal = mosaic.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in rgb]
    q[0].save(path, save_all=True, append_images=q[1:], duration=durations(holds),
              loop=0, disposal=1, optimize=False)


def save_sheet(frames, holds, path, cell=180):
    """검수용: 프레임을 가로로 늘어놓고 아래에 번호·hold 를 적는다."""
    n = len(frames)
    sheet = Image.new("RGB", (cell * n, cell + 16), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, (f, h) in enumerate(zip(frames, holds)):
        sheet.paste(f.convert("RGB").resize((cell, cell), Image.LANCZOS), (cell * i, 0))
        d.line([(cell * i, 0), (cell * i, cell + 16)], fill=(220, 220, 220))
        d.text((cell * i + 4, cell + 2), f"{i} x{h}", fill=LINE)
    sheet.save(path)
