// 오픽 모의고사 — 서베이·자가평가 표, 문항 은행, 시험지 짜기(순수 함수).
// 문항은 OPIc 의 출제 틀(묘사 → 습관 → 과거 경험 콤보, 롤플레이, 비교·이슈)을 따라 새로 쓴 연습 문항이다.
// 실제 기출을 옮기지 않는다.

// 서베이 — 실제 시험의 네 파트 구성을 따른다. Part 4 는 합쳐서 12개 이상 골라야 한다.
export const SURVEY = {
  job: {
    title: "Part 1. 현재 귀하는 어느 분야에 종사하고 계십니까?",
    options: [
      ["business", "사업/회사"], ["home", "재택근무/재택사업"], ["teacher", "교사/교육자"],
      ["military", "군 복무"], ["none", "일 경험 없음"],
    ],
  },
  student: {
    title: "Part 2. 현재 귀하는 학생이십니까?",
    options: [["yes", "예"], ["no", "아니오"]],
  },
  housing: {
    title: "Part 3. 현재 귀하는 어디에 살고 계십니까?",
    options: [
      ["alone", "개인주택이나 아파트에 홀로 거주"], ["friends", "친구나 룸메이트와 함께 주택이나 아파트에 거주"],
      ["family", "가족(배우자/자녀/기타 가족 일원)과 함께 주택이나 아파트에 거주"],
      ["dorm", "학교 기숙사"], ["barracks", "군대 막사"],
    ],
  },
  groups: [
    { title: "Part 4-1. 여가 활동", items: [
      ["movie", "영화보기"], ["concert", "공연보기"], ["park", "공원가기"], ["beach", "해변·캠핑 가기"],
      ["cafe", "카페·커피전문점 가기"], ["shopping", "쇼핑하기"], ["tv", "TV·리얼리티쇼 시청하기"],
    ] },
    { title: "Part 4-2. 취미나 관심사", items: [
      ["music", "음악 감상하기"], ["cooking", "요리하기"], ["reading", "독서"], ["pet", "애완동물 기르기"],
    ] },
    { title: "Part 4-3. 운동", items: [
      ["jogging", "조깅"], ["walking", "걷기"], ["cycling", "자전거"], ["swimming", "수영"],
      ["gym", "헬스"], ["yoga", "요가"], ["noexercise", "운동을 전혀 하지 않음"],
    ] },
    { title: "Part 4-4. 휴가나 출장", items: [
      ["domestic", "국내 여행"], ["overseas", "해외 여행"], ["staycation", "집에서 보내는 휴가"], ["trip", "국내·해외 출장"],
    ] },
  ],
  minPicks: 12,
};

// 자가평가 — 한국 오픽의 6단계. 고른 단계가 문항 난이도를 정한다.
export const LEVELS = [
  { level: 1, text: "나는 10단어 이하의 단어로 말할 수 있습니다." },
  { level: 2, text: "나는 기본적인 물건, 색깔, 요일, 음식, 의류, 숫자 등을 말할 수 있습니다. 항상 완벽한 문장을 구사하지는 못하고 간단한 질문도 하기 어렵습니다." },
  { level: 3, text: "나는 나 자신, 직장, 친한 사람과 장소, 일상에 대한 기본적인 정보를 간단한 문장으로 전달할 수 있습니다. 간단한 질문을 할 수 있습니다." },
  { level: 4, text: "나는 나 자신, 일상, 일/학교와 취미에 대해 간단한 대화를 할 수 있습니다. 친숙한 주제와 일상에 대해 쉽게 간단한 문장들을 만들 수 있습니다. 내가 원하는 것도 질문할 수 있습니다." },
  { level: 5, text: "나는 친숙한 주제와 가정, 일/학교, 개인 및 사회적 관심사에 대해 자신 있게 대화할 수 있습니다. 일어난 일과 일어나고 있는 일, 일어날 일에 대해 합리적으로 연결된 문장을 만들 수 있습니다. 필요한 경우 설명도 할 수 있습니다. 일상에서 예기치 못한 상황이 발생하더라도 임기응변으로 대처할 수 있습니다." },
  { level: 6, text: "나는 개인적, 사회적 또는 전문적 주제에 나의 의견을 제시하여 토론할 수 있습니다. 다양하고 어려운 주제에 대해 정확하고 자세하게 설명할 수 있습니다." },
];

