// 카드 승인 문자에서 금액·가맹점·날짜를 뽑는다. 순수 함수만 둔다 —
// 화면과 _infra/budget-sms.test.mjs 가 같은 모듈을 쓴다.
//
// 브라우저는 문자를 읽을 수 없다(안드로이드에도 SMS 읽기 API 가 없다). 그래서
// 문자가 여기 오는 길은 둘뿐이다: 공유 시트로 보내거나, 붙여넣거나. 어느 쪽이든
// **글 한 덩어리**로 오므로 이 파서는 그 덩어리만 다룬다.
//
// 카드사마다 줄 모양이 달라 규칙을 카드사별로 두지 않는다. 어느 문자에나 있는
// 세 가지(금액·시각·가맹점 자리)를 위치가 아니라 생김새로 찾는다 — 새 카드사를
// 만나도 대개 그대로 걸리고, 못 걸리면 화면이 "못 읽은 문자"로 보여 준다.

import { MEMO_MAX, kstDate } from "./store.js";

/** 금액이지만 결제액이 아닌 것들. 이 말이 앞에 있으면 건너뛴다. */
const NOT_SPENDING = /(누적|잔액|한도|합계|가용|사용가능|잔여|포인트|적립|캐시백|할인)\s*$/;
const CANCEL = /(취소|환불)/;
// 원화가 아닌 승인은 환산액이 문자마다 달라 믿을 수 없다 — 사람이 직접 적게 둔다.
const FOREIGN = /(USD|EUR|JPY|CNY|GBP|\$|€|￥|£)/;
// 광고·인증번호처럼 결제가 아닌 문자.
const NOT_PAYMENT = /(인증번호|본인확인|광고|무료수신거부)/;
/* 카드 대금을 갚은 것은 소비가 아니다 — 즉시결제·선결제로 카드값이 빠져나간 문자를
 * 담으면, 개별 승인으로 이미 센 돈을 대금으로 한 번 더 세게 된다(이중 계상).
 *
 * "출금"·"이체" 만으로는 거를 수 없다. 체크카드 승인 문자에도 출금이 들어가고,
 * 통신요금 자동이체는 진짜 소비다 — 카드 **대금**을 가리키는 말이 있을 때만 거른다. */
const CARD_BILL = /(즉시결제|선결제|일부결제|카드대금|결제대금|이용대금|청구대금|카드값|대금\s*(납부|출금|결제|이체))/;
const NOISE = /^\s*(\[Web발신\]|\[국외발신\]|\(광고\))\s*/gm;

const trim = (value) => value.replace(/\s+/g, " ").trim();

/**
 * 붙여넣은 글을 문자 하나씩으로 자른다. 여러 건을 한 번에 붙여넣는 것이 보통이라
 * [Web발신] 머리와 빈 줄 둘 다를 경계로 본다.
 */
export function splitMessages(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .split(/\n(?=\s*\[Web발신\])/)
    .flatMap((block) => block.split(/\n\s*\n+/))
    .map((block) => block.trim())
    .filter(Boolean);
}

/* 은행 문자의 금액은 "원" 없이 적히기도 한다: "출금100,000 잔액900,000원".
 * 그래서 이런 문자에서는 **출금·이체·송금 뒤에 붙은 숫자**를 금액으로 본다 — 원이 붙은
 * 유일한 숫자가 잔액이라, 그것만 보면 금액을 못 찾거나 잔액을 담게 된다. */
const MOVED_AMOUNT = /(출금|이체|송금)\s*:?\s*([0-9][0-9,]*)/;
const DEPOSIT = /(입금|환급|이자)\s*:?\s*[0-9]/;

/** 결제액. 누적·잔액처럼 뒤따라오는 다른 금액에 속지 않는다. */
function findAmount(message) {
  const moved = message.match(MOVED_AMOUNT);
  if (moved) {
    const amount = Number(moved[2].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { amount, index: moved.index };
  }
  for (const match of message.matchAll(/([0-9][0-9,]*)\s*원/g)) {
    const before = message.slice(0, match.index).split("\n").pop();
    if (NOT_SPENDING.test(before)) continue;
    const amount = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { amount, index: match.index };
  }
  return null;
}

/** 문자에는 연도가 없다. 오늘보다 뒤면 작년 것으로 본다(1월에 12월 문자를 받는다). */
function findDate(message, today) {
  const full = message.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  const short = message.match(/(?<!\d)(\d{1,2})\s*[./]\s*(\d{1,2})(?!\s*[.\d]*\s*원)(?!\d)/)
    ?? message.match(/(\d{1,2})월\s*(\d{1,2})일/);
  const [year, month, day] = full
    ? full.slice(1).map(Number)
    : short ? [Number(today.slice(0, 4)), Number(short[1]), Number(short[2])] : [];
  if (!month || month < 1 || month > 12 || !day || day < 1 || day > 31) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const guess = `${year}-${pad(month)}-${pad(day)}`;
  if (full || guess <= today) return guess;
  // 아직 오지 않은 날짜라면 작년 문자다.
  return `${year - 1}-${pad(month)}-${pad(day)}`;
}

const findTime = (message) => message.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)/)?.[0] ?? null;

