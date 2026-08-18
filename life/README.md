# Life OS

`life.bubblelab.dev`는 오늘 할 일을 적는 한 사람짜리 PWA다. 항목은 한 종류뿐이고
(`daily-action`) 계층도 부모도 없다 — 제목과 날짜, 완료 여부가 전부다. 화면은
**오늘**과 **설정** 두 장이다.

지난 날짜에 남은 미완료 항목은 오늘 화면 아래 "아직 남은 것"으로 따로 보이고,
`오늘로` 버튼으로 날짜만 옮긴다. 날짜 경계는 KST 자정이며 그 판단은 `model.js`
한 곳에 있다.

## 등록한 기기에서만 (최대 5대)

비밀번호(`LIFE_PASSWORD`)는 **등록 절차를 시작할 자격**일 뿐이고, 실제 입장은 등록된
기기만 한다. 세션 쿠키에 기기 ID 가 함께 서명돼 있고(`만료.기기ID.nonce.서명`),
LifeDO 가 등록 목록을 들고 있다.

1. 첫 기기는 승인해 줄 상대가 없으므로 비밀번호만으로 등록된다.
2. 이후 새 기기는 비밀번호를 통과해도 **6자리 코드**를 띄운 채 기다린다
   (`/register`, 10분 만료). 등록 화면은 CSP 가 인라인 스크립트를 막으므로
   `<meta http-equiv="refresh">` 로 기다린다 — JS 가 없다.
3. 이미 등록된 기기의 **⚙️ 설정 → 기기**에서 그 코드를 옮겨 적으면 등록된다.
   목록 API 는 코드를 돌려주지 않는다 — 새 기기 화면을 직접 봐야 하므로,
   비밀번호만 아는 사람은 혼자 등록을 마칠 수 없다.
4. 5대가 차면 승인이 409 로 거절된다. 하나를 해제한 뒤 승인한다.

해제는 즉시 반영된다. `/_life/*` 는 매 요청 등록 여부를 확인하고, 화면 이동
(문서 요청)에서도 확인한다 — css·js 마다 확인하지는 않는다. 페이지 한 장에 DO 를
열 번 왕복하게 되고, 데이터는 어차피 `/_life/*` 에서 막히기 때문이다.

## 보안 경계

- 제목과 날짜는 브라우저에서 AES-GCM으로 암호화한 뒤 `/_life`에 envelope만 보낸다.
- 패스프레이즈는 서버, localStorage, 로그에 저장하지 않는다. 기기에는 추출 불가능한
  CryptoKey만 IndexedDB에 둔다.
- 잠금과 로그아웃은 키와 복호화 메모리만 지운다. 암호 envelope, outbox, conflict는
  복구를 위해 남긴다.
- 서버 세션(`bl_life` 쿠키)이 만료되면 게이트의 로그인 화면으로 보낸다 — 기기 키는
  그대로라 로그인 뒤 패스프레이즈를 다시 묻지 않는다.
- 기기 목록에는 라벨(User-Agent 에서 추린 "iPhone · Safari" 정도)과 시각만 담긴다.
  적어 둔 할 일은 한 글자도 오지 않는다.
- 패스프레이즈를 잃으면 서버는 데이터를 복구할 수 없다. JSON 내보내기 또는 PC
  sink의 `views/current.json`이 복구 원본이다.
- 완전 오프라인일 때는 HttpOnly 세션 만료 여부를 알 수 없다. 기기 키가 열려 있으면
  로컬 기록을 볼 수 있으며, 서버 동기화는 재연결 뒤 인증 확인 후 진행한다.

## 로컬 저장과 동기화

IndexedDB `bl_life`에는 `meta`, `envelopes`, `outbox`, `conflicts` 네 store가 있다.
화면은 서버보다 IndexedDB를 먼저 읽는다. 변경은 즉시 암호화해 outbox에 넣고, 서버는
엔터티 revision CAS로 충돌을 거절한다. 409가 나면 로컬 변경은 conflict store에
보존되고, 서버가 모르는 항목이었다면 낙관적으로 써 둔 로컬 envelope을 지운다(남기면
그 항목만 영영 409가 난다).

여러 건을 한 번에 만드는 곳(가져오기)은 `sync.js`의 `MAX_FRAMES`(=서버
`LIFE_MAX_FRAMES`)로 잘라 여러 뮤테이션으로 보낸다. 하나가 통째로 거절당해 outbox가
막히면 이후 모든 동기화가 멈추기 때문이다.

서버는 `entity:`(현재 상태)와 `journal:`(변경 로그) 둘만 저장한다. 스냅샷을 따로
만들어 두지 않고 `entity:`를 page로 훑어 준다 — 저널이 잘린 지점보다 뒤처진 기기나
sink는 `/_life/snapshot`으로 다시 시작한다. 저널은 sink가 ack한 지점보다
`LIFE_JOURNAL_KEEP`만큼 뒤에서부터 잘라 낸다.

PC sink는 서버의 암호 저널을 먼저 영구 기록한 뒤 복호화된 현재 보기를 만든다.
sink가 꺼져 있어도 모바일 앱과 서버는 계속 동작한다.

## 개발 검증

```bash
node --test _infra/life.test.mjs _infra/life-client.test.mjs _src/life-sink/store.test.mjs
node _infra/build.mjs
npx playwright test _infra/e2e/life.spec.mjs
```

프로덕션에는 `ENABLE_LIFE`, `LIFE_PASSWORD`, `LIFE_SESSION_SECRET`,
`LIFE_SINK_SECRET`, `LIFE` Durable Object binding이 모두 필요하다.
