"""loop-exp/*/seam.json(+ *_trim_seam.json) → compare.md 비교표."""
import glob, json, os

X = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = []
for f in sorted(glob.glob(os.path.join(X, "*", "*seam.json"))):
    d = os.path.basename(os.path.dirname(f)); name = os.path.basename(f)
    tag = d if name == "seam.json" else name.replace("_seam.json", "")
    rows.append((tag, json.load(open(f))))
rows.sort(key=lambda r: (r[0][0], len(r[0])))
H = ["변형", "프레임", "길이 s", "seam_ratio (z)", "seam_pose_ratio (순위)", "p CV", "정체 구간 (<0.4)", "느린 구간 (<0.7)",
     "접지 끝-첫", "중심x 끝-첫", "중심y 끝-첫", "중복 쌍"]
out = ["# 루프 이음매 비교", "",
       "`bash tools/eval.sh` 가 생성한다 — 손으로 고치지 말 것. 지표 정의는 `tools/seam.py` 머리말.", "",
       "- seam_ratio: 마지막→첫 픽셀 차이 / 나머지 평균. 질감 잡음 바닥(~30)이 있어 포즈 정체는 못 잡는다.",
       "- seam_pose_ratio: 하반신 실루엣 XOR 기준 같은 비율. 1 근처가 자연스럽다. 순위는 24쌍 중 덜 움직이는 순(1=가장 정체).",
       "- *_trim 은 프레임 빼기 탐색 결과 — 시작점을 고르므로 seam_pose_ratio≈1 은 설계상 당연, 느린 구간·p CV 로 본다.", "",
       "| " + " | ".join(H) + " |", "|" + "---|" * len(H)]
for tag, m in rows:
    out.append("| " + " | ".join(str(x) for x in [
        tag, m["frames"], m.get("seconds") or "", f'{m["seam_ratio"]} ({m["seam_z"]:+})',
        f'{m["seam_pose_ratio"]} ({m.get("seam_pose_rank", "")})', m["pose_cv"], m["stalls"], m.get("slow", ""),
        f'{m["ground_end_first"]:+.0f}', f'{m["cx_end_first"]:+}', f'{m["cy_end_first"]:+}',
        ", ".join(m["dup_pairs"]) or "없음"]) + " |")
open(os.path.join(X, "compare.md"), "w").write("\n".join(out) + "\n")
print(f"compare.md: {len(rows)}행")
