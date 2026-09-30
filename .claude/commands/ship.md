---
description: 배포 의례 한 줄 — main push 후 정확한 SHA의 저장소 Deploy 완료 대기
allowed-tools: Bash, Read
---

# 배포 (`make ship`)

이 리포의 배포 의례 전체를 실행한다. **절차는 이 파일이 아니라
`scripts/ship.sh` 에 있다** — 대화에서 단계를 재구성하지 말고 스크립트를 부른다.
세션이 바뀌어도 같은 절차가 돌아야 하기 때문이다.

## 하는 일

```bash
make ship
```

1. **프리플라이트** — main 브랜치인지, tracked 커밋 안 된 변경이 없는지, `gh` 로그인,
   그리고 **이번에 올라가는 커밋·파일 목록 출력**(작업 트리를 여러 세션이
   공유하므로 남의 커밋이 딸려 가는지 눈으로 확인한다)
2. 새 커밋이면 `git push origin main` 뒤 **정확한 head SHA**의 Deploy run을 찾아
   완료까지 대기
3. 이미 `origin/main`에 있는 커밋이면 그 SHA의 성공 run과 `/_health`를 확인
4. run이 없거나 실패했으면 `deploy.yml`을 `main`에서 수동 재실행하고 새 run을 대기
5. 문서 전용 run은 plan step 성공과 publish step skip을 모두 확인한 경우에만
   이전 라이브 SHA를 허용

테스트·빌드·브라우저 검증·publish·라이브 검증·Cloudflare 직전 production version
복구는 모두 저장소 `deploy.yml`이 맡는다. 로컬 `ship`의 필수 도구는 `git`·`gh`·
`curl`뿐이다.

## 실행 방법

인자 없이 부르면 그대로 `make ship`이다:

| 상황 | 명령 |
| --- | --- |
| 기본 | `make ship` |
| 배포 없이 지금 라이브만 검사 | `make verify` |
| 로컬 서빙을 같은 프로브로 검사 | `bash scripts/verify-prod.sh --base http://localhost:8787` |

`make ship` 은 오래 걸린다(Actions 대기 포함 보통 2~5분). 백그라운드로 돌리지
말고 끝까지 기다렸다가 결과를 보고한다. 실패 복구가 필요하면 같은 Actions run이
Cloudflare의 직전 production version으로 복구하고 그 SHA까지 확인한다.

## 실패했을 때

- **프리플라이트에서 멈춤** — 커밋 안 된 변경이 있다는 뜻이다. 그 변경이 내
  것인지 다른 세션 것인지 `git status --short` 로 확인하고, **남의 것은
  건드리지 않는다**. 내 파일만 커밋하고 다시 실행한다.
- **Actions 실패** — `ship`이 실패 로그를 출력한다. 테스트·빌드·브라우저 검증
  실패면 publish 전이고, publish 뒤 라이브 검증 실패면 Actions가 Cloudflare의 직전
  production version 복구까지 시도한다. 해당 run의 단계와 로그를 기준으로 보고한다.
- **원격 SHA의 run이 없거나 실패** — `ship`이 `deploy.yml --ref main`을 한 번
  재실행하고 새 run을 기다린다.
- **성공 run인데 라이브 SHA 불일치** — 문서 전용 skip으로 확인되지 않으면 실패다.
  임의로 재배포하거나 git 이력을 바꾸지 말고 run과 `/_health` 값을 보고한다.

검증이 게이트 뒤(invest·duri·admin)를 SKIP 했다면 자격증명이 없다는 뜻이지
실패가 아니다. 자격증명은 `.verify.env`(커밋되지 않음)에 둔다.

## 하지 말 것

- 로컬에서 `npm`·`node`·Playwright를 다시 실행하지 않는다. 배포 판정의 원본은
  `deploy.yml` 하나다.
- 배포 실패를 고치려고 로컬에서 `git revert`·revert commit·revert push를 만들지
  않는다. Worker와 asset 복구는 Actions의 Cloudflare version 복구가 맡는다.
- 검증 페이로드를 프로덕션 저장소에 쓰지 않는다 — 예전에 그날 잔고 스냅샷을
  빈 값으로 덮어써서 복구해야 했다. 쓰기 경로는 읽어서 확인만 한다.
- 상류 API(날씨)나 집 PC 데몬(잔고·듀리 싱크) 문제로 배포를 되돌리지 않는다 —
  스크립트도 그건 경고로만 낸다.
