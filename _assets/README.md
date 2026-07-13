# Bubblelab 공용 이미지 추가 안내

실제 이미지 파일은 이 폴더 한 곳에서 관리합니다.

- `wallpaper/`: 다운로드용 배경화면
- `sticker/`: 다운로드 및 다른 Bubblelab 서비스에서 사용할 스티커
- `photo-frame/`: 네컷사진 등에서 사용할 공용 프레임

## 이미지 하나 추가하기

1. 알맞은 카테고리 아래에 영문 소문자 ID로 폴더를 만듭니다.
   예: `_assets/sticker/hello-bear/`
2. 원본·미리보기 파일을 폴더에 넣습니다.
3. 같은 폴더에 `metadata.json`을 만듭니다.
4. `main`에 반영하면 빌드가 `/_assets/catalog.json`을 자동 생성합니다.

```json
{
  "title": "안녕 곰돌이",
  "description": "인사하는 곰돌이 투명 스티커",
  "preview": "preview.webp",
  "tags": ["곰", "인사", "귀여움"],
  "createdAt": "2026-07-14",
  "downloads": [
    { "label": "투명 PNG", "file": "hello-bear.png" }
  ]
}
```

`wallpaper`는 하나의 항목에 모바일·PC 파일을 함께 넣을 수 있습니다.

```json
{
  "title": "여름 구름",
  "description": "푸른 여름 하늘 배경화면",
  "preview": "preview.webp",
  "tags": ["여름", "하늘"],
  "createdAt": "2026-07-14",
  "downloads": [
    { "label": "모바일", "file": "mobile.webp" },
    { "label": "PC", "file": "desktop.webp" }
  ]
}
```

폴더명과 파일명은 영문·숫자·점·밑줄·하이픈만 사용합니다. 공개 목록에서만 내리려면 `"active": false`를 추가하세요. 파일을 삭제하지 않으므로 기존 서비스의 링크는 유지됩니다.
