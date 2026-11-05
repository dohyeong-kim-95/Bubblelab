"""투명 PNG 시퀀스 → 카카오 GIF · LINE APNG · 미리보기 + 규격 리포트. 다그당스 4 출력 단계 2.

사용:
  python3 d4_export.py <frames_dir> <out_dir> --ms '120,90,...' [--line-keep '1,3,5,...']
                       [--line-frames 12] [--line-sec N] [--line-loop N] [--text '글자']

입력: frames_dir/*.png (RGBA, 전부 같은 크기 — cutout.py 출력). 이름순이 재생 순서.
--ms: 프레임마다 ms. 개수 = 프레임 수(한 값만 주면 전 프레임 같은 값).

출력(out_dir):
  preview/anim.gif   360² 흰 배경, ms 그대로(GIF 10ms 단위, 누적 반올림), 무한 반복
  preview/anim.apng  360² 투명, ms 그대로, 무한 반복
  kakao/anim.gif     360² 흰 배경, ≤24프레임, 프레임당 0.05~2.0초, ≤2MB 될 때까지 색 수 감량
  line/anim.png      APNG 270×270, 5~20프레임 — 유니크 10~12장만 남기고 빠진 칸 시간은 앞 칸에 합침,
                     총 길이를 정수 초(1~4)로 맞춤, 루프 = floor(4/초) (재생시간×루프 ≤ 4초, 무한 금지),
                     ≤300KB 될 때까지 팔레트 색 수 감량(투명 유지)
  line/main.png      240×240 APNG (anim 과 같은 프레임·시간·루프)
  line/tab.png       96×74 PNG (첫 프레임)
  report.md / report.json  출력마다 크기·프레임·총 길이·루프·용량·규격 항목별 ✓/✗ (파일을 다시 읽어서 잰다)

규격 근거: work/emoticon/doc/kakao-emoticon-guide.md, line-emoticon-guide.md,
LINE 공식 https://creator.line.me/en/guideline/animationsticker/detail/ ("playback time × loops ≤ 4s").
의존: numpy, Pillow. APNG 는 직접 쓴다(팔레트+tRNS, 바뀐 영역만 담는 fdAT).
"""
import argparse
import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

KAKAO = {"size": 360, "max_frames": 24, "min_ms": 50, "max_ms": 2000, "max_bytes": 2 * 1024 * 1024}
LINE = {"w": 270, "h": 270, "max_w": 320, "max_h": 270, "min_side": 270, "min_frames": 5, "max_frames": 20,
        "secs": (1, 2, 3, 4), "loops": (1, 4), "max_play_ms": 4000, "max_bytes": 300 * 1024}
MAIN = {"w": 240, "h": 240}
TAB = {"w": 96, "h": 74}
GIF_COLORS = (256, 192, 128, 96, 64, 48, 32)
LINE_COLORS = (256, 224, 192, 160, 128, 96, 80, 64, 48, 32)


# ---------- 입력 ----------
def load_frames(d):
    files = sorted(p for p in Path(d).iterdir() if p.suffix.lower() == ".png")
    if not files:
        sys.exit(f"{d}: PNG 없음")
    ims = [Image.open(p).convert("RGBA") for p in files]
    if len({im.size for im in ims}) > 1:
        sys.exit("프레임 크기가 서로 다르다 — cutout.py 로 같은 칸 크기로 만들 것")
    return ims, [p.name for p in files]


def parse_ms(s, n):
    v = [int(round(float(x))) for x in s.replace(" ", "").split(",") if x]
    if len(v) == 1:
        v = v * n
    if len(v) != n:
        sys.exit(f"--ms 개수 {len(v)} ≠ 프레임 수 {n}")
    return v


def apply_text(ims, text, **opts):
    """글자 얹기 자리. 아직 미구현 — 프레임을 그대로 돌려준다.
    구현할 때: 폰트(_src/dageudangs 렌더러와 같은 것), 위치(위/아래), 흰 테두리, 프레임 전체 고정 배치."""
    if text:
        print(f"경고: --text '{text}' 는 아직 미구현 — 무시", file=sys.stderr)
    return ims


