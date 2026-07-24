# sticker — 스티커 원본

상태: **Beta**. 아래 팩은 정적 파일로 공개되며 업로드 입력을 받지 않습니다.

<https://assets.bubblelab.dev/sticker> 카탈로그의 원본 스티커 팩입니다.

현재 팩:

| ID | 제목 | 파일 |
| --- | --- | --- |
| `brown-horse` | 손그림 갈색 말 이모티콘 16종 | `01.png`–`16.png` |
| `golden-retriever` | 골댕이 이모티콘 16종 | `01.png`–`16.png` |
| `pink-horse` | 핑크 말 이모티콘 16종 | `01.png`–`16.png` |
| `simple-horse` | 심플 손그림 말 이모티콘 16종 | `01.png`–`16.png` |
| `blonde-horse` | 금발 갈기 말 이모티콘 16종 | `01.png`–`16.png` |
| `tennis-samoyed` | 테니스 사모예드 이모티콘 16종 | `01.png`–`16.png` |
| `hoodie-cat` | 후드 회색 고양이 이모티콘 16종 | `01.png`–`16.png` |
| `ribbon-cat` | 리본 핑크후드 고양이 이모티콘 16종 | `01.png`–`16.png` |
| `couple-cat` | 커플 고양이 이모티콘 16종 | `01.png`–`16.png` |
| `dog-cat-friends` | 멍냥 단짝 이모티콘 16종 | `01.png`–`16.png` |
| `day-off-seal` | 오늘은 연차 물범 이모티콘 16종 | `01.png`–`16.png` |
| `office-hamster` | 직장인 햄스터 이모티콘 16종 | `01.png`–`16.png` |

각 팩은 미리보기(`preview.webp` 또는 `preview.png`), 개별 이미지,
`metadata.json`으로 구성됩니다. 새 팩의 형식과 검증 규칙은
[`../README.md`](../README.md)를 참고하세요.

## 새 팩 추가 (권장 경로)

4x4 그리드 시트 이미지(PNG 또는 JPEG) 하나로 팩 전체를 생성합니다:

```bash
node _infra/sticker-pack.mjs 시트.png <팩id> --title "제목 16종" \
  --labels labels.txt --chat "짧은제목" --tags "태그,태그"
```

- 슬라이스·여백 트리밍·`preview.png`·`metadata.json`·위 표 갱신까지 자동입니다.
- 절단선은 행 먼저, 그다음 행별로 열을 잡되 균등 위치 근처에서 그림을 피해
  지나갑니다 — 그림이 격자선을 살짝 넘어도 이웃 셀에 조각이 남지 않습니다.
- 불투명 시트는 흰 배경을 생성 시점에 투명하게 땁니다(누끼). `--no-cutout`으로
  끄고, 이미 투명한 시트는 자동으로 건너뜁니다.
- `--labels`: 셀 순서(좌→우, 위→아래)대로 한 줄에 하나씩 적은 파일 (16줄).
- `--chat "짧은제목"`을 주면 익명 채팅(util/chat) 스티커 서랍에도 등록됩니다 —
  `metadata.json`의 `chat.title`과 `_infra/chat.js`의 `CHAT_STICKER_PACKS`가
  함께 갱신되고, 클라이언트는 `catalog.json`에서 팩 목록을 읽으므로 손댈 곳이
  없습니다. 등록 누락·장수 불일치는 `_infra/sticker-pack.test.mjs`가 잡습니다.

외부 배포 범위를 넓히기 전에 팩별 상업적 사용·수정·재배포·저작자 표시 및 AI 생성
여부를 metadata에 표시해야 합니다.
