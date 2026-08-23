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

/** 결제액. 누적·잔액처럼 뒤따라오는 다른 금액에 속지 않는다. */
function findAmount(message) {
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

/**
 * 가맹점. 시각 뒤에 붙는 것이 가장 흔하고, 없으면 누적·잔액·카드사 줄이 아닌
 * 마지막 줄을 쓴다. 사람이 고칠 수 있는 값이라 틀려도 기록을 막지는 않는다.
 */
function findMerchant(message, time) {
  const lines = message.split("\n").map((line) => trim(line)).filter(Boolean);
  const drop = /^(누적|잔액|사용가능|한도|승인|취소|일시불|\d+개월)/;
  const afterTime = time
    ? lines.find((line) => line.includes(time))?.split(time)[1]?.trim()
    : "";
  const cleaned = (value) => trim(String(value ?? "")
    .replace(/(누적|잔액|사용가능금액|한도)\s*[0-9,]+\s*원.*$/, "")
    .replace(/^[\s,·|/-]+|[\s,·|/-]+$/g, "")
    .replace(/(님|귀하)$/, ""))
    .slice(0, MEMO_MAX);

  if (cleaned(afterTime)) return cleaned(afterTime);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (drop.test(line) || /원$/.test(line) || /카드$/.test(line)) continue;
    // 이름(홍*동)만 있는 줄은 가맹점이 아니다.
    if (/^[가-힣]\*[가-힣]/.test(line)) continue;
    const value = cleaned(line.replace(/^.*?\d{1,2}:\d{2}\s*/, ""));
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
export const SMS_FILE_MAX = 20_000;   // 한 번에 훑는 문자 수 상한

const unescapeXml = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (match) => ENTITIES[match]);

export const looksLikeBackup = (text) => /<smses\b|<sms\b/.test(String(text ?? "").slice(0, 4096));

/**
 * 백업 XML 에서 문자 본문과 받은 시각을 뽑는다. 시각은 본문의 "08/23" 보다 정확해서
 * (연도가 들어 있다) 있으면 그쪽을 날짜로 쓴다.
 */
export function extractBackup(xml, limit = SMS_FILE_MAX) {
  const found = [];
  for (const tag of String(xml ?? "").matchAll(SMS_TAG)) {
    if (found.length >= limit) break;
    const body = tag[0].match(ATTR("body"))?.[1];
    if (!body) continue;
    const stamp = Number(tag[0].match(ATTR("date"))?.[1]);
    found.push({ body: unescapeXml(body), at: Number.isFinite(stamp) && stamp > 0 ? stamp : null });
  }
  return found;
}

/** 붙여넣은 글이든 백업 파일이든 한 입구로 받는다. */
export function parseBackupOrText(text, today = kstDate()) {
  if (!looksLikeBackup(text)) return parseMessages(text, today);
  const results = extractBackup(text).map(({ body, at }) => {
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
  };
}

/** 이미 담긴 문자인지. 표식이 없던 시절의 기록과도 겹치지 않게 sig 로만 본다. */
export const seenSigs = (state) => new Set(state.entries.map((entry) => entry.sig).filter(Boolean));
