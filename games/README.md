# games — 승격된 게임

<https://games.bubblelab.dev>에서 서비스하는 게임 모음입니다. 루트 카드 페이지는
자동 생성됩니다.

> 공개 보안 정비 중에는 인증·방 권한 모델이 필요한 실시간 게임 3개를 카드
> 목록에서 숨기고 `ENABLE_REALTIME=false`로 서버 경로를 닫아 둡니다. 소스와
> 직접 URL은 삭제하지 않습니다.

| 경로 | 게임 | 구성 |
| --- | --- | --- |
| `avalon/` | The Resistance: Avalon | 5–10인 실시간 멀티플레이 |
| `liargame/` | 라이어 게임 | 각자의 휴대폰으로 함께 플레이 |
| `yacht/` | 야추 | 로컬 주사위 보드게임 |

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
