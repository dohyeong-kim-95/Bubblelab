# _assets — 공용 에셋 원본

Bubblelab 서비스가 함께 사용하는 이미지·음악과 카탈로그 메타데이터를 관리합니다.
빌드 시 폴더 전체가 `dist/_assets/`로 복사되고, 모든 `metadata.json`을 합친
`/_assets/catalog.json`이 생성됩니다.

| 카테고리 | 용도 |
| --- | --- |
| `sticker/` | 개별 다운로드용 스티커 팩 |
| `wallpaper/` | 모바일·PC 배경화면 |
| `photo-frame/` | 네컷사진 공용 프레임 |
| `music/` | 미리듣기와 다운로드용 음악 |

## 항목 추가

1. `_assets/<category>/<id>/` 폴더를 만듭니다.
2. 미리보기와 다운로드 파일을 넣습니다.
3. 같은 폴더에 `metadata.json`을 작성합니다.
4. `node _infra/build.mjs`를 실행해 카탈로그 생성 오류가 없는지 확인합니다.

필수 규칙:

- 카테고리는 `sticker`, `wallpaper`, `photo-frame`, `music` 중 하나입니다.
- ID와 파일명은 영문·숫자·점·밑줄·하이픈만 사용합니다.
- `title`, `preview`, `downloads`가 필요하며 참조한 파일은 실제로 존재해야 합니다.
- 음악은 MP4 미리보기와 다운로드할 오디오 파일을 함께 둘 수 있습니다.
- 공개 목록에서만 숨기려면 `"active": false`를 추가합니다.
- 현재 운영 경로는 저장소에 커밋된 정적 파일입니다.
