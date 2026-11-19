// 맞춤법 검사·글자수 세기의 규칙 엔진. **서버도 AI도 쓰지 않는 룰베이스**다 —
// 브라우저(util/proofread/index.html)와 Node 테스트(_infra/proofread.test.mjs)가
// 같이 쓰므로 DOM·Node API를 쓰지 않는다.
//
// 이 검사기가 하는 일과 하지 않는 일:
//   O  한국인이 실제로 자주 틀리는 표기·띄어쓰기를 정규식 표로 잡는다
//   X  형태소 분석·사전 대조는 하지 않는다 (표에 없는 오타는 못 잡는다)
// 그래서 "지적이 없다"가 "맞다"는 뜻은 아니다. 화면에서도 그렇게 안내한다.
//
// 규칙 하나 = { id, kind, title, why, re, fix, guard?, soft? }
//   kind  spell(맞춤법) | space(띄어쓰기) | style(문체) | format(문장부호)
//   fix   치환문("$1" 사용 가능) 또는 함수((맞은글자, match) => 문자열), null이면 확인만
//   guard (match, text) => boolean — 정규식만으로 못 거르는 예외를 걸러낸다
//   soft  true면 "확인 필요" — 오탐 여지가 있어 '모두 고치기'에서 빠진다
//
// 새 규칙을 넣을 때는 **오탐부터 생각한다.** 잘 쓴 문장을 빨갛게 만드는 규칙은
// 없느니만 못하다. 실제로 '간간히'(맛이 짜다)·'번번히'(번듯하다)처럼 맞는 말도
// 있어서 뺐다. _infra/proofread.test.mjs의 "멀쩡한 글은 건드리지 않는다"에 반례를
// 한 줄 남겨 두면 다음 사람이 같은 실수를 반복하지 않는다.
//
// 고친 결과가 원문과 같으면(=이미 바르게 쓴 자리) 지적하지 않는다. 띄어쓰기 규칙이
// 공백을 선택으로 두고도 조용한 이유가 이것이다.

export const KINDS = [
  { id: "spell", label: "맞춤법" },
  { id: "space", label: "띄어쓰기" },
  { id: "style", label: "문체" },
  { id: "format", label: "문장부호" },
];

/* ---------- 한글 음절 다루기 ---------- */
const SYL_START = 0xac00;
const SYL_END = 0xd7a3;

/** 받침(종성) 번호. 한글 음절이 아니면 -1, 받침이 없으면 0, ㄹ이면 8. */
export function finalOf(ch) {
  if (!ch) return -1;
  const cp = ch.codePointAt(0);
  if (cp < SYL_START || cp > SYL_END) return -1;
  return (cp - SYL_START) % 28;
}
const hasRieul = (ch) => finalOf(ch) === 8;

/* ---------- 표에서 규칙 만들기 ----------
   "이렇게 쓰면 무조건 틀린다"는 낱말은 표 한 줄이면 충분하다. */

