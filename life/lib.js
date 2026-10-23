// 도구(`life/<이름>/`)들이 같이 쓰는 작은 조각. 도구마다 복사해 두면 한쪽만 고쳐져
// 조용히 어긋난다(공유 캐시 이름이 그랬다) — 여기 한 곳에 둔다.
//
// LIFE 셸(`app.js`)은 이 파일을 받지 않는다. 시작에 받는 파일을 늘리지 않으려고
// 셸은 자기 `node` 를 따로 갖는다(e2e "도구는 열 때 받는다" 가 셸 파일 목록을 고정한다).
// node 테스트도 store.js 를 거쳐 이 파일을 읽으므로 모듈 맨 위에서 DOM 을 만지지 않는다.

/** 오늘(또는 주어진 때)의 KST 날짜 `YYYY-MM-DD`. 자정 경계는 이 한 곳에서만 다룬다. */
export function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

/** 요소 하나. 글은 textContent 로만 넣는다(마크업으로 해석하지 않는다). */
export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

/* 공유 시트로 받은 것을 서비스워커가 담아 두는 캐시와 열쇠. 서비스워커(`sw.js`)는
 * 클래식 스크립트라 이 모듈을 import 하지 못해 같은 값을 글자로 적어 둔다 —
 * `_infra/budget.test.mjs` 가 두 곳이 같은지 확인한다. */
export const SHARE_CACHE = "bl-life-share";
export const SHARE_KEY = "/__share";
