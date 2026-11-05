"""투명 스티커 한 장 → 캐릭터(가장 큰 덩어리)와 나머지 덩어리(글자·효과)로 나눈다. 생성 없음.
사용: python3 split_sticker.py sticker.png out_dir [--scale 3]
출력: out_dir/char.png(글자·효과 뺀 캐릭터, 투명), char_ref.png(흰 바탕, scale 배 — image_gen 레퍼런스용),
      out_dir/parts/NN.png(나머지 덩어리 각각, 투명·잘라낸 크기) + parts.json(원래 위치·크기·평균색)."""
import argparse, json, os
from collections import deque
import numpy as np
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("out"); ap.add_argument("--scale", type=int, default=3)
ap.add_argument("--alpha", type=int, default=24, help="이 값 넘는 알파를 덩어리로 본다")
a = ap.parse_args(); os.makedirs(f"{a.out}/parts", exist_ok=True)
im = Image.open(a.src).convert("RGBA"); A = np.asarray(im); H, W = A.shape[:2]
fg = A[..., 3] > a.alpha
lab = np.zeros((H, W), int); n = 0
for y in range(H):
    for x in range(W):
        if fg[y, x] and not lab[y, x]:
            n += 1; q = deque([(y, x)]); lab[y, x] = n
            while q:
                cy, cx = q.popleft()
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and fg[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; q.append((ny, nx))
sizes = np.bincount(lab.ravel())[1:]; main = int(np.argmax(sizes)) + 1
def save_mask(mask, path, crop=False):
    B = A.copy(); B[..., 3] = np.where(mask, A[..., 3], 0); img = Image.fromarray(B, "RGBA")
    if crop:
        ys, xs = np.where(mask); box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1); img = img.crop(box); return img, box
    img.save(path); return img, None
char, _ = save_mask(lab == main, f"{a.out}/char.png")
ref = Image.new("RGBA", char.size, (255, 255, 255, 255)); ref.alpha_composite(char)
ref = ref.convert("RGB").resize((W * a.scale, H * a.scale), Image.LANCZOS); ref.save(f"{a.out}/char_ref.png")
meta = []
for k in range(1, n + 1):
    if k == main or sizes[k - 1] < 30: continue
    img, box = save_mask(lab == k, None, crop=True)
    px = A[lab == k][:, :3]; i = len(meta) + 1
    img.save(f"{a.out}/parts/{i:02d}.png")
    meta.append(dict(id=f"{i:02d}", box=[int(v) for v in box], area=int(sizes[k - 1]), color="#%02x%02x%02x" % tuple(int(v) for v in px.mean(0))))
json.dump(dict(size=[W, H], char_area=int(sizes[main - 1]), parts=meta), open(f"{a.out}/parts.json", "w"), indent=1)
print(f"char {sizes[main-1]}px, parts {len(meta)}", [(m['id'], m['box'], m['color']) for m in meta])
