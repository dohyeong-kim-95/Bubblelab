# 인스타툰 렌더러 (배포 안 됨)

`render.py` 가 로컬 작업 폴더의 `episodes.json` 을 읽어 컷 JPEG 를 굽는다. **콘티·그림·결과물은 저장소에 없다** —
로컬 `~/dageudangs-lab/toon/`(원래 구조: `dageudangs/episodes.json`, `dageudangs/<id>/`, `_src/dageudangs/art/`)에 있다.

- 작업 폴더는 `--toon DIR` 또는 환경변수 `DGD_TOON`(기본 `~/dageudangs-lab/toon`). 경로를 하나씩 바꾸려면 `--data` `--art` `--out`.
- `fonts/Jua-Regular.ttf` — SIL OFL 1.1 (`fonts/OFL.txt`). 저장소에 남는다.
- 컷 그림(`art/<팩>-<번호>.png`)은 스티커 원본(`~/dageudangs-lab/stickers/`)을 waifu2x(cunet, `-n 0 -s 2`)로 2배 키운 것이고 로컬에만 둔다.
- `clock.py` — `art/2-15.png` 의 아날로그 시계를 17:59 디지털 시계로 바꿔 `art/2-15d.png` 를 만든다(numpy·scipy 필요, `DGD_TOON` 기준).
