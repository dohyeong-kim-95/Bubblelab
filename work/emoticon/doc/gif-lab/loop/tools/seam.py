"""걷기 루프 이음매 검사.
  python3 seam.py 입력.gif|프레임폴더 [--png 검수.png] [--json 지표.json] [--search 출력.gif [--max-drop 2]]
출력(표준출력, 프레임 번호는 1부터):
 (1) 인접 픽셀 차이 d(i→i+1), 마지막→첫 포함. 캐릭터 영역(두 프레임 중 하나라도 비흰) 안의 RGB 평균 절대차.
     seam_ratio = d(N→1)/평균(나머지), z. ※ 색연필 질감 재생성 잡음(~30)이 바닥이라 포즈 정체는 못 잡는다 → (6)
 (2) 프레임별 접지 y(비흰 ≥3픽셀인 가장 낮은 행)·중심 x·y(비흰 무게중심)·머리 y(가장 높은 행).
 (3) 중복 프레임: d < 0.25 × 평균 인접 d 인 쌍, 마지막↔첫.
 (4) 주기: D(k) = 평균 d(i, i+k).
 (5) --png: 끝 4 + 첫 4. 빨강 접지·주황 머리·파랑 중심 x·초록 중심 y.
 (6) 포즈: 이진 실루엣(비흰)의 하반신(머리~접지 사이 아래 40%)에서 인접 프레임 XOR/합집합 비율 p(i→i+1).
     질감 무관. seam_pose_ratio = p(N→1)/평균(나머지). 정체 구간 = p < 0.4 × 평균(전체) 인 인접쌍이
     연달아 2개 이상(루프를 넘어가는 구간 포함) — 화면에서는 홀드처럼 보인다.
     느린 구간 = 같은 방식으로 p < 0.7 × 평균. (A 실측: 실루엣 XOR 에도 외곽선 재생성 잡음 바닥이 있어
     최소 p 가 평균의 ~62% — 0.4 기준 정체는 생성 시트에서는 잘 안 나온다. 복제 프레임이면 p≈0 이라 잡힌다.)
 (7) 다리 위상: 발 띠(머리~접지 사이 아래 20% — 꼬리·팔이 덜 들어오는 높이)의 실루엣 가로 폭(앞발굽~뒷발굽).
     W = 국소 최대(보폭 최대), P = 국소 최소(passing).
 (8) --search: 프레임을 0~max-drop 개 빼는 모든 조합에서 정체 구간이 가장 짧아지는 것을 고르고
     (정체 쌍 수 → 최장 정체 → p 의 들쭉날쭉함(CV) → 뺀 수 순), 시작점은 이음매 쌍의 p 가 평균에 가장 가깝게
     돌려 GIF 로 쓴다. 시작점 회전은 재생 루프 자체를 바꾸지 않는다(같은 순환) — 이음매 지표의 기준만 바뀐다.
"""
import argparse, glob, itertools, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageSequence

WHITE = 240
LOW, FOOT = 0.40, 0.20
STALL, SLOW, DUP = 0.40, 0.70, 0.25


def load(path):
    if os.path.isdir(path):
        out = []
        for f in sorted(glob.glob(os.path.join(path, "*.png"))):
            im = Image.open(f).convert("RGBA"); bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            bg.alpha_composite(im); out.append(bg.convert("RGB"))
        return out, [None] * len(out)
    fr, du = [], []
    for f in ImageSequence.Iterator(Image.open(path)):
        fr.append(f.convert("RGB")); du.append(f.info.get("duration"))
    return fr, du