// 자주 틀리는 낱말. 왼쪽은 정규식이 아니라 그냥 글자다.
const WRONG_WORDS = [
  ["몇일", "며칠"], ["오랫만", "오랜만"], ["어의없", "어이없"],
  ["금새", "금세"], ["희안", "희한"], ["설레임", "설렘"],
  ["역활", "역할"], ["눈쌀", "눈살"], ["어떻해", "어떡해"],
  ["찌게", "찌개"], ["되물림", "대물림"], ["갯수", "개수"],
  ["촛점", "초점"], ["댓가", "대가"], ["숫가락", "숟가락"],
  ["뒤치닥거리", "뒤치다꺼리"], ["서슴치", "서슴지"],
  ["일일히", "일일이"], ["곰곰히", "곰곰이"], ["틈틈히", "틈틈이"],
  ["깨끗히", "깨끗이"], ["솔직이", "솔직히"], ["가만이", "가만히"],
  ["비로서", "비로소"], ["부시시", "부스스"], ["웅큼", "움큼"],
  ["널부러", "널브러"], ["뒤늣", "뒤늦"], ["알맞는", "알맞은"],
  ["걸맞는", "걸맞은"], ["읍니다", "습니다"], ["슴니다", "습니다"],
  ["폐륜", "패륜"], ["짜집기", "짜깁기"], ["절대절명", "절체절명"],
  ["개거품", "게거품"], ["유도심문", "유도신문"], ["임신공격", "인신공격"],
  ["명예회손", "명예훼손"], ["삭월세", "사글세"], ["옛부터", "예부터"],
  ["홧병", "화병"], ["사겼", "사귀었"], ["매꾸", "메꾸"],
  ["뗄래야", "떼려야"], ["안절부절하", "안절부절못하"],
  ["담궈", "담가"], ["담궜", "담갔"], ["잠궈", "잠가"], ["잠궜", "잠갔"],
  ["치뤄", "치러"], ["치룬", "치른"], ["치뤘", "치렀"],
  ["뭐에요", "뭐예요"], ["거에요", "거예요"], ["이예요", "이에요"],
  ["할께", "할게"], ["갈께", "갈게"], ["볼께", "볼게"], ["줄께", "줄게"],
  ["올께", "올게"], ["살께", "살게"], ["먹을께", "먹을게"],
];

// 맞는 쓰임이 따로 있어서 "확인 필요"로 두는 낱말들. 왜 확인이 필요한지도 적는다.
const SOFT_WORDS = [
  ["구지", "굳이", "'구지'는 '굳이'의 잘못입니다. (구지뽕나무 같은 낱말은 그대로 두세요)"],
  ["문안하", "무난하", "'무난하다(어렵지 않다)'와 '문안하다(안부를 여쭙다)'는 다른 말입니다."],
  ["배게", "베개", "베는 물건은 '베개'입니다. ('배게'는 '촘촘하게'라는 뜻의 부사)"],
  ["바램", "바람", "'희망'의 뜻이면 '바람'입니다. (색이 변하는 '바램'은 그대로 두세요)"],
];

// 이중피동. 피동 어간에 '-어지다'를 한 번 더 붙인 자리라 한 번으로 줄인다.
// '-지-'는 뒤 어미와 줄어붙어 모습이 바뀌므로(보여지다·보여진다·보여졌다·보여질…)
// 여섯 꼴을 모두 보고, 고칠 말도 그 꼴에 맞춰 활용해 준다.
const PASSIVE_ENDINGS = ["지", "진", "져", "졌", "질", "짐"];
const DOUBLE_PASSIVE = [
  ["되어", ["되", "된", "돼", "됐", "될", "됨"]],
  ["보여", ["보이", "보인", "보여", "보였", "보일", "보임"]],
  ["불려", ["불리", "불린", "불려", "불렸", "불릴", "불림"]],
  ["잊혀", ["잊히", "잊힌", "잊혀", "잊혔", "잊힐", "잊힘"]],
  ["쓰여", ["쓰이", "쓰인", "쓰여", "쓰였", "쓰일", "쓰임"]],
  ["읽혀", ["읽히", "읽힌", "읽혀", "읽혔", "읽힐", "읽힘"]],
  ["놓여", ["놓이", "놓인", "놓여", "놓였", "놓일", "놓임"]],
  ["담겨", ["담기", "담긴", "담겨", "담겼", "담길", "담김"]],
  ["짜여", ["짜이", "짜인", "짜여", "짜였", "짜일", "짜임"]],
  ["나뉘어", ["나뉘", "나뉜", "나뉘어", "나뉘었", "나뉠", "나뉨"]],
];

