// 만화 사주 접수증의 순수 함수 — 화면(receipt.js)과 테스트(_infra/fortune-receipt.test.mjs)가 같이 쓴다.
(() => {
  "use strict";
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

  /** 쓸 토큰 — 주소의 # 뒤가 있으면 그것만(틀리면 null), 비어 있으면 이 기기에 적어 둔 것. */
  function tokenFrom(hash, saved) {
    const h = String(hash ?? "").replace(/^#/, "");
    if (h) return TOKEN_RE.test(h) ? h : null;
    return TOKEN_RE.test(saved?.token ?? "") ? saved.token : null;
  }

  /** 붙여 넣은 접수증 링크(또는 토큰만)에서 토큰을 꺼낸다. */
  function tokenFromPaste(text) {
    const s = String(text ?? "").trim();
    const m = /#([A-Za-z0-9_-]{43})(?:$|[^A-Za-z0-9_-])/.exec(s);
    if (m) return m[1];
    return TOKEN_RE.test(s) ? s : null;
  }

  const isIOS = ({ ua = "", platform = "", maxTouchPoints = 0 } = {}) =>
    /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);

  /**
   * 알림 받기를 어떻게 보여 줄지.
   *   "ios-guide" — 아이폰·아이패드인데 홈 화면 앱이 아님(웹 푸시는 홈 화면에 추가한 앱에서만, iOS 16.4+)
   *   "button"    — 바로 알림 받기 버튼
   *   "none"      — 이 브라우저는 못 받음(캘린더만)
   */
  function pushMode({ ua, platform, maxTouchPoints, standalone, supported }) {
    if (isIOS({ ua, platform, maxTouchPoints }) && !standalone) return "ios-guide";
    return supported ? "button" : "none";
  }

  window.ReceiptLib = { TOKEN_RE, tokenFrom, tokenFromPaste, isIOS, pushMode };
})();
