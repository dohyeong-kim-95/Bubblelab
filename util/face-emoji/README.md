# 얼굴 SD 캐릭터

사진 한 장에서 얼굴 랜드마크를 읽고, 브라우저의 Canvas 2D로 SD 캐릭터를
그리는 도구다. **사진·얼굴 랜드마크·원본 Blob은 서버로 보내거나 저장하지
않는다.** 결과 PNG만 사용자가 직접 내려받거나 공유한다.

## 데이터 경계

- `input[type=file]`의 파일은 브라우저 메모리에서만 연다.
- MediaPipe 코드·WASM·모델은 이 폴더의 동일 출처 정적 파일이다.
- 사진 선택 뒤 업로드 API, `fetch`/XHR 업로드, `sendBeacon`, form submit을 만들지 않는다.
- 원본과 랜드마크를 `localStorage`, `sessionStorage`, `IndexedDB`, Cache API에 넣지 않는다.
- 빌드가 자동으로 넣는 `/_visit`·`/_engagement`는 방문/체류 메타데이터만 보내며,
  사진·랜드마크를 payload에 넣지 않는다.
- 결과 공유는 생성된 PNG 또는 URL만 사용하고 원본 파일은 공유하지 않는다.

## 지원 범위

- 한 장에 얼굴 한 명
- 정면에 가까운 얼굴, 충분히 큰 얼굴, 밝고 선명한 사진
- JPEG·PNG·WebP 등 브라우저가 디코드할 수 있는 이미지
- 결과는 사진 복제가 아니라 얼굴 비율·눈·눈썹·코·입·표정을 참고한 SD 캐릭터

얼굴이 없거나 여러 명이거나 얼굴이 너무 작거나 옆으로 돌아간 경우에는 결과를
만들지 않고 사진을 다시 고르게 한다. 머리카락·안경·옷·배경은 랜드마크만으로
복원하지 않는다.

## 벤더 자산

`vendor/vision_bundle.mjs`와 `vendor/wasm/`은 `@mediapipe/tasks-vision` 1.0.1,
`vendor/face_landmarker.task`는 Google MediaPipe Face Landmarker 모델의 고정
자산이다. 상세한 저작권·라이선스는 루트 `THIRD_PARTY_NOTICES.md`와 upstream
문서를 참고한다.

## 단계별 게이트

- Phase 0: 브라우저 전용 처리와 데이터 경계 확정
- Phase 1: 정적 UI·파일 수명 관리·동일 출처 엔진 준비
- Phase 2: 얼굴 한 명 판정과 실패 안내
- Phase 3: Canvas SD 캐릭터와 PNG 다운로드