export const RULES = [
  /* ---------- 되 / 돼 ----------
     '되' 자리에 '하'를, '돼' 자리에 '해'를 넣어 말이 되는 쪽이 답이다. */
  {
    id: "spell:doe-yo", kind: "spell", title: "되요 → 돼요",
    why: "'되어요'의 준말이라 '돼요'입니다. ('하요'가 아니라 '해요'인 것과 같습니다)",
    re: /되요/g, fix: "돼요",
  },
  {
    id: "spell:doet", kind: "spell", title: "됬 → 됐",
    why: "'되었-'의 준말은 '됐-'입니다. '됬'이라는 표기는 없습니다.",
    re: /됬/g, fix: "됐",
  },
  {
    id: "spell:doe-seo", kind: "spell", title: "되서 → 돼서",
    why: "'되어서'의 준말이라 '돼서'입니다.",
    re: /되서/g, fix: "돼서",
  },
  {
    id: "spell:doe-do", kind: "spell", title: "되도 → 돼도",
    why: "'되어도'의 준말이라 '돼도'입니다. ('되도록'은 맞는 표기입니다)",
    re: /되도(?!록)/g, fix: "돼도",
  },
  {
    id: "spell:an-doe", kind: "spell", title: "안되 → 안 돼",
    why: "문장이 여기서 끝나면 '돼'입니다. 뒤에 말이 이어질 때만 '안 되고·안 되면'처럼 씁니다.",
    re: /안되(?![가-힣])/g, fix: "안 돼",
  },
  {
    id: "spell:doe-iss", kind: "spell", title: "되있 → 되어 있",
    why: "'되어 있다'가 본디 꼴입니다. '되있다'라는 표기는 없습니다.",
    re: /되있/g, fix: "되어 있",
  },
  {
    id: "spell:dwae-back", kind: "spell", title: "돼고·돼면 → 되고·되면",
    why: "'돼'는 '되어'의 준말이라, '되어고·되어면'처럼 풀리지 않으면 '되'를 씁니다.",
    re: /돼(고|면|는|니|며|었|겠)/g, fix: "되$1",
  },

  /* ---------- 안 / 않 ---------- */
  {
    id: "spell:anh-to-an", kind: "spell", title: "않되 → 안 돼",
    why: "'안'은 부정하는 부사(=아니)라 띄어 쓰고, '않'은 '-지 아니하-'가 줄어든 자리에만 씁니다.",
    re: /(?<![지치])않\s?(되|돼|하|한|할|해|했|합)/g, fix: "안 $1",
  },
  {
    id: "spell:an-to-anh", kind: "spell", title: "~지 안 → ~지 않", soft: true,
    why: "'-지 아니하다'가 줄어든 자리라 '않'입니다.",
    re: /([가-힣])지\s?안(다|아|았|을|은|고|기|어)/g, fix: "$1지 않$2",
  },

  /* ---------- 왠 / 웬 ---------- */
  {
    id: "spell:wen-ji", kind: "spell", title: "웬지 → 왠지",
    why: "'왜인지'가 줄어든 말이라 '왠지'입니다. '왠'을 쓰는 곳은 여기뿐입니다.",
    re: /웬지/g, fix: "왠지",
  },
  {
    id: "spell:waen-etc", kind: "spell", title: "왠일 → 웬일",
    why: "'어찌 된·어떠한'의 뜻이면 '웬'입니다.",
    re: /왠(만|일|걸|떡|간)/g, fix: "웬$1",
  },

  /* ---------- 표로 관리하는 낱말들 ---------- */
  ...WRONG_WORDS.map(([wrong, right]) => ({
    id: `spell:${wrong}`, kind: "spell", title: `${wrong} → ${right}`,
    why: "자주 틀리는 표기입니다.", re: new RegExp(wrong, "g"), fix: right,
  })),
  ...SOFT_WORDS.map(([wrong, right, why]) => ({
    id: `spell:soft:${wrong}`, kind: "spell", title: `${wrong} → ${right}`,
    why, re: new RegExp(wrong, "g"), fix: right, soft: true,
  })),
  {
    id: "spell:samga", kind: "spell", title: "삼가해 주세요 → 삼가 주세요",
    why: "기본형이 '삼가다'라 '삼가하다'로 늘려 쓰지 않습니다.",
    re: /삼가(하|해)/g, fix: "삼가",
  },
  {
    id: "spell:sseum", kind: "spell", title: "있슴 → 있음",
    why: "명사형 어미는 '-음'입니다. '있습니다'의 '습'과 헷갈리기 쉽습니다.",
    re: /(있|없|같|좋|많|맞)슴/g, fix: "$1음",
  },
  {
    id: "spell:nah-to-nat", kind: "spell", title: "낳다 → 낫다", soft: true,
    why: "병이 사라지는 것은 '낫다', 아이를 얻는 것은 '낳다'입니다.",
    re: /(감기|병|상처|몸|얼른|빨리)(이|가)?\s*낳(아|았|을|는)/g,
    fix: (found) => found.replace("낳", "낫"),
  },
  {
    id: "spell:teulli-dareu", kind: "spell", title: "틀리다 → 다르다", soft: true,
    why: "견주어 같지 않을 때는 '다르다'입니다. '틀리다'는 답이 맞지 않을 때 씁니다.",
    re: /([가-힣])(와|과|랑|하고)\s?틀리(다|고|게|네|어|었|는)/g,
    fix: (found) => found.replace("틀리", "다르"),
  },

  /* ---------- 띄어쓰기 ----------
     의존명사(수·것·때문)는 혼자 못 서는 말이라 앞말과 띄어 쓴다. */
  {
    id: "space:su", kind: "space", title: "할수 있다 → 할 수 있다",
    why: "'수'는 의존명사라 앞말과 띄어 씁니다.",
    re: /([가-힣]) ?수 ?(있|없)/g, fix: "$1 수 $2",
    // 앞말이 관형형(ㄹ 받침)일 때만. '실수 있다'·'별수 없다'는 한 낱말이라 뺀다.
    guard: (m) => hasRieul(m[1]) && !"실별".includes(m[1]),
  },
  {
    id: "space:su-bakke", kind: "space", title: "할수밖에 → 할 수밖에",
    why: "'수'는 앞말과 띄고, 조사 '밖에'는 '수'에 붙여 씁니다.",
    re: /([가-힣]) ?수 ?밖에/g, fix: "$1 수밖에",
    guard: (m) => hasRieul(m[1]) && !"실별".includes(m[1]),
  },
  {
    id: "space:geot-gat", kind: "space", title: "할것같다 → 할 것 같다",
    why: "'것'은 의존명사라 앞말과 띄고, '같다'도 띄어 씁니다. ('그것·이것·저것'은 한 낱말)",
    re: /([가-힣]) ?것 ?같/g,
    fix: (found, m) => `${m[1]}${"그이저".includes(m[1]) ? "" : " "}것 같`,
  },
  {
    id: "space:wa-gat", kind: "space", title: "~와같이 → ~와 같이",
    why: "'같이·같은'은 앞말과 띄어 씁니다.",
    re: /([가-힣])(와|과) ?같(이|은|다|아)/g, fix: "$1$2 같$3",
  },
  {
    id: "space:e-daehan", kind: "space", title: "~에대한 → ~에 대한",
    why: "'대하다'는 앞말과 띄어 씁니다.",
    re: /([가-힣])에 ?대(한다|하여|한|해)/g, fix: "$1에 대$2",
  },
  {
    id: "space:ttae-mun", kind: "space", title: "~때문에 앞은 띄어 씁니다",
    why: "'때문'은 의존명사라 앞말과 띄어 씁니다.",
    re: /([가-힣])때문(에|이|입니다)/g, fix: "$1 때문$2",
    guard: (m) => !"그이저".includes(m[1]),
  },

  /* ---------- 문체 ---------- */
  ...DOUBLE_PASSIVE.map(([stem, forms]) => ({
    id: `style:passive:${stem}`, kind: "style",
    title: `${stem}지다 → ${forms[0]}다`,
    why: "피동을 두 번 겹쳐 썼습니다. 한 번만 쓰면 문장이 짧고 또렷해집니다.",
    // 사이에 공백을 두지 않는다 — '되어 진짜'처럼 띄어 쓴 자리까지 잡으면 오탐이 된다.
    re: new RegExp(`${stem}([${PASSIVE_ENDINGS.join("")}])`, "g"),
    fix: (found, m) => forms[PASSIVE_ENDINGS.indexOf(m[1])],
  })),
  {
    id: "style:e-isseoseo", kind: "style", title: "~에 있어서", soft: true,
    why: "번역투입니다. '~에서·~은(는)'으로 바꾸면 자연스러워집니다.",
    re: /에\s있어서/g, fix: null,
  },
  {
    id: "style:ro-buteo", kind: "style", title: "~로 부터 → ~로부터",
    why: "'로부터'는 한 덩어리 조사라 붙여 씁니다.",
    re: /(으?로)\s부터/g, fix: "$1부터",
  },

  /* ---------- 문장부호·형식 ---------- */
  // 줄 끝 공백이 먼저다 — 줄 끝의 여러 칸은 "한 칸으로 줄이기"가 아니라 "지우기"다.
  // (겹치는 지적은 하나만 남고, 같은 자리면 먼저 적은 규칙이 이긴다)
  {
    id: "format:trailing-space", kind: "format", title: "줄 끝에 공백이 있습니다",
    why: "눈에 보이지 않지만 글자 수에는 들어갑니다.",
    re: /[ \t]+$/gm, fix: "",
  },
  {
    id: "format:multi-space", kind: "format", title: "공백이 두 칸 이상입니다",
    why: "한 칸으로 줄입니다. (줄 첫머리 들여쓰기는 그대로 둡니다)",
    re: /(?<=\S)[ \t]{2,}/g, fix: " ",
  },
  {
    id: "format:space-before-mark", kind: "format", title: "문장부호 앞에 공백이 있습니다",
    why: "쉼표·마침표는 앞말에 붙여 씁니다.",
    re: /[ \t]+([,.!?;:])/g, fix: "$1",
  },
  {
    id: "format:no-space-after-mark", kind: "format", title: "문장부호 뒤에 공백이 없습니다",
    why: "문장부호 다음에는 한 칸 띄웁니다.",
    re: /([가-힣])([,.!?])(?=[가-힣])/g, fix: "$1$2 ",
  },
  {
    id: "format:repeat-mark", kind: "format", title: "문장부호를 반복했습니다", soft: true,
    why: "글에서는 한 번이면 충분합니다.",
    re: /([!?])\1{2,}/g, fix: "$1",
  },
];

