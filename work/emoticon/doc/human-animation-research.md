# 사람은 움직이는 이모티콘을 어떻게 그리나 (리서치, 2026-11-05)

배경: 다그당스 걷기 루프 실험(`dageudangs-gif.md` 「루프 이음매 실험」)에서 사람 판정과 우리 지표가 어긋났다.
변형은 모두 만족스럽지 않았고, 그중 **B(24칸에 걷기 키포즈를 칸별로 배정)**가 제일 나았다. 그래서 사람 작가와
애니메이터가 24프레임 안팎의 짧은 루프를 실제로 어떻게 만드는지 조사했다. 이번에는 생성 없이 웹 자료만 봤다.

표기: **[출처]** 링크가 직접 뒷받침 · **[계산]** 출처 수치를 우리 규격(360², 12fps·24f)에 옮겨 셈한 것 ·
**[추측]** 출처로 확인하지 못함. 한국 자료는 판매 페이지·강의 목차·커뮤니티가 대부분이었고, 카카오 작가가 원화·동화
장수와 타임시트를 전부 공개한 제작기는 찾지 못했다.

## 핵심 발견

1. **사람은 24장을 다 따로 그리지 않는다. 키포즈 몇 장을 먼저 그리고 동작이 읽히는지 확인한 뒤 사이를 채운다.**
   "키프레임 포즈만으로도 동작을 읽을 수 있어야" 한다는 것이 출발점이다. B 가 나았던 이유는 칸마다 키포즈가 정해져
   읽혔기 때문으로 보인다 **[추측]**.
2. **서로 다른 그림 수와 프레임 수는 별개다.** 같은 그림을 여러 칸에 다시 쓰고(홀드·셀 재사용), 프레임마다 표시
   시간을 다르게 준다. LINE 개인 작가 10팩 60개를 분석한 보고에서는 서로 다른 그림이 6~20장(중간값 11~12),
   표시 시간이 50~200ms 였다. 우리 A·B 는 "24장 모두 다르게, 전부 50ms" 였는데, 이는 사람 작업과 정반대다.
3. **카카오 이모티콘 강의가 꼽는 초보의 흔한 실수가 우리 실패와 그대로 겹친다.** "움직임마다 캐릭터 사이즈가 달라짐"
   (B 의 행별 크기 흐름 — *정정: 재 보니 B 의 크기 차이는 ±4% 로 작았다. 몸이 오르내린 것을 크기 변화로 잘못 읽었다. `dageudangs-gif.md` 「B 재조립」*), "속도가 일정해서 인형뽑기 같음"(A 의 균등 50ms·균등 간격), "파츠 위치만 바꾼 애니메이션은
   어색함"(K 키프레임 편집)이다.

## 1. 카카오 작가 쪽

