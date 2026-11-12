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

export const TOJEONG_READING_VERSION = "tojeong-reading-kr-v4";

const MONTH_NAMES = ["정월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "동짓달", "섣달"];

// ── 결(tone) ───────────────────────────────────────────
// 반 구(네 글자)마다 따로 본다 — 한 구의 앞뒤가 반대인 일이 흔하다("재물은 들어오나 사람 일은 어찌하랴").
// 부정·해소 짝을 먼저 떼어 낸 뒤 남은 글자를 센다(不利 는 利 가 아니라 흉, 災消 는 길).
const RESOLVED = /(災|禍|憂|愁|厄|患|困|病|苦|凶|害)(消|散|去|退|滅|盡|解)/g;
const NEGATED = /不(利|吉|成|安|和|平|順|足|如意|通|得|明|見)|無(益|功|利|得|成|實)|難(成|得|免)|有損|徒費|虛送|勞而無功|少得多用|多逆|反失|反爲|旋失|得而反失/g;
const GOOD = /吉|福|喜|慶|榮|昌|興|泰|樂|如意|亨通|旺|大通|成功|得財|得利|生財|有財|入手|利在|順成|和平|自安|安樂|貴人|助|春風|滿堂|仰視|欽仰|稱讚|名振|弄璋|發達|豊|笑|宜|得食|得衣|財在|佳|太平|平安|通泰/g;
const BAD = /凶|災|禍|厄|憂|愁|患|損|失|敗|病|疾|苦|困|危|險|口舌|是非|訟|悲|哭|離|散亂|盜|賊|驚|警|乏|虛|不安|服制|滯|奈何|可畏|可侵|紛紛|害|逆|悔|妨/g;
// 조심하라는 말로 시작하는 반 구는 사건이 아니라 조언이다 — 분야의 길흉으로 세지 않는다.
const CAUTION_HALF = /^(愼|勿|莫|忌|戒)|愼之|操心/;
// "집에 있으면 길하다"류는 조건부 조언 — 길로 세지 않고 "가까이에서 지내라"로 옮긴다.
const CONDITIONAL = /(在家|安靜|守分|守舊|居家|靜坐)則?(吉|安|利|好)|在家有吉/;
// 若非(…가 아니면)·雖(비록) 반 구는 일어날 수도 있는 일이라 길흉 쪽을 정하지 않는다.
const HEDGE = /^(若非|若無|雖|或)/;
// 한 반 구 안에서 굴곡을 직접 말하는 경우.
const SPLIT = [
  [/先(凶|困|苦|難)後(吉|泰|安|榮)|始困終吉/, "rise"],
  [/先(吉|笑)後(凶|哭|苦|困)|始吉終凶|吉變爲凶/, "fall"],
  [/半凶半吉|半吉半凶|吉凶相半|一喜一悲|一吉一凶|凶中有吉|吉中有凶|喜中有憂/, "mixed"],
];

function count(re, text) { return (text.match(re) ?? []).length; }

// ── 분야(theme) ─────────────────────────────────────────
// 원문에 없는 구체적인 사정(보증·투자·윗사람…)을 지어내지 않도록, 분야의 결만 쉬운 말로 옮기고
// 조언도 그 결 안에서만 한다. 문장은 둘씩 두고 괘 번호로 골라 반복을 줄인다.
export const THEMES = [
  { key: "money", re: /財|千金|金玉|富|穀|田庄|田畓|利在|得利|求利|取利|入手/, label: "재물",
    good: ["재물이 들어오는 흐름이 있으니, 들어온 만큼 잘 지켜 두세요", "재물 운이 트이니, 오는 기회를 차분히 잡아 보세요"],
    bad: ["재물이 새어 나가기 쉬우니, 씀씀이를 줄여 두세요", "재물이 줄기 쉬우니, 지출을 꼼꼼히 챙기세요"] },
  { key: "career", re: /官祿|功名|名振|名利|職|科|昇|印綬|金冠|官職/, label: "일·명예",
    good: ["이름이 나거나 인정받을 일이 생기기 쉬우니, 기회가 오면 나서 보세요", "일에서 좋은 평판이 따르니, 맡은 일을 드러내 보세요"],
    bad: ["일이나 자리 문제가 뜻대로 되지 않기 쉬우니, 때를 기다려 보세요", "관청이나 공적인 일로 번거로움이 생기기 쉬우니, 서류와 약속을 꼼꼼히 챙기세요"] },
  { key: "helper", re: /貴人|助我|相助|來助|扶助/, label: "사람",
    good: ["도와주는 사람이 나타나니, 혼자 끙끙대지 말고 도움을 청해 보세요", "곁의 사람이 힘이 되어 주니, 고마운 마음을 자주 전해 주세요"],
    bad: ["사람 때문에 손해를 보기 쉬우니, 남의 말은 한 번 더 살피세요", "가까운 사람과 엇갈리기 쉬우니, 중요한 일은 직접 확인하세요"] },
  { key: "talk", re: /口舌|是非|訟|爭|讒/, label: "말과 시비",
    good: ["오해가 풀리고 말이 잘 통하니, 미뤄 둔 이야기를 꺼내기 좋아요", "말로 하는 일이 잘 풀리니, 감사와 칭찬을 아끼지 마세요"],
    bad: ["구설(남의 입에 오르내림)이 생기기 쉬우니, 말을 아끼고 시비에 끼지 마세요", "작은 말다툼이 커지기 쉬우니, 다툼이 보이면 한발 물러서세요"] },
  { key: "health", re: /病|疾|身苦|藥|服制|身厄/, label: "건강",
    good: ["몸과 마음이 편안해지니, 가벼운 운동을 시작하기 좋아요", "기운이 돌아오니, 미뤄 둔 몸 관리를 챙기기 좋아요"],
    bad: ["건강이 흔들리기 쉬우니, 몸을 먼저 살펴 주세요", "몸이나 집안의 건강 문제가 생기기 쉬우니, 미리 살펴 두세요"] },
  { key: "move", re: /出行|遠行|他鄕|他鄉|出他|移居|移徙|移舍|奔走|千里|東奔|行人|乘舟|渡江|遠方/, label: "이동",
    good: ["밖으로 나가 움직이면 얻는 것이 있으니, 길을 나서는 일을 망설이지 마세요", "자리를 옮기거나 멀리 가는 일이 득이 되니, 계획을 구체화해 보세요"],
    bad: ["먼 길을 나서면 일이 꼬이기 쉬우니, 가까운 곳에서 지내는 게 좋아요", "자리를 옮기는 일은 이번에는 득이 적으니, 미뤄 두세요"] },
  { key: "home", re: /家|膝下|妻|子孫|夫婦|弄璋|生男|生子|兄弟|父母|親憂/, label: "집안",
    good: ["집안에 기쁜 일이 생기니, 가족과 함께하는 시간을 늘려 보세요", "가족 사이가 화목해지니, 함께 계획을 세우기 좋아요"],
    bad: ["집안이나 가족 일로 근심이 생기기 쉬우니, 가족의 이야기에 먼저 귀 기울여 주세요", "집안이 어수선해지기 쉬우니, 작은 일도 말로 풀어 두세요"] },
  { key: "romance", re: /婚|佳人|女色|酒色|美人|花燭/, label: "인연",
    good: ["좋은 인연이 다가오니, 모임 자리에 나가 보세요", "마음이 통하는 사람을 만나기 쉬우니, 표현을 아껴 두지 마세요"],
    bad: ["술자리나 이성 문제로 탈이 나기 쉬우니, 선을 분명히 지키세요", "이성 문제로 마음이 흔들리기 쉬우니, 서두르지 말고 지켜보세요"] },
];

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
  喜逢甘雨: [1, "오래 기다린 도움을 마침내 만난다"],
  旱天甘雨: [1, "오래 기다린 도움을 마침내 만난다"],
  旱天降雨: [1, "오래 기다린 도움을 마침내 만난다"],
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
  家神發動: [-1, "집안 일로 마음 쓸 일이 생긴다"],
  驛馬到門: [0, "움직이고 옮길 일이 문 앞에 와 있다"],
  六月炎天: [-1, "한여름 더위처럼 지치기 쉽다"],
  靑山歸客: [0, "밖으로 돌던 마음이 제자리로 돌아온다"],
};