class Seq:
    """프레임 전체의 쌍별 지표를 한 번 계산해 두고, 부분 순서(프레임 빼기·회전)는 인덱스로만 평가한다."""

    def __init__(self, frames):
        self.frames = frames
        self.N = N = len(frames)
        self.X = np.stack([np.asarray(f, np.int16) for f in frames])
        self.M = (self.X < WHITE).any(-1)
        self.pos = []
        for i in range(N):
            cnt = self.M[i].sum(1); ys = np.nonzero(cnt >= 3)[0]; yy, xx = np.nonzero(self.M[i])
            self.pos.append((int(ys.max()), float(xx.mean()), float(yy.mean()), int(ys.min())))
        self.D = np.zeros((N, N)); self.Pp = np.zeros((N, N))
        for i in range(N):
            for j in range(i + 1, N):
                self.D[i, j] = self.D[j, i] = self._d(i, j)
                self.Pp[i, j] = self.Pp[j, i] = self._p(i, j)
        self.width = [self._width(i) for i in range(N)]

    def _d(self, i, j):
        m = self.M[i] | self.M[j]
        return float(np.abs(self.X[i] - self.X[j])[m].mean()) if m.any() else 0.0

    def _band(self, i, frac):
        g, _, _, h = self.pos[i]
        return round(g - frac * (g - h)), g

    def _p(self, i, j):
        ti, gi = self._band(i, LOW); tj, gj = self._band(j, LOW)
        y0, y1 = min(ti, tj), max(gi, gj) + 1
        a, b = self.M[i][y0:y1], self.M[j][y0:y1]
        u = (a | b).sum()
        return float((a ^ b).sum() / u) if u else 0.0

    def _width(self, i):
        y0, g = self._band(i, FOOT)
        xs = np.nonzero(self.M[i][y0:g + 1].sum(0) >= 2)[0]
        return int(xs.max() - xs.min()) if len(xs) else 0

    # ── 순서(인덱스 목록)에 대한 지표 ──
    def adj(self, order, mat):
        return np.array([mat[order[k], order[(k + 1) % len(order)]] for k in range(len(order))])

    def stalls(self, order, frac=STALL):
        p = self.adj(order, self.Pp); n = len(p); th = frac * p.mean()
        low = p < th
        if low.all(): return [(0, n)], th
        runs, k = [], 0
        start = int(np.argmin(low)) if low[0] else 0   # 정체 아닌 칸에서 출발해 순환을 한 바퀴
        k = start
        for _ in range(n):
            if low[k]:
                s = k; ln = 0
                while low[k] and ln < n: ln += 1; k = (k + 1) % n
                if ln >= 2: runs.append((s, ln))
                continue
            k = (k + 1) % n
            if k == start: break
        return runs, th

    def score(self, order):
        p = self.adj(order, self.Pp)
        runs, _ = self.stalls(order); slow, _ = self.stalls(order, SLOW)
        return (sum(l for _, l in runs), max([l for _, l in runs], default=0), sum(l for _, l in slow),
                float(p.std() / p.mean()), self.N - len(order))


def fmt_runs(runs, order):
    n = len(order)
    return "  ".join("→".join(str(order[(s + t) % n] + 1) for t in range(l + 1)) + f" (쌍 {l}개)" for s, l in runs) or "없음"


