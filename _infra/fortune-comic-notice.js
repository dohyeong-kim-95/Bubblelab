// 만화 사주 신청을 디스코드로 알리는 문구 — 운세 노트 화면에 그려지지 않는 글이라
// fortune.js(화면 글꼴 조각 검사 대상)와 떼어 둔다. 문구를 늘려도 글꼴을 다시 굽지 않아도 된다.
// 옛 메일 접수창(/_fortune/comic-request)은 2026-11-18 에 닫았다 — 새 신청은 아래 신청서 하나로 받는다.
// 집 PC 의 메일 목록 경로(/_fortune/comic-requests)는 남은 신청이 없어도 깨지지 않게 그대로 둔다.

// 집 PC 가 만화를 다 만들어 보낼 재료(제목·본문·zip)를 꾸렸을 때(또는 자동 점검에서 멈췄을 때) 알린다.
// 신청 id·메일·생년월일은 싣지 않는다 — 사유는 집 PC 가 개인정보 없이 짧게 쓴다.
export function comicReadyNotice(status, reason) {
  const content = status === "failed"
    ? `⚠️ 만화 사주 자동 준비가 멈췄어요${reason ? ` — ${reason}` : ""}\nMaster 세션에 "만화 사주 실패 봐 줘" 라고 해 주세요.`
    : "📬 만화 사주 메일 재료가 준비됐어요 — Master 세션에 \"만화 사주 줘\" 라고 하면 제목·본문·zip 을 드려요.\n보낸 뒤 \"보냈어\" 라고 하면 개인정보를 지워요.";
  return { content, allowed_mentions: { parse: [] } };
}


// 만화 사주 후기가 들어오면 알린다. 후기에는 연락처가 없다(받지 않는다) — 별점과 앞부분만.
export function reviewNotice(rating, text, nick) {
  const head = String(text).replace(/\s+/g, " ").slice(0, 80);
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  return {
    content: `📝 만화 사주 후기 ${stars}${nick ? ` — ${nick}` : ""}\n> ${head}${text.length > 80 ? "…" : ""}`,
    allowed_mentions: { parse: [] },
  };
}

// ── 만화 사주 신청서(util/fortune/insta/) ── 인스타 아이디나 메일 주소 하나를 받는다(2026-11-18 메일 접수창과 하나로 합침).
// 상한은 회차(게시글)마다 IG_FORM_ROUND_CAP 건 — admin 📸 에서 새 회차를 열면 다시 센다.
// 회차 안에서는 지워도 자리가 다시 나지 않는다.
export const IG_FORM_ROUND_CAP = 10;
export const IG_FORM_MSG = { full: "이번 신청은 마감됐어요", closed: "지금은 신청을 받지 않아요", dup: "이미 접수됐어요" };

// 디스코드에는 개인정보(아이디·메일·이름·생년월일·링크)를 싣지 않는다 — 디스코드에는 지우는 절차가 닿지 않는다.
// 보낼 사람·문구는 admin 📸 에서 본다.
export function igFormNotice(nth, cap = IG_FORM_ROUND_CAP) {
  return {
    content: `📸 만화 사주 신청 — 이번 회차 ${nth}/${cap}\n집 PC 가 5분 안에 그리기 시작해요(20분쯤).`,
    allowed_mentions: { parse: [] },
  };
}
export function igFormReadyNotice(count) {
  return { content: `✅ 만화 사주 완성 ${count}건 — admin 📸 에서 보내 주세요`, allowed_mentions: { parse: [] } };
}
export function igFormFailedNotice(reason) {
  return {
    content: `⚠️ 만화 사주가 멈췄어요 — ${reason || "사유 없음"}\nadmin 📸 에서 확인해 주세요.`,
    allowed_mentions: { parse: [] },
  };
}

// 손님에게 보낼 글 — 인스타 DM 과 메일이 같은 글을 쓴다(메일은 제목만 더). 다그당스 말투('~승')는 여기서만 쓴다
// (화면은 해요체 — _infra/fortune-consult.test.mjs). 링크는 서버가 모양을 확인한 것만 온다.
export const COMIC_MAIL_SUBJECT = "다그당스 만화 사주가 나왔어요";
export function igFormDmText(name, link) {
  return `${name ? `${name}님 ` : ""}만화 사주 나왔승! 🐴\n👉 ${link}\n(7일 동안 받을 수 있어요)`;
}
export function comicMessage(name, link) {
  return { subject: COMIC_MAIL_SUBJECT, text: igFormDmText(name, link) };
}