// 조심하라는 반 구(愼·勿·莫…)의 대상 → 조언 한 문장. theme 은 같은 분야 문장과 겹치지 않게 거른다.
const CAUTION_ADVICE = [
  [/信|人言|他人|親人/, "남의 말만 믿고 움직이지 마세요.", "helper"],
  [/口舌|是非|爭|訟/, "시비에 끼지 말고 말을 아끼세요.", "talk"],
  [/女色|酒色|色|酒/, "술자리와 가벼운 만남은 선을 지키세요.", "romance"],
  [/水|江|渡|舟/, "물가나 궂은 날의 이동은 조심하세요.", "move"],
  [/火/, "불과 열기를 조심하세요.", null],
  [/出行|遠行|出他|行/, "먼 길은 되도록 미뤄 두세요.", "move"],
  [/盜|賊|失物/, "물건 간수를 잘해 두세요.", "money"],
  [/貪|慾|分外|妄/, "분수 밖의 욕심은 내려놓으세요.", "money"],
  [/動/, "섣불리 움직이지 마세요.", null],
  [/病|疾/, "건강을 가볍게 넘기지 마세요.", "health"],
];
// 오행 성씨(전래 관습: 성씨를 오행으로 나눈 것)는 지금 해설에 쓰지 않고 표시만 한다.
const ELEMENT_SURNAME = { 木: "목(木)", 火: "화(火)", 土: "토(土)", 金: "금(金)", 水: "수(水)" };
const DIRECTIONS = { 東: "동쪽", 西: "서쪽", 南: "남쪽", 北: "북쪽" };
const SEASONS = [[/春|寅卯/, "봄"], [/夏|巳午/, "여름"], [/秋|申酉/, "가을"], [/冬|亥子/, "겨울"]];

