# SKILL — AI 움직이는 이모티콘 제작 방법론

AI API로 움직이는 이모티콘을 만들어 ① duri/assets에서 쓰고 ② 카카오/LINE에
입점 제안하기까지의 방법론. 2026-07 웹 리서치(공식 가이드 + 다수 2차 소스
교차 검증)와 이 리포의 기존 파이프라인(`_infra/sticker-pack.mjs`, duri
움직이는 스티커 v1)을 합쳐 정리했다. 다음에 이 작업을 할 때 이 문서부터 읽는다.

**주의**: 플랫폼 규격은 바뀐다. 제안 직전에 반드시 공식 가이드를 직접 열어
최종 확인할 것 — 카카오 <https://emoticonstudio.kakao.com>, LINE
<https://creator.line.me/en/guideline/animationsticker/detail/>.

## 0. 목표 규격 — 한 번 만들어 세 곳에 낸다

마스터는 **투명 배경 PNG 프레임 시퀀스(작업 캔버스 720×720, 12~24프레임,
1~2초 루프)** 하나로 잡고, 모든 납품 포맷은 여기서 변환한다. 720²·12~20프레임·
1~2초 루프는 카카오·LINE 요구의 교집합이며 duri v1 설계 메모와도 일치한다.

| | 카카오 (제안) | 카카오 (승인 후 납품) | LINE | duri/assets |
|---|---|---|---|---|
| 형식 | 애니 GIF 3종(**흰 배경**) + 정지 PNG 21종(투명) | **WEBP** — 반드시 카카오 공식 [WebP 애니메이터](https://emoticonstudio.kakao.com/webp-animator)로 변환 | **APNG** (.png) | APNG (또는 PNG+키프레임 리그, §7) |
| 개수 | 총 24종 | 24종 전부 애니메이션화 | 8/16/24종 세트 | 16종 (기존 팩 관례) |
| 크기 | 360×360px | 360×360px | ≤320×270px, 한 변 ≥270px | 원본 자유(표시 8.5rem) |
| 프레임 | GIF 24프레임 이하 | ≤24프레임, 프레임당 0.05~2.0초 | 5~20프레임 | 자유 |
| 재생 | — | 빈 프레임 금지 | 총 1·2·3·4초 중 하나, 루프 1~4회 | 무한 루프 |
| 용량 | GIF ≤2MB, PNG ≤150KB | — | **≤300KB/개** | 상식선 |
| 부속 | — | — | main 240×240 APNG, tab 96×74 PNG | preview + metadata.json |
| 비용/기간 | 제안 무료, 심사 2~4주 | 검수 왕복, 출시까지 2~5개월 | 등록 무료, 심사 며칠~1주 | 즉시 |

- 카카오 제안 승인율은 비공식 추정 **3~5%**(경쟁률 20~30:1). LINE은 규격
  충족이면 대부분 통과. 수익 배분은 양쪽 다 **판매가의 약 35%**가 작가 몫
  (앱마켓 30% 차감 후 5:5 안팎 — 비공식).
- LINE 용량 300KB가 실질 병목: 프레임 수 축소(20→10~12)와 팔레트 감량
  (pngquant류)이 파이프라인 필수 단계다.

## 1. 캐릭터 — 시트 먼저, 낱장 생성은 그다음

seed 고정만으로는 포즈가 바뀌면 캐릭터가 무너진다. 2026년 실무 표준은
**캐릭터 시트를 만들어 매 생성마다 멀티 이미지 레퍼런스로 넣는 것**.

1. 캐릭터 시트 생성: 정면/측면/뒷면 + 대표 표정 2~3개를 한 장에.
2. 이후 모든 생성(키프레임, 표정 변형)에 시트를 reference 이미지로 첨부하고
   "같은 캐릭터, ~하는 포즈"로 지시한다.
3. 16종 정지컷이 필요하면 **4×4 시트를 한 프롬프트로 생성**하는 게 시트 내
   일관성을 공짜로 얻는다 — 기존 `_infra/sticker-pack.mjs` 슬라이스
   파이프라인이 그대로 받는다.

모델 선택 (2026-07 정가):

- **Google `gemini-2.5-flash-image`(Nano Banana)** — 멀티 이미지 레퍼런스
  기반 캐릭터 유지에 현재 최강 평. $0.039/장. 기본값으로 쓴다.
- **OpenAI `gpt-image-1`** — 프롬프트 준수·부분 편집(images.edit) 강점.
  $0.01~0.17/장(품질별). 키프레임 "팔만 올린 버전" 식 편집에 병용.
- 대량 생산 단계(수백 장)까지 가면 SDXL+캐릭터 LoRA 셀프호스팅이 한계비용
  최저 — 파일럿 단계에서는 고려하지 않는다.

## 2. 애니메이션화 — 세 경로, 기본은 I2V

| 경로 | 통제력 | 비용 | 적합 |
|---|---|---|---|
| A. 이미지→비디오(I2V) API | 낮음 | 클립당 $0.1~0.75 | 자연스러운 2차 동작(머리카락·잔털림)이 필요한 컷 |
| B. 키프레임 생성 + 보간 | 높음 | 장당 $0.01~0.04 ×3~6장 | 24프레임 이하 이모티콘 대부분 — **기본 경로** |
| C. 리그(PNG 1장 + 키프레임 명세) | 최고 | $0 (이미 있음) | bounce·shake류 단순 동작, duri 전용 |

- **A (I2V)**: 정지컷을 Kling/Runway Gen-4 Turbo( $0.05/초 )/Veo 3.1 등에
  넣고 "간단한 반복 동작, 루프" 프롬프트로 2~4초 클립 → 프레임 추출.
  한계 네 가지를 알고 쓴다: 투명 배경 불가(단색 배경으로 생성 후 프레임별
  누끼), 루프 불일치(시작+끝 프레임 지정 기능이 있는 Kling/Pika로 완화),
  프레임 간 캐릭터 드리프트, 5초 미만도 클립 단위 과금.
- **B (키프레임+보간)**: 캐릭터 시트를 레퍼런스로 키프레임 3~6장을 이미지
  편집 생성 → RIFE/FILM으로 보간해 12~24프레임. 통제력이 가장 좋고
  이모티콘 프레임 수와 궁합이 맞는다. 프레임 간 미세 떨림(boiling)이
  생기면 보간 원본 키프레임 수를 늘려 잡는다.
- **C (리그)**: duri v1이 이미 구현한 방식(`duri/index.html`의
  `ANIM_PRESETS`·`STICKER_ANIM`). 같은 키프레임 명세를 캔버스로 프레임
  렌더하면 GIF/APNG/WEBP로 구울 수 있다 — 표정이 안 변하는 단순 동작이면
  생성 비용 0원으로 카카오/LINE 규격까지 간다.

한 팩 안에서 경로를 섞는다: 단순 동작은 C, 표정·포즈 변화는 B, 히어로 컷
몇 개만 A.

## 3. 후처리 파이프라인 (전부 오픈소스)

```
클립/프레임 → ffmpeg  프레임 추출·fps 조정 (12~24f, 1~2초 루프)
→ rembg     프레임별 배경 제거 (I2V 산출물만 — 생성 시 투명이면 생략)
→ 리사이즈   마스터 720² → 카카오 360² / LINE 320×270(한 변 ≥270)
→ 변환
   GIF  (카카오 제안 3종: 흰 배경 합성 후) — gifski 품질 최상, ffmpeg palettegen 차선
   APNG (LINE·duri) — apngasm 또는 ffmpeg -f apng, 이후 300KB까지 감량
                      (프레임 수↓ → pngquant 팔레트 축소 → 그래도 넘으면 캔버스↓)
   WEBP (카카오 납품) — 반드시 카카오 WebP 애니메이터로 최종 변환
                      (다른 도구 산출물은 정상 실행 안 됨)
```

- 누끼 검증은 `sticker-pack.mjs`와 같은 기준: 산출 PNG의 모서리·배경 픽셀
  알파를 셀별 자동 확인, 육안 검증에 의존하지 않는다.
- 루프 검증: 첫 프레임과 끝 프레임의 픽셀 diff가 크면 루프가 튄다 —
  자동 체크 후 실패 컷만 재생성.

## 4. 비용 감각 (2026-07 정가 기준)

| 단위 | 비용 |
|---|---|
| 이미지 1장 | $0.01~0.17 (Nano Banana $0.039) |
| I2V 1초 | 저가군 $0.05~0.15, Veo 3.1 $0.40~0.75 |
| 스티커 1종 (재시도 2~3회 포함) | **$0.5~2** |
| 24종 풀세트 | **$15~60** — 재시도율이 지배 변수 |

파일럿(1캐릭터 × 4~6동작)은 $10 안쪽. 예산은 API 콘솔 한도로 걸어두고
시작한다. 키는 로컬 env로만 — 리포는 public이다.

## 5. 품질 기준 — 심사는 규격이 아니라 매력으로 떨어진다

카카오 승인율 3~5%의 의미: 규격 충족은 출발선이고, 떨어지는 건 캐릭터
매력·감정 전달·실사용성이다.

- **동작보다 감정**: 이모티콘은 대화 대체재다. 16~24종이 인사/긍정/부정/
  애정/일상 리액션을 고루 덮는지 목록부터 설계한다(기존 팩들의 라벨
  구성 참고 — `_assets/sticker/*/metadata.json`).
- **루프의 완성도**: 튀는 루프 하나가 팩 전체 인상을 깎는다. §3 루프
  검증을 통과 기준으로.
- **AI 티 제거**: 프레임 간 디테일 드리프트(장신구가 생겼다 없어지는 것)는
  즉시 탈락 사유급. B 경로(키프레임 통제)가 기본인 이유.
- duri 1차 목표의 진짜 가치: **실사용 테스트베드**. 둘이 실제로 쓰면서
  자주 쓰는 컷/안 쓰는 컷을 확인한 뒤 그 데이터로 제안 세트를 짠다.

## 6. 플랫폼 AI 정책 — 전략을 결정하는 제약

- **카카오: 사실상 입점 불가.** 2023-09부터 생성형 AI 활용 이모티콘 입점을
  잠정 제한했고 2025-04 언론 확인 시점에도 "정책 변화 없음". 해제 보도는
  2026-07 조사 시점까지 없다. → AI 산출물로 카카오 제안은 현재 미승인
  리스크가 크다. 카카오 트랙은 (a) 정책 해제 대기, (b) 손그림 원화 +
  C 경로 리깅(AI 미사용) 워크플로 중 택일.
- **LINE: 허용 + 자동 표기.** AI 생성/보조 여부를 등록 시 신고하면 구매
  화면에 "AI 사용"이 자동 표기된다. 타 저작물·유명 캐릭터 모방은 금지.
  → **2차 목표의 현실적 1순위는 LINE**(8종 세트부터). OGQ(네이버) 등
  국내 대안 마켓도 후보.
- 어느 쪽이든 제안 전 원본을 public 리포에 커밋하지 않는다(README 주의
  항목).

## 7. duri/assets 통합 (1차 목표)

- **팩 포맷: APNG를 그대로 쓴다.** APNG는 모든 모던 브라우저 `<img>`에서
  네이티브 재생되므로, `01.png`~`16.png`를 APNG로 만들면 기존 정적 팩과
  같은 파일 규약으로 duri·assets에서 즉시 움직인다. 클라이언트는
  `prefers-reduced-motion` 대응만 확인(리그 방식은 이미 꺼짐, APNG는
  정지 대체 이미지 제공 여부 결정 필요).
- 등록 절차는 기존과 동일: `metadata.json` + preview + `CHAT_STICKER_PACKS`
  등록, `_infra/sticker-pack.test.mjs`가 동기화 검사. 시트 슬라이스가 아닌
  개별 생성이므로 `sticker-pack.mjs`의 등록 부분만 재사용하는 별도 CLI
  (`_infra/emoticon-pack.mjs` 예정)로 만든다.
- 단순 동작 컷은 기존 리그 방식(C 경로)과 공존한다 — 리그는 용량 0에
  즉시 수정 가능하므로, APNG는 리그로 표현 못 하는 컷(표정 변화·프레임
  애니메이션)에만 쓴다.

## 8. 실행 체크리스트 (파일럿 1회분)

1. 캐릭터 시트 1장 생성·확정 (레퍼런스로 계속 재사용)
2. 동작 4~6개: C 경로 1개(비용 0 대조군) + B 경로 3~4개 + A 경로 1개
3. §3 파이프라인 관통 → duri 표시 확인 + LINE 규격(320×270·≤300KB·
   5~20f) 산출물 생성까지
4. 루프·누끼 자동 검증 통과
5. 재시도율·소요 비용 기록 → 본 제작 예산 산정
6. `node _infra/build.mjs` + 로컬 서빙으로 duri에서 실제 재생 확인

## 참고 자료

- 카카오: [이모티콘 스튜디오](https://emoticonstudio.kakao.com) ·
  [운영 원칙](https://emoticonstudio.kakao.com/guideline) ·
  [WebP 애니메이터](https://emoticonstudio.kakao.com/webp-animator) ·
  [제안~출시 과정(이모티팡)](https://creator.emotipang.com/blog/kakaotalk-emoticon-process) ·
  [AI 입점 제한 보도(뉴스1, 2025-04)](https://www.news1.kr/it-science/general-it/5743296)
- LINE: [Animated Sticker Guidelines](https://creator.line.me/en/guideline/animationsticker/detail/) ·
  [AI-generated content 정책](https://help.line.me/line/smartphone/sp?contentId=200001248) ·
  [Animation Sticker Checker(LINE Engineering)](https://engineering.linecorp.com/en/blog/line-animation-sticker-checker-on-web-browser/)
- 도구: [gifski](https://gif.ski) · [apngasm](https://apngasm.sourceforge.net) ·
  [rembg](https://github.com/danielgatis/rembg) ·
  [RIFE](https://github.com/hzwer/ECCV2022-RIFE) /
  [FILM](https://github.com/google-research/frame-interpolation)
- 가격: [Gemini API](https://ai.google.dev/gemini-api/docs/pricing) ·
  [Runway API](https://docs.dev.runwayml.com/guides/pricing/) ·
  [비디오 API 비교(2026-07)](https://www.buildmvpfast.com/api-costs/ai-video)
- 리포 내부: `_infra/sticker-pack.mjs`(시트 슬라이스·등록·검증) ·
  `duri/index.html` `ANIM_PRESETS`(리그 v1) · `_assets/sticker/`(기존 팩 관례)
