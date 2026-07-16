# _assets — 공용 이미지 원본

Bubblelab 서비스가 함께 사용하는 이미지와 카탈로그 메타데이터를 관리합니다.
빌드 시 폴더 전체가 `dist/_assets/`로 복사되고, 모든 `metadata.json`을 합친
`/_assets/catalog.json`이 생성됩니다.

| 카테고리 | 용도 | 현재 상태 |
| --- | --- | --- |
| `sticker/` | 개별 다운로드용 스티커 팩 | 4개 팩, 각 16장 |
| `wallpaper/` | 모바일·PC 배경화면 | 항목 없음 |
| `photo-frame/` | 네컷사진 공용 프레임 | 항목 없음 |

## 항목 추가

1. `_assets/<category>/<id>/` 폴더를 만듭니다.
2. 미리보기와 다운로드 파일을 넣습니다.
3. 같은 폴더에 `metadata.json`을 작성합니다.
4. `node _infra/build.mjs`를 실행해 카탈로그 생성 오류가 없는지 확인합니다.

```json
{
  "title": "안녕 곰돌이",
  "description": "일상에서 쓰는 곰돌이 스티커 모음",
  "preview": "preview.webp",
  "tags": ["곰", "인사", "캐릭터"],
  "createdAt": "2026-07-16",
  "downloads": [
    { "label": "01. 안녕!", "file": "01.png" }
  ]
}
```

필수 규칙:

- 카테고리는 `sticker`, `wallpaper`, `photo-frame` 중 하나입니다.
- ID와 파일명은 영문·숫자·점·밑줄·하이픈만 사용합니다.
- `title`, `preview`, `downloads`가 필요하며 참조한 파일은 실제로 존재해야 합니다.
- 공개 목록에서만 숨기려면 `"active": false`를 추가합니다. 기존 URL을 보존하려면
  파일 자체는 삭제하지 않습니다.
- 현재 운영 경로는 저장소에 커밋된 정적 파일입니다. 관리자 R2 업로드 API와
  `/_assets/upload/*` 공개 경로는 비활성화되어 있습니다.
