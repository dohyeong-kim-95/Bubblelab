# Duri 데스크톱 싱크

내 컴퓨터에서 상주하며 Duri 대화·사진을 **로컬 디스크에 저절로 보존**하는 데몬.
"엣지는 중계소, 원본은 내 PC"에서 **원본** 쪽이다. 리포의 `_src/`(배포 제외)
아래 소스이며, 이 폴더를 각자 PC로 복사해 실행한다.

의존성 없음 (전역 `WebSocket`·`crypto`만 사용). **Node 22+** 면 그대로 되고,
**Node 20.10~21** 이면 `--experimental-websocket` 플래그가 필요하다 —
`install.sh` 가 알아서 판별해 서비스 등록에도 붙여 준다.

## 하는 일

1. `/_duri` 에 **싱크 토큰**으로 WebSocket 접속, 마지막 커서 이후 항목을 받는다.
2. **공유 패스프레이즈**로 E2E 복호화 → `DuriStorage/` 에 기록.
3. 디스크에 확실히 쓴 뒤에만 `ack` → 서버가 버퍼·R2에서 그 항목을 폐기.

서버·R2는 암호블롭만 갖고 있어서, 패스프레이즈를 아는 이 데몬만 평문을 만든다.

### 막히지 않기 위한 두 가지 규칙

**① 서버에 없는 seq 는 건너뛴다.** 서버는 자기가 아직 들고 있는 것(ackSeq 이후)만
보내고, 중간에 지워진 사진(`del`)도 번호에 구멍을 남긴다. 예전엔 `cursor+1` 이
올 때까지 3초마다 무한히 기다려서, **ackSeq>0 인 방에 새 싱크를 처음 붙이면 한
건도 저장하지 못한 채 영영 멈췄다**(실제로 그랬다 — 732건이 통째로 막혀 있었다).
지금은 백필이 끝난 뒤(`backfill-done`)라면 빈 번호를 기다리지 않고 넘어간다.

**② 안 풀리는 항목은 격리하고 지나간다.** 복호화 실패 한 건 때문에 그 뒤 전부가
막히면 안 된다(실제로 731건이 딱 한 건에 막혔다). 암호블롭을 그대로
`undecryptable/<seq>.json` 에 남기고(사진은 `.img.enc` 까지 받아 둔다) 커서를
전진시킨다 — 원문을 못 읽어도 원본을 잃지는 않고, 나중에 옛 문구를 알면 풀 수 있다.
다만 **연속 10건**이 실패하면 문구 자체가 틀린 것이므로 그때는 중단한다(전부
격리한 채 ack 해서 서버에서 지워 버리는 게 최악이다).

대화(`msg`)·사진(`photo`)에 더해 **공유 캘린더(`cal:*`)도 백업한다**.

## 저장 구조

```
DuriStorage/
  timeline/2026/2026-07/
    metadata.json     # 정본: 그 달 로그 배열(복호화된 텍스트·사진 메타)
    messages.md       # 사람용 대화록 (metadata에서 재생성되는 View)
    photos/
      2026-07-20T14-45-33_000000000042.png   # 복호화된 원본 사진
  calendar/
    events.json       # 정본: 일정·표식·색설정 전체(툼스톤 포함)
    calendar.md       # 사람용 일정표 (events.json에서 재생성되는 View)
  undecryptable/      # 지금 문구로 안 풀리는 항목의 암호블롭 원본(아래 규칙 ②)
  .duri-cursor        # 마지막으로 보존한 seq (재시작 시 이어받기)
```

### 캘린더는 대화와 규칙이 다르다

캘린더는 버퍼가 아니라 **서버의 지속 상태**라 ack 이 없고, 접속할 때마다
`cal-state` 로 전체가 온다. 그래서 받은 걸로 **덮어쓰지 않고 병합**한다 —
같은 id 는 `rev` 가 큰 쪽(웹앱·서버와 같은 LWW), **서버에 없는 항목은 그대로
남긴다**. 방초기화로 서버가 비워진 뒤 빈 `cal-state` 가 왔을 때 통째로 쓰면
백업까지 날아가기 때문이다 — 그 상황이야말로 백업이 존재하는 이유다.

캘린더 저장이 실패해도 대화·사진 보존은 멈추지 않는다(커서와 분리). 단
복호화 실패는 문구 불일치이므로 대화와 똑같이 즉시 중단한다.

로그 항목은 `type` 으로 갈린다: `message`(텍스트, `sys:true` 면 시스템 알림) ·
`photo` · `sticker`(어떤 팩 몇 번인지) · `location`(`/여기` 로 남긴 좌표).
사진 로그에는 원본 파일명(`photo.original`)·형식·크기·SHA-256(전송 전 해시와
대조한 `hashOk`)이 들어가고, 촬영 위치가 있으면 `loc` 으로 남는다 — 백업만으로
지도를 되살릴 수 있게.