// 주제 하나 = 묘사(d)·습관/루틴(r)·과거 경험(p) 세 문항. 상급(5–6단계)은 비교(c)·이슈(i)까지.
const T = (label, d, r, p, c, i) => ({ label, d, r, p, c, i });

export const TOPICS = {
  home: T("거주지",
    "I would like to know where you live. Describe your home to me. What does it look like? How many rooms does it have? Tell me about your home in as much detail as possible.",
    "Tell me about the things you usually do at home on weekdays and on weekends. What do you do first when you get home?",
    "Have you ever made any changes to your home, such as moving furniture or redecorating? Tell me what you changed, why you changed it, and how it turned out.",
    "Think about the homes you lived in when you were a child. How were they different from the homes people live in today? What has changed?",
    "Housing prices are a big issue in many countries. What problems do people in your country face when they look for a place to live? How do people try to solve them?"),
  movie: T("영화보기",
    "You indicated in the survey that you like to go to the movies. Tell me about the kinds of movies you like. Why do you like them?",
    "What do you usually do before and after you watch a movie? Who do you go with? Describe a typical day when you go to the movies.",
    "Tell me about a memorable movie you saw recently. What was it about, who did you see it with, and why was it so memorable?",
    "How have the ways people watch movies changed over the years? Compare watching movies in the past with watching them today.",
    "Some people say streaming services are hurting movie theaters. What do you think about this issue? Give reasons for your opinion."),
  concert: T("공연보기",
    "You said you like to go to concerts or performances. What kinds of performances do you enjoy? Describe a concert hall or venue you often go to.",
    "What do you usually do when you go to a concert? How do you buy tickets and how do you prepare?",
    "Tell me about the first concert or performance you ever went to. When was it, who did you go with, and what happened?",
    "How have concerts changed compared to the past? Talk about the differences in ticket prices, venues, and the experience.",
    "Ticket scalping has become a serious problem for popular concerts. Why do you think this happens, and what should be done about it?"),
  park: T("공원가기",
    "You indicated that you like to go to the park. Describe your favorite park. Where is it, and what does it look like?",
    "What do you usually do when you go to the park? Who do you go with and how often do you go?",
    "Tell me about a special or unexpected experience you had at a park. What happened, and how did you feel?",
    "Compare the parks you went to when you were young with the parks today. What has changed?",
    "Many cities are trying to create more green spaces. Why do you think parks are important for a city, and what problems do parks face?"),
  beach: T("해변·캠핑",
    "You said you like to go to the beach or go camping. Describe a beach or campsite you like to visit. What is it like?",
    "What do you usually bring and what do you usually do when you go to the beach or go camping?",
    "Tell me about a memorable trip to the beach or a camping trip. Something unexpected might have happened. Tell me the whole story.",
    "How has camping or going to the beach changed in your country in recent years?",
    "Beaches and campsites often suffer from trash and pollution. What causes this problem and how can people protect these places?"),
  cafe: T("카페 가기",
    "You indicated that you go to cafés or coffee shops. Describe a café you often go to. Where is it and what does it look like?",
    "What do you usually do at a café? What do you order, and who do you go with?",
    "Tell me about a memorable experience you had at a café. What happened, and why do you remember it?",
    "How have cafés in your country changed over the years? Compare cafés in the past with cafés today.",
    "Some people say there are too many cafés in Korea. Why do you think cafés are so popular, and what problems does this cause?"),
  shopping: T("쇼핑하기",
    "You said you like to go shopping. Where do you usually go shopping? Describe the store or shopping mall you like.",
    "Tell me about your shopping habits. When do you go shopping, who do you go with, and what do you usually buy?",
    "Tell me about a memorable shopping experience. Maybe you found a great deal or had a problem with something you bought.",
    "How has shopping changed compared to when you were younger? Talk about online shopping and offline shopping.",
    "Online shopping creates a lot of packaging waste. What do you think about this problem, and how could companies reduce it?"),
  tv: T("TV 보기",
    "You indicated that you watch TV or reality shows. What kinds of shows do you like to watch, and why?",
    "When and where do you usually watch TV? Describe your routine when you watch your favorite show.",
    "Tell me about a TV show that you watched recently and found memorable. What was it about and why did you like it?",
    "How have TV shows changed compared to the past? Compare the shows people watched before with the ones they watch now.",
    "Some people worry that reality shows give a false picture of real life. What is your opinion?"),
  music: T("음악 감상",
    "You indicated that you enjoy listening to music. What kinds of music do you like? Who are your favorite singers or composers?",
    "When and where do you usually listen to music? What devices do you use?",
    "Tell me about how you first became interested in music. What was the first music you really liked, and why?",
    "How has the way people listen to music changed over the years? Compare the past and the present.",
    "Many musicians say streaming services do not pay them fairly. What do you think about this issue?"),
  cooking: T("요리하기",
    "You said you enjoy cooking. What kinds of food do you like to cook? Describe a dish you are good at making.",
    "Tell me about the steps you usually take when you cook a meal, from shopping for ingredients to cleaning up.",
    "Tell me about a time when something went wrong while you were cooking. What happened and how did you handle it?",
    "How have people's eating and cooking habits changed compared to the past?",
    "More people are ordering delivery food instead of cooking. What are the effects of this trend on health and on society?"),
  reading: T("독서",
    "You indicated that you like reading. What kinds of books do you enjoy? Who is your favorite author?",
    "When and where do you usually read? How do you choose the books you read?",
    "Tell me about a book that left a strong impression on you. When did you read it and why was it memorable?",
    "How have people's reading habits changed with smartphones and e-books?",
    "Some people say young people today do not read enough. Do you agree? What could be done about it?"),
  pet: T("애완동물",
    "You said you have a pet. Tell me about your pet. What does it look like and what is its personality like?",
    "What do you do every day to take care of your pet? Describe your daily routine with your pet.",
    "Tell me about a memorable or funny experience you had with your pet.",
    "How has the way people care for pets changed compared to the past?",
    "Many pets are abandoned every year. Why does this happen and what should society do about it?"),
  jogging: T("조깅",
    "You indicated that you go jogging. Where do you usually jog? Describe the place.",
    "Tell me about your jogging routine. When do you jog, how long do you run, and what do you do before and after?",
    "Tell me about how you started jogging. Was there a memorable moment or a problem while you were jogging?",
    "How has the way people exercise changed compared to the past?",
    "Running crews have become popular, but some people complain about them. What do you think about this issue?"),
  walking: T("걷기",
    "You said you enjoy walking. Where do you usually go for a walk? Describe the place.",
    "When do you usually walk, who do you walk with, and what do you do while you walk?",
    "Tell me about a memorable walk you took. Where were you and what happened?",
    "How have people's walking habits changed in your city compared to the past?",
    "Many cities say they want to be walkable. What makes a city good for walking, and what problems exist in your city?"),
  cycling: T("자전거",
    "You indicated that you ride a bicycle. Tell me about your bike and the places where you usually ride.",
    "Tell me about your cycling routine. How often do you ride, and what do you bring with you?",
    "Tell me about a memorable experience you had while riding a bicycle. Maybe you had an accident or a problem.",
    "How has cycling in your country changed compared to the past? Talk about bike lanes and shared bicycles.",
    "Shared electric scooters and bikes cause safety issues. What do you think should be done?"),
  swimming: T("수영",
    "You said you go swimming. Where do you usually swim? Describe the pool or the place.",
    "Tell me about your swimming routine. When do you go and what do you do from the beginning to the end?",
    "Tell me about how you learned to swim. Who taught you and what was it like?",
    "How has swimming as an activity changed in your country compared to the past?",
    "Water safety is an important issue every summer. What kinds of accidents happen, and how can they be prevented?"),
  gym: T("헬스",
    "You indicated that you go to the gym. Describe the gym you go to. What kind of equipment does it have?",
    "Tell me about your workout routine at the gym. What exercises do you do and in what order?",
    "Tell me about how you started going to the gym. Was there a memorable experience or a problem at the gym?",
    "How have gyms and fitness trends changed compared to the past?",
    "Some people spend a lot of money on fitness. Do you think this is a good trend? Why or why not?"),
  yoga: T("요가",
    "You said you do yoga. Where do you do yoga, and what does the place look like?",
    "Tell me about a typical yoga session. What do you do from the beginning to the end?",
    "Tell me about how you first started doing yoga and how it has affected you.",
    "How has the popularity of yoga changed in your country?",
    "Some people say people care too much about appearance when they exercise. What is your opinion?"),
  noexercise: T("운동 안 함",
    "You indicated that you do not exercise. Tell me about how you spend your free time instead.",
    "What do you usually do to stay healthy, even though you do not exercise regularly?",
    "Was there a time when you tried to start exercising? What happened?",
    "How have people's ideas about health changed compared to the past?",
    "Many office workers do not have time to exercise. What problems does this cause, and what can companies do?"),
  domestic: T("국내 여행",
    "You indicated that you like traveling in your country. Where do you like to go? Describe one of your favorite places.",
    "What do you usually do to prepare for a trip? Tell me everything you do before you leave.",
    "Tell me about a memorable domestic trip. Where did you go, who did you go with, and what happened?",
    "How has traveling in your country changed compared to when you were young?",
    "Some popular tourist spots suffer from overtourism. What problems does it cause and how can they be solved?"),
  overseas: T("해외 여행",
    "You said you like traveling abroad. Tell me about a country you visited. What was it like?",
    "What do you usually do when you travel overseas? Describe what you do from the airport to the hotel.",
    "Tell me about an unexpected problem you had while traveling abroad. What happened, and how did you deal with it?",
    "How has overseas travel changed for people in your country over the years?",
    "Some people say traveling abroad harms the environment because of flights. What is your opinion?"),
  staycation: T("집에서 보내는 휴가",
    "You indicated that you spend your vacations at home. What do you like to do when you have a vacation at home?",
    "Who do you usually spend your vacation at home with? Describe a typical day.",
    "Tell me about a memorable vacation you spent at home. What did you do and why was it special?",
    "How have the ways people spend their vacations changed compared to the past?",
    "Many workers in Korea cannot use all of their vacation days. Why is this, and what should change?"),
  trip: T("출장",
    "You indicated that you go on business trips. Tell me about a place you visited on a business trip.",
    "What do you usually do to prepare for a business trip? Describe what you do from beginning to end.",
    "Tell me about a business trip where something unexpected happened. What happened and how did you handle it?",
    "How have business trips changed now that online meetings are common?",
    "Some companies are reducing business trips to save money and energy. What do you think about this?"),
};

