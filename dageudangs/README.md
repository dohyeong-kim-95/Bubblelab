# 인스타툰 미리보기 (dageudangs.bubblelab.dev)

인스타그램에 올리기 전에 시안을 프로필 격자·넘겨 보기 그대로 확인하는 비공개 화면
(`CONFIDENTIAL_SUBDOMAINS`, 로그인 없음 — 주소를 아는 사람만, `noindex`). 토이 관례
(share.js·주간 기록)는 적용하지 않는다.

**저장소에는 화면 형식만 있다.** 계정·콘티·캡션·컷 JPEG·프로필 사진·컷 그림은 저장소에 두지 않고
로컬 `~/dageudangs-lab/toon/`(원래 폴더 구조 그대로)에서만 다룬다(사용자 지시, 2026-11-05).

- `index.html` — mock 인스타 UI. 프로필 아래 탭 줄 **게시물 격자 | 릴스**.
  - 게시물: 격자(3:4) → 넘겨 보기·공유/받기/캡션 복사·콘티 목록.
  - 릴스: 세로 9:16 격자 → 누르면 전체 화면 세로 스와이프(스크롤 스냅). 화면의 반 넘게 들어온 것만 자동
    반복 재생하고, 누르면 일시정지, 🔇/🔊 소리, 오른쪽 좋아요·댓글·공유 자리(장식), 아래 계정·캡션(두 줄 접힘·눌러 펼침).
    키보드 ↑↓·j/k·m·Esc. 주소는 `#reels`, `#reels/N`(N번째 전체 화면).
- `episodes.json` — 빈 형식: `{"account": {"handle", "name", "bio", "avatar"?}, "episodes": []}`.
  episodes 가 비어 있으면 화면은 회색 자리표시 칸과 "게시물이 없습니다" 안내를 보인다. `account.avatar` 가
  없으면 프로필 사진도 회색 원이다.

## 로컬 파일로 채우기 (서버 업로드 없음)

화면 위 **📂 폴더 불러오기 / 🎞️ 파일 고르기**, 또는 창에 끌어다 놓기(폴더째 가능). 고른 파일은
`URL.createObjectURL` 로 그 자리에서만 보이고 **어디에도 올라가지 않는다** — 새로고침하면 사라진다.

- 폴더 안에 `episodes.json` 이 있으면 게시물 탭을 그것으로 바꾼다. 컷은 그 파일 기준 `<id>/NN.jpg`,
  프로필 사진은 `account.avatar` 경로로 같은 폴더에서 찾는다(`~/dageudangs-lab/toon/dageudangs` 를 고르면 된다).
- mp4·webm·mov·gif 는 릴스로 **덧붙는다**(파일 이름 순, 숫자는 자연 정렬). 「비우기」로 지운다.
- `reels.json` 이 같이 있으면 캡션과 순서를 읽는다. 형식은 `{"reels": [{"file": "a.mp4", "caption": "…"}]}`
  (배열만 있어도 된다). 화면에서 ✏️ 로 캡션을 고친 뒤 **💾 reels.json** 으로 받아 그 폴더에 두면 다음에도 그대로다.
- 로컬 컷의 「한 번에 받기·공유」는 파일을 그대로 쓴다 — `blob:` 주소는 CSP `connect-src` 밖이라 fetch 할 수 없다.

## 화의 형식 (로컬 episodes.json)

```json
{ "id": "ep01", "no": 1, "rev": 1, "title": "…", "caption": "…", "tags": ["…"],
  "kind": "zzal"?,                       // 한 장짜리 짤(제목 띠·컷 번호 없음, 격자에 "짤")
  "cuts": [{ "art": "<그림 이름>", "bg": "#rrggbb", "floor": "#rrggbb", "narr": "내레이션",
             "say": "말풍선"?, "end": "끝맺음"? }] }
```

컷 JPEG 는 `<id>/NN.jpg`(1080×1350, 4:5). **손으로 고치지 말고** 렌더러로 굽는다. 이미 본 화를 다시 구웠으면
`rev` 를 1 올린다(컷 JPEG 는 7일 캐시라 주소가 같으면 옛 그림이 보인다).

## 로컬에서 보기·굽기

```bash
python3 _src/dageudangs/render.py            # ~/dageudangs-lab/toon/dageudangs/episodes.json → 같은 폴더의 <id>/NN.jpg
python3 _src/dageudangs/render.py ep02       # 한 화만
# 화면으로 보려면 로컬 데이터를 빌드 산출물에 덮어 서빙(커밋하지 않는다):
node _infra/build.mjs && cp -r ~/dageudangs-lab/toon/dageudangs/* dist/dageudangs/ && node _infra/csp-serve.mjs
# → http://localhost:8788/dageudangs/
```

글자는 전부 렌더러가 Jua 폰트로 넣는다 — 그림 생성기가 쓴 글자는 맞춤법이 깨진다.
Jua 에는 `…` 글리프가 없어 □ 로 나오므로 `...` 를 쓴다.
