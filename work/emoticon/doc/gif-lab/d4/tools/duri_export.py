"""duri 채팅용 움직이는 다그당스 4 팩 내보내기. 이미지는 로컬에만(저장소에 커밋 금지).
LINE판은 '재생시간×반복 ≤ 4초'라 채팅에서 멈춘다 → duri판은 같은 그림을 **무한 반복 APNG** 로.

  python3 duri_export.py one <frames_dir> <ms.json> <pack_dir>/NN.png [--period 12 --size 270 --kb 300]
      frames_dir: 투명 칸(글자까지 얹은 것 — fx_overlay.py --static text). 한 주기(period 칸)만 담는다.
      그림 범위로 바짝 자르고 긴 변을 size 로, 팔레트 색 수를 줄여 kb 이하가 될 때까지(가볍게 — 로딩).
  python3 duri_export.py pack <pack_dir> <orig_pack_dir> [--title ...]
      preview.png(512² 흰 바탕 4×4, 원래 팩 preview 와 같은 형식 — 움직이는 판의 첫 칸, 없는 번호는 비움)
      metadata.json(원래 팩 라벨 중 있는 번호만) 을 만든다. 파일명 규칙은 _src/duri-stickers/README.md.
"""
import argparse, json, os, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from d4_export import build_palette, map_palette, write_apng

COLORS = (256, 192, 160, 128, 112, 96, 80, 64, 48)


def one(a):
    files = sorted(Path(a.frames).glob("*.png"))[: a.period]
    ms = json.load(open(a.ms))["ms"][: len(files)]
    ims = [Image.open(f).convert("RGBA") for f in files]
    box = None
    for im in ims:
        b = Image.fromarray((np.asarray(im)[..., 3] > 8).astype(np.uint8) * 255).getbbox()
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    # 정사각(duri 는 스티커를 aspect-ratio 1/1, object-fit 없이 그린다 — 직사각이면 늘어난다)
    side = max(box[2] - box[0], box[3] - box[1]) + 8; cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    sq = (round(cx - side / 2), round(cy - side / 2), round(cx - side / 2) + side, round(cy - side / 2) + side)
    nw = nh = a.size
    ims = [im.crop(sq).resize((nw, nh), Image.LANCZOS) for im in ims]
    out = Path(a.out)
    for c in COLORS:
        pal = build_palette(ims, c)
        n = write_apng(out, map_palette(ims, pal), ms, 0, palette=pal)
        if n <= a.kb * 1024: break
    print(f"{out}: {nw}×{nh}, {len(ims)}f, {sum(ms)}ms·무한, {c}색, {n/1024:.0f}KB {'✓' if n <= a.kb*1024 else '✗'}")


def pack(a):
    d, orig = Path(a.pack), Path(a.orig)
    meta = json.load(open(orig / "metadata.json"))
    have = sorted(p.name for p in d.glob("[0-9][0-9].png"))
    cell = 128; sheet = Image.new("RGB", (512, 512), "white")
    for name in have:
        im = Image.open(d / name); im.seek(0); im = im.convert("RGBA")   # APNG 첫 칸
        s = min((cell - 6) / im.width, (cell - 6) / im.height); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        i = int(name[:2]) - 1; x, y = (i % 4) * cell + (cell - im.width) // 2, (i // 4) * cell + (cell - im.height) // 2
        sheet.paste(im, (x, y), im)
    sheet.save(d / "preview.png")
    meta.update(title=a.title, createdAt=a.date, active=False, chat={"title": a.chat},
                tags=meta.get("tags", []) + ["움직임"], downloads=[x for x in meta["downloads"] if x["file"] in have])
    json.dump(meta, open(d / "metadata.json", "w"), ensure_ascii=False, indent=2)
    print("pack", d, len(have), "종:", ",".join(n[:2] for n in have))


ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
o = sub.add_parser("one"); o.add_argument("frames"); o.add_argument("ms"); o.add_argument("out")
o.add_argument("--period", type=int, default=12); o.add_argument("--size", type=int, default=270); o.add_argument("--kb", type=int, default=300)
p = sub.add_parser("pack"); p.add_argument("pack"); p.add_argument("orig")
p.add_argument("--title", default="다그당스 4 움직이는 이모티콘"); p.add_argument("--chat", default="다그당스4 움직")
p.add_argument("--date", default="2026-11-06")
a = ap.parse_args(); one(a) if a.cmd == "one" else pack(a)