// 돌발 — 서베이에서 고르지 않아도 나오는 주제
export const RANDOM_TOPICS = {
  recycling: T("재활용",
    "Tell me about recycling in your country. What do people recycle and how do they do it?",
    "Describe how you recycle at home. What do you do with the different kinds of trash?",
    "Tell me about a time when you saw a problem related to recycling or trash. What happened?"),
  weather: T("날씨·계절",
    "Describe the weather and seasons in your country. What is the weather like today?",
    "How does the weather affect what you do? What do you usually do on rainy days?",
    "Tell me about a memorable experience you had because of bad weather."),
  phone: T("휴대폰",
    "Tell me about the phone you use. What do you usually use it for?",
    "How do you use your phone during a typical day, from morning to night?",
    "Tell me about a time you had a problem with your phone. What happened and how did you solve it?"),
  transport: T("교통",
    "Describe the public transportation in your city. How do people usually get around?",
    "How do you usually get to work or school? Describe your trip from beginning to end.",
    "Tell me about a memorable experience you had while using public transportation."),
  holiday: T("명절",
    "Tell me about a holiday that people in your country celebrate. What do people do on that day?",
    "What do you and your family usually do on holidays?",
    "Tell me about a memorable holiday from your childhood. What happened?"),
  restaurant: T("음식점",
    "Describe a restaurant you like. Where is it, what does it look like, and what food do they serve?",
    "When do you usually eat out, and who do you go with?",
    "Tell me about a memorable experience you had at a restaurant."),
  health: T("건강",
    "Tell me about a healthy person you know. What does this person do to stay healthy?",
    "What do you do to stay healthy? Describe your habits.",
    "Tell me about a time when you were sick. What happened and how did you recover?"),
  internet: T("인터넷",
    "What do you usually do on the internet? Tell me about the websites or apps you use often.",
    "Describe how you use the internet on a typical day.",
    "Tell me about a time when the internet was very helpful to you, or when it caused a problem."),
};