const pickBy = (list, seed) => list[((seed % list.length) + list.length) % list.length];
// METAPHOR 뜻은 "~다"로 끝난다. "~이다"는 "~이라는", 나머지는 "~다는"으로 잇는다.
// 받침 없는 명사로 끝나면 "~이다" 대신 "~다"로 줄여 적어 두었다(편안한 때다) — 그때는 "~라는".
export function meaningClause(meaning) {
  if (meaning.endsWith("이다")) return `${meaning.slice(0, -2)}이라는`;
  if (/(때|자리|사이|흐름)다$/.test(meaning)) return `${meaning.slice(0, -1)}라는`;
  return `${meaning}는`;
}

export function classifyHalf(half) {
  const text = String(half);
  const metaphor = METAPHOR[text] ? { half: text, tone: METAPHOR[text][0], meaning: METAPHOR[text][1] } : null;
  const caution = CAUTION_HALF.test(text);
  const conditional = CONDITIONAL.test(text);
  const hedge = HEDGE.test(text);
  const split = SPLIT.find(([re]) => re.test(text))?.[1] ?? null;
  let tone = 0;
  if (metaphor) tone = metaphor.tone;
  else if (split) tone = split === "rise" ? 1 : split === "fall" ? -1 : 0;
  else if (!conditional) {
    let good = 0, bad = 0;
    let rest = text.replace(RESOLVED, () => { good += 1; return "　"; });
    rest = rest.replace(NEGATED, () => { bad += 1; return "　"; });
    good += count(GOOD, rest);
    bad += count(BAD, rest);
    tone = Math.sign(good - bad);
  }
  const themes = THEMES.filter((t) => t.re.test(text)).map((t) => t.key);
  const side = caution || hedge || conditional ? null : tone > 0 ? "good" : tone < 0 ? "bad" : null;
  // "金姓愼之"처럼 성씨를 조심하라는 반 구는 오행 성씨 관습이라 생활 조언으로 옮기지 않는다(火姓 → "불 조심" 오독 방지).
  const advice = caution && !/姓|氏/.test(text) ? CAUTION_ADVICE.find(([re]) => re.test(text.replace(CAUTION_HALF, ""))) : null;
  return {
    // 조심하라는 반 구는 조언일 뿐 사건이 아니라 결에 넣지 않는다(뒤 반 구의 결은 그대로 센다).
    half: text, tone: caution ? 0 : hedge ? tone * 0.5 : tone, themes, side,
    caution: advice ? { text: advice[1], theme: advice[2] } : null,
    conditional, split, metaphor,
  };
}

