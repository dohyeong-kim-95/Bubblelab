# games — 승격된 게임

<https://games.bubblelab.dev>의 승격 게임 소스입니다. 카드 페이지에 보이는 것은
서버가 필요 없는 `stepcam/` 하나뿐이고, 실시간 멀티플레이 게임 3개는 **Archived**
상태로 목록에서 빠져 있습니다.

> 공개 보안 정비 중에는 인증·방 권한 모델이 필요한 실시간 게임 3개를 카드
> 목록에서 숨기고 `ENABLE_REALTIME=false`로 서버 경로를 닫아 둡니다. 소스와
> 직접 URL은 삭제하지 않습니다.

| 경로 | 상태 | 게임 | 구성 |
| --- | --- | --- | --- |
| `stepcam/` | 공개 | 발판 리듬 | 카메라로 발을 보는 1인용 펌프·DDR (서버 없음) |
| `avalon/` | Archived | The Resistance: Avalon | 5–10인 실시간 멀티플레이 |
| `liargame/` | Archived | 라이어 게임 | 각자의 휴대폰으로 함께 플레이 |
| `yacht/` | Archived | 야추 | `/_rt/yacht`를 사용하는 실시간 주사위 게임 |

## 발판 리듬 (`stepcam/`)

정적 페이지 하나로 끝나는 1인용 리듬게임입니다. 실시간 서버·계정이 필요 없어
보안 정비와 무관하게 공개돼 있습니다.

| 파일 | 역할 |
| --- | --- |
| `vision.js` | 배경 차분 → 그림자 억제 → 열별 최하단 접지점 → 발 좌표 → 발판 칸 매핑 |
| `chart.js` | 곡 목록·채보 생성(씨앗 고정)·판정 창·점수 |
| `audio.js` | WebAudio 합성 (드럼·베이스 + 채보를 그대로 연주하는 멜로디) |

인식은 96×72로 줄인 프레임 위에서만 돌아 폰에서도 30 fps를 유지합니다. 카메라
영상은 기기 밖으로 나가지 않고, 카메라를 못 쓰는 환경을 위해 손가락 모드가 있습니다.
점수는 그 판에서만 쓰고 서버로 보내지 않습니다 — `games/`는 slop 토이와 달리
주간 신기록 보드를 붙이지 않습니다. 로직 테스트는
[`_infra/stepcam.test.mjs`](../_infra/stepcam.test.mjs).

`ENABLE_REALTIME=true`만 바꿔 재공개하면 안 됩니다. 현재 프로토콜은 메시지 크기,
경로, Origin과 namespace는 검증하지만 사용자 인증과 방별 읽기·쓰기 ACL이 없습니다.
각 게임이 자기 방의 공개 상태와 비공개 역할만 읽도록 서버 권한 모델을 추가한 뒤
개별 상태를 Beta로 바꿉니다.

## Avalon 빌드

`games/avalon/`은 Vite 빌드 산출물입니다. 직접 수정하지 말고
`_src/avalon/`에서 수정한 뒤 다음 명령으로 다시 생성합니다.

```bash
cd _src/avalon
./rebuild.sh
```

실시간 동기화는 Bubblelab Worker의 `/_rt/avalon` Durable Object를 사용하며
Firebase나 별도 외부 백엔드 키가 필요하지 않습니다. 상세 내용은
[`_src/avalon/README.md`](../_src/avalon/README.md)와
[`_src/avalon/MIGRATION.md`](../_src/avalon/MIGRATION.md)를 참고하세요.

새 정적 게임은 이 폴더에 바로 추가할 수 있지만, 보통 `slop/`에서 먼저 검증한 뒤
승격합니다.
