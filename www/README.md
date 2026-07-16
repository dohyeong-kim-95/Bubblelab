# www — Bubblelab 랜딩

`www/index.html`은 <https://bubblelab.dev>와 <https://www.bubblelab.dev>에 제공되는
가벼운 정적 랜딩 페이지입니다.

현재 랜딩은 다음 카테고리를 소개합니다.

- `slop`: 짧은 게임과 실험
- `games`: 승격된 게임
- `util`: 일상 도구
- `idle`: 7일 방치형 게임

`assets`, `invest`, `admin`도 독립 서브도메인으로 배포되지만 랜딩 목록에는 아직
노출하지 않습니다. 새 공개 카테고리를 랜딩에 보여주려면 `www/index.html`의 목록을
직접 수정해야 합니다. 빌드 스크립트가 이 페이지의 링크를 자동 갱신하지는 않습니다.
