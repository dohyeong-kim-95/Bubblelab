// 토정비결 현대어 해설 — 괘 본문(tojeong/<괘>.json 의 한문 구절)을 읽고
// "올해는 처음엔 답답하지만 하반기로 갈수록 좋아지는 흐름이에요…" 같은 쉬운 문단을 짓는다.
//
// 본문 JSON 은 _infra/tojeong-import.mjs 가 쓰는 생성물이라 손대지 않는다. 해설은 여기서
// 한문을 규칙으로 읽어 만든다(외부 AI·LLM 없음, 같은 괘면 언제나 같은 글):
//   1) 구절마다 길흉 글자(吉·福 / 凶·損…)로 결(tone)을, 주제 글자(財·官·口舌·病…)로 분야를 본다.
//   2) 비유 구절(雲散月出·枯木逢春…)은 METAPHOR 표의 생활 의미로 풀어 준다 — 반 구(네 글자) 키.
//   3) 달마다 결을 이어 한 해의 굴곡(초반·중반·후반)을 읽고, 조각 문장을 접속어로 잇는다.
// 풀이는 bubblelab 이 한문에서 직접 옮긴 것이다(상업 사이트 풀이는 보지 않았다).
// 어떤 규칙에도 걸리지 않는 달은 그 달 첫 구절의 우리말 번역으로 대신한다(fallback) —
// 커버리지는 _infra/tojeong-reading.test.mjs 가 센다.
//
// 브라우저(util/fortune/index.html 이 동적 import)와 Node 테스트가 같이 쓰므로 DOM 을 쓰지 않는다.

export const TOJEONG_READING_VERSION = "tojeong-reading-kr-v1";

