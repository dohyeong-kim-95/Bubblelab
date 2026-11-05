"""시트 → GIF (실험 A 방식: 칸 안 위치 그대로, 프레임별 정렬 없음).
  python3 sheet.py sheet.png out.gif [--rows 4 --cols 6]   # 생략하면 흰 여백으로 격자 감지 [--ms 50] [--size 360] [--center union|none] [--cells 폴더]
- 시트를 rows×cols 로 등분, 읽는 순서는 좌→우·위→아래.
- 모든 칸에 같은 배율 size/max(칸 폭, 칸 높이) — 칸 정사각형이 360² 를 꽉 채운다.
- --center union(기본): 전 프레임 비흰 영역 합집합의 가로 중심을 캔버스 가운데로 옮기는 이동 하나를 모든 프레임에 똑같이.
  (프레임 사이 상대 위치는 그대로라 정렬이 아니다.) none 이면 칸 그대로.
- --center frame-x: 프레임마다 비흰 bbox 의 가로 중심을 캔버스 가운데로(세로는 그대로). 실험 A 의 A.gif 가
  실제로 이 방식이다(A/notes.md: 전경 = RGB 최솟값 <220, x 중심 → 179.5. A.gif 를 칸 그대로 조립본과 비교하면 프레임별 가로 이동 −12~+9px, 되돌리면 잔차 0.8).
- 흰 바탕, 전 프레임 공통 팔레트.
"""
import argparse, os
import numpy as np
from PIL import Image


def runs(prof, min_gap):
    n, start, gap = 0, None, 0
    for v in prof:
        if v:
            if start is None: n += 1; start = True
            gap = 0
        elif start:
            gap += 1
            if gap >= min_gap: start = None
    return n


def detect_grid(sh, white):
    """흰 여백 띠로 행·열 수를 센다(칸 안 캐릭터가 여백으로 떨어져 있어야 한다)."""
    m = (np.asarray(sh) < white).any(-1)
    gap = max(4, min(sh.size) // 100)
    return runs(m.any(1), gap), runs(m.any(0), gap)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet"); ap.add_argument("out")
    ap.add_argument("--rows", type=int, default=0); ap.add_argument("--cols", type=int, default=0)
    ap.add_argument("--ms", type=int, default=50); ap.add_argument("--size", type=int, default=360)
    ap.add_argument("--center", choices=["union", "frame-x", "none"], default="union")
    ap.add_argument("--white", type=int, default=240)
    ap.add_argument("--cells", help="칸 이미지(원본 해상도)를 여기에 저장")
    a = ap.parse_args()
    sh = Image.open(a.sheet).convert("RGB"); W, H = sh.size
    if not (a.rows and a.cols):
        a.rows, a.cols = detect_grid(sh, a.white)
        print(f"격자 자동 감지: {a.rows}x{a.cols}")
    cw, ch = W / a.cols, H / a.rows
    cells = [sh.crop((round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch)))
             for r in range(a.rows) for c in range(a.cols)]
    if a.cells:
        os.makedirs(a.cells, exist_ok=True)
        for i, c in enumerate(cells): c.save(os.path.join(a.cells, f"c{i:02d}.png"))
    s = a.size / max(cw, ch)
    scaled = [c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS) for c in cells]
    dx = dy = 0
    if a.center == "union":
        m = np.zeros((scaled[0].height, scaled[0].width), bool)
        for c in scaled:
            arr = (np.asarray(c.resize(scaled[0].size)) < a.white).any(-1); m |= arr
        xs = np.nonzero(m.any(0))[0]
        dx = round(a.size / 2 - (xs.min() + xs.max() + 1) / 2)
    frames = []
    for c in scaled:
        fx = dx
        if a.center == "frame-x":
            # A/notes.md 의 정의 그대로: RGB 최솟값 < 220 픽셀의 x 범위 중심을 (size-1)/2 에 맞추는 정수 이동
            xs = np.nonzero((np.asarray(c).min(-1) < 220).any(0))[0]
            fx = round((a.size - 1) / 2 - (xs.min() + xs.max()) / 2) if len(xs) else 0
        cv = Image.new("RGB", (a.size, a.size), (255, 255, 255))
        cv.paste(c, (fx + (a.size - c.width) // 2, dy + (a.size - c.height) // 2)); frames.append(cv)
    mosaic = Image.new("RGB", (a.size, a.size * len(frames)))
    for i, f in enumerate(frames): mosaic.paste(f, (0, a.size * i))
    pal = mosaic.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    q[0].save(a.out, save_all=True, append_images=q[1:], duration=a.ms, loop=0, disposal=1)
    print(f"{a.out}  {len(frames)} frames × {a.ms}ms, scale {s:.3f}, center {a.center}" + (f" shift x {dx:+d}" if a.center == "union" else ""))


if __name__ == "__main__":
    main()
