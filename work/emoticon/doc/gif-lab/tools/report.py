"""out/*.gif → out/metrics.tsv(프레임 간 차이) + review.html(한 화면 격자).
지표: 인접 프레임(마지막→첫 포함, 루프 이음매까지) 전체 RGB 평균 절대차의 평균·최대(0~255 스케일).
  0 에 가까우면 거의 안 움직임, 최대가 평균보다 훨씬 크면 한 곳에서 튐(이음매·불량 프레임 후보).
"""
import glob, html, os, re
import numpy as np
from PIL import Image, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")


def methods():
    m = {}
    for line in open(os.path.join(ROOT, "PLAN.md"), encoding="utf-8"):
        r = re.match(r"\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|", line)
        if r: m[r[1]] = (r[2].strip(), r[3].strip().split()[0])
    m.setdefault("01b", ("눈깜빡임", "SF"))
    return m


def analyze(path):
    im = Image.open(path)
    fr, du = [], []
    for f in ImageSequence.Iterator(im):
        fr.append(np.asarray(f.convert("RGB"), np.int16)); du.append(f.info.get("duration", 0))
    d = [float(np.abs(fr[i] - fr[(i + 1) % len(fr)]).mean()) for i in range(len(fr))] if len(fr) > 1 else [0.0]
    return len(fr), sum(du), os.path.getsize(path), float(np.mean(d)), float(np.max(d)), int(np.argmax(d))


def key(p):
    b = os.path.basename(p)[:-4]
    return (int(re.match(r"\d+", b)[0]), b)


def main():
    meta = methods()
    gifs = sorted(glob.glob(os.path.join(OUT, "*.gif")), key=key)
    rows, cards = [], []
    for g in gifs:
        cid = os.path.basename(g)[:-4]
        n, ms, size, mean, mx, at = analyze(g)
        act, how = meta.get(cid, meta.get(re.match(r"\d+", cid)[0], ("?", "?")))
        if cid == "01b": act, how = "눈깜빡임", "SF"
        rows.append(f"{cid}\t{how}\t{act}\t{n}\t{ms / 1000:.2f}\t{size}\t{mean:.2f}\t{mx:.2f}\t{at}->{(at + 1) % n}")
        warn = "" if 1450 <= ms <= 2050 else " warn"
        cards.append(f"""<figure><img src="out/{cid}.gif" alt="{cid}" loading="lazy">
<figcaption><b>{cid}</b> <span class="m">{html.escape(how)}</span> {html.escape(act)}<br>
<span class="n{warn}">{n}f · {ms / 1000:.2f}s · {size / 1024:.0f}KB</span><br>
<span class="n">Δ평균 {mean:.1f} · 최대 {mx:.1f} @{at}→{(at + 1) % n}</span><br>
<a href="out/{cid}_sheet.png">시트</a></figcaption></figure>""")
    with open(os.path.join(OUT, "metrics.tsv"), "w", encoding="utf-8") as f:
        f.write("id\tmethod\taction\tframes\tseconds\tbytes\tdiff_mean\tdiff_max\tmax_at\n" + "\n".join(rows) + "\n")
    page = f"""<!doctype html><html lang="ko"><meta charset="utf-8"><title>다그당스 GIF 실험</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{{color-scheme:light dark;--bg:light-dark(#f4f1ea,#1d1b18);--ink:light-dark(#2c241e,#eee6dc);--mute:light-dark(#7a6e62,#a99c8e)}}
body{{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}}
h1{{font-size:18px;margin:0 0 4px}} p{{margin:0 0 14px;color:var(--mute)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}}
figure{{margin:0;background:light-dark(#fff,#2a2622);border-radius:10px;padding:8px}}
img{{width:100%;aspect-ratio:1;display:block;background:#fff;border-radius:6px}}
figcaption{{margin-top:6px}} .m{{font:12px ui-monospace,monospace;background:light-dark(#efe4d4,#3a332c);padding:1px 5px;border-radius:4px}}
.n{{font:12px ui-monospace,monospace;color:var(--mute)}} .warn{{color:#c0392b}} a{{color:inherit;font-size:12px}}
</style>
<h1>다그당스 GIF 실험 — {len(gifs)}컷</h1>
<p>12fps 목표 1.5~2초(빨강=밖). Δ = 인접 프레임 전체 평균 절대차(0~255, 루프 이음매 포함). 최대가 평균보다 크게 튀면 그 자리를 본다.</p>
<div class="grid">{''.join(cards)}</div></html>"""
    open(os.path.join(ROOT, "review.html"), "w", encoding="utf-8").write(page)
    print("\n".join(rows))


if __name__ == "__main__":
    main()
