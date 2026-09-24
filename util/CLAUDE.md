# util 서브도메인 — 에이전트 배경 메모

토이 관례·배포 절차·커밋 범위는 루트 `CLAUDE.md` 그대로다. 도구별 설계 이유와
한계는 `util/README.md`. 이 파일은 **도구마다 백엔드가 다르다**는 지도만 담는다.

## 도구 → 백엔드 → 테스트

| 폴더 | 서버 | 테스트 |
| --- | --- | --- |
| `brief/` | `/_brief/today`·`/rates`·`/push` → `_infra/brief.js` (BriefDO) | `_infra/brief.test.mjs`, e2e |
| `fortune/` | `/_fortune/chart`·`/push` → `_infra/fortune.js` (FortuneDO) | `_infra/fortune.test.mjs`, e2e |
| `planner/` | `/_planner/login`·`logout`·`data` → `worker.js handlePlanner` + `_infra/planner.js` (PlannerDO) | `_infra/planner.test.mjs` |
| `chat/` | `/_chat` WebSocket → `_infra/chat.js` `ChatDO` (`idFromName("lobby")`, 단일 로비) | `_infra/chat.test.mjs`, verify `chat:ws` |
| `proofread/` | 없음 — 규칙표 `util/proofread/rules.js` 하나 | `_infra/proofread.test.mjs`, e2e |
| `stars/` | 없음 — `util/stars/sky.js`·`skyline.js` | `_infra/stars.test.mjs`, `_infra/stars-skyline.test.mjs`, e2e |
| `calendar/`·`photo/`·`image-convert/`·`ladder/`·`lotto/`·`pdf/`·`passport-pic/` | 없음 — 브라우저 전용(스티커만 `/_assets` 읽기) | `calendar`만 e2e |

util 소유 파일 목록은 `_infra/agent-scope.conf:20`. `_infra/worker.js`·`build.mjs`·
`www/index.html`·`e2e/smoke.spec.mjs`는 `*shared*` — 고쳐도 되지만 훅이 경고한다.

## 로케일과 "오늘"의 경계

페이지는 전부 `<html lang="ko">`. **예외는 `util/planner/index.html:2`의 `lang="en"`**
— 화면 문구도 영어(PLAN/REAL)다. Worker는 UTC로 도니까 "오늘"은 도구마다 각자
KST로 자르며, 방식이 서로 다르다.

- **brief** — `kstStamp()`는 UTC에 9시간 더해 ISO 앞 10자(`_infra/brief.js:85`), Open-Meteo
  요청도 `timezone=Asia/Seoul`(:498). 예외 하나: 지수가 확정 종가인지 장중값인지 가르는
  `easternStamp()`만 `America/New_York`(:336). 환율 신선도는 달력 일수가 아니라 **영업일**로
  센다 — 아니면 금요일 ECB 고시가 월요일마다 stale로 뜬다(`businessDaysBetween`, :190).
- **fortune** — `kstToday()`가 `Intl.DateTimeFormat`에 `RULES.timeZone`(`Asia/Seoul`)로
  자른다(`fortune.js:224`). 명식 규칙은 `RULES = korea-kst-midnight-v1`: 일 경계 자정,
  절기 분 단위, **진태양시 미적용**(`fortune.js:53`). 이 값이 응답에 그대로 실린다.
- **planner** — `currentMonth()`가 `Intl` en-CA + `Asia/Seoul`로 `YYYY-MM`을 만들고,
  서버는 **그 달 키만 남기고 지난 달을 버린다**(`planner.js:6`, `prunePlannerData`).
- **calendar** — 서버가 없어 KST가 아니라 **기기 로컬시각**이다(`calendar/index.html:289`).
- **cron은 UTC로 등록**한다. `0 23 * * *` = 08:00 KST 가 운세·브리핑 푸시
  (`wrangler.jsonc` triggers + `worker.js:1855`).

**만세력(음력)**: 사주 계산은 npm `manseryeok`(package.json 의존성 — 테스트 전 `npm ci`).
공공 API는 두 곳뿐 — 음력 생일 → 양력 변환(`kasiSolarFromLunar`)과 일진 대조 검증
(`kasiDay`). 둘 다 KASI `LrsrCldInfoService`에 `KASI_SERVICE_KEY` secret으로 붙고 날짜별
Cache API 캐시(`fortune.js:287`). 키가 없으면 `status:"not-configured"`로 넘어가고
**명식 자체는 그대로 나온다**(양력 입력 한정).