/* 가맹점이 아닌 것들. 문자에서 이것들을 지우고 남는 말이 가게 이름이다.
 * 자리로 찾지 않는 이유: 시각이 없는 문자(자동이체·정기결제)가 실제로 있고, 그때
 * "시각 뒤" 규칙이 통째로 빗나가 문자 전체가 메모로 들어갔다. */
const NOT_MERCHANT = [
  /\[[^\]]*발신\]/g,
  /(누적|잔액|사용가능금액|사용가능|한도|승인금액)\s*[0-9,]+\s*원?/g,
  /[0-9][0-9,]*\s*원/g,
  /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/g,
  /(?<!\d)\d{1,2}\s*[./]\s*\d{1,2}(?!\d)/g,
  /\d{1,2}월\s*\d{1,2}일/g,
  /\d{1,2}:\d{2}/g,
  // 카드사 이름과 뒤에 붙는 카드 번호 네 자리. 아는 이름만 지운다 — "카드" 를 무조건
  // 지우면 상호에 든 글자까지 깎인다.
  /(신한|KB국민|KB|국민|삼성|현대|롯데|하나|우리|BC|비씨|NH|농협|씨티|IBK|기업|카카오뱅크|카카오|토스뱅크|토스|케이뱅크|수협|우체국)\s*(체크|신용)?카드?\s*\(?\d{0,4}\)?/g,
  /승인취소|승인|취소|환불|일시불|\d+개월|할부|결제완료|정상결제/g,
  // 이름은 대개 가운데를 가린다(김*형, 홍*동).
  /[가-힣]\*+[가-힣]*(님|귀하)?/g,
  /\d{2,4}-\d{3,4}-\d{4}/g,
  // 은행 문자: 계좌 마스킹(900330**4)·출금/이체 같은 동사·꺾쇠 표기.
  /\d{3,}\*+\d*/g,
  // 앞에 한글이 붙은 것은 지우지 않는다 — "자동이체" 는 통신요금 결제의 일부다.
  /(?<![가-힣])(출금|입금|이체|송금|잔액|거래)\s*:?\s*[0-9,]*/g,
];

function scrub(value) {
  // 꺾쇠는 지우되 안의 이름은 남긴다 — <새마을금고> 의 은행 이름이 곧 단서다.
  let text = String(value ?? "").replace(/[<>]/g, " ");
  for (const pattern of NOT_MERCHANT) text = text.replace(pattern, " ");
  // 괄호는 깎지 않는다 — "(주)나인투원" 처럼 상호의 일부다. 빈 짝만 걷어낸다.
  return trim(text.replace(/\(\s*\)/g, ""))
    .replace(/^[\s,.·|/-]+|[\s,.·|/-]+$/g, "")
    .slice(0, MEMO_MAX);
}

/**
 * 가맹점. 시각 뒤에 붙는 것이 가장 흔하고, 그것이 없으면 문자에서 가맹점이 아닌 것을
 * 모두 지워 남는 말을 쓴다. 사람이 고칠 수 있는 값이라 틀려도 기록을 막지는 않는다.
 */
function findMerchant(message, time) {
  const lines = message.split("\n").map((line) => trim(line)).filter(Boolean);
  const afterTime = time
    ? scrub(lines.find((line) => line.includes(time))?.split(time)[1] ?? "")
    : "";
  if (afterTime) return afterTime;

  // 지우고 남는 말이 있는 줄 중 마지막 것. 여러 줄이면 아래쪽이 가맹점일 때가 많다.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const value = scrub(lines[index]);
    if (value) return value;
  }
  return "";
}

/**
 * 문자 하나. 읽어 낸 것이 있으면 { entry }, 아니면 { reason } 을 돌려준다 —
 * 조용히 버리지 않는다(무엇을 못 읽었는지 화면이 보여 준다).
 */
export function parseMessage(raw, today = kstDate()) {
  const message = String(raw ?? "").replace(NOISE, "").trim();
  if (!message) return { raw, reason: "빈 문자" };
  if (NOT_PAYMENT.test(message)) return { raw, reason: "결제 문자가 아님" };
  if (CARD_BILL.test(message)) return { raw, reason: "카드 대금 납부 — 쓴 돈이 아님" };
  if (DEPOSIT.test(message) && !MOVED_AMOUNT.test(message)) return { raw, reason: "입금 — 쓴 돈이 아님" };
  if (FOREIGN.test(message)) return { raw, reason: "원화 결제가 아님 — 직접 적어주세요" };

  const found = findAmount(message);
  if (!found) return { raw, reason: "금액을 찾지 못함" };

  const on = findDate(message, today) ?? today;
  const time = findTime(message);
  const cancelled = CANCEL.test(message);
  const memo = findMerchant(message, time);
  return {
    raw,
    entry: {
      amount: cancelled ? -found.amount : found.amount,
      memo,
      on,
      // 같은 문자를 두 번 담지 않으려는 표식이다. 같은 가게에서 같은 금액을 다른
      // 시각에 쓴 것은 다른 결제이므로 시각까지 넣는다.
      sig: `${on}T${time ?? "??:??"}-${cancelled ? "-" : ""}${found.amount}`,
    },
    cancelled,
    time,
  };
}

