# assets — 에셋 카탈로그 UI

<https://assets.bubblelab.dev>의 공개 에셋 카탈로그입니다. 루트 카드는 빌드 시
자동 생성되며 현재 `sticker/`, `wallpaper/`, `music/` 화면을 제공합니다.

- `catalog.js`: `/_assets/catalog.json`을 읽어 항목 카드, 미디어와 다운로드 버튼 생성
- `catalog.css`: 모든 카테고리가 함께 사용하는 반응형 스타일
- `sticker/index.html`: 스티커 목록
- `wallpaper/index.html`: 배경화면 목록
- `music/index.html`: 음악 재생 및 다운로드 목록

실제 파일과 메타데이터는 공개 UI 폴더가 아니라 [`../_assets/`](../_assets/)에서
관리합니다. 항목 추가 후 `node _infra/build.mjs`로 생성 카탈로그를 검증하세요.

현재 파일은 저장소에서 정적으로 배포됩니다. 관리자 화면의 업로드 UI와 R2 공개
경로는 비활성 상태이므로 새 에셋은 `_assets/`에 커밋해야 합니다.