def report(S, order, du, src, png):
    N = len(order); fr = [S.frames[i] for i in order]
    adj = S.adj(order, S.D); rest = adj[:-1]; seam = adj[-1]; mu, sd = rest.mean(), rest.std(ddof=1)
    pa = S.adj(order, S.Pp); prest = pa[:-1]
    pos = [S.pos[i] for i in order]; R = np.array(pos)
    lab = [str(i + 1) for i in order]
    L = []; p = L.append
    p(f"# seam  {src}")
    p(f"frames {N}  size {fr[0].size[0]}x{fr[0].size[1]}" + (f"  duration {sorted(set(x for x in du if x))} ms" if any(du) else ""))
    if list(order) != list(range(S.N)): p(f"순서(원본 번호): {' '.join(lab)}")
    p("\n## (1) 인접 픽셀 차이 d(i→i+1)  [캐릭터 영역 평균 절대차, 0~255]")
    p("  " + "  ".join(f"{lab[k]}→{lab[(k + 1) % N]}:{v:.2f}" for k, v in enumerate(adj)))
    p(f"  나머지 {N - 1}개 평균 {mu:.2f}  표준편차 {sd:.2f}  최소 {rest.min():.2f}  최대 {rest.max():.2f}")
    p(f"  이음매 d({lab[-1]}→{lab[0]}) = {seam:.2f}   seam_ratio = {seam / mu:.3f}   z = {(seam - mu) / sd:+.2f}")

    p("\n## (2) 프레임별 위치  [접지 y·중심 x·y·머리 y]")
    p("  frame  ground_y  cx      cy      head_y")
    for k in list(range(3)) + [None] + list(range(N - 3, N)):
        if k is None: p("  …"); continue
        g, cx, cy, h = pos[k]; p(f"  {lab[k]:>5}  {g:>8}  {cx:6.1f}  {cy:6.1f}  {h:>6}")
    endfirst = {}
    for c, nm in enumerate(["ground_y", "cx", "cy", "head_y"]):
        col = R[:, c]; endfirst[nm] = float(col[0] - col[-1])
        p(f"  {nm:8} 범위 {col.min():.1f} ~ {col.max():.1f} (폭 {col.max() - col.min():.1f})  끝→첫 변화 {col[0] - col[-1]:+.1f}  인접 |Δ| 평균 {np.abs(np.diff(col)).mean():.2f}")

    th = DUP * adj.mean()
    dups = [(a, b, S.D[order[a], order[b]]) for a in range(N) for b in range(a + 1, N) if S.D[order[a], order[b]] < th]
    p(f"\n## (3) 중복 프레임  [d < {DUP} × 평균 인접 d = {th:.2f}]")
    p("  " + ("  ".join(f"{lab[a]}↔{lab[b]}:{v:.2f}" for a, b, v in dups) if dups else "없음"))
    lf = S.D[order[-1], order[0]]
    p(f"  마지막↔첫 d = {lf:.2f} ({lf / adj.mean():.2f} × 평균) → " + ("첫 칸 중복" if lf < th else "중복 아님"))
    near = sorted((S.D[order[a], order[b]], a, b) for a in range(N) for b in range(a + 1, N))[:5]
    p("  가장 닮은 쌍 5: " + "  ".join(f"{lab[a]}↔{lab[b]}:{v:.2f}" for v, a, b in near))

    Dk = np.array([np.mean([S.D[order[i], order[(i + k) % N]] for i in range(N)]) for k in range(1, N)])
    loc = [k for k in range(2, N - 1) if Dk[k - 1] < Dk[k - 2] and Dk[k - 1] <= Dk[k]]
    p("\n## (4) 주기 추정  D(k) = 평균 d(i, i+k)")
    p("  " + "  ".join(f"k{k}:{v:.2f}" for k, v in enumerate(Dk, 1)))
    p(f"  국소 최소 k: {loc}")

    runs, sth = S.stalls(order)
    pmu = prest.mean()
    p(f"\n## (6) 포즈(하반신 실루엣 XOR/합집합, 아래 {int(LOW * 100)}%)  p(i→i+1)")
    p("  " + "  ".join(f"{lab[k]}→{lab[(k + 1) % N]}:{v:.3f}" for k, v in enumerate(pa)))
    p(f"  나머지 평균 {pmu:.3f}  최소 {prest.min():.3f}  최대 {prest.max():.3f}  CV {pa.std() / pa.mean():.2f}")
    p(f"  이음매 p({lab[-1]}→{lab[0]}) = {pa[-1]:.3f}   seam_pose_ratio = {pa[-1] / pmu:.3f}")
    p(f"  정체 구간 [p < {STALL} × 평균 {pa.mean():.3f} = {sth:.3f}, 연속 2쌍 이상]: {fmt_runs(runs, order)}")
    slow, slth = S.stalls(order, SLOW)
    p(f"  느린 구간 [p < {SLOW} × 평균 = {slth:.3f}, 연속 2쌍 이상]: {fmt_runs(slow, order)}")
    lone = [k for k in range(N) if pa[k] < slth and not any((k - s) % N < l for s, l in slow)]
    if lone: p("  느린 단발 쌍: " + "  ".join(f"{lab[k]}→{lab[(k + 1) % N]}:{pa[k]:.3f}" for k in lone))
    rank = sorted(range(N), key=lambda k: pa[k])
    p(f"  이음매 p 순위: {rank.index(N - 1) + 1}/{N} (1 = 가장 덜 움직임)")

    w = [S.width[i] for i in order]
    mark = []
    for k in range(N):
        a, b, c = w[(k - 1) % N], w[k], w[(k + 1) % N]
        mark.append("W" if b >= a and b > c or b > a and b >= c else "P" if b <= a and b < c or b < a and b <= c else "·")
    p(f"\n## (7) 다리 위상  [발 띠(아래 {int(FOOT * 100)}%) 실루엣 가로 폭 px, W=보폭 최대 P=passing]")
    p("  칸 " + " ".join(f"{x:>3}" for x in lab))
    p("  폭 " + " ".join(f"{x:>3}" for x in w))
    p("     " + " ".join(f"{x:>3}" for x in mark))
    p(f"  W 칸: {[lab[k] for k in range(N) if mark[k] == 'W']}   P 칸: {[lab[k] for k in range(N) if mark[k] == 'P']}"
      f"   폭 범위 {min(w)}~{max(w)}")

    if png:
        sel = list(range(N - 4, N)) + list(range(4)); W, H = fr[0].size
        img = Image.new("RGB", (W * 8 + 6, H + 18), (255, 255, 255)); dr = ImageDraw.Draw(img)
        for c, k in enumerate(sel):
            x0 = c * W + (6 if c >= 4 else 0); img.paste(fr[k], (x0, 0)); g, cx, cy, h = pos[k]
            dr.line([(x0, g), (x0 + W, g)], fill=(220, 40, 40)); dr.line([(x0, h), (x0 + W, h)], fill=(240, 160, 40))
            dr.line([(x0 + cx, 0), (x0 + cx, H)], fill=(40, 90, 220)); dr.line([(x0, cy), (x0 + W, cy)], fill=(40, 170, 80))
            dr.text((x0 + 4, H + 3), f"#{lab[k]}  d {adj[k]:.1f}  p {pa[k]:.2f}  w {w[k]}", fill=(40, 30, 20))
        dr.rectangle([W * 4, 0, W * 4 + 5, H + 18], fill=(150, 150, 150)); img.save(png)
        p(f"\n## (5) 검수 이미지 {png}  (끝 4 | 첫 4. 칸 아래 = 다음 칸까지 d·p, 발 폭 w)")

    dpairs = [f"{lab[a]}-{lab[b]}" for a, b, _ in dups]
    m = dict(frames=N, seconds=round(sum(x or 0 for x in du) / 1000, 3) if any(du) else None,
             seam_ratio=round(seam / mu, 3), seam_z=round((seam - mu) / sd, 2),
             seam_pose_ratio=round(pa[-1] / pmu, 3), pose_cv=round(float(pa.std() / pa.mean()), 3),
             stalls=fmt_runs(runs, order), stall_pairs=sum(l for _, l in runs), slow=fmt_runs(slow, order),
             seam_pose_rank=f"{rank.index(N - 1) + 1}/{N}",
             ground_end_first=endfirst["ground_y"], cx_end_first=round(endfirst["cx"], 1),
             cy_end_first=round(endfirst["cy"], 1), dup_pairs=dpairs, last_first_dup=bool(lf < th))
    return "\n".join(L), m


