# Duri 데스크톱 싱크

내 컴퓨터에서 상주하며 Duri 대화·사진을 **로컬 디스크에 저절로 보존**하는 데몬.
"엣지는 중계소, 원본은 내 PC"에서 **원본** 쪽이다. 리포의 `_src/`(배포 제외)
아래 소스이며, 이 폴더를 각자 PC로 복사해 실행한다.

의존성 없음 (Node 22+ 의 전역 `WebSocket`·`crypto`만 사용).

## 하는 일

1. `/_duri` 에 **싱크 토큰**으로 WebSocket 접속, 마지막 커서 이후 항목을 받는다.
2. **공유 패스프레이즈**로 E2E 복호화 → `DuriStorage/` 에 기록.
3. 디스크에 확실히 쓴 뒤에만 `ack` → 서버가 버퍼·R2에서 그 항목을 폐기.

서버·R2는 암호블롭만 갖고 있어서, 패스프레이즈를 아는 이 데몬만 평문을 만든다.
복호화가 실패하면(패스프레이즈 불일치) 데이터 유실을 막으려고 **ack 없이 중단**한다.

## 저장 구조

```
DuriStorage/
  timeline/2026/2026-07/
    metadata.json     # 정본: 그 달 로그 배열(복호화된 텍스트·사진 메타)
    messages.md       # 사람용 대화록 (metadata에서 재생성되는 View)
    photos/
      2026-07-20T14-45-33_000000000042.jpg   # 복호화된 원본 사진
  .duri-cursor        # 마지막으로 보존한 seq (재시작 시 이어받기)
```

## 설정

`duri-sink.config.example.json` → `duri-sink.config.json` 으로 복사 후 채운다
(또는 env `DURI_URL`/`DURI_TOKEN`/`DURI_PASSPHRASE`/`DURI_DIR`). 이 config·데이터는
`.gitignore`로 커밋되지 않는다.

- **token**: work 비밀번호로 로그인한 브라우저에서 한 번 발급받는다:
  ```bash
  curl -X POST https://work.bubblelab.dev/_duri/sink-token \
    -H "Cookie: bl_work=<브라우저 개발자도구에서 복사한 값>"
  ```
  (또는 웹앱에 발급 버튼을 붙일 수 있음 — 다음 개선.)
- **passphrase**: 웹앱에 입력한 것과 **똑같이**. 서버로 전송되지 않는다.

## 실행

```bash
node duri-sink.mjs
```

### 항상 켜두기 (아무것도 안 해도 쌓이게)

**Linux (systemd, user 서비스)** — `~/.config/systemd/user/duri-sink.service`:
```ini
[Unit]
Description=Duri sink
[Service]
ExecStart=/usr/bin/node %h/duri-sink/duri-sink.mjs
WorkingDirectory=%h/duri-sink
Restart=always
[Install]
WantedBy=default.target
```
```bash
systemctl --user enable --now duri-sink
loginctl enable-linger $USER   # 로그아웃 후에도 유지
```

**macOS (launchd)** — `~/Library/LaunchAgents/dev.bubblelab.duri-sink.plist` 에
`ProgramArguments`로 `node .../duri-sink.mjs`, `RunAtLoad`·`KeepAlive` true 로 등록 후
`launchctl load` 한다.

**Windows** — 작업 스케줄러에서 "로그온할 때" 트리거로 `node duri-sink.mjs` 등록
(또는 `nssm`으로 서비스화).

## 주의

- 컴퓨터가 꺼져 있는 동안의 항목은 서버 R2 버퍼가 최대 **30일** 들고 있다가 켜지면
  흘려준다. 그 안에 한 번은 PC를 켜야 한다(미ack 상한도 5000건).
- `metadata.json`이 정본이고 `messages.md`·사진 인덱스는 재생성 가능한 View다.
