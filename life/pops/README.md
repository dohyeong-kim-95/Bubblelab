# Pops

`life.bubblelab.dev/pops/`는 개인용 세로 영상 피드다. 현재는 CEFR A1 스페인어 단어
학습 영상을 8개 넣어 스와이프 성능을 확인하는 단계다.

## 콘텐츠

- `content/a1-words.json`: `_infra/pops-a1.mjs`가 생성한 A1 단어 200개와 예문
- `content/manifest.json`: 피드에 노출할 영상 목록
- `content/videos/`: 최종 MP4. 현재 360×640, 18초, H.264/AAC

단어 원본을 다시 만들 때:

```bash
node _infra/pops-a1.mjs
```

초기 성능 fixture 영상은 CC0 배경음과 단어 텍스트를 조합해 만들었다. 향후 터미널
생성기는 `asset.bubblelab.dev`의 템플릿·TTS·음원을 받아 최종 MP4를 만들고, 이 폴더의
manifest와 영상만 갱신한다. 앱은 asset 도메인을 런타임에 호출하지 않는다.

## 음원 출처

등록된 5개 음원은 OpenGameArt 원본 페이지에서 CC0로 표시된 자료다. 법적 의무는
없지만, 출처 보존을 위해 metadata의 `source`와 `license`를 유지한다.
