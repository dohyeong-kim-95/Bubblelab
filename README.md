# 🫧 Bubblelab

[bubblelab.dev](https://bubblelab.dev)에서 운영하는 작은 게임·도구·실험 모음의 공개 소스입니다.

> 개인 프로젝트입니다. 별도 명시가 없는 한 코드·에셋의 복제·재배포·상업적
> 이용을 허락하지 않습니다([`LICENSE`](./LICENSE)). 포함된 외부 오픈소스·에셋의
> 출처와 라이선스는 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)에 있습니다.

폴더 하나가 서브도메인 하나입니다.

| 폴더 | 주소 | 내용 |
| --- | --- | --- |
| `www/` | <https://bubblelab.dev> | 랜딩 |
| `slop/` | <https://slop.bubblelab.dev> | 짧은 게임과 실험 |
| `games/` | <https://games.bubblelab.dev> | 조금 더 큰 게임 |
| `util/` | <https://util.bubblelab.dev> | 달력·사진·PDF·이미지 변환 같은 일상 도구 |
| `fortune/` | <https://fortune.bubblelab.dev> | 운세 노트 — 사주·토정비결·타로 |
| `mindfulness/` | <https://mindfulness.bubblelab.dev> | 짧은 호흡·소리·생각 알아차림 |
| `idle/` | <https://idle.bubblelab.dev> | 7일 단위 방치형 게임 |
| `assets/` | <https://assets.bubblelab.dev> | 스티커·배경화면·음악 카탈로그 |

- `_shared/` — 모든 화면이 함께 쓰는 디자인 재료(`bubble.css`)와 브라우저 모듈
- `_assets/` — 카탈로그 원본 이미지와 `metadata.json`
- `_infra/` — 공개 화면이 쓰는 서버 모듈(Cloudflare Workers·Durable Objects)과 테스트

화면은 대부분 의존성·빌드 도구 없는 바닐라 HTML입니다. 이 저장소는 **읽기용 스냅샷**입니다 —
배포 파이프라인과 운영자 전용 화면은 별도 비공개 저장소에 있어서, 여기만으로는 전체 사이트를
빌드·배포할 수 없습니다. 개별 화면은 정적 서버로 바로 열어 볼 수 있습니다.