export function classifyLine(hanja) {
  const text = String(hanja);
  const halves = text.split(/\s+/).filter(Boolean).map(classifyHalf);
  const tone = halves.reduce((s, h) => s + h.tone, 0);
  const directions = [];
  const dir = /([東西南北])([東西南北])?兩?方(有|에)?(吉|利|財)/.exec(text) ?? /利在([東西南北])方|財在([東西南北])方|([東西南北])方有(吉|利|財)/.exec(text);
  if (dir) for (const ch of dir.slice(1)) if (DIRECTIONS[ch]) directions.push(DIRECTIONS[ch]);
  const surname = /([木火土金水])姓/.exec(text);
  return {
    tone, halves,
    themes: [...new Set(halves.flatMap((h) => h.themes))],
    sided: [
      ...halves.flatMap((h) => (h.side ? h.themes.map((key) => ({ key, side: h.side })) : [])),
      // "雖有生財 得而反失"(재물이 생겨도 도로 잃는다) — 雖 반 구의 분야는 뒤 반 구의 결을 따른다.
      ...(/^雖/.test(halves[0]?.half ?? "") && halves[1] && halves[1].tone !== 0
        ? halves[0].themes.map((key) => ({ key, side: halves[1].tone > 0 ? "good" : "bad" })) : []),
    ],
    cautions: halves.map((h) => h.caution).filter(Boolean),
    metaphors: halves.map((h) => h.metaphor).filter(Boolean),
    conditional: halves.some((h) => h.conditional),
    split: halves.map((h) => h.split).find(Boolean) ?? null,
    directions,
    surname: surname ? ELEMENT_SURNAME[surname[1]] : null,
    seasons: SEASONS.filter(([re]) => re.test(text)).map(([, name]) => name),
  };
}

const OPENERS = {
  good: ["일이 순하게 풀리는 달이에요.", "기운이 밝게 트이는 달이에요.", "바라던 일에 손이 닿는 달이에요."],
  bad: ["일이 더디게 풀리는 달이에요.", "한 걸음 물러서 지키면 좋은 달이에요.", "기운이 잠시 가라앉는 달이에요."],
  mixed: ["좋은 일과 신경 쓸 일이 함께 오는 달이에요.", "좋고 궂은 일이 섞여 오는 달이에요."],
  even: ["큰 굴곡 없이 지나가는 달이에요.", "차분히 제자리를 지키면 되는 달이에요."],
  rise: ["처음엔 막혀도 갈수록 풀리는 달이에요."],
  fall: ["처음엔 잘 풀리다가 뒤에 마음 쓸 일이 생기기 쉬운 달이에요."],
  stay: ["밖으로 나서기보다 가까운 곳에서 조용히 지내면 좋은 달이에요."],
};

function sidedThemes(classes) {
  const out = {};
  for (const c of classes) for (const { key, side } of c.sided) {
    out[key] ??= { good: 0, bad: 0 };
    out[key][side] += 1;
  }
  return out;
}

