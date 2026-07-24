# duri — 둘이서 쓰는 대화·사진 백업 (E2E)

상태: **개발 중**. duri.bubblelab.dev, 자체 비밀번호 게이트 뒤 비공개.

두 사람이 주고받은 대화와 사진이 **각자의 컴퓨터 디스크에 저절로 쌓이는** 기록
시스템. 대화·사진 백업이 목적이라 bubblelab의 "토이 · 외부 서비스 금지" 원칙과
결이 다르므로, 랜딩·풀다운에 노출되지 않는 비공개 **전용 서브도메인**
`duri.bubblelab.dev`에 둔다(`_infra/build.mjs`의 `CONFIDENTIAL_SUBDOMAINS`).

원래 `work.bubblelab.dev/duri`(work 게이트 하위 경로)였으나, 앱화 후 work 홈
경유·주소 재입력이 번거로워 전용 서브도메인으로 승격했다. DuriDO는 호스트와
무관한 단일 인스턴스(`idFromName("main")`)라 승격으로 데이터가 옮겨가지 않는다.
암호 문구는 오리진별 localStorage에 있으므로 새 서브도메인에서 한 번 다시 입력한다.

## 게이트 (bl_duri, 1년 세션)

비밀번호는 work과 같은 `WORK_PASSWORD`를 쓰되 세션 쿠키는 **별도(`bl_duri`)이고
1년**이라, 설치형 앱은 최초 1회만 로그인하면 사실상 다시 묻지 않는다. 이 게이트는
E2E 암호 문구와 무관하다(문구는 앱 안에서 따로 받는다). 라우팅·게이트는
`_infra/worker.js`의 `handleDuriGate`.

## 구조 — 엣지는 중계소, 원본은 내 PC

- **Cloudflare(엣지) = 실시간 중계 + 임시 버퍼.** 영구 저장고가 아니다. 워커·DO·R2는
  전부 **E2E 암호블롭**만 다루므로 평문·키·신원을 알지 못한다.
- **데스크톱 싱크 = 진실의 원천.** 사용자 PC에서 상주하며 새 항목을 받아 로컬
  디스크에 기록하고 서버에 ack 한다 → 서버는 버퍼·R2에서 그 항목을 폐기한다.
  소스는 배포에서 제외되는 `_src/duri-sink/`(의존성 0, Node 22+). apk는 다음 단계.

## 앱화 (PWA)

홈 화면에 설치해 앱처럼 쓸 수 있다. `manifest.json` + `icon.svg`와 `<head>`의
apple/mobile 메타만으로 구성한 **최소 설치형 PWA**다. 최신 Chrome/Android는
매니페스트만으로 설치되고, iOS는 "홈 화면에 추가"로 담는다. 매니페스트는 duri
게이트 뒤라 `crossorigin="use-credentials"`로 받는다. `start_url`·`scope`는
서브도메인 루트(`/`)라 앱을 열면 곧바로 duri 홈이 뜬다(work 홈 경유 없음).

- **서비스워커(오프라인 셸)는 아직 없음.** 이제 앱이 서브도메인 루트(`/`)에
  있어 `/sw.js`의 기본 스코프(`/`)로 최상위 문서까지 제어할 수 있다 — 승격으로
  이전의 서브패스 스코프 제약은 풀렸다. 다만 게이트/`no-store` 헤더와의 캐시
  전략(버전 관리 포함)을 정리한 뒤 붙인다 — 다음 단계.
- 아이콘 PNG(iOS `apple-touch-icon` 고해상도용)는 지금 SVG 하나로 갈음한다.

## E2E 암호화 (공유 패스프레이즈)

- 두 사람이 **같은 암호 문구**를 각자 최초 1회 입력 → PBKDF2(210k, SHA-256)로
  AES-GCM 256 키 파생. 문구·키는 기기를 떠나지 않는다.
- 메시지·사진·발신자 이름·캡션까지 전부 암호화되어 오간다. 서버엔 `{ iv, ct }`
  불투명 값뿐. 문구가 다르면 상대 메시지는 "복호화 불가"로 표시된다.

## 서버 구성 (bubblelab 리포 안에서 자립)

- `_infra/duri.js` — `DuriDO`: 릴레이 + 버퍼(ack 시 폐기) + 사진 R2 임시 보관.
- `_infra/worker.js` — `handleDuriGate`(서브도메인 게이트), `/_duri`(WS 중계),
  `/_duri/photo`(업로드/다운로드), `/_duri/sink-token`(소유자 발급).
  인증: duri 게이트 세션(`bl_duri`, 브라우저) 또는 싱크 토큰(데몬).
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
