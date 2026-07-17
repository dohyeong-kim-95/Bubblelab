# photo-frame — 네컷사진 프레임 원본

상태: **Beta**. `util/photo` 프레임 선택 화면과 assets 카탈로그에 노출됩니다.

`util/photo`에서 공용으로 사용할 네컷사진 프레임을 둡니다. 카탈로그에 오른
프레임은 네컷사진의 프레임 선택 화면에 자동으로 나타나고, 선택하면 커스텀
프레임으로 로드되어 사용자가 자유롭게 고쳐 쓸 수 있습니다.

## 항목 구성

다른 이미지 항목과 동일하게 미리보기, 다운로드 파일, `metadata.json`을 한 폴더에
넣습니다. 공통 형식은 [`../README.md`](../README.md)를 참고하세요. 다운로드에는
반드시 `frame.json` 하나가 있어야 하며(`util/photo`가 `.json`으로 끝나는 첫
다운로드를 프레임 정의로 사용), 미리보기는 600×1800 스트립 이미지를 권장합니다.

## frame.json 형식

`util/photo` 꾸미기 화면의 "프레임 내보내기"가 만들어주는 ZIP에 `frame.json`과
`preview.png`가 함께 들어 있습니다. 사용자가 보낸 ZIP을 풀어 폴더에 넣고
`metadata.json`만 작성하면 됩니다.

```json
{
  "version": 1,
  "color": "#dbeafe",
  "title": "MY FOUR CUTS",
  "stickers": [
    { "x": 0.41, "y": 0.16, "size": 0.34, "rotation": -6, "image": "data:image/webp;base64,..." }
  ]
}
```

- `color`: 프레임 배경색 (`#rrggbb`). 글자색은 밝기에 따라 자동 결정됩니다.
- `title`: 스트립 상단 문구 (최대 40자).
- `stickers[].x/y`: 1200×3600 스트립 기준 중심 위치 비율. `size`는 폭 비율,
  `rotation`은 도 단위.
- `stickers[].image`: `data:image/…` 데이터 URI (webp 또는 png, 최장변 1200px 이하).

## 검수 체크

- 스티커 이미지에 개인 식별 정보나 초상권·저작권 문제가 없는지 확인합니다.
- `node _infra/build.mjs`로 카탈로그 생성 오류가 없는지 확인합니다.
- 로컬에서 `util/photo` 프레임 선택 화면에 정상 표시·적용되는지 확인합니다.