const MONTH_NAMES = ["정월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "동짓달", "섣달"];

// ── 결(tone) ───────────────────────────────────────────
// 부정·해소 짝을 먼저 떼어 낸 뒤 남은 글자를 센다(不利 는 利 가 아니라 흉).
const RESOLVED = /(災|禍|憂|愁|厄|患|困|病|苦|凶)(消|散|去|退|滅|盡|解)/g;   // 재앙이 사라짐 → 길
const NEGATED = /不(利|吉|成|安|和|平|順|足|如意|通|得)|無(益|功|利|得|成|實)|難(成|得|免)|有損|徒費|虛送|勞而無功/g;
const GOOD = /吉|福|喜|慶|榮|昌|興|泰|樂|如意|亨通|旺盛|大通|成功|得財|得利|生財|有財|順成|和平|自安|安樂|貴人|助|春風|滿堂|仰視|稱讚|名振|弄璋|發達|豊/g;
const BAD = /凶|災|禍|厄|憂|愁|患|損|失|敗|病|疾|苦|困|危|險|口舌|是非|訟|悲|哭|離|散亂|盜|賊|驚|乏|虛|不安|服制|滯|奈何|可畏|可侵|紛紛/g;
const CAUTION = /愼|勿|莫|忌|戒|操心/;

function count(re, text) { return (text.match(re) ?? []).length; }

// ── 분야(theme) ─────────────────────────────────────────
// 분야마다 좋을 때·나쁠 때의 생활 문장(결론+조언)을 둘씩 두고 괘 번호로 골라 반복을 피한다.
export const THEMES = [
  { key: "money", re: /財|千金|金玉|富|穀|田庄|田畓|利在|得利|求利|取利/, label: "재물",
    good: ["돈이 들어오는 길이 열리니, 들어온 돈은 일부라도 먼저 떼어 두세요", "생각지 않은 수입이 생기기 쉬우니, 작은 기회도 흘려보내지 마세요"],
    bad: ["나가는 돈이 늘기 쉬우니, 큰 지출이나 보증은 한 번 더 미뤄 두세요", "돈이 새기 쉬우니, 남의 말만 믿고 하는 투자는 피하는 게 좋아요"] },
  { key: "career", re: /官|祿|功名|名振|名利|職|科|昇|印綬|金冠/, label: "일·명예",
    good: ["일터에서 인정받을 일이 생기니, 맡은 일을 드러내 보여 주세요", "자리나 이름이 올라가는 기운이 있으니, 기회가 오면 사양하지 마세요"],
    bad: ["일이 생각만큼 손에 잡히지 않을 수 있으니, 무리한 확장보다 맡은 일을 다지세요", "윗사람과 엇갈리기 쉬우니, 보고와 확인을 한 번 더 챙기세요"] },
  { key: "helper", re: /貴人|助我|相助|來助|扶助/, label: "도와주는 사람",
    good: ["뜻밖에 도와주는 사람이 나타나니, 혼자 끙끙대지 말고 먼저 손을 내밀어 보세요", "곁의 사람이 힘이 되어 주니, 고마운 마음을 자주 전해 주세요"],
    bad: ["믿었던 사람에게 실망하기 쉬우니, 중요한 일은 직접 확인하세요", "도움을 기대한 곳에서 답이 늦을 수 있으니, 다른 길도 함께 준비해 두세요"] },
  { key: "talk", re: /口舌|是非|訟|爭|讒|人言/, label: "말과 다툼",
    good: ["오해가 풀리고 말이 잘 통하니, 미뤄 둔 이야기를 꺼내기 좋아요", "말 한마디가 힘이 되니, 칭찬과 감사를 아끼지 마세요"],
    bad: ["말실수로 오해가 생기기 쉬우니, 남의 일에는 끼어들지 말고 말을 아끼세요", "사소한 시비가 커지기 쉬우니, 다툼이 보이면 한발 물러서세요"] },
  { key: "health", re: /病|疾|身苦|藥|服制|身厄/, label: "건강",
    good: ["몸이 가벼워지고 기운이 돌아오니, 새 운동을 시작하기 좋아요", "컨디션이 안정되니, 미뤄 둔 검진을 챙기기 좋은 때예요"],
    bad: ["몸이 쉽게 지칠 수 있으니, 잠과 식사를 먼저 챙기세요", "가족과 나의 건강을 살필 때이니, 작은 이상도 그냥 넘기지 마세요"] },
  { key: "move", re: /出行|遠行|他鄕|他鄉|出他|移居|移徙|奔走|千里|東奔|行人|乘舟|渡江/, label: "이동",
    good: ["밖으로 나가 움직일수록 길이 열리니, 출장이나 여행을 망설이지 마세요", "자리를 옮기는 일이 득이 되니, 이사·이직 계획을 구체화해 보세요"],
    bad: ["먼 길이나 낯선 곳에서 일이 꼬이기 쉬우니, 이동 계획은 여유 있게 잡으세요", "괜히 바쁘게 돌아다니기만 할 수 있으니, 움직이기 전에 목적을 분명히 하세요"] },
  { key: "home", re: /家|膝下|妻|子孫|夫婦|弄璋|生男|生子|兄弟|父母/, label: "집안",
    good: ["집안에 웃을 일이 생기니, 가족과 함께하는 시간을 늘려 보세요", "가족 사이가 화목해지니, 함께 계획을 세우기 좋아요"],
    bad: ["집안에 마음 쓸 일이 생기기 쉬우니, 가족의 이야기에 먼저 귀 기울여 주세요", "식구 사이에 서운함이 쌓이기 쉬우니, 작은 일도 말로 풀어 두세요"] },
  { key: "romance", re: /婚|佳人|女色|酒色|美人|花燭|蜂蝶/, label: "인연",
    good: ["좋은 인연이 다가오니, 소개나 모임 자리에 나가 보세요", "마음이 통하는 사람을 만나기 쉬우니, 표현을 아끼지 마세요"],
    bad: ["술자리나 가벼운 만남이 탈이 되기 쉬우니, 선을 분명히 지키세요", "이성 문제로 마음이 흔들리기 쉬우니, 서두르지 말고 지켜보세요"] },
];

// ── 비유 구절 → 생활 의미 ──────────────────────────────
// 키는 반 구(네 글자). 값은 [결(+1/0/-1), "~다" 로 끝나는 쉬운 뜻].
export const METAPHOR = {
  一聲砲響: [-1, "갑작스러운 소식이나 변화로 주변이 술렁인다"],
  禽獸皆驚: [-1, "뜻밖의 일에 주변 사람들이 놀라고 동요한다"],
  雲散月出: [1, "답답하던 일이 걷히고 앞이 환해진다"],
  魚龍得水: [1, "제 실력을 펼칠 자리를 만나 일이 잘 풀린다"],
  渴龍得水: [1, "애타게 기다리던 도움이나 기회를 마침내 얻는다"],
  枯木逢春: [1, "오래 막혀 있던 일에 다시 생기가 돈다"],
  花落結實: [1, "애쓴 일이 끝내 결과로 맺힌다"],
  花落無實: [-1, "겉은 화려해도 실속이 없을 수 있다"],
  到處春風: [1, "가는 곳마다 사람들이 반겨 주고 일이 순하게 풀린다"],
  金玉滿堂: [1, "살림이 넉넉해지고 집안에 좋은 것이 쌓인다"],
  世事浮雲: [-1, "세상일이 뜬구름처럼 잡히지 않아 허전할 수 있다"],
  龍得明珠: [1, "꼭 필요한 것을 손에 넣어 크게 쓸 수 있게 된다"],
  明月高樓: [1, "마음이 넉넉하고 여유로운 때를 맞는다"],
  祈禱名山: [0, "정성을 들이고 마음을 다잡으면 액을 피할 수 있다"],
  名山祈禱: [0, "정성을 들이고 마음을 다잡으면 액을 피할 수 있다"],
  草綠江邊: [1, "주변이 푸르게 살아나듯 기운이 차오른다"],
  雨順風調: [1, "날씨가 고르듯 일이 순리대로 풀린다"],
  喜逢甘雨: [1, "가뭄 끝 단비처럼 반가운 도움을 만난다"],
  旱天甘雨: [1, "가뭄 끝 단비처럼 반가운 도움을 만난다"],
  旱天降雨: [1, "가뭄 끝 단비처럼 반가운 도움을 만난다"],
  旱苗逢雨: [1, "시들어 가던 일이 때맞춘 도움으로 살아난다"],
  蜂蝶來喜: [1, "사람들이 모여들고 반가운 일이 생긴다"],
  蜂蝶探香: [1, "매력이 드러나 사람들이 먼저 다가온다"],
  春草逢雨: [1, "막 자라는 일에 힘이 되는 도움이 붙는다"],
  雲雨滿空: [-1, "앞이 흐려 일의 방향이 잘 보이지 않는다"],
  不見好月: [-1, "기다리던 좋은 때가 쉽게 오지 않는다"],
  淸風明月: [1, "마음이 맑고 근심이 없는 편안한 때다"],
  雲行雨施: [1, "준비한 것이 때를 만나 고루 베풀어진다"],
  日暮西山: [-1, "기세가 저물어 가니 욕심을 줄이고 마무리에 힘써야 한다"],
  日落西山: [-1, "기세가 저물어 가니 욕심을 줄이고 마무리에 힘써야 한다"],
  日暮江山: [-1, "날이 저물어 갈 길이 멀게 느껴진다"],
  草木不長: [-1, "애써도 일이 잘 자라지 않는다"],
  草木不生: [-1, "애써도 일이 잘 자라지 않는다"],
  入海求金: [-1, "엉뚱한 곳에서 답을 찾느라 힘만 든다"],
  入山求魚: [-1, "엉뚱한 곳에서 답을 찾느라 힘만 든다"],
  井魚出海: [1, "좁은 곳을 벗어나 넓은 무대로 나간다"],
  沼魚出海: [1, "좁은 곳을 벗어나 넓은 무대로 나간다"],
  百花爭發: [1, "여러 일이 한꺼번에 피어나 활기가 넘친다"],
  飛龍在天: [1, "뜻을 크게 펼쳐 이름을 얻는다"],
  月入雲間: [-1, "잘 되던 일이 잠시 가려 주춤한다"],
  月入雲中: [-1, "잘 되던 일이 잠시 가려 주춤한다"],
  兩虎相爭: [-1, "센 사람끼리 부딪혀 주변까지 곤란해진다"],
  臨津無船: [-1, "건너야 할 때 수단이 없어 발이 묶인다"],
  順風加帆: [1, "흐름을 탄 일에 힘이 더해져 빠르게 나아간다"],
  東風細雨: [1, "부드러운 도움이 조금씩 일을 키워 준다"],
  細雨東風: [1, "부드러운 도움이 조금씩 일을 키워 준다"],
  草木茂盛: [1, "하는 일이 무성하게 자라 성과가 보인다"],
  久旱不雨: [-1, "기다리는 소식이나 도움이 좀처럼 오지 않는다"],
  春和日暖: [1, "마음이 풀리고 일이 부드럽게 흘러간다"],
  歲月如流: [0, "시간이 빠르게 흐르니 미루지 말고 움직여야 한다"],
  虛送歲月: [-1, "하는 일 없이 시간만 흘려보내기 쉽다"],
  斫石見玉: [1, "꾸준히 파고들면 숨은 보물을 찾는다"],
  一枝梅花: [1, "추위 속 매화처럼 어려움 속에서 홀로 빛난다"],
  魚遊春水: [1, "제 자리에서 마음껏 기량을 펼친다"],
  逆水行舟: [-1, "흐름을 거슬러 가느라 힘이 곱절로 든다"],
  空谷回春: [1, "쓸쓸하던 자리에 다시 활기가 돈다"],
  一夜狂風: [-1, "하룻밤 사이에 사정이 크게 흔들릴 수 있다"],
  塵合泰山: [1, "작은 것이 모여 큰 것을 이룬다"],
  積小成大: [1, "작은 것이 모여 큰 것을 이룬다"],
  足踏虎尾: [-1, "위험한 줄 모르고 발을 들이기 쉽다"],
  秋草逢霜: [-1, "기세가 꺾이는 때를 만나 조심해야 한다"],
  春草逢霜: [-1, "막 피어나던 일이 뜻밖의 찬바람을 만난다"],
  鶯上柳枝: [1, "기쁜 소식이 날아든다"],
  深山失路: [-1, "갈피를 잃고 헤매기 쉽다"],
  好雨知時: [1, "도움이 꼭 필요한 때에 맞춰 온다"],
  靑鳥傳信: [1, "반가운 소식이 전해진다"],
  缺月復圓: [1, "기울었던 일이 다시 차오른다"],
  牛逢盛草: [1, "먹을 것이 넉넉해 살림이 편안해진다"],
  淺水行舟: [-1, "여건이 받쳐 주지 않아 일이 더디게 나아간다"],
  逢時花發: [1, "때를 만나 재능이 활짝 핀다"],
  花笑園中: [1, "집안과 주변에 웃음이 피어난다"],
  細流歸海: [1, "작은 노력이 모여 큰 흐름이 된다"],
  不息歸海: [1, "쉬지 않고 가면 끝내 목표에 닿는다"],
  猛虎負岩: [1, "든든한 뒷배를 얻어 힘이 커진다"],
  日就月將: [1, "날마다 조금씩 나아져 크게 성장한다"],
  日月明朗: [1, "앞길이 밝고 분명하다"],
  日月不明: [-1, "앞길이 흐려 판단이 어렵다"],
  不見日月: [-1, "앞길이 흐려 판단이 어렵다"],
  龍得天門: [1, "큰 기회의 문이 열린다"],
  東風解凍: [1, "얼어 있던 일이 녹아 다시 움직인다"],
  春回故國: [1, "떠났던 좋은 기운이 다시 돌아온다"],
  百草回生: [1, "시들었던 일들이 다시 살아난다"],
  月明中天: [1, "모든 일이 환하게 드러나 앞이 밝다"],
  一喜一悲: [0, "기쁜 일과 서운한 일이 번갈아 온다"],
  先困後吉: [1, "처음엔 고생스러워도 뒤로 갈수록 좋아진다"],
  先凶後吉: [1, "처음엔 고생스러워도 뒤로 갈수록 좋아진다"],
  先吉後凶: [-1, "처음엔 잘 풀리다가 뒤에 꼬이기 쉽다"],
  吉變爲凶: [-1, "좋던 일이 방심하면 틀어질 수 있다"],
  吉凶相半: [0, "좋은 일과 궂은 일이 반반이다"],
  有勞無功: [-1, "애쓴 만큼 결과가 따라오지 않을 수 있다"],
  勞而無功: [-1, "애쓴 만큼 결과가 따라오지 않을 수 있다"],
  得而反失: [-1, "얻은 것을 도로 잃기 쉽다"],
  意氣洋洋: [1, "자신감이 넘치고 뜻을 펼친다"],
  憂散喜生: [1, "근심이 흩어지고 기쁜 일이 생긴다"],
  災消福來: [1, "궂은 일이 물러나고 복이 들어온다"],
  守分安居: [0, "제 몫을 지키며 조용히 지내는 것이 이롭다"],
  守舊安靜: [0, "익숙한 것을 지키며 차분히 지내는 것이 이롭다"],
  勿爲妄動: [0, "섣불리 움직이지 않는 것이 이롭다"],
  家神發動: [-1, "집안 일로 마음 쓸 일이 생긴다"],
  驛馬到門: [0, "움직이고 옮길 일이 문 앞에 와 있다"],
  心神散亂: [-1, "마음이 어수선해 집중하기 어렵다"],
  在家心亂: [-1, "집에 있어도 마음이 편치 않다"],
  六月炎天: [-1, "한여름 더위처럼 지치기 쉽다"],
  靑山歸客: [0, "밖으로 돌던 마음이 제자리로 돌아온다"],
};

// 조심하라는 대상: 愼/勿/莫/忌 와 짝을 이룬 글자 → 생활 조언.
const CAUTION_OBJECTS = [
  [/水|江|渡/, "물가나 비 오는 날 이동", "move"],
  [/火/, "불과 열기", null],
  [/口舌|是非|言/, "말과 말다툼", "talk"],
  [/女色|酒色|色|酒/, "술자리와 가벼운 만남", "romance"],
  [/出行|遠行|出他|行/, "무리한 먼 길", "move"],
  [/盜|賊|失物/, "물건 간수", "money"],
  [/信|他人|親人|人/, "남의 말만 믿는 것", "helper"],
  [/爭/, "다툼", "talk"],
  [/妄動|動/, "섣부른 움직임", null],
  [/貪|慾|分外/, "분수 밖의 욕심", "money"],
  [/病|疾/, "건강 관리 소홀", "health"],
];
// 오행 성씨(전래 관습): 성씨를 오행으로 나눈 것. 사람을 가리지 말라는 뜻으로 부드럽게 옮긴다.
const ELEMENT_SURNAME = { 木: "목(木)", 火: "화(火)", 土: "토(土)", 金: "금(金)", 水: "수(水)" };
const DIRECTIONS = { 東: "동쪽", 西: "서쪽", 南: "남쪽", 北: "북쪽" };

const pickBy = (list, seed) => list[((seed % list.length) + list.length) % list.length];

export function classifyLine(hanja) {
  const text = String(hanja);
  const halves = text.split(/\s+/);
  let good = 0, bad = 0;
  let rest = text.replace(RESOLVED, () => { good += 1; return "　"; });
  rest = rest.replace(NEGATED, () => { bad += 1; return "　"; });
  const metaphors = halves.filter((h) => METAPHOR[h]).map((h) => ({ half: h, tone: METAPHOR[h][0], meaning: METAPHOR[h][1] }));
  // 비유가 이미 결을 말한 반 구는 글자로 다시 세지 않는다.
  for (const m of metaphors) rest = rest.replace(m.half, "　");
  good += count(GOOD, rest) + metaphors.filter((m) => m.tone > 0).length;
  bad += count(BAD, rest) + metaphors.filter((m) => m.tone < 0).length;
  const caution = CAUTION.test(text);
  if (caution) bad += 0.5;
  const tone = good - bad;
  const themes = THEMES.filter((t) => t.re.test(text)).map((t) => t.key);
  const cautions = caution
    ? CAUTION_OBJECTS.filter(([re]) => re.test(text.replace(CAUTION, ""))).map(([, label, theme]) => ({ label, theme })).slice(0, 1)
    : [];
  const surname = /([木火土金水])姓/.exec(text);
  const directions = [];
  const dir = /([東西南北])([東西南北])?(兩)?方(有|에)?(吉|利|財)/.exec(text) ?? /利在([東西南北])方|財在([東西南北])方|([東西南北])方有(吉|利|財)/.exec(text);
  if (dir) for (const ch of dir.slice(1)) if (DIRECTIONS[ch]) directions.push(DIRECTIONS[ch]);
  const surnameNote = surname
    ? { element: ELEMENT_SURNAME[surname[1]], tone: /不利|有害|愼|勿|莫|可畏|害/.test(text) ? -1 : /可親|有利|助|吉/.test(text) ? 1 : 0 }
    : null;
  return { tone, good, bad, themes, cautions, metaphors, directions, surname: surnameNote };
}

function toneClass(score) {
  if (score >= 1) return "good";
  if (score <= -1) return "bad";
  return "even";
}

const OPENERS = {
  good: ["일이 술술 풀리는 달이에요.", "기운이 밝게 트이는 달이에요.", "바라던 일에 손이 닿는 달이에요."],
  bad: ["조금 조심스럽게 걸어야 하는 달이에요.", "기운이 잠시 가라앉는 달이에요.", "서두르면 꼬이기 쉬운 달이에요."],
  mixed: ["좋은 일과 신경 쓸 일이 함께 오는 달이에요.", "반가운 일 뒤에 챙길 일이 따라오는 달이에요."],
  even: ["큰 굴곡 없이 지나가는 달이에요.", "차분히 제자리를 지키면 되는 달이에요."],
};

function themeCounts(classes) {
  const out = {};
  for (const c of classes) for (const key of c.themes) {
    out[key] ??= { good: 0, bad: 0 };
    if (c.tone > 0) out[key].good += 1; else if (c.tone < 0) out[key].bad += 1;
  }
  return out;
}

// 한 달(구절 셋)의 해설. 반환: { text, tone, picks, fallback }
export function monthReading(lines, monthIndex, seed = 0) {
  const classes = lines.map((l) => classifyLine(l.hanja));
  const score = classes.reduce((s, c) => s + c.tone, 0);
  const hasGood = classes.some((c) => c.tone >= 1);
  const hasBad = classes.some((c) => c.tone <= -1);
  const tone = hasGood && hasBad && Math.abs(score) < 2 ? "mixed" : toneClass(score);
  const picks = [`tone:${tone}`];
  const parts = [pickBy(OPENERS[tone], seed + monthIndex)];

  // 그 달 결과 같은 방향의 분야를 하나 골라 "특히/다만 …" 으로 잇는다.
  const themes = themeCounts(classes);
  const want = tone === "bad" ? "bad" : tone === "good" ? "good" : null;
  const ordered = THEMES.filter((t) => themes[t.key]);
  let theme = null;
  if (want) theme = ordered.find((t) => themes[t.key][want] > 0);
  if (!theme && tone === "mixed") theme = ordered.find((t) => themes[t.key].bad > 0) ?? ordered.find((t) => themes[t.key].good > 0);
  if (theme) {
    const side = want ?? (themes[theme.key].bad > 0 ? "bad" : "good");
    picks.push(`theme:${theme.key}:${side}`);
    parts.push(`${tone === "mixed" && side === "bad" ? "다만" : "특히"} ${pickBy(theme[side], seed + monthIndex)}.`);
  } else {
    const at = classes.findIndex((c) => c.metaphors.length);
    if (at >= 0) {
      const metaphor = classes[at].metaphors[0];
      picks.push(`metaphor:${metaphor.half}`);
      parts.push(`'${lines[at].ko.replace(/[.。]\s*$/, "")}'라는 구절은 ${metaphor.meaning}는 뜻이에요.`);
    }
  }
  const caution = classes.flatMap((c) => c.cautions)[0];
  if (caution && parts.length < 3 && caution.theme !== theme?.key) {
    picks.push(`caution:${caution.label}`);
    parts.push(`${caution.label}은 한 번 더 조심하세요.`.replace(/([가-힣])은 한 번/, (m, ch) => {
      const code = ch.charCodeAt(0) - 0xac00;
      return `${ch}${code % 28 ? "은" : "는"} 한 번`;
    }));
  }
  const fallback = picks.length === 1 && tone === "even";
  if (fallback) {
    picks.push("fallback");
    parts.push(`원문은 "${lines[0]?.ko ?? ""}"라고 적고 있어요.`);
  }
  return { month: MONTH_NAMES[monthIndex], text: parts.join(" "), tone, score, picks, fallback };
}

const ARC_TEXT = {
  rising: "올해는 처음엔 일이 더디게 풀려 답답할 수 있지만, 뒤로 갈수록 점점 좋아지는 흐름이에요.",
  falling: "올해는 초반에 기세가 좋고, 뒤로 갈수록 욕심을 줄이고 지키는 쪽이 유리한 흐름이에요.",
  valley: "올해는 한가운데쯤 한 번 고비가 있지만, 앞뒤로는 비교적 순탄한 흐름이에요.",
  peak: "올해는 한가운데 무렵에 가장 크게 피어나는 흐름이에요.",
  good: "올해는 대체로 순조롭게 풀리는 흐름이에요.",
  bad: "올해는 욕심을 줄이고 지키는 데 힘쓰면 무사히 넘어가는 흐름이에요.",
  even: "올해는 큰 굴곡 없이 고르게 흘러가는 한 해예요.",
};

function arcOf(scores, summaryTone) {
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const early = avg(scores.slice(0, 4));
  const mid = avg(scores.slice(4, 8));
  const late = avg(scores.slice(8));
  if (late - early >= 1.2) return "rising";
  if (early - late >= 1.2) return "falling";
  if (Math.min(early, late) - mid >= 1.2) return "valley";
  if (mid - Math.max(early, late) >= 1.2) return "peak";
  const all = avg(scores) + summaryTone / 9;
  return all >= 0.8 ? "good" : all <= -0.8 ? "bad" : "even";
}

// 한 해 해설. data = tojeong/<괘>.json 그대로. 반환: { paragraph, months, picks }
export function yearReading(data) {
  const seed = Number(data.code) || 0;
  const months = data.months.map((lines, i) => monthReading(lines, i, seed));
  const summary = data.summary.map((l) => classifyLine(l.hanja));
  const summaryTone = summary.reduce((s, c) => s + c.tone, 0);
  // 총운에 先吉後凶·先凶後吉 같은 명시적 굴곡이 있으면 그것이 달 점수보다 먼저다.
  const explicit = data.summary.map((l) => l.hanja).join(" ");
  const arc = /先(困|凶)後吉|先凶後吉|先困後泰|始困終吉/.test(explicit) ? "rising"
    : /先吉後凶|始吉終凶/.test(explicit) ? "falling" : arcOf(months.map((m) => m.score), summaryTone);
  const picks = [`arc:${arc}`];
  const parts = [ARC_TEXT[arc]];

  const firstMetaphor = summary.flatMap((c) => c.metaphors)[0];
  if (firstMetaphor) {
    const line = data.summary.find((l) => l.hanja.includes(firstMetaphor.half));
    picks.push(`metaphor:${firstMetaphor.half}`);
    parts.push(`총운의 '${line.ko.replace(/[.。]\s*$/, "")}'라는 구절은 ${firstMetaphor.meaning}는 뜻이에요.`);
  }

  const themes = themeCounts([...summary, ...data.months.flat().map((l) => classifyLine(l.hanja))]);
  const ranked = (side) => THEMES.filter((t) => themes[t.key]?.[side] > 0)
    .sort((a, b) => themes[b.key][side] - themes[a.key][side]);
  const bestGood = ranked("good")[0];
  const bestBad = ranked("bad").find((t) => t !== bestGood);
  if (bestGood) {
    picks.push(`yearTheme:${bestGood.key}:good`);
    // 흐름이 가라앉는 해라면 좋은 분야는 "그래도"로 받아 대비를 살린다.
    const joiner = ["bad", "falling", "valley"].includes(arc) ? "그래도" : firstMetaphor ? "그리고" : "특히";
    parts.push(`${joiner} ${bestGood.label} 쪽으로는 ${pickBy(bestGood.good, seed)}.`);
  }
  if (bestBad) {
    picks.push(`yearTheme:${bestBad.key}:bad`);
    parts.push(`다만 ${bestBad.label} 쪽은 ${pickBy(bestBad.bad, seed + 1)}.`);
  }

  const order = months.map((m, i) => [m.score, i]);
  const best = [...order].sort((a, b) => b[0] - a[0] || a[1] - b[1]).filter(([s]) => s >= 1).slice(0, 2).map(([, i]) => i).sort((a, b) => a - b);
  const worst = [...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter(([s]) => s <= -1).slice(0, 2).map(([, i]) => i).sort((a, b) => a - b);
  if (best.length || worst.length) {
    const b = best.map((i) => MONTH_NAMES[i]).join("·");
    const w = worst.map((i) => MONTH_NAMES[i]).join("·");
    parts.push(best.length && worst.length
      ? `달로 보면 ${b}에 힘이 실리고, ${w}에는 한 템포 쉬어 가는 게 좋아요.`
      : best.length ? `달로 보면 ${b}에 특히 힘이 실려요.` : `달로 보면 ${w}에는 한 템포 쉬어 가는 게 좋아요.`);
    picks.push(`best:${best.join(",")}`, `worst:${worst.join(",")}`);
  }

  const dirs = [...new Set(summary.flatMap((c) => c.directions))];
  if (dirs.length) {
    picks.push(`dir:${dirs.join(",")}`);
    parts.push(`방향으로는 ${dirs.join("과 ").replace(/쪽과 /g, "쪽과 ")}이 길하다고 해요.`);
  }
  return { version: TOJEONG_READING_VERSION, paragraph: parts.join(" "), months, picks };
}