// 한 달(구절 셋)의 해설. 반환: { text, tone, picks, fallback }
export function monthReading(lines, monthIndex, seed = 0) {
  const classes = lines.map((l) => classifyLine(l.hanja));
  const halves = classes.flatMap((c) => c.halves);
  const score = classes.reduce((s, c) => s + c.tone, 0);
  const hasGood = halves.some((h) => h.tone > 0);
  const hasBad = halves.some((h) => h.tone < 0);
  const split = classes.map((c) => c.split).find((s) => s === "rise" || s === "fall");
  const stay = classes.some((c) => c.conditional);
  const mixedSplit = classes.some((c) => c.split === "mixed");
  let tone = (hasGood && hasBad && Math.abs(score) < 2) || mixedSplit ? "mixed" : score >= 1 ? "good" : score <= -1 ? "bad" : "even";
  const opener = split ?? (stay && tone !== "good" ? "stay" : tone);
  if (split === "rise" && tone === "bad") tone = "mixed";
  if (split === "fall" && tone === "good") tone = "mixed";
  const picks = [`tone:${tone}`];
  if (opener !== tone) picks.push(`opener:${opener}`);
  const parts = [pickBy(OPENERS[opener], seed + monthIndex)];

  // 그 달 결과 같은 방향의 분야를 하나 골라 "특히/다만 …" 으로 잇는다(분야는 반 구 단위의 결로 정한다).
  const themes = sidedThemes(classes);
  const want = tone === "bad" ? "bad" : tone === "good" ? "good" : null;
  const ordered = THEMES.filter((t) => themes[t.key]);
  let theme = null, side = null;
  if (want) { theme = ordered.find((t) => themes[t.key][want] > 0); side = want; }
  if (!theme && tone === "mixed") {
    theme = ordered.find((t) => themes[t.key].bad > 0);
    side = "bad";
    if (!theme) { theme = ordered.find((t) => themes[t.key].good > 0); side = "good"; }
  }
  if (theme) {
    picks.push(`theme:${theme.key}:${side}`);
    parts.push(`${tone === "mixed" && side === "bad" ? "다만" : "특히"} ${pickBy(theme[side], seed + monthIndex)}.`);
  } else {
    const at = classes.findIndex((c) => c.metaphors.some((m) => m.tone === 0 || Math.sign(m.tone) === Math.sign(c.tone)));
    if (at >= 0) {
      const metaphor = classes[at].metaphors[0];
      picks.push(`metaphor:${metaphor.half}`);
      parts.push(`'${lines[at].ko.replace(/[.。]\s*$/, "")}'라는 구절은 ${meaningClause(metaphor.meaning)} 뜻이에요.`);
    }
  }
  const caution = classes.flatMap((c) => c.cautions).find((c) => c.theme !== theme?.key);
  if (caution && parts.length < 3) {
    picks.push(`caution:${caution.theme ?? "etc"}`);
    parts.push(caution.text);
  }
  if (stay && opener !== "stay" && parts.length < 3) {
    picks.push("stay");
    parts.push("밖보다 집 가까이에서 지낼 때 마음이 편해요.");
  }
  const fallback = parts.length === 1 && tone === "even" && opener === "even";
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
  mixed: "올해는 좋은 일과 궂은 일이 번갈아 오는 흐름이라, 분수를 지키며 가는 게 좋아요.",
  good: "올해는 대체로 순조롭게 풀리는 흐름이에요.",
  bad: "올해는 욕심을 줄이고 지키는 데 힘쓰면 무사히 넘어가는 흐름이에요.",
  even: "올해는 큰 굴곡 없이 고르게 흘러가는 한 해예요.",
};
const SEASON_PHRASE = { good: "일이 순하게 풀리고", bad: "마음 쓸 일이 생기기 쉽고", even: "무난하고" };
const SEASON_FINAL = { good: "일이 순하게 풀리는", bad: "마음 쓸 일이 생기기 쉬운", even: "무난한" };

function arcOf(scores) {
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const early = avg(scores.slice(0, 4));
  const mid = avg(scores.slice(4, 8));
  const late = avg(scores.slice(8));
  if (late - early >= 1.2) return "rising";
  if (early - late >= 1.2) return "falling";
  if (Math.min(early, late) - mid >= 1.2) return "valley";
  if (mid - Math.max(early, late) >= 1.2) return "peak";
  const all = avg(scores);
  return all >= 0.8 ? "good" : all <= -0.8 ? "bad" : "even";
}

