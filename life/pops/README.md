# Pops

`life.bubblelab.dev/pops/`는 개인용 세로 영상 피드다. 현재는 CEFR A1 스페인어 단어
학습 영상 50개로 스와이프 성능을 확인하는 단계다.

## 콘텐츠

- `content/manifest.json`: 피드에 노출할 영상 목록
- `content/videos/`: 최종 MP4. 현재 360×640, 20초 이하, H.264/AAC
- 서비스에는 manifest와 최종 MP4만 배포한다. 단어 원본·TTS WAV·모델은 로컬
  `pops_generator/`에만 둔다.

단어 원본을 다시 만들 때:

```bash
node pops_generator/generate50.mjs
./pops_generator/render50.sh
```

로컬 생성기는 단어 → 0.5초 → 뜻 → 0.5초 → 예문 → 0.5초 → 예문뜻 → 0.5초
순서로 TTS를 조합해 최종 MP4를 만들고, 이 폴더의 manifest와 영상만 갱신한다.
앱은 asset 도메인이나 TTS 모델을 런타임에 호출하지 않는다.

## 음원 출처

등록된 5개 음원은 OpenGameArt 원본 페이지에서 CC0로 표시된 자료다. 법적 의무는
없지만, 출처 보존을 위해 metadata의 `source`와 `license`를 유지한다.