/* ---------- 검사 ---------- */

// exec 루프를 돌리려면 g 플래그가 있어야 한다.
const globalCopy = (re) => (re.flags.includes("g") ? re : new RegExp(re.source, `${re.flags}g`));

// 잡힌 글자만 떼어 내서 치환하면 전방·후방 탐색이 있는 규칙이 깨진다
// (예: /([가-힣])([,.!?])(?=[가-힣])/ 은 "녕." 만 놓고 보면 다시 매치되지 않는다).
// 그래서 원문 그 자리에 붙여(sticky) 치환하고, 바뀐 만큼만 잘라 낸다.
function suggestionOf(rule, match, text) {
  if (rule.fix == null) return null;
  if (typeof rule.fix === "function") return rule.fix(match[0], match);
  const sticky = new RegExp(rule.re.source, `${rule.re.flags.replace(/[gy]/g, "")}y`);
  sticky.lastIndex = match.index;
  const replaced = text.replace(sticky, rule.fix);
  const tailLength = text.length - match.index - match[0].length;
  return replaced.slice(match.index, replaced.length - tailLength);
}

// 겹치는 지적은 하나만 남긴다. 앞선 것 우선, 같은 자리면 긴 쪽 우선.
function dropOverlaps(issues) {
  const sorted = [...issues].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let end = -1;
  for (const issue of sorted) {
    if (issue.start < end) continue;
    kept.push(issue);
    end = issue.end;
  }
  return kept;
}

