# games — 승격된 게임

<https://games.bubblelab.dev>의 승격 게임 소스입니다. 현재 카테고리 상태는
**Archived**이며 루트 카드 페이지에는 공개 항목이 없습니다.

> 공개 보안 정비 중에는 인증·방 권한 모델이 필요한 실시간 게임 3개를 카드
> 목록에서 숨기고 `ENABLE_REALTIME=false`로 서버 경로를 닫아 둡니다. 소스와
> 직접 URL은 삭제하지 않습니다.

| 경로 | 상태 | 게임 | 구성 |
| --- | --- | --- | --- |
| `avalon/` | Archived | The Resistance: Avalon | 5–10인 실시간 멀티플레이 |
| `liargame/` | Archived | 라이어 게임 | 각자의 휴대폰으로 함께 플레이 |
| `yacht/` | Archived | 야추 | `/_rt/yacht`를 사용하는 실시간 주사위 게임 |

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
