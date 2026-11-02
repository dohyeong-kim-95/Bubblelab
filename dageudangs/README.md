# 다그당스 인스타툰 미리보기 (dageudangs.bubblelab.dev)

인스타그램에 올리기 전에 시안을 프로필 격자·넘겨 보기 그대로 확인하는 비공개 화면
(`CONFIDENTIAL_SUBDOMAINS`, 로그인 없음 — 주소를 아는 사람만, `noindex`). 토이 관례
(share.js·주간 기록)는 적용하지 않는다.

- `episodes.json` — 계정 정보와 화별 콘티(컷마다 그림·배경색·내레이션·말풍선). 화면과
  렌더러가 같이 읽는 **원본**이다.
- `epNN/01.jpg…` — 1080×1350(4:5) 업로드용 컷. **손으로 고치지 말고** 렌더러로 굽는다.

## 한 화 추가

1. `episodes.json` 에 화를 추가한다(`art` 는 `_src/dageudangs/art/<팩번호>-<컷번호>.png`).
2. `python3 _src/dageudangs/render.py ep02` (Pillow 필요) → `dageudangs/ep02/` 생성.
3. 결과 JPEG 를 직접 열어 보고 커밋한다.

글자는 전부 렌더러가 Jua 폰트로 넣는다 — 그림 생성기가 쓴 글자는 맞춤법이 깨진다.
Jua 에는 `…` 글리프가 없어 □ 로 나오므로 `...` 를 쓴다.
