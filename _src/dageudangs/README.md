# 다그당스 인스타툰 렌더러 (배포 안 됨)

`render.py` 가 `dageudangs/episodes.json` 을 읽어 `dageudangs/epNN/*.jpg` 를 굽는다.

- `art/` — 컷 그림. `_assets/sticker/dageudangseu-N/NN.png` 를 waifu2x(cunet, `-n 0 -s 2`)로
  2배 키운 것이고 이름은 `<팩>-<번호>.png`. 새 그림이 필요하면 같은 방식으로 추가한다.
- `fonts/Jua-Regular.ttf` — SIL OFL 1.1 (`fonts/OFL.txt`).
- `art/2-15d.png` — 2-15 의 아날로그 시계(5시 59분이 아니었다)를 17:59 디지털 시계로 바꾼 것.
  `clock.py` 로 다시 만든다(numpy·scipy 필요).
