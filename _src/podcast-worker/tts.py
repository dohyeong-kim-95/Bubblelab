"""팟캐스트 대본을 집 PC에서 녹음한다 — Supertonic(Supertone, ONNX, CPU) 한국어 TTS.

usage: python tts.py script.json out.wav
  script.json = {"turns": [{"speaker": "A"|"B", "text": "..."}], "voiceA": "F1", "voiceB": "M1"}
stdout 마지막 줄에 {"durationSeconds": n} 을 찍는다.

출력은 24kHz 16-bit 모노 WAV — 예전 Gemini 오디오와 같은 형식이라 플레이어·용량이 그대로다.
모델(약 390MB)은 첫 실행에 ~/.cache/supertonic3 로 받는다. 메모리 약 0.7GB라 당이와 같이 돌아도 된다.
"""
import json
import sys
import wave

import numpy as np
from supertonic import TTS

OUT_RATE = 24000
TURN_GAP = 0.35   # 화자가 바뀔 때 숨 쉬는 틈(초)


def resample(x, src, dst):
    """FFT 리샘플(대역 제한이라 44.1k→24k 에서 접힘 소리가 없다). 턴 하나씩이라 길지 않다."""
    if src == dst or len(x) == 0:
        return x
    n = int(round(len(x) * dst / src))
    spec = np.fft.rfft(x)
    keep = n // 2 + 1
    out = np.zeros(keep, dtype=complex)
    out[:min(keep, len(spec))] = spec[:min(keep, len(spec))]
    return np.fft.irfft(out, n) * (n / len(x))


def main(script_path, out_path):
    script = json.load(open(script_path, encoding="utf-8"))
    tts = TTS()
    voices = {
        "A": tts.get_voice_style(script.get("voiceA") or "F1"),
        "B": tts.get_voice_style(script.get("voiceB") or "M1"),
    }
    gap = np.zeros(int(TURN_GAP * OUT_RATE), dtype=np.float32)
    parts = []
    for i, turn in enumerate(script["turns"]):
        wav, _ = tts.synthesize(turn["text"], voice_style=voices.get(turn["speaker"], voices["A"]), lang="ko")
        audio = resample(np.asarray(wav, dtype=np.float64).reshape(-1), tts.sample_rate, OUT_RATE)
        parts += [audio.astype(np.float32), gap]
        print(f"turn {i + 1}/{len(script['turns'])}", file=sys.stderr, flush=True)
    audio = np.concatenate(parts) if parts else gap
    peak = float(np.max(np.abs(audio))) or 1.0
    pcm = (np.clip(audio / max(peak, 1.0), -1, 1) * 32767).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(OUT_RATE)
        w.writeframes(pcm.tobytes())
    print(json.dumps({"durationSeconds": round(len(pcm) / OUT_RATE)}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
