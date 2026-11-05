"""바닥 그림자 고정(08 호이잇! 피드백 '그림자까지 점프', 2026-11-06).
다듬기가 칸마다 발밑에 그린 그림자는 몸과 같이 떠오른다 → 칸마다 그림자(밝은 무채색 연필 자국, 캐릭터 아래쪽)를 지우고,
착지 칸(--ref)의 그림자 한 장을 바닥 높이에 고정해 다시 얹는다. 몸이 뜰수록 작고 옅게(착지 때 원래 크기·진하기).
뜬 높이는 rig_body.py 의 hop() 곡선(러프와 같은 타이밍).
사용: python3 fix_shadow.py reg_dir out_dir [--ref 1] [--shrink 0.45 --fade 0.6]"""
import argparse, glob, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from rig_body import hop

ap = argparse.ArgumentParser(); ap.add_argument("reg"); ap.add_argument("out")
ap.add_argument("--ref", type=int, default=1); ap.add_argument("--shrink", type=float, default=0.45); ap.add_argument("--fade", type=float, default=0.6)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
files = sorted(glob.glob(f"{a.reg}/*.png")); N = len(files)


def shadow_mask(q):
    """그림자 = 열마다 '몸의 가장 낮은 점'보다 아래에 있는 밝은 무채색(또는 옅은 반투명) 픽셀.
    몸 = 황갈색(채도 높음)·외곽선·발굽(어두움). 그래서 주둥이 크림색 같은 몸 안쪽 밝은 곳은 절대 안 지운다."""
    al = q[..., 3] > 8; rgb = q[..., :3].astype(int)
    lum = rgb.mean(2); sat = rgb.max(2) - rgb.min(2)
    cand = al & (((sat < 38) & (lum > 120)) | (q[..., 3] < 120))
    body = (q[..., 3] > 120) & ~cand
    H = q.shape[0]; yy = np.arange(H)[:, None]
    low = np.where(body.any(0), H - 1 - np.argmax(body[::-1], 0), -1)      # 열마다 몸의 가장 낮은 y
    ys = np.where(al.any(1))[0]; y0, y1 = ys.min(), ys.max()
    m = cand & (yy > low[None, :] + 1)
    m[: int(y1 - (y1 - y0) * 0.45)] = False
    return m


ims = [np.asarray(Image.open(f).convert("RGBA")).copy() for f in files]
ref = ims[a.ref - 1]; sm = shadow_mask(ref)
ys, xs = np.where(sm); bx = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
sprite = Image.fromarray(np.where(sm[..., None], ref, 0).astype(np.uint8)).crop(bx)
cx, by = (bx[0] + bx[2]) / 2, bx[3]                          # 바닥: 착지 칸 그림자의 가운데·아랫단
for i, q in enumerate(ims):
    q[shadow_mask(q)] = 0
    h, _ = hop(i / N)                                          # 0(바닥) .. 1(최고점)
    s = 1 - a.shrink * h; op = 1 - a.fade * h
    sp = sprite.resize((max(1, round(sprite.width * s)), max(1, round(sprite.height * s))), Image.LANCZOS)
    sa = np.asarray(sp).copy(); sa[..., 3] = (sa[..., 3] * op).astype(np.uint8); sp = Image.fromarray(sa)
    can = Image.new("RGBA", (q.shape[1], q.shape[0]), (0, 0, 0, 0))
    can.alpha_composite(sp, (round(cx - sp.width / 2), round(by - sp.height)))
    can.alpha_composite(Image.fromarray(q))                    # 그림자 위에 캐릭터
    can.save(f"{a.out}/{i+1:02d}.png")
print("ok", N, "칸, 그림자", bx, "→", a.out)
