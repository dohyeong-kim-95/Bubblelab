# 인스타툰 미리보기 (dageudangs.bubblelab.dev)

인스타그램에 올리기 전에 시안을 프로필 격자·넘겨 보기 그대로 확인하는 비공개 화면
(`CONFIDENTIAL_SUBDOMAINS`, 로그인 없음 — 주소를 아는 사람만, `noindex`). 토이 관례
(share.js·주간 기록)는 적용하지 않는다.

**저장소에는 화면 형식만 있다.** 계정·콘티·캡션·컷 JPEG·프로필 사진·컷 그림은 저장소에 두지 않고
로컬 `~/dageudangs-lab/toon/`(원래 폴더 구조 그대로)에서만 다룬다(사용자 지시, 2026-11-05).

- `index.html` — mock 인스타 UI(프로필 격자·게시물 넘겨 보기·공유/받기/캡션 복사 버튼·콘티 목록).
- `episodes.json` — 빈 형식: `{"account": {"handle", "name", "bio", "avatar"?}, "episodes": []}`.
  episodes 가 비어 있으면 화면은 회색 자리표시 칸과 "게시물이 없습니다" 안내를 보인다. `account.avatar` 가
  없으면 프로필 사진도 회색 원이다.

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
