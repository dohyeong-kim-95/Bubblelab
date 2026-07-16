# The Resistance: Avalon

<https://games.bubblelab.dev/avalon>에서 서비스하는 5–10인용 사회적 추론 게임의
원본 Vite 프로젝트입니다. 각 플레이어가 자기 기기로 방에 참여하며, 별도 사회자
없이 역할 배정부터 팀 제안·투표·미션·암살·결과까지 진행합니다.

## 현재 구조

- Vite 7 + Vanilla JavaScript ES modules
- Bubblelab `/_rt/avalon` WebSocket 실시간 서버
- `RealtimeDO`가 방의 공개 상태·비공개 역할·액션을 저장
- 호스트 클라이언트가 상태 전이의 권위자로 동작
- 플레이어 ID는 브라우저 `localStorage`에 보관
- Firebase, Firebase Auth, GitHub Pages, 별도 API 키는 사용하지 않음

Firebase 시절 게임 로직을 크게 바꾸지 않도록 `src/firebase.js`가 `ref`, `get`,
`set`, `update`, `onValue`, `onDisconnect` 호환 어댑터를 제공합니다. 이관 배경은
[`MIGRATION.md`](MIGRATION.md)를 참고하세요.

## 구현 범위

- 방 생성·입장·준비·강제 퇴장·방장 승계
- 5–10인 역할 구성과 공개 정보 생성
- 팀 제안, 전체 투표, 미션 판정, 5회 연속 부결 처리
- 7인 이상 4번째 미션의 실패 2장 규칙
- 멀린 암살과 최종 결과
- 진행 단계별 타이머와 확인 인원 표시
- 호스트 관리 봇, 투표 이력, 재경기
- 플로팅 채팅과 오디오/BGM
- 모바일 2열 플레이어 레이아웃

게임 규칙은 [`Rulebook.md`](Rulebook.md)에 정리되어 있습니다.

## 주요 디렉터리

```text
src/
├── config/       역할·인원·미션·타이머 설정
├── game/         호스트 상태 머신과 투표·미션·암살 로직
├── services/     방·플레이어·봇·채팅·오디오 서비스
├── views/        홈·로비·게임·결과 화면
├── components/   미션 트랙·플레이어 목록·투표 결과
├── lobby/        로비 불변식과 역할 구성 정규화
├── result/       결과·재경기 상태
├── sim/          전체 게임 시뮬레이터
├── ui/           공용 버튼 라벨 상태
└── firebase.js   Bubblelab 실시간 서버 어댑터
```

## 개발과 테스트

```bash
cd _src/avalon
npm ci
npm run dev
```

Vite 개발 서버에서 실제 Bubblelab 실시간 서버를 쓰려면 환경 변수
`VITE_RT_HOST=games.bubblelab.dev`를 설정할 수 있습니다. 로컬 Durable Object까지
검증하려면 저장소 루트에서 다음을 실행하세요.

```bash
node _infra/build.mjs
npx wrangler@4 dev --local --local-upstream localhost
# http://localhost:8787/games/avalon
```

자동 검증:

| 명령 | 범위 |
| --- | --- |
| `npm run test:sim` | 5–10인 전체 게임 반복 시뮬레이션 |
| `npm run test:lobby` | 준비 상태, 재접속, 방장 승계, 봇·강퇴 불변식 |
| `npm run test:game-phases` | 역할·투표·미션 확인 단계의 ready 집계 |
| `npm run test:button-labels` | 인원·미션별 버튼과 진행 문구 |
| `npm run test:missions` | 미션 인원과 실패 판정 규칙 |
| `npm run test:result-replay` | 종료 후 재경기 라우팅 |
| `npm run test:ci` | 위 검증 전체와 Vite 빌드 |

## 공개 산출물 갱신

```bash
cd _src/avalon
./rebuild.sh
```

스크립트는 `npm ci`, `vite build --base=/avalon/`을 실행하고
`games/avalon/`을 새 산출물로 교체한 뒤 카드 아이콘용 이모지 주석을 넣습니다.
소스와 생성 결과를 함께 커밋하세요. `games/avalon/`을 직접 수정하면 다음 빌드에서
덮어써집니다.

## 수동 QA 우선순위

1. 5인 방 생성부터 결과까지 완주
2. 7인 이상 4번째 미션의 실패 2장 규칙
3. 로비와 게임 중 방장 이탈·승계
4. 투표·미션 도중 일반 플레이어 재접속
5. 결과 화면 재경기와 홈 이동
6. 타이머 만료, 봇 추가·제거, 강제 퇴장
7. 여러 기기에서 채팅·오디오·모바일 레이아웃 확인

같은 브라우저의 여러 탭은 플레이어 ID를 공유하므로 멀티플레이 QA에는 서로 다른
브라우저나 시크릿 창을 사용하세요.
