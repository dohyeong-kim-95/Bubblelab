# Life PC sink

`life.bubblelab.dev`의 암호화된 할 일 데이터를 개인 PC에 영구 보존하는 무의존성
Node.js 데몬이다. 서버에서는 내용을 해독하지 않으며, 이 프로세스만 passphrase로
현재 상태를 복원한다.

## 설치

```bash
bash install.sh
```

처음 실행하면 권한 `0600`인 `~/life-sink/life-sink.config.json`을 만든다. 앱의
설정 화면에서 sink token을 발급받아 `token`에 넣고, 앱에서 사용한 passphrase를
`passphrase`에 넣은 뒤 설치 스크립트를 다시 실행한다. 환경 변수
`LIFE_URL`, `LIFE_TOKEN`, `LIFE_PASSPHRASE`, `LIFE_DIR`, `LIFE_POLL_MS`도 지원한다.

Node.js 20 이상이 필요하다. 기본 poll 간격은 30초이고, 실패 시 1초부터 지수
backoff하여 최대 5분까지 기다린다. 성공하면 다시 정상 간격으로 돌아간다.

## 저장 구조와 안전 순서

```text
LifeStorage/                         # 0700
  archive/journal/YYYY-MM.ndjson     # 서버 암호 변경의 append-only 정본
  archive/snapshots/<head>.json      # 스냅샷으로 복구한 시점의 암호문 전체
  quarantine/<seq>.json              # 해독/스키마 실패 기록과 원 암호문
  views/current.json                 # 사람이 읽고 앱에 다시 import할 수 있는 현재 상태
  state/cursor.json                  # 마지막으로 영구 보존한 seq
```

파일은 `0600`, 디렉터리는 `0700`으로 만든다. 처리 순서는 `암호 저널 write + fsync →
atomic publish + 부모 디렉터리 fsync → current view → cursor → 서버 ack`이다. 그 앞
단계가 실패하면 cursor와 ack를 움직이지 않는다. 디렉터리 fsync를 지원하지 않는
파일시스템에서는 경고를 남긴다.

저널 한 건의 암호 해독이나 평문 스키마 검증만 실패하면 원 암호문이 이미 정본에
남아 있으므로 quarantine에도 기록하고 다음 seq로 진행한다. 이때 `current.json`은
`incomplete: true`가 된다. 연속 10건째 실패는 passphrase가 틀린 것으로 판단하여
그 10번째 seq를 cursor/ack하지 않고 프로세스를 중단한다.

seq gap, 새 설치, 서버 보존 범위보다 오래된 cursor는 번호를 임의로 건너뛰지 않는다.
이때는 `/_life/snapshot`으로 서버의 현재 엔터티 전체를 page별로 받아 그대로
적용한다. 서버는 스냅샷을 미리 만들어 두지 않고 그 자리에서 읽어 주므로, page마다
따라오는 `head`가 도중에 달라지면 중간이 섞인 상태이므로 처음부터 다시 받는다.
받은 암호문은 복호화 전에 `archive/snapshots/`에 먼저 남긴다 — 저널이 잘려 나간
구간에서는 이 파일이 유일한 원본 기록이다. 비어 있거나 더 오래된 스냅샷은 현재
상태와 cursor를 대체하지 않는다.

ack는 저널 한 page를 다 적용한 뒤 마지막 seq로 한 번만 부른다. 변경마다 부르면
밀린 저널을 따라잡는 동안 서버의 분당 120회 쓰기 제한에 그대로 걸린다.

로그에는 cursor, 수신 수, 재시도 이유, quarantine 여부만 남기며 할 일 제목이나
passphrase는 출력하지 않는다.
