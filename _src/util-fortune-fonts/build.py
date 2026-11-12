#!/usr/bin/env python3
"""util/fortune 손글씨·본문·한자 글꼴을 잘라 util/fortune/fonts/ 에 쓴다 (배포 제외 폴더의 도구).

    python3 -m venv /tmp/ff && /tmp/ff/bin/pip install fonttools brotli
    /tmp/ff/bin/python _src/util-fortune-fonts/build.py <원본 폴더>

<원본 폴더> 에는 google/fonts 저장소의 OFL 원본 세 개를 그대로 둔다:
    NanumPenScript-Regular.ttf  GowunDodum-Regular.ttf  NotoSerifKR[wght].ttf

나누는 법 — 처음 열 때 받는 바이트를 줄이려고 unicode-range 로 쪼갠다:
  * core   : 이 페이지·풀이 조각 표·토정 해설이 실제로 쓰는 글자(코드에서 뽑는다). 거의 모든 화면이 이것만 받는다.
  * rest-N : 그 밖의 한글 음절을 구간 넷으로. 궁합 이름처럼 사람이 친 글자에만 받는다.
  * 한자   : 천간·지지·오행 등 페이지 글자만 core, 토정비결 원문 한문은 tojeong 조각 하나(원문을 펼칠 때만).
같은 글꼴 이름의 @font-face 가 겹치면 나중에 적은 것이 먼저 쓰이므로 core 를 맨 뒤에 적는다.
글자 표나 화면 문구가 바뀌면 다시 돌린다(_infra/fortune.test.mjs 의 글꼴 테스트가 빠진 글자를 잡는다).
"""
import glob, io, json, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "util", "fortune", "fonts")
SRC = sys.argv[1] if len(sys.argv) > 1 else "."

# 글자를 뽑는 곳 — 화면에 나올 수 있는 문장은 전부 여기서 온다.
#   BODY : 본문 글꼴(고운돋움)이 그릴 수 있는 모든 글 — 페이지·풀이 조각 표·토정 본문 번역
#   HAND : 손글씨(나눔손글씨 펜)는 제목·라벨·간지·이름표에만 쓴다 — 페이지 문구와 간지·일간 이름·
#          행운 표시가 든 조각 표, 토정 괘 이름까지. 토정 본문 번역은 손글씨로 쓰지 않는다.
BODY = ["util/fortune/index.html", "util/fortune/note.js", "util/fortune/tojeong-reading.js",
        "_shared/fortune-common.js", "_infra/fortune.js", "_infra/saju-reading.js",
        "_infra/saju-detail.js", "_infra/life-curve.js", "_infra/tojeong.js"]
HAND = ["util/fortune/index.html", "util/fortune/note.js", "_infra/saju-reading.js", "_infra/fortune.js",
        "_infra/saju-detail.js", "_infra/life-curve.js"]
# 한자는 화면에 실제로 그리는 것만: 천간·지지·오행·일진(데이터), 일간 이름(saju-reading 표).
# tojeong-reading.js 의 한자는 규칙 표의 열쇠라 화면에 안 나온다.
HANJA = ["util/fortune/index.html", "_shared/fortune-common.js", "_infra/saju-reading.js", "_infra/fortune.js"]
HANGUL = (0xAC00, 0xD7A3)


def is_hangul(c): return HANGUL[0] <= c <= HANGUL[1]
def is_han(c): return 0x3400 <= c <= 0x9FFF or 0xF900 <= c <= 0xFAFF


def chars(paths):
    out = set()
    for rel in paths:
        out |= {ord(ch) for ch in open(os.path.join(ROOT, rel), encoding="utf-8").read()}
    return out


def collect():
    tj_all, tj_title = set(), set()
    for path in glob.glob(os.path.join(ROOT, "util/fortune/tojeong/*.json")):
        data = json.load(open(path, encoding="utf-8"))
        tj_all |= {ord(ch) for ch in json.dumps(data, ensure_ascii=False)}   # sources.json 의 출처 문구도 화면에 나온다
        if "title" not in data: continue
        tj_title |= {ord(ch) for ch in "".join(data["title"].values())}
    return chars(BODY) | tj_all, chars(HAND) | tj_title, chars(HANJA), tj_all, tj_title