// 롤플레이 — 11 질문하기, 12 문제 해결, 13 관련 경험
export const ROLEPLAYS = [
  { label: "호텔 예약",
    ask: "I'd like to give you a situation and ask you to act it out. You are planning a trip and want to book a hotel. Call the hotel and ask three or four questions to get the information you need.",
    fix: "I'm sorry, but there is a problem I need you to resolve. When you arrive at the hotel, they tell you that your reservation was cancelled. Explain the situation to the receptionist and offer two or three alternatives.",
    past: "Have you ever had a problem with a reservation or a booking? Tell me what happened and how you solved it." },
  { label: "가구 구매",
    ask: "You want to buy new furniture for your home. Go to the furniture store and ask the clerk three or four questions about the furniture you want.",
    fix: "The furniture you bought was delivered, but it is damaged. Call the store, explain the problem, and suggest two or three ways to solve it.",
    past: "Tell me about a time when something you bought was broken or not what you expected. What did you do?" },
  { label: "친구와 약속",
    ask: "Your friend invited you to a concert this weekend. Call your friend and ask three or four questions about the plan.",
    fix: "You suddenly cannot go to the concert because something came up. Call your friend, explain the situation, and suggest some alternatives.",
    past: "Have you ever had to cancel plans with a friend? Tell me what happened and how you handled it." },
  { label: "휴대폰 수리",
    ask: "You want to buy a new phone. Go to the phone store and ask three or four questions about the phone you are interested in.",
    fix: "Your new phone stopped working after only one week. Go to the store, explain the problem, and suggest two or three solutions.",
    past: "Tell me about a time when an electronic device you owned broke down. What happened and what did you do?" },
  { label: "은행",
    ask: "You want to open a bank account. Call the bank and ask three or four questions about opening an account.",
    fix: "You lost your bank card. Call the bank, explain what happened, and ask them how to solve the problem.",
    past: "Tell me about a time you lost something important. What was it, and how did you deal with it?" },
];