**사진 확장자는 저장할 때 실제 바이트(매직바이트)로 판별한다.** 메타에는 확장자가
없어서 예전 코드는 무엇을 받든 `.jpg` 로 저장했다(아이폰의 HEIC 도 마찬가지였다).
정체를 모르는 바이트는 `.jpg` 라고 우기지 않고 `.bin` 으로 둔다.

## 설치 (한 줄)

```bash
bash install.sh
```

설정이 비어 있으면 파일만 만들어 두고 멈춘다. 앱에서 **⚙️ → 💾 PC 백업 설정 →
🔑 싱크 토큰 발급**으로 나오는 JSON 을 `duri-sink.config.json` 에 붙여넣고
`passphrase` 만 손으로 채운 뒤, 다시 실행하면 systemd 유저 서비스로 등록·기동한다
(`loginctl enable-linger` 까지 — 로그아웃해도 계속 돈다).

- **token**: 앱의 발급 버튼이 `POST /_duri/sink-token` 을 대신 호출해 준다.
  (예전엔 개발자도구에서 `bl_duri` 쿠키를 복사해 curl 을 쳐야 했다 — 그 마찰
  때문에 정작 원본이 아무 데도 안 쌓이고 있었다.)
- **passphrase**: 웹앱에 입력한 것과 **똑같이**. 서버로 전송되지 않고, 앱도 문구를
  갖고 있지 않아서(키 객체만 남긴다) 자동으로 채워 줄 수 없다.
- 설정·데이터는 `.gitignore` 로 커밋되지 않는다. env
  `DURI_URL`/`DURI_TOKEN`/`DURI_PASSPHRASE`/`DURI_DIR` 로도 줄 수 있다.

확인:

```bash
systemctl --user status duri-sink      # 살아 있는지
journalctl --user -u duri-sink -f      # 무엇을 받고 있는지
```

**macOS** 는 `~/Library/LaunchAgents` 에 launchd plist(`RunAtLoad`·`KeepAlive` true),
**Windows** 는 작업 스케줄러 "로그온할 때" 트리거로 등록한다 — `install.sh` 는
systemd 가 없으면 설치까지만 하고 이 안내를 띄운다.

## 일정 비서 "당이" (선택, 기본 꺼짐)

채팅에 **`@당이 …`**(줄여서 **`@당 …`**)라고 쓰면 이 데몬이 **PC 안의 로컬 모델(llama.cpp 또는 Ollama)** 로
읽어 공유 캘린더를 고치고 채팅으로 답한다(`assistant.mjs`). 데몬이 이미 복호화한 메시지를
쓰고 결과도 같은 패스프레이즈로 암호화해 보내므로 **E2E 는 그대로**다 — 서버는 여전히
암호블롭만 본다. 그래서 **PC가 켜져 있고 데몬이 돌 때만** 된다.

```
@당이 토요일 10시 르파비스 임장 넣어줘     → 바로 추가 + "📅 … 일정 추가됨"
@당 이번 주 일정                         → 목록으로 답
@당이 임장 일요일로 옮겨줘 / 출장 지워줘   → 되묻는다 → "@당이 응" 이면 실행, "@당이 취소"
@당 안녕 / 저녁 뭐 먹지?                  → 잡담은 말 말투로 짧게 답한다(op "chat")
@당 오늘 러닝 5km 했어 / 어제 운동 취소     → 말한 사람의 💪 운동 인증 체크·취소(op "fit"/"unfit")
@당 이번 달 운동 몇 번? / 이번주 운동 요약  → 둘 다 몇 번·언제·무슨 운동(op "fitlist", month 또는 week)
@당 우리 성수동 카페 이름 뭐였지? / 어제 무슨 얘기 했지?  → 백업에서 찾아 답한다(op "recall")
```

- **기억(recall)은 이 PC 백업(`DuriStorage/timeline/*/*/metadata.json`)을 읽기만 한다**(`archive.mjs` —
  쓰기 API 가 없고, 테스트가 소스에 쓰기 함수가 없는지 검사한다). 모델은 1단계에서 찾을 낱말·기간만
  고르고, 코드가 맞는 줄 + 앞뒤 한 줄(최대 14건)을 찾아 2단계에서 **그 줄만 근거로** 답하게 한다.
  기록에 없으면 모른다고 한다. 당이 자신의 답과 `@당` 명령은 근거에서 뺀다. 데몬 로그엔 대화 내용
  대신 "기억 N줄 읽고 답함" 만 남긴다. 낱말은 조사를 떼고("어니언에서"→"어니언") 끝 글자도 떼어
  ("제주도"→"제주") 찾고, "얘기"·"무슨" 같은 뜻 없는 낱말은 버린다.
