"""프레임 PNG 들 → 360x360 흰 배경 GIF + 검수 시트.
  python3 assemble.py 프레임폴더|파일들… --id 04 [--hold 3,1,1,3] [--pingpong]
                      [--align bbox|centroid|none] [--normalize area|height|none]
결과: <gif-exp>/out/<id>.gif, <id>_sheet.png
- 입력은 이름순. 알파가 없으면 흰 배경을 누끼한다(테두리에 닿은 흰색만).
- --hold: 틱 수(12fps 기준 1틱=83ms). 한 숫자면 전 프레임 동일, 쉼표 목록이면 프레임별(pingpong 전 기준).
- --pingpong: 0..n-1 다음 n-2..1 로 되돌아온다(끝 프레임 중복 없음).
- 몸 정렬(--align): 프레임마다 캐릭터(가장 큰 성분) bbox 의 바닥과 가로 중심을 첫 프레임 자리에.
  centroid 는 가로 중심을 무게중심으로(팔을 든 프레임에서 몸이 옆으로 밀리지 않게).
- 크기 정규화(--normalize): 첫 프레임 크기로 맞춘다. area=불투명 면적의 제곱근(팔 들기·스쿼시에 덜 흔들림),
  height=bbox 높이. none 이면 첫 프레임의 배율을 전 프레임에 그대로.
- 첫 프레임 배율은 bbox 가 --fill(기본 0.86) × 360 안에 들어가게 정한다.
"""
import argparse, glob, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from common import SIZE, load_rgba, body_bbox, save_gif, save_sheet

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def collect(inputs):
    files = []
    for p in inputs:
        files += sorted(glob.glob(os.path.join(p, "*.png"))) if os.path.isdir(p) else [p]
    return files


def centroid_x(im):
    a = np.asarray(im)[..., 3].astype(np.float64)
    return float((a.sum(0) * np.arange(a.shape[1])).sum() / max(a.sum(), 1))


def place_all(ims, a):
    info = [body_bbox(im) for im in ims]
    (bx0, by0, bx1, by1), area0 = info[0]
    w0, h0 = bx1 - bx0, by1 - by0
    s0 = a.fill * SIZE / max(w0, h0)

    # 첫 프레임 bbox 를 캔버스 가로 중앙·바닥선에 놓는다
    ground = a.bottom * SIZE
    if h0 * s0 > ground: ground = (SIZE + h0 * s0) / 2   # 키가 크면 세로 중앙
    cx_t = SIZE / 2
    frames = []
    for im, ((x0, y0, x1, y1), area) in zip(ims, info):
        if a.normalize == "area": s = s0 * (area0 / max(area, 1)) ** 0.5
        elif a.normalize == "height": s = s0 * h0 / max(y1 - y0, 1)
        else: s = s0 * (im.width / ims[0].width)   # 원본 해상도 차이만 보정
        sim = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        if a.align == "none":
            # 원본 캔버스 중앙 기준으로 첫 프레임과 같은 자리
            ox = cx_t - (bx0 + bx1) / 2 * s0 + (ims[0].width * s0 - sim.width) / 2
            oy = ground - by1 * s0 + (ims[0].height * s0 - sim.height) / 2
        else:
            if a.align == "ground":   # 가로는 원본 칸의 자리 그대로, 바닥만 맞춘다(사이클 동작)
                cx = (bx0 + bx1) / 2 * (im.width / ims[0].width)
            else:
                cx = (x0 + x1) / 2 if a.align == "bbox" else centroid_x(im)
            ox, oy = cx_t - cx * s, ground - y1 * s
            if a.align == "centroid":   # 기준점은 첫 프레임의 무게중심 자리
                ox += ((bx0 + bx1) / 2 - centroid_x(ims[0])) * s0
        canvas = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
        canvas.paste(sim.convert("RGB"), (round(ox), round(oy)), sim)   # 음수 좌표도 된다
        frames.append(canvas)
    return frames


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--id", required=True)
    ap.add_argument("--hold", default="1")
    ap.add_argument("--pingpong", action="store_true")
    ap.add_argument("--align", choices=["bbox", "centroid", "ground", "none"], default="bbox")
    ap.add_argument("--raw", action="store_true", help="이미 360² 흰 바탕 프레임 — 배치 없이 그대로 조립(FILM 출력용)")
    ap.add_argument("--frames-out", help="GIF 대신 정규화된 360² 흰 바탕 프레임 PNG 를 이 폴더에(FILM 키 준비용)")
    ap.add_argument("--normalize", choices=["area", "height", "none"], default="area")
    ap.add_argument("--fill", type=float, default=0.86)
    ap.add_argument("--bottom", type=float, default=0.95, help="바닥선 위치(캔버스 높이 비율)")
    ap.add_argument("--out", default=os.path.join(ROOT, "out"))
    a = ap.parse_args()

    files = collect(a.inputs)
    if not files: sys.exit("프레임이 없다")
    if a.raw:
        ims = None
        frames = [Image.open(f).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS) for f in files]
    else:
        ims = [load_rgba(f) for f in files]
    hs = [int(x) for x in a.hold.split(",")]
    holds = hs * len(files) if len(hs) == 1 else hs
    if len(holds) != len(files): sys.exit(f"--hold {len(holds)}개 ≠ 프레임 {len(files)}개")
    if not a.raw: frames = place_all(ims, a)
    if a.frames_out:
        os.makedirs(a.frames_out, exist_ok=True)
        for i, f in enumerate(frames): f.save(os.path.join(a.frames_out, f"k{i:02d}.png"))
        print(f"{len(frames)} keys → {a.frames_out}"); return

    if a.pingpong and len(frames) > 2:
        back = list(range(len(frames) - 2, 0, -1))
        frames += [frames[i] for i in back]; holds += [holds[i] for i in back]

    os.makedirs(a.out, exist_ok=True)
    gif, sheet = os.path.join(a.out, f"{a.id}.gif"), os.path.join(a.out, f"{a.id}_sheet.png")
    save_gif(frames, holds, gif); save_sheet(frames, holds, sheet)
    ticks = sum(holds)
    print(f"{gif}  {len(frames)} frames, {ticks} ticks = {ticks / 12:.2f}s")
    if not 18 <= ticks <= 24: print(f"주의: 1.5~2초(18~24틱) 밖이다 — {ticks}틱")


if __name__ == "__main__":
    main()