export const SELF_INTRO = "Let's start the interview now. Tell me a little bit about yourself.";

// 결정적 난수 — 같은 시드면 같은 시험지(테스트·재현용)
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
function shuffle(arr, r) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function pickedItems(survey) {
  return SURVEY.groups.flatMap(g => g.items.map(([id]) => id)).filter(id => survey.picks?.includes(id));
}

export function surveyProblems(survey) {
  const out = [];
  if (!survey.job) out.push("Part 1 을 골라 주세요.");
  if (!survey.student) out.push("Part 2 를 골라 주세요.");
  if (!survey.housing) out.push("Part 3 을 골라 주세요.");
  const n = pickedItems(survey).length;
  if (n < SURVEY.minPicks) out.push(`Part 4 에서 ${SURVEY.minPicks}개 이상 골라 주세요(지금 ${n}개).`);
  return out;
}

const q = (no, kind, topic, text) => ({ no, kind, topic, text });

// 1–7번: 자기소개 + 서베이 주제 콤보 둘
export function buildFirst({ survey, level, seed = Date.now() }) {
  const r = rng(seed);
  const chosen = shuffle(pickedItems(survey).filter(id => TOPICS[id]), r);
  const topics = ["home", ...chosen].filter((v, i, a) => a.indexOf(v) === i);
  const [a, b] = [topics[0], topics[1] || topics[0]];
  const low = level <= 2;
  const set = (id, start) => {
    const t = TOPICS[id];
    return low
      ? [q(start, "묘사", t.label, t.d), q(start + 1, "습관", t.label, t.r), q(start + 2, "묘사", t.label, t.d)]
      : [q(start, "묘사", t.label, t.d), q(start + 1, "습관", t.label, t.r), q(start + 2, "과거 경험", t.label, t.p)];
  };
  // 저단계는 같은 문항을 두 번 묻지 않게 세 번째를 다른 주제 묘사로
  const first = [q(1, "자기소개", "자기소개", SELF_INTRO), ...set(a, 2), ...set(b, 5)];
  if (low) {
    const c = TOPICS[topics[2] || "home"];
    first[3] = q(4, "묘사", c.label, c.d);
    first[6] = q(7, "습관", c.label, c.r);
  }
  return { questions: first, used: [a, b], seed };
}