## 숫자 표기 (brief 전용, 다른 도구는 숫자를 찍지 않는다)

- 기온: 정수 반올림 + `°`(단위 문자 없음, `brief.js` `round` / `index.html:327`). 미세먼지:
  정수 `㎍`, 등급은 PM10·PM2.5 중 **나쁜 쪽**(`airGrade`, `brief.js:71`).
- 환율: 소수 2자리 반올림 → `toLocaleString("ko-KR", { maximumFractionDigits: 2 })` + `원`,
  등락 `▲/▼ 0.00`(`index.html:405`). 단위는 USD·EUR·CNY 1, **JPY만 100**(`RATE_SYMBOLS`).
  읽어주기 문장만 정수 원으로 반올림한다.
- 지수: 값은 소수 2자리, 등락률은 `▲/▼ 0.00%`(`index.html:427`).

## 배포에서 util만 다른 것

절차 자체는 `make ship` / `/ship`(루트 `CLAUDE.md`). 여기 걸리는 것만:

- **상류 실패 시** — brief `today`는 502 + no-store(대기질만 실패하면 날씨로 진행).
  `rates`는 환율·지수 상류가 달라 한쪽만 죽으면 나머지를 주고(`ratesFailed`/
  `indicesFailed`) 둘 다 죽을 때만 502. 캐시는 정상 1800초·부분 실패 300초, `today`는
  지역당 600초. 지수 상류는 TwelveData(`TWELVEDATA_API_KEY` 있을 때만) → Yahoo →
  Stooq(`brief.js:362`). fortune은 KASI 5초 타임아웃이며 실패해도 명식은 나간다.
- **fail-closed 플래그** — `ENABLE_CHAT`(없으면 `/_chat` 503 + Retry-After 86400)·
  `ENABLE_PLANNER`. 푸시는 `VAPID_PUBLIC_KEY` var + `VAPID_PRIVATE_KEY` secret이 둘 다 있어야
  토글이 뜨고 cron도 돈다. planner 세션 키는 `PLANNER_SESSION_SECRET` → `ADMIN_SESSION_SECRET`
  → `ADMIN_ID`+`ADMIN_PASSWORD` 순으로 대체되고, 셋 다 없으면 503.
- **chat 정원**은 기본 10명·범위 1~100, admin 💬 Chat에서 조정(`chat.js:23`). WebSocket은
  Origin 검증(없으면 403), 접속은 IP당 분당 20회.
- **`_infra/verify-prod.mjs` 프로브** — `api:brief`는 `soft: true`(Open-Meteo가 흔들려도
  배포 실패로 보지 않는다)이고 `brief.date`가 KST 오늘인지까지 본다(:412). `gate:closed`가
  `/_planner/data` 401·`/_chat` 403·`/_fortune/chart` GET 405를, `chat:ws`가 welcome을 본다.
- util은 **퍼블릭**이라 `www/index.html`에 카드가 있어야 빌드가 통과한다(현재 :93).
  `passport-pic`은 `_infra/build.mjs`의 `UNLISTED_ENTRIES`(:34)로 카드에서 빼고 페이지에
  `noindex, nofollow`를 건다 — **둘 다** 걸어야 하고 `home-button.test.mjs:143`가 검사한다.
- `stars`만 `_infra/security.js:65`의 `isSkyPage`가 센서·위치를 `(self)`로 연다(나머지는 기본
  정책). 폴더 이름을 바꾸면 `_infra/worker.js:13` `MOVED_PATHS`에 `util:/옛경로` 한 줄.

## 테스트

```bash
npm test                                  # 전체 (_infra/*.test.mjs)
node --test _infra/brief.test.mjs         # 하나만
node --test _infra/{brief,fortune,planner,chat,proofread,stars,stars-skyline}.test.mjs
npm run test:e2e                          # 빌드 후 모바일 스모크
```

스모크(`_infra/e2e/smoke.spec.mjs`)의 util 화면은 `/util/`·`brief/`·`calendar/`·`fortune/`·
`stars/`·`proofread/` 여섯이다. **맞춤법 검사는 `textarea` 뒤에 같은 글을 그린 거울
(`#mirror`)을 깔아 밑줄만 보여준다** — 글꼴·여백·스크롤바 폭(`--sbw`)이 어긋나면 가로로 넘친다.
