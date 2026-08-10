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
복호화가 실패하면(패스프레이즈 불일치) 데이터 유실을 막으려고 **ack 없이 중단**한다.

대상은 대화(`msg`)·사진(`photo`) 항목뿐이다. **공유 캘린더(`cal:*`)는 아직 백업하지
않는다** — 캘린더의 유일한 원본이 지금은 엣지(DO)라는 뜻이다(다음 단계).

## 저장 구조

```
DuriStorage/
  timeline/2026/2026-07/
    metadata.json     # 정본: 그 달 로그 배열(복호화된 텍스트·사진 메타)
    messages.md       # 사람용 대화록 (metadata에서 재생성되는 View)
    photos/
      2026-07-20T14-45-33_000000000042.png   # 복호화된 원본 사진
  .duri-cursor        # 마지막으로 보존한 seq (재시작 시 이어받기)
```

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

## 주의

- 컴퓨터가 꺼져 있는 동안의 항목은 서버 R2 버퍼가 최대 **30일** 들고 있다가 켜지면
  흘려준다. 그 안에 한 번은 PC를 켜야 한다(미ack 상한도 5000건).
- `metadata.json`이 정본이고 `messages.md`·사진 인덱스는 재생성 가능한 View다.