/**
 * 글을 검사해 지적 목록을 글 순서대로 돌려준다.
 * @param {string} text
 * @param {{kinds?: string[]}} [options] kinds를 주면 그 분류만 검사한다.
 * @returns {{id, kind, title, why, start, end, found, suggestion, soft}[]}
 */
export function check(text, options = {}) {
  if (!text) return [];
  const { kinds } = options;
  const issues = [];
  for (const rule of RULES) {
    if (kinds && !kinds.includes(rule.kind)) continue;
    const re = globalCopy(rule.re);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === "") { re.lastIndex++; continue; }
      if (rule.guard && !rule.guard(m, text)) continue;
      const suggestion = suggestionOf(rule, m, text);
      if (suggestion === m[0]) continue; // 이미 바르게 쓴 자리
      issues.push({
        id: rule.id, kind: rule.kind, title: rule.title, why: rule.why,
        start: m.index, end: m.index + m[0].length,
        found: m[0], suggestion, soft: Boolean(rule.soft),
      });
    }
  }
  return dropOverlaps(issues);
}

/** 지적 하나를 반영한 글을 돌려준다. (원본은 그대로 둔다) */
export function applyFix(text, issue) {
  if (!issue || issue.suggestion == null) return text;
  return text.slice(0, issue.start) + issue.suggestion + text.slice(issue.end);
}

