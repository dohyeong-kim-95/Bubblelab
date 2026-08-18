# 서재 (life/library)

읽은 책을 표지와 한두 줄로 남긴다. **증명이 목적**이라 독후감은 140자까지만 받고,
제목과 한두 줄이 없으면 저장되지 않는다.

주소는 `life.bubblelab.dev/library/`. LIFE 의 할 일에 `library` 를 연결해 두면
그 할 일을 두 번 눌러 바로 열 수 있다.

## 만듦새

- **저장은 IndexedDB(`bl_library`)** 다. 표지가 있어 localStorage 로는 금방 넘치고,
  책 한 권이 곧 레코드 하나라 그대로 맞는다. 서버로 나가는 것은 없다.
- **표지는 기기에서 고른 사진**을 긴 변 400px JPEG 로 줄여 data URL 로 담는다.
  외부 책 API 를 부를 수 없고(CSP `connect-src 'self'`), 남의 서버 주소를 저장하면
  그쪽이 사라질 때 기록도 함께 깨진다. 400KB 를 넘으면 화질을 낮춰 다시 시도한다.
- 규칙(길이 상한·정렬·연도 묶기)은 `store.js` 순수 함수에만 있다. 화면과
  `_infra/library.test.mjs` 가 같은 모듈을 쓴다.
- 화면 뼈대는 LIFE 의 `../styles.css` 를 그대로 물려받고, 서재에만 필요한 것만 더한다.

## 검증

```bash
node --test _infra/library.test.mjs
npx playwright test _infra/e2e/library.spec.mjs
```
