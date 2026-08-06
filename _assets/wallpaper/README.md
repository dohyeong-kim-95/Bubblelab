# wallpaper — 배경화면 원본

상태: **Beta**. 저장소에 커밋된 정적 파일만 공개합니다.

<https://assets.bubblelab.dev/wallpaper>에 보여 줄 배경화면 항목을 둡니다.
한 항목(`<id>/`)이 카탈로그 카드 하나이고, 기기별 규격은 `downloads` 배열에
함께 등록합니다.

현재 항목:

| ID | 제목 | 파일 |
| --- | --- | --- |
| `stars-bootes` | 목동자리 밤하늘 | `mobile.png` |

## 항목 추가 (원샷)

이미지 파일 하나를 아래 스크립트에 넘기면 규격별 잘라내기·미리보기·
`metadata.json`·위 표까지 한 번에 만들어집니다. 손으로 편집할 파일은 없습니다.

```bash
node _infra/wallpaper.mjs <이미지.png|.jpg> <id> --title "제목" \
  --sizes mobile,desktop --tags "태그,태그" --desc "설명"
```

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--sizes` | `mobile,desktop` | 쉼표로 나열 — `mobile`(1290×2796), `tablet`(2048×2732), `desktop`(2560×1440), `wide`(3440×1440), `square`(2048×2048), `original`(원본 비율, 긴 변 4096) |
| `--focus` | `center` | 잘라낼 때 남길 쪽 — `center`, `top`, `bottom`, `left`, `right` |
| `--format` | `jpg` | 사진은 `jpg`, 생성 그래픽(util/stars 같은 어두운 그라데이션·가는 선·작은 글씨)은 `png` |
| `--quality` | `90` | JPEG 품질 (40–100). `--format png`에서는 무시 |
| `--force` | — | 같은 id 덮어쓰기 (README 표는 행이 늘지 않고 교체됨) |

`id`를 생략하면 파일명에서 만듭니다. 실행 후 `node --test _infra/*.test.mjs`와
`node _infra/build.mjs`로 검증하세요.

동작 규칙:

- 잘라내기는 항상 채우기(cover) — 대상 비율로 잘라낸 뒤 축소합니다.
- **확대는 하지 않습니다.** 원본이 규격보다 작으면 비율만 맞춘 원본 해상도로
  저장하고 라벨에 실제 크기를 적습니다(경고도 함께 출력).
- 출력은 항상 재인코딩이라 EXIF(촬영 위치·기기)가 자동으로 제거됩니다.
- 투명 배경(PNG 알파)은 흰색 위에 합성됩니다.
- `--format png`는 무손실입니다(원본과 픽셀이 같습니다). 대신 JPEG보다
  3–4배 큽니다. 넓은 어두운 면이 있는 그래픽은 JPEG에서 띠가 보이므로 png를
  쓰고, 사진은 jpg가 낫습니다.
- 미리보기(`preview.jpg`)는 카탈로그 페이지 무게 때문에 `--format`과
  무관하게 항상 JPEG입니다.
- 카탈로그의 [전체 | 📱 모바일 | 🖥️ PC] 탭 분류는 규격 이름이 아니라 **출력
  비율**로 정해져 `metadata.json`의 `downloads[].device`에 들어갑니다 —
  세로는 `mobile`, 가로는 `desktop`, 정사각은 값이 없어 양쪽에 다 보입니다.
- `--force` 재실행에서 규격·형식이 바뀌면 이전 파일은 자동으로 지워집니다.

## 공개 전 확인

- 원본의 권리(직접 제작·AI 생성 여부, 재배포·상업적 사용 범위)를 항목 설명이나
  이 문서에 남깁니다.
- 사람 얼굴·상표·타사 캐릭터가 들어간 이미지는 올리지 않습니다.

폴더 구조와 `metadata.json` 형식 전반은 [`../README.md`](../README.md)를
참고하세요.
