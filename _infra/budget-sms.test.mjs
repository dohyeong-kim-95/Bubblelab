// life/budget — 카드 승인 문자 읽기. 카드사마다 줄 모양이 달라 실제 문자 모양
// 그대로를 넣고 본다(규칙을 카드사별로 두지 않으므로 이 표본이 곧 명세다).
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { parseMessage, parseMessages, splitMessages, seenSigs } =
  await import("../life/budget/sms.js");
const { addEntry, emptyState } = await import("../life/budget/store.js");

const TODAY = "2026-08-23";
const read = (text) => parseMessage(text, TODAY);

test("신한 — 승인 문자에서 금액·가맹점·날짜를 뽑는다", () => {
  const { entry } = read(`[Web발신]
신한카드(1234)승인
홍*동
12,000원 일시불
08/23 14:22
백암순대 강남점
누적1,234,567원`);
  assert.equal(entry.amount, 12000);
  assert.equal(entry.memo, "백암순대 강남점");
  assert.equal(entry.on, "2026-08-23");
  assert.equal(entry.sig, "2026-08-23T14:22-12000");
});

test("누적·잔액 금액에 속지 않는다", () => {
  assert.equal(read("KB국민체크(1234)\n08/22 09:05\n4,500원\n스타벅스\n잔액 1,203,400원").entry.amount, 4500);
  assert.equal(read("하나카드1234승인 3,000원 일시불 08/23 14:22 편의점 누적 987,654원").entry.amount, 3000);
});

test("취소·환불은 음수로 담는다", () => {
  const { entry, cancelled } = read(`[Web발신]
신한카드(1234)승인취소
30,000원
08/23 15:00
무신사`);
  assert.equal(cancelled, true);
  assert.equal(entry.amount, -30000);
  assert.equal(entry.sig, "2026-08-23T15:00--30000", "취소는 승인과 다른 표식이라야 둘 다 담긴다");
});

test("할부 개월수를 날짜나 금액으로 읽지 않는다", () => {
  const { entry } = read("삼성카드1234 승인\n홍*동님\n300,000원 3개월\n08/20 19:40\n하이마트");
  assert.equal(entry.amount, 300000);
  assert.equal(entry.on, "2026-08-20");
  assert.equal(entry.memo, "하이마트");
});

test("연도가 없는 문자는 오늘을 넘지 않는 쪽으로 읽는다", () => {
  assert.equal(parseMessage("현대카드 승인 5,000원 12/28 20:10 마트", "2026-01-03").entry.on,
    "2025-12-28", "1월에 받은 12월 문자는 작년 것이다");
  assert.equal(read("현대카드 승인 5,000원 2026-07-02 20:10 마트").entry.on, "2026-07-02");
  assert.equal(read("토스뱅크 3,000원 결제 스타벅스").entry.on, TODAY, "날짜가 없으면 오늘로 둔다");
});

/* 실기기에서 실제로 온 문자들. 여기 있는 모양은 앞으로도 이렇게 읽혀야 한다 —
 * 자동이체 문자에는 시각이 없어서 "시각 뒤가 가맹점" 규칙이 통째로 빗나갔고,
 * 문자 원문이 그대로 메모에 들어갔다(2026-08-24 화면에서 발견). */
test("실제 카드 문자 — 시각이 없는 자동이체도 가맹점만 남긴다", () => {
  const real = [
    ["신한카드(3484)승인 김*형님 LG U+통신요금 자동이체 39,600원 08/10 누적1,234,567원",
      39600, "2026-08-10", "LG U+통신요금 자동이체"],
    ["[Web발신]\n신한카드(3484)승인\n김*형님\n10,100원 일시불\n08/23 07:41\n카카오T일반\n누적83,698원",
      10100, "2026-08-23", "카카오T일반"],
    ["[Web발신]\n신한카드승인 김*형 19,900원 일시불 08/19 20:33 (주)나인투원",
      19900, "2026-08-19", "(주)나인투원"],
    ["[Web발신]\n신한카드(3484)승인 김*형님 2,900원 일시불 08/07 19:02 GS25 서천빌",
      2900, "2026-08-07", "GS25 서천빌"],
    ["[Web발신]\n신한체크카드승인 498원 08/02 03:11 구글클라우드",
      498, "2026-08-02", "구글클라우드"],
  ];
  for (const [message, amount, on, memo] of real) {
    const { entry, reason } = parseMessage(message, TODAY);
    assert.equal(reason, undefined, message);
    assert.deepEqual([entry.amount, entry.on, entry.memo], [amount, on, memo], message);
  }
});

test("가맹점 자리가 비어도 기록은 만든다 — 사람이 고치면 된다", () => {
  const { entry } = read("우리카드 승인 8,900원 08/23 12:00");
  assert.equal(entry.amount, 8900);
  assert.equal(entry.memo, "");
});

test("결제가 아닌 문자와 원화가 아닌 승인은 이유를 남기고 거른다", () => {
  assert.match(read("[Web발신] 인증번호 [123456] 을 입력해주세요").reason, /결제 문자가 아님/);
  assert.match(read("신한카드 해외승인 USD 12.00 08/23 AMAZON").reason, /원화/);
  assert.match(read("고객님 감사합니다 다음에 또 오세요").reason, /금액/);
  assert.match(read("   ").reason, /빈 문자/);
});

