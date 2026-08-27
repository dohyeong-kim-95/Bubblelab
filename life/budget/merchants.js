/* 가맹점 이름 → 카테고리 씨앗 표. **사람이 채우는 표**다(외부 API 를 부르지 않는 화면이라).
 *
 * 이 표는 거들 뿐이다. 진짜 규칙은 **내가 한 번 정한 것**(state.rules)이고 그쪽이 언제나
 * 이긴다 — 처음 열었을 때 전부 미분류인 허전함을 더는 것이 이 표의 일이다.
 *
 * 왜 부분 일치인가: 카드 문자의 가맹점명은 카드사·PG·지점에 따라 제각각 잘리고 붙는다.
 * 법인명이 그대로 오기도 한다("메가엠지씨커피" = 메가커피, 실기기 문자에서 확인). 그래서
 * 이름 전체가 아니라 **글자가 들어 있는지**로 본다(store 의 categoryFor — 정규화 후
 * 가장 긴 것이 이긴다).
 *
 * 고르는 기준: 매장 수·점유율 상위부터. 애매한 것은 넣지 않는다 —
 * 네이버페이·카카오페이·토스처럼 **어디에 썼는지 알 수 없는 결제 대행은 일부러 뺐다**
 * (미분류로 두고 사람이 정하는 편이 낫다. 잘못 넣으면 규칙이 조용히 틀린 답을 준다).
 */
