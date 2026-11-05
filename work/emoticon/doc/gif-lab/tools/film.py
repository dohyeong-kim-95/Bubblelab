"""키 프레임 폴더 → FILM 보간 프레임 폴더 (키 사이에 n-1장씩 = n배).
  FILMPY=<tensorflow·tensorflow_hub 가 든 가상환경>/bin/python
  $FILMPY film.py 키폴더 출력폴더 --n 3 [--loop] [--white]
- 입력은 이름순 PNG. 크기가 다르면 첫 장 크기로 맞춘다.
- RGB(흰 바탕 합성)와 알파를 따로 보간한다(마스터의 film_interp.py 방식). --white 면 알파 없이 흰 바탕만.
- --loop: 마지막 → 첫 키 사이도 채운다(루프 GIF 용). 없으면 마지막 키에서 끝.
- 출력: 출력폴더/f000.png … + holds.txt(키는 K, 보간은 i 로 표시 — assemble 의 --hold 조합 참고용)
- 무겁다: 당이(llama-server) 돌 때 동시에 돌리지 말 것.
"""
import argparse, glob, os, sys, time
import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--white", action="store_true")
    ap.add_argument("--model", default="https://tfhub.dev/google/film/1")
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.src, "*.png")))
    if len(files) < 2: sys.exit("키 프레임이 2장 이상 필요하다")
    first = Image.open(files[0]); W, H = first.size
    keys = [np.asarray(Image.open(f).convert("RGBA").resize((W, H), Image.LANCZOS), np.float32) / 255 for f in files]

    import tensorflow as tf, tensorflow_hub as hub   # 무거운 import 는 인자 검사 뒤에
    model = hub.load(a.model)
    P = 64; PH, PW = -(-H // P) * P, -(-W // P) * P
    pad = lambda x: np.pad(x, ((0, PH - H), (0, PW - W), (0, 0)), mode="edge")
    rgb = lambda f: f[..., :3] * f[..., 3:] + (1 - f[..., 3:])
    alpha3 = lambda f: np.repeat(f[..., 3:], 3, -1)

    def mids(x, y):
        # 중간 프레임을 한 장씩(색+알파 2장 배치) — 몰아서 돌리면 메모리가 터졌다
        x0 = np.stack([pad(rgb(x)), pad(alpha3(x))]); x1 = np.stack([pad(rgb(y)), pad(alpha3(y))])
        res = []
        for k in range(1, a.n):
            t = np.full((2, 1), k / a.n, np.float32)
            r = model({"x0": x0, "x1": x1, "time": t})["image"].numpy()[:, :H, :W]
            res.append(np.concatenate([np.clip(r[0], 0, 1), np.clip(r[1].mean(-1, keepdims=True), 0, 1)], -1))
        return res

    def to_pil(f):
        arr = (np.clip(f, 0, 1) * 255).astype(np.uint8)
        if a.white:
            return Image.fromarray(np.ascontiguousarray(arr[..., :3]) if arr[..., 3].min() == 255
                                   else (rgb(f) * 255).astype(np.uint8), "RGB")
        return Image.fromarray(arr, "RGBA")

    os.makedirs(a.out, exist_ok=True)
    pairs = len(keys) if a.loop else len(keys) - 1
    seq, tags, t0 = [], [], time.time()
    for i in range(pairs):
        seq.append(keys[i]); tags.append("K")
        for m in mids(keys[i], keys[(i + 1) % len(keys)]): seq.append(m); tags.append("i")
        print(f"pair {i + 1}/{pairs} {time.time() - t0:.0f}s", flush=True)
    if not a.loop: seq.append(keys[-1]); tags.append("K")
    for j, f in enumerate(seq): to_pil(f).save(os.path.join(a.out, f"f{j:03d}.png"))
    open(os.path.join(a.out, "holds.txt"), "w").write(" ".join(tags) + "\n")
    print(f"done {len(seq)} frames ({len(keys)} keys × n={a.n}{', loop' if a.loop else ''}) {time.time() - t0:.0f}s → {a.out}")


if __name__ == "__main__":
    main()