# ---------- 배치 ----------
def fit(ims, w, h):
    """모든 프레임을 같은 배율로 줄여 w×h 투명 캔버스 가운데에. 프레임 사이 배치는 그대로."""
    sw, sh = ims[0].size
    s = min(w / sw, h / sh)
    nw, nh = max(1, round(sw * s)), max(1, round(sh * s))
    ox, oy = (w - nw) // 2, (h - nh) // 2
    out = []
    for im in ims:
        r = im.resize((nw, nh), Image.LANCZOS) if (nw, nh) != im.size else im  # Pillow 가 RGBA 를 premultiply 해서 줄인다
        c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        c.paste(r, (ox, oy))
        out.append(c)
    return out


def on_white(ims):
    out = []
    for im in ims:
        c = Image.new("RGB", im.size, (255, 255, 255))
        c.paste(im, (0, 0), im)
        out.append(c)
    return out


def round_cum(ms, unit):
    """누적 반올림 — 각 값은 unit 배수, 합은 원래 합(을 unit 으로 반올림한 값)과 같다."""
    out, acc, prev = [], 0.0, 0
    for m in ms:
        acc += m
        cur = int(round(acc / unit)) * unit
        out.append(cur - prev)
        prev = cur
    return out


# ---------- GIF ----------
def save_gif(path, rgb_ims, ms, colors, loop=0):
    """공용 팔레트(모자이크 MEDIANCUT), 디더 없음."""
    w, h = rgb_ims[0].size
    cols = min(len(rgb_ims), 6)
    rows = -(-len(rgb_ims) // cols)
    mosaic = Image.new("RGB", (w * cols, h * rows), (255, 255, 255))
    for i, im in enumerate(rgb_ims):
        mosaic.paste(im, ((i % cols) * w, (i // cols) * h))
    pal = mosaic.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in rgb_ims]
    path.parent.mkdir(parents=True, exist_ok=True)
    q[0].save(path, save_all=True, append_images=q[1:], duration=ms, loop=loop, disposal=1, optimize=False)
    return path.stat().st_size


# ---------- APNG (직접 씀) ----------
def _chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def _filter_rows(arr, bpp):
    """행마다 None/Sub/Up/Paeth 중 절댓값 합이 가장 작은 필터(팔레트는 None 고정)."""
    h = arr.shape[0]
    a = arr.reshape(h, -1).astype(np.int16)
    if bpp == 0:
        return b"".join(b"\x00" + r.astype(np.uint8).tobytes() for r in a)
    left = np.zeros_like(a)
    left[:, bpp:] = a[:, :-bpp]
    up = np.zeros_like(a)
    up[1:] = a[:-1]
    ul = np.zeros_like(a)
    ul[1:, bpp:] = a[:-1, :-bpp]
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    pred = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    cands = [a, (a - left) % 256, (a - up) % 256, (a - pred) % 256]
    cost = np.stack([np.minimum(c, 256 - c).sum(axis=1) for c in cands])  # 부호 있는 크기로 본 비용
    best = cost.argmin(axis=0)
    out = bytearray()
    for y in range(h):
        out.append(int(best[y]) if best[y] < 3 else 4)
        out += cands[best[y]][y].astype(np.uint8).tobytes()
    return bytes(out)


def write_apng(path, frames, ms, loop, palette=None):
    """frames: (H,W) uint8 인덱스(palette=[(r,g,b,a)…]) 또는 (H,W,4) RGBA.
    첫 프레임 전체, 이후는 앞 프레임과 다른 사각형만(dispose NONE, blend SOURCE). loop: 0=무한."""
    h, w = frames[0].shape[:2]
    pal_mode = palette is not None
    ctype, bpp = (3, 0) if pal_mode else (6, 4)
    out = [b"\x89PNG\r\n\x1a\n", _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0)),
           _chunk(b"acTL", struct.pack(">II", len(frames), loop))]
    if pal_mode:
        out.append(_chunk(b"PLTE", b"".join(bytes(c[:3]) for c in palette)))
        alphas = bytes(c[3] for c in palette).rstrip(b"\xff")
        if alphas:
            out.append(_chunk(b"tRNS", alphas))
    seq = 0
    prev = None
    for i, (f, d) in enumerate(zip(frames, ms)):
        if prev is None:
            x0, y0, x1, y1 = 0, 0, w, h
        else:
            diff = (f != prev) if pal_mode else (f != prev).any(axis=2)
            ys, xs = np.nonzero(diff)
            if len(ys) == 0:
                x0, y0, x1, y1 = 0, 0, 1, 1  # 같은 프레임 — 1px 만 다시 씀
            else:
                x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        sub = f[y0:y1, x0:x1]
        out.append(_chunk(b"fcTL", struct.pack(">IIIIIHHBB", seq, x1 - x0, y1 - y0, x0, y0, int(d), 1000, 0, 0)))
        seq += 1
        data = zlib.compress(_filter_rows(sub, bpp), 9)
        if i == 0:
            out.append(_chunk(b"IDAT", data))
        else:
            out.append(_chunk(b"fdAT", struct.pack(">I", seq) + data))
            seq += 1
        prev = f
    out.append(_chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"".join(out))
    return path.stat().st_size


def build_palette(rgba_ims, colors):
    """모든 프레임 공용 RGBA 팔레트. 0번 = 완전 투명. 나머지는 불투명 픽셀 모자이크를 MEDIANCUT,
    반투명 가장자리는 알파 단계(64·128·192)별 대표색을 덧붙인다."""
    arrs = [np.asarray(im) for im in rgba_ims]
    px = np.concatenate([a.reshape(-1, 4) for a in arrs])
    opaque = px[px[:, 3] >= 224][:, :3]
    semi = px[(px[:, 3] > 0) & (px[:, 3] < 224)]
    n_semi = min(24, max(6, colors // 10)) if len(semi) else 0
    n_op = max(2, colors - 1 - n_semi)
    side = int(np.ceil(np.sqrt(len(opaque))))
    pad = np.full((side * side, 3), 255, np.uint8)
    pad[:len(opaque)] = opaque
    q = Image.fromarray(pad.reshape(side, side, 3)).quantize(colors=n_op, method=Image.Quantize.MEDIANCUT,
                                                              dither=Image.Dither.NONE)
    pal_rgb = np.array(q.getpalette()[:n_op * 3], np.uint8).reshape(-1, 3)
    pal = [(0, 0, 0, 0)] + [(int(r), int(g), int(b), 255) for r, g, b in pal_rgb]
    if n_semi:
        levels = np.linspace(0, 224, n_semi // 2 + 2)[1:-1]
        bins = np.digitize(semi[:, 3], levels)
        for b in np.unique(bins):
            grp = semi[bins == b]
            for half in np.array_split(grp[np.argsort(grp[:, :3].sum(axis=1))], 2):
                if len(half):
                    m = half.mean(axis=0).round().astype(int)
                    pal.append(tuple(int(v) for v in m))
    return pal[:colors]


def map_palette(rgba_ims, pal):
    """premultiplied RGBA 거리로 가장 가까운 팔레트 인덱스. 완전 투명 → 0."""
    P = np.array(pal, np.float32)
    Pp = np.concatenate([P[:, :3] * P[:, 3:4] / 255.0, P[:, 3:4]], axis=1)
    out = []
    for im in rgba_ims:
        a = np.asarray(im).reshape(-1, 4).astype(np.float32)
        ap = np.concatenate([a[:, :3] * a[:, 3:4] / 255.0, a[:, 3:4]], axis=1)
        idx = np.zeros(len(a), np.uint8)
        vis = np.nonzero(a[:, 3] > 0)[0]
        for s in range(0, len(vis), 65536):
            ch = vis[s:s + 65536]
            d = ((ap[ch, None, :] - Pp[None, :, :]) ** 2).sum(axis=2)
            idx[ch] = d.argmin(axis=1)
        out.append(idx.reshape(im.size[1], im.size[0]))
    return out


def save_apng_rgba(path, rgba_ims, ms, loop):
    return write_apng(path, [np.asarray(im) for im in rgba_ims], ms, loop)


def save_apng_pal(path, rgba_ims, ms, loop, colors):
    pal = build_palette(rgba_ims, colors)
    return write_apng(path, map_palette(rgba_ims, pal), ms, loop, palette=pal), len(pal)


# ---------- LINE 프레임 고르기 ----------
def frame_diff(a, b):
    return float(np.abs(np.asarray(a, np.int16) - np.asarray(b, np.int16)).mean())


def select_line(ims, ms, keep=None, target=12, dup_eps=0.5):
    """반환: (남길 0-기반 인덱스, 합친 ms). 빠진 칸 시간은 바로 앞의 남은 칸에 합친다(맨 앞이 빠지면 마지막 칸에).
    keep 이 없으면: ① 앞 칸과 사실상 같은 칸(평균차 < dup_eps)을 먼저 합치고
    ② target 장이 될 때까지 '자기 ms + 합쳐질 앞 칸 ms' 가 가장 작은 칸을 뺀다 —
    ms 큰 칸(홀드)이 남고, 짧은 칸이 한곳에 몰려 빠져 긴 정체가 생기는 것도 막는다."""
    n = len(ims)
    if keep is not None:
        kept = sorted({k - 1 for k in keep})
        if any(k < 0 or k >= n for k in kept):
            sys.exit(f"--line-keep 범위 밖(1~{n})")
    else:
        kept = [0]
        for i in range(1, n):
            if frame_diff(ims[i], ims[kept[-1]]) >= dup_eps:
                kept.append(i)
        dur = merged(kept, ms, n)
        while len(kept) > target:
            best, best_s = None, None
            for j in range(1, len(kept)):
                s = dur[j] + dur[j - 1]
                key = (s, dur[j])
                if best_s is None or key < best_s:
                    best, best_s = j, key
            dur[best - 1] += dur[best]
            del kept[best], dur[best]
        return kept, dur
    return kept, merged(kept, ms, n)


def merged(kept, ms, n):
    dur = [0] * len(kept)
    pos = {k: j for j, k in enumerate(kept)}
    last = len(kept) - 1
    cur = last  # 첫 남은 칸 앞의 칸들은 마지막 칸에(루프)
    for i in range(n):
        if i in pos:
            cur = pos[i]
        dur[cur] += ms[i]
    return dur


# ---------- 다시 읽어서 재기 ----------
def probe(path):
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    durs, empty, has_alpha, corner_white = [], 0, False, True
    for i in range(n):
        im.seek(i)
        durs.append(int(im.info.get("duration", 0) or 0))
        fr = np.asarray(im.convert("RGBA"))
        a = fr[..., 3]
        if (a < 255).any():
            has_alpha = True
        rgb = fr[..., :3]
        visible = (a > 0) & (rgb.min(axis=2) < 245)
        if not visible.any():
            empty += 1
        cs = [fr[0, 0], fr[0, -1], fr[-1, 0], fr[-1, -1]]
        if not all(c[3] == 255 and c[:3].min() >= 250 for c in cs):
            corner_white = False
    loop = im.info.get("loop", None)
    return {"path": str(path), "format": im.format, "w": im.size[0], "h": im.size[1], "frames": n,
            "durations_ms": durs, "total_ms": sum(durs), "loop": loop, "bytes": path.stat().st_size,
            "empty_frames": empty, "has_alpha": has_alpha, "white_bg": corner_white and not has_alpha}


def loop_txt(v):
    return "무한" if v == 0 else ("—" if v is None else f"{v}회")


def checks_kakao(p):
    return [("360×360", p["w"] == 360 and p["h"] == 360),
            ("≤24프레임", p["frames"] <= KAKAO["max_frames"]),
            ("프레임당 0.05~2.0초", all(KAKAO["min_ms"] <= d <= KAKAO["max_ms"] for d in p["durations_ms"])),
            ("≤2MB", p["bytes"] <= KAKAO["max_bytes"]),
            ("흰 배경(투명 없음)", p["white_bg"]),
            ("빈 프레임 없음", p["empty_frames"] == 0)]


def checks_line(p, main=False):
    if main:
        size = [("240×240", p["w"] == MAIN["w"] and p["h"] == MAIN["h"])]
    else:
        size = [("≤320×270", p["w"] <= LINE["max_w"] and p["h"] <= LINE["max_h"]),
                ("한 변 ≥270", max(p["w"], p["h"]) >= LINE["min_side"])]
    loop = p["loop"] or 0
    return size + [("APNG", p["format"] == "PNG" and p["frames"] > 1),
                   ("5~20프레임", LINE["min_frames"] <= p["frames"] <= LINE["max_frames"]),
                   ("총 길이 1·2·3·4초", p["total_ms"] in (1000, 2000, 3000, 4000)),
                   ("루프 1~4회(무한 아님)", 1 <= loop <= 4),
                   ("재생시간×루프 ≤4초", loop >= 1 and p["total_ms"] * loop <= LINE["max_play_ms"]),
                   ("≤300KB", p["bytes"] <= LINE["max_bytes"]),
                   ("투명 배경", p["has_alpha"]),
                   ("빈 프레임 없음", p["empty_frames"] == 0)]


def checks_tab(p):
    return [("96×74", p["w"] == TAB["w"] and p["h"] == TAB["h"]), ("PNG 정지", p["format"] == "PNG" and p["frames"] == 1),
            ("투명 배경", p["has_alpha"])]


# ---------- 메인 ----------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--ms", required=True, help="프레임별 ms, 쉼표로 (프레임 수만큼 또는 한 값)")
    ap.add_argument("--text", default="", help="글자 얹기(자리만 — 미구현)")
    ap.add_argument("--line-keep", default="", help="LINE 에 남길 프레임 번호(1부터), 예 '1,3,5'. 없으면 자동")
    ap.add_argument("--line-frames", type=int, default=12, help="자동 선택 시 남길 장수(10~12 권장, 기본 12)")
    ap.add_argument("--line-period", type=int, default=0, help="앞 P 장이 한 주기이고 나머지는 반복일 때 — LINE 은 한 주기만 담고 루프(예: 12)")
    ap.add_argument("--line-sec", type=int, default=0, help="LINE 총 길이(초, 1~4). 0=원본 길이를 반올림")
    ap.add_argument("--line-loop", type=int, default=0, help="LINE 루프 횟수(1~4). 0=floor(4/초)")
    a = ap.parse_args()

    src, names = load_frames(a.frames_dir)
    n = len(src)
    ms = parse_ms(a.ms, n)
    src = apply_text(src, a.text)
    out = Path(a.out_dir)
    notes = []

    # 미리보기 ---------------------------------------------------------------
    f360 = fit(src, 360, 360)
    w360 = on_white(f360)
    gif_ms = round_cum(ms, 10)
    save_gif(out / "preview/anim.gif", w360, gif_ms, 256)
    save_apng_rgba(out / "preview/anim.apng", f360, ms, 0)

    # 카카오 -----------------------------------------------------------------
    if n > KAKAO["max_frames"]:
        notes.append(f"카카오: 프레임 {n}장 > 24 — 그대로 내보내고 ✗ 로 표시(줄이려면 입력을 줄일 것)")
    k_ms = [min(max(d, KAKAO["min_ms"]), KAKAO["max_ms"]) for d in gif_ms]
    if k_ms != gif_ms:
        notes.append("카카오: 0.05~2.0초 밖의 프레임 시간을 경계값으로 잘랐다")
    k_tries = []
    for c in GIF_COLORS:
        size = save_gif(out / "kakao/anim.gif", w360, k_ms, c)
        k_tries.append((c, size))
        if size <= KAKAO["max_bytes"]:
            break
    k_colors = k_tries[-1][0]

    # LINE ------------------------------------------------------------------
    keep = [int(x) for x in a.line_keep.split(",") if x.strip()] if a.line_keep else None
    if keep and 1 not in keep:
        notes.append("LINE: --line-keep 에 1번이 없다 — 맨 앞 빠진 칸들의 시간은 마지막 남은 칸에 합쳤다")
    l_src, l_ms = src, ms
    if a.line_period:                                  # 앞 P 장이 한 주기(뒤는 그 반복) — 한 주기만 담고 루프로 늘린다(칸을 버리지 않는다)
        l_src, l_ms = src[:a.line_period], ms[:a.line_period]
        notes.append(f"LINE: 한 주기 {a.line_period}장({sum(l_ms)}ms)만 담고 루프로 반복")
    f270 = fit(l_src, LINE["w"], LINE["h"])
    kept, dur = select_line(f270, l_ms, keep, a.line_frames)
    total_src = sum(l_ms)
    sec = a.line_sec or min(4, max(1, int(round(total_src / 1000))))
    if sec not in LINE["secs"]:
        sys.exit("--line-sec 는 1~4")
    line_ms = round_cum([d * sec * 1000 / sum(dur) for d in dur], 10)
    if sum(dur) != sec * 1000:
        notes.append(f"LINE: 원본 총 {total_src}ms → {sec * 1000}ms 로 비례 조정")
    loop = a.line_loop or max(1, min(4, 4 // sec))
    if not (1 <= loop <= 4) or sec * loop > 4:
        notes.append(f"LINE: 루프 {loop}회 × {sec}초 > 4초 — 규격 ✗")
    if not (LINE["min_frames"] <= len(kept) <= LINE["max_frames"]):
        notes.append(f"LINE: 남은 프레임 {len(kept)}장이 5~20 밖")
    l_frames = [f270[i] for i in kept]
    l_tries = []
    for c in LINE_COLORS:
        size, used = save_apng_pal(out / "line/anim.png", l_frames, line_ms, loop, c)
        l_tries.append((used, size))
        if size <= LINE["max_bytes"]:
            break
    l_colors = l_tries[-1][0]
    f240 = fit(l_src, MAIN["w"], MAIN["h"])
    m_frames = [f240[i] for i in kept]
    m_tries = []
    for c in LINE_COLORS:
        size, used = save_apng_pal(out / "line/main.png", m_frames, line_ms, loop, c)
        m_tries.append((used, size))
        if size <= LINE["max_bytes"]:
            break
    tab = fit([l_src[kept[0]]], TAB["w"], TAB["h"])[0]
    (out / "line").mkdir(parents=True, exist_ok=True)
    tab.save(out / "line/tab.png", optimize=True)

    # 리포트 -----------------------------------------------------------------
    rows = [("preview/anim.gif", probe(out / "preview/anim.gif"), [("360×360", None)]),
            ("preview/anim.apng", probe(out / "preview/anim.apng"), []),
            ("kakao/anim.gif", probe(out / "kakao/anim.gif"), None),
            ("line/anim.png", probe(out / "line/anim.png"), None),
            ("line/main.png", probe(out / "line/main.png"), None),
            ("line/tab.png", probe(out / "line/tab.png"), None)]
    result = {"input": {"dir": str(a.frames_dir), "frames": n, "names": names, "ms": ms, "total_ms": total_src},
              "notes": notes, "outputs": {}}
    for name, p, _ in rows:
        if name.startswith("kakao"):
            ck = checks_kakao(p)
        elif name == "line/anim.png":
            ck = checks_line(p)
        elif name == "line/main.png":
            ck = checks_line(p, main=True)
        elif name == "line/tab.png":
            ck = checks_tab(p)
        else:
            ck = []
        p["checks"] = {k: bool(v) for k, v in ck}
        p["pass"] = all(v for _, v in ck) if ck else None
        p.pop("path")
        result["outputs"][name] = p
    result["kakao"] = {"colors": k_colors, "tries": k_tries}
    result["line"] = {"kept_1based": [k + 1 for k in kept], "ms": line_ms, "sec": sec, "loop": loop,
                      "colors": l_colors, "tries": l_tries, "main_tries": m_tries}
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))

    def kb(b):
        return f"{b / 1024:.1f}KB" if b < 1024 * 1024 else f"{b / 1024 / 1024:.2f}MB"

    L = [f"# d4 출력 리포트", "",
         f"입력 `{a.frames_dir}` — {n}프레임, 총 {total_src}ms", "",
         "| 출력 | 크기 | 프레임 | 총 길이 | 루프 | 용량 | 규격 |", "|---|---|---|---|---|---|---|"]
    for name, p in result["outputs"].items():
        verdict = "—" if p["pass"] is None else ("✓" if p["pass"] else "✗")
        tl = f"{p['total_ms'] / 1000:.2f}s" if p["frames"] > 1 else "—"
        lp = loop_txt(p["loop"]) if p["frames"] > 1 else "—"
        L.append(f"| {name} | {p['w']}×{p['h']} | {p['frames']} | {tl} | {lp} | {kb(p['bytes'])} | {verdict} |")
    L.append("")
    for name, p in result["outputs"].items():
        if p["checks"]:
            L.append(f"**{name}** — " + " · ".join(f"{k} {'✓' if v else '✗'}" for k, v in p["checks"].items()))
    L += ["", "## 세부", "",
          f"- 카카오 색 수 {k_colors} (시도: " + ", ".join(f"{c}색 {kb(s)}" for c, s in k_tries) + ")",
          f"- 카카오 프레임 ms: {','.join(map(str, result['outputs']['kakao/anim.gif']['durations_ms']))}",
          f"- LINE 남긴 칸(1부터): {','.join(str(k + 1) for k in kept)} → {len(kept)}장",
          f"- LINE 프레임 ms: {','.join(map(str, line_ms))} (합 {sum(line_ms)}ms, {sec}초 × {loop}회)",
          f"- LINE 팔레트 {l_colors}색 (시도: " + ", ".join(f"{c}색 {kb(s)}" for c, s in l_tries) + ")",
          f"- main 팔레트 시도: " + ", ".join(f"{c}색 {kb(s)}" for c, s in m_tries)]
    if a.text:
        L.append("- --text: 미구현(무시됨)")
    for x in notes:
        L.append(f"- 주의: {x}")
    (out / "report.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main()