// 한 해 해설. data = tojeong/<괘>.json 그대로. 반환: { paragraph, months, picks }
// 총운 문단은 **총운 9구에 있는 것만** 말한다(분야·계절·비유). 달 결은 굴곡과 좋은 달·조심할 달에만 쓴다.
export function yearReading(data) {
  const seed = Number(data.code) || 0;
  const months = data.months.map((lines, i) => monthReading(lines, i, seed));
  const summary = data.summary.map((l) => classifyLine(l.hanja));
  const summaryTone = summary.reduce((s, c) => s + c.tone, 0);
  const picks = [];
  const parts = [];

  // ① 굴곡: 총운이 계절을 말하면 그대로, 先凶後吉 같은 말이 있으면 그것, 아니면 총운의 결과 달 결.
  const seasonTone = new Map();
  for (const c of summary) for (const name of c.seasons) {
    if (!seasonTone.has(name)) seasonTone.set(name, c.tone > 0 ? "good" : c.tone < 0 ? "bad" : "even");
  }
  const split = summary.map((c) => c.split).find(Boolean);
  let arc;
  if ([...seasonTone.values()].filter((t) => t !== "even").length >= 2) {
    arc = "seasons";
    const order = ["봄", "여름", "가을", "겨울"].filter((n) => seasonTone.has(n));
    // 결이 같은 이웃 계절은 묶는다("봄과 여름에는 …").
    const groups = [];
    for (const name of order) {
      const t = seasonTone.get(name);
      if (groups.at(-1)?.tone === t) groups.at(-1).names.push(name);
      else groups.push({ tone: t, names: [name] });
    }
    const bits = groups.map((g, i) => `${g.names.join("과 ")}에는 ${(i === groups.length - 1 ? SEASON_FINAL : SEASON_PHRASE)[g.tone]}`);
    parts.push(`올해는 ${bits.join(", ")} 흐름이에요.`);
    picks.push(`arc:seasons:${order.map((n) => `${n}-${seasonTone.get(n)}`).join(",")}`);
  } else {
    arc = split === "rise" ? "rising" : split === "fall" ? "falling" : split === "mixed" ? "mixed"
      : summaryTone >= 2 ? "good" : summaryTone <= -2 ? "bad" : arcOf(months.map((m) => m.score));
    // 달 점수로 고른 굴곡이 총운의 결과 반대면(총운은 좋은데 "뒤로 갈수록 지켜라") 총운 쪽을 따른다.
    if (!split && ((arc === "falling" && summaryTone > 0) || (arc === "rising" && summaryTone < 0))) arc = summaryTone > 0 ? "good" : "bad";
    parts.push(ARC_TEXT[arc]);
    picks.push(`arc:${arc}`);
  }

  // ② 총운의 비유 하나 — 그 구의 결과 비유의 결이 같을 때만(문맥이 뒤집는 비유는 풀지 않는다).
  const metaLine = summary.findIndex((c) => c.metaphors.some((m) => m.tone === 0 || Math.sign(m.tone) === Math.sign(c.tone)));
  if (metaLine >= 0) {
    const m = summary[metaLine].metaphors[0];
    picks.push(`metaphor:${m.half}`);
    parts.push(`총운의 '${data.summary[metaLine].ko.replace(/[.。]\s*$/, "")}'라는 구절은 ${meaningClause(m.meaning)} 뜻이에요.`);
  }

  // ③ 분야: 총운 9구에서 결이 정해진 분야만.
  const themes = sidedThemes(summary);
  // 같은 분야가 총운 안에서 좋게도 나쁘게도 나오면 차이(net)로 쪽을 정한다 — "재물은 생겨도 흩어진다"를
  // "재물 운이 트인다"로 옮기지 않게.
  const net = (t) => (themes[t.key]?.good ?? 0) - (themes[t.key]?.bad ?? 0);
  // 반대쪽 결이 하나라도 있으면 그 분야는 총운 문장에서 말하지 않는다(엇갈린 분야를 한쪽으로 단정하지 않게).
  const ranked = (side) => THEMES.filter((t) => themes[t.key] && (side === "good" ? net(t) > 0 && !themes[t.key].bad : net(t) < 0 && !themes[t.key].good))
    .sort((a, b) => Math.abs(net(b)) - Math.abs(net(a)));
  const bestGood = ranked("good")[0];
  const bestBad = ranked("bad").find((t) => t !== bestGood);
  if (bestGood) {
    picks.push(`yearTheme:${bestGood.key}:good`);
    parts.push(`${arc === "bad" ? "그래도" : "특히"} ${pickBy(bestGood.good, seed)}.`);
  }
  if (bestBad) {
    picks.push(`yearTheme:${bestBad.key}:bad`);
    parts.push(`다만 ${pickBy(bestBad.bad, seed + 1)}.`);
  }
  const caution = summary.flatMap((c) => c.cautions).find((c) => c.theme !== bestBad?.key && c.theme !== bestGood?.key);
  if (caution) {
    picks.push(`caution:${caution.theme ?? "etc"}`);
    parts.push(caution.text);
  }

  // ④ 좋은 달·조심할 달(달 해설의 결 그대로).
  const order = months.map((m, i) => [m.score, i]);
  const best = [...order].sort((a, b) => b[0] - a[0] || a[1] - b[1]).filter(([s]) => s >= 1.5).slice(0, 2).map(([, i]) => i).sort((a, b) => a - b);
  const worst = [...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter(([s]) => s <= -1.5).slice(0, 2).map(([, i]) => i).sort((a, b) => a - b);
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
    parts.push(`방향으로는 ${dirs.join("과 ")}이 길하다고 해요.`);
  }
  return { version: TOJEONG_READING_VERSION, paragraph: parts.join(" "), months, picks };
}