def ranges(cps):
    cps = sorted(cps)
    out, start, prev = [], None, None
    for c in cps:
        if start is None: start = prev = c; continue
        if c == prev + 1: prev = c; continue
        out.append((start, prev)); start = prev = c
    if start is not None: out.append((start, prev))
    return ",".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in out)


def cut(font_path, cps, out_name, instance=None):
    font = TTFont(font_path)
    if instance is not None:
        from fontTools.varLib import instancer
        font = instancer.instantiateVariableFont(font, instance)
    cmap = font.getBestCmap()
    cps = {c for c in cps if c in cmap}
    if not cps: return None
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=cps)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    with open(os.path.join(OUT, out_name), "wb") as f: f.write(buf.getvalue())
    return cps, len(buf.getvalue())


def main():
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, "*.woff2")): os.remove(old)
    body_all, hand_all, han_page, tj_all, tj_title = collect()
    latin = set(range(0x20, 0x7F)) | {0xA0, 0xB7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026,
                                      0x2190, 0x2191, 0x2192, 0x2193, 0x300C, 0x300D, 0x3001, 0x3002, 0xFF5E, 0xD7}
    text = lambda cs: {c for c in cs if is_hangul(c) or (c < 0x3000 and c >= 0x20)} | latin
    cores = {"body": text(body_all), "hand": text(hand_all)}
    rests = {}
    step = (HANGUL[1] - HANGUL[0] + 1) // 4 + 1
    for stem, core in cores.items():
        rest = set(range(HANGUL[0], HANGUL[1] + 1)) - core
        rests[stem] = [{c for c in rest if HANGUL[0] + i * step <= c < HANGUL[0] + (i + 1) * step} for i in range(4)]
    han_core = {c for c in han_page if is_han(c)} | {ord(c) for c in "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥木火土金水"}
    han_title = {c for c in tj_title if is_han(c)} - han_core
    han_lines = {c for c in tj_all if is_han(c)} - han_core - han_title

    css = ["/* 자동 생성 — _src/util-fortune-fonts/build.py. 손으로 고치지 않는다.",
           "   같은 이름의 face 는 나중 것이 먼저 쓰이므로 core 를 맨 뒤에 둔다. */"]
    sizes = {}
    plan = [
        ("NoteHand", "NanumPenScript-Regular.ttf", "hand", None),
        ("NoteBody", "GowunDodum-Regular.ttf", "body", None),
    ]
    for family, src, stem, inst in plan:
        faces = [(f"{stem}-rest{i}.woff2", chunk) for i, chunk in enumerate(rests[stem])] + [(f"{stem}-core.woff2", cores[stem])]
        for name, cps in faces:
            got = cut(os.path.join(SRC, src), cps, name, inst)
            if not got: continue
            used, size = got
            sizes[name] = size
            css.append(f'@font-face {{ font-family: "{family}"; src: url("{name}") format("woff2"); '
                       f'font-display: swap; unicode-range: {ranges(used)}; }}')
    # 한자: 토정 원문(펼칠 때만) → 토정 괘 이름(토정 탭) → 페이지(사주·오늘). 뒤에 적은 것이 먼저.
    for name, cps in [("hanja-tojeong.woff2", han_lines), ("hanja-title.woff2", han_title), ("hanja-core.woff2", han_core)]:
        got = cut(os.path.join(SRC, "NotoSerifKR[wght].ttf"), cps, name, {"wght": 400})
        if not got: continue
        used, size = got
        sizes[name] = size
        css.append(f'@font-face {{ font-family: "NoteHanja"; src: url("{name}") format("woff2"); '
                   f'font-display: swap; unicode-range: {ranges(used)}; }}')
    with open(os.path.join(OUT, "fonts.css"), "w", encoding="utf-8") as f: f.write("\n".join(css) + "\n")
    with open(os.path.join(OUT, "sizes.json"), "w") as f: json.dump(sizes, f, indent=1, sort_keys=True)
    for k in sorted(sizes): print(f"{k:28s} {sizes[k]:>9,d}")


if __name__ == "__main__":
    main()