// 7번 뒤 난이도 재조정: -1 쉬운 질문, 0 비슷한 질문, +1 어려운 질문
export function buildSecond({ survey, level, adjust = 0, used = [], seed = Date.now() }) {
  const r = rng(seed ^ 0x9e3779b9);
  const eff = Math.max(1, Math.min(6, level + adjust));
  const [randId, rand2Id] = shuffle(Object.keys(RANDOM_TOPICS), r);
  const rand = RANDOM_TOPICS[randId], rand2 = RANDOM_TOPICS[rand2Id];
  const rp = pick(ROLEPLAYS, r);
  const rest = pickedItems(survey).filter(id => TOPICS[id] && !used.includes(id));
  const third = TOPICS[rest.length ? pick(rest, r) : "home"];
  const out = [
    q(8, "묘사", `돌발 · ${rand.label}`, rand.d),
    q(9, "습관", `돌발 · ${rand.label}`, rand.r),
    q(10, "과거 경험", `돌발 · ${rand.label}`, rand.p),
    q(11, "롤플레이 · 질문하기", rp.label, rp.ask),
  ];
  if (eff <= 2) {
    // 낮은 단계: 롤플레이는 질문하기까지만, 나머지는 서베이 주제 하나로 묘사·습관·경험
    out.push(q(12, "묘사", third.label, third.d), q(13, "습관", third.label, third.r),
      q(14, "과거 경험", third.label, third.p), q(15, "묘사", `돌발 · ${rand2.label}`, rand2.d));
  } else {
    out.push(q(12, "롤플레이 · 문제 해결", rp.label, rp.fix), q(13, "롤플레이 · 관련 경험", rp.label, rp.past));
    if (eff >= 5) out.push(q(14, "비교", third.label, third.c), q(15, "사회 이슈", third.label, third.i));
    else out.push(q(14, "묘사", third.label, third.d), q(15, "과거 경험", third.label, third.p));
  }
  return { questions: out };
}

export const TOTAL_SECONDS = 40 * 60;
export const REPLAY_WINDOW_MS = 5000;