- 말한 사람 이름은 긴 지시문 뒤 별도 시스템 메시지로 준다(앞부분이 같아야 모델 서버가 재사용한다).

- **운동 인증은 앱의 💪 와 같은 레코드**를 고친다(`wk`+YYYYMM+이름해시, `kind:"workout"`). id 를
  만드는 `whoKey` 가 앱과 같아야 해서 테스트가 `duri/index.html` 의 함수를 직접 꺼내 비교한다.
  체크는 **말한 사람 것만**, 앞으로 올 날은 안 된다. 날짜표는 일정용(오늘부터 60일)이고 지난 7일은
  "운동 인증에만" 이라고 따로 준다 — 날짜표에 섞었더니 "이번 주"·"토요일" 까지 지난 날을 골랐다.
- 주간 요약은 모델이 날짜를 세지 않고 `week:"this"|"last"` 만 고른다(월~일, 이번 주는 오늘까지).
  날짜를 프롬프트에 적어 줬더니 "이번 주 일정" 까지 그 날짜를 베꼈다. 그래도 작은 모델은 "이번 주
  일정" 에 운동 요약을 고르기도 해서, **요청에 운동 낱말(`FIT_WORDS`)이 없으면** 운동 동작을
  일정 동작으로 돌린다(fitlist → list, fit/unfit → 되묻기).

- **페르소나는 말(馬)이다** — 다그당스 이모티콘의 그 조랑말. 당근을 좋아하고 "푸히힝" 웃고
  말끝이 "~승"(좋승~, 알겠승!). 잡담 답만 이 말투고, 일정 추가·목록 같은 확정 문구는 코드가
  만든다(모델이 날짜를 지어내지 못하게). 날씨·뉴스처럼 지금 정보는 모른다고 답하게 했다.

- **PC가 꺼져 있으면 앱이 바로 `💤 당이가 자고 있어요` 라고 알린다.** 서버의 `welcome`·
  `presence` 에 싱크가 붙어 있는지(`sink`)가 실려 오고, 앱(`DANGI_RE`)이 그걸 보고 그 화면에만
  그린다(전송·저장 안 함). 그 명령은 PC가 켜진 뒤에도 **실행하지 않는다**(10분 넘게 지난 명령은
  조용히 버린다) — 나중에 한꺼번에 실행되면 헷갈린다.
- `@당이`·`@당` 뒤엔 공백이나 끝이 와야 한다(`@당근` 은 명령이 아니다). 규칙은 데몬
  (`assistant.mjs` 의 `TRIGGER`)과 앱(`DANGI_RE`) 두 곳에 있다 — 같이 고칠 것.
- **모델은 할 일만 고르고, 날짜·검증은 코드가 한다.** 프롬프트에 오늘부터 60일치
  날짜·요일 표와 앞뒤 일정 목록(e1, e2… 별칭)을 주고 JSON 하나만 받는다. 날짜표 밖·
  없는 별칭·잘못된 시간은 실행하지 않고 "이해하지 못했어요" 로 답한다.
- **옮기기·삭제는 확인을 받는다**(같은 사람이 10분 안에 `@당이 응`). 반복 일정은
  건드리지 않는다(캘린더 탭에서). 삭제하면 웹앱처럼 그 일정의 댓글도 지운다.
- 만든 일정은 `/일정` 명령과 같다: 기본 **공통**, `owner` = 말한 사람.
- 답은 이름 `🤖 당이` 의 시스템 메시지다. 앱은 이 이름만 가운데 알약이 아니라 **갈색 말풍선 + 프로필
  (다그당스1 07번 얼굴)** 로 그린다(`duri/index.html` 의 `DANGI_NAME` — 이름을 바꾸면 둘 다). 두 사람
  이름과 겹치면 안 된다.

켜기 — PC에 로컬 모델 서버를 띄우고 설정에 `assistant` 를 넣은 뒤 데몬을 다시 시작한다.
지금은 **llama.cpp `llama-server`(Vulkan, 내장 GPU)** 를 쓴다. Ollama 도 그대로 된다(`api` 를 빼면 Ollama).

```bash
# llama.cpp 릴리스(ubuntu-vulkan-x64)와 모델을 홈에 받는다 — sudo 필요 없음
mkdir -p ~/llama.cpp/models && cd ~/llama.cpp
gh release download <태그> -R ggml-org/llama.cpp -p 'llama-*-bin-ubuntu-vulkan-x64.tar.gz' && tar xzf llama-*.tar.gz
ln -sfn ~/llama.cpp/llama-<태그> ~/llama.cpp/current
curl -L -o models/gemma-4-E4B-it-Q4_0.gguf \
  https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf   # 4.6GB
~/llama.cpp/current/llama-server --list-devices    # Vulkan0: AMD Radeon 680M 이 보여야 한다
```