def search(S, max_drop):
    best = None
    for r in range(max_drop + 1):
        for drop in itertools.combinations(range(S.N), r):
            order = [i for i in range(S.N) if i not in drop]
            sc = S.score(order)
            if best is None or sc < best[0]: best = (sc, order, drop)
    sc, order, drop = best
    pa = S.adj(order, S.Pp)
    # 회전: 이음매 쌍(마지막→첫)의 p 가 평균에 가장 가깝게 — 정체 구간 안에서 루프가 끊기지 않게
    runs, _ = S.stalls(order)
    bad = {(s + t) % len(order) for s, l in runs for t in range(l)}
    k = min((k for k in range(len(order)) if k not in bad), key=lambda k: abs(pa[k] - pa.mean()))
    order = order[k + 1:] + order[:k + 1]
    return order, drop, sc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("--png"); ap.add_argument("--json")
    ap.add_argument("--search"); ap.add_argument("--max-drop", type=int, default=2)
    a = ap.parse_args()
    frames, du = load(a.src)
    S = Seq(frames)
    png = a.png or (os.path.splitext(a.src.rstrip("/"))[0] + "_seam.png")
    txt, m = report(S, list(range(S.N)), du, a.src, png)
    print(txt)
    if a.json: json.dump(m, open(a.json, "w"), ensure_ascii=False, indent=1)
    if a.search:
        order, drop, sc = search(S, a.max_drop)
        ms = du[0] or 50
        fr = [frames[i] for i in order]
        mosaic = Image.new("RGB", (fr[0].width, fr[0].height * len(fr)))
        for i, f in enumerate(fr): mosaic.paste(f, (0, f.height * i))
        pal = mosaic.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
        q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in fr]
        q[0].save(a.search, save_all=True, append_images=q[1:], duration=ms, loop=0, disposal=1)
        base = os.path.splitext(a.search)[0]
        txt2, m2 = report(S, order, [ms] * len(order), a.search, base + "_seam.png")
        head = (f"\n\n# (8) 루프 지점 탐색 → {a.search}\n"
                f"  뺀 프레임(원본 번호): {[i + 1 for i in drop] or '없음'}   시작 칸: {order[0] + 1}\n"
                f"  {len(order)}프레임 × {ms}ms = {len(order) * ms / 1000:.2f}s   "
                f"점수(정체 쌍, 최장 정체, 느린 구간 쌍, p CV, 뺀 수) = ({sc[0]}, {sc[1]}, {sc[2]}, {sc[3]:.3f}, {sc[4]})")
        print(head)
        open(base + "_seam.txt", "w").write(txt2 + "\n")
        print(f"  자세한 보고서: {base}_seam.txt")
        print(f"  seam_pose_ratio {m['seam_pose_ratio']} → {m2['seam_pose_ratio']}   정체 {m['stalls']} → {m2['stalls']}   느린 구간 {m['slow']} → {m2['slow']}")
        print("  ※ 시작점은 이음매 쌍을 평균 p 에 가까운 곳으로 고른 것이라 seam_pose_ratio≈1 은 설계상 당연하다.\n"
              "    실제 개선은 뺀 프레임이 만든 차이(느린 구간·p CV)로 본다.")
        if a.json:
            json.dump(m2, open(base + "_seam.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
