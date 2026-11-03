# podcast-worker — 팟캐스트를 집 PC에서 만든다

podcast.bubblelab.dev 의 생성 큐에서 일감을 가져가 **대본은 당이(llama-server, 127.0.0.1:8090)**,
**녹음은 Supertonic(Supertone 의 온디바이스 한국어 TTS, ONNX·CPU)** 으로 만들어 WAV 를 올린다.
외부 AI API 는 쓰지 않는다. 서버 쪽은 `_infra/podcast.js` 의 `/_podcast/worker/*`.

| 파일 | 역할 |
| --- | --- |
| `podcast-worker.mjs` | 상주 루프(1분마다 claim) · 업로드 · `--preview` |
| `pipeline.mjs` | 자료 → 글(pdftotext·당이 비전) → 컨텍스트에 맞게 요약 → 대본 JSON |
| `tts.py` | Supertonic 으로 턴마다 녹음 → 24kHz 16-bit 모노 WAV |
| `install.sh` | `~/podcast-worker` 에 설치 + venv + systemd 유저 서비스 |

대본 규칙(프롬프트·JSON 검증)은 `_infra/podcast-ai.js` 하나다 — 설치 때 옆에 복사된다.
그래서 **규칙을 바꾸면 `bash _src/podcast-worker/install.sh` 를 다시 돌려야 설치본이 따라온다.**

## 설치

```bash
bash _src/podcast-worker/install.sh            # 1회차: 복사·venv·설정 파일 생성
# admin 🎙️ Podcast → 🖥️ PC 생성기 → 토큰 발급 → ~/podcast-worker/podcast-worker.config.json 의 token
bash ~/podcast-worker/install.sh               # 2회차: 서비스 등록·기동
journalctl --user -u podcast-worker -f
```

설정(`podcast-worker.config.json`, 커밋 안 됨): `server`·`token`·`llama`·`voiceA`(진행자)·`voiceB`(해설자).
목소리는 Supertonic 내장 `F1`–`F5`·`M1`–`M5` 중에서 고른다.

## 동작 규칙

- **03~06시(KST)는 쉰다**(당이 정비 시간). 06:40 cron 일감은 그 뒤에 가져간다.
- **당이 `/health` 가 안 되면 가져가지 않는다** — YOUTUBE 녹음 등으로 꺼 둔 동안 시도 횟수를 버리지 않게.
- 실패하면 사유를 서버에 남기고 5분 쉰다. 서버가 세 번째 claim 에서 실패 처리한다.
- 당이 컨텍스트가 8192토큰·슬롯 하나라, 자료는 3,600토큰 예산에 맞춰 넣고(넘치면 넘친 자료만
  3,000토큰 조각으로 요약), 대본은 5,000자(약 5~6분)까지다.
- 요일은 프롬프트에 계산해 넣는다 — 모델에 맡기면 틀린다(수요일을 화요일이라 했다).

## 실측 (2026-11-04, Radeon 680M iGPU · CPU 16코어)

- 당이 쓰기 약 20토큰/초, 읽기 약 56토큰/초 · 한국어 1.76자/토큰.
- 3,200자 자료 → 대본 16턴 87초, 녹음 4분 46초 분량을 48초에 (Supertonic RTF ≈0.2, 메모리 0.7GB).

## 라이선스

Supertonic 코드는 MIT, 모델은 OpenRAIL(`~/.cache/supertonic3/LICENSE`) — 사용 제한 조항(불법·유해
용도 금지 등)만 지키면 된다. 개인 팟캐스트 용도에 문제 없다.