`~/.config/systemd/user/llama-server.service` 로 상시 띄운다(`systemctl --user enable --now llama-server`):

```ini
[Service]
ExecStart=%h/llama.cpp/current/llama-server -m %h/llama.cpp/models/gemma-4-E4B-it-Q4_0.gguf -ngl 99 -fa on -c 8192 -np 1 -t 8 --cache-reuse 256 --chat-template-kwargs '{"enable_thinking":false}' --host 127.0.0.1 --port 8090
Restart=always
```

```json
"assistant": { "enabled": true, "api": "llama", "llama": "http://127.0.0.1:8090" }
```

Ollama 로 돌릴 땐 `"assistant": { "enabled": true, "ollama": "http://127.0.0.1:11434", "model": "gemma4:e4b", "keepAlive": "1h" }`
(`ollama pull gemma4:e4b`, 받기 9.6GB, 올리면 RAM 약 10GB). Ollama 가 저장한 gemma4 파일은 llama.cpp 가 못 연다
(텐서 구성이 다르다) — 그래서 GGUF 를 따로 받는다.

env 로는 `DURI_ASSISTANT=1` / `DURI_MODEL_API` (`llama`|`ollama`) / `LLAMA_URL` / `OLLAMA_URL` / `DURI_MODEL` /
`DURI_KEEP_ALIVE`. `api` 를 안 적으면 Ollama, 모델을 안 적으면 `qwen2.5:7b`, `keepAlive` 를 안 적으면 `1h`.

**실행기 고르기 (2026-10-25, Ryzen 9 6900HX + Radeon 680M, 실제 당이 프롬프트·가짜 캘린더 20문항, gemma4 E4B)**

| | 정답 | 긴 지시문을 처음 읽을 때 | 이어지는 답 | RAM |
|---|---|---|---|---|
| llama-server Vulkan (Q4_0) | 18/20 | 6.1초 | 평균 1.9초 | 약 5GB |
| Ollama 0.24 (CPU만) | 17/20 | 38.4초 | 평균 2.8초 | 약 10GB |

Ollama 0.24 는 이 내장 GPU 를 안 쓴다(로그 `offloaded 0/43 layers to GPU`). 지시문 2900토큰 읽기 속도가
CPU 72 tok/s → Vulkan 312 tok/s, 쓰기는 14.6 → 19.7 tok/s (`llama-bench -p 2900 -n 64`).
**gemma4 는 속생각(thinking)을 꺼야 한다** — 켜 두면 JSON 한 줄에 150~200토큰을 먼저 써서 평균 17초가 된다.
서버 옵션과 요청(`chat_template_kwargs.enable_thinking:false`) 양쪽에서 끈다.

**모델 고르기 (같은 날, Ollama CPU, 6문항)**

| 모델 | 정답 | 모델이 내려가 있을 때 첫 답 | 올라와 있을 때 |
|---|---|---|---|
| `gemma4:e4b` | 5/6 | 27초 | 1.4–4.7초 |
| `qwen2.5:7b` | 3/6 ("내일"을 모레로, "일요일로"를 목요일로) | 44초 | 1.8–5.3초 |
| `llama3.2:3b` | 3/6 | 10초 | 1–2초 |

느린 건 모델이 아니라 **긴 지시문(날짜표 60일 + 일정 목록)을 처음 읽는 시간**이다. 한 번 읽으면
서버가 재사용한다(llama-server 는 상시 떠 있고, Ollama 는 `keepAlive` 동안 붙잡아 둔다). 남은 오답은
"일요일로 옮겨줘"(주 경계, 옮기기는 확인을 받는다). `qwen3.5:4b` 는 Ollama 0.24 에서 못 받는다 — llama.cpp
GGUF 로 같은 방법으로 재 볼 것. 데몬 로그에 `일정 비서 당이 켜짐` 과
요청마다 `당이: {모델 JSON} → add` 가 찍힌다. 모델이 이상한 걸 고르면 여기서 보인다.

## 주의

- 컴퓨터가 꺼져 있는 동안의 항목은 서버 R2 버퍼가 최대 **30일** 들고 있다가 켜지면
  흘려준다. 그 안에 한 번은 PC를 켜야 한다(미ack 상한도 5000건).
- `metadata.json`이 정본이고 `messages.md`·사진 인덱스는 재생성 가능한 View다.
