// 명식 풀이 — 원국 데이터(팔자·오행 분포·십성·세운·대운)를 사람이 옆에서 설명해 주듯
// 이어지는 문단으로 옮긴다. 궁합(buildCompatibility)도 같은 표를 쓴다.
//
// saju-detail.js 가 "무엇이 있나"를 계산한다면 여기는 "그래서 무슨 뜻인가"를 말한다.
// 문장은 전부 이 파일의 조각 표에서 조건에 맞는 것을 골라 접속어로 잇는다(외부 AI·LLM 없음,
// 같은 입력이면 같은 글). 라벨 나열 대신 "근거 → 결론 → 조언" 한 흐름, 해요체로 통일하고,
// 전문 용어는 문장 안 괄호로 바로 뜻을 밝힌다. 단정·공포 대신 경향과 생활 조언으로 쓴다.
//
// 해석은 학파마다 결이 다르므로 READING_RULES 로 버전을 붙여 응답에 싣는다 —
// 조각 표나 문턱값을 바꾸면 버전을 올린다. 각 결과에는 어떤 조각이 골라졌는지(`picks`)를
// 같이 실어 테스트가 문장 내용이 아니라 선택 규칙을 고정한다.

export const READING_RULES = {
  version: "saju-reading-kr-v3",
  elements: "천간·지지 겉글자 기준(지장간 제외). 0개는 결핍, 전체의 3/8 이상이면 과다",
  tenGods: "일간을 뺀 겉글자(지지는 본기)의 십성을 비겁·식상·재성·관성·인성 다섯 갈래로 센다",
  strength: "간이 판정 — 일간과 같은 오행·일간을 낳는 오행의 글자 수(월지 2배)를 나머지와 견준다",
  gunghap: "일간 오행 생극·천간합, 일지 육합·충·원진, 서로 비어 있는 오행을 채우는지",
};

// ── 형광펜·물결 밑줄 표시(marks) ─────────────────────────────────────
// 화면이 문단의 어느 곳에 형광펜(key)을 긋고 어느 곳에 빨간 물결 밑줄(caution)을 칠지
// **규칙으로** 고른다 — 손으로 고르면 문장 표가 바뀔 때마다 어긋난다. 문단마다
// key 한 문장 + caution 한 구절이 최대다. text 는 문단 안에 그대로 있는 부분 문자열이라
// 화면은 찾아서 감싸기만 한다.
export const MARK_RULES = {
  version: "marks-v1",
  key: "조언으로 끝나는 문장(…세요/좋아요/맞아요/돼요) 중 조심 문장이 아닌 마지막 것, 없으면 20자 이상인 첫 문장",
  caution: "조심 낱말(다만으로 여는 문장·조심·피하·부담·서운·걱정·고집…)이 든 첫 문장에서 그 낱말이 든 쉼표 구절, 앞 접속어는 뗀다",
};
// "쉬워요"만으로는 고르지 않는다 — "인정받는 일이 생기기 쉬운 해"처럼 좋은 뜻에도 쓰인다.
const CAUTION_WORDS = /(^다만 |조심|주의|피하|(?<!마)무리|부담|서운|엇갈리|부딪|약해지|늦어지|흩어지|밀리|고집|걱정|지나치|벅차)/;
const ADVICE_END = /(세요|좋아요|맞아요|돼요|좋겠어요|빛나요|힘이 나요|장점이에요)\.$/;
const LEAD_JOINER = /^(다만|그리고|그런데|반대로|한편|또|게다가|특히|그래서|그래도)\s+/;

function sentencesOf(paragraph) {
  const out = [];
  const re = /[^.!?]+[.!?]+(?=\s|$)/g;
  let m;
  while ((m = re.exec(paragraph))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    out.push({ text: raw.trim(), start: m.index + lead });
  }
  return out;
}

export function markSpans(paragraph) {
  const text = String(paragraph ?? "");
  const sentences = sentencesOf(text);
  if (!sentences.length) return [];
  const marks = [];
  const cautionSentence = sentences.find((s) => CAUTION_WORDS.test(s.text));
  if (cautionSentence) {
    // 쉼표로 나눈 구절 가운데 조심 낱말이 든 것 — 문장 전체에 물결을 치면 문단이 빨개진다.
    const clauses = cautionSentence.text.split(/,\s+/);
    const hit = (c) => CAUTION_WORDS.test(c) && !/^다만 $/.test(c);
    const clause = [...clauses].reverse().find((c) => hit(c.replace(LEAD_JOINER, ""))) ?? clauses[0];
    const span = clause.replace(LEAD_JOINER, "").replace(/[.!?]$/, "");
    if (span.length >= 6) marks.push({ kind: "caution", text: span });
  }
  const advice = sentences.filter((s) => s !== cautionSentence && ADVICE_END.test(s.text));
  // 조언 문장이 없으면 조심 문장이 아닌 첫 문장 — 다만 "오늘은 경인일이에요."처럼 짧은 머리말(20자 미만)은 건너뛴다
  const plain = sentences.filter((s) => s !== cautionSentence);
  const key = advice.at(-1) ?? plain.find((s) => s.text.length >= 20) ?? plain[0] ?? null;
  if (key) marks.unshift({ kind: "key", text: key.text.replace(LEAD_JOINER, "") });
  return marks;
}

const STEMS = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"];
const BRANCHES = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"];
const ELEMENTS = ["목", "화", "토", "금", "수"];
const STEM_ELEMENT = { 갑: "목", 을: "목", 병: "화", 정: "화", 무: "토", 기: "토", 경: "금", 신: "금", 임: "수", 계: "수" };
const BRANCH_ELEMENT = { 자: "수", 축: "토", 인: "목", 묘: "목", 진: "토", 사: "화",
  오: "화", 미: "토", 신: "금", 유: "금", 술: "토", 해: "수" };
