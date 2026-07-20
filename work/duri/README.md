# duri — 둘이서 쓰는 대화·사진 백업 (E2E)

상태: **개발 중**. work.bubblelab.dev/duri, work 비밀번호 뒤 비공개.

두 사람이 주고받은 대화와 사진이 **각자의 컴퓨터 디스크에 저절로 쌓이는** 기록
시스템. 대화·사진 백업이 목적이라 bubblelab의 "토이 · 외부 서비스 금지" 원칙과
결이 다르므로, 랜딩·풀다운에 노출되지 않는 비공개 `work` 서브도메인에 둔다.

## 구조 — 엣지는 중계소, 원본은 내 PC

- **Cloudflare(엣지) = 실시간 중계 + 임시 버퍼.** 영구 저장고가 아니다. 워커·DO·R2는
  전부 **E2E 암호블롭**만 다루므로 평문·키·신원을 알지 못한다.
- **데스크톱 싱크 = 진실의 원천.** 사용자 PC에서 상주하며 새 항목을 받아 로컬
  디스크에 기록하고 서버에 ack 한다 → 서버는 버퍼·R2에서 그 항목을 폐기한다.
  (싱크·apk는 다음 단계. 소스는 배포 안 되게 `_sink/`에 둘 예정.)

## E2E 암호화 (공유 패스프레이즈)

- 두 사람이 **같은 암호 문구**를 각자 최초 1회 입력 → PBKDF2(210k, SHA-256)로
  AES-GCM 256 키 파생. 문구·키는 기기를 떠나지 않는다.
- 메시지·사진·발신자 이름·캡션까지 전부 암호화되어 오간다. 서버엔 `{ iv, ct }`
  불투명 값뿐. 문구가 다르면 상대 메시지는 "복호화 불가"로 표시된다.

## 서버 구성 (bubblelab 리포 안에서 자립)

- `_infra/duri.js` — `DuriDO`: 릴레이 + 버퍼(ack 시 폐기) + 사진 R2 임시 보관.
- `_infra/worker.js` — `/_duri`(WS 중계), `/_duri/photo`(업로드/다운로드),
  `/_duri/sink-token`(소유자 발급). 인증: work 게이트(브라우저) 또는 싱크 토큰(데몬).
- `wrangler.jsonc` — `DURI` DO 바인딩·마이그v10, `DURI_BUCKET`(R2), `ENABLE_DURI` var.

## 켜는 법 (fail-closed)

`ENABLE_DURI`는 기본 `false`. 켜기 전에:

```bash
npx wrangler@4 r2 bucket create bubblelab-duri
npx wrangler@4 secret put WORK_PASSWORD      # 이미 있으면 생략
npx wrangler@4 secret put DURI_SINK_SECRET   # 선택: 싱크 토큰 전용 서명키
# wrangler.jsonc 의 ENABLE_DURI 를 "true" 로 바꾼 뒤 배포
```

버킷·비밀번호가 없으면 `/_duri`는 503으로 닫힌다.
