# slop — 실험장

생각나면 바로 만드는 곳. 완성도 신경 쓰지 말 것.

## 새 토이 만들기 (2분)

```bash
mkdir slop/my-idea
vim slop/my-idea/index.html
git add . && git commit -m "slop: my-idea" && git push
# → https://slop.bubblelab.dev/my-idea
```

index.html 하나면 충분. 홈(slop.bubblelab.dev)의 카드 그리드에는 자동으로,
최신순으로 올라간다.

## 관례 (안 지켜도 되지만 지키면 좋은 것)

- **이모지 하나** — 파일 안 첫 이모지가 홈 카드 아이콘이 된다.
  `<title>` 옆이든 주석(`<!-- 🎲 -->`)이든 아무 데나.
- **공유 버튼** — `</body>` 직전에 한 줄:
  ```html
  <script defer src="/_shared/share.js"></script>
  ```
  자랑 문구를 넣고 싶으면 (예: 반응속도 기록):
  ```js
  window.blShareText = () => `내 기록은 ${best}ms! 도전해보세요`;
  ```
- **다크모드** — `:root { color-scheme: light dark; }` 넣고 색은
  `light-dark(밝은색, 어두운색)` 쓰면 공짜로 대응된다.
- 이 폴더의 README.md는 배포되지 않는다 (빌드에서 제외).

## 승격

사람들이 쓰거나 내 맘에 들면:

```bash
git mv slop/my-idea games/my-idea && git push
```