test("카드 대금을 갚은 문자는 소비로 담지 않는다 — 이중 계상이 된다", () => {
  /* 개별 승인으로 이미 센 돈을, 그 대금을 갚은 문자로 한 번 더 세면 두 배가 된다.
   * 즉시결제·선결제를 신청하면 은행에서 카드값이 빠져나가며 문자가 온다. */
  const bills = [
    "[Web발신]\n신한카드 즉시결제\n500,000원\n08/24 10:00\n감사합니다",
    "[Web발신]\n신한카드(3484) 선결제 300,000원 08/24 10:00 처리완료",
    "[Web발신]\n국민은행\n08/24 10:00 출금 500,000원\n신한카드대금\n잔액 1,234,567원",
    "[Web발신]\n신한카드 결제대금 1,203,400원이 출금되었습니다 08/25",
    "[Web발신] 신한카드 일부결제금액이월약정 안내 500,000원",
  ];
  for (const message of bills) {
    assert.match(read(message).reason ?? "", /카드 대금/, message);
  }
});

test("출금·이체가 들어 있어도 쓴 돈이면 담는다", () => {
  // "출금" 만으로 거르면 체크카드 승인이 사라지고, "이체" 로 거르면 통신요금이 사라진다.
  const spending = [
    ["[Web발신] KB국민체크 출금 3,000원 08/24 09:10 스타벅스", 3000, "스타벅스"],
    ["신한카드(3484)승인 김*형님 LG U+통신요금 자동이체 39,600원 08/10", 39600, "LG U+통신요금 자동이체"],
  ];
  for (const [message, amount, memo] of spending) {
    const { entry, reason } = read(message);
    assert.equal(reason, undefined, message);
    assert.deepEqual([entry.amount, entry.memo], [amount, memo], message);
  }
});

test("여러 건을 한 번에 붙여넣는다", () => {
  const text = `[Web발신]
신한카드(1234)승인
12,000원 일시불
08/23 14:22
백암순대

[Web발신]
신한카드(1234)승인
4,500원 일시불
08/23 16:05
카페
[Web발신]
신한카드(1234)승인취소
4,500원
08/23 16:20
카페

[Web발신] 인증번호 [009911]`;
  assert.equal(splitMessages(text).length, 4, "빈 줄이 없어도 [Web발신] 머리에서 잘린다");
  const { found, failed } = parseMessages(text, TODAY);
  assert.deepEqual(found.map((result) => result.entry.amount), [12000, 4500, -4500]);
  assert.equal(failed.length, 1);
  assert.match(failed[0].reason, /결제 문자가 아님/);
});

test("같은 문자를 두 번 담지 않는다", () => {
  const message = "신한카드(1234)승인 12,000원 08/23 14:22 백암순대";
  const { entry } = read(message);
  const state = addEntry(emptyState(), entry, new Date(`${TODAY}T05:22:00Z`));
  assert.equal(state.entries[0].sig, entry.sig, "표식이 저장까지 살아남는다");
  assert.equal(seenSigs(state).has(read(message).entry.sig), true);
  // 같은 가게에서 같은 금액이라도 시각이 다르면 다른 결제다.
  assert.equal(seenSigs(state).has(read("신한카드(1234)승인 12,000원 08/23 18:40 백암순대").entry.sig), false);
});

/* ── 문자 백업 파일 ─────────────────────────────────────────────── */
const { extractBackup, looksLikeBackup, parseBackupOrText } = await import("../life/budget/sms.js");

// SMS Backup & Restore(SyncTech)가 만드는 모양. body 는 속성 안에 한 줄로 들어가고
// 줄바꿈은 &#10; 로 이스케이프된다.
const BACKUP = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<smses count="3">
  <sms protocol="0" address="15778000" date="1787462520000" type="1" readable_date="2026-08-23 14:22:00"
    body="[Web발신]&#10;신한카드(1234)승인&#10;12,000원 일시불&#10;08/23 14:22&#10;백암순대 &amp; 국밥&#10;누적1,234,567원" />
  <sms protocol="0" address="010-1234-5678" date="1787462900000" type="1"
    body="언제 만날래?" />
  <sms protocol="0" address="15778000" date="1753322400000" type="1"
    body="[Web발신] 신한카드(1234)승인 4,500원 일시불 카페" />
</smses>`;

test("백업 XML 에서 문자 본문과 받은 시각을 뽑는다", () => {
  assert.equal(looksLikeBackup(BACKUP), true);
  assert.equal(looksLikeBackup("신한카드(1234)승인 12,000원"), false);
  const rows = extractBackup(BACKUP);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].at, 1787462520000);
  assert.match(rows[0].body, /백암순대 & 국밥/, "XML 이스케이프를 되돌린다");
  assert.equal(rows[0].body.split("\n").length, 6, "줄바꿈(&#10;)도 되돌린다");
  assert.equal(extractBackup(BACKUP, 1).length, 1, "상한을 넘겨 훑지 않는다");
});

test("백업 파일은 결제 문자만 골라 담고 날짜는 받은 시각을 쓴다", () => {
  const { found, failed, fromBackup } = parseBackupOrText(BACKUP, TODAY);
  assert.equal(fromBackup, true);
  assert.deepEqual(found.map((result) => result.entry.amount), [12000, 4500]);
  assert.equal(found[0].entry.memo, "백암순대 & 국밥");
  assert.equal(found[0].entry.on, "2026-08-23");
  // 본문에 날짜가 없어도 받은 시각(2025-07-24 KST)으로 담긴다 — 오늘로 몰리지 않는다.
  assert.equal(found[1].entry.on, "2025-07-24");
  assert.equal(failed.length, 1, "결제와 무관한 문자는 조용히 빠진다");
});

test("같은 입구로 붙여넣은 글도 그대로 받는다", () => {
  const { found, fromBackup } = parseBackupOrText("신한카드(1234)승인 12,000원 08/23 14:22 백암순대", TODAY);
  assert.equal(fromBackup, undefined);
  assert.equal(found[0].entry.amount, 12000);
});
