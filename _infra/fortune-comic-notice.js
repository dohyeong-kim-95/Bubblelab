// 만화 사주 신청을 디스코드로 알리는 문구 — 운세 노트 화면에 그려지지 않는 글이라
// fortune.js(화면 글꼴 조각 검사 대상)와 떼어 둔다. 문구를 늘려도 글꼴을 다시 굽지 않아도 된다.
export const COMIC_CAP = 10;

// 새 신청을 논문 다이제스트와 같은 디스코드 채널에 알린다. 메일·생년월일은 싣지 않는다 —
// 디스코드에는 지우는 절차(done)가 닿지 않으니, 남는 것은 몇 번째인지와 남은 자리뿐이다.
// 알림이 실패해도 신청은 이미 저장됐으므로 신청자에게는 성공으로 답한다.
export function comicNotice(nth, remaining) {
  return {
    content: `🎨 만화 사주 신청이 들어왔어요 — ${nth}번째 (남은 자리 ${remaining}/${COMIC_CAP})\n` +
      "집 PC 가 5분 안에 집어 가서 그리기 시작해요(30분쯤). 다 되면 📬 알림이 한 번 더 와요.",
    allowed_mentions: { parse: [] },
  };
}

// 집 PC 가 만화를 다 만들어 보낼 재료(제목·본문·zip)를 꾸렸을 때(또는 자동 점검에서 멈췄을 때) 알린다.
// 신청 id·메일·생년월일은 싣지 않는다 — 사유는 집 PC 가 개인정보 없이 짧게 쓴다.
export function comicReadyNotice(status, reason) {
  const content = status === "failed"
    ? `⚠️ 만화 사주 자동 준비가 멈췄어요${reason ? ` — ${reason}` : ""}\nMaster 세션에 "만화 사주 실패 봐 줘" 라고 해 주세요.`
    : "📬 만화 사주 메일 재료가 준비됐어요 — Master 세션에 \"만화 사주 줘\" 라고 하면 제목·본문·zip 을 드려요.\n보낸 뒤 \"보냈어\" 라고 하면 개인정보를 지워요.";
  return { content, allowed_mentions: { parse: [] } };
}