/** 붙여넣은 글 전체. 읽은 것과 못 읽은 것을 함께 돌려준다. */
export function parseMessages(text, today = kstDate()) {
  const results = splitMessages(text).map((message) => parseMessage(message, today));
  return {
    found: results.filter((result) => result.entry),
    failed: results.filter((result) => !result.entry),
  };
}

/* ── 문자 백업 파일 ─────────────────────────────────────────────────
 * 안드로이드 기본 문자앱은 여러 건을 한 번에 글로 빼 주지 않는다(다중 선택은
 * 삭제·전달뿐이다). 몰아서 넣는 길은 SMS Backup & Restore 같은 백업 앱의 XML 이다.
 *
 * 파서를 DOMParser 로 두지 않는다 — 이 파일은 순수 함수만 두는 자리고, 백업 XML 은
 * 기계가 만든 납작한 구조(<sms ... body="..."/>)라 속성만 읽으면 된다. */
const SMS_TAG = /<sms\b[^>]*\/?>/g;
const ATTR = (name) => new RegExp(`\\b${name}="([^"]*)"`);
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
export const SMS_FILE_MAX = 20_000;   // 한 번에 훑는 문자 수 상한(최근 것부터 센다)
// 금액이 없는 문자는 결제일 수 없다. 백업 파일에는 잡문자가 훨씬 많아서 먼저 걸러낸다.
// 은행 문자는 "출금100,000" 처럼 원 없이 적기도 한다(실기기에서 이것 때문에 통째로 빠졌다).
const HAS_AMOUNT = /[0-9][0-9,]*\s*원|(출금|이체|송금|입금)\s*[0-9]/;

const unescapeXml = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (match) => ENTITIES[match]);

export const looksLikeBackup = (text) => /<smses\b|<sms\b/.test(String(text ?? "").slice(0, 4096));

/**
 * 백업 XML 에서 문자 본문과 받은 시각을 뽑는다. 시각은 본문의 "08/23" 보다 정확해서
 * (연도가 들어 있다) 있으면 그쪽을 날짜로 쓴다.
 *
 * **최근 것부터 센다.** 파일에 적힌 순서대로 앞에서 상한만큼 잘랐더니, 오래된 문자가
 * 먼저 오는 백업에서는 최근 결제가 통째로 잘려 나갔다("새로 백업했는데 안 늘어난다").
 * 잘린 개수는 숨기지 않고 돌려준다 — 조용히 자르면 다 읽은 줄 안다.
 */
export function extractBackup(xml, limit = SMS_FILE_MAX) {
  const rows = [];
  for (const tag of String(xml ?? "").matchAll(SMS_TAG)) {
    const raw = tag[0].match(ATTR("body"))?.[1];
    if (!raw) continue;
    // 되돌린 뒤에 거른다 — 백업 앱이 한글을 &#50896; 처럼 적어 두면 "원" 이 안 걸린다.
    const body = unescapeXml(raw);
    if (!HAS_AMOUNT.test(body)) continue;
    const stamp = Number(tag[0].match(ATTR("date"))?.[1]);
    rows.push({ body, at: Number.isFinite(stamp) && stamp > 0 ? stamp : null });
  }
  rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return { rows: rows.slice(0, limit), total: rows.length, newestAt: rows[0]?.at ?? null };
}

/** 붙여넣은 글이든 백업 파일이든 한 입구로 받는다. */
export function parseBackupOrText(text, today = kstDate()) {
  if (!looksLikeBackup(text)) return parseMessages(text, today);
  const { rows, total, newestAt } = extractBackup(text);
  const results = rows.map(({ body, at }) => {
    const result = parseMessage(body, at ? kstDate(new Date(at)) : today);
    // 백업에는 받은 시각이 들어 있다 — 본문에 날짜가 없어도 그날로 담긴다.
    if (result.entry && at) result.entry.on = kstDate(new Date(at));
    return result;
  });
  return {
    found: results.filter((result) => result.entry),
    // 백업 파일에는 결제와 무관한 문자가 대부분이라 실패를 일일이 보여 주지 않는다.
    failed: results.filter((result) => !result.entry),
    fromBackup: true,
    // 파일이 언제 것인지 화면이 말해 줄 수 있게 함께 돌려준다.
    scanned: rows.length,
    clipped: Math.max(total - rows.length, 0),
    newestOn: newestAt ? kstDate(new Date(newestAt)) : null,
  };
}

/** 이미 담긴 문자인지. 표식이 없던 시절의 기록과도 겹치지 않게 sig 로만 본다. */
export const seenSigs = (state) => new Set(state.entries.map((entry) => entry.sig).filter(Boolean));
