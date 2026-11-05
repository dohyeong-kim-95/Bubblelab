"""GIF 여러 개를 나란히 한 GIF 로 — 각자의 프레임 시간대로 재생되게 공통 시간축(경계의 합집합)으로 다시 샘플링.
사용: python3 side_by_side.py 출력.gif a.gif b.gif ...   (라벨은 파일 이름)"""
import sys, os
from PIL import Image, ImageSequence, ImageDraw
out, srcs = sys.argv[1], sys.argv[2:]
tracks = []
for s in srcs:
    fr, t, ts = [], 0, []
    for f in ImageSequence.Iterator(Image.open(s)):
        fr.append(f.convert("RGB")); ts.append(t); t += f.info.get("duration", 100)
    tracks.append((os.path.basename(s), fr, ts, t))
total = max(tr[3] for tr in tracks)
cuts = sorted({c % total for tr in tracks for c in tr[2]} | {0})
W, H = tracks[0][1][0].size
frames, durs = [], []
for k, c in enumerate(cuts):
    nxt = cuts[k + 1] if k + 1 < len(cuts) else total
    can = Image.new("RGB", (W * len(tracks), H + 24), "white"); d = ImageDraw.Draw(can)
    for j, (name, fr, ts, tt) in enumerate(tracks):
        tc = c % tt; idx = max(i for i, t0 in enumerate(ts) if t0 <= tc)
        can.paste(fr[idx], (j * W, 24)); d.text((j * W + 6, 6), name, fill="black")
    frames.append(can); durs.append(nxt - c)
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0)
print(out, len(frames), "frames", sum(durs), "ms")
