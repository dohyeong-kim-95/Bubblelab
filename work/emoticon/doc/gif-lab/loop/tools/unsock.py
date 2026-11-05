"""추적용 초록 양말(#00c000 계열)을 발굽 색(#655846)으로 되돌린다. 시트 단위로 처리한다.
초록 정도 w = 초록 우세 비율 (G-max(R,B))/G 에서 (0~1). 초록인 만큼 발굽 색으로 바꾸되, 원래 밝기 변화(색연필 질감)는 남긴다.
사용: python3 unsock.py in.png out.png [마스크.png]   — 마스크에는 바뀐 픽셀(초록 정도)을 흰색으로 남긴다(확인용)."""
import sys
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
a = np.asarray(Image.open(src).convert("RGB")).astype(float)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
r = (G - np.maximum(R, B)) / np.maximum(G, 1)            # 초록 우세 비율 — 어두운 초록 외곽선도 잡힌다
w = np.clip((r - 0.15) / 0.35, 0, 1)[..., None]
lum = (0.3 * R + 0.59 * G + 0.11 * B)[..., None]
ref = np.median(lum[w[..., 0] > 0.8]) if (w > 0.8).any() else 120.0
hoof = np.array([0x65, 0x58, 0x46], float)
target = np.clip(hoof * (lum / ref), 0, 255)          # 양말 안의 밝기 결을 발굽 색으로 옮긴다
out = a * (1 - w) + target * w
Image.fromarray(out.round().astype(np.uint8)).save(dst)
if len(sys.argv) > 3: Image.fromarray((w[..., 0] * 255).astype(np.uint8)).save(sys.argv[3])
print("green px(w>0.5):", int((w > 0.5).sum()), "ref lum", round(float(ref), 1))