export const ELEMENT_HANJA = { 목: "木", 화: "火", 토: "土", 금: "金", 수: "水" };
export const STEM_HANJA = { 갑: "甲", 을: "乙", 병: "丙", 정: "丁", 무: "戊", 기: "己", 경: "庚", 신: "辛", 임: "壬", 계: "癸" };
// 지지의 십성은 본기(지장간 마지막 글자)로 본다.
const BRANCH_MAIN_STEM = { 자: "계", 축: "기", 인: "갑", 묘: "을", 진: "무", 사: "병",
  오: "정", 미: "기", 신: "경", 유: "신", 술: "무", 해: "임" };

const BRANCH_HARMONY = new Set(["자축", "인해", "묘술", "진유", "사신", "오미"]);
const BRANCH_CLASH = new Set(["자오", "축미", "인신", "묘유", "진술", "사해"]);
const BRANCH_RESENTMENT = new Set(["자미", "축오", "인유", "묘신", "진해", "사술"]);
const STEM_UNION = new Set(["갑기", "을경", "병신", "정임", "무계"]);

export const stemElement = (stem) => STEM_ELEMENT[stem];
export const branchElement = (branch) => BRANCH_ELEMENT[branch];
const isYang = (stem) => STEMS.indexOf(stem) % 2 === 0;
// a 가 b 를 낳는가(상생) / 이기는가(상극)
export const generates = (a, b) => (ELEMENTS.indexOf(a) + 1) % 5 === ELEMENTS.indexOf(b);
export const controls = (a, b) => (ELEMENTS.indexOf(a) + 2) % 5 === ELEMENTS.indexOf(b);

