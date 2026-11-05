# duri 비공개 스티커 (R2)

다그당스·아가당스처럼 **공개 저장소에 두지 않는 그림**은 리포가 아니라 R2 에 둔다.
리포가 PUBLIC 이라 `_assets/` 에 커밋하면 GitHub 에서 누구나 본다.

| 어디 | 무엇 |
| --- | --- |
| `~/dageudangs-lab/stickers/<팩>/` | **원본**(이 PC 한 곳). `01.png`–`16.png`, `preview.png`, `metadata.json`(라벨) |
| R2 `bubblelab-duri` 의 `stickers/<팩>/<파일>` | 서비스용 사본. `DURI_BUCKET` 을 같이 쓴다(새 버킷 없음) |
| `/_duri/sticker/<팩>/<NN\|preview>.png` | 워커가 **bl_duri 게이트 세션에게만** 내준다(`_infra/worker.js` 의 `serveDuriSticker`). `Cache-Control: private` |
| `duri/index.html` 의 `DURI_ONLY_PACKS` (`private: true`) | 앱이 이 팩만 위 주소로 그린다 |

DuriDO 의 방 초기화는 `photo/`·`lend/` 접두사만 지우므로 `stickers/` 는 남는다.
원본이 PC 한 곳뿐이니 `~/dageudangs-lab/` 은 따로 백업해 둔다.

## 올리기

```bash
npx wrangler login                                  # 만료됐으면 먼저
bash _src/duri-stickers/upload.sh --dry-run         # 올릴 목록
bash _src/duri-stickers/upload.sh                   # 원본 폴더의 팩 전부
bash _src/duri-stickers/upload.sh dageudangseu-5    # 팩 하나만
```

원본 폴더는 `DURI_STICKER_SRC`, 버킷은 `DURI_STICKER_BUCKET` 으로 바꿀 수 있다.
파일 이름이 워커 규칙(`NN.png`·`preview.png`, 팩은 소문자·숫자·하이픈)을 벗어나면 건너뛴다.

## 새 비공개 팩

1. `node _infra/sticker-pack.mjs` 로 만들되 **결과를 커밋하지 않는다** — 생긴
   `_assets/sticker/<팩>/` 를 `~/dageudangs-lab/stickers/` 로 옮기고, CLI 가 붙인
   `CHAT_STICKER_PACKS`·스티커 README 표 줄은 되돌린다(util/chat 공개 팩이 아니므로).
2. `bash _src/duri-stickers/upload.sh <팩>`
3. `duri/index.html` 의 `DURI_ONLY_PACKS` 에 `{ id, title, count, cutout: true, private: true }` 한 줄.
4. 당이가 쓸 거면 `_src/duri-sink/assistant.mjs` 의 `botSticker` 표에 `{pack, n}` 추가
   (당이는 그림을 보지 않고 번호만 보낸다).

같은 이름으로 다시 그렸으면 다시 올리고 `DURI_ONLY_PACKS` 의 `rev` 를 올린다 — 폰은
7일 캐시라 주소(`?v=`)가 바뀌어야 새 그림을 받는다.