/**
 * 확실한 지적('확인 필요' 제외)을 한꺼번에 반영한다. 한 번에 두 가지가 걸린 자리
 * ("보여질것같아요")는 겹치는 지적 하나가 밀려나 있으므로, 고칠 게 없어질 때까지
 * 다시 검사하며 되풀이한다. 되풀이는 5번으로 묶어 둔다 — 규칙이 서로 물고 늘어져도
 * 화면이 멈추지 않게.
 * @param {string} text
 * @param {ReturnType<typeof check>} issues 첫 회 검사 결과
 * @param {{kinds?: string[]}} [options] 다시 검사할 때 쓸 분류 (화면의 켠 분류와 맞춘다)
 */
export function applyAllFixes(text, issues, options = {}) {
  let out = text;
  let fixed = 0;
  let round = issues;
  for (let pass = 0; pass < 5; pass++) {
    const targets = round
      .filter((i) => i.suggestion != null && !i.soft)
      .sort((a, b) => b.start - a.start); // 뒤에서부터 고쳐야 앞쪽 위치가 안 밀린다
    if (!targets.length) break;
    for (const issue of targets) out = applyFix(out, issue);
    fixed += targets.length;
    round = check(out, options);
  }
  return { text: out, fixed };
}

/* ---------- 글자수 세기 ---------- */

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("ko", { granularity: "grapheme" })
  : null;

// 사람이 세는 글자 수. 이모지·조합 문자는 눈에 보이는 대로 한 글자로 센다.
function visibleLength(text) {
  if (!text) return 0;
  if (!segmenter) return [...text].length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

// 한글 한 글자를 2바이트로 세는 옛 방식. 글자 수 제한이 바이트인 양식·문자메시지 기준.
function bytes2(text) {
  let n = 0;
  for (const ch of text) n += ch.codePointAt(0) < 0x80 ? 1 : 2;
  return n;
}

/**
 * 글자 수를 센다.
 * @returns {{chars, charsNoSpace, charsNoMark, bytesUtf8, bytes2,
 *            words, sentences, paragraphs, lines, manuscript}}
 */
export function countText(text) {
  const trimmed = text.trim();
  const noSpace = text.replace(/\s/g, "");
  const chars = visibleLength(text);
  return {
    chars,
    charsNoSpace: visibleLength(noSpace),
    charsNoMark: visibleLength(noSpace.replace(/[\p{P}\p{S}]/gu, "")),
    bytesUtf8: new TextEncoder().encode(text).length,
    bytes2: bytes2(text),
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    sentences: (trimmed.match(/[^.!?…\n]*[.!?…]+|[^.!?…\n]+$/gm) || [])
      .filter((s) => s.trim()).length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    lines: text === "" ? 0 : text.split("\n").length,
    // 원고지 한 장 = 200자(공백 포함). 마지막 장은 조금만 써도 한 장으로 센다.
    manuscript: Math.ceil(chars / 200),
  };
}