// 받침 유무로 조사를 고른다. 괄호 안 한자는 건너뛰고 한글 마지막 글자를 본다.
export function josa(word, withBatchim, without) {
  const plain = String(word).replace(/\([^)]*\)\s*$/, "").replace(/['"’]+$/, "");
  if (/[0-9]$/.test(plain)) return `${word}${"013678".includes(plain.at(-1)) ? withBatchim : without}`;
  const code = plain.charCodeAt(plain.length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${has ? withBatchim : without}`;
}
export const elementWord = (e) => `${e}(${ELEMENT_HANJA[e]})`;

export function branchPairKey(a, b) {
  return [a, b].sort((x, y) => BRANCHES.indexOf(x) - BRANCHES.indexOf(y)).join("");
}

// 두 지지 사이 관계 하나. 한 쌍이 합과 충을 동시에 가질 수는 없다.
export function branchRelation(a, b) {
  if (!a || !b) return null;
  if (a === b) return "같음";
  const key = branchPairKey(a, b);
  if (BRANCH_HARMONY.has(key)) return "합";
  if (BRANCH_CLASH.has(key)) return "충";
  if (BRANCH_RESENTMENT.has(key)) return "원진";
  return null;
}

// 십성. 일간을 기준으로 상대 천간의 오행·음양을 본다.
export function tenGodOf(dayStem, targetStem) {
  const day = stemElement(dayStem);
  const target = stemElement(targetStem);
  const same = isYang(dayStem) === isYang(targetStem);
  if (day === target) return same ? "비견" : "겁재";
  if (generates(day, target)) return same ? "식신" : "상관";
  if (controls(day, target)) return same ? "편재" : "정재";
  if (controls(target, day)) return same ? "편관" : "정관";
  return same ? "편인" : "정인";
}

export const TEN_GOD_GROUP = { 비견: "비겁", 겁재: "비겁", 식신: "식상", 상관: "식상",
  편재: "재성", 정재: "재성", 편관: "관성", 정관: "관성", 편인: "인성", 정인: "인성" };
// 문장 안 괄호 풀이. "정인(나를 돕고 가르치는 기운)"처럼 쓴다.
export const TEN_GOD_GLOSS = {
  비견: "나와 어깨를 나란히 하는 기운", 겁재: "나와 경쟁하는 기운",
  식신: "내가 즐겁게 만들어 내는 기운", 상관: "내가 거침없이 드러내는 기운",
  편재: "크게 움직이는 재물·기회", 정재: "차곡차곡 쌓는 재물",
  편관: "나를 단련시키는 압박", 정관: "나를 바로 세우는 규칙·명예",
  편인: "남다르게 꿰뚫는 생각", 정인: "나를 돕고 가르치는 기운",
};
const GROUPS = ["비겁", "식상", "재성", "관성", "인성"];

// 순서가 정해진 조각 목록에서 seed 로 하나를 고른다 — 같은 문장틀이 모든 사람에게
// 똑같이 반복되지 않게 하되, 같은 사람·같은 날에는 언제나 같은 글이 나온다.
const pick = (list, seed) => list[((seed % list.length) + list.length) % list.length];

// ── 일간 ────────────────────────────────────────────────
// nature 는 "갑목(甲木) 일간이라 " 뒤에 바로 붙는 절. more 는 이어지는 한 문장.
export const DAY_MASTER = {
  갑: { image: "큰 나무", keyword: "곧게 뻗는 사람",
    nature: "큰 나무처럼 목표가 서면 곧게 밀고 나가는 편이에요.",
    more: "원칙과 명분을 중시하고, 무리 앞에 서서 길을 내는 역할을 자연스럽게 맡곤 해요.",
    caution: "꺾이지 않으려다 융통성을 놓치기 쉬운데, 방향을 바꾸는 게 지는 건 아니에요." },
  을: { image: "풀과 덩굴", keyword: "휘어도 꺾이지 않는 사람",
    nature: "덩굴처럼 유연하게 주변에 기대며 길을 찾는 편이에요.",
    more: "바람에 휘었다가도 다시 일어서는 끈기가 있고, 사람 사이에서 틈을 읽는 감각이 좋아요.",
    caution: "주변을 살피다 정작 내 뜻을 미루기 쉬우니, 원하는 걸 먼저 말해 보세요." },
  병: { image: "태양", keyword: "주변을 밝히는 사람",
    nature: "한낮의 해처럼 밝고 솔직해서 숨기는 게 별로 없는 편이에요.",
    more: "열정이 금방 옮아가는 사람이라 분위기를 띄우고 사람을 모으는 데 강해요.",
    caution: "확 타올랐다 빨리 식을 수 있으니, 시작만큼 마무리에도 힘을 남겨 두세요." },
  정: { image: "촛불과 등불", keyword: "곁을 따뜻하게 비추는 사람",
    nature: "어둠 속 등불처럼 조용하지만 오래 곁을 밝혀 주는 편이에요.",
    more: "섬세하고 배려가 깊어서, 한 가지에 마음을 쏟으면 깊이 파고드는 집중력이 나와요.",
    caution: "속으로 삭이다 지치기 쉬우니, 서운한 일은 작을 때 꺼내 놓는 게 좋아요." },
  무: { image: "큰 산", keyword: "기댈 수 있는 사람",
    nature: "큰 산처럼 듬직해서 주변이 자연스럽게 기대 오는 편이에요.",
    more: "여러 사람을 품는 포용력이 있고, 상황이 흔들릴 때 중심을 잡아 줘요.",
    caution: "변화를 늦게 받아들여 고집으로 보일 수 있으니, 새 방식은 작게라도 시험해 보세요." },
  기: { image: "기름진 밭", keyword: "가꾸고 길러 내는 사람",
    nature: "씨앗을 받아 길러 내는 밭처럼 실속 있고 살뜰한 편이에요.",
    more: "현실 감각이 좋아 계획을 실제로 굴러가게 만들고, 사람을 챙기는 데 능해요.",
    caution: "남의 몫을 챙기느라 내 몫을 놓치기 쉬우니, 나를 위한 시간도 일정에 넣어 두세요." },
  경: { image: "바위와 원석", keyword: "단단하고 결단하는 사람",
    nature: "다듬지 않은 원석처럼 강하고 꾸밈이 없는 편이에요.",
    more: "옳다고 믿는 일에는 결단이 빠르고 의리가 있어서, 맡은 일은 끝까지 해내요.",
    caution: "말이 직설적이라 의도보다 세게 전해질 수 있으니, 한 박자 고르고 말해 보세요." },
  신: { image: "보석", keyword: "빛나도록 다듬는 사람",
    nature: "잘 세공된 보석처럼 정교하고 세련된 감각을 지닌 편이에요.",
    more: "기준이 높고 디테일에 강해서, 결과물의 완성도로 인정받는 일이 많아요.",
    caution: "완벽을 기다리다 시작이 늦어지기 쉬우니, 70점에서 먼저 내보이는 연습도 해 보세요." },
  임: { image: "바다와 큰 강", keyword: "넓게 품고 흐르는 사람",
    nature: "큰 물처럼 시야가 넓고 품는 그릇이 큰 편이에요.",
    more: "지식과 정보를 빨아들이는 속도가 빠르고, 막히면 돌아갈 길을 찾아내요.",
    caution: "관심사가 넓어 흩어지기 쉬우니, 이번 달에 끝낼 한 가지를 정해 두면 좋아요." },
  계: { image: "이슬비와 샘물", keyword: "조용히 스며드는 사람",
    nature: "이슬비처럼 조용하지만 깊이 스며드는 영향력을 지닌 편이에요.",
    more: "감수성과 직관이 뛰어나서, 남들이 놓친 걸 먼저 알아채곤 해요.",
    caution: "생각이 꼬리를 물어 걱정이 커지기 쉬운데, 몸을 움직이면 머리가 가벼워져요." },
};

// ── 오행 ────────────────────────────────────────────────
// missing/excess 의 effect 는 "~어서," 뒤에 이어지는 결과절, tip 은 독립된 조언 문장.
export const ELEMENT_MEANING = {
  목: { role: "시작하고 자라게 하는 힘",
    missing: { effect: "새 일을 벌이거나 꾸준히 키워 가는 힘이 약해지기 쉬워요.", tip: "거창한 계획보다 매일 조금씩 쌓는 작은 목표가 잘 맞아요." },
    excess: { effect: "시작은 많은데 마무리가 밀리고 내 방식을 고집하기 쉬워요.", tip: "벌여 둔 일의 수를 줄이고 하나씩 끝내 보세요." } },
  화: { role: "드러내고 표현하는 힘",
    missing: { effect: "마음을 겉으로 표현하는 게 서툴고 활력이 쉽게 떨어질 수 있어요.", tip: "햇볕 아래를 걷고, 고마운 마음은 말로 꺼내 보면 도움이 돼요." },
    excess: { effect: "열정이 앞서 성급해지거나 감정의 오르내림이 커질 수 있어요.", tip: "중요한 결정은 하룻밤 재워 두는 습관을 들여 보세요." } },
  토: { role: "중심을 잡고 버티게 하는 힘",
    missing: { effect: "생활 리듬이나 마음의 중심이 쉽게 흔들릴 수 있어요.", tip: "일정한 기상 시간이나 식사 같은 루틴, 꾸준한 저축이 받침이 돼요." },
    excess: { effect: "익숙한 것에 머무르려 하고 걱정이 쌓이기 쉬워요.", tip: "가끔은 계획 없이 새로운 곳에 가 보는 것도 좋아요." } },
  금: { role: "정리하고 결단하는 힘",
    missing: { effect: "맺고 끊는 결단이 필요한 순간에 오래 망설이기 쉬워요.", tip: "맺고 끊을 일은 기한을 먼저 정해 두세요." },
    excess: { effect: "기준이 엄격해져서 나와 남에게 날카로워질 수 있어요.", tip: "옳고 그름을 따지기 전에 상대의 사정을 한 번 더 물어보세요." } },
  수: { role: "쉬고 생각하며 흘려보내는 힘",
    missing: { effect: "쉬는 법을 잊고 스스로를 몰아붙이기 쉬워요.", tip: "충분한 잠과 물, 하루를 돌아보는 짧은 기록이 균형을 잡아 줘요." },
    excess: { effect: "생각이 많아 실행이 늦어지고 불안이 커질 수 있어요.", tip: "머릿속 할 일을 종이에 옮겨 적고 몸부터 움직여 보세요." } },
};

// ── 십성 다섯 갈래 ─────────────────────────────────────
export const GROUP_MEANING = {
  비겁: { gloss: "나와 같은 기운",
    many: "자기 주관이 뚜렷하고 혼자서도 해내는 힘이 있어요", manyTip: "함께 일할 땐 나눌 몫과 규칙을 미리 정해 두면 서운할 일이 줄어요.",
    none: "혼자 버티기보다 주변과 함께할 때 힘이 나는 편이에요.", noneTip: "곁에서 힘을 보태 줄 사람을 챙겨 두세요." },
  식상: { gloss: "내가 밖으로 내보내는 재능과 표현",
    many: "말과 글, 손으로 만드는 재주가 넘쳐요", manyTip: "표현이 많은 만큼 중요한 말은 한 번 고르고 하는 게 좋아요.",
    none: "생각을 겉으로 꺼내는 데 시간이 걸리는 편이에요.", noneTip: "작게라도 결과물을 만들어 보여 주면 기회가 열려요." },
  재성: { gloss: "내가 다루는 돈과 현실",
    many: "현실 감각과 셈이 빠르고 결과를 중시해요", manyTip: "일을 많이 벌이면 관리가 벅차지니 우선순위를 좁혀 보세요.",
    none: "돈이나 성과를 직접 쫓는 데는 관심이 덜한 편이에요.", noneTip: "가계부나 목표 숫자처럼 눈에 보이는 기준을 하나 두면 좋아요." },
  관성: { gloss: "나를 다스리는 책임과 규칙",
    many: "책임감이 강하고 조직과 규칙 안에서 인정받아요", manyTip: "기대를 다 짊어지다 지치지 않게 거절하는 연습도 필요해요.",
    none: "틀에 얽매이지 않는 자유로운 기질이에요.", noneTip: "스스로 정한 마감이 있으면 능력이 더 잘 드러나요." },
  인성: { gloss: "나를 돕는 배움과 보살핌",
    many: "배우고 생각하는 힘이 크고 도움을 받는 복이 있어요", manyTip: "생각이 실행보다 길어지지 않게 '일단 해 보기'를 곁들여 보세요.",
    none: "남의 도움보다 스스로 부딪혀 익히는 편이에요.", noneTip: "믿을 만한 조언자를 한 명 두면 길이 빨라져요." },
};

// 세운: effect 는 "~라서," 뒤에 이어지는 결과, tip 은 조언.
export const YEAR_TEN_GOD = {
  비견: { effect: "독립하고 싶은 마음이 커지고 동료와 함께할 일이 늘어나는 해예요.", tip: "돈이 함께 걸린 일은 말보다 문서로 분명히 해 두세요." },
  겁재: { effect: "경쟁심과 추진력이 커지는 해예요.", tip: "다만 지출과 투자의 기복도 커지기 쉬우니 큰돈은 천천히 움직이세요." },
  식신: { effect: "하고 싶은 일을 꾸준히 펼치기 좋은 해예요.", tip: "취미나 작은 결과물이 쌓여 인정받기 쉬우니 기록을 남겨 두세요." },
  상관: { effect: "새로운 시도와 아이디어가 빛나는 해예요.", tip: "윗사람이나 규칙과 부딪히지 않게 말의 온도만 조절해 주세요." },
  편재: { effect: "사람과 기회가 넓게 들어오고 돈의 흐름도 커지는 해예요.", tip: "벌이는 만큼 정리하는 시간도 함께 잡아 두세요." },
  정재: { effect: "성실하게 쌓은 만큼 거두기 좋은 해예요.", tip: "저축이나 계약처럼 오래 갈 재정 계획을 세우기에 알맞아요." },
  편관: { effect: "책임과 압박이 커지지만 넘기고 나면 한 단계 올라서는 해예요.", tip: "버거운 시기일수록 휴식과 운동을 일정에 먼저 넣어 두세요." },
  정관: { effect: "승진·자격·소속처럼 인정받는 일이 생기기 쉬운 해예요.", tip: "원칙대로 처리할수록 신뢰가 쌓여요." },
  편인: { effect: "생각이 깊어지고 새로운 분야에 끌리는 해예요.", tip: "공부나 자격 준비에 좋지만, 결정을 너무 오래 미루지는 마세요." },
  정인: { effect: "배우고 도움받는 흐름이 좋은 해예요.", tip: "스승이나 선배의 조언이 길을 열어 주니 먼저 물어보세요." },
};
// 대운: 10년 단위의 결.
export const LUCK_GROUP = {
  비겁: { name: "나를 세우는 10년", text: "독립이나 내 일, 동료와의 연대가 주제가 되기 쉬워요." },
  식상: { name: "펼치는 10년", text: "재능과 표현을 밖으로 내보이며 활동 무대가 넓어지기 쉬워요." },
  재성: { name: "거두는 10년", text: "돈과 현실을 다루는 일이 늘고 생활 기반을 다지기 좋아요." },
  관성: { name: "책임지는 10년", text: "직장이나 사회적 역할이 커지는 만큼 무게도 함께 늘어요." },
  인성: { name: "채우는 10년", text: "배움과 자격, 보살핌을 통해 안쪽을 단단히 하기 좋아요." },
};
// 12운성: gloss 는 괄호 풀이, advice 는 이어지는 조언.
export const STAGE_MEANING = {
  장생: { gloss: "새싹이 돋는 자리", advice: "새로 시작하는 일에 힘이 실려요." },
  목욕: { gloss: "호기심 많고 흔들리며 배우는 자리", advice: "이것저것 해 보되 중요한 약속은 가볍게 하지 마세요." },
  관대: { gloss: "자신감이 차올라 나서는 자리", advice: "앞에 나서기 좋지만 과시로 보이지 않게만 조심하세요." },
  건록: { gloss: "제 힘으로 서는 자리", advice: "스스로 꾸려 가는 일에서 안정감을 얻기 좋아요." },
  제왕: { gloss: "기세가 정점에 이른 자리", advice: "주도권을 잡기 좋아요. 다만 정점 다음도 미리 준비해 두세요." },
  쇠: { gloss: "노련해져 한발 물러서는 자리", advice: "앞장서기보다 경험을 나누는 쪽이 잘 풀려요." },
  병: { gloss: "힘을 아끼고 돌봄이 필요한 자리", advice: "무리한 확장보다 컨디션 관리가 먼저예요." },
  사: { gloss: "하나를 마무리하는 자리", advice: "끝낼 것을 깔끔히 정리하면 다음 문이 열려요." },
  묘: { gloss: "거두어 저장하는 자리", advice: "드러내기보다 안으로 내실을 다지기 좋아요." },
  절: { gloss: "옛것과 끊고 새 판을 짜는 자리", advice: "익숙한 방식을 내려놓고 새 판을 짜기 좋은 때예요." },
  태: { gloss: "새것을 품고 구상하는 자리", advice: "바로 실행하기보다 구상을 다듬어 두면 좋아요." },
  양: { gloss: "때를 기다리며 준비하는 자리", advice: "서두르지 않고 기반을 기르는 게 이득이에요." },
};
const RELATION_YEAR = {
  합: { joiner: "게다가", text: "올해의 지지가 내 일지(나와 가까운 사람의 자리)와 합을 이뤄서, 사람과 인연이 이어지고 협력할 일이 늘어요." },
  같음: { joiner: "게다가", text: "올해의 지지가 내 일지와 같아서, 나다운 방식이 더 강하게 드러나요." },
  충: { joiner: "다만", text: "올해의 지지가 내 일지와 충(서로 부딪침)이라, 이사·이직·관계의 변화처럼 움직임이 생기기 쉬워요. 변화를 피하기보다 미리 준비해 두면 좋아요." },
  원진: { joiner: "다만", text: "올해의 지지가 내 일지와 원진(까닭 없이 서로 꺼림)이라, 가까운 사이에서 오해가 쌓이기 쉬워요. 서운함은 미루지 말고 풀어 두세요." },
};

function surfaceChars(candidate) {
  const out = [];
  for (const key of ["year", "month", "day", "hour"]) {
    const p = candidate.pillars[key];
    if (!p) continue;
    out.push({ key, part: "stem", char: p.stem.korean, element: stemElement(p.stem.korean) });
    out.push({ key, part: "branch", char: p.branch.korean, element: branchElement(p.branch.korean) });
  }
  return out;
}

export function elementCounts(candidate) {
  const counts = Object.fromEntries(ELEMENTS.map((e) => [e, 0]));
  for (const c of surfaceChars(candidate)) counts[c.element] += 1;
  return counts;
}

const dayMasterName = (stem) => `${stem}${stemElement(stem)}(${STEM_HANJA[stem]}${ELEMENT_HANJA[stemElement(stem)]})`;

function readElements(candidate) {
  const counts = elementCounts(candidate);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const threshold = Math.ceil(total * 3 / 8);
  const missing = ELEMENTS.filter((e) => counts[e] === 0);
  const excess = ELEMENTS.filter((e) => counts[e] >= threshold);
  const parts = [];
  const picks = [];
  excess.forEach((e, i) => {
    const m = ELEMENT_MEANING[e];
    picks.push(`excess:${e}`);
    parts.push(`${i ? "또 " : ""}${elementWord(e)} 기운이 ${counts[e]}개나 몰려 있어요. ${josa(e, "은", "는")} ${m.role}이라, 이게 넘치면 ${m.excess.effect} ${m.excess.tip}`);
  });
  missing.forEach((e, i) => {
    const m = ELEMENT_MEANING[e];
    picks.push(`missing:${e}`);
    // 첫 결핍은 "반대로 화(火)가", 둘째부터는 "금(金)도" — 같은 틀이 연달아 반복되지 않게.
    const subject = i === 0 ? `${excess.length ? "반대로 " : ""}${josa(elementWord(e), "이", "가")}` : `${elementWord(e)}도`;
    parts.push(`${subject} 하나도 없어요. ${josa(e, "은", "는")} ${m.role}이라, 이게 비어 있으면 ${m.missing.effect} ${m.missing.tip}`);
  });
  if (!parts.length) {
    picks.push("balanced");
    parts.push("다섯 기운이 모두 한두 개씩 있어서 어느 한쪽으로 쏠리지 않아요. 그래서 낯선 상황에서도 균형을 잃지 않는 편이에요.");
  }
  return { counts, total, missing, excess, picks, paragraph: parts.join(" ") };
}

function readTenGods(candidate) {
  const dayStem = candidate.pillars.day.stem.korean;
  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const c of surfaceChars(candidate)) {
    if (c.key === "day" && c.part === "stem") continue;
    const stemLike = c.part === "stem" ? c.char : BRANCH_MAIN_STEM[c.char];
    counts[TEN_GOD_GROUP[tenGodOf(dayStem, stemLike)]] += 1;
  }
  const max = Math.max(...Object.values(counts));
  const dominant = max >= 3 ? GROUPS.filter((g) => counts[g] === max) : [];
  const none = GROUPS.filter((g) => counts[g] === 0);
  const picks = [];
  const parts = ["일간을 뺀 글자들을 나와의 관계(십성)로 나눠 보면,"];
  if (dominant.length) {
    const g = dominant[0];
    picks.push(`many:${g}`);
    parts.push(`${g}(${GROUP_MEANING[g].gloss})이 ${counts[g]}개로 가장 많아요. 그래서 ${GROUP_MEANING[g].many}. ${GROUP_MEANING[g].manyTip}`);
  } else {
    picks.push("spread");
    parts.push("어느 한 갈래가 크게 몰리지 않고 섞여 있어요. 그래서 한 역할에 묶이기보다 상황마다 다른 얼굴을 꺼내 쓰는 편이에요.");
  }
  if (none.length) {
    const g = none[0];
    picks.push(`none:${g}`);
    parts.push(`${dominant.length ? "반대로" : "다만"} ${g}(${GROUP_MEANING[g].gloss})은 하나도 없어요. 그래서 ${GROUP_MEANING[g].none} ${GROUP_MEANING[g].noneTip}`);
  }
  return { counts, dominant, none, picks, paragraph: parts.join(" ") };
}

// 간이 신강·신약. 정식 판정(득령·득지·득세·통근)을 다 하지 않으므로 문장에 "편"으로만 말한다.
function readStrength(candidate) {
  const me = stemElement(candidate.pillars.day.stem.korean);
  let support = 0, other = 0;
  for (const c of surfaceChars(candidate)) {
    if (c.key === "day" && c.part === "stem") continue;
    const weight = c.key === "month" && c.part === "branch" ? 2 : 1;
    if (c.element === me || generates(c.element, me)) support += weight;
    else other += weight;
  }
  const level = support - other >= 2 ? "강" : other - support >= 2 ? "약" : "중";
  const paragraph = {
    강: "명식 전체로 보면 나를 받쳐 주는 기운(같은 오행과 나를 낳는 오행)이 많은 편이에요. 그래서 스스로 밀고 나가는 힘이 좋고, 그 힘을 표현·성과·책임처럼 밖으로 쓰는 일에서 빛나요.",
    약: "명식 전체로 보면 나를 받쳐 주는 기운(같은 오행과 나를 낳는 오행)이 적은 편이에요. 그래서 배움과 조언을 가까이 둘 때 힘이 나요.",
    중: "명식 전체로 보면 나를 받쳐 주는 기운과 내가 써야 하는 기운이 비슷해요. 그래서 상황에 따라 밀고 당기는 균형 감각이 장점이에요.",
  }[level];
  return { support, other, level, picks: [`strength:${level}`], paragraph };
}

function readAnnual(candidate, detail) {
  const annual = detail?.annual;
  if (!annual) return null;
  const dayStem = candidate.pillars.day.stem.korean;
  const [stem, branch] = Array.from(annual.ganji);
  const relation = branchRelation(candidate.pillars.day.branch.korean, branch);
  const y = YEAR_TEN_GOD[annual.tenGod];
  const s = STAGE_MEANING[annual.stage];
  const parts = [
    `${annual.year}년은 ${annual.ganji}(${annual.hanja})년이에요.`,
    `한 해를 이끄는 천간 ${josa(`${stem}${stemElement(stem)}`, "은", "는")} ${dayStem}${stemElement(dayStem)}인 나에게 ${annual.tenGod}(${TEN_GOD_GLOSS[annual.tenGod]})${josa(annual.tenGod, "이라서", "라서").slice(annual.tenGod.length)} ${y.effect} ${y.tip}`,
    `그리고 기운의 성쇠를 열두 단계로 보는 12운성으로는 '${annual.stage}'(${s.gloss})에 해당해요. ${s.advice}`,
  ];
  const picks = [`year:${annual.tenGod}`, `stage:${annual.stage}`];
  if (relation && RELATION_YEAR[relation]) {
    picks.push(`relation:${relation}`);
    parts.push(`${RELATION_YEAR[relation].joiner} ${RELATION_YEAR[relation].text}`);
  }
  return { year: annual.year, ganji: annual.ganji, tenGod: annual.tenGod, relation, picks, paragraph: parts.join(" ") };
}

function readLuck(candidate, detail) {
  const luck = detail?.luck;
  if (!luck) return null;
  const dayStem = candidate.pillars.day.stem.korean;
  if (luck.current < 0) {
    const first = luck.pillars[0];
    return { current: null, next: first, picks: ["luck:before"],
      paragraph: `대운(10년마다 바뀌는 큰 흐름)은 ${first.age}세에 ${first.ganji} 대운으로 처음 시작해요. 그전까지는 타고난 명식의 결이 그대로 드러나는 시기라, 위의 성향 풀이가 지금의 나를 가장 잘 설명해요.` };
  }
  const now = luck.pillars[luck.current];
  const next = luck.pillars[luck.current + 1] ?? null;
  const god = tenGodOf(dayStem, Array.from(now.ganji)[0]);
  const group = TEN_GOD_GROUP[god];
  const s = STAGE_MEANING[now.stage];
  const parts = [
    `대운(10년마다 바뀌는 큰 흐름)으로 보면 지금은 ${now.age}세부터 이어지는 ${now.ganji} 대운 안에 있어요.`,
    `이 대운의 천간이 나에게 ${god}(${TEN_GOD_GLOSS[god]})${josa(god, "이라서", "라서").slice(god.length)}, 지금은 ${LUCK_GROUP[group].name}이에요. ${LUCK_GROUP[group].text}`,
    `바탕의 기세는 12운성으로 '${now.stage}'(${s.gloss})${josa(now.stage, "이에요", "예요").slice(now.stage.length)}.`,
  ];
  const picks = [`luck:${group}`, `luckStage:${now.stage}`];
  if (next) {
    const nextGod = tenGodOf(dayStem, Array.from(next.ganji)[0]);
    const nextGroup = TEN_GOD_GROUP[nextGod];
    picks.push(nextGroup === group ? "next:same" : `next:${nextGroup}`);
    parts.push(nextGroup === group
      ? `${next.age}세부터는 ${next.ganji} 대운으로 넘어가지만 같은 ${group} 갈래라 흐름이 크게 바뀌진 않아요.`
      : `그리고 ${next.age}세부터는 ${next.ganji} 대운으로 넘어가면서 무게가 ${nextGroup}(${GROUP_MEANING[nextGroup].gloss}) 쪽으로 옮겨 가요.`);
  }
  return { current: { ...now, tenGod: god, group }, next, picks, paragraph: parts.join(" ") };
}

// 첫머리 요약: 일간 성향 + 가장 두드러진 오행 치우침 + 조언을 한 흐름으로.
function readOverview(candidate, elements) {
  const dayStem = candidate.pillars.day.stem.korean;
  const dm = DAY_MASTER[dayStem];
  const me = stemElement(dayStem);
  const parts = [`${dayMasterName(dayStem)} 일간이라 ${dm.nature}`];
  const picks = [`dayMaster:${dayStem}`];
  const focusMissing = elements.missing[0];
  const focusExcess = elements.excess[0];
  // 요약에서는 결핍·과다를 "무엇을 길러라/다스려라" 한 마디로만 짚는다 — 효과와 조언은 아래 오행
  // 문단이 맡는다(같은 문장이 두 번 나오면 기계적으로 읽힌다).
  if (focusMissing) {
    const m = ELEMENT_MEANING[focusMissing];
    const joiner = generates(focusMissing, me) ? "특히" : "그런데";
    picks.push(`overview:missing:${focusMissing}`);
    parts.push(`${joiner} 명식에 ${josa(elementWord(focusMissing), "이", "가")} 하나도 없어서, ${josa(m.role, "을", "를")} 의식해서 길러 두면 좋아요.`);
  } else if (focusExcess) {
    const m = ELEMENT_MEANING[focusExcess];
    const joiner = focusExcess === me ? "특히" : "다만";
    picks.push(`overview:excess:${focusExcess}`);
    parts.push(`${joiner} ${elementWord(focusExcess)} 기운이 ${elements.counts[focusExcess]}개로 몰려 있어서, ${josa(m.role, "이", "가")} 지나치지 않게 다스리는 게 좋아요.`);
  } else {
    picks.push("overview:balanced");
    parts.push("게다가 다섯 기운이 고루 갖춰져 있어서, 이 성향을 여러 상황에서 두루 꺼내 쓰기 좋아요.");
  }
  return { picks, paragraph: parts.join(" ") };
}

export function buildSajuReading(candidate, detail) {
  const dayStem = candidate.pillars.day.stem.korean;
  const dm = DAY_MASTER[dayStem];
  const element = stemElement(dayStem);
  const elements = readElements(candidate);
  const out = {
    version: READING_RULES.version,
    markRules: MARK_RULES.version,
    overview: readOverview(candidate, elements),
    dayMaster: {
      stem: dayStem, hanja: STEM_HANJA[dayStem], element, yinYang: isYang(dayStem) ? "양" : "음",
      name: dayMasterName(dayStem), image: dm.image, keyword: dm.keyword,
      paragraph: `${josa(dayMasterName(dayStem), "은", "는")} ${dm.image}에 빗대는 일간(태어난 날의 천간, 나 자신)이에요. ${dm.more} 다만 ${dm.caution}`,
    },
    elements,
    tenGods: readTenGods(candidate),
    strength: readStrength(candidate),
    annual: readAnnual(candidate, detail),
    luck: readLuck(candidate, detail),
  };
  for (const part of Object.values(out)) {
    if (part && typeof part.paragraph === "string") part.marks = markSpans(part.paragraph);
  }
  out.dayMaster.marks = markSpans(out.dayMaster.paragraph);
  return out;
}

// ── 궁합 ────────────────────────────────────────────────
const ELEMENT_PAIR = {
  같음: { score: 6, text: "같은 오행을 타고나서 생각의 결이 비슷하고 말이 잘 통해요. 다만 둘 다 같은 곳에서 약해질 수 있으니, 약한 부분은 함께 보완할 방법을 찾아 두면 좋아요." },
  a생b: { score: 10, text: "내 기운이 상대를 키워 주는 상생(서로 살림) 관계예요. 그래서 내가 챙기고 상대가 자라는 흐름이 자연스러운데, 한쪽만 주는 관계로 굳지 않게 고마움을 자주 표현해 주세요." },
  b생a: { score: 10, text: "상대의 기운이 나를 키워 주는 상생(서로 살림) 관계예요. 그래서 곁에 있으면 힘을 얻는 사이인데, 받은 만큼 상대가 원하는 방식으로 돌려주면 더 단단해져요." },
  a극b: { score: -4, text: "내 기운이 상대를 누르는 상극(한쪽이 다른 쪽을 제어함) 관계예요. 그래서 내가 이끌고 상대가 맞추기 쉬운데, 결정 전에 상대 의견을 먼저 물어보는 습관이 균형을 잡아 줘요." },
  b극a: { score: -4, text: "상대의 기운이 나를 누르는 상극(한쪽이 다른 쪽을 제어함) 관계예요. 그래서 배울 점이 많은 긴장감이 있지만, 참기만 하면 서운함이 쌓이니 불편한 점은 그때그때 말해 주세요." },
};
const DAY_BRANCH = {
  합: { score: 12, joiner: "게다가", text: "두 사람의 일지(배우자 자리)가 육합(서로 끌어안는 짝)이라 생활 리듬과 정서가 잘 맞물려요." },
  같음: { score: 4, joiner: "게다가", text: "두 사람의 일지(배우자 자리)가 같아서 일상의 취향이 닮았어요." },
  충: { score: -10, joiner: "다만", text: "두 사람의 일지(배우자 자리)가 충(서로 부딪침)이라 생활 리듬이 엇갈리기 쉬워요. 차이를 미리 대화로 맞춰 두면 오히려 서로에게 좋은 자극이 되는 짝이에요." },
  원진: { score: -8, joiner: "다만", text: "두 사람의 일지(배우자 자리)가 원진(까닭 없이 서로 꺼림)이라 별일 아닌 일에 서운함이 쌓이기 쉬워요. 감정을 짐작하지 말고 직접 묻는 연습이 도움이 돼요." },
};

export function buildCompatibility(a, b) {
  const aStem = a.pillars.day.stem.korean;
  const bStem = b.pillars.day.stem.korean;
  const aEl = stemElement(aStem);
  const bEl = stemElement(bStem);
  const picks = [];
  let score = 60;

  const pairKind = aEl === bEl ? "같음" : generates(aEl, bEl) ? "a생b" : generates(bEl, aEl) ? "b생a"
    : controls(aEl, bEl) ? "a극b" : "b극a";
  score += ELEMENT_PAIR[pairKind].score;
  picks.push(`element:${pairKind}`);
  const first = [`나는 ${dayMasterName(aStem)}, 상대는 ${dayMasterName(bStem)} 일간이에요.`, ELEMENT_PAIR[pairKind].text];
  const unionKey = [aStem, bStem].sort((x, y) => STEMS.indexOf(x) - STEMS.indexOf(y)).join("");
  if (STEM_UNION.has(unionKey)) {
    score += 10;
    picks.push("union");
    // 상극이면 "그래도"로 받아야 앞 문장과 이어진다.
    first.push(`${ELEMENT_PAIR[pairKind].score < 0 ? "그래도" : "특히"} 두 일간이 천간합(${josa(`${aStem}${stemElement(aStem)}`, "과", "와")} ${josa(`${bStem}${stemElement(bStem)}`, "이", "가")} 서로 끌어당겨 하나로 묶이는 짝)을 이뤄서 처음 만나도 낯설지 않은 인연으로 봐요.`);
  }

  const second = [];
  const relation = branchRelation(a.pillars.day.branch.korean, b.pillars.day.branch.korean);
  if (relation && DAY_BRANCH[relation]) {
    score += DAY_BRANCH[relation].score;
    picks.push(`branch:${relation}`);
    second.push(`${DAY_BRANCH[relation].joiner} ${DAY_BRANCH[relation].text}`);
  } else {
    picks.push("branch:none");
    second.push("일지(배우자 자리)끼리는 특별한 합이나 충이 없어서, 관계의 색은 함께 쌓는 시간이 정해 줘요.");
  }

  const ac = elementCounts(a);
  const bc = elementCounts(b);
  const aFilled = ELEMENTS.filter((e) => ac[e] === 0 && bc[e] >= 2);
  const bFilled = ELEMENTS.filter((e) => bc[e] === 0 && ac[e] >= 2);
  score += Math.min(12, (aFilled.length + bFilled.length) * 6);
  if (aFilled.length || bFilled.length) {
    picks.push("fill");
    const bits = [];
    if (aFilled.length) bits.push(`나에게 없는 ${aFilled.map(elementWord).join("·")} 기운을 상대가 넉넉히 가졌어요`);
    if (bFilled.length) bits.push(`${aFilled.length ? "또 " : ""}상대에게 없는 ${bFilled.map(elementWord).join("·")} 기운은 내가 채워 줘요`);
    const whose = aFilled.length && bFilled.length ? "서로의" : aFilled.length ? "나의" : "상대의";
    second.push(`그리고 ${bits.join(". ")}. 그래서 ${whose} 빈자리를 메워 주는 짝이에요.`);
  } else {
    const both = ELEMENTS.filter((e) => ac[e] === 0 && bc[e] === 0);
    if (both.length) {
      picks.push(`bothMissing:${both[0]}`);
      second.push(`한편 두 사람 모두 ${josa(elementWord(both[0]), "이", "가")} 비어 있어요. 그래서 둘이 함께 있을 때 ${ELEMENT_MEANING[both[0]].missing.effect} ${ELEMENT_MEANING[both[0]].missing.tip}`);
    } else {
      picks.push("fill:none");
    }
  }

  score = Math.max(30, Math.min(98, score));
  const level = score >= 80 ? "잘 맞음" : score >= 65 ? "좋음" : score >= 50 ? "노력형" : "조율 필요";
  const closing = {
    "잘 맞음": "전체적으로 기운이 서로를 살려 주는 편안한 궁합이에요.",
    좋음: "전체적으로 기본 결이 잘 맞고, 다른 점은 서로를 넓혀 주는 궁합이에요.",
    노력형: "전체적으로 다른 점이 분명한 만큼, 대화로 맞춰 갈 때 단단해지는 궁합이에요.",
    "조율 필요": "전체적으로 차이가 뚜렷해서, 생활 규칙을 정해 두고 서로 배려하면 좋아지는 궁합이에요.",
  }[level];
  const result = {
    version: READING_RULES.version, score, level, picks,
    paragraphs: [first.join(" "), [...second, closing].join(" ")],
  };
  result.marks = result.paragraphs.map(markSpans);
  return result;
}