export const MERCHANTS = [
  // 카페·간식 — 매장 수 상위(메가·컴포즈·이디야·빽다방·투썸)부터
  { match: "메가엠지씨", cat: "cafe" },      // 메가커피의 법인 표기
  { match: "메가커피", cat: "cafe" },
  { match: "컴포즈", cat: "cafe" },
  { match: "이디야", cat: "cafe" },
  { match: "빽다방", cat: "cafe" },
  { match: "투썸", cat: "cafe" },
  { match: "스타벅스", cat: "cafe" },
  { match: "starbucks", cat: "cafe" },
  { match: "커피빈", cat: "cafe" },
  { match: "폴바셋", cat: "cafe" },
  { match: "할리스", cat: "cafe" },
  { match: "탐앤탐스", cat: "cafe" },
  { match: "파스쿠찌", cat: "cafe" },
  { match: "더벤티", cat: "cafe" },
  { match: "매머드", cat: "cafe" },
  { match: "블루보틀", cat: "cafe" },
  { match: "파리바게", cat: "cafe" },
  { match: "뚜레쥬르", cat: "cafe" },
  { match: "던킨", cat: "cafe" },
  { match: "배스킨", cat: "cafe" },
  { match: "설빙", cat: "cafe" },

  // 식비 — 배달앱(배민·쿠팡이츠·요기요)과 매장 수 많은 외식 브랜드
  { match: "배달의민족", cat: "food" },
  { match: "우아한형제들", cat: "food" },   // 배민 운영사
  { match: "쿠팡이츠", cat: "food" },
  { match: "요기요", cat: "food" },
  { match: "맥도날드", cat: "food" },
  { match: "버거킹", cat: "food" },
  { match: "롯데리아", cat: "food" },
  { match: "맘스터치", cat: "food" },
  { match: "써브웨이", cat: "food" },
  { match: "김밥천국", cat: "food" },
  { match: "한솥", cat: "food" },
  { match: "본죽", cat: "food" },
  { match: "교촌", cat: "food" },
  { match: "비비큐", cat: "food" },
  { match: "bbq", cat: "food" },
  { match: "bhc", cat: "food" },
  { match: "굽네", cat: "food" },
  { match: "피자헛", cat: "food" },
  { match: "도미노", cat: "food" },
  { match: "명륜진사", cat: "food" },
  { match: "고기", cat: "food" },
  { match: "국밥", cat: "food" },
  { match: "food", cat: "food" },

  // 생필품 — 편의점·마트·생활 쇼핑
  { match: "gs25", cat: "living" },
  { match: "지에스25", cat: "living" },
  { match: "씨유", cat: "living" },
  { match: "cu편의점", cat: "living" },
  { match: "세븐일레븐", cat: "living" },
  { match: "이마트24", cat: "living" },
  { match: "미니스톱", cat: "living" },
  { match: "이마트", cat: "living" },
  { match: "홈플러스", cat: "living" },
  { match: "롯데마트", cat: "living" },
  { match: "코스트코", cat: "living" },
  { match: "노브랜드", cat: "living" },
  { match: "하나로마트", cat: "living" },
  { match: "다이소", cat: "living" },
  { match: "올리브영", cat: "living" },
  { match: "쿠팡", cat: "living" },          // 쿠팡이츠가 더 길어서 그쪽이 이긴다
  { match: "무신사", cat: "living" },
  { match: "세탁", cat: "living" },

  // 교통 — 이동과 기름
  { match: "카카오모빌리티", cat: "transport" },
  { match: "카카오t", cat: "transport" },
  { match: "티머니", cat: "transport" },
  { match: "코레일", cat: "transport" },
  { match: "srt", cat: "transport" },
  { match: "고속버스", cat: "transport" },
  { match: "대한항공", cat: "transport" },
  { match: "아시아나", cat: "transport" },
  { match: "제주항공", cat: "transport" },
  { match: "gs칼텍스", cat: "transport" },
  { match: "sk에너지", cat: "transport" },
  { match: "현대오일", cat: "transport" },
  { match: "에쓰오일", cat: "transport" },
  { match: "주유", cat: "transport" },
  { match: "주차", cat: "transport" },
  { match: "택시", cat: "transport" },

  // 의료 — 간판에 들어가는 말로 본다(개별 병원 이름은 셀 수 없다)
  { match: "약국", cat: "health" },
  { match: "의원", cat: "health" },
  { match: "병원", cat: "health" },
  { match: "치과", cat: "health" },
  { match: "한의원", cat: "health" },
  { match: "메디컬", cat: "health" },

  // 문화·여가
  { match: "cgv", cat: "fun" },
  { match: "롯데시네마", cat: "fun" },
  { match: "메가박스", cat: "fun" },
  { match: "교보문고", cat: "fun" },
  { match: "예스24", cat: "fun" },
  { match: "알라딘", cat: "fun" },
  { match: "스팀", cat: "fun" },
  { match: "steam", cat: "fun" },
  { match: "플레이스테이션", cat: "fun" },
  { match: "닌텐도", cat: "fun" },
  { match: "헬스", cat: "fun" },
  { match: "골프", cat: "fun" },
  { match: "노래", cat: "fun" },
  { match: "pc방", cat: "fun" },

  // 통신·구독 — 매달 같은 날 같은 금액으로 빠지는 것들
  { match: "sk텔레콤", cat: "bills" },
  { match: "skt", cat: "bills" },
  { match: "kt", cat: "bills" },
  { match: "lgu+", cat: "bills" },
  { match: "유플러스", cat: "bills" },
  { match: "통신요금", cat: "bills" },
  { match: "넷플릭스", cat: "bills" },
  { match: "netflix", cat: "bills" },
  { match: "유튜브", cat: "bills" },
  { match: "youtube", cat: "bills" },
  { match: "google", cat: "bills" },
  { match: "apple", cat: "bills" },
  { match: "스포티파이", cat: "bills" },
  { match: "spotify", cat: "bills" },
  { match: "티빙", cat: "bills" },
  { match: "웨이브", cat: "bills" },
  { match: "왓챠", cat: "bills" },
  { match: "디즈니", cat: "bills" },
  { match: "openai", cat: "bills" },
  { match: "anthropic", cat: "bills" },
  { match: "claude", cat: "bills" },
  { match: "chatgpt", cat: "bills" },
  { match: "보험", cat: "bills" },
  { match: "관리비", cat: "bills" },
];