| 내용 | 출처 |
|---|---|
| "요즘은 24 프레임으로 제한돼 있지만, 제한이 없던 시절엔 60 프레임까지 그린 적도 있었어요"(아포이), "덜어낼 것을 덜어내면서 이제는 익숙해졌어요"(꼬맘). 모션은 "아이디어 스케치로 구상", "귀나 볼 살 등 포인트들의 움직임에 집중". 표현이 어려우면 "직접 춤을 춰서 녹화" | [카카오 작가 인터뷰](https://www.kakaocorp.com/page/detail/9343) |
| 거울·사진으로 표정을 관찰한다(김득). 팔다리가 짧은 캐릭터는 동작에 한계가 있어 "움직이는 효과를 더해" 보완한다(정한나). 24장 반복 단순작업이 부담이다 | [경향신문 2019](https://www.khan.co.kr/article/201905260923001) |
| **동동 작가 강의 목차**: 키포즈 → 원화·동화 연결 → 스페이싱 → "시작과 끝을 일치시키는 루핑" → 이징 → 준비 동작 → 프레임 레이트로 속도감 → 과장 → 스쿼시&스트레치·탄성 → 준비와 마무리 → 오버래핑 → 세컨드 액션. 툴은 클립스튜디오·프로크리에이트. **흔한 실수**: 사이즈가 달라짐 / 속도가 일정함 / 파츠 위치만 변경 / 파츠 간 상호작용 없음 | [패스트캠퍼스](https://fastcampus.co.kr/dgn_online_dongdong2) |
| 클립스튜디오 실습: 원화(낮은 자세 → 만세 → 앉기)를 먼저 그린 뒤 셀 사이에 동화(1a, 1b…)를 추가한다. 어니언 스킨은 이전 장이 보라, 다음 장이 연두. 선화를 먼저 하고 채색은 마지막에 한다 | [CLIP STUDIO TIPS(푸츠팟츠)](https://tips.clip-studio.com/ko-kr/articles/2938) |
| 재생시간 24·12fps = 2초(8fps 면 3초). 12fps 의 부드러움 한계는 스미어로 보완한다. 스쿼시&스트레치, 멈춘 뒤 머리카락 부수 동작, **셀 재사용**(셀 4번을 11·15프레임에) | [CLIP STUDIO TIPS(Luckykyunart)](https://tips.clip-studio.com/ko-kr/articles/8432) |
| 작가 카페: fps 를 8~12로 낮춰 2~3초로 늘린다. "셀 하나 0.1, 두 개 0.2"처럼 홀드는 셀 점유 수로 정한다. 평범한 동작은 10fps, 빠른 동작은 12fps. 컷마다 길이가 달라도 된다 | [다음카페 이모티콘작가](https://m.cafe.daum.net/emoticonswriter/pUTX/153/comments) |
| 클립스튜디오 PRO·DEBUT 은 타임라인 24프레임이 상한이다(EX 는 무제한). 카카오 24프레임 규격과 맞물린다 | [CLIP STUDIO ASK](https://ask.clip-studio.com/ko-kr/detail?id=829) |
| 외주 흐름: 컨셉 → 스케치·**모션 확인(러프 GIF)** → 컬러 → 애니. 애니 단계 이후에는 모션 변경 불가. "24프레임 내로 구현이 불가능하거나 움직임이 과도하게 많은 모션"은 변경을 요청한다 | [숨고](https://soomgo.com/questions/3402), [크몽](https://kmong.com/gig/135783) |
| 원화는 "동작의 가장 큰 포인트"이고 동화는 사이를 잇는다. 16프레임 물 마시기라면 원화는 첫 장·중간 몇 장·마지막만 그린다 | [나무위키 원화](https://namu.wiki/w/%EC%9B%90%ED%99%94) |
| 첫·끝 프레임 이음새는 제출 전 3회 이상 반복 재생해 확인한다. 초보는 여러 요소를 동시에 움직이는 실수를 한다(업체 글) | [emyoung](https://emyoung.com/guides/animated-emoticon-guide) |
| 움직일 부위를 따로 그린다(뜬 눈·감은 눈 두 조각). 점프는 "순간만 짧게 주면 탄력". 용량이 넘치면 12→8~10fps, 1.5→1초, 색 수를 줄인다(자체 도구 홍보 글) | [baejw.info](https://baejw.info/guide.html) |

카카오 규격(360², GIF ≤24프레임, ≤2MB, 프레임당 0.05~2.0초)은 리포의 [`kakao-emoticon-guide.md`](kakao-emoticon-guide.md)에 있다.

## 2. 2D 애니메이션 원칙 — 짧은 루프에 쓰는 것

- **순서는 키 → 익스트림 → 브레이크다운 → 인비트윈이다.** 원화는 키·익스트림과 브레이크다운 한두 장만 그리고,
  타이밍 차트에 다음 장이 어디쯤 올지 표시한다. 가운데가 아니라 앞뒤 포즈 쪽으로 치우치게 표시하고, 동화가 그 표시대로 채운다.
  [Survival Kit 목차](https://dn721807.ca.archive.org/0/items/taskav-01/The__Animator%27s_Survival_Kit%5B1%5D_text.pdf) ·
  [Foundry 스페이싱 차트](https://learn.foundry.com/modo/content/help/pages/animation/tools/spacing_chart.html)
- **걷기는 contact 를 먼저 그려 템포를 정하고**, 다음에 passing 으로 호와 간격을 잡는다.
  [Pushing Poses](https://pushingposes.blogspot.com/2008/03/basic-walk-cycle-part-2.html)
  Williams 의 기본 걷기는 on twos 에 한 걸음 12프레임이다. [요약](https://s184753.blogspot.com/2019/01/more-research-animators-survival-kit.html)
  **[계산]** 12fps·24f 에 옮기면 한 걸음은 그림 6장 × 2틱이고, 24틱이면 두 걸음 = 한 주기다. **그림은 12장이면 된다.**
- **스페이싱(ease)**: 동작의 처음과 끝에서 장 간격을 촘촘히 한다. 차트에는 '반으로 나누기'와 '끝 쪽에 몰기' 방식이 있다.
  [CG Wire](https://blog.cg-wire.com/slow-in-out) · [Brian Lemay](https://brianlemay.com/Pages/animationschool/animation/lipsyncbook/timingcharts.html)
  간격이 균등하면 동화가 아무리 많아도 기계적으로 보인다. 동동 강의가 말한 '인형뽑기'다.
- **on ones / on twos**: 12fps 에서 on twos 는 초당 6장으로, 영화로 치면 fours 급이다. 느린 동작(숨쉬기·끄덕임)만 twos 로 하고,
  빠른 동작은 ones 로 한다 **[추측]**. [CG Cookie](https://cgcookie.com/community/22108-does-animation-on-twos-or-ones-even-matter-in-3d-animation)
- **홀드는 같은 그림을 복제하지 말고 표시 시간으로 준다.** 그대로 복제하면 툴이 합치거나(LINE 은 전 프레임이 같으면 업로드 오류) 화면이 죽어 보인다.
  오래 멈출 때는 **무빙 홀드**(숨·흔들림·깜빡임 같은 미세 변화)를 쓴다. [LINE 규격](https://creator.line.me/en/guideline/animationsticker/) ·
  [Animation Mentor](https://animationmentor.com/blog/why-all-animators-need-to-master-the-moving-hold)
- **루프 닫기**: 첫 포즈를 끝에 복사한 다음, 끝에서 두 번째 장을 키로 다듬고 **복사본은 지운다.**
  [Toon Boom 포럼](https://forums.toonboom.com/t/my-first-puppet-walkcycle/842) · [Esoteric 포럼](https://es.esotericsoftware.com/forum/d/9388-first-and-last-frame-repeat-how-to-avoid)
- **짧은 루프의 과장**: 앤티시페이션 → 본동작(스미어 1~2장) → 오버슈트·정착 → 무빙 홀드 순서로 간다. 스미어는 남발하면 힘이 빠진다.
  [Wikipedia Smear frame](https://en.wikipedia.org/wiki/Smear_frame) · [GarageFarm](https://garagefarm.net/blog/smear-frames-enhancing-motion-in-animation)
  오버랩·팔로스루는 다그당스라면 갈기·꼬리·가방끈이 몸보다 늦게 따라오는 것이다.

## 3. LINE·해외 제작자

- LINE 애니메이션 스티커 규격: APNG 320×270 이내, **5~20프레임**, 1루프는 1·2·3·4초 중 하나(1.5초 같은 값 불가), 루프 1~4회에
  전체 ≤4초, 이미지당 ≤1MB(300KB 는 옛 규격이고, 지금은 이모지 180×180 쪽 기준이다). 첫 프레임은 정지 미리보기라 감정이 드러나는 그림을 둔다.
  [규격](https://creator.line.me/en/guideline/animationsticker/) · [상세(일본어)](https://creator.line.me/ja/guideline/animationsticker/detail/) ·
  [이모지](https://creator.line.me/en/guideline/animationemoji/). **[계산]** 우리 24f × 50ms = 1.2초는 LINE 에 그대로 못 낸다(20f·정수 초로 다시 설계).
- 일본 note 작가 mo: 원화 1장에서 팔만 움직이다가 어색하다는 평을 듣고, **소수 키포즈 + 타임시트**로 바꿨다. 준비 동작·오버슈트·타메(멈춤)를
  배분하고, APNG 의 장별 표시 시간으로 홀드한다. 몸통은 몇 셀로 고정하고 팔 칸만 늘렸다. [note](https://note.com/mo0980/n/n082d7647738c)
- urajo: 프레임마다 딜레이를 다르게 준다(첫·끝 장은 길게, 가운데는 빠르게). [note](https://note.com/urajo_stamp/n/na51f19dd0401)
- Adobe Animate 연재(LINE 이 공식 링크): 부위를 심벌로 나누고, 발밑 소용돌이는 그림 2장을 각각 홀드해 반복한다. 땀은 다른 주기로 돌려 리듬을 엇갈린다.
  [Adobe JP](https://blog.adobe.com/jp/publish/2016/10/19/web-animate-cc-animation-stamp-3-animation)
- 한국 블로그(카카오): 포토샵에서 첫 그림의 불투명도를 낮추고 새 레이어에 다음 그림을 그리는 수동 어니언 스킨 방식이다. **총 5모션**, 프레임 0.1~0.5초.
  [hoduing](https://hoduing.tistory.com/15)
- Discord 스티커는 320×320·≤512KB(APNG/GIF), Slack 은 GIF ≤50프레임·128KB 권장. [Discord](https://discord.com/blog/how-to-create-upload-your-own-stickers-on-discord) ·
  [Slack](https://slack.com/help/articles/206870177-Add-custom-emoji-and-aliases-to-your-workspace)

## 4. AI 로 시트·키프레임을 만드는 사람들

- **문조 스티커 제작자(일본, ChatGPT 이미지)**: 기준 그림 1장을 모든 생성에 첨부했다. 스티커 하나당 **3×3 시트 두 장**을 만들었는데,
  두 번째 시트는 첫 시트를 참고로 "이어지는 9칸"을 요청했다. 마지막 칸은 시작에 가깝게 되돌렸다. 24개 팩, 각 18칸, 2초×2회로 판매했다고 한다.
  같은 글이 앞서 말한 '개인 작가 60개 분석(그림 6~20장, 50~200ms)'의 출처다. [libecity](https://library.libecity.com/articles/01M4VP4YG5X7C9C6BG92JMS2JN)
- **Layer(도구 제작사)**: 걷기는 **contact → passing → 반대발 contact → passing 4장**부터 만들고, 안정되면 장수를 늘린다. 승인한 첫 그림을 나머지의 레퍼런스로 쓴다.
  프레임은 각각 생성하고 시트로 묶는 것은 코드로 한다. [Layer](https://help.layer.ai/articles/5735031800-make-a-sprite-sheet-and-walk-cycle)
- **chongdashu/ai-game-spritesheets**: 5×2=10칸 공격 동작을 한 번에 생성한다. 입력은 **캐릭터 anchor 이미지 + 격자 가이드 이미지** 두 장이고,
  프롬프트에 칸별 사건(준비 → 예비동작 → 충전 → 발사 → 팔로스루 → 반동 → 복귀)을 배정한다. 저자도 칸 정렬은 후처리로 정규화한다고 적었다.
  [프롬프트 원문](https://github.com/chongdashu/ai-game-spritesheets/blob/main/prompts/06-attack-spritesheet.md)
- 칸별 포즈 지시의 성공률이나 이음매 개선 수치를 공개한 비교 실험은 찾지 못했다.

## 5. 툴

한국어 이모티콘 강의(인프런·클래스101·패스트캠퍼스)는 **Adobe Animate**·클립스튜디오·프로크리에이트를 쓴다.
클립스튜디오는 어니언 스킨, 셀 재사용, GIF·APNG 내보내기(루프 횟수 지정)를 지원하고, PRO 의 24프레임 상한이 카카오 규격과 맞는다.
프로크리에이트 애니메이션 어시스트는 1~60fps, 루프·핑퐁 재생, 프레임별 홀드를 지원한다. Aseprite 는 프레임별 duration 과 시트+JSON 내보내기를 지원한다.
툴별 링크는 work 리서치 원본에 있다(아래 「원본 노트」).

## 6. B 를 출발점으로 한 실험 제안 (아직 실행 안 함)

모두 B 프롬프트(`gif-lab/loop/prompts/common.txt` + `B.txt`)에서 시작한다. 판정은 지표가 아니라 **사람 검수**로 한다.

1. **그림 12장 + 타이밍 차트 (생성 1회).** B 의 키 스케줄을 유지하되 시트를 **3×4=12칸**으로 줄인다. 한 걸음 = contact·down·passing·up·
   브레이크다운 2장이다. 조립은 칸마다 다른 틱을 준다(contact·down 은 2~3틱, passing 근처는 1틱 = ease). 합계는 24틱 = 2초다.
   검증할 것: "서로 다른 그림 수 ≠ 프레임 수" + 균등 속도(인형뽑기)를 없애면 더 걷는 것처럼 보이는가.
2. **원화 → 동화 2단계 (생성 2회).** 먼저 **키 4장**(contact L / passing / contact R / passing, Layer 방식)만 2×2 로 생성해 사람이 승인한다.
   그다음 그 시트를 레퍼런스로 넣고 "각 키 사이에 브레이크다운 1장·동화 1장, 앞 키 쪽으로 치우치게"를 칸별로 지시해 나머지를 채운다.
   사람 작업 순서(원화 확인 → 동화)를 그대로 옮긴 것이다.
3. **격자 가이드 이미지 + anchor 분리 (생성 1회).** 레퍼런스를 (a) 글자 없는 다그당스 anchor(`gif-lab/base-front.png` 또는 스티커 누끼)와
   (b) 코드로 그린 4×6 가이드(칸 경계·바닥선·엉덩이 x 위치가 옅게 표시된 PNG) 두 장으로 바꾼다. chongdashu 방식이다.
   검증할 것: 칸 사이 크기·위치 흔들림이 줄어드는가(B 는 크기 차이가 ±4% 로 작았으니 A 같은 다른 시트로 본다). 가이드 선이 결과에 그려져 나오는지도 본다.
4. **생성 없이 B 다시 조립 (생성 0회).** 같은 B 시트를 (a) 머리 크기 기준 스케일 정규화 → 행별 크기 흐름 제거,
   (b) 틱을 다르게 준 버전(contact 홀드·passing 빠르게), (c) 정규화와 틱 조정 둘 다, 이렇게 세 GIF 로 만들어 사람에게 고르게 한다.
   검증할 것: B 가 덜 좋은 이유가 그림 자체인지, 조립(크기·타이밍)인지 가른다.
5. **루프 닫기를 사람 방식으로 (생성 1회).** 시트를 25칸(5×5)으로 받는다. 25번 칸을 "1번과 같은 포즈"로 지시해 정답 표지로 쓰고,
   조립에서 25번을 버린다. 끝에서 두 번째(24번)가 1번 직전 위상이 되도록 하는 '복사 후 삭제' 관행을 생성에 옮긴 것이다.
   검증할 것: 1번과 25번이 얼마나 같게 나오는지가 시트 안 일관성의 척도도 된다.

추천 순서는 **4 → 1 → 3** 이다. 4는 비용이 0 이고 원인을 가른다. 1은 사람 관행과의 차이가 가장 크다. 3은 크기 흐름을 겨냥한다.

## 원본 노트

조사 원본(항목별 요점과 링크 전체)은 커밋하지 않았다. 레인 밖 임시 폴더에 lead(카카오)·work(2D 원칙·용량·툴)·draw(LINE·해외·AI 사례) 세 파일로 있다.
이 문서는 그중 출처가 확인된 것만 옮겼다.
